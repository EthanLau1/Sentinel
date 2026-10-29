import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Budget, Kernel, type Evidence, type FeatureMap, type FlowSpec, type MCPServer, type ProviderSet, type Subagent } from '@sentinel/core';
import { createRunner } from '../src/runner.js';

/** 1x1 的合法 PNG（base64） */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeProviders(browser: MCPServer): ProviderSet {
  return {
    llm: { name: 'fake', supportsTools: false, async chat() { return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }; }, estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get(name) { return name === 'browser' ? browser : undefined; }, list() { return []; } },
    knowledge: [],
  };
}

async function runFailingFlow(evidenceDir?: string): Promise<Evidence[]> {
  const browser: MCPServer = {
    name: 'browser',
    tools: [],
    async call(tool: string) {
      if (tool === 'visit') throw new Error('Page http://127.0.0.1:3000/x returned HTTP 404');
      if (tool === 'snapshot') {
        return {
          url: 'http://127.0.0.1:3000/x',
          title: '404',
          screenshot: PNG_BASE64,
          domSnapshot: '<html><body><h1>404 Not Found</h1></body></html>',
          a11yTree: '- heading "404 Not Found"',
          console: [],
          network: [{ url: 'http://127.0.0.1:3000/x', method: 'GET', status: 404, duration_ms: 5, failed: true }],
        };
      }
      return {};
    },
  };

  const captured: Evidence[][] = [];
  const capture: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ evidence: Evidence[] }>('flow.failed', (e) => { captured.push(e.payload.evidence); });
    },
  };
  const kernel = new Kernel({
    providers: makeProviders(browser),
    budget: new Budget({}),
    subagents: [createRunner({ evidenceDir }), capture],
  });
  const flows: FlowSpec[] = [{ id: 'f1', description: '', steps: [{ action: 'visit', url: '/x' }] }];
  const map: FeatureMap = { project: { name: 'test', stack: [], frameworks: [], runtime: 'node', packageManager: 'npm' }, pages: [], api: [], data: [], flows, risks: [] };
  await kernel.kick('map.ready', map, 'test');
  await kernel.stop();
  return captured.flat();
}

describe('失败现场的证据链', () => {
  it('DOM 快照必须有生产者（以前有类型没证据）', async () => {
    const evidence = await runFailingFlow();
    const dom = evidence.find((e) => e.kind === 'dom-snapshot');
    expect(dom).toBeDefined();
    expect(dom && dom.kind === 'dom-snapshot' ? dom.html : '').toContain('404 Not Found');
  });

  it('截图落盘成真实文件，证据里给的是文件路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sentinel-evidence-'));
    const evidence = await runFailingFlow(dir);
    const shot = evidence.find((e) => e.kind === 'screenshot');
    expect(shot).toBeDefined();
    if (!shot || shot.kind !== 'screenshot') return;
    expect(shot.path.startsWith('data:')).toBe(false);
    expect(shot.path.endsWith('.png')).toBe(true);
    const st = await stat(shot.path);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
    const bytes = await readFile(shot.path);
    expect(bytes.subarray(0, 4).toString('binary')).toBe('\x89PNG');
  });

  it('没有落盘目录时仍然留证据（退回内联，不丢）', async () => {
    const evidence = await runFailingFlow();
    const shot = evidence.find((e) => e.kind === 'screenshot');
    expect(shot).toBeDefined();
    if (shot && shot.kind === 'screenshot') {
      expect(shot.path.startsWith('data:image/png;base64,')).toBe(true);
    }
  });
});
