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

export interface PlannerConfig {
  stage?: Stage;
  weights?: CostWeights;
}

export function createPlanner(config: PlannerConfig = {}): Subagent {
  const stage = config.stage ?? 'MVP';
  const weights = config.weights ?? PRESETS[stage.toLowerCase() as keyof typeof PRESETS] ?? DEFAULT_WEIGHTS;

  return {
    name: 'planner',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<BugFinding>('bug.confirmed', async (event) => {
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
            },
            weights,
          );
          return { ...o, score };
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

async function llmPlan(ctx: KernelContext, bug: BugFinding, stage: Stage): Promise<FixOption[] | null> {
  const evSummary = bug.evidence.map((e) => `[${e.kind}] ${e.hash}`).join('\n');

  // 收集相关文件 evidence 用于生成 patch
  const fileEvidence = bug.evidence
    .filter((e): e is Extract<typeof e, { kind: 'file' }> => e.kind === 'file')
    .map((e) => `--- ${e.path}${e.lineRange ? ` (L${e.lineRange[0]}-${e.lineRange[1]})` : ''}\n${e.snippet}`)
    .join('\n\n');

  const codeContext = fileEvidence
    ? `\n\n相关代码文件:\n${fileEvidence}`
    : '';

  const prompt = `你是 Sentinel 的 Planner 子代理。基于已 confirmed 的 bug，生成 3 个 FixOption。

Bug:
  title: ${bug.title}
  rootCause: ${bug.rootCause ?? '(unknown)'}
  severity: ${bug.severity}
  confidence: ${bug.confidence}
  symptom: ${bug.symptom}
  affected: ${bug.affectedFeature}
  当前 stage: ${stage}
Evidence:
${evSummary}${codeContext}

请输出 JSON 数组，正好 3 个 FixOption，按 effort 从低到高：
[
  {
    "id": "${bug.id}_fix_1",
    "title": "...",
    "description": "...",
    "effort": "low" | "medium" | "high",
    "risk": "low" | "medium" | "high",
    "runtimeCost": "none" | "low" | "medium" | "high",
    "regressionRisk": "low" | "medium" | "high",
    "maintenanceCost": "none" | "low" | "medium" | "high",
    "stageFit": "Idea" | "MVP" | "Launch" | "Scale",
    "tier": 0 | 1 | 2 | 3,
    "confidence": 0-1,
    "whyRecommended": "...",
    "patch": "unified diff 格式的代码修复补丁 (可选，Tier 1/2 必须提供)",
    "verificationCommand": "验证修复的命令 (如 npm test 或 curl ...)"
  },
  { ... 第 2 个 ...},
  { ... 第 3 个 ...}
]

红线：
- 第 1 个 effort=low/Tier=1（快速修复）— 必须提供 patch 字段（unified diff 格式）
- 第 2 个 effort=medium/Tier=2（标准修复）— 必须提供 patch 字段
- 第 3 个 effort=high/Tier=3（长期重构）— patch 可选，建议为主
- patch 格式示例:
  --- a/src/app/page.tsx
  +++ b/src/app/page.tsx
  @@ -10,3 +10,5 @@
   existing line
  -old broken line
  +new fixed line
  +added line
- 如果代码上下文不足无法生成 patch，patch 字段设为 null
- 不要包含 JSON 以外的任何文字`;

  const resp = await ctx.providers.llm.chat([
    { role: 'system', content: '你是 Sentinel planner。只输出 JSON 数组。生成的 patch 必须是有效的 unified diff 格式。' },
    { role: 'user', content: prompt },
  ]);
  ctx.budget.consume(resp.usage.totalTokens, resp.costUsd);

  const cleaned = resp.content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim();

  const parsed = JSON.parse(cleaned) as Array<Omit<FixOption, 'score' | 'sources'>>;
  if (!Array.isArray(parsed) || parsed.length < 3) return null;
  return parsed.slice(0, 3).map((p) => ({
    ...p,
    score: 0,
    sources: [],
    // Ensure patch is string or omitted entirely
    ...(typeof p.patch === 'string' && p.patch.trim().length > 0 ? { patch: p.patch } : {}),
  }));
}
