/**
 * Markdown SkillsLoader。
 *
 * Skill 格式：
 *   ---
 *   name: nextjs-debug
 *   trigger: "package.json contains next"
 *   authority: official | community | custom
 *   version: 1.0.0
 *   ---
 *
 *   markdown body...
 *
 * 自更新（refresh）：从配置的 GitHub repo URL 拉取最新版到 community/。
 */

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SkillContent, SkillMeta, SkillsLoader } from '@sentinel/core';

export interface MarkdownSkillsConfig {
  /** Skill 根目录，应包含 core/ community/ custom/ 子目录 */
  root: string;
  /** 自更新源（GitHub raw URL 或 zip） */
  remoteSources?: Array<{ name: string; url: string }>;
}

interface ParsedFrontmatter {
  meta: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = val;
    }
  }
  return { meta, body: m[2]!.trim() };
}

function inferAuthority(filePath: string): SkillMeta['authority'] {
  if (filePath.includes('/core/')) return 'core';
  if (filePath.includes('/community/')) return 'community';
  return 'custom';
}

export function createMarkdownSkills(config: MarkdownSkillsConfig): SkillsLoader {
  const root = resolve(config.root);

  async function listFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...(await listFiles(p)));
      else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
  }

  return {
    async list(): Promise<SkillMeta[]> {
      const files = await listFiles(root);
      const out: SkillMeta[] = [];
      for (const f of files) {
        const raw = await readFile(f, 'utf8');
        const { meta } = parseFrontmatter(raw);
        out.push({
          name: meta['name'] ?? f.split('/').pop()!.replace(/\.md$/, ''),
          authority: inferAuthority(f),
          version: meta['version'] ?? '0.0.0',
          ...(meta['trigger'] && { trigger: meta['trigger'] }),
        });
      }
      return out;
    },

    async load(name: string): Promise<SkillContent> {
      const files = await listFiles(root);
      for (const f of files) {
        const raw = await readFile(f, 'utf8');
        const { meta, body } = parseFrontmatter(raw);
        const skillName = meta['name'] ?? f.split('/').pop()!.replace(/\.md$/, '');
        if (skillName === name) {
          return {
            name: skillName,
            authority: inferAuthority(f),
            version: meta['version'] ?? '0.0.0',
            ...(meta['trigger'] && { trigger: meta['trigger'] }),
            body,
          };
        }
      }
      throw new Error(`Skill not found: ${name}`);
    },

    async refresh(): Promise<void> {
      if (!config.remoteSources || config.remoteSources.length === 0) return;
      const communityDir = join(root, 'community');
      if (!existsSync(communityDir)) await mkdir(communityDir, { recursive: true });

      for (const src of config.remoteSources) {
        try {
          const res = await fetch(src.url);
          if (!res.ok) continue;
          const text = await res.text();
          await writeFile(join(communityDir, `${src.name}.md`), text, 'utf8');
        } catch {
          // 单个源失败不影响其他
        }
      }
    },
  };
}
