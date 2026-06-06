/**
 * ProjectScan 工厂 — 给所有 adapter 提供统一的项目读取接口。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectScan } from './types.js';

export async function createProjectScan(rootPath: string): Promise<ProjectScan> {
  const root = resolve(rootPath);
  let packageJson: Record<string, unknown> | undefined;

  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const text = await readFile(pkgPath, 'utf8');
      packageJson = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // 损坏的 package.json 不阻塞 scan
    }
  }

  return {
    root,
    ...(packageJson && { packageJson }),
    has(rel: string): boolean {
      return existsSync(join(root, rel));
    },
    async read(rel: string): Promise<string | null> {
      const p = join(root, rel);
      if (!existsSync(p)) return null;
      const s = statSync(p);
      if (s.isDirectory()) return null;
      return readFile(p, 'utf8');
    },
    async list(rel: string): Promise<string[]> {
      const p = join(root, rel);
      if (!existsSync(p)) return [];
      const s = statSync(p);
      if (!s.isDirectory()) return [];
      return readdirSync(p);
    },
  };
}
