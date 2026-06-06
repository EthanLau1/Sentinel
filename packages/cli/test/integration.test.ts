import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Bus, Budget, Kernel, type Subagent, type BugFinding, type Evidence, type ProviderSet } from '@sentinel/core';
import { createMapper, createAnalyst, createCritic, createPlanner } from '@sentinel/subagents';
import { reportToMarkdown, reportToJson } from '@sentinel/reporters';

function fakeProviders(llmContent: string): ProviderSet {
  return {
    llm: {
      name: 'fake', supportsTools: false,
      async chat(messages) {
        // 根据 system prompt 返回不同 mock 数据
        const sys = messages[0]?.content ?? '';
        if (sys.includes('critic')) {
          return {
            content: JSON.stringify({
              shouldReject: false,
              reason: 'evidence supports root cause',
              adjustedConfidence: 0.85,
              ruledOut: ['network down'],
              missingEvidence: [],
            }),
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            costUsd: 0.0001,
          };
        }
        if (sys.includes('planner')) {
          return {
            content: JSON.stringify([
              { id: 'fix1', title: 'quick', description: 'q', effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low', stageFit: 'MVP', tier: 1, confidence: 0.9, whyRecommended: 'fast' },
              { id: 'fix2', title: 'std', description: 's', effort: 'medium', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low', stageFit: 'Launch', tier: 2, confidence: 0.85, whyRecommended: 'safer' },
              { id: 'fix3', title: 'long', description: 'l', effort: 'high', risk: 'medium', runtimeCost: 'low', regressionRisk: 'medium', maintenanceCost: 'low', stageFit: 'Scale', tier: 3, confidence: 0.7, whyRecommended: 'maintainable' },
            ]),
            usage: { promptTokens: 20, completionTokens: 80, totalTokens: 100 },
            costUsd: 0.0005,
          };
        }
        return {
          content: llmContent,
          usage: { promptTokens: 10, completionTokens: 30, totalTokens: 40 },
          costUsd: 0.0002,
        };
      },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

describe('Integration: end-to-end vertical slice', () => {
  it('flow.failed → analyst → critic → planner → 完整 BugFinding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-int-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'int', dependencies: { next: '15' } }), 'utf8');

    const llmAnalystResp = JSON.stringify({
      rootCause: '测试根因',
      confidence: 0.8,
      reproSteps: ['打开页面', '点击按钮'],
    });

    const captured: BugFinding[] = [];
    const captureSub: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ bug: BugFinding }>('fix.proposed', (e) => {
          captured.push(e.payload.bug);
        });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(llmAnalystResp),
      budget: new Budget({}),
      subagents: [
        createMapper(),
        createAnalyst(),
        createCritic(),
        createPlanner({ stage: 'MVP' }),
        captureSub,
      ],
    });

    const evidence: Evidence[] = [
      {
        kind: 'console', source: 'browser', timestamp: Date.now(), hash: 'h1',
        level: 'error', message: 'TypeError: Cannot read property x of undefined',
      },
      {
        kind: 'network', source: 'browser', timestamp: Date.now(), hash: 'h2',
        url: '/api/x', method: 'POST', status: 500, duration_ms: 200, failed: true,
      },
    ];

    await kernel.kick('flow.failed', { flowId: 'test-flow', error: 'click failed', evidence }, 'test');
    await new Promise((r) => setTimeout(r, 50));
    await kernel.stop();

    expect(captured.length).toBe(1);
    const bug = captured[0]!;
    expect(bug.evidence.length).toBe(2);
    expect(bug.rootCauseStatus).toBe('confirmed');
    expect(bug.fixOptions.length).toBe(3);
    expect(bug.recommendedFixId).toBeDefined();
    expect(bug.fixOptions[0]?.score).toBeGreaterThan(0);
  });

  it('reporter 输出 markdown 含 11 字段', async () => {
    const bug: BugFinding = {
      id: 'b1', title: 'Test', severity: 'P1', source: 'ui',
      affectedFeature: 'flow.test', symptom: 'broke', reproSteps: ['step1'],
      evidence: [{ kind: 'console', source: 'browser', timestamp: 0, hash: 'h', level: 'error', message: 'x' }],
      rootCauseStatus: 'confirmed', rootCause: 'r',
      counterEvidence: [], confidence: 0.9,
      fixOptions: [{
        id: 'fx', title: 'fix', description: 'd',
        effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'none',
        stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      }],
      recommendedFixId: 'fx',
    };
    const md = reportToMarkdown([bug]);
    // 11 字段标记
    for (let i = 1; i <= 11; i++) {
      expect(md).toContain(`**${i}.`);
    }
  });

  it('reporter JSON 包含 by_severity', () => {
    const json = reportToJson([
      { id: 'a', title: 't', severity: 'P0', source: 'ui', affectedFeature: 'f', symptom: 's', reproSteps: [], evidence: [], rootCauseStatus: 'hypothesis', counterEvidence: [], confidence: 0.5, fixOptions: [] } as BugFinding,
      { id: 'b', title: 't', severity: 'P1', source: 'ui', affectedFeature: 'f', symptom: 's', reproSteps: [], evidence: [], rootCauseStatus: 'hypothesis', counterEvidence: [], confidence: 0.5, fixOptions: [] } as BugFinding,
    ]);
    expect(json.summary.total).toBe(2);
    expect(json.summary.by_severity['P0']).toBe(1);
    expect(json.summary.by_severity['P1']).toBe(1);
  });
});

// keep imports referenced
void Bus;
