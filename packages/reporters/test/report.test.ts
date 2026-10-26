import { describe, it, expect } from 'vitest';
import type { BugFinding, Evidence, FixOption } from '@sentinel/core';
import { bugToMarkdown, reportToMarkdown, aggregateDuplicateBugs, isToolFailure, mergeBugFinding, createBugCollector, applyTierDecisions } from '../src/index.js';

function evidence(kind: 'console' | 'http', message: string): Evidence {
  if (kind === 'console') {
    return { kind: 'console', source: 'browser', hash: 'h1', timestamp: 1, level: 'error', message };
  }
  return { kind: 'http', source: 'api', hash: 'h2', timestamp: 1, url: 'http://x/api', method: 'GET', status: 500 };
}

function makeBug(over: Partial<BugFinding> = {}): BugFinding {
  return {
    id: 'bug_1',
    title: '页面渲染为空',
    severity: 'P1',
    source: 'ui',
    affectedFeature: 'flow_page_0',
    symptom: 'waitFor: Timeout 5000ms exceeded',
    reproSteps: ['访问 /posts'],
    evidence: [evidence('console', 'waitFor: Timeout 5000ms exceeded')],
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.55,
    fixOptions: [],
    ...over,
  };
}

const FIX_OPTION: FixOption = {
  id: 'fix_1',
  title: '修复渲染',
  description: '让页面返回内容',
  effort: 'low',
  risk: 'low',
  regressionRisk: 'medium',
  runtimeCost: 'none',
  maintenanceCost: 'low',
  score: 0.8,
  tier: 1,
  sources: [],
  whyRecommended: '最小改动',
};

const FIELDS = [
  '1. Bug ID',
  '2. 严重级别',
  '3. 影响功能',
  '4. 复现步骤',
  '5. Evidence',
  '6. 根因判断',
  '7. 推荐方案',
  '8.备选方案'.replace('8.备选方案', '8. 备选方案'),
  '9. 风险评估',
  '10. 验证命令',
  '11. 是否可自动修',
];

describe('markdown reporter', () => {
  it('无修复方案时仍输出全部 11 个字段（宪法要求缺一不行）', () => {
    const md = bugToMarkdown(makeBug());
    for (const field of FIELDS) {
      expect(md, `缺少字段 ${field}`).toContain(field);
    }
  });

  it('有修复方案时同样输出全部 11 个字段', () => {
    const md = bugToMarkdown(makeBug({ fixOptions: [FIX_OPTION], recommendedFixId: 'fix_1' }));
    for (const field of FIELDS) {
      expect(md, `缺少字段 ${field}`).toContain(field);
    }
    expect(md).toContain('修复渲染');
  });

  it('hypothesis 且无根因时，根因行说明是证据不足而不是看起来像根因', () => {
    const md = bugToMarkdown(makeBug());
    expect(md).toContain('证据不足');
    expect(md).not.toContain('(insufficient evidence)');
  });
});

describe('报告聚合', () => {
  it('同源问题合并为一条并标注数量', () => {
    const bugs = [
      makeBug({ id: 'a' }),
      makeBug({ id: 'b' }),
      makeBug({ id: 'c' }),
      makeBug({ id: 'd', symptom: '另一个完全不同的问题' }),
    ];
    const merged = aggregateDuplicateBugs(bugs);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.title).toContain('同类 3 条已合并');
    expect(merged[0]!.symptom).toContain('已合并 2 条同源问题');
  });

  it('报告正文里出现合并标记', () => {
    const md = reportToMarkdown(aggregateDuplicateBugs([makeBug({ id: 'a' }), makeBug({ id: 'b' })]));
    expect(md).toContain('同类 2 条已合并');
  });
});

describe('工具性失败识别', () => {
  it('Sentinel 自身链路故障被标为工具性失败', () => {
    const bug = makeBug({
      symptom: 'goto: Protocol error (Page.navigate): Cannot navigate to invalid URL',
      evidence: [evidence('console', 'Cannot navigate to invalid URL')],
    });
    expect(isToolFailure(bug)).toBe(true);
    expect(bugToMarkdown(bug)).toContain('工具性失败');
  });

  it('普通项目缺陷不被误标', () => {
    expect(isToolFailure(makeBug())).toBe(false);
  });
});

describe('同一 bug 的多版本合并（报告层）', () => {
  const FIX: FixOption = {
    id: 'fx1', title: '快速修复', description: 'd',
    effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none',
    stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
  };

  it('后到的空 fixOptions 不会抹掉先到的方案', () => {
    // bus 顺序分发：深层（planner→enhancer→fix.enhanced）先到，浅层（bug.confirmed）后到
    const enriched = makeBug({ id: 'b1', fixOptions: [FIX], recommendedFixId: 'fx1' });
    const shallow = makeBug({ id: 'b1', fixOptions: [] });
    const merged = mergeBugFinding(enriched, shallow);
    expect(merged.fixOptions).toHaveLength(1);
    expect(merged.recommendedFixId).toBe('fx1');
  });

  it('后到的非空 fixOptions 正常覆盖', () => {
    const shallow = makeBug({ id: 'b1', fixOptions: [] });
    const enriched = makeBug({ id: 'b1', fixOptions: [FIX], recommendedFixId: 'fx1' });
    const merged = mergeBugFinding(shallow, enriched);
    expect(merged.fixOptions).toHaveLength(1);
  });

  it('没有旧版本时直接返回新版本', () => {
    const next = makeBug({ id: 'b1' });
    expect(mergeBugFinding(undefined, next)).toBe(next);
  });
});

