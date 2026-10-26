/**
 * Planner subagent — 接收 bug.confirmed，生成 FixOption × 3 + 推荐。
 *
 * 红线：
 *   - 至少 3 个 option（low/medium/long-term）
 *   - 每个 option 必须有完整的 5 维成本字段
 *   - 推荐基于 score 排序，可解释（whyRecommended）
 */

import type {
  Subagent,
  KernelContext,
  BugFinding,
  FixOption,
  Stage,
  Tier,
  Cost,
  Effort,
  Risk,
} from '@sentinel/core';
import {
  computeScore,
  DEFAULT_WEIGHTS,
  PRESETS,
  stageFit,
  type CostWeights,
} from './cost-model.js';
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

export interface PlannerConfig {
  stage?: Stage;
  weights?: CostWeights;
  requireVerified?: boolean;
}

export function createPlanner(config: PlannerConfig = {}): Subagent {
  const stage = config.stage ?? 'MVP';
  const weights = config.weights ?? PRESETS[stage.toLowerCase() as keyof typeof PRESETS] ?? DEFAULT_WEIGHTS;

  return {
    name: 'planner',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<BugFinding>('bug.confirmed', async (event) => {
        if (config.requireVerified === true && event.source !== 'verifier') return;
        const bug = event.payload;
        let options = await llmPlan(ctx, bug, stage).catch(() => null);

        if (!options || options.length < 3) {
          options = heuristicPlan(bug, stage);
        }

        const scored = options.map((o) => {
          const score = computeScore(
            {
              confidence: o.confidence,
              impact: severityImpact(bug.severity),
              stageFit: stageFit(stage, o.stageFit),
              effort: o.effort,
              risk: o.risk,
              runtimeCost: o.runtimeCost,
              regressionRisk: o.regressionRisk,
              maintenanceCost: o.maintenanceCost,
            },
            weights,
          );
          return { ...o, score, whyRecommended: `${o.whyRecommended ?? ''} Qualitative cost only; actual monetary price unknown.`.trim() };
        });
        scored.sort((a, b) => b.score - a.score);

        const recommended = scored[0]!;
        const enriched: BugFinding = {
          ...bug,
          fixOptions: scored,
          recommendedFixId: recommended.id,
        };

        await ctx.bus.publish({
          type: 'fix.proposed',
          // payload includes the enriched bug to avoid losing context
          // EVENT-CATALOG.md updated to FixProposedPayload
          payload: { bug: enriched, options: enriched.fixOptions },
          source: 'planner',
          traceId: event.traceId,
        });

        // 同时发增强后的 bug（带 fixOptions），用 fix.enhanced 通道避免循环
        // bug.confirmed 不能再发，否则 planner 自己又触发自己
        // 通过 fix.proposed → enhancer → fix.enhanced 链路把完整 bug 带过去
      });
    },
  };
}

function severityImpact(s: BugFinding['severity']): number {
  switch (s) {
    case 'P0': return 1.0;
    case 'P1': return 0.7;
    case 'P2': return 0.4;
    case 'P3': return 0.2;
  }
}

/**
 * 启发式 fallback：3 档方案
 *  - quick (Tier 1, low effort/risk)
 *  - standard (Tier 2, medium)
 *  - long-term (Tier 3, high effort, low risk after)
 */
function heuristicPlan(bug: BugFinding, stage: Stage): FixOption[] {
  const id = bug.id;
  const baseCause = bug.rootCause ?? bug.symptom;
  return [
    optionTemplate({
      id: `${id}_fix_quick`,
      title: '快速修复（绕过/补丁）',
      description: `针对"${baseCause}"做最小修改`,
      effort: 'low',
      risk: 'low',
      runtimeCost: 'none',
      regressionRisk: 'medium',
      maintenanceCost: 'medium',
      stageFit: 'MVP',
      tier: 1,
      confidence: bug.confidence * 0.9,
    }),
    optionTemplate({
      id: `${id}_fix_standard`,
      title: '标准修复（含测试）',
      description: `针对"${baseCause}"做规范化修改并加单元测试`,
      effort: 'medium',
      risk: 'low',
      runtimeCost: 'none',
      regressionRisk: 'low',
      maintenanceCost: 'low',
      stageFit: 'Launch',
      tier: 2,
      confidence: bug.confidence,
    }),
    optionTemplate({
      id: `${id}_fix_longterm`,
      title: '长期重构（含监控）',
      description: `重构相关模块解决"${baseCause}"的根本问题`,
      effort: 'high',
      risk: 'medium',
      runtimeCost: 'low',
      regressionRisk: 'medium',
      maintenanceCost: 'low',
      stageFit: 'Scale',
      tier: 3,
      confidence: bug.confidence * 0.7,
    }),
  ].map((o) => ({ ...o, whyRecommended: `${stage} 阶段适配` }));
}

