/**
 * Executor subagent — 接收 fix.enhanced，按 Tier 决定动作。
 *
 * Tier 0: 仅报告
 * Tier 1: 自动修（生成 .sentinel/app.map.ts、修格式等）
 * Tier 2: 写 patch 但不直接合并 → 写到 reports/patches/
 * Tier 3: 仅生成建议 → 写到 reports/suggestions/
 *
 * 红线：
 *   - 永远不直接 commit / push / 改 git
 *   - 写文件受 fs MCP 沙箱约束
 */

import type { Subagent, KernelContext, FixOption } from '@sentinel/core';

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
            await applyPatch(ctx, opt, event.traceId);
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

async function applyPatch(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return;
  // Tier 1 路径：写到 .sentinel/auto-patches/<id>.diff
  const path = `.sentinel/auto-patches/${opt.id}.diff`;
  try {
    await fs.call('write', { path, content: opt.patch ?? '' });
    await ctx.bus.publish({
      type: 'patch.applied',
      payload: { fixId: opt.id, files: [path] },
      source: 'executor',
      traceId,
    });
  } catch {
    // 失败 → 仅报告，不抛
  }
}

async function writePatchFile(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return;
  const path = `reports/patches/${opt.id}.patch`;
  try {
    await fs.call('write', { path, content: opt.patch ?? '' });
    await ctx.bus.publish({
      type: 'patch.applied',
      payload: { fixId: opt.id, files: [path] },
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
