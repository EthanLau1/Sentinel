#!/usr/bin/env bun
/**
 * End-to-end smoke: 在 Sentinel 自己的项目上跑 mapper，验证识别。
 */

import { Bus, Budget, Kernel } from '../packages/core/src/index.ts';
import { createMapper } from '../packages/subagents/src/mapper.ts';
import { createMCPRegistry, createNoneMemory } from '../packages/providers/src/index.ts';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

const captured = { map: null };
const captureSub = {
  name: 'capture',
  register(ctx) {
    ctx.bus.subscribe('map.ready', (e) => {
      captured.map = e.payload;
    });
  },
};

const fakeLLM = {
  name: 'fake', supportsTools: false,
  async chat() { return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }; },
  estimateCost: () => 0,
};

const kernel = new Kernel({
  providers: {
    llm: fakeLLM,
    memory: createNoneMemory(),
    skills: { async list() { return []; }, async load() { throw new Error('x'); }, async refresh() {} },
    mcp: createMCPRegistry(),
    knowledge: [],
  },
  budget: new Budget({}),
  subagents: [createMapper(), captureSub],
});

await kernel.kick('project.scanned', { root }, 'cli');
await kernel.stop();

if (!captured.map) {
  console.error('✗ no FeatureMap produced');
  process.exit(1);
}

const m = captured.map;
console.log('✓ mapper ran on Sentinel itself');
console.log(`  project:    ${m.project.name}`);
console.log(`  runtime:    ${m.project.runtime}`);
console.log(`  packageManager: ${m.project.packageManager}`);
console.log(`  frameworks: [${m.project.frameworks.join(', ') || '(none)'}]`);
console.log(`  pages:      ${m.pages.length}`);
console.log(`  api:        ${m.api.length}`);
console.log(`  data:       ${m.data.length}`);
console.log(`  flows:      ${m.flows.length}`);
console.log(`  risks:      ${m.risks.length}`);

// Bus 不应该有未消费的事件
void Bus;
