import { describe, it, expect } from 'vitest';
import { reportToJson } from '../src/json.js';
import type { BugFinding } from '@sentinel/core';

function makeBug(over: Partial<BugFinding> = {}): BugFinding {
  return {
    id: 'bug_1',
    title: '页面超时',
    severity: 'P1',
    source: 'ui',
    affectedFeature: 'flow_page_0',
    symptom: 'Timeout 5000ms',
    reproSteps: ['打开页面'],
    evidence: [],
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.55,
    fixOptions: [],
    ...over,
  } as BugFinding;
}

describe('JSON reporter', () => {
  it('空数组 → total=0，两个统计表为空', () => {
    const out = reportToJson([]);
    expect(out.summary.total).toBe(0);
    expect(out.summary.by_severity).toEqual({});
    expect(out.summary.by_root_cause_status).toEqual({});
    expect(out.bugs).toEqual([]);
  });

  it('按 severity 与 rootCauseStatus 分别计数', () => {
    const out = reportToJson([
      makeBug({ id: 'a', severity: 'P0', rootCauseStatus: 'confirmed' }),
      makeBug({ id: 'b', severity: 'P1', rootCauseStatus: 'hypothesis' }),
      makeBug({ id: 'c', severity: 'P1', rootCauseStatus: 'hypothesis' }),
    ]);
    expect(out.summary.total).toBe(3);
    expect(out.summary.by_severity).toEqual({ P0: 1, P1: 2 });
    expect(out.summary.by_root_cause_status).toEqual({ confirmed: 1, hypothesis: 2 });
  });

  it('带 project 元信息', () => {
    const out = reportToJson([makeBug()], { project: 'demo' });
    expect(out.project).toBe('demo');
  });

  it('不传 project → 不出现 project 字段（不能是 undefined 键）', () => {
    const out = reportToJson([makeBug()]);
    expect('project' in out).toBe(false);
  });

  it('generated_at 是合法 ISO 时间', () => {
    const out = reportToJson([]);
    expect(Number.isNaN(Date.parse(out.generated_at))).toBe(false);
  });

  it('bug 内容原样保留（含 rootCause）', () => {
    const out = reportToJson([
      makeBug({ rootCause: '组件返回 null', rootCauseStatus: 'confirmed' }),
    ]);
    expect(out.bugs[0]!.rootCause).toBe('组件返回 null');
    expect(out.bugs[0]!.rootCauseStatus).toBe('confirmed');
  });
});
