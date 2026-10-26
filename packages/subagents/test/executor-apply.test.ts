import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, Budget, type ProviderSet, type Subagent, type BugFinding, type FixOption } from '@sentinel/core';
import { createExecutor, expandZeroContextHunks, validPatch } from '../src/executor.js';

/**
 * L3 闭环的端到端验证（不依赖 LLM）：
 *   Tier 硬规则判定 → 应用 patch → 重跑失败 → 自动回滚
 *
 * 为什么要独立测：真实 run 里 planner 产出的方案几乎不会命中低风险规则，
 * 所以"自动改码"路径在真实项目上很难自然触发。
 * 这里用构造的输入直接验证机制本身是否成立。
 */

const PATCH = `--- a/app/page.tsx
+++ b/app/page.tsx
@@ -1,4 +1,4 @@
 // 占位
 export default function Page() {
-  return null;
+  return <main>fixed</main>;
 }
`;

function makeProviders(): ProviderSet {
  return {
    llm: { name: 'fake', supportsTools: false, chat: async () => ({ content: '{}', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }), estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

const bug: BugFinding = {
  id: 'b1', title: 'failure', severity: 'P1', source: 'ui', affectedFeature: 'flow_page_0',
  symptom: 'failure', reproSteps: ['run'], evidence: [], rootCauseStatus: 'confirmed',
  rootCause: 'broken', counterEvidence: [], confidence: 0.8, fixOptions: [],
};

describe('L3 闭环：应用 → 验证失败 → 回滚', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sentinel-exec-'));
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(
      join(root, 'app', 'page.tsx'),
      '// 占位\nexport default function Page() {\n  return null;\n}\n',
      'utf8',
    );
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('Tier 1 方案被真正应用（改的是被测项目源码）', async () => {
    const applied: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ files: string[] }>('patch.applied', (e) => { applied.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [], patch: PATCH,
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(applied).toHaveLength(1);
    const content = readFileSync(join(root, 'app', 'page.tsx'), 'utf8');
    expect(content).toContain('return <main>fixed</main>;');
  });

  it('修复后重跑仍失败 → 自动回滚，文件内容还原', async () => {
    const reverted: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ files: string[] }>('patch.reverted', (e) => { reverted.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [], patch: PATCH,
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('<main>fixed</main>');

    // 模拟"修复后重跑该 flow 仍然失败"
    await kernel.kick(
      'flow.failed',
      { flowId: 'flow_page_0', error: 'still failing', evidence: [], phase: 'after-fix', patchId: 'fix_1' },
      'runner',
    );

    expect(reverted).toHaveLength(1);
    const content = readFileSync(join(root, 'app', 'page.tsx'), 'utf8');
    expect(content).toContain('return null;');
    expect(content).not.toContain('<main>fixed</main>');
  });

  it('默认不自动改用户代码（autoApply 关闭时只落盘 patch）', async () => {
    const applied: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe('patch.applied', (e) => { applied.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [], patch: PATCH,
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(applied).toHaveLength(0);
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('return null;');
  });

  it('patch 应用失败 → 发 patch.rejected，不改文件', async () => {
    const rejected: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe('patch.rejected', (e) => { rejected.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      // 格式合法但上下文对不上 → git apply --check 会失败
      patch: '--- a/app/page.tsx\n+++ b/app/page.tsx\n@@ -1 +1 @@\n-nonexistent line\n+new\n',
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(rejected).toHaveLength(1);
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('return null;');
  });

  it('格式非法的 patch → 报 patch.rejected，不静默丢掉', async () => {
    const rejected: Array<{ reason?: string }> = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ reason?: string }>('patch.rejected', (e) => { rejected.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      patch: 'this is not a diff at all',
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('格式非法');
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('return null;');
  });

  it('E24：patch 缺结尾换行 → 仍然被真正应用（git apply 会报 corrupt patch）', async () => {
    const applied: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ files: string[] }>('patch.applied', (e) => { applied.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      // 和 LLM 真实产出的一样：最后一行没有换行
      patch: PATCH.replace(/\n$/, ''),
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(applied).toHaveLength(1);
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('return <main>fixed</main>;');
  });

  it('E25：零上下文的 patch（LLM 改一行的常见形态）→ 补上下文后真的被应用', async () => {
    const applied: unknown[] = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ files: string[] }>('patch.applied', (e) => { applied.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'fix typo', description: 'fix the typo', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      // 零上下文：只有 -/+ 一行，没有任何上下文行 —— git 默认不认这种 diff
      patch: '--- a/app/page.tsx\n+++ b/app/page.tsx\n@@ -3,1 +3,1 @@\n-  return null;\n+  return <main>fixed</main>;\n',
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(applied).toHaveLength(1);
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toContain('return <main>fixed</main>;');
  });

  it('E25：零上下文补丁补上下文后仍是合法 diff（上下文取自真实文件）', async () => {
    const zeroCtx = '--- a/app/page.tsx\n+++ b/app/page.tsx\n@@ -3,1 +3,1 @@\n-  return null;\n+  return <main>fixed</main>;\n';
    const expanded = await expandZeroContextHunks(root, zeroCtx);
    expect(expanded).toContain('@@ -1,4 +1,4 @@');
    // 补出来的上下文必须来自真实文件，不能是编的
    expect(expanded).toContain(' // 占位');
    expect(expanded).toContain(' }');
    expect(validPatch(expanded)).toBe(true);
  });

  it('E25：文件不存在时保持原样（不猜内容，交给 git 报错）', async () => {
    const zeroCtx = '--- a/app/missing.ts\n+++ b/app/missing.ts\n@@ -3,1 +3,1 @@\n-a\n+b\n';
    const expanded = await expandZeroContextHunks(root, zeroCtx);
    expect(expanded).toBe(zeroCtx);
  });

  it('白名单外的文件被拒绝（不越界改）', async () => {
    const rejected: Array<{ reason?: string }> = [];
    const capture: Subagent = {
      name: 'capture',
      register(ctx) {
        ctx.bus.subscribe<{ reason?: string }>('patch.rejected', (e) => { rejected.push(e.payload); });
      },
    };
    const option = {
      id: 'fix_1', title: 'format page', description: 'format the page', effort: 'low', risk: 'low',
      runtimeCost: 'none', regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: 1, confidence: 0.9, score: 0.8, sources: [],
      patch: '--- a/src/data.bin\n+++ b/src/data.bin\n@@ -1 +1 @@\n-A=1\n+B=2\n',
    } as FixOption;

    const kernel = new Kernel({
      providers: makeProviders(),
      budget: new Budget({}),
      subagents: [createExecutor({ projectRoot: root, autoApply: true }), capture],
    });
    await kernel.kick('fix.enhanced', { bug, options: [option] }, 'enhancer');

    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('白名单');
  });
});
