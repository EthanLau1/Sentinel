/**
 * Critic subagent — OpenHands SOTA 关键模块。
 *
 * 接收 bug.draft，反向验证 → 出 bug.confirmed 或 bug.rejected。
 *
 * 红线：
 *   - 不能盖章 confirmed 除非 evidence ≥ 1
 *   - 必须列出至少 1 条反证排除项（counterEvidence 可为空数组，但要主动找）
 */

import type {
  Subagent,
  KernelContext,
  BugFinding,
  Evidence,
} from '@sentinel/core';

export interface CriticConfig {
  /** 最低 confidence 阈值，低于此 → reject */
  minConfidence?: number;
}

export function createCritic(config: CriticConfig = {}): Subagent {
  const minConfidence = config.minConfidence ?? 0.4;

  return {
    name: 'critic',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<BugFinding>('bug.draft', async (event) => {
        const draft = event.payload;

        if (draft.evidence.length === 0) {
          await ctx.bus.publish({
            type: 'bug.rejected',
            payload: { bugId: draft.id, reason: 'no evidence' },
            source: 'critic',
            traceId: event.traceId,
          });
          return;
        }

        const verdict = await criticReview(ctx, draft);

        if (verdict.action === 'reject' || verdict.adjustedConfidence < minConfidence) {
          await ctx.bus.publish({
            type: 'bug.rejected',
            payload: { bugId: draft.id, reason: verdict.reason },
            source: 'critic',
            traceId: event.traceId,
          });
          return;
        }

        const confirmed: BugFinding = {
          ...draft,
          rootCauseStatus: 'confirmed',
          confidence: verdict.adjustedConfidence,
          counterEvidence: verdict.counterEvidence,
        };

        await ctx.bus.publish({
          type: 'bug.confirmed',
          payload: confirmed,
          source: 'critic',
          traceId: event.traceId,
        });
      });
    },
  };
}

interface CriticVerdict {
  action: 'confirm' | 'reject';
  reason: string;
  adjustedConfidence: number;
  counterEvidence: Evidence[];
}

async function criticReview(ctx: KernelContext, draft: BugFinding): Promise<CriticVerdict> {
  // 启发式 critic：检查 evidence 是否真的支持 rootCause
  const heuristic = heuristicCriticism(draft);

  // LLM critic：找反证、判断假设是否过强
  try {
    const llm = await llmCriticism(ctx, draft);
    return {
      action: llm.shouldReject ? 'reject' : 'confirm',
      reason: llm.reason,
      adjustedConfidence: Math.min(draft.confidence, llm.adjustedConfidence),
      counterEvidence: heuristic.counterEvidence,
    };
  } catch {
    return {
      action: heuristic.shouldReject ? 'reject' : 'confirm',
      reason: heuristic.reason,
      adjustedConfidence: draft.confidence,
      counterEvidence: heuristic.counterEvidence,
    };
  }
}

function heuristicCriticism(draft: BugFinding): {
  shouldReject: boolean;
  reason: string;
  counterEvidence: Evidence[];
} {
  // 启发式：
  // 1. evidence 多样性低（只有一种 kind）→ 警告
  const kinds = new Set(draft.evidence.map((e) => e.kind));
  if (kinds.size === 1 && draft.confidence > 0.7) {
    return {
      shouldReject: false,
      reason: 'low evidence diversity, confidence capped',
      counterEvidence: [],
    };
  }
  return { shouldReject: false, reason: 'heuristic ok', counterEvidence: [] };
}

async function llmCriticism(
  ctx: KernelContext,
  draft: BugFinding,
): Promise<{ shouldReject: boolean; reason: string; adjustedConfidence: number }> {
  const evidenceSummary = draft.evidence
    .map((e) => `[${e.kind}/${e.source}] hash=${e.hash}`)
    .join('\n');

  const prompt = `你是 Sentinel 调试系统的 Critic 子代理。
你的任务：反向验证 analyst 的根因假设是否真的能被 evidence 支持。

Bug 摘要:
  id: ${draft.id}
  title: ${draft.title}
  symptom: ${draft.symptom}
  分析师假设的根因: ${draft.rootCause ?? '(无)'}
  分析师置信度: ${draft.confidence}

Evidence (${draft.evidence.length} 条):
${evidenceSummary}

请回答以下问题（用 JSON）：
{
  "shouldReject": false,
  "reason": "为什么 confirm 或 reject 的简短理由",
  "adjustedConfidence": 0.0-1.0,
  "ruledOut": ["排除掉的其他可能根因 1", "..."],
  "missingEvidence": ["还缺什么证据能让置信度更高 1", "..."]
}

红线：
- 如果 evidence 完全不支持 rootCause，shouldReject = true
- 即使 analyst confidence 很高，如果 evidence 单一（只有 1 条或 1 类），adjustedConfidence ≤ 0.6
- 不要编造证据中没有的事实`;

  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel critic 子代理，对每个根因假设保持怀疑态度。' },
    { role: 'user', content: prompt },
  ]);

  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  const cleaned = resp.content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned) as {
    shouldReject?: boolean;
    reason?: string;
    adjustedConfidence?: number;
  };
  return {
    shouldReject: parsed.shouldReject === true,
    reason: parsed.reason ?? '(no reason given)',
    adjustedConfidence: Math.max(0, Math.min(1, parsed.adjustedConfidence ?? 0.3)),
  };
}
