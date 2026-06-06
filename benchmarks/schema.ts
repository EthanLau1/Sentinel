/**
 * Benchmark case schema — 真实案例归档格式。
 * 红线 6：每个真实案例必须按此 schema 写入 benchmarks/cases/。
 */

import type { BugFinding, FixOption } from '@sentinel/core';

export interface BenchmarkCase {
  /** ISO 日期 + sequence */
  id: string;
  project: string;
  feature: string;
  stage: 'Idea' | 'MVP' | 'Launch' | 'Scale';
  symptom: string;
  /** 人工确认的真实根因 */
  realRootCause: string;

  /** Sentinel 当时的判断 */
  sentinelJudgment: {
    rootCauseStatus: BugFinding['rootCauseStatus'];
    rootCause?: string;
    confidence: number;
    evidenceCount: number;
    evidenceKinds: string[];
  };

  /** 是否命中真实根因（人工标注） */
  hit: boolean;

  /** 推荐的修复方案 */
  recommendedFix: Pick<FixOption, 'id' | 'title' | 'tier' | 'effort' | 'risk' | 'score'>;

  /** 用户是否采纳了推荐方案 */
  fixAdopted: boolean;

  /** 修复后是否通过验证 */
  fixPassedVerification: boolean;

  notes?: string;
  createdAt: string;
  sentinelVersion: string;
}

export function validateCase(c: unknown): c is BenchmarkCase {
  if (!c || typeof c !== 'object') return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['project'] === 'string' &&
    typeof r['feature'] === 'string' &&
    typeof r['symptom'] === 'string' &&
    typeof r['realRootCause'] === 'string' &&
    typeof r['hit'] === 'boolean' &&
    typeof r['fixAdopted'] === 'boolean' &&
    typeof r['fixPassedVerification'] === 'boolean'
  );
}
