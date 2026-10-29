import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type BugFinding, type ProviderSet, type Subagent } from '@sentinel/core';
import { createCritic } from '../src/critic.js';

function providers(llm: ProviderSet['llm']): ProviderSet {
  return {
    llm,
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

const llmDraft: BugFinding = {
  id: 'bug_llm',
  title: '发布失败',
  severity: 'P1',
  source: 'ui',
  affectedFeature: 'publish',
  symptom: 'click fails',
  reproSteps: ['打开页面', '点发布'],
  evidence: [
    { kind: 'console', source: 'browser', timestamp: 1, hash: 'h1', level: 'error', message: 'TypeError' },
    { kind: 'file', source: 'fs', timestamp: 1, hash: 'h2', path: 'src/publish.ts', snippet: 'function publish() {}' },
  ],
  rootCauseStatus: 'hypothesis',
  rootCause: '缺少点击处理函数',
  counterEvidence: [],
  confidence: 0.8,
  fixOptions: [],
  origin: 'llm',
};

/** 确定性规则判定出来的观察项 —— 不是根因假设 */
const ruleDraft: BugFinding = {
  ...llmDraft,
  id: 'bug_rule',
  title: '页面缺少 viewport',
  origin: 'rule',
  rootCause: 'meta 里没有 viewport',
};

async function runCritic(draft: BugFinding, llm: ProviderSet['llm']) {
  const rejections: Array<{ bugId: string; reason: string; kind?: string }> = [];
  const llmCalls: number[] = [];
  let calls = 0;
  const counted: ProviderSet['llm'] = {
    name: llm.name,
    supportsTools: llm.supportsTools,
    async chat(messages, options) {
      calls += 1;
      return llm.chat(messages, options);
    },
    estimateCost: llm.estimateCost,
  };
  void llmCalls;
  const capture: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ bugId: string; reason: string; kind?: string }>('bug.rejected', (e) => {
        rejections.push(e.payload);
      });
    },
  };
  const kernel = new Kernel({
    providers: providers(counted),
    budget: new Budget({}),
    subagents: [createCritic(), capture],
  });
  await kernel.kick('bug.draft', draft, 'analyst');
  await new Promise((resolve) => setTimeout(resolve, 30));
  await kernel.stop();
  return { rejections, calls };
}

describe('critic 的拒绝要区分性质', () => {
  it('证据不足 → kind=insufficient-evidence（草稿要被剔除）', async () => {
    const { rejections } = await runCritic(llmDraft, {
      name: 'fake',
      supportsTools: false,
      async chat() {
        return {
          content: JSON.stringify({ shouldReject: true, verifiedRootCause: false, supportingEvidence: [], reason: '证据不足', adjustedConfidence: 0.2 }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          costUsd: 0,
        };
      },
      estimateCost: () => 0,
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.kind).toBe('insufficient-evidence');
  });

  it('critic 自己没跑起来 → kind=unavailable（结论必须保留）', async () => {
    const { rejections } = await runCritic(llmDraft, {
      name: 'fake',
      supportsTools: false,
      async chat() { throw new Error('offline mode: LLM 调用已禁用'); },
      estimateCost: () => 0,
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.kind).toBe('unavailable');
  });

  it('确定性规则观察项不进 critic（不花 token，也不制造"未确认"噪音）', async () => {
    const { rejections, calls } = await runCritic(ruleDraft, {
      name: 'fake',
      supportsTools: false,
      async chat() { throw new Error('should not be called'); },
      estimateCost: () => 0,
    });
    expect(calls).toBe(0);
    expect(rejections).toHaveLength(0);
  });
});
