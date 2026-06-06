/**
 * @sentinel/core/kernel
 *
 * Kernel 只做 4 件事（宪法 Microkernel 决定）：
 *   1. 注册子代理（subagents）
 *   2. 路由事件（通过 bus）
 *   3. 管预算（Budget）
 *   4. 提供 hooks（pre/post）
 *
 * Kernel 是"笨"的，智能全在子代理里。
 */

import { Bus } from './bus.js';
import { Budget, BudgetExceededError } from './budget.js';
import type { ProviderSet } from './ports.js';
import type { EventType } from './types.js';

/** 子代理契约：拿到 ctx，自己决定订阅什么、做什么 */
export interface Subagent {
  /** 唯一名字（mapper / sensor / analyst / ...） */
  readonly name: string;
  /** 注册时 kernel 调用一次 */
  register(ctx: KernelContext): void;
}

export interface KernelContext {
  bus: Bus;
  budget: Budget;
  providers: ProviderSet;
  /** 触发 hook（不是事件） */
  emitHook(name: string, payload?: unknown): void;
}

export type HookHandler = (payload: unknown) => void | Promise<void>;

export interface KernelConfig {
  providers: ProviderSet;
  budget: Budget;
  subagents: Subagent[];
  hooks?: Partial<Record<HookName, HookHandler[]>>;
}

/** Kernel 提供的固定 hook 点（不是事件，只用于 IDE 集成 / 监控） */
export type HookName =
  | 'kernel.start'
  | 'kernel.stop'
  | 'kernel.budget_warning'
  | 'kernel.error';

export class Kernel {
  readonly bus = new Bus();
  private hooks: Map<HookName, HookHandler[]> = new Map();
  private started = false;

  constructor(private readonly config: KernelConfig) {
    // 装 hooks
    if (config.hooks) {
      for (const [name, handlers] of Object.entries(config.hooks)) {
        if (handlers) this.hooks.set(name as HookName, [...handlers]);
      }
    }
  }

  /** 启动：注册所有子代理，建立订阅关系 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.bus.newTrace();
    await this.fireHook('kernel.start');

    const ctx: KernelContext = {
      bus: this.bus,
      budget: this.config.budget,
      providers: this.config.providers,
      emitHook: (name, payload) => {
        // 用户子代理可发自定义 hook（不是 Event）
        void this.fireHook(name as HookName, payload);
      },
    };
    for (const sub of this.config.subagents) {
      sub.register(ctx);
    }
  }

  /** 触发起点事件（kernel 不订阅业务事件，只发起或停止） */
  async kick<T>(type: EventType, payload: T, source: string): Promise<void> {
    if (!this.started) await this.start();
    try {
      await this.bus.publish({ type, payload, source });
      this.config.budget.assert();
    } catch (err) {
      const budgetErr = this.findBudgetError(err);
      if (budgetErr) {
        await this.fireHook('kernel.budget_warning', budgetErr);
        await this.bus.publish({
          type: 'budget.exceeded',
          payload: { kind: budgetErr.kind, limit: budgetErr.limit, actual: budgetErr.actual },
          source: 'kernel',
        });
      } else {
        await this.fireHook('kernel.error', err);
      }
      throw err;
    }
  }

  /** bus.publish 把 handler 错误包进 AggregateError，这里挖出 BudgetExceededError */
  private findBudgetError(err: unknown): BudgetExceededError | undefined {
    if (err instanceof BudgetExceededError) return err;
    if (err instanceof AggregateError) {
      for (const e of err.errors) {
        if (e instanceof BudgetExceededError) return e;
      }
    }
    return undefined;
  }

  /** 优雅停止 */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.fireHook('kernel.stop');
  }

  private async fireHook(name: HookName, payload?: unknown): Promise<void> {
    const handlers = this.hooks.get(name);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        await h(payload);
      } catch {
        // hook 错误不能影响主流程，吞掉
      }
    }
  }
}
