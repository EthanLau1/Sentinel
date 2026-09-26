import { describe, expect, it } from 'vitest';
import type { FlowSpec, KernelContext, MCPServer } from '@sentinel/core';
import { collectSourceEvidence } from '../src/source-evidence.js';

describe('source evidence', () => {
  it('finds a matching page and redacts simple secrets', async () => {
    const reads: string[] = [];
    const fs: MCPServer = { name: 'fs', tools: [], async call(_name, args) {
      const path = String(args['path']);
      reads.push(path);
      return path === 'app/settings/page.tsx'
        ? { exists: true, content: 'const token = "private-value";\nexport default function Page() { return null; }' }
        : { exists: false };
    } };
    const ctx = { providers: { mcp: { get: (name: string) => name === 'fs' ? fs : undefined } } } as unknown as KernelContext;
    const flow: FlowSpec = { id: 'settings', description: '', steps: [{ action: 'visit', url: '/settings' }] };
    const evidence = await collectSourceEvidence(ctx, flow);
    expect(reads).toContain('app/settings/page.tsx');
    expect(evidence?.kind).toBe('file');
    if (evidence?.kind === 'file') {
      expect(evidence.path).toBe('app/settings/page.tsx');
      expect(evidence.snippet).not.toContain('private-value');
    }
  });

  it('does not resolve external or traversal paths', async () => {
    const fs: MCPServer = { name: 'fs', tools: [], async call() { throw new Error('must not read'); } };
    const ctx = { providers: { mcp: { get: () => fs } } } as unknown as KernelContext;
    for (const url of ['https://elsewhere.test/', '/../../secret', '/settings/%2e%2e/secret']) {
      expect(await collectSourceEvidence(ctx, { id: 'unsafe', description: '', steps: [{ action: 'visit', url }] })).toBeNull();
    }
  });
});
