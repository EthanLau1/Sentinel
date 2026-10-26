/**
 * Tier 判定结果的回写与展示。
 *
 * 为什么需要这一层：报告第 11 字段原本直接用 **LLM 给的** `fixOption.tier`，
 * 但真正决定"要不要改代码"的是 **executor 的硬规则**（`classifyTier`）。
 * 两者不一致时，报告会写"Tier 1 — 自动修"而实际什么都没改，
 * 用户既不知道为什么，也查不到判定依据 —— 硬规则的 `executor.tier_decided` 事件
 * 当时没有任何消费者（死事件），判定结果被静默丢弃。
 *
 * 所以：报告必须展示**硬规则判出来的那个 tier**，并附上判定理由。
 * 本模块不改 core 的类型（core 是宪法红线），只覆盖 FixOption 里已存在的 `tier` 字段。
 */

import type { BugFinding, Tier } from '@sentinel/core';

/** executor 的硬规则判定结果（对应 `executor.tier_decided` 事件） */
export interface TierDecisionRecord {
  fixId: string;
  /** 硬规则判定的最终 tier（0=只报告 1=自动修 2=写 patch 待审 3=仅建议） */
  tier: Tier;
  /** 判定理由（人话） */
  reason: string;
  /** LLM 原本给的 tier —— 与硬规则不一致时，这个差异本身就是信息 */
  llmTier?: number;
}

/** 把硬规则的 tier 判定回写到对应方案的 tier 上（按 fixId 匹配） */
export function applyTierDecisions(bugs: BugFinding[], decisions: TierDecisionRecord[]): BugFinding[] {
  if (decisions.length === 0) return bugs;
  const byFixId = new Map(decisions.map((d) => [d.fixId, d]));
  return bugs.map((bug) => {
    if (!bug.fixOptions || bug.fixOptions.length === 0) return bug;
    let touched = false;
    const fixOptions = bug.fixOptions.map((o) => {
      const d = byFixId.get(o.id);
      if (!d) return o;
      touched = true;
      return { ...o, tier: d.tier };
    });
    return touched ? { ...bug, fixOptions } : bug;
  });
}

/** 查某个方案的硬规则判定（报告渲染时用） */
export function findTierDecision(
  decisions: TierDecisionRecord[] | undefined,
  fixId: string | undefined,
): TierDecisionRecord | undefined {
  if (!decisions || !fixId) return undefined;
  return decisions.find((d) => d.fixId === fixId);
}
