/**
 * Analyst subagent — 接收 flow.failed，输出 bug.draft。
 *
 * 红线（宪法第 4 条）：
 *   - 至少 1 条 Evidence
 *   - 仅输出 hypothesis，不输出 confirmed
 *   - 必须填 reproSteps / counterEvidence(可空) / confidence
 */

import type {
  Subagent,
  KernelContext,
  Evidence,
  BugFinding,
  BugSource,
  Severity,
} from '@sentinel/core';

export interface AnalystConfig {
  /** 最小置信度阈值，低于此值标 P3 */
  minConfidence?: number;
}

interface FlowFailedPayload {
  flowId: string;
  error: string;
  evidence: Evidence[];
}

export function createAnalyst(_config: AnalystConfig = {}): Subagent {
  return {
    name: 'analyst',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<FlowFailedPayload>('flow.failed', async (event) => {
        const { flowId, error, evidence } = event.payload;

        if (evidence.length === 0) {
          // 无证据 → 不能出 bug，发 insufficient_evidence
          await ctx.bus.publish({
            type: 'bug.insufficient_evidence',
            payload: {
              bugId: `bug_${flowId}_${Date.now()}`,
              needs: ['screenshot', 'console', 'network', 'a11y'],
            },
            source: 'analyst',
            traceId: event.traceId,
          });
          return;
        }

        const draft = await analyseDraft(ctx, flowId, error, evidence);
        await ctx.bus.publish({
          type: 'bug.draft',
          payload: draft,
          source: 'analyst',
          traceId: event.traceId,
        });
      });
    },
  };
}

async function analyseDraft(
  ctx: KernelContext,
  flowId: string,
  error: string,
  evidence: Evidence[],
): Promise<BugFinding> {
  // 1. 启发式预分类（不靠 LLM 也能给基本判断）
  const heuristic = heuristicClassify(error, evidence);

  // 2. LLM 出根因假设
  let llmHypothesis: { rootCause: string; confidence: number; reproSteps: string[] } | null = null;
  try {
    llmHypothesis = await llmAnalyse(ctx, error, evidence, heuristic);
  } catch {
    // LLM 失败不阻塞 → 用启发式结果
  }

  const id = `bug_${flowId}_${Date.now().toString(36)}`;

  return {
    id,
    title: `${flowId}: ${error.slice(0, 80)}`,
    severity: heuristic.severity,
    source: heuristic.source,
    affectedFeature: flowId,
    symptom: error,
    reproSteps: llmHypothesis?.reproSteps ?? [`运行 flow ${flowId}`],
    evidence,
    rootCauseStatus: 'hypothesis', // 红线：永远先出 hypothesis
    ...(llmHypothesis?.rootCause && { rootCause: llmHypothesis.rootCause }),
    counterEvidence: [],
    confidence: llmHypothesis?.confidence ?? heuristic.confidence,
    fixOptions: [], // planner 后续填
  };
}

function heuristicClassify(
  error: string,
  evidence: Evidence[],
): { source: BugSource; severity: Severity; confidence: number } {
  const lower = error.toLowerCase();

  // 网络层
  for (const e of evidence) {
    if (e.kind === 'network' && e.failed) {
      if (e.status === 401 || e.status === 403) {
        return { source: 'auth', severity: 'P1', confidence: 0.7 };
      }
      if (e.status >= 500) return { source: 'api', severity: 'P0', confidence: 0.65 };
      if (e.status === 404) return { source: 'api', severity: 'P1', confidence: 0.7 };
    }
  }

  // console 错误
  for (const e of evidence) {
    if (e.kind === 'console' && e.level === 'error') {
      if (/typeerror|cannot read|undefined/i.test(e.message)) {
        return { source: 'ui', severity: 'P1', confidence: 0.6 };
      }
    }
  }

  if (/timeout|timed out/i.test(lower)) {
    return { source: 'perf', severity: 'P1', confidence: 0.55 };
  }

  return { source: 'ui', severity: 'P2', confidence: 0.4 };
}

async function llmAnalyse(
  ctx: KernelContext,
  error: string,
  evidence: Evidence[],
  hint: { source: BugSource; severity: Severity; confidence: number },
): Promise<{ rootCause: string; confidence: number; reproSteps: string[] } | null> {
  const evidenceSummary = evidence
    .map((e) => {
      switch (e.kind) {
        case 'console':
          return `[console.${e.level}] ${e.message}`;
        case 'network':
          return `[network] ${e.method} ${e.url} → ${e.status} ${e.failed ? 'FAILED' : ''}`;
        case 'http':
          return `[http] ${e.method} ${e.url} → ${e.status}`;
        case 'screenshot':
          return `[screenshot] ${e.hash}`;
        case 'a11y':
          return `[a11y tree] available`;
        case 'dom-snapshot':
          return `[dom snapshot] ${e.html.slice(0, 200)}...`;
        default:
          return `[${e.kind}] ${e.hash}`;
      }
    })
    .join('\n');

  const prompt = `你是一个谨慎的 Web 应用调试专家。一个用户流程失败了，你只能基于下面提供的 Evidence 给出根因假设。

错误信息: ${error}

启发式预分类提示：
  - 来源: ${hint.source}
  - 严重度: ${hint.severity}
  - 启发式置信度: ${hint.confidence}

Evidence (${evidence.length} 条):
${evidenceSummary}

请用 JSON 格式回复（不要包含其他文字）：
{
  "rootCause": "你的根因假设（一句话）",
  "confidence": 0.0-1.0,
  "reproSteps": ["复现步骤 1", "复现步骤 2", ...]
}

红线：
- 如果证据不足以推断根因，confidence 必须 ≤ 0.3
- rootCause 不要写"可能"或"也许"，给出明确假设
- 永远不要编造证据中没有的信息`;

  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel debug agent 的分析师子代理。' },
    { role: 'user', content: prompt },
  ]);

  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  try {
    const cleaned = resp.content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned) as {
      rootCause?: string;
      confidence?: number;
      reproSteps?: string[];
    };
    if (typeof parsed.rootCause === 'string') {
      return {
        rootCause: parsed.rootCause,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.3)),
        reproSteps: Array.isArray(parsed.reproSteps) ? parsed.reproSteps : [],
      };
    }
  } catch {
    // 解析失败 → 返回 null，回退到启发式
  }
  return null;
}
