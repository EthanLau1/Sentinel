import { describe, it, expect } from 'vitest';
import { Kernel, Budget, type ProviderSet, type Subagent, type BugFinding, type FixOption } from '@sentinel/core';
import { createExecutor, classifyTier } from '../src/executor.js';

/**
 * 宪法「Tier 2 自动写 patch，但需要人确认」× 实现是否真的产出产物。
 *
 * 背景（E16）：executor 的 maxTier 默认是 1，Tier 2 的分支整个被跳过 ——
 * 报告写着"Tier 2 — 写 patch 待审核"，磁盘上什么都没有。
 * 背景（E17）：跳过、写盘失败、patch 非法三条路径全是静默 return，
 * 事件发出去了却没有任何订阅者 → 载荷进黑洞，用户查不到原因。
 */

const RENAME_PATCH = `--- a/app/posts/page.tsx
+++ b/app/posts/page.tsx
@@ -9,7 +9,7 @@
     <main>
       <h1>Posts</h1>
       <ul>
-        {postList.map((p) => (
+        {posts.map((p) => (
           <li key={p.id}>{p.title}</li>
         ))}
       </ul>
`;

/** 语义改动（不是纯重命名）→ 硬规则判 Tier 2，走"写 patch 待审"通道 */
const SEMANTIC_PATCH = `--- a/app/page.tsx
+++ b/app/page.tsx
@@ -1,3 +1,7 @@
 export default function Page() {
-  return null;
+  return (
+    <main>
+      <h1>Home</h1>
+    </main>
+  );
 }
`;

interface FsCall { tool: string; args: Record<string, unknown> }

/** 假 fs provider：记录写入内容，可选抛错/返回 written=false */
function makeProviders(fsMode: 'ok' | 'no-written' | 'throw' | 'missing' = 'ok') {
  const calls: FsCall[] = [];
  const written = new Map<string, string>();
  const fsTool = {
    name: 'fs',
    async call(tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      if (fsMode === 'throw') throw new Error('disk full');
      if (fsMode === 'no-written') return { path: String(args['path']) };
      written.set(String(args['path']), String(args['content'] ?? ''));
      return { written: true, path: String(args['path']) };
    },
  };
  const providers: ProviderSet = {
    llm: { name: 'fake', supportsTools: false, chat: async () => ({ content: '{}', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }), estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw Error('unused'); }, async refresh() {} },
    mcp: {
      register() {}, unregister() {}, list() { return []; },
      get(name: string) { return fsMode === 'missing' || name !== 'fs' ? undefined : fsTool; },
    },
    knowledge: [],
  };
  return { providers, calls, written };
}

const bug: BugFinding = {
  id: 'b1', title: 'failure', severity: 'P1', source: 'ui', affectedFeature: 'flow_page_0',
  symptom: 'failure', reproSteps: ['run'], evidence: [], rootCauseStatus: 'confirmed',
  rootCause: 'broken', counterEvidence: [], confidence: 0.8, fixOptions: [],
};

function opt(over: Partial<FixOption> = {}): FixOption {
  return {
    id: 'fix_1', title: 'fix', description: 'change', effort: 'low', risk: 'low',
    runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
    stageFit: 'MVP', tier: 2, confidence: 0.8, score: 0.8, sources: [],
    ...over,
  } as FixOption;
}

/** 收集 patch.generated / patch.rejected 两个事件的载荷 */
function collector() {
  const generated: Array<{ fixId: string; files: string[] }> = [];
  const rejected: Array<{ fixId: string; reason: string }> = [];
  const sub: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ fixId: string; files: string[] }>('patch.generated', (e) => { generated.push(e.payload); });
      ctx.bus.subscribe<{ fixId: string; reason: string }>('patch.rejected', (e) => { rejected.push(e.payload); });
    },
  };
  return { generated, rejected, sub };
}

async function run(
  options: FixOption[],
  cfg: { fsMode?: 'ok' | 'no-written' | 'throw' | 'missing'; maxTier?: 0 | 1 | 2 | 3 } = {},
) {
  const { providers, written } = makeProviders(cfg.fsMode ?? 'ok');
  const cap = collector();
  const kernel = new Kernel({
    providers,
    budget: new Budget({}),
    subagents: [createExecutor({ maxTier: cfg.maxTier }), cap.sub],
  });
  await kernel.kick('fix.enhanced', { bug, options }, 'enhancer');
  return { ...cap, written };
}

describe('E16 — Tier 2 产物必须真的落盘', () => {
  it('默认 maxTier 下 Tier 2 会写出 patch 文件并发 patch.generated', async () => {
    const { generated, written } = await run([opt({ patch: SEMANTIC_PATCH })]);
    expect(generated).toHaveLength(1);
    expect(generated[0]!.files[0]).toBe('reports/patches/fix_1.patch');
    expect(written.get('reports/patches/fix_1.patch')).toBe(SEMANTIC_PATCH);
  });

  it('maxTier 显式收窄到 1 时，Tier 2 被拦下且必须说明原因（不能静默跳过）', async () => {
    const { generated, rejected } = await run([opt({ patch: SEMANTIC_PATCH })], { maxTier: 1 });
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('maxTier=1');
  });
});

describe('E17 — 过程信息必须有出口', () => {
  it('fs provider 缺失 → 发 patch.rejected，而不是静默返回', async () => {
    const { generated, rejected } = await run([opt({ patch: SEMANTIC_PATCH })], { fsMode: 'missing' });
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('fs provider 不可用');
  });

  it('写盘抛错 → 发 patch.rejected 并带上错误信息', async () => {
    const { generated, rejected } = await run([opt({ patch: SEMANTIC_PATCH })], { fsMode: 'throw' });
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('disk full');
  });

  it('写盘没返回 written=true → 发 patch.rejected', async () => {
    const { generated, rejected } = await run([opt({ patch: SEMANTIC_PATCH })], { fsMode: 'no-written' });
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('written=true');
  });

  it('Tier 2 但 LLM 没给 patch → 也要说出来（报告不能写"待审核"却无产物）', async () => {
    const { generated, rejected } = await run([opt({})]);
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('没有可用 patch');
  });

  it('patch 格式非法 → 发 patch.rejected 并说明是格式问题', async () => {
    const { generated, rejected } = await run([opt({ patch: 'not a diff at all' })]);
    expect(generated).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('格式非法');
  });
});

describe('Tier 判定与产物的一致性', () => {
  it('Tier 判定为 3 的方案不写 patch 文件（只建议）', async () => {
    const { generated } = await run([opt({ tier: 3, title: '重构数据库迁移', patch: RENAME_PATCH })]);
    expect(generated).toHaveLength(0);
  });

  it('纯重命名 patch 被判 Tier 1 → 走 auto-patch 通道而不是 Tier 2 patch 通道', () => {
    const d = classifyTier(opt({ tier: 1, title: '在 app/posts/page.tsx 中改用 posts.map 渲染', patch: RENAME_PATCH }));
    expect(d.tier).toBe(1);
    expect(d.reason).toContain('补丁形状');
  });
});
