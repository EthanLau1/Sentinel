/**
 * run 过程事件的收集器 —— 把"过程中发生了什么"变成可查的字段。
 *
 * 为什么单独成文件：这些信息（硬规则 tier 判定、落盘待审的 patch、被拒的补丁、
 * 建好的 PR、预算超限、证据采集失败）之前**根本没有出口** ——
 * 事件发出去了，却没有任何订阅者，载荷直接进黑洞。
 * 后果很具体：报告显示"Tier 1 — 自动修"，实际什么都没改，用户查不到原因。
 *
 * 单独成文件的另一个理由：这段逻辑必须能被**真实代码路径的测试**直接覆盖。
 * 藏在 run.ts 的闭包里，测试只能绕开它测别的函数，于是"过程信息没有出口"
 * 这个缺陷会躲过所有测试。
 */

import type { TierDecisionRecord } from '@sentinel/reporters';

export interface GeneratedPatch {
  fixId: string;
  files: string[];
  approvalRequired: boolean;
}

export interface RejectedPatch {
  fixId: string;
  reason: string;
}

export interface CreatedPr {
  fixId: string;
  title: string;
  dryRun: boolean;
}

export interface BudgetExceededInfo {
  kind: string;
  limit: number;
}

export interface EvidenceFailure {
  error: string;
  kind: string;
}

export interface StatusEventCollector {
  readonly tierDecisions: TierDecisionRecord[];
  readonly generatedPatches: GeneratedPatch[];
  readonly rejectedPatches: RejectedPatch[];
  readonly createdPrs: CreatedPr[];
  readonly budgetExceeded: BudgetExceededInfo[];
  readonly evidenceFailures: EvidenceFailure[];
  onTierDecided(payload: { fixId: string; tier: 0 | 1 | 2 | 3; reason: string; llmTier?: number }): void;
  onPatchGenerated(payload: { fixId: string; files: string[]; applied: boolean; approvalRequired: boolean }): void;
  onPatchRejected(payload: { fixId: string; reason: string }): void;
  onPrCreated(payload: { fixId: string; title: string; dryRun: boolean }): void;
  onBudgetExceeded(payload: { kind: string; limit: number }): void;
  onEvidenceFailed(payload: { error: string; kind: string }): void;
}

export function createStatusEventCollector(): StatusEventCollector {
  const tierDecisions: TierDecisionRecord[] = [];
  const generatedPatches: GeneratedPatch[] = [];
  const rejectedPatches: RejectedPatch[] = [];
  const createdPrs: CreatedPr[] = [];
  const budgetExceeded: BudgetExceededInfo[] = [];
  const evidenceFailures: EvidenceFailure[] = [];

  return {
    tierDecisions,
    generatedPatches,
    rejectedPatches,
    createdPrs,
    budgetExceeded,
    evidenceFailures,
    onTierDecided(payload) {
      tierDecisions.push({
        fixId: payload.fixId,
        tier: payload.tier,
        reason: payload.reason,
        ...(payload.llmTier !== undefined ? { llmTier: payload.llmTier } : {}),
      });
    },
    onPatchGenerated(payload) {
      generatedPatches.push({
        fixId: payload.fixId,
        files: payload.files,
        approvalRequired: payload.approvalRequired,
      });
    },
    onPatchRejected(payload) {
      rejectedPatches.push({ fixId: payload.fixId, reason: payload.reason });
    },
    onPrCreated(payload) {
      createdPrs.push({ fixId: payload.fixId, title: payload.title, dryRun: payload.dryRun });
    },
    onBudgetExceeded(payload) {
      budgetExceeded.push({ kind: payload.kind, limit: payload.limit });
    },
    onEvidenceFailed(payload) {
      evidenceFailures.push({ error: payload.error, kind: payload.kind });
    },
  };
}
