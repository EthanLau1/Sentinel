import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bus, Budget, Kernel, type Subagent, type FeatureMap, type ProviderSet, type ApiSpec } from '@sentinel/core';
import { createMapper } from '../src/mapper.js';

function fakeProviders(): ProviderSet {
  return {
    llm: {
      name: 'fake', supportsTools: false,
      async chat() { return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }; },
      estimateCost: () => 0,
    },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

describe('mapper subagent', () => {
  it('扫一个 Next.js + Prisma 项目，输出 FeatureMap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapper-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'fake', dependencies: { next: '15.0.0', react: '19.0.0' },
      devDependencies: { prisma: '6.0.0' },
    }), 'utf8');
    await mkdir(join(root, 'app'), { recursive: true });
    await writeFile(join(root, 'app/page.tsx'), 'export default () => null', 'utf8');
    await mkdir(join(root, 'prisma'), { recursive: true });
    await writeFile(join(root, 'prisma/schema.prisma'), 'model User { id String @id }\n', 'utf8');

    let captured: FeatureMap | null = null;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<FeatureMap>('map.ready', (e) => { captured = e.payload; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper(), capture],
    });
    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();

    expect(captured).not.toBeNull();
    const map = captured!;
    expect(map.project.frameworks).toContain('nextjs');
    expect(map.data.length).toBeGreaterThanOrEqual(1);
  });

  it('loads .sentinel/app.map.ts overrides for project-specific flows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapper-override-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'override-app', dependencies: { next: '15.0.0', react: '19.0.0' },
    }), 'utf8');
    await mkdir(join(root, 'app'), { recursive: true });
    await writeFile(join(root, 'app/page.tsx'), 'export default () => null', 'utf8');
    await mkdir(join(root, '.sentinel'), { recursive: true });
    await writeFile(join(root, '.sentinel/app.map.ts'), `
      export default {
        flows: [
          {
            id: 'business.publish-comment',
            description: 'Publish and comment flow',
            steps: [
              { action: 'visit', url: '/login' },
              { action: 'visit', url: '/posts/new' },
              { action: 'click', selector: '[data-testid="publish"]' }
            ]
          }
        ]
      };
    `, 'utf8');

    let captured: FeatureMap | null = null;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<FeatureMap>('map.ready', (e) => { captured = e.payload; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper(), capture],
    });
    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();

    expect((captured as FeatureMap | null)?.flows.map((f) => f.id)).toEqual(['business.publish-comment']);
  });
  it('keeps auto-generated flows when the user override only contains an empty array', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapper-empty-override-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'empty-override-app', dependencies: { next: '15.0.0', react: '19.0.0' },
    }), 'utf8');
    await mkdir(join(root, 'app'), { recursive: true });
    await writeFile(join(root, 'app/page.tsx'), 'export default () => null', 'utf8');
    await mkdir(join(root, '.sentinel'), { recursive: true });
    // 模板占位：flows 键存在但内容为空，等于"用户没有覆盖"
    await writeFile(join(root, '.sentinel/app.map.ts'), `
      export default {
        flows: [
          // {
          //   id: 'critical.create-post',
          //   steps: [],
          // },
        ]
      };
    `, 'utf8');

    let captured: FeatureMap | null = null;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<FeatureMap>('map.ready', (e) => { captured = e.payload; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper(), capture],
    });
    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();

    const flows = (captured as FeatureMap | null)?.flows ?? [];
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.map((f) => f.id)).toContain('flow_page_page_0');
  });

  it('covers every public concrete route and reports unsafe coverage gaps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapper-coverage-'));
    const pages = Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, path: `/p${i}`, requiresAuth: false, criticalCTAs: [] as string[] }));
    pages.push({ id: 'private', path: '/private', requiresAuth: true, criticalCTAs: ['button'] });
    pages.push({ id: 'dynamic', path: '/posts/[id]', requiresAuth: false, criticalCTAs: [] });
    const api: ApiSpec[] = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, method: 'GET', path: `/api/a${i}`, requiresAuth: false }));
    api.push({ id: 'write', method: 'POST' as const, path: '/api/write', requiresAuth: false });
    let captured: FeatureMap | undefined;
    const capture: Subagent = { name: 'capture', register(ctx) {
      ctx.bus.subscribe<FeatureMap>('map.ready', e => { captured = e.payload; });
    } };
    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper({ adapters: [{
        name: 'fixture',
        async detect() { return true; },
        async routes() { return { pages, api }; },
        async auth() { return { type: 'session' as const, loginEndpoint: '/login' }; },
      }] }), capture],
    });
    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();
    expect(captured?.flows).toHaveLength(29);
    expect(captured?.flows.find(f => f.id === 'flow_page_p16')?.steps).toContainEqual({ action: 'assert', kind: 'url', expected: '/p16' });
    expect(captured?.flows.find(f => f.id === 'flow_api_a11')?.steps).toContainEqual({ action: 'assert', kind: 'api', method: 'GET', path: '/api/a11', expectStatus: '2xx' });
    expect(captured?.flows.some(f => f.id === 'flow_api_write')).toBe(false);
    expect(captured?.risks.map(r => r.id)).toEqual(expect.arrayContaining(['coverage_auth', 'coverage_page_private', 'coverage_page_dynamic', 'coverage_api_write', 'coverage_ui_content', 'coverage_api_body']));
  });

  it('app.map.ts 写坏了 → 必须报 map.failed，不能静默变成 0 页面 0 bug', async () => {
    // 以前 import 异常被 `catch { return base; }` 吞掉 —— 手写覆盖是
    // 非 Next 项目唯一的救济途径，它坏了却"成功"了，用户完全不知情。
    const root = await mkdtemp(join(tmpdir(), 'sentinel-mapper-bad-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'fake', dependencies: { next: '15.0.0', react: '19.0.0' },
    }), 'utf8');
    await mkdir(join(root, '.sentinel'), { recursive: true });
    await writeFile(join(root, '.sentinel', 'app.map.ts'), 'export default { pages: [ <<< syntax error', 'utf8');

    let ready: FeatureMap | null = null;
    let failure: { error: string } | null = null;
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<FeatureMap>('map.ready', (e) => { ready = e.payload; });
        ctx.bus.subscribe<{ error: string }>('map.failed', (e) => { failure = e.payload; });
      },
    };

    const kernel = new Kernel({
      providers: fakeProviders(),
      budget: new Budget({}),
      subagents: [createMapper(), capture],
    });
    await kernel.kick('project.scanned', { root }, 'test');
    await kernel.stop();

    expect(ready).toBeNull();
    expect(failure).not.toBeNull();
    expect(failure!.error).toContain('app.map.ts');
  });
});

// keep used import
void Bus;
