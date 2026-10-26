import { createHash } from 'node:crypto';
import type { Evidence, FlowSpec, KernelContext } from '@sentinel/core';

export async function collectSourceEvidence(ctx: KernelContext, flow: FlowSpec): Promise<Evidence | null> {
  const visit = flow.steps.find((step) => step.action === 'visit');
  const api = flow.steps.find((step) => step.action === 'assert' && step.kind === 'api');
  const route = visit?.action === 'visit' ? visit.url : api?.action === 'assert' && api.kind === 'api' ? api.path : undefined;
  if (!route) return null;
  return collectSourceEvidenceForRoute(ctx, route, !visit && Boolean(api));
}

/**
 * 按路由找源文件证据。
 *
 * 为什么要单独暴露一个"按路由"的版本：巡检器（inspector）拿到的是 URL，
 * 没有 FlowSpec。映射规则必须只有一份 —— runner 和巡检器各写一套必然漂移，
 * 然后出现"报告说定位到文件、实际是另一个文件"这种最难查的错。
 */
export async function collectSourceEvidenceForRoute(
  ctx: KernelContext,
  route: string,
  isApi = false,
): Promise<Evidence | null> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return null;
  if (!route.startsWith('/')) return null;
  const path = route.split('?')[0] ?? '';
  if (!/^\/[\w\-/]*$/.test(path) || path.includes('..')) return null;
  const stem = path.slice(1).replace(/\/$/, '');
  const bases = isApi
    ? ['app/' + stem + '/route', 'src/app/' + stem + '/route', 'pages/' + stem, 'src/pages/' + stem]
    : ['app/' + (stem ? stem + '/' : '') + 'page', 'src/app/' + (stem ? stem + '/' : '') + 'page',
        'pages/' + (stem || 'index'), 'src/pages/' + (stem || 'index')];

  for (const base of bases) {
    for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
      const file = base + '.' + ext;
      try {
        const result = await fs.call('read', { path: file }) as { exists?: boolean; content?: unknown };
        if (!result?.exists || typeof result.content !== 'string') continue;
        const lines = result.content.split('\n');
        const body = lines.slice(0, 80).join('\n').slice(0, 4000)
          .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi, '$1"<REDACTED>"');
        // 把"为什么是这个文件"写进证据：访问的 URL ↔ 命中的源文件。
        // 没有这一行，critic 无法把运行时现象和具体代码对上，因果链断在第一环。
        const snippet = `// 路由映射：访问 ${route} → ${file}\n${body}`;
        return {
          kind: 'file', source: 'fs', timestamp: Date.now(),
          hash: createHash('sha256').update(file + ':' + snippet).digest('hex').slice(0, 16),
          path: file, lineRange: [1, Math.min(lines.length, 80)], snippet,
        };
      } catch {
        // Keep the runtime failure even when the framework has no matching source file.
      }
    }
  }
  return null;
}
