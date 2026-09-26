import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type BugFinding, type FixOption, type ProviderSet, type Subagent } from '@sentinel/core';
import { createCritic } from '../src/critic.js';
import { createSensor } from '../src/sensor.js';
import { createEnhancer } from '../src/enhancer.js';
import { createExecutor, validPatch } from '../src/executor.js';
import { formatEvidence } from '../src/analyst.js';
import { computeScore, DEFAULT_WEIGHTS } from '../src/cost-model.js';

const patch = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';
const file = { kind: 'file' as const, source: 'fs' as const, timestamp: 1, hash: 'code1', path: 'src/a.ts', snippet: 'const broken = true;' };
const runtime = { kind: 'console' as const, source: 'browser' as const, timestamp: 1, hash: 'runtime1', level: 'error' as const, message: 'failure' };
const bug: BugFinding = {
  id: 'b1', title: 'failure', severity: 'P1', source: 'ui', affectedFeature: 'f',
  symptom: 'failure', reproSteps: ['run'], evidence: [file, runtime], rootCauseStatus: 'hypothesis',
  rootCause: 'broken value', counterEvidence: [], confidence: 0.8, fixOptions: [],
};
const option: FixOption = {
  id: 'fix_1', title: 'fix', description: 'change value', effort: 'low', risk: 'low',
  runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
  stageFit: 'MVP', tier: 1, confidence: 0.8, score: 0, sources: [], patch,
};

function providers(chat: ProviderSet['llm']['chat'], call?: (name: string, args: Record<string, unknown>) => Promise<unknown>): ProviderSet {
  return {
    llm: { name: 'fake', supportsTools: false, chat, estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return call ? { name: 'fs', tools: [], call } : undefined; }, list() { return []; } },
    knowledge: [],
  };
}
const response = (value: unknown) => ({
  content: JSON.stringify(value), usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, costUsd: 0,
});

describe('subagent evidence and patch gates', () => {
  it('includes actual code context instead of only hashes', () => {
    expect(formatEvidence(file)).toContain('const broken = true');
  });

  it('does not confirm a hypothesis when critic is unavailable', async () => {
    let confirmed = 0;
    let rejected = 0;
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe('bug.confirmed', () => { confirmed++; });
      ctx.bus.subscribe('bug.rejected', () => { rejected++; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => { throw Error('offline'); }),
      budget: new Budget({}), subagents: [createCritic(), capture],
    });
    await kernel.kick('bug.draft', bug, 'analyst');
    expect(confirmed).toBe(0);
    expect(rejected).toBe(1);
  });

  it('requires a cited code evidence hash to confirm', async () => {
    let confirmed = 0;
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe('bug.confirmed', () => { confirmed++; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => response({
        shouldReject: false, verifiedRootCause: true, supportingEvidence: ['code1', 'runtime1'],
        reason: 'code shows defect', adjustedConfidence: 0.7,
      })),
      budget: new Budget({}), subagents: [createCritic(), capture],
    });
    await kernel.kick('bug.draft', { ...bug, evidence: [runtime] }, 'analyst');
    expect(confirmed).toBe(0);
    await kernel.kick('bug.draft', { ...bug, evidence: [file] }, 'analyst');
    expect(confirmed).toBe(0);
    await kernel.kick('bug.draft', bug, 'analyst');
    expect(confirmed).toBe(1);
  });

  it('reads structured FS MCP content for file evidence', async () => {
    let evidence: unknown[] = [];
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe<unknown[]>('evidence.ready', (e) => { evidence = e.payload; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => response({}), async () => ({ exists: true, content: 'first\nsecond', size: 12 })),
      budget: new Budget({}), subagents: [createSensor(), capture],
    });
    await kernel.kick('evidence.requested', { kinds: ['file'], target: 'src/a.ts:2' }, 'test');
    expect(evidence).toMatchObject([{ kind: 'file', snippet: 'first\nsecond' }]);
  });

  it('does not invent git evidence when FS MCP has no exec tool', async () => {
    let evidence: unknown[] = [];
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe<unknown[]>('evidence.ready', (e) => { evidence = e.payload; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => response({}), async () => { throw Error('unknown tool'); }),
      budget: new Budget({}), subagents: [createSensor(), capture],
    });
    await kernel.kick('evidence.requested', { kinds: ['git'], target: 'log' }, 'test');
    expect(evidence).toEqual([]);
  });

  it('skips search but emits fix.enhanced', async () => {
    let enhanced = 0;
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe('fix.enhanced', () => { enhanced++; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => response({})),
      budget: new Budget({}), subagents: [createEnhancer({ skipSearch: true, alwaysSearch: true }), capture],
    });
    await kernel.kick('fix.proposed', { bug, options: [option] }, 'planner');
    expect(enhanced).toBe(1);
  });

  it('scores runtime, regression and maintenance costs', () => {
    const base = { confidence: 0.8, impact: 0.7, stageFit: 1, effort: 'low' as const, risk: 'low' as const };
    const cheap = computeScore({ ...base, runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none' }, DEFAULT_WEIGHTS);
    const expensive = computeScore({ ...base, runtimeCost: 'high', regressionRisk: 'high', maintenanceCost: 'high' }, DEFAULT_WEIGHTS);
    expect(cheap).toBeGreaterThan(expensive);
  });

  it('rejects malformed and traversal patches before write, and reports generated not applied', async () => {
    expect(validPatch(patch)).toBe(true);
    expect(validPatch('diff --git a/src/a.ts b/src/a.ts\nindex 1111111..2222222 100644\n' + patch)).toBe(true);
    expect(validPatch('not a diff')).toBe(false);
    expect(validPatch('--- a/../evil\n+++ b/../evil\n@@ -1 +1 @@\n-a\n+b\n')).toBe(false);
    let writes = 0;
    let generated = 0;
    let applied = 0;
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe('patch.generated' as import('@sentinel/core').EventType, () => { generated++; });
      ctx.bus.subscribe('patch.applied', () => { applied++; });
    } };
    const kernel = new Kernel({
      providers: providers(async () => response({}), async (name) => { if (name === 'write') writes++; return { written: true }; }),
      budget: new Budget({}), subagents: [createExecutor(), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [{ ...option, id: '../escape' }, { ...option, patch: 'bad' }, option] }, 'enhancer');
    expect(writes).toBe(1);
    expect(generated).toBe(1);
    expect(applied).toBe(0);
  });
});
