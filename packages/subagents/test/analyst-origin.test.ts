import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type BugFinding, type Evidence, type ProviderSet, type Subagent } from '@sentinel/core';
import { createAnalyst } from '../src/analyst.js';

/**
 * analyst 的 `origin` 必须说准 —— 它决定报告里"这条结论是谁给的"。
 *
 * 真实踩过的坑（2026-10-26 离线实测）：
 *   离线模式下 LLM 桩调用即抛错 → analyst 回退到启发式 → 产出的 finding
 *   **根本没经过模型**，但 origin 没标 → 报告按 'llm' 计入 by_origin。
 *   于是报告声称"有模型参与"，而同一份 run-status 里 llmRequests 明明是 0。
 *   这是典型的"报告说能做、实际没做"。
 */

const EVIDENCE: Evidence[] = [
  { kind: 'console', source: 'browser', timestamp: 1, hash: 'h1', level: 'error', message: 'boom' },
];

async function runDraft(llmWorks: boolean): Promise<BugFinding> {
  const providers: ProviderSet = {
    llm: {
      name: 'fake',
      supportsTools: false,
      async chat() {
        if (!llmWorks) throw new Error('offline mode: LLM 调用已禁用');
        return {
          content: JSON.stringify({ rootCause: '模型给出的根因', confidence: 0.8, reproSteps: ['步骤1'] }),
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          costUsd: 0,
        };
      },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return [] } },
    knowledge: [],
  };

  let draft: BugFinding | undefined;
  const capture: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<BugFinding>('bug.draft', (e) => { draft = e.payload; });
    },
  };

  const kernel = new Kernel({ providers, budget: new Budget({}), subagents: [createAnalyst(), capture] });
  await kernel.kick('flow.failed', {
    flowId: 'flow_api_posts',
    error: 'API GET /api/posts returned 500 (expected 2xx)',
    evidence: EVIDENCE,
  }, 'test');
  await kernel.stop();
  if (!draft) throw new Error('analyst 没有产出 draft');
  return draft;
}

describe('analyst 的结论来源标记', () => {
  it('模型真的给出根因时，标 llm', async () => {
    const draft = await runDraft(true);
    expect(draft.origin).toBe('llm');
    expect(draft.rootCause).toBe('模型给出的根因');
  });

  it('模型不可用（离线 / 调用失败）时，标 heuristic —— 不许冒充模型推断', async () => {
    const draft = await runDraft(false);
    expect(draft.origin).toBe('heuristic');
    // 没有根因就是没有根因，不许编
    expect(draft.rootCause).toBeUndefined();
    expect(draft.rootCauseStatus).toBe('hypothesis');
  });
});
