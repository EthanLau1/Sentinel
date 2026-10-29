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
import { formatEvidence } from './analyst.js';
import { extractJson } from './json.js';

/** 单个 agent 的 LLM 调用超时（ms）—— 超时必须有，否则一次网络抖动就能挂死整轮 */
/**
 * 单个 agent 的 LLM 调用超时（ms）。
 *
 * 180s 的依据（2026-10-26 真实 run9 实测）：90s 会误杀带推理块的模型请求 ——
 * critic 的裁决请求超时 → 那条 bug 停在 hypothesis → 报告第 7 字段又是空的。
 * 注意 agent 的显式超时必须 ≥ provider 的默认超时，否则 agent 反而更容易误杀。
 * 超时是**有界失败**：宁可少一条 confirmed，也不能整轮挂死（见 E4）。
 */
const AGENT_LLM_TIMEOUT_MS = 180_000;

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

        // 确定性规则判定出来的观察项不进 critic ——
        // 它们不是"根因假设"，是运行时事实（缺 viewport / 缺 lang / 白屏之类），
        // 本来就不需要 LLM 反向验证。以前照送，于是每条都被拒：
        // 既白花 token，又在 run-status 里堆一堆"未确认"噪音。
        if (draft.origin === 'rule') return;

        if (draft.evidence.length === 0 || !draft.rootCause?.trim()) {
          await ctx.bus.publish({
            type: 'bug.rejected',
            payload: {
              bugId: draft.id,
              reason: 'missing evidence or root-cause hypothesis',
              kind: 'insufficient-evidence',
            },
            source: 'critic',
            traceId: event.traceId,
          });
          return;
        }

        const verdict = await criticReview(ctx, draft);

        if (verdict.action === 'reject' || verdict.adjustedConfidence < minConfidence) {
          await ctx.bus.publish({
            type: 'bug.rejected',
            payload: {
              bugId: draft.id,
              reason: verdict.reason,
              // 「证据不足」和「critic 自己没跑起来」必须分开：
              // 前者要把草稿从报告里剔除，后者必须保留（没人验过 ≠ 假设不成立）。
              kind: verdict.kind,
            },
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
  /** 拒绝的性质：证据不足（要剔除草稿）还是 critic 自己没跑起来（必须保留草稿） */
  kind: 'insufficient-evidence' | 'unavailable';
}

async function criticReview(ctx: KernelContext, draft: BugFinding): Promise<CriticVerdict> {
  // Require cited source and runtime evidence before confirming.
  // LLM critic：找反证、判断假设是否过强
  try {
    const llm = await llmCriticism(ctx, draft);

    // ── 确定性部分（代码判定，不交给 LLM） ──
    // "根因成立" 的两个实质条件，证据里必须真的同时存在：
    //   ① 代码证据（文件片段）
    //   ② 运行时错误证据（console error / 失败请求 / 4xx+ / trace）
    const codeEvidence = draft.evidence.filter(
      (e) => e.kind === 'file' && Boolean(e.snippet?.trim()),
    );
    const runtimeEvidence = draft.evidence.filter(
      (e) =>
        (e.kind === 'console' && e.level === 'error') ||
        (e.kind === 'network' && e.failed) ||
        (e.kind === 'http' && e.status >= 400) ||
        (e.kind === 'log' && e.level === 'error') ||
        e.kind === 'trace',
    );
    const hasCode = codeEvidence.length > 0;
    const hasRuntime = runtimeEvidence.length > 0;
    // LLM 是否精确复制了这两类 hash —— 作为加分项记录，不作为必要条件：
    // 引用 hash 是形式，"证据齐不齐"才是实质，后者由代码判定更可靠。
    const citedCode = codeEvidence.some((e) => llm.supportingEvidence.includes(e.hash));
    const citedRuntime = runtimeEvidence.some((e) => llm.supportingEvidence.includes(e.hash));

    const verified =
      llm.verifiedRootCause && hasCode && hasRuntime && !llm.shouldReject;

    const detail = `verifiedRootCause=${llm.verifiedRootCause}, hasCode=${hasCode}, hasRuntime=${hasRuntime}, citedCode=${citedCode}, citedRuntime=${citedRuntime}, citedHashes=${llm.supportingEvidence.length}`;

    return {
      action: verified ? 'confirm' : 'reject',
      reason: verified
        ? llm.reason
        : `${llm.reason || 'root cause remains a hypothesis; code and runtime evidence must both be cited'}（判定明细：${detail}）`,
      adjustedConfidence: Math.min(draft.confidence, llm.adjustedConfidence),
      counterEvidence: [],
      kind: 'insufficient-evidence',
    };
  } catch (err) {
    // critic 自己没跑起来（模型不可用 / 网络故障）——
    // 这不是"假设不成立"，是"没人验过"。必须保留草稿，只标明未验证。
    return {
      action: 'reject',
      reason: `critic verification unavailable; hypothesis not confirmed（${(err as Error).message}）`,
      adjustedConfidence: 0,
      counterEvidence: [],
      kind: 'unavailable',
    };
  }
}

async function llmCriticism(
  ctx: KernelContext,
  draft: BugFinding,
): Promise<{ shouldReject: boolean; verifiedRootCause: boolean; supportingEvidence: string[]; reason: string; adjustedConfidence: number }> {
  const evidenceSummary = draft.evidence
    .map(formatEvidence)
    .join('\n');

  // 可引用的 hash 清单 —— 必须单独列出来。
  // 只把 hash 混在长 JSON 里，模型经常一个都不引用，
  // 于是"代码证据 + 运行时证据都被引用"的条件永远不成立 → 永远停在 hypothesis。
  const hashIndex = draft.evidence.map((e) => {
    const runtime =
      (e.kind === 'console' && e.level === 'error') ||
      (e.kind === 'network' && e.failed) ||
      (e.kind === 'http' && e.status >= 400) ||
      (e.kind === 'log' && e.level === 'error') ||
      e.kind === 'trace';
    const code = e.kind === 'file' && Boolean(e.snippet?.trim());
    const level = e.kind === 'console' || e.kind === 'log' ? `/${e.level}` : '';
    const tags = [code ? '代码证据' : '', runtime ? '运行时错误证据' : ''].filter(Boolean);
    return `- ${e.hash}  [${e.kind}${level}]${tags.length ? '  ← ' + tags.join(' + ') : ''}`;
  });

  const prompt = `你是 Sentinel 调试系统的 Critic 子代理。
你的任务：反向验证 analyst 的根因假设是否真的能被 evidence 支持。

Bug 摘要:
  id: ${draft.id}
  title: ${draft.title}
  symptom: ${draft.symptom}
  复现步骤: ${(draft.reproSteps ?? []).join(' → ') || '(无)'}
  分析师假设的根因: ${draft.rootCause ?? '(无)'}
  分析师置信度: ${draft.confidence}

Evidence (${draft.evidence.length} 条):
${evidenceSummary}

可引用的 Evidence hash（supportingEvidence 里只能复制下面清单中的 hash，一个字符都不能改）：
${hashIndex.join('\n')}

请回答以下问题（用 JSON）：
{
  "shouldReject": false,
  "verifiedRootCause": false,
  "supportingEvidence": ["从上面清单里复制的 hash"],
  "reason": "为什么 confirm 或 reject 的简短理由",
  "adjustedConfidence": 0.0-1.0,
  "ruledOut": ["排除掉的其他可能根因 1", "..."],
  "missingEvidence": ["还缺什么证据能让置信度更高 1", "..."]
}

红线：
- 如果 evidence 完全不支持 rootCause，shouldReject = true
- 只有代码证据与独立运行时证据共同定位根因时 verifiedRootCause = true；否则保留 hypothesis
- supportingEvidence 填被根因支持的那些证据的 hash（用于交叉核对），但不要因为"填不全"就否定根因
- 判断"证据能否支撑根因"时看的是**因果链是否闭合**，不是证据条数：
  运行时现象（访问某 URL 时出错）→ 对应的路由/源文件 → 该文件里的具体代码，三环能对上才算支撑
- 即使 analyst confidence 很高，如果 evidence 单一（只有 1 条或 1 类），adjustedConfidence ≤ 0.6
- 不要编造证据中没有的事实`;

  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel critic 子代理，对每个根因假设保持怀疑态度。' },
    { role: 'user', content: prompt },
  ], { timeoutMs: AGENT_LLM_TIMEOUT_MS });

  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  const extracted = extractJson<{
    shouldReject?: boolean;
    verifiedRootCause?: boolean;
    supportingEvidence?: string[];
    reason?: string;
    adjustedConfidence?: number;
  }>(resp.content);

  if (!extracted.ok) {
    // 解析失败 ≠ 假设成立。保守判为"无法验证"，但必须把失败原因说出来。
    console.warn(`[sentinel] critic: ${extracted.reason}`);
    return {
      shouldReject: true,
      verifiedRootCause: false,
      supportingEvidence: [],
      reason: `critic 裁决解析失败，无法验证根因：${extracted.reason}`,
      adjustedConfidence: 0,
    };
  }

  const parsed = extracted.value;
  return {
    shouldReject: parsed.shouldReject === true,
    verifiedRootCause: parsed.verifiedRootCause === true && parsed.shouldReject === false,
    supportingEvidence: Array.isArray(parsed.supportingEvidence) ? parsed.supportingEvidence.filter((x): x is string => typeof x === 'string') : [],
    reason: parsed.reason ?? '(no reason given)',
    adjustedConfidence: Math.max(0, Math.min(1, parsed.adjustedConfidence ?? 0.3)),
  };
}
