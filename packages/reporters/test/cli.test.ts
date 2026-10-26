import { describe, it, expect } from 'vitest';
import { printBug, printSummary, color } from '../src/cli.js';
import type { BugFinding, FixOption } from '@sentinel/core';

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
    confidence: 0.555,
    fixOptions: [],
    ...over,
  } as BugFinding;
}

function makeOption(over: Partial<FixOption> = {}): FixOption {
  return {
    id: 'fix_1',
    title: '改成非空渲染',
    description: 'd',
    patch: '',
    tier: 1,
    score: 0.8,
    sources: [],
    ...over,
  } as FixOption;
}

describe('CLI reporter', () => {
  it('打印标题、id、置信度、状态', () => {
    const out = printBug(makeBug());
    expect(out).toContain('页面超时');
    expect(out).toContain('bug_1');
    expect(out).toContain('flow_page_0');
    expect(out).toContain('conf=0.56');
    expect(out).toContain('hypothesis');
  });

  it('有 rootCause 时显示根因行', () => {
    const out = printBug(makeBug({ rootCause: '组件返回 null' }));
    expect(out).toContain('根因');
    expect(out).toContain('组件返回 null');
  });

  it('无 rootCause 时不出现根因行（不能显示空行冒充有根因）', () => {
    const out = printBug(makeBug());
    expect(out).not.toContain('根因');
  });

  it('Evidence 数量与类型被列出', () => {
    const out = printBug(
      makeBug({
        evidence: [
          { kind: 'console', source: 'browser', hash: 'h1' },
          { kind: 'file', source: 'fs', hash: 'h2' },
        ] as BugFinding['evidence'],
      }),
    );
    expect(out).toContain('2 条');
    expect(out).toContain('console');
    expect(out).toContain('file');
  });

  it('有 fixOptions 时显示推荐项与 Tier', () => {
    const out = printBug(
      makeBug({ fixOptions: [makeOption({ id: 'fix_1' })], recommendedFixId: 'fix_1' }),
    );
    expect(out).toContain('★ 推荐');
    expect(out).toContain('Tier 1');
    expect(out).toContain('score=0.80');
  });

  it('recommendedFixId 指向不存在的选项 → 退回第一个，不崩', () => {
    const out = printBug(
      makeBug({ fixOptions: [makeOption({ id: 'fix_1' })], recommendedFixId: 'nope' }),
    );
    expect(out).toContain('★ 推荐');
    expect(out).toContain('改成非空渲染');
  });

  it('fixOptions 为空 → 不显示推荐行', () => {
    const out = printBug(makeBug());
    expect(out).not.toContain('★ 推荐');
  });

  it('Tier 2 / Tier 3 走不同颜色分支（输出都含 Tier N）', () => {
    for (const tier of [1, 2, 3] as const) {
      const out = printBug(
        makeBug({ fixOptions: [makeOption({ tier })], recommendedFixId: 'fix_1' }),
      );
      expect(out).toContain(`Tier ${tier}`);
    }
  });

  it('printSummary 统计各严重级别', () => {
    const out = printSummary([
      makeBug({ severity: 'P0' }),
      makeBug({ severity: 'P1' }),
      makeBug({ severity: 'P1' }),
    ]);
    expect(out).toContain('Total: 3');
    expect(out).toContain('P0: 1');
    expect(out).toContain('P1: 2');
    expect(out).toContain('P2: 0');
    expect(out).toContain('P3: 0');
  });

  it('printSummary 空数组不崩', () => {
    expect(printSummary([])).toContain('Total: 0');
  });

  it('color 包裹 ANSI 序列', () => {
    expect(color.red('x')).toContain('\x1b[31m');
    expect(color.red('x')).toContain('x');
  });
});
