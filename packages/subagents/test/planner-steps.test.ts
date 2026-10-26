import { describe, it, expect } from 'vitest';
import { Budget, Kernel, type BugFinding, type ProviderSet, type Subagent } from '@sentinel/core';
import { createPlanner, extractDiff } from '../src/index.js';
import { salvageTruncatedJsonArray } from '../src/json.js';

/**
 * planner 两步调用（2026-10-26 真实 run10 实测后重构）：
 *   第 1 步只要 JSON 数组；第 2 步单独要 unified diff。
 * 原来的单次双重约束会让模型输出散文 → 解析失败 → 回退通用模板。
 */

const BUG: BugFinding = {
  id: 'bug1',
  title: '页面渲染为空',
  severity: 'P1',
  source: 'ui',
  affectedFeature: 'flow_page_0',
  symptom: 'waitFor: Timeout 5000ms exceeded',
  reproSteps: ['访问 /posts', '等待 body 可见'],
  evidence: [
    { kind: 'console', source: 'browser', timestamp: 1, hash: 'h1', level: 'error', message: 'waitFor timeout' },
    { kind: 'file', source: 'fs', timestamp: 1, hash: 'h2', path: 'app/posts/page.tsx', snippet: 'export default function Page() { return null; }' },
  ],
  rootCauseStatus: 'confirmed',
  rootCause: 'app/posts/page.tsx 返回 null，body 持续 hidden',
  counterEvidence: [],
  confidence: 0.9,
  fixOptions: [],
};

