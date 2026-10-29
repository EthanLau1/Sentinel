import { describe, it, expect } from 'vitest';
import type { BugFinding } from '@sentinel/core';
import { createBugCollector } from '../src/index.js';

function draft(over: Partial<BugFinding> = {}): BugFinding {
  return {
    id: 'bug_1',
    title: '首页白屏',
    severity: 'P1',
    source: 'ui',
    affectedFeature: 'flow_home',
    symptom: 'body 为空',
    reproSteps: ['访问 /'],
    evidence: [
      { kind: 'console', source: 'browser', hash: 'h1', timestamp: 1, level: 'error', message: 'boom' },
    ],
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.6,
    fixOptions: [],
    ...over,
  };
}

describe('bug.rejected 必须真的拦截草稿', () => {
  it('拒绝先到、草稿后到 —— 草稿仍然不能进发现列表', () => {
    // bus 是顺序 await 分发：critic 的处理函数比收集器先跑，
    // 所以「拒绝」事件很可能先于「草稿」到达收集器。
    const c = createBugCollector();
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    c.onDraft(draft());
    expect(c.bugs).toHaveLength(0);
    expect(c.rejected).toHaveLength(1);
    expect(c.rejected[0]?.kind).toBe('insufficient-evidence');
  });

  it('草稿先到、拒绝后到 —— 草稿被剔除', () => {
    const c = createBugCollector();
    c.onDraft(draft());
    expect(c.bugs).toHaveLength(1);
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    expect(c.bugs).toHaveLength(0);
  });

  it('被剔除的草稿对应的 flow 不再算「已被诊断覆盖」', () => {
    const c = createBugCollector();
    c.onDraft(draft());
    expect(c.coveredFlows.has('flow_home')).toBe(true);
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    expect(c.coveredFlows.has('flow_home')).toBe(false);
  });

  it('还有别的诊断覆盖同一个 flow 时，flow 仍算已覆盖', () => {
    const c = createBugCollector();
    c.onDraft(draft());
    c.onDraft(draft({ id: 'bug_2' }));
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    expect(c.bugs.map((b) => b.id)).toEqual(['bug_2']);
    expect(c.coveredFlows.has('flow_home')).toBe(true);
  });

  it('critic 自己没跑起来（unavailable）→ 结论必须保留', () => {
    const c = createBugCollector();
    c.onDraft(draft());
    c.onRejected('bug_1', 'critic verification unavailable', 'unavailable');
    expect(c.bugs).toHaveLength(1);
    expect(c.rejected[0]?.kind).toBe('unavailable');
  });

  it('被确认的诊断不受拒绝影响', () => {
    const c = createBugCollector();
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    c.onConfirmed(draft({ rootCauseStatus: 'confirmed', rootCause: '组件抛错' }));
    expect(c.bugs).toHaveLength(1);
  });

  it('后来被确认的结论不再出现在「被拒绝」清单里（不能自相矛盾）', () => {
    const c = createBugCollector();
    c.onRejected('bug_1', '证据不足', 'insufficient-evidence');
    expect(c.rejected).toHaveLength(1);
    c.onConfirmed(draft({ rootCauseStatus: 'confirmed', rootCause: '组件抛错' }));
    expect(c.rejected).toHaveLength(0);
    expect(c.bugs).toHaveLength(1);
  });
});
