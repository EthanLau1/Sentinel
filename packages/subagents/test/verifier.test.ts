import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type BugFinding, type ProviderSet, type Subagent } from '@sentinel/core';
import { createVerifier, createPlanner } from '../src/index.js';

function fakeProviders(): ProviderSet {
  return {
    llm: {
      name: 'fake', supportsTools: false,
      async chat() { throw new Error('planner should not need llm for this test'); },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

const baseBug: BugFinding = {
  id: 'bug1',
  title: 'Button fails',
  severity: 'P1',
  source: 'ui',
  affectedFeature: 'publish',
  symptom: 'click fails',
  reproSteps: ['open page', 'click publish'],
  evidence: [{ kind: 'console', source: 'browser', timestamp: 1, hash: 'h1', level: 'error', message: 'TypeError' },
    { kind: 'file', source: 'fs', timestamp: 1, hash: 'h2', path: 'src/publish.ts', snippet: 'function publish() {}' }],
  rootCauseStatus: 'confirmed',
  rootCause: 'missing click handler',
  counterEvidence: [],
  confidence: 0.8,
  fixOptions: [],
};

describe('verifier subagent', () => {
  it('only lets verified confirmed bugs reach a requireVerified planner', async () => {
    let proposed = 0;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe('fix.proposed', () => { proposed += 1; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createVerifier(), createPlanner({ requireVerified: true }), capture],
    });

    await kernel.kick('bug.confirmed', baseBug, 'critic');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await kernel.stop();

    expect(proposed).toBe(1);
  });

  it('rejects a root cause without runtime corroboration', async () => {
    let rejected = 0;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe('bug.insufficient_evidence', () => { rejected += 1; });
      },
    };
    const kernel = new Kernel({
      providers: fakeProviders(), budget: new Budget({}),
      subagents: [createVerifier(), createPlanner({ requireVerified: true }), capture],
    });
    await kernel.kick('bug.confirmed', { ...baseBug, evidence: baseBug.evidence.filter((e) => e.kind === 'file') }, 'critic');
    expect(rejected).toBe(1);
  });

  it('rejects confirmed bugs that have no evidence', async () => {
    let rejected = 0;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe('bug.insufficient_evidence', () => { rejected += 1; });
      },
    };
    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createVerifier(), createPlanner({ requireVerified: true }), capture],
    });

    await kernel.kick('bug.confirmed', { ...baseBug, evidence: [] }, 'critic');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await kernel.stop();

    expect(rejected).toBe(1);
  });
});
