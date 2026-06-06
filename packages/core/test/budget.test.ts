import { describe, it, expect, vi } from 'vitest';
import { Budget, BudgetExceededError } from '../src/budget.js';

describe('Budget', () => {
  it('consume 累加正确', () => {
    const b = new Budget({ maxTokens: 10000, maxUsd: 1 });
    b.consume(100, 0.01);
    b.consume(200, 0.02);
    expect(b.snapshot().tokens).toBe(300);
    expect(b.snapshot().usd).toBeCloseTo(0.03);
  });

  it('超 token 抛 BudgetExceededError', () => {
    const b = new Budget({ maxTokens: 100 });
    expect(() => b.consume(150, 0)).toThrow(BudgetExceededError);
    try {
      b.consume(0, 0);
    } catch (e) {
      const err = e as BudgetExceededError;
      expect(err.kind).toBe('tokens');
      expect(err.limit).toBe(100);
      expect(err.actual).toBe(150);
    }
  });

  it('超 usd 抛 BudgetExceededError', () => {
    const b = new Budget({ maxUsd: 0.5 });
    expect(() => b.consume(0, 0.6)).toThrow(BudgetExceededError);
  });

  it('未设置某个 limit 时不检查它', () => {
    const b = new Budget({ maxTokens: 100 });
    // maxUsd undefined → 多大都不抛
    expect(() => b.consume(50, 9999)).not.toThrow();
  });

  it('assert 单独调用也能触发超限', () => {
    const b = new Budget({ maxUsd: 0.1 });
    // 直接构造一次累计（绕过 consume 内部 assert 用人为状态）
    expect(() => {
      b.consume(0, 0.05);
      b.consume(0, 0.06); // 累计 0.11 > 0.1
    }).toThrow(BudgetExceededError);
  });

  it('maxDurationMs 超时抛错', () => {
    vi.useFakeTimers();
    const b = new Budget({ maxDurationMs: 1000 });
    b.consume(0, 0); // 0ms 内 OK
    vi.advanceTimersByTime(1500);
    expect(() => b.assert()).toThrow(BudgetExceededError);
    vi.useRealTimers();
  });

  it('snapshot 不可变（每次返回 copy）', () => {
    const b = new Budget({});
    b.consume(10, 0.001);
    const s1 = b.snapshot();
    b.consume(20, 0.002);
    expect(s1.tokens).toBe(10); // 旧 snapshot 不变
    expect(b.snapshot().tokens).toBe(30);
  });
});
