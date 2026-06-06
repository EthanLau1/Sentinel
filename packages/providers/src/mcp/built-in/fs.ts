/**
 * FS MCP Server — 文件系统读 + 受限写。
 *
 * 红线：
 *   - 默认只读
 *   - 写入受沙箱限制（permissions.yml allowedPaths）
 *   - 不允许跨越 root 边界
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { MCPServer } from '@sentinel/core';

export interface FsMCPConfig {
  /** 工作根，所有路径必须在此之下 */
  root: string;
  /** 允许写入的相对路径 prefix（沙箱） */
  writableSubdirs?: string[];
}

export function createFsMCPServer(config: FsMCPConfig): MCPServer {
  const root = resolve(config.root);
  const writable = (config.writableSubdirs ?? ['.sentinel', 'reports', 'benchmarks']).map((p) =>
    resolve(root, p),
  );

  function ensureInRoot(path: string): string {
    const abs = resolve(root, path);
    const rel = relative(root, abs);
    if (rel.startsWith('..') || rel.includes(`..${join('')}`)) {
      throw new Error(`Path escapes root: ${path}`);
    }
    return abs;
  }

  function ensureWritable(absPath: string): void {
    const allowed = writable.some((w) => absPath.startsWith(w));
    if (!allowed) throw new Error(`Path not in writable sandbox: ${absPath}`);
  }

  return {
    name: 'fs',
    tools: [
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
      { name: 'list', description: 'List directory', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
      { name: 'exists', description: 'Check existence', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } },
      { name: 'write', description: 'Write a file (sandboxed)', inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
    ],

    async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      const path = String(args['path']);
      switch (toolName) {
        case 'read': {
          const abs = ensureInRoot(path);
          if (!existsSync(abs)) return { exists: false, content: null };
          const s = await stat(abs);
          if (s.isDirectory()) throw new Error(`Not a file: ${path}`);
          const content = await readFile(abs, 'utf8');
          return { exists: true, content, size: s.size };
        }
        case 'list': {
          const abs = ensureInRoot(path);
          if (!existsSync(abs)) return [];
          const entries = await readdir(abs, { withFileTypes: true });
          return entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          }));
        }
        case 'exists': {
          const abs = ensureInRoot(path);
          return { exists: existsSync(abs) };
        }
        case 'write': {
          const abs = ensureInRoot(path);
          ensureWritable(abs);
          const dir = abs.substring(0, abs.lastIndexOf('/'));
          if (!existsSync(dir)) await mkdir(dir, { recursive: true });
          const content = String(args['content'] ?? '');
          await writeFile(abs, content, 'utf8');
          return { written: true, path: abs };
        }
        default:
          throw new Error(`Unknown fs tool: ${toolName}`);
      }
    },
  };
}
