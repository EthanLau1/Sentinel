import { createHash } from 'node:crypto';
import type { Evidence, FlowSpec, KernelContext } from '@sentinel/core';

export async function collectSourceEvidence(ctx: KernelContext, flow: FlowSpec): Promise<Evidence | null> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return null;
  const visit = flow.steps.find((step) => step.action === 'visit');
  const api = flow.steps.find((step) => step.action === 'assert' && step.kind === 'api');
  const route = visit?.action === 'visit' ? visit.url : api?.action === 'assert' && api.kind === 'api' ? api.path : undefined;
  if (!route?.startsWith('/')) return null;
  const path = route.split('?')[0] ?? '';
  if (!/^\/[\w\-/]*$/.test(path) || path.includes('..')) return null;
  const stem = path.slice(1).replace(/\/$/, '');
  const isApi = !visit && Boolean(api);
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
        const snippet = lines.slice(0, 80).join('\n').slice(0, 4000)
          .replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)(["'`])[^"'`\r\n]*\2/gi, '$1"<REDACTED>"');
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
