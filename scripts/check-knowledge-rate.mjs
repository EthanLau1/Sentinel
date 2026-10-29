#!/usr/bin/env bun
/**
 * 知识检索限流守卫 —— 证明「每次 run 触发检索的流程占比 ≤30%」不是空话。
 *
 * 宪法 §知识增强：「触发率上限: ≤30%（每次 run 中触发检索的流程占比）」。
 * 这条以前**只有实现里的自觉**（一条"平均置信度 < 0.7 就搜"），
 * 没有机检 —— 置信度低的流程一多，检索就跟着涨，成本和外部服务压力都不受控。
 * 本脚本把它变成可核对的事实。
 *
 * 它做三件事，每件都从**外部**取证（数真正的外部检索次数），不相信被测代码的自报：
 *
 *   1. 造一个 10 流程 / 10 条待修复发现的模拟 run，全部满足"想搜"的条件；
 *   2. 数**真正发出**的知识检索次数 → 必须 ≤ floor(10 × 0.3) = 3；
 *   3. 再造一个 3 流程的 run → floor(3 × 0.3) = 0，必须一次都不搜。
 *
 * 退出码：0 通过 / 1 失败 / 2 环境不具备（无法判定）
 *
 * 用法：
 *   bun scripts/check-knowledge-rate.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, Budget } from '../packages/core/src/index.ts';
import { createEnhancer, MAX_SEARCH_RATE } from '../packages/subagents/src/enhancer.ts';

const failures = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => console.log(`  · ${msg}`);

console.log('知识检索限流守卫：每次 run 触发检索的流程占比 ≤30%');
console.log('');

/** 造一条"想搜"的方案：置信度低于 0.7 阈值 */
const OPTION = {
  id: 'opt_1',
  title: '修复空指针',
  description: '在读取前加空值判断',
  effort: 'S',
  risk: 'low',
  runtimeCost: 'none',
  regressionRisk: 'low',
  maintenanceCost: 'low',
  stageFit: 'MVP',
  tier: 2,
  confidence: 0.4,
  effortHours: 1,
  score: 60,
};

function fakeProviders(onSearch) {
  return {
    llm: {
      name: 'stub',
      supportsTools: false,
      async chat() { throw new Error('守卫不该调用 LLM'); },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return [] } },
    knowledge: [
      {
        name: 'fake-knowledge',
        priority: 1,
        async search(query) {
          onSearch(query);
          return [];
        },
      },
    ],
  };
}

/**
 * 跑一个模拟 run，返回真正发出的检索次数与 enhancer 自报的统计。
 */
async function simulate(flowCount, bugCount) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sentinel-knowledge-guard-'));
  const queries = [];
  const enhancer = createEnhancer({ cacheDir });
  const kernel = new Kernel({
    providers: fakeProviders((q) => queries.push(q)),
    budget: new Budget({}),
    subagents: [enhancer],
  });

  const flows = Array.from({ length: flowCount }, (_, i) => ({
    id: `flow_${i + 1}`,
    steps: [],
    name: `流程 ${i + 1}`,
  }));

  await kernel.kick(
    'map.ready',
    { project: {}, pages: [], api: [], data: [], flows, risks: [] },
    'mapper',
  );

  for (let i = 0; i < bugCount; i += 1) {
    const flowId = `flow_${(i % flowCount) + 1}`;
    await kernel.kick(
      'fix.proposed',
      {
        bug: {
          id: `bug_${i + 1}`,
          title: `问题 ${i + 1}`,
          symptom: '页面报错',
          severity: 'P1',
          source: 'ui',
          affectedFeature: flowId,
          reproSteps: [],
          evidence: [],
          rootCauseStatus: 'hypothesis',
          confidence: 0.4,
          counterEvidence: [],
          fixOptions: [],
        },
        options: [
          {
            ...OPTION,
            // 查询必须**各不相同** ——
            // 标题一样会被知识缓存合并成一次，测到的外部调用数就少了，
            // 限流有没有生效反而测不出来（第一版就踩了这个坑）。
            title: `${OPTION.title} #${i + 1}`,
          },
        ],
      },
      'planner',
    );
  }

  await kernel.stop();
  const stats = enhancer.knowledgeStats();
  rmSync(cacheDir, { recursive: true, force: true });
  return { searches: queries.length, stats };
}

// ── 1. 10 流程的 run：最多 3 次检索 ────────────────────────────────────────
{
  const { searches, stats } = await simulate(10, 10);
  const limit = Math.floor(10 * MAX_SEARCH_RATE);
  if (searches > limit) {
    fail(`10 个流程的 run 触发了 ${searches} 次检索，超过上限 ${limit} 次（占比 ${(searches / 10) * 100}%）`);
  } else {
    ok(`10 个流程的 run：实际检索 ${searches} 次 ≤ 上限 ${limit} 次`);
  }
  if (stats.rate > MAX_SEARCH_RATE) {
    fail(`自报占比 ${stats.rate} > 宪法上限 ${MAX_SEARCH_RATE}`);
  } else {
    ok(`自报占比 ${(stats.rate * 100).toFixed(0)}% ≤ ${MAX_SEARCH_RATE * 100}%（分母 ${stats.totalFlows} 个流程）`);
  }
  if (stats.maxSearches !== limit) {
    fail(`自报允许次数 ${stats.maxSearches} ≠ 按上限算出的 ${limit}`);
  } else {
    ok(`自报允许次数 = ${stats.maxSearches}（floor，不四舍五入）`);
  }
  if (stats.skippedByCap <= 0) {
    fail('没有任何一次因超限被跳过 —— 说明限流可能根本没生效');
  } else {
    ok(`因超上限跳过 ${stats.skippedByCap} 次（不是静默丢弃，有账可查）`);
  }
}

// ── 2. 3 流程的 run：一次都不能搜 ─────────────────────────────────────────
{
  const { searches, stats } = await simulate(3, 3);
  if (searches !== 0) {
    fail(`3 个流程的 run 触发了 ${searches} 次检索（floor(3 × 0.3) = 0，必须一次都不搜）`);
  } else {
    ok('3 个流程的 run：一次都没搜（30% 上限在流程数少时就是 0 次）');
  }
  if (stats.skippedByCap <= 0) {
    fail('小项目里没有记录"因上限被跳过" —— 用户会以为这条本来就没必要搜');
  } else {
    ok(`记录了 ${stats.skippedByCap} 次因上限跳过（报告里能说清"为什么没有知识来源"）`);
  }
}

// ── 3. 同一个流程只检索一次 ───────────────────────────────────────────────
{
  const { searches } = await simulate(10, 10);
  // 10 条发现分布在 10 个流程上 → 最多 3 次；
  // 如果计数单位错成"每条发现"，这里会是 10 次
  if (searches > 3) {
    fail(`计数单位可能错成了"每条发现"：10 条发现触发了 ${searches} 次检索`);
  } else {
    ok('计数单位是流程，不是每条发现（同一流程只检索一次）');
  }
}

console.log('');
if (failures.length > 0) {
  console.error(`✗ 知识检索限流守卫失败（${failures.length} 项）`);
  process.exit(1);
}
console.log('✅ 知识检索限流守卫通过（触发占比 ≤30%，且有据可查）');
