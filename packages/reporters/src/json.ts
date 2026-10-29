/**
 * JSON Reporter — 机器可读 / CI 友好。
 */

import type { BugFinding } from '@sentinel/core';
import { findTierDecision, type TierDecisionRecord } from './tier.js';
import { coverageIsUninformative, type CoverageInfo } from './coverage.js';
import { classifyBug, type BugVerdict } from './aggregate.js';

export interface JsonReport {
  generated_at: string;
  project?: string;
  /** 运行模式：offline = 未调用 LLM、未联网（结论只来自确定性规则） */
  llm_mode?: 'llm' | 'offline';
  summary: {
    total: number;
    by_severity: Record<string, number>;
    by_root_cause_status: Record<string, number>;
    /** 按结论来源分：rule = 确定性规则判定，llm = 模型推断，heuristic = 模型未参与的启发式结论 */
    by_origin: Record<string, number>;
    /**
     * 按判定口径分：project-defect = 项目真实缺陷；tool-failure = 工具自己坏了；
     * sentinel-invalid-url = Sentinel 自造地址造成的覆盖缺口。
     * CI 只应该对 project-defect 里的 P0/P1 报警。
     */
    by_verdict: Record<string, number>;
  };
  /**
   * 本次覆盖范围。
   *
   * 为什么必须有：`summary.total = 0` 有两种含义（"全测了没问题" vs "没测到任何东西"），
   * JSON 里没有这个字段时，CI 脚本会把后者当成前者 —— 直接放行一个没测过的项目。
   */
  coverage?: CoverageInfo & {
    /** true = 本次结果没有任何信息量（没识别到可测目标 / 一个流程都没跑） */
    uninformative: boolean;
  };
  /**
   * 每条 bug 的 11 字段派生键。
   *
   * 旧版 JSON 只有 summary + bugs，字段 9/10/11（风险评估 / 验证命令 / 是否可自动修）
   * 只藏在 fixOptions 里，机器读不到 —— 这里补成独立键。
   */
  bugs: JsonBug[];
  /** 被 critic 判定证据不足而剔除的假设 —— 机器也要看得见，不能静默丢弃 */
  rejected_findings?: Array<{ bugId: string; reason: string }>;
  /** 因为 critic 没能运行而未经反向验证的 bug id */
  unverified_bug_ids?: string[];
}

/**
 * JSON 里的 bug：在 BugFinding 基础上补 4 个派生键。
 *
 * 四个键**始终存在**，没有方案时写明"没有"，而不是不出现 ——
 * "键缺失"和"确实没有方案"在机器看来是两回事，缺键会被当成旧格式而静默跳过。
 */
export type JsonBug = BugFinding & {
  /** 字段 9：风险评估 */
  risk_assessment: string;
  /** 字段 10：验证命令 */
  verification_command: string;
  /** 字段 11：是否可自动修（0-3）；null = 没有方案，暂不判定 */
  auto_fix_tier: number | null;
  /** 字段 11 的依据（硬规则判出来的，不是模型自报的） */
  tier_reason: string;
  /** 判定口径：这条到底算不算「被测项目的缺陷」 */
  verdict: BugVerdict;
};

export function reportToJson(
  bugs: BugFinding[],
  meta: {
    project?: string;
    llmMode?: 'llm' | 'offline';
    coverage?: CoverageInfo;
    tierDecisions?: TierDecisionRecord[];
    /** 被拒绝的补丁 —— JSON 里也要说清"判成可自动修但实际没改" */
    rejectedPatches?: Array<{ fixId: string; reason: string }>;
    /** 被 critic 判定证据不足而剔除的假设 */
    rejectedFindings?: Array<{ bugId: string; reason: string }>;
    /** 因为 critic 没能运行而未经反向验证的 bug id */
    unverifiedBugIds?: string[];
  } = {},
): JsonReport {
  const by_severity: Record<string, number> = {};
  const by_root_cause_status: Record<string, number> = {};
  const by_origin: Record<string, number> = {};
  const by_verdict: Record<string, number> = {};
  for (const b of bugs) {
    by_severity[b.severity] = (by_severity[b.severity] ?? 0) + 1;
    by_root_cause_status[b.rootCauseStatus] = (by_root_cause_status[b.rootCauseStatus] ?? 0) + 1;
    // 没标 origin = 旧数据，按 'llm' 处理（保持向后兼容）
    const origin = b.origin ?? 'llm';
    by_origin[origin] = (by_origin[origin] ?? 0) + 1;
    const verdict = classifyBug(b);
    by_verdict[verdict] = (by_verdict[verdict] ?? 0) + 1;
  }

  const out: JsonReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total: bugs.length,
      by_severity,
      by_root_cause_status,
      by_origin,
      by_verdict,
    },
    bugs: bugs.map((b) => toJsonBug(b, meta.tierDecisions, meta.rejectedPatches)),
  };
  if (meta.project) out.project = meta.project;
  if (meta.llmMode) out.llm_mode = meta.llmMode;
  if (meta.coverage) {
    out.coverage = { ...meta.coverage, uninformative: coverageIsUninformative(meta.coverage) };
  }
  if (meta.rejectedFindings && meta.rejectedFindings.length > 0) {
    out.rejected_findings = meta.rejectedFindings;
  }
  if (meta.unverifiedBugIds && meta.unverifiedBugIds.length > 0) {
    out.unverified_bug_ids = meta.unverifiedBugIds;
  }
  return out;
}

/** 把 recommended 方案 + 硬规则 tier 判定落成 4 个独立字段 */
function toJsonBug(
  bug: BugFinding,
  tierDecisions?: TierDecisionRecord[],
  rejectedPatches?: Array<{ fixId: string; reason: string }>,
): JsonBug {
  const options = bug.fixOptions ?? [];
  // recommendedFixId 可能指向一个**不存在**的方案（合并 bug 时会留下悬空 id）——
  // 那时必须改用真实存在的第一条，否则"推荐方案"和"是否可自动修"各说各的。
  const recommended =
    options.find((o) => o.id === bug.recommendedFixId) ?? options[0];

  if (!recommended) {
    // 没有方案：四个键仍然写出来，明说"没有" —— 不能假装字段不存在
    return {
      ...bug,
      risk_assessment: '(无修复方案，暂无评估)',
      verification_command: '(无)',
      auto_fix_tier: null,
      tier_reason: '(无修复方案，暂不判定)',
      verdict: classifyBug(bug),
    };
  }

  const decision = findTierDecision(tierDecisions, recommended.id);
  const tier = decision?.tier ?? recommended.tier;
  const rejection = rejectedPatches?.find((r) => r.fixId === recommended.id);
  return {
    ...bug,
    // recommendedFixId 必须与实际采用的方案一致
    recommendedFixId: recommended.id,
    risk_assessment: `effort=${recommended.effort}, risk=${recommended.risk}, regressionRisk=${recommended.regressionRisk}`,
    verification_command: recommended.verificationCommand ?? bug.verificationCommand ?? '(无)',
    auto_fix_tier: tier,
    tier_reason: decision?.reason ?? '(无硬规则判定记录)',
    verdict: classifyBug(bug),
    // 判成"可自动修"但实际没改 —— 必须同时写进 JSON
    ...(rejection
      ? { tier_reason: `${decision?.reason ?? '(无硬规则判定记录)'}；⚠ 实际未修改：${rejection.reason}` }
      : {}),
  };
}
