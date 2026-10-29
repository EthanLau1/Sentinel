/**
 * Analyst subagent — 接收 flow.failed，输出 bug.draft。
 *
 * 红线（宪法第 4 条）：
 *   - 至少 1 条 Evidence
 *   - 仅输出 hypothesis，不输出 confirmed
 *   - 必须填 reproSteps / counterEvidence(可空) / confidence
 */

import { readFile } from 'node:fs/promises';

import type {
  Subagent,
  KernelContext,
  Evidence,
  BugFinding,
  BugSource,
  Severity,
  ContentImage,
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

/** 单条证据给模型看的字符上限 —— 超了必须写明截断，不能静默砍掉尾巴 */
const EVIDENCE_TEXT_LIMIT = 4000;

/** 单次请求最多附几张截图 —— 图片 token 比文本贵，附太多会打爆预算 */
const MAX_VISION_IMAGES = 3;

/** 单张截图最大字节数 —— 超了跳过，不能把整个请求撑爆 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 证据 → 给模型看的文本。
 *
 * 三条规矩（以前都踩过）：
 * 1. **不许从尾部无声砍断** —— 以前 `JSON.stringify(detail).slice(0, 4000)`，
 *    a11y 树超过 4000 字符时尾巴直接没了，模型拿到的是半棵树却以为看全了。
 *    现在砍就写明砍了多少。
 * 2. **不许假装模型看过图片** —— 以前把截图换成 `[image data; inspect separately]`，
 *    看起来"证据在手上"，实际模型一个字都看不到。
 *    现在分两种情况说清楚：图片确实附在消息里（visionAttached），
 *    或者 provider 根本不支持看图。
 * 3. **结构化证据按结构截断** —— a11y 树保头保尾，DOM 保头部。
 */
export function formatEvidence(e: Evidence, opts: { visionAttached?: boolean } = {}): string {
  const head = `[${e.kind}/${e.source} hash=${e.hash}]`;
  switch (e.kind) {
    case 'screenshot':
      return opts.visionAttached
        ? `${head} 截图文件：${e.path}（本次已作为图片随本条消息附给模型，请直接看图判断）`
        : `${head} 截图文件：${e.path}（当前模型通道只支持文本，模型未对该图做视觉判读；请以 DOM / a11y / console / network 证据为准）`;
    case 'a11y': {
      // Playwright 的 ariaSnapshot 是一段 YAML 文本，不是 JSON —— 直接给原文比 JSON 串好读
      const text = typeof e.tree === 'string' ? e.tree : JSON.stringify(e.tree);
      return `${head} ${keepHeadAndTail(text, EVIDENCE_TEXT_LIMIT)}`;
    }
    case 'dom-snapshot': {
      const truncated = e.html.length > EVIDENCE_TEXT_LIMIT;
      const body = truncated ? e.html.slice(0, EVIDENCE_TEXT_LIMIT) : e.html;
      const note = truncated ? `\n…（DOM 共 ${e.html.length} 字符，已截断尾部）` : '';
      return `${head} ${body}${note}`;
    }
    default: {
      const text = JSON.stringify(e);
      return `${head} ${keepHeadAndTail(text, EVIDENCE_TEXT_LIMIT)}`;
    }
  }
}

/**
 * 头尾都留，中间写明截断。
 *
 * 为什么要留尾巴：证据 JSON 的尾部往往是最有信息量的部分
 * （文件证据的 snippet 结尾、网络证据的 status）。
 */
function keepHeadAndTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const headLen = Math.floor(limit * 0.7);
  const tailLen = Math.max(0, limit - headLen);
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : '';
  const omitted = text.length - headLen - tailLen;
  return `${head}\n…（共 ${text.length} 字符，中间 ${omitted} 字符已省略）…\n${tail}`;
}

export interface AnalystConfig {
  /** 最小置信度阈值，低于此值标 P3 */
  minConfidence?: number;
}

/**
 * 把截图证据读成图片，随消息附给模型。
 *
 * 为什么以前做不到：截图只是 `path` 字符串，模型通道只认文本，
 * 于是 analyst 只能写一句"模型看不到图"。现在这里真的把 PNG 读出来附上去。
 *
 * 三个边界：
 * 1. **读不到就跳过，不报错** —— 证据读不出来不该让整轮 run 挂掉；
 * 2. **只认本地文件或 data URI** —— 不去下载远程 URL；
 * 3. **最多 3 张、单张 ≤5MB** —— 图片 token 贵，防止一次请求打爆预算。
 *
 * 返回 attached（证据 hash 集合）是为了让文字描述如实写"已附图"，
 * 而不是让模型以为只有一句路径。
 */
export async function collectVisionImages(
  evidence: Evidence[],
): Promise<{ images: ContentImage[]; attached: Set<string> }> {
  const images: ContentImage[] = [];
  const attached = new Set<string>();

  for (const e of evidence) {
    if (e.kind !== 'screenshot') continue;
    if (images.length >= MAX_VISION_IMAGES) break;
    try {
      const img = await loadImage(e.path);
      if (!img) continue;
      images.push(img);
      attached.add(e.hash);
    } catch (err) {
      console.warn(`[sentinel] analyst: 截图读取失败（跳过附图）：${(err as Error).message}`);
    }
  }

  return { images, attached };
}

/** 读一张截图 → base64；data URI 直接拆，文件路径则读盘 */
async function loadImage(path: string): Promise<ContentImage | null> {
  if (path.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(path);
    if (!m) return null;
    return { mimeType: m[1]!, data: m[2]! };
  }
  const buf = await readFile(path);
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    console.warn(`[sentinel] analyst: 截图超过 ${MAX_IMAGE_BYTES} 字节，跳过附图（${path}）`);
    return null;
  }
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return { mimeType: mime, data: buf.toString('base64') };
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
    // 结论来源必须说准：
    //   模型真的给出了根因 → 'llm'
    //   模型没参与（离线模式 / 调用失败兜底）→ 'heuristic'
    // 标错的后果很具体：离线模式 llmRequests=0，报告却把这条算成"模型推断"，
    // 那是在冒充一件根本没发生的事。
    origin: llmHypothesis ? 'llm' : 'heuristic',
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
  const vision = ctx.providers.llm.supportsVision === true;
  const { images, attached } = vision ? await collectVisionImages(evidence) : { images: [], attached: new Set<string>() };
  const evidenceSummary = evidence
    .map((e) => formatEvidence(e, { visionAttached: attached.has(e.hash) }))
    .join('\n');

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
    {
      role: 'user',
      content: prompt,
      ...(images.length > 0 ? { images } : {}),
    },
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
