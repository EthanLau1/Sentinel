import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectScan } from '../src/scan.js';
import type { Adapter } from '../src/types.js';

import { reactAdapter } from '../src/frontend/react.js';
import { vueAdapter } from '../src/frontend/vue.js';
import { svelteAdapter } from '../src/frontend/svelte.js';
import { expressAdapter } from '../src/backend/express.js';
import { honoAdapter } from '../src/backend/hono.js';
import { nestAdapter } from '../src/backend/nest.js';
import { trpcAdapter } from '../src/backend/trpc.js';
import { drizzleAdapter } from '../src/data/drizzle.js';
import { supabaseAdapter } from '../src/data/supabase.js';
import { langchainAdapter } from '../src/llm-app/langchain.js';
import { vercelAiSdkAdapter } from '../src/llm-app/vercel-ai-sdk.js';

/**
 * 每个 adapter 的**检测语义**都被钉住。
 *
 * 为什么值得钉：这些 adapter 各自判断"这个项目用没用这个栈"，
 * 判定口径不一致（有的查 devDependencies，有的不查；有的认别名），
 * 一旦有人改了口径，mapper 就会漏掉项目 —— 而这种漏是静默的。
 *
 * 口径表（从实现里读出来的事实，不是猜的）：
 *   - frontend 三件套 + drizzle：dependencies **和** devDependencies 都查
 *   - backend / data / llm-app：只查 dependencies
 *   - 别名：vue→nuxt，svelte→@sveltejs/kit，trpc→@trpc/server|@trpc/client，
 *           langchain→@langchain/core
 */

interface Case {
  adapter: Adapter;
  /** 依赖名 */
  dep: string;
  /** 依赖名别名（认就算命中） */
  alt?: string;
  /** devDependencies 里算不算 */
  inDev: boolean;
  /** profile().frameworks 期望值 */
  framework: string;
}

const CASES: Case[] = [
  { adapter: reactAdapter, dep: 'react', inDev: true, framework: 'react' },
  { adapter: vueAdapter, dep: 'vue', alt: 'nuxt', inDev: true, framework: 'vue' },
  { adapter: svelteAdapter, dep: 'svelte', alt: '@sveltejs/kit', inDev: true, framework: 'svelte' },
  { adapter: expressAdapter, dep: 'express', inDev: false, framework: 'express' },
  { adapter: honoAdapter, dep: 'hono', inDev: false, framework: 'hono' },
  { adapter: nestAdapter, dep: '@nestjs/core', inDev: false, framework: 'nestjs' },
  { adapter: trpcAdapter, dep: '@trpc/server', alt: '@trpc/client', inDev: false, framework: 'trpc' },
  { adapter: drizzleAdapter, dep: 'drizzle-orm', inDev: true, framework: 'drizzle' },
  { adapter: supabaseAdapter, dep: '@supabase/supabase-js', inDev: false, framework: 'supabase' },
  { adapter: langchainAdapter, dep: 'langchain', alt: '@langchain/core', inDev: false, framework: 'langchain' },
  { adapter: vercelAiSdkAdapter, dep: 'ai', inDev: false, framework: 'vercel-ai-sdk' },
];

async function scanWith(pkg: Record<string, unknown> | undefined) {
  const root = await mkdtemp(join(tmpdir(), 'sentinel-adapter-'));
  if (pkg) {
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
  }
  return createProjectScan(root);
}

describe.each(CASES)('$adapter.name adapter', (c) => {
  it('没有 package.json → 不识别', async () => {
    const scan = await scanWith(undefined);
    expect(await c.adapter.detect(scan)).toBe(false);
  });

  it('dependencies 里有对应依赖 → 识别', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { [c.dep]: '1.0.0' } });
    expect(await c.adapter.detect(scan)).toBe(true);
  });

  it('只有无关依赖 → 不识别', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { 'left-pad': '1.0.0' } });
    expect(await c.adapter.detect(scan)).toBe(false);
  });

  it('devDependencies 里的口径按实现固定（不随改动漂移）', async () => {
    const scan = await scanWith({ name: 'x', devDependencies: { [c.dep]: '1.0.0' } });
    expect(await c.adapter.detect(scan)).toBe(c.inDev);
  });

  it('profile 报告的框架名固定', async () => {
    expect((await c.adapter.profile?.({} as never))?.frameworks).toEqual([c.framework]);
  });
});

describe('adapter 别名', () => {
  it('vue 认 nuxt', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { nuxt: '3.0.0' } });
    expect(await vueAdapter.detect(scan)).toBe(true);
  });

  it('svelte 认 @sveltejs/kit', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { '@sveltejs/kit': '2.0.0' } });
    expect(await svelteAdapter.detect(scan)).toBe(true);
  });

  it('trpc 认 @trpc/client', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { '@trpc/client': '11.0.0' } });
    expect(await trpcAdapter.detect(scan)).toBe(true);
  });

  it('langchain 认 @langchain/core', async () => {
    const scan = await scanWith({ name: 'x', dependencies: { '@langchain/core': '0.3.0' } });
    expect(await langchainAdapter.detect(scan)).toBe(true);
  });
});

describe('adapter 名称唯一（mapper 按名字归组，重名会覆盖）', () => {
  it('11 个 adapter 的 name 互不相同', () => {
    const names = CASES.map((c) => c.adapter.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