describe('报告收集器（真实代码路径）', () => {
  const FIX: FixOption = {
    id: 'fx1', title: '快速修复', description: 'd',
    effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none',
    stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
  };

  it('深层事件先到、浅层事件后到时，方案不被空值覆盖', () => {
    const c = createBugCollector();
    // 真实顺序：fix.enhanced（planner 出的方案）先到
    c.onEnhanced(makeBug({ id: 'b1', fixOptions: [FIX], recommendedFixId: 'fx1' }));
    // 随后 critic 的原始 bug.confirmed 到达，fixOptions 是空数组
    c.onConfirmed(makeBug({ id: 'b1', fixOptions: [] }));
    expect(c.bugs).toHaveLength(1);
    expect(c.bugs[0]!.fixOptions).toHaveLength(1);
    expect(c.bugs[0]!.recommendedFixId).toBe('fx1');
  });

  it('反过来（浅层先到、深层后到）同样保住方案', () => {
    const c = createBugCollector();
    c.onConfirmed(makeBug({ id: 'b1', fixOptions: [] }));
    c.onEnhanced(makeBug({ id: 'b1', fixOptions: [FIX], recommendedFixId: 'fx1' }));
    expect(c.bugs[0]!.fixOptions).toHaveLength(1);
  });

  it('草稿不覆盖已确认的同 id bug', () => {
    const c = createBugCollector();
    c.onConfirmed(makeBug({ id: 'b1', rootCauseStatus: 'confirmed', rootCause: 'r' }));
    c.onDraft(makeBug({ id: 'b1', rootCauseStatus: 'hypothesis' }));
    expect(c.bugs).toHaveLength(1);
    expect(c.bugs[0]!.rootCauseStatus).toBe('confirmed');
  });

  it('记录被诊断覆盖的 flow', () => {
    const c = createBugCollector();
    c.onConfirmed(makeBug({ id: 'b1', affectedFeature: 'flow_page_0' }));
    expect(c.coveredFlows.has('flow_page_0')).toBe(true);
  });
});

describe('Tier 判定用硬规则的结果，而不是 LLM 自报的', () => {
  const FIX: FixOption = {
    id: 'fix1', title: '把 postList 改成 posts', description: '变量名拼写错误',
    effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none',
    stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
  };

  function bugWithTier(tier: number): BugFinding {
    return makeBug({ id: 'b1', rootCauseStatus: 'confirmed', fixOptions: [{ ...FIX, tier: tier as FixOption['tier'] }], recommendedFixId: 'fix1' });
  }

  it('硬规则判成 Tier 2 时，报告里显示 Tier 2 而不是 LLM 说的 Tier 1', () => {
    const bugs = applyTierDecisions([bugWithTier(1)], [
      { fixId: 'fix1', tier: 2, reason: '未命中任何低风险规则（LLM 原判 Tier 1）→ 降级为需人工确认', llmTier: 1 },
    ]);
    expect(bugs[0]!.fixOptions[0]!.tier).toBe(2);
    const md = reportToMarkdown(bugs, {}, { tierDecisions: [
      { fixId: 'fix1', tier: 2, reason: '未命中任何低风险规则 → 降级为需人工确认', llmTier: 1 },
    ] });
    expect(md).toContain('Tier 2');
    expect(md).toContain('未命中任何低风险规则');
    // LLM 原判与硬规则不一致时，这个差异本身要写出来
    expect(md).toContain('LLM 原判 Tier 1');
  });

  it('没有硬规则判定时，报告保持 LLM 的 tier（不凭空改）', () => {
    const md = reportToMarkdown([bugWithTier(1)]);
    expect(md).toContain('Tier 1');
  });

  it('离线模式不说"LLM 原判" —— 离线时方案来自模板，不是模型', () => {
    const bugs = applyTierDecisions([bugWithTier(1)], [
      { fixId: 'fix1', tier: 2, reason: '未命中任何低风险规则（方案模板 原判 Tier 1）→ 降级为需人工确认', llmTier: 1 },
    ]);
    const md = reportToMarkdown(
      bugs,
      { llmMode: 'offline' },
      { llmMode: 'offline', tierDecisions: [
        { fixId: 'fix1', tier: 2, reason: '未命中任何低风险规则（方案模板 原判 Tier 1）→ 降级为需人工确认', llmTier: 1 },
      ] },
    );
    expect(md).toContain('方案模板 原判 Tier 1');
    expect(md).not.toContain('LLM 原判');
  });

  it('applyTierDecisions 只改匹配的 fixId', () => {
    const bugs = applyTierDecisions([bugWithTier(1)], [{ fixId: 'other', tier: 3, reason: 'x' }]);
    expect(bugs[0]!.fixOptions[0]!.tier).toBe(1);
  });

  it('空判定列表时原样返回', () => {
    const input = [bugWithTier(1)];
    expect(applyTierDecisions(input, [])).toBe(input);
  });
});