function optionTemplate(o: {
  id: string;
  title: string;
  description: string;
  effort: Effort;
  risk: Risk;
  runtimeCost: Cost;
  regressionRisk: Risk;
  maintenanceCost: Cost;
  stageFit: Stage;
  tier: Tier;
  confidence: number;
}): FixOption {
  return {
    ...o,
    score: 0,
    sources: [],
  };
}

/**
 * 让 LLM 出方案 —— **一次调用只要求一件事**。
 *
 * 为什么要拆成两步（2026-10-26 真实 run10 实测）：
 * 原来的单次调用既要"输出 JSON 数组"又要"追加 unified diff 段"，
 * MiniMax-M3 在这种双重约束下会输出英文推理散文（"impossible to only output JSON array…"），
 * extractJson 的 4 级兜底全部失败 → planner 回退到启发式模板
 * → 报告里的"推荐方案"变成了跟本项目毫无关系的通用话术。
 *
 * 拆开后：
 *   第 1 步只要 JSON 数组（字段少、无嵌套、无 diff）→ 解析几乎必成功
 *   第 2 步单独要 unified diff（纯文本，不需要任何 JSON 转义）
 * 两步之间互不影响：patch 失败只是没有 patch，方案本身照样进报告。
 */
async function llmPlan(ctx: KernelContext, bug: BugFinding, stage: Stage): Promise<FixOption[] | null> {
  let options: FixOption[] | null = null;
  try {
    options = await llmPlanOptions(ctx, bug, stage);
  } catch (err) {
    // 失败必须说出来，不能静默回落成"没有方案"
    console.warn(`[sentinel] planner: 方案生成异常 —— ${(err as Error).message}`);
    return null;
  }
  if (!options || options.length === 0) return null;

  // patch 是加分项：失败只影响自动修复，不影响方案本身
  try {
    await attachPatch(ctx, bug, options);
  } catch (err) {
    console.warn(`[sentinel] planner: patch 生成异常（方案保留）—— ${(err as Error).message}`);
  }
  return options;
}

/** 第 1 步：只出 JSON 数组，不要求 patch */
async function llmPlanOptions(ctx: KernelContext, bug: BugFinding, stage: Stage): Promise<FixOption[] | null> {
  const prompt = buildOptionsPrompt(bug, stage);

  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel planner。只输出一个 JSON 数组，不要输出任何解释文字、不要用 markdown 围栏。' },
    { role: 'user', content: prompt },
  ], { timeoutMs: AGENT_LLM_TIMEOUT_MS });
  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  // 兼容：模型若仍按旧协议输出 ===JSON=== 段，照样能切
  const { jsonText, patches } = splitPlannerOutput(resp.content);
  const extracted = extractJson<Array<Omit<FixOption, 'score' | 'sources'>>>(jsonText);
  if (!extracted.ok) {
    console.warn(`[sentinel] planner: 方案 JSON 解析失败 —— ${extracted.reason}`);
    return null;
  }
  const parsed = extracted.value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn('[sentinel] planner: 没有产出可用方案（数组为空或不是数组）');
    return null;
  }
  if (parsed.length < 3) {
    // 方案少不等于没有方案 —— 全丢等于把已经想清楚的部分也扔了。
    console.warn(`[sentinel] planner: 只产出 ${parsed.length} 个方案（期望 3 个）—— 按实际数量保留`);
  }
  return parsed.slice(0, 3).map((p) => {
    const blockPatch = patches.get(p.id);
    const inlinePatch = typeof p.patch === 'string' && p.patch.trim().length > 0 ? p.patch : undefined;
    // patch 优先取 PATCH 段；模型若直接塞进 JSON 也接受
    const finalPatch = blockPatch ?? inlinePatch;
    return {
      ...p,
      score: 0,
      sources: [],
      ...(finalPatch !== undefined ? { patch: finalPatch } : {}),
    };
  });
}

/** 第 2 步：只为最轻量的方案单独要一个 unified diff */
async function attachPatch(ctx: KernelContext, bug: BugFinding, options: FixOption[]): Promise<void> {
  const target = options.find((o) => o.tier === 1 || o.effort === 'low');
  if (!target) return;
  if (typeof target.patch === 'string' && target.patch.trim().length > 0) return; // 已经有 patch

  const prompt = buildPatchPrompt(bug, target);
  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel planner 的补丁生成器。只输出 unified diff，不要任何解释文字。' },
    { role: 'user', content: prompt },
  ], { timeoutMs: AGENT_LLM_TIMEOUT_MS });
  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  const diff = extractDiff(resp.content);
  if (!diff) {
    console.warn('[sentinel] planner: patch 格式不可用（方案保留，patch 留空）');
    return;
  }
  target.patch = diff;
}

