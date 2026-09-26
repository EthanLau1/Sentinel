/**
 * Executor subagent — 接收 fix.enhanced，按 Tier 决定动作。
 *
 * Tier 0: 仅报告
 * Tier 1: 生成低风险 patch（用户手动 git apply）
 * Tier 2: 写 patch 但不直接合并 → 写到 reports/patches/
 * Tier 3: 仅生成建议 → 写到 reports/suggestions/
 *
 * 红线：
 *   - 永远不直接 commit / push / 改 git
 *   - 写文件受 fs MCP 沙箱约束
 */

import type { Subagent, KernelContext, FixOption } from '@sentinel/core';

export function validPatch(patch: unknown): patch is string {
  if (typeof patch !== 'string' || !patch.trim()) return false;
  const lines = patch.trimEnd().split('\n').filter((line) => !/^(diff --git |index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$)/.test(line));
  let files = 0;
  for (let i = 0; i < lines.length;) {
    const old = /^--- a\/(.+)$/.exec(lines[i] ?? '');
    const next = /^\+\+\+ b\/(.+)$/.exec(lines[i + 1] ?? '');
    const target = old?.[1];
    if (!target || !next || target !== next[1] || target.split('/').some((part) => !part || part === '..' || part === '.')) return false;
    files += 1;
    i += 2;
    let hunks = 0;
    while (i < lines.length && !lines[i]!.startsWith('--- a/')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]!);
      if (!header) return false;
      let before = Number(header[2] ?? 1);
      let after = Number(header[4] ?? 1);
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('--- a/')) {
        const line = lines[i]!;
        if (line.startsWith(' ')) { before -= 1; after -= 1; }
        else if (line.startsWith('-')) before -= 1;
        else if (line.startsWith('+')) after -= 1;
        else if (line !== '\\ No newline at end of file') return false;
        if (before < 0 || after < 0) return false;
        i += 1;
      }
      if (before !== 0 || after !== 0) return false;
      hunks += 1;
    }
    if (!hunks) return false;
  }
  return files > 0;
}

export interface ExecutorConfig {
  /** 允许的最高 Tier（默认 1） */
  maxTier?: 0 | 1 | 2 | 3;
}

export function createExecutor(config: ExecutorConfig = {}): Subagent {
  const maxTier = config.maxTier ?? 1;

  return {
    name: 'executor',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<{ bug: import('@sentinel/core').BugFinding; options: FixOption[] }>('fix.enhanced', async (event) => {
        for (const opt of event.payload.options) {
          await ctx.bus.publish({
            type: 'executor.tier_decided',
            payload: { fixId: opt.id, tier: opt.tier },
            source: 'executor',
            traceId: event.traceId,
          });

          if (opt.tier > maxTier) continue;

          if (opt.tier === 0) continue;

          if (opt.tier === 1 && opt.patch) {
            await writeAutoPatchFile(ctx, opt, event.traceId);
          } else if (opt.tier === 2 && opt.patch) {
            await writePatchFile(ctx, opt, event.traceId);
          } else if (opt.tier === 3) {
            await writeSuggestion(ctx, opt, event.traceId);
          }
        }
      });
    },
  };
}

async function writeAutoPatchFile(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs || !validPatch(opt.patch) || !/^[a-zA-Z0-9_-]+$/.test(opt.id)) return;
  // Tier 1 仍不直接改源代码，只写到 .sentinel/auto-patches/<id>.diff，交给用户审核后 git apply。
  const path = `.sentinel/auto-patches/${opt.id}.diff`;
  try {
    const result = await fs.call('write', { path, content: opt.patch ?? '' });
    if (!result || typeof result !== 'object' || !('written' in result) || result.written !== true) return;
    await ctx.bus.publish({
      type: 'patch.generated',
      payload: { fixId: opt.id, files: [path], applied: false, approvalRequired: true },
      source: 'executor',
      traceId,
    });
  } catch {
    // 失败 → 仅报告，不抛
  }
}

async function writePatchFile(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs || !validPatch(opt.patch) || !/^[a-zA-Z0-9_-]+$/.test(opt.id)) return;
  const path = `reports/patches/${opt.id}.patch`;
  try {
    const result = await fs.call('write', { path, content: opt.patch ?? '' });
    if (!result || typeof result !== 'object' || !('written' in result) || result.written !== true) return;
    await ctx.bus.publish({
      type: 'patch.generated',
      payload: { fixId: opt.id, files: [path], applied: false, approvalRequired: true },
      source: 'executor',
      traceId,
    });
  } catch {
    // 忽略
  }
}

async function writeSuggestion(ctx: KernelContext, opt: FixOption, _traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return;
  const path = `reports/suggestions/${opt.id}.md`;
  const md = `# ${opt.title}\n\n${opt.description}\n\n**Tier 3 建议（不自动修复）**\n\n## 为什么\n${opt.whyRecommended ?? ''}\n`;
  try {
    await fs.call('write', { path, content: md });
  } catch {
    // 忽略
  }
}
