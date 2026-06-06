import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bus, Budget, Kernel, type Subagent, type FeatureMap, type ProviderSet } from '@sentinel/core';
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
});

// keep used import
void Bus;
