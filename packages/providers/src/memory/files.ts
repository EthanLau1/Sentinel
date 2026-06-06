/**
 * 本地 Markdown 文件 Memory Provider。
 *
 * 用法：
 *   - 读取目录下所有 .md 文件作为知识库
 *   - recall(query) 用简单的关键词匹配返回相关段落
 *   - remember(fact) 追加到 daily-notes.md
 *
 * 这是最简单、最可移植、最能 git-track 的 memory 实现。
 */

import { readFile, readdir, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MemoryProvider } from '@sentinel/core';

export interface FilesMemoryConfig {
  /** 知识库根目录（绝对或相对路径） */
  root: string;
  /** 文件扩展名过滤（默认 .md） */
  extensions?: string[];
}

export function createFilesMemory(config: FilesMemoryConfig): MemoryProvider {
  const root = resolve(config.root);
  const exts = config.extensions ?? ['.md'];

  async function listFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await listFiles(path)));
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(path);
      }
    }
    return out;
  }

  return {
    name: 'files',

    async recall(query: string, limit = 5): Promise<string[]> {
      const files = await listFiles(root);
      if (files.length === 0) return [];

      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 2);
      const matches: { path: string; snippet: string; score: number }[] = [];

      for (const file of files) {
        const content = await readFile(file, 'utf8');
        const paragraphs = content.split(/\n\n+/);
        for (const p of paragraphs) {
          const lower = p.toLowerCase();
          let score = 0;
          for (const k of keywords) {
            if (lower.includes(k)) score += 1;
          }
          if (score > 0) {
            matches.push({ path: file, snippet: p.slice(0, 500), score });
          }
        }
      }

      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, limit).map((m) => `[${m.path}]\n${m.snippet}`);
    },

    async remember(fact: string, metadata?: Record<string, unknown>): Promise<void> {
      if (!existsSync(root)) await mkdir(root, { recursive: true });
      const file = join(root, 'daily-notes.md');
      const stamp = new Date().toISOString();
      const meta = metadata ? `\n  ${JSON.stringify(metadata)}` : '';
      await appendFile(file, `\n## ${stamp}\n\n${fact}${meta}\n`, 'utf8');
    },
  };
}
