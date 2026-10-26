import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bus, Budget, Kernel, type Subagent, type ProviderSet, type BugFinding, type SearchResult } from '@sentinel/core';
import { createMapper } from '../src/mapper.js';
import { createEnhancer } from '../src/enhancer.js';

/**
 * 过程信息必须有出口（E26 / E27）。
 *
 * 之前这 4 个事件在目录里声明着，代码里**从未发布也从未订阅** ——
 * 也就是说"项目理解失败"和"知识检索"这两件事，外部完全看不见：
 *   - mapper 失败 → 异常冒到总线，用户只看到 "bus handler errors for project.scanned"
 *   - M6 知识检索 → 纯黑盒，搜没搜、搜到几条、是不是缓存，全查不到
 */

function fakeProviders(knowledge: ProviderSet['knowledge'] = []): ProviderSet {
  return {
    llm: {
      name: 'fake', supportsTools: false,
      async chat() { return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }; },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge,
  };
}

const BUG: BugFinding = {
  id: 'b1', title: 't', severity: 'P1', source: 'ui', affectedFeature: 'flow_0',
  symptom: 's', reproSteps: ['r'], evidence: [], rootCauseStatus: 'confirmed',
  rootCause: 'rc', counterEvidence: [], confidence: 0.5, fixOptions: [],
};

const OPTION = {
  id: 'fix1', title: 'fix', description: 'd', effort: 'low', risk: 'low',
  runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
  stageFit: 'MVP', tier: 1, confidence: 0.5, score: 0.5, sources: [],
};

describe('E26 — 项目理解失败要有出口', () => {
  it('mapper 整体失败 → 发 map.failed（不再冒成 bus handler errors）', async () => {
    const failures: Array<{ error: string }> = [];
    let ready = false;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ error: string }>('map.failed', (e) => { failures.push(e.payload); });
        ctx.bus.subscribe('map.ready', () => { ready = true; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper(), capture],
    });

    // root 非法 → mapper 内部抛错 → 必须转成 map.failed，而不是冒到调用方
    await kernel.kick('project.scanned', { root: undefined as unknown as string }, 'test');
    await kernel.stop();

    expect(failures).toHaveLength(1);
    expect(failures[0]!.error.length).toBeGreaterThan(0);
    expect(ready).toBe(false);
  });

  it('E28：单个 adapter 失败 → 落成风险项（识别不完整必须出现在报告里）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapfail-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');

    let mapped: { risks?: Array<{ id: string; description: string }> } | undefined;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<typeof mapped>('map.ready', (e) => { mapped = e.payload; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [
        createMapper({
          adapters: [{
            name: 'broken',
            async detect() { return true; },
            async routes() { throw new Error('路由解析炸了'); },
          }],
        }),
        capture,
      ],
    });

    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();

    // 关键：mapper 仍然"成功"了，但失败必须出现在 risks 里
    expect(mapped).toBeDefined();
    const risks = mapped!.risks ?? [];
    expect(risks.some((r) => r.description.includes('路由解析炸了'))).toBe(true);
  });
});

describe('E27 — 知识检索过程要有出口', () => {
  function result(title: string): SearchResult {
    return { title, url: `https://example.com/${title}`, snippet: 's', authority: 'official', publishedAt: Date.now() };
  }

  it('检索时发 knowledge.requested，拿到结果后发 knowledge.received', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'sentinel-kno-'));
    const requested: Array<{ query: string; sources: string[] }> = [];
    const received: SearchResult[][] = [];

    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ query: string; sources: string[] }>('knowledge.requested', (e) => { requested.push(e.payload); });
        ctx.bus.subscribe<SearchResult[]>('knowledge.received', (e) => { received.push(e.payload); });
      },
    };

    const provider = { name: 'stub', priority: 1, async search() { return [result('a')]; } };
    const kernel = new Kernel({
      providers: fakeProviders([provider]),
      budget: new Budget({}),
      subagents: [createEnhancer({ alwaysSearch: true, cacheDir }), capture],
    });

    await kernel.kick('fix.proposed', { bug: BUG, options: [OPTION] }, 'planner');
    await new Promise((r) => setTimeout(r, 30));
    await kernel.stop();

    expect(requested).toHaveLength(1);
    expect(requested[0]!.sources).toContain('stub');
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
  });

  it('命中缓存时发 knowledge.cached（不重复联网）', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'sentinel-kcache-'));
    const cached: Array<{ key: string; ttl: number }> = [];
    const requested: unknown[] = [];

    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ key: string; ttl: number }>('knowledge.cached', (e) => { cached.push(e.payload); });
        ctx.bus.subscribe('knowledge.requested', () => { requested.push(1); });
      },
    };

    const provider = { name: 'stub', priority: 1, async search() { return [result('a')]; } };
    const run = async () => {
      const kernel = new Kernel({
        providers: fakeProviders([provider]),
        budget: new Budget({}),
        subagents: [createEnhancer({ alwaysSearch: true, cacheDir }), capture],
      });
      await kernel.kick('fix.proposed', { bug: BUG, options: [OPTION] }, 'planner');
      await new Promise((r) => setTimeout(r, 30));
      await kernel.stop();
    };

    await run();       // 第一次：走网络
    await run();       // 第二次：命中缓存

    expect(requested).toHaveLength(1);   // 只请求过一次
    expect(cached).toHaveLength(1);      // 第二次命中缓存
    expect(cached[0]!.ttl).toBeGreaterThan(0);
  });

  it('单个来源失败不阻塞其它来源，但必须说出来（不静默吞）', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'sentinel-kfail-'));
    const received: SearchResult[][] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<SearchResult[]>('knowledge.received', (e) => { received.push(e.payload); });
      },
    };
    const bad = { name: 'broken', priority: 1, async search() { throw new Error('API key 无效'); } };
    const good = { name: 'ok', priority: 2, async search() { return [result('b')]; } };

    const kernel = new Kernel({
      providers: fakeProviders([bad, good]),
      budget: new Budget({}),
      subagents: [createEnhancer({ alwaysSearch: true, cacheDir }), capture],
    });
    await kernel.kick('fix.proposed', { bug: BUG, options: [OPTION] }, 'planner');
    await new Promise((r) => setTimeout(r, 30));
    await kernel.stop();

    // 坏来源没拖垮好来源
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(1);
    expect(received[0]![0]!.title).toBe('b');
  });
});

// keep imports referenced
void Bus;
