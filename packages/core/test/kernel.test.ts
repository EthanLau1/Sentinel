import { describe, it, expect, vi } from 'vitest';
import { Kernel, type Subagent, type KernelContext } from '../src/kernel.js';
import { Budget } from '../src/budget.js';
import type { ProviderSet } from '../src/ports.js';

// ── 测试用 fake providers ──────────────────────────────────────────────────
function makeProviders(): ProviderSet {
  return {
    llm: {
      name: 'fake-llm',
      supportsTools: false,
      async chat() {
        return {
          content: 'fake',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          costUsd: 0.001,
        };
      },
      estimateCost: (n) => n * 0.0001,
    },
    memory: {
      name: 'none',
      async recall() {
        return [];
      },
      async remember() {},
    },
    skills: {
      async list() {
        return [];
      },
      async load() {
        return { name: 'x', authority: 'core', version: '0', body: '' };
      },
      async refresh() {},
    },
    mcp: {
      register() {},
      unregister() {},
      get() {
        return undefined;
      },
      list() {
        return [];
      },
    },
    knowledge: [],
  };
}

// ── 测试用 fake subagent ──────────────────────────────────────────────────
function makeSubagent(name: string, onRegister?: (ctx: KernelContext) => void): Subagent {
  return {
    name,
    register(ctx) {
      onRegister?.(ctx);
    },
  };
}

describe('Kernel', () => {
  it('注册子代理 → kick 事件 → 子代理收到', async () => {
    const providers = makeProviders();
    const budget = new Budget({});
    const calls: string[] = [];

    const sub = makeSubagent('mapper', (ctx) => {
      ctx.bus.subscribe('project.scanned', (e) => {
        calls.push(`mapper:${(e.payload as { root: string }).root}`);
      });
    });

    const kernel = new Kernel({
      providers,
      budget,
      subagents: [sub],
    });

    await kernel.kick('project.scanned', { root: '/tmp' }, 'cli');
    expect(calls).toEqual(['mapper:/tmp']);
  });

  it('多个子代理可订阅同一事件', async () => {
    const calls: string[] = [];
    const a = makeSubagent('a', (ctx) => {
      ctx.bus.subscribe('map.ready', () => {
        calls.push('a');
      });
    });
    const b = makeSubagent('b', (ctx) => {
      ctx.bus.subscribe('map.ready', () => {
        calls.push('b');
      });
    });
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [a, b],
    });
    await kernel.kick('map.ready', {}, 'test');
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('hooks 按顺序执行', async () => {
    const order: string[] = [];
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [],
      hooks: {
        'kernel.start': [
          async () => {
            order.push('h1');
          },
          async () => {
            order.push('h2');
          },
        ],
      },
    });
    await kernel.start();
    expect(order).toEqual(['h1', 'h2']);
  });

  it('budget 超限时发出 budget.exceeded 事件', async () => {
    const budget = new Budget({ maxUsd: 0.001 });
    const captured: unknown[] = [];

    const overspender = makeSubagent('over', (ctx) => {
      ctx.bus.subscribe('flow.started', () => {
        ctx.budget.consume(0, 100);
      });
      ctx.bus.subscribe('budget.exceeded', (e) => {
        captured.push(e.payload);
      });
    });

    const kernel = new Kernel({
      providers: makeProviders(),
      budget,
      subagents: [overspender],
    });

    await expect(
      kernel.kick('flow.started', { flowId: 'x' }, 'test'),
    ).rejects.toThrow();
    // budget.exceeded 事件已发出（即使外层抛错）
    expect(captured.length).toBeGreaterThan(0);
  });

  it('hook 抛错被吞，不影响主流程', async () => {
    const subCalled = vi.fn();
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [
        makeSubagent('s', (ctx) => {
          ctx.bus.subscribe('map.ready', subCalled);
        }),
      ],
      hooks: {
        'kernel.start': [
          () => {
            throw new Error('hook boom');
          },
        ],
      },
    });
    await kernel.kick('map.ready', {}, 'test'); // 不抛
    expect(subCalled).toHaveBeenCalled();
  });

  it('start 幂等（重复调用不抛）', async () => {
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [],
    });
    await kernel.start();
    await kernel.start();
    await kernel.stop();
    await kernel.stop();
  });

  it('emitHook 暴露给子代理', async () => {
    const seen: unknown[] = [];
    const sub = makeSubagent('s', (ctx) => {
      ctx.bus.subscribe('map.ready', () => {
        ctx.emitHook('kernel.error', 'custom-payload');
      });
    });
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [sub],
      hooks: {
        'kernel.error': [
          (p) => {
            seen.push(p);
          },
        ],
      },
    });
    await kernel.kick('map.ready', {}, 'test');
    // hook 是 async，等微任务
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toContain('custom-payload');
  });

  it('非 budget 错误走 kernel.error hook', async () => {
    const seen: unknown[] = [];
    const sub = makeSubagent('s', (ctx) => {
      ctx.bus.subscribe('map.ready', () => {
        throw new Error('non-budget boom');
      });
    });
    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [sub],
      hooks: {
        'kernel.error': [
          (p) => {
            seen.push(p);
          },
        ],
      },
    });
    await expect(kernel.kick('map.ready', {}, 'test')).rejects.toThrow();
    expect(seen.length).toBeGreaterThan(0);
  });

  it('budget 直接抛 BudgetExceededError 也能识别（非 AggregateError 包装）', async () => {
    // 用 duration 超时：publish 不消耗 budget，但 publish 后 assert 时间已超
    const budget = new Budget({ maxDurationMs: 1 });
    const captured: unknown[] = [];
    const sub = makeSubagent('s', (ctx) => {
      ctx.bus.subscribe('budget.exceeded', (e) => {
        captured.push(e.payload);
      });
      ctx.bus.subscribe('map.ready', async () => {
        // 等一下，确保 publish 完成时已超时
        await new Promise((r) => setTimeout(r, 10));
      });
    });
    const kernel = new Kernel({
      providers: makeProviders(),
      budget,
      subagents: [sub],
    });
    await expect(
      kernel.kick('map.ready', {}, 'test'),
    ).rejects.toThrow();
    expect(captured.length).toBeGreaterThan(0);
  });
});
