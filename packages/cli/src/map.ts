/**
 * sentinel map — 只跑 mapper，输出 FeatureMap 到 .sentinel/app.map.generated.json
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Budget, Kernel, type Subagent, type FeatureMap } from '@sentinel/core';
import { createMapper } from '@sentinel/subagents';
import {
  createMCPRegistry,
  createNoneMemory,
  createOpenAICompatibleProvider,
} from '@sentinel/providers';
import { color } from '@sentinel/reporters';
import { projectRoot, loadLlmConfig } from './config.js';

export async function runMap(): Promise<number> {
  const root = projectRoot();

  const llmCfg = await loadLlmConfig(root);
  const llm = llmCfg && llmCfg.providers[llmCfg.default]?.apiKey
    ? createOpenAICompatibleProvider({
        baseUrl: llmCfg.providers[llmCfg.default]!.baseUrl ?? '',
        apiKey: llmCfg.providers[llmCfg.default]!.apiKey ?? '',
        model: llmCfg.providers[llmCfg.default]!.model,
      })
    : {
        name: 'noop',
        supportsTools: false,
        async chat() {
          throw new Error('LLM not configured');
        },
        estimateCost: () => 0,
      };

  let captured: FeatureMap | null = null;
  const captureSub: Subagent = {
    name: 'map-capture',
    register(ctx) {
      ctx.bus.subscribe<FeatureMap>('map.ready', (e) => {
        captured = e.payload;
      });
    },
  };

  const kernel = new Kernel({
    providers: {
      llm,
      memory: createNoneMemory(),
      skills: { async list() { return []; }, async load() { throw new Error('no skills'); }, async refresh() {} },
      mcp: createMCPRegistry(),
      knowledge: [],
    },
    budget: new Budget({}),
    subagents: [createMapper(), captureSub],
  });

  await kernel.kick('project.scanned', { root }, 'cli');
  await kernel.stop();

  if (!captured) {
    console.error(color.red('✗ mapper produced no output'));
    return 1;
  }

  const dir = join(root, '.sentinel');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const out = join(dir, 'app.map.generated.json');
  await writeFile(out, JSON.stringify(captured, null, 2), 'utf8');

  const m = captured as FeatureMap;
  console.log(color.cyan('🗺  FeatureMap'));
  console.log(`  project:   ${m.project.name}`);
  console.log(`  runtime:   ${m.project.runtime}`);
  console.log(`  frameworks: ${m.project.frameworks.join(', ') || '(none detected)'}`);
  console.log(`  pages:     ${m.pages.length}`);
  console.log(`  api:       ${m.api.length}`);
  console.log(`  data:      ${m.data.length}`);
  console.log(`  flows:     ${m.flows.length}`);
  console.log('');
  console.log(color.green(`✓ wrote ${out}`));
  return 0;
}
