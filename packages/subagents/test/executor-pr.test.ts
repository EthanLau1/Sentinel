import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel, Budget, type ProviderSet, type Subagent, type BugFinding, type FixOption } from '@sentinel/core';
import { createExecutor } from '../src/executor.js';

/**
 * 批3 判据「真实项目生成 1 个 PR」的落地验证。
 *
 * 背景：executor 里原来写死了 `gh pr create --dry-run`，
 * 于是 CLI 的 `--create-pr` 传了也没用 —— 报告写着"已建 PR"，磁盘上什么都没有。
 * 这就是"报告说能做、实际没做"。
 *
 * 这里用**本地裸仓库**当远端 + **PATH 上的假 gh** 验证整条链路真的发生了：
 *   建独立分支 → 应用补丁 → 提交 → 推送分支 → gh pr create（不带 --dry-run）→ 切回原分支
 * 远端是真的 git 仓库，所以"推送有没有发生"是外部事实，不是自我声明。
 */

const SEMANTIC_PATCH = `--- a/app/page.tsx
+++ b/app/page.tsx
@@ -1,4 +1,4 @@
 // 占位
 export default function Page() {
-  return null;
+  return <main>fixed</main>;
 }
`;

const ORIGINAL = '// 占位\nexport default function Page() {\n  return null;\n}\n';

const bug: BugFinding = {
  id: 'b1', title: 'failure', severity: 'P1', source: 'ui', affectedFeature: 'flow_page_0',
  symptom: 'failure', reproSteps: ['run'], evidence: [], rootCauseStatus: 'confirmed',
  rootCause: 'broken', counterEvidence: [], confidence: 0.8, fixOptions: [],
};

function opt(over: Partial<FixOption> = {}): FixOption {
  return {
    id: 'fix_1', title: '修复首页渲染逻辑', description: '把首页渲染改成真实内容',
    effort: 'low', risk: 'low', runtimeCost: 'none', regressionRisk: 'low',
    maintenanceCost: 'low', stageFit: 'MVP', tier: 2, confidence: 0.8, score: 0.8,
    sources: [], patch: SEMANTIC_PATCH,
    ...over,
  } as FixOption;
}

function makeProviders(): ProviderSet {
  const fsTool = {
    name: 'fs',
    async call(_tool: string, args: Record<string, unknown>) {
      return { written: true, path: String(args['path'] ?? '') };
    },
  };
  return {
    llm: { name: 'fake', supportsTools: false, chat: async () => ({ content: '{}', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 }), estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw Error('unused'); }, async refresh() {} },
    mcp: {
      register() {}, unregister() {}, list() { return []; },
      get(name: string) { return name === 'fs' ? fsTool : undefined; },
    },
    knowledge: [],
  };
}

async function runExecutor(root: string | undefined) {
  const created: Array<{ fixId: string; title: string; url?: string; branch?: string }> = [];
  const rejected: Array<{ fixId: string; reason: string }> = [];
  const cap: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ fixId: string; title: string; url?: string; branch?: string }>('pr.created', (e) => { created.push(e.payload); });
      ctx.bus.subscribe<{ fixId: string; reason: string }>('patch.rejected', (e) => { rejected.push(e.payload); });
    },
  };
  const kernel = new Kernel({
    providers: makeProviders(),
    budget: new Budget({}),
    subagents: [
      createExecutor({ projectRoot: root, createPr: true, maxTier: 3 }),
      cap,
    ],
  });
  await kernel.kick('fix.enhanced', { bug: { ...bug, recommendedFixId: 'fix_1' }, options: [opt()] }, 'enhancer');
  await kernel.stop();
  return { created, rejected };
}

describe('批3 判据：真实建 PR（不是 --dry-run 演练）', () => {
  let base: string;
  let root: string;
  let remote: string;
  let bin: string;
  let ghLog: string;
  let oldPath: string | undefined;
  let oldLog: string | undefined;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sentinel-pr-'));
    root = join(base, 'project');
    remote = join(base, 'remote.git');
    bin = join(base, 'bin');
    ghLog = join(base, 'gh.log');
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(root, 'app', 'page.tsx'), ORIGINAL, 'utf8');

    execFileSync('git', ['init', '-q', '--bare', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
    execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: root });
    execFileSync('git', ['remote', 'set-head', 'origin', '-a'], { cwd: root });

    // 假 gh：把每次调用记进日志，再打印一个 PR 地址
    const stub = [
      '#!/bin/sh',
      'echo "$@" >> "$GH_LOG"',
      'if [ "$1" = "pr" ]; then echo "https://github.com/o/r/pull/42"; fi',
      'exit 0',
      '',
    ].join('\n');
    const ghPath = join(bin, 'gh');
    writeFileSync(ghPath, stub, 'utf8');
    chmodSync(ghPath, 0o755);

    oldPath = process.env['PATH'];
    oldLog = process.env['GH_LOG'];
    process.env['PATH'] = `${bin}:${oldPath ?? ''}`;
    process.env['GH_LOG'] = ghLog;
  });

  afterEach(() => {
    if (oldPath === undefined) delete process.env['PATH']; else process.env['PATH'] = oldPath;
    if (oldLog === undefined) delete process.env['GH_LOG']; else process.env['GH_LOG'] = oldLog;
    rmSync(base, { recursive: true, force: true });
  });

  it('真建 PR：分支推到了远端、gh pr create 被调用且不带 --dry-run', async () => {
    const { created, rejected } = await runExecutor(root);

    expect(rejected).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0]!.branch).toBe('sentinel/fix-fix_1');
    expect(created[0]!.url).toBe('https://github.com/o/r/pull/42');

    // 远端（真 git 仓库）里必须真的有这个分支和这个提交
    const remoteBranches = execFileSync('git', ['--git-dir', remote, 'branch', '--list'], { encoding: 'utf8' });
    expect(remoteBranches).toContain('sentinel/fix-fix_1');
    const remoteFile = execFileSync(
      'git', ['--git-dir', remote, 'show', 'sentinel/fix-fix_1:app/page.tsx'], { encoding: 'utf8' },
    );
    expect(remoteFile).toContain('fixed');

    // gh 的调用记录：必须是 pr create，且**没有** --dry-run
    const log = existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '';
    expect(log).toContain('pr create');
    expect(log).not.toContain('--dry-run');
    expect(log).toContain('--head sentinel/fix-fix_1');
  });

  it('用户的检出状态复原：切回原分支，工作区文件回到修复前', async () => {
    await runExecutor(root);
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    expect(branch).toBe('main');
    expect(readFileSync(join(root, 'app', 'page.tsx'), 'utf8')).toBe(ORIGINAL);
  });

  it('工作区有未提交改动时拒绝建 PR（不把用户的半成品混进 PR）', async () => {
    writeFileSync(join(root, 'app', 'page.tsx'), `${ORIGINAL}// 用户自己改的\n`, 'utf8');
    const { created, rejected } = await runExecutor(root);

    expect(created).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('未提交的改动');
    const log = existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '';
    expect(log).not.toContain('pr create');
  });

  it('不是 git 仓库时拒绝建 PR，并说明原因', async () => {
    const plain = join(base, 'plain');
    mkdirSync(plain, { recursive: true });
    const { created, rejected } = await runExecutor(plain);

    expect(created).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toContain('不是 git 仓库');
  });
});
