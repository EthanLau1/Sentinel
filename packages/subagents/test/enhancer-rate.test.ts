import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Budget,
  Kernel,
  type BugFinding,
  type FeatureMap,
  type FixOption,
  type ProviderSet,
  type SearchResult,
} from '@sentinel/core';
import { createEnhancer, MAX_SEARCH_RATE, maxSearchesFor } from '../src/enhancer.js';

/**
 * 宪法硬条款：每次 run 中触发检索的**流程占比** ≤30%。
 *
 * 以前这里只有"平均置信度 < 0.7 就搜" —— 置信度低的流程一多，
 * 检索就跟着涨，成本和外部服务压力都不受控，而且没人查得到。
 *
 * 这组用例盯三件事：
 *   1. 占比真的被限制住（不是"大概"）；
 *   2. 计数单位是**流程**不是每条发现；
 *   3. 被上限挡下来的要**有账可查**（不是静默丢弃）。
 */

function fakeProviders(onSearch: (q: string) => void): ProviderSet {
  return {
    llm: {
      name: 'fake',
      supportsTools: false,
      async chat() {
        return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 };
      },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return [] } },
    knowledge: [
      {
        name: 'fake-knowledge',
        priority: 1,
        async search(query): Promise<SearchResult[]> {
          onSearch(query);
          return [];
        },
      },
    ],
  };
}

const OPTION: FixOption = {
  id: 'fix1',
  title: '修复空指针',
  description: 'd',
  effort: 'low',
  risk: 'low',
  runtimeCost: 'none',
  regressionRisk: 'low',
  maintenanceCost: 'low',
  stageFit: 'MVP',
  tier: 1,
  confidence: 0.5,
  score: 0.5,
  sources: [],
};

function bugFor(flowId: string, i: number): BugFinding {
  return {
    id: `bug_${i}`,
    title: `问题 ${i}`,
    severity: 'P1',
    source: 'ui',
    affectedFeature: flowId,
    symptom: '页面报错',
    reproSteps: ['r'],
    evidence: [],
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.5,
    fixOptions: [],
  };
}

async function runEnhancer(
  flowCount: number,
  bugCount: number,
  opts: { skipSearch?: boolean } = {},
): Promise<{ searches: string[]; stats: ReturnType<ReturnType<typeof createEnhancer>['knowledgeStats']> }> {
  const cacheDir = await mkdtemp(join(tmpdir(), 'sentinel-enhancer-rate-'));
  const searches: string[] = [];
  const enhancer = createEnhancer({ cacheDir, ...(opts.skipSearch !== undefined && { skipSearch: opts.skipSearch }) });
  const kernel = new Kernel({
    providers: fakeProviders((q) => searches.push(q)),
    budget: new Budget({}),
    subagents: [enhancer],
  });

  const flows = Array.from({ length: flowCount }, (_, i) => ({ id: `flow_${i + 1}`, steps: [], name: `流程 ${i + 1}` }));
  await kernel.kick('map.ready', { project: {}, pages: [], api: [], data: [], flows, risks: [] } as FeatureMap, 'mapper');

  for (let i = 0; i < bugCount; i += 1) {
    const flowId = `flow_${(i % flowCount) + 1}`;
    await kernel.kick(
      'fix.proposed',
      {
        bug: bugFor(flowId, i),
        // 查询必须各不相同 —— 标题一样会被知识缓存合并成一次，
        // 测出来的"检索次数"就少了，限流有没有生效反而看不出来
        options: [{ ...OPTION, title: `${OPTION.title} #${i + 1}` }],
      },
      'planner',
    );
  }

  await kernel.stop();
  const stats = enhancer.knowledgeStats();
  await rm(cacheDir, { recursive: true, force: true });
  return { searches, stats };
}

describe('知识检索触发率上限（宪法 ≤30%）', () => {
  it('上限换算是 floor，不四舍五入（30% 是上限不是目标）', () => {
    expect(maxSearchesFor(10)).toBe(3);
    expect(maxSearchesFor(3)).toBe(0);
    expect(maxSearchesFor(4)).toBe(1);
    expect(maxSearchesFor(100)).toBe(30);
    expect(maxSearchesFor(0)).toBe(0);
    // 拿不到流程总数时用保守分母 10 → 3 次上限
    expect(maxSearchesFor(null)).toBe(3);
  });

  it('10 个流程 / 10 条待修复发现 → 最多检索 3 次', async () => {
    const { searches, stats } = await runEnhancer(10, 10);
    expect(searches.length).toBeLessThanOrEqual(3);
    expect(stats.totalFlows).toBe(10);
    expect(stats.searchedFlows).toBeLessThanOrEqual(3);
    expect(stats.rate).toBeLessThanOrEqual(MAX_SEARCH_RATE);
    expect(stats.cap).toBe(MAX_SEARCH_RATE);
  });

  it('流程数少时上限就是 0 次（3 × 0.3 = 0.9 → 0）', async () => {
    const { searches, stats } = await runEnhancer(3, 3);
    expect(searches.length).toBe(0);
    expect(stats.maxSearches).toBe(0);
    // 但必须**有账可查** —— 用户要能看出"为什么这条没有知识来源"
    expect(stats.skippedByCap).toBeGreaterThan(0);
  });

  it('同一个流程的多条发现只检索一次（计数单位是流程）', async () => {
    // 1 个流程、4 条发现 → 1 次就够（floor(1 × 0.3) = 0，那用 10 个流程里同一个）
    const { searches, stats } = await runEnhancer(10, 10);
    // 10 条发现分布在 10 个流程上
    expect(stats.searchedFlows).toBeLessThanOrEqual(3);
    expect(searches.length).toBe(stats.searchedFlows);
  });

  it('skipSearch（离线模式）→ 一次都不搜', async () => {
    const { searches, stats } = await runEnhancer(10, 10, { skipSearch: true });
    expect(searches.length).toBe(0);
    expect(stats.searchedFlows).toBe(0);
    // 离线模式不该被算成"因上限跳过"
    expect(stats.skippedByCap).toBe(0);
  });

  it('统计里的分母、实际值、上限三者自洽', async () => {
    const { stats } = await runEnhancer(10, 10);
    expect(stats.totalFlows).toBe(10);
    expect(stats.maxSearches).toBe(maxSearchesFor(10));
    expect(stats.rate).toBeCloseTo(stats.searchedFlows / 10, 10);
    expect(stats.skippedByCap + stats.searchedFlows).toBe(10);
  });
});