const OPTIONS_JSON = JSON.stringify([
  { id: 'fix1', title: '把占位页换成真实内容', description: '改 app/posts/page.tsx，渲染文章列表', effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none', stageFit: 'MVP', tier: 1, confidence: 0.9, whyRecommended: '改动最小', verificationCommand: 'npm test' },
  { id: 'fix2', title: '补测试', description: '给 /posts 加渲染断言', effort: 'medium', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low', stageFit: 'Launch', tier: 2, confidence: 0.8, whyRecommended: '防回归', verificationCommand: 'npm test' },
  { id: 'fix3', title: '重构页面结构', description: '抽公共布局', effort: 'high', risk: 'medium', runtimeCost: 'low', regressionRisk: 'medium', maintenanceCost: 'low', stageFit: 'Scale', tier: 3, confidence: 0.7, whyRecommended: '长期', verificationCommand: 'npm test' },
]);

const DIFF = `--- a/app/posts/page.tsx
+++ b/app/posts/page.tsx
@@ -1,3 +1,5 @@
 export default function Page() {
-  return null;
+  return <PostList />;
 }`;

function providers(reply: (callIndex: number) => string): ProviderSet {
  let calls = 0;
  return {
    llm: {
      name: 'fake',
      supportsTools: false,
      async chat() {
        const content = reply(calls++);
        return {
          content,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          costUsd: 0,
        };
      },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

async function runPlanner(reply: (callIndex: number) => string): Promise<{ proposed: number; options: any[] }> {
  const proposed: any[] = [];
  const capture: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ options: any[] }>('fix.proposed', (e) => { proposed.push(e.payload.options); });
    },
  };
  const kernel = new Kernel({
    providers: providers(reply),
    budget: new Budget({}),
    subagents: [createPlanner({ stage: 'MVP' }), capture],
  });
  await kernel.kick('bug.confirmed', BUG, 'verifier');
  await new Promise((r) => setTimeout(r, 30));
  await kernel.stop();
  return { proposed: proposed.length, options: proposed[0] ?? [] };
}

describe('planner 两步调用', () => {
  it('第 1 步出 JSON 数组、第 2 步补 patch，两个方案都有内容', async () => {
    const { proposed, options } = await runPlanner((i) => (i === 0 ? OPTIONS_JSON : DIFF));
    expect(proposed).toBe(1);
    expect(options).toHaveLength(3);
    // 方案必须是模型给的真实内容，不是通用模板
    expect(options[0].title).toBe('把占位页换成真实内容');
    expect(options[0].description).toContain('app/posts/page.tsx');
    // 第 2 步的 patch 挂到了最轻量的方案上
    const withPatch = options.find((o: any) => o.patch);
    expect(withPatch).toBeDefined();
    expect(withPatch.patch).toContain('+  return <PostList />;');
  });

  it('模型输出散文导致 JSON 解析失败 → 回退启发式方案，但方案数仍是 3', async () => {
    const { proposed, options } = await runPlanner(() => 'impossible to only output JSON array, needs diff segments');
    expect(proposed).toBe(1);
    expect(options).toHaveLength(3);
    // 回落方案是通用模板 —— 但不能为空
    expect(options[0].title).toContain('修复');
  });

  it('patch 生成失败不影响方案本身', async () => {
    const { proposed, options } = await runPlanner((i) => (i === 0 ? OPTIONS_JSON : 'NO_PATCH'));
    expect(proposed).toBe(1);
    expect(options).toHaveLength(3);
    expect(options.find((o: any) => o.patch)).toBeUndefined();
  });
});

describe('unified diff 提取', () => {
  it('裸 diff 能提取（hunk 头按实际行数归一化）', () => {
    // DIFF 的原文写的是 `@@ -1,3 +1,5 @@`，但实际只有 3 行新内容 ——
    // LLM 计数不准是常态，接收端按实际内容重算，不能因此把整个补丁丢掉。
    expect(extractDiff(DIFF)).toContain('@@ -1,3 +1,3 @@');
  });

  it('markdown 围栏里的 diff 能提取', () => {
    expect(extractDiff('这是说明\n```diff\n' + DIFF + '\n```')).toContain('+++ b/app/posts/page.tsx');
  });

  it('没有 diff 时返回 undefined（不是空串）', () => {
    expect(extractDiff('我不知道怎么改')).toBeUndefined();
    expect(extractDiff('')).toBeUndefined();
  });

  it('NO_PATCH 视为没有补丁', () => {
    expect(extractDiff('NO_PATCH')).toBeUndefined();
  });
});

describe('E22 — 输出撞上 max_tokens 被截断 → 抢救已写完的方案', () => {
  /** 真实 run15 的形态：JSON 在第 2 个对象中间被切断 */
  const TRUNCATED =
    '[{"id":"fix1","title":"改用 posts 数组","description":"改 app/posts/page.tsx","effort":"low","risk":"low","runtimeCost":"none","regressionRisk":"low","maintenanceCost":"none","stageFit":"MVP","tier":1,"confidence":0.9,"whyRecommended":"最小改动","verificationCommand":"npm test"},' +
    '{"id":"fix2","title":"统一命名","description":"改 app/posts/page.tsx","effort":"low","risk":"low","runtimeCost":"none","regressionRisk":"low","maintenanceCost":"none","stageFit":"MVP","tier":2,"confidence":0.8,"whyReco';

  it('截断的 JSON 能救回已写完的对象', () => {
    const salvaged = salvageTruncatedJsonArray(TRUNCATED);
    expect(salvaged).not.toBeNull();
    const parsed = JSON.parse(salvaged!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('fix1');
  });

  it('完整的 JSON 不需要抢救', () => {
    expect(salvageTruncatedJsonArray(OPTIONS_JSON)).toBeNull();
  });

  it('planner 保留救回来的真实方案，而不是全换成通用模板', async () => {
    const { proposed, options } = await runPlanner((i) => (i === 0 ? TRUNCATED : DIFF));
    expect(proposed).toBe(1);
    expect(options.length).toBeGreaterThanOrEqual(3);
    // 第一个必须是模型写的真方案
    expect(options[0].title).toBe('改用 posts 数组');
    expect(options[0].description).toContain('app/posts/page.tsx');
  });
});
