/**
 * @sentinel/core/budget
 *
 * Token / USD / 时间预算护栏。
 * 超限即抛 BudgetExceededError，由 kernel 捕获停止 loop。
 */

export interface BudgetLimits {
  maxTokens?: number;
  maxUsd?: number;
  maxDurationMs?: number;
}

export interface BudgetUsage {
  tokens: number;
  usd: number;
  startedAt: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: 'tokens' | 'usd' | 'duration',
    public readonly limit: number,
    public readonly actual: number,
  ) {
    super(`budget.${kind} exceeded: ${actual} > ${limit}`);
    this.name = 'BudgetExceededError';
  }
}

export class Budget {
  private usage: BudgetUsage = { tokens: 0, usd: 0, startedAt: Date.now() };

  constructor(private readonly limits: BudgetLimits) {}

  /** 累加消耗。超限抛错。 */
  consume(tokens: number, usd: number): void {
    this.usage.tokens += tokens;
    this.usage.usd += usd;
    this.assert();
  }

  /** 检查所有限额 */
  assert(): void {
    if (this.limits.maxTokens !== undefined && this.usage.tokens > this.limits.maxTokens) {
      throw new BudgetExceededError('tokens', this.limits.maxTokens, this.usage.tokens);
    }
    if (this.limits.maxUsd !== undefined && this.usage.usd > this.limits.maxUsd) {
      throw new BudgetExceededError('usd', this.limits.maxUsd, this.usage.usd);
    }
    if (this.limits.maxDurationMs !== undefined) {
      const dur = Date.now() - this.usage.startedAt;
      if (dur > this.limits.maxDurationMs) {
        throw new BudgetExceededError('duration', this.limits.maxDurationMs, dur);
      }
    }
  }

  /** 当前用量快照 */
  snapshot(): Readonly<BudgetUsage> {
    return { ...this.usage };
  }
}
