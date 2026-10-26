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

export function formatEvidence(e: Evidence): string {
  const detail = e.kind === 'screenshot'
    ? { path: e.path.startsWith('data:') ? '[image data; inspect separately]' : e.path }
    : e;
  return `[${e.kind}/${e.source} hash=${e.hash}] ${JSON.stringify(detail).slice(0, 4000)}`;
}

export interface AnalystConfig {
  /** 最小置信度阈值，低于此值标 P3 */
  minConfidence?: number;
}

interface FlowFailedPayload {
  flowId: string;
  error: string;
  evidence: Evidence[];
  /** 本次 flow 实际访问的 URL —— 用于把运行时证据和路由/源文件对上 */
  url?: string;
}

export function createAnalyst(_config: AnalystConfig = {}): Subagent {
  return {
    name: 'analyst',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<FlowFailedPayload>('flow.failed', async (event) => {
        const { flowId, error, evidence, url } = event.payload;

        if (error.startsWith('runner error:')) {
          // runner 自身异常（证据采集失败等）——不是被测项目的缺陷，不产出 bug
          await ctx.bus.publish({
            type: 'bug.insufficient_evidence',
            payload: {
              bugId: `bug_${flowId}_${Date.now()}`,
              needs: ['runner'],
              reason: error,
            },
            source: 'analyst',
            traceId: event.traceId,
          });
          return;
        }

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

        const draft = await analyseDraft(ctx, flowId, error, evidence, url);
        await ctx.bus.publish({
          type: 'bug.draft',
          payload: draft,
          source: 'analyst',
          traceId: event.traceId,
        });

        // 根因没产出 = 假设链断了，必须说出来，否则报告看起来像"已诊断"
        if (!draft.rootCause) {
          await ctx.bus.publish({
            type: 'bug.insufficient_evidence',
            payload: {
              bugId: draft.id,
              needs: ['llm-root-cause'],
              reason: `未能从证据中提取根因假设（flow ${flowId}）`,
            },
            source: 'analyst',
            traceId: event.traceId,
          });
        }
      });
    },
  };
}

async function analyseDraft(
  ctx: KernelContext,
  flowId: string,
  error: string,
  evidence: Evidence[],
  url?: string,
): Promise<BugFinding> {
  // 同一份证据常被多个 step 重复采集（相同 hash）—— 去重，既减少提示词噪声，也让证据数可读
  const deduped = dedupeEvidence(evidence);
  // 1. 启发式预分类（不靠 LLM 也能给基本判断）
  const heuristic = heuristicClassify(error, deduped);

  // 2. LLM 出根因假设
  let llmHypothesis: { rootCause: string; confidence: number; reproSteps: string[] } | null = null;
  try {
    llmHypothesis = await llmAnalyse(ctx, error, deduped, heuristic, url);
  } catch (err) {
    // LLM 失败不阻塞 → 用启发式结果，但必须说出来
    console.warn(`[sentinel] analyst: LLM 调用失败，回退到启发式：${(err as Error).message}`);
  }

  const id = `bug_${flowId}_${Date.now().toString(36)}`;

  return {
    id,
    title: `${flowId}: ${error.slice(0, 80)}`,
    severity: heuristic.severity,
    source: heuristic.source,
    affectedFeature: flowId,
    symptom: url ? `访问 ${url} 时：${error}` : error,
    reproSteps:
      llmHypothesis?.reproSteps ??
      (url ? [`访问 ${url}`, `复现 flow ${flowId}`] : [`运行 flow ${flowId}`]),
    evidence: deduped,
    rootCauseStatus: 'hypothesis', // 红线：永远先出 hypothesis
    ...(llmHypothesis?.rootCause && { rootCause: llmHypothesis.rootCause }),
    counterEvidence: [],
    confidence: llmHypothesis?.confidence ?? heuristic.confidence,
    fixOptions: [], // planner 后续填
  };
}

/** 按 hash 去重证据，保留首次出现的顺序 */
function dedupeEvidence(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of evidence) {
    if (seen.has(e.hash)) continue;
    seen.add(e.hash);
    out.push(e);
  }
  return out;
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
  url?: string,
): Promise<{ rootCause: string; confidence: number; reproSteps: string[] } | null> {
  const evidenceSummary = evidence.map(formatEvidence).join('\n');

  const prompt = `你是一个谨慎的 Web 应用调试专家。一个用户流程失败了，你只能基于下面提供的 Evidence 给出根因假设。

错误信息: ${error}
${url ? `本次访问的 URL: ${url}
` : ''}
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
  ], { timeoutMs: AGENT_LLM_TIMEOUT_MS });

  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  try {
    const extracted = extractJson<{
      rootCause?: string;
      confidence?: number;
      reproSteps?: string[];
    }>(resp.content);
    if (!extracted.ok) {
      // 解析失败不是"没有根因"，而是"模型答了但我们没读出来" —— 必须说出来
      console.warn(`[sentinel] analyst: ${extracted.reason}`);
      return null;
    }
    const parsed = extracted.value;
    if (typeof parsed.rootCause === 'string' && parsed.rootCause.trim()) {
      return {
        rootCause: parsed.rootCause,
        confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.3)),
        reproSteps: Array.isArray(parsed.reproSteps) ? parsed.reproSteps : [],
      };
    }
    console.warn('[sentinel] analyst: 模型回复里没有 rootCause 字段 —— 按证据不足处理');
  } catch (err) {
    console.warn(`[sentinel] analyst: 解析根因时出错：${(err as Error).message}`);
  }
  return null;
}
