import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type FeatureMap, type FlowSpec, type MCPServer, type ProviderSet, type Subagent } from '@sentinel/core';
import { createRunner } from '../src/runner.js';

async function run(flows: FlowSpec[], browser?: MCPServer, http?: MCPServer) {
  const results: Array<{ type: string; payload: { flowId: string; error?: string } }> = [];
  const providers: ProviderSet = {
    llm: { name: 'fake', supportsTools: false, async chat() { return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }; }, estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get(name) { return name === 'browser' ? browser : name === 'http' ? http : undefined; }, list() { return []; } },
    knowledge: [],
  };
  const capture: Subagent = { name: 'capture', register(ctx) {
    ctx.bus.subscribe<{ flowId: string; error?: string }>('flow.passed', e => { results.push({ type: e.type, payload: e.payload }); });
    ctx.bus.subscribe<{ flowId: string; error?: string }>('flow.failed', e => { results.push({ type: e.type, payload: e.payload }); });
  } };
  const kernel = new Kernel({ providers, budget: new Budget({}), subagents: [createRunner(), capture] });
  const map: FeatureMap = { project: { name: 'test', stack: [], frameworks: [], runtime: 'node', packageManager: 'npm' }, pages: [], api: [], data: [], flows, risks: [] };
  await kernel.kick('map.ready', map, 'test');
  await kernel.stop();
  return results;
}

describe('runner assertions', () => {
  it('fails on missing providers and unsupported DB assertions', async () => {
    const results = await run([
      { id: 'api', description: '', steps: [{ action: 'assert', kind: 'api', path: '/ok', expectStatus: '2xx' }] },
      { id: 'ui', description: '', steps: [{ action: 'assert', kind: 'visible', selector: 'main' }] },
      { id: 'db', description: '', steps: [{ action: 'assert', kind: 'db' }] },
    ]);
    expect(results.map(r => r.type)).toEqual(['flow.failed', 'flow.failed', 'flow.failed']);
    expect(results[0]?.payload.error).toContain('http MCP');
  });

  it('checks API status and body, and never sends implicit mutations', async () => {
    const requests: Record<string, unknown>[] = [];
    const http: MCPServer = { name: 'http', tools: [], async call(_name, args) {
      requests.push(args);
      return { status: args['path'] === '/missing' ? 404 : 200, body: { value: 1 } };
    } };
    const results = await run([
      { id: 'status', description: '', steps: [{ action: 'assert', kind: 'api', path: '/missing', expectStatus: '2xx' }] },
      { id: 'body', description: '', steps: [{ action: 'assert', kind: 'api', path: '/ok', expectStatus: 200, expectedBody: { value: 2 } }] },
      { id: 'success', description: '', steps: [{ action: 'assert', kind: 'api', path: '/ok', expectStatus: 200, bodyContains: 'value' }] },
      { id: 'mutation', description: '', steps: [{ action: 'assert', kind: 'api', method: 'POST', path: '/create', expectStatus: 201 }] },
    ], undefined, http);
    expect(results.map(r => r.type)).toEqual(['flow.failed', 'flow.failed', 'flow.passed', 'flow.failed']);
    expect(requests).toHaveLength(3);
    expect(requests.every(r => r['method'] === 'GET')).toBe(true);
  });

  it('requires a positive browser assertion result', async () => {
    const browser: MCPServer = { name: 'browser', tools: [], async call() { return { passed: false }; } };
    const results = await run([{ id: 'ui', description: '', steps: [{ action: 'assert', kind: 'text', expected: 'Ready' }] }], browser);
    expect(results[0]?.type).toBe('flow.failed');
  });
});
