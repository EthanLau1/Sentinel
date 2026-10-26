/**
 * JSON Reporter — 机器可读 / CI 友好。
 */

import type { BugFinding } from '@sentinel/core';

export interface JsonReport {
  generated_at: string;
  project?: string;
  /** 运行模式：offline = 未调用 LLM、未联网（结论只来自确定性规则） */
  llm_mode?: 'llm' | 'offline';
  summary: {
    total: number;
    by_severity: Record<string, number>;
    by_root_cause_status: Record<string, number>;
    /** 按结论来源分：rule = 确定性规则判定，llm = 模型推断 */
    by_origin: Record<string, number>;
  };
  bugs: BugFinding[];
}

export function reportToJson(
  bugs: BugFinding[],
  meta: { project?: string; llmMode?: 'llm' | 'offline' } = {},
): JsonReport {
  const by_severity: Record<string, number> = {};
  const by_root_cause_status: Record<string, number> = {};
  const by_origin: Record<string, number> = {};
  for (const b of bugs) {
    by_severity[b.severity] = (by_severity[b.severity] ?? 0) + 1;
    by_root_cause_status[b.rootCauseStatus] = (by_root_cause_status[b.rootCauseStatus] ?? 0) + 1;
    const origin = b.origin ?? 'llm';
    by_origin[origin] = (by_origin[origin] ?? 0) + 1;
  }

  const out: JsonReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total: bugs.length,
      by_severity,
      by_root_cause_status,
      by_origin,
    },
    bugs,
  };
  if (meta.project) out.project = meta.project;
  if (meta.llmMode) out.llm_mode = meta.llmMode;
  return out;
}
