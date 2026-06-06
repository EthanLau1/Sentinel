/**
 * JSON Reporter — 机器可读 / CI 友好。
 */

import type { BugFinding } from '@sentinel/core';

export interface JsonReport {
  generated_at: string;
  project?: string;
  summary: {
    total: number;
    by_severity: Record<string, number>;
    by_root_cause_status: Record<string, number>;
  };
  bugs: BugFinding[];
}

export function reportToJson(bugs: BugFinding[], meta: { project?: string } = {}): JsonReport {
  const by_severity: Record<string, number> = {};
  const by_root_cause_status: Record<string, number> = {};
  for (const b of bugs) {
    by_severity[b.severity] = (by_severity[b.severity] ?? 0) + 1;
    by_root_cause_status[b.rootCauseStatus] = (by_root_cause_status[b.rootCauseStatus] ?? 0) + 1;
  }

  const out: JsonReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total: bugs.length,
      by_severity,
      by_root_cause_status,
    },
    bugs,
  };
  if (meta.project) out.project = meta.project;
  return out;
}
