import { describe, it, expect } from 'vitest';
import { createStatusEventCollector } from '../src/status-events.js';

/**
 * 过程事件的收集器 —— 之前这些事件发出后没有任何订阅者，载荷直接进黑洞。
 * 后果：报告显示"Tier 1 — 自动修"，实际什么都没改，用户查不到原因。
 */
describe('run 过程事件收集器', () => {
  it('硬规则 tier 判定被记录（含理由与 LLM 原判）', () => {
    const c = createStatusEventCollector();
    c.onTierDecided({ fixId: 'fix1', tier: 2, reason: '未命中任何低风险规则 → 降级为需人工确认', llmTier: 1 });
    expect(c.tierDecisions).toHaveLength(1);
    expect(c.tierDecisions[0]!.tier).toBe(2);
    expect(c.tierDecisions[0]!.reason).toContain('未命中');
    expect(c.tierDecisions[0]!.llmTier).toBe(1);
  });

  it('没有 llmTier 时不写入该字段（不是 undefined）', () => {
    const c = createStatusEventCollector();
    c.onTierDecided({ fixId: 'fix1', tier: 1, reason: '命中低风险规则' });
    expect('llmTier' in c.tierDecisions[0]!).toBe(false);
  });

  it('落盘待审的 patch 被记录（含文件与是否需要审批）', () => {
    const c = createStatusEventCollector();
    c.onPatchGenerated({ fixId: 'fix1', files: ['app/page.tsx'], applied: false, approvalRequired: true });
    expect(c.generatedPatches).toHaveLength(1);
    expect(c.generatedPatches[0]!.files).toEqual(['app/page.tsx']);
    expect(c.generatedPatches[0]!.approvalRequired).toBe(true);
  });

  it('被拒的补丁保留原因', () => {
    const c = createStatusEventCollector();
    c.onPatchRejected({ fixId: 'fix1', reason: '文件类型 .py 不在自动修改白名单内' });
    expect(c.rejectedPatches[0]!.reason).toContain('白名单');
  });

  it('PR 记录地址与分支', () => {
    const c = createStatusEventCollector();
    c.onPrCreated({ fixId: 'fix1', title: 't', url: 'https://github.com/o/r/pull/7', branch: 'sentinel/fix-fix1' });
    expect(c.createdPrs[0]!.url).toBe('https://github.com/o/r/pull/7');
    expect(c.createdPrs[0]!.branch).toBe('sentinel/fix-fix1');
  });

  it('预算超限记录是哪一项、上限是多少', () => {
    const c = createStatusEventCollector();
    c.onBudgetExceeded({ kind: 'usd', limit: 0.5 });
    expect(c.budgetExceeded[0]).toEqual({ kind: 'usd', limit: 0.5 });
  });

  it('证据采集失败被记录', () => {
    const c = createStatusEventCollector();
    c.onEvidenceFailed({ error: 'timeout', kind: 'screenshot' });
    expect(c.evidenceFailures[0]!.error).toBe('timeout');
  });

  it('不同类型的记录互不串场', () => {
    const c = createStatusEventCollector();
    c.onTierDecided({ fixId: 'f', tier: 1, reason: 'r' });
    expect(c.generatedPatches).toHaveLength(0);
    expect(c.rejectedPatches).toHaveLength(0);
    expect(c.createdPrs).toHaveLength(0);
    expect(c.budgetExceeded).toHaveLength(0);
    expect(c.evidenceFailures).toHaveLength(0);
  });
});