/** 方案 prompt —— 极简，只要 JSON 数组 */
function buildOptionsPrompt(bug: BugFinding, stage: Stage): string {
  return `你是 Sentinel 的 Planner。基于下面这个已确认的 bug，给出 3 个修复方案。

bug 标题: ${bug.title}
根因: ${bug.rootCause ?? '(未知)'}
严重级别: ${bug.severity}
影响功能: ${bug.affectedFeature}
症状: ${bug.symptom}
复现步骤: ${(bug.reproSteps ?? []).join(' / ')}
当前阶段: ${stage}
证据:
${bug.evidence.map(formatEvidence).join('\n')}
${fileContext(bug)}

输出一个 JSON 数组，恰好 3 个元素，每个元素字段如下：
{
  "id": "方案唯一 id",
  "title": "方案标题（针对本项目的具体动作）",
  "description": "方案说明（改哪个文件、改什么、为什么能解决这个根因）",
  "effort": "low" | "medium" | "high",
  "risk": "low" | "medium" | "high",
  "runtimeCost": "none" | "low" | "medium" | "high",
  "regressionRisk": "low" | "medium" | "high",
  "maintenanceCost": "none" | "low" | "medium" | "high",
  "stageFit": "Idea" | "MVP" | "Launch" | "Scale",
  "tier": 1 | 2 | 3,
  "confidence": 0 到 1 之间的小数,
  "whyRecommended": "为什么这个方案合适",
  "verificationCommand": "验证命令，例如 npm test 或 curl http://localhost:3000/posts"
}

硬性要求：
- 只输出 JSON 数组本身，第一个字符必须是 [，最后一个字符必须是 ]
- 不要输出解释文字、不要用 markdown 围栏、不要输出 <think> 思考过程
- description 必须点名具体文件（用下面给的代码上下文里的真实路径），不要写"相关代码"这种空话`;
}

/** patch prompt —— 只要 unified diff，纯文本 */
function buildPatchPrompt(bug: BugFinding, option: FixOption): string {
  return `你是 Sentinel 的补丁生成器。针对下面这个 bug 的某个修复方案，生成一个 unified diff 补丁。

bug 根因: ${bug.rootCause ?? '(未知)'}
修复方案: ${option.title} —— ${option.description}
${fileContext(bug)}

输出要求（严格遵守）：
- 只输出 unified diff，不要任何解释文字、不要用 markdown 围栏
- 格式必须是：
--- a/相对路径
+++ b/相对路径
@@ -起始行,行数 +起始行,行数 @@
-被删除的原有行
+新增的行
- 路径必须用下面代码上下文里的真实相对路径
- 补丁要能真实修复上面那个根因，不要改动无关文件
- 如果上下文不足以写出可靠的补丁，就只输出一行：NO_PATCH`;
}

/** 代码上下文（文件证据） */
function fileContext(bug: BugFinding): string {
  const fileEvidence = bug.evidence
    .filter((e): e is Extract<typeof e, { kind: 'file' }> => e.kind === 'file')
    .map((e) => `--- ${e.path}${e.lineRange ? ` (L${e.lineRange[0]}-${e.lineRange[1]})` : ''}\n${e.snippet}`)
    .join('\n\n');
  return fileEvidence ? `\n相关代码文件:\n${fileEvidence}` : '';
}

/** 从模型回复里提取 unified diff（允许前面有说明文字、允许 markdown 围栏） */
export function extractDiff(raw: string): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const fenced = raw.match(/```(?:diff|patch)?\s*\r?\n([\s\S]*?)```/);
  const text = fenced ? fenced[1]! : raw;
  const m = text.match(/---[^\n]*\r?\n\+\+\+[^\n]*\r?\n[\s\S]*/);
  if (!m) return undefined;
  const diff = m[0].trim();
  if (!diff || diff.includes('NO_PATCH')) return undefined;
  return diff;
}


/**
 * 拆 planner 的输出：JSON 段（方案元数据）+ PATCH 段（unified diff 原文）。
 *
 * 为什么要分段：unified diff 放进 JSON 字符串里必然遇到转义问题
 * （换行、引号、反斜杠），实测会让 100% 的方案解析失败。
 * 分段之后 JSON 里只剩纯文本字段，patch 原样保留，不需要任何转义。
 */
export function splitPlannerOutput(raw: string): { jsonText: string; patches: Map<string, string> } {
  const patches = new Map<string, string>();
  const JSON_START = '===JSON===';
  const JSON_END = '===END===';
  const PATCH_RE = /===PATCH\s+([^=\s]+)\s*===\n?([\s\S]*?)(?=\n===END===|$)/g;

  for (const m of raw.matchAll(PATCH_RE)) {
    const id = m[1]!;
    const body = (m[2] ?? '').trim();
    if (body) patches.set(id, body);
  }

  const start = raw.indexOf(JSON_START);
  if (start >= 0) {
    const after = raw.slice(start + JSON_START.length);
    const end = after.indexOf(JSON_END);
    const jsonText = end >= 0 ? after.slice(0, end) : after;
    return { jsonText, patches };
  }

  // 模型没遵守协议 → 退回整段（兼容直接输出 JSON 的情况）
  return { jsonText: raw, patches };
}
