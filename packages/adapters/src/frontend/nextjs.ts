import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Adapter, ProjectScan } from '../types.js';
import type { ApiSpec, PageSpec } from '@sentinel/core';

function depsContain(scan: ProjectScan, name: string): boolean {
  const pkg = scan.packageJson;
  if (!pkg) return false;
  const deps = { ...(pkg['dependencies'] as object), ...(pkg['devDependencies'] as object) };
  return name in (deps ?? {});
}

async function walkRoutes(
  base: string,
  prefix: string,
  isApiDir: boolean,
): Promise<Array<{ kind: 'page' | 'api'; path: string }>> {
  if (!existsSync(base)) return [];
  const out: Array<{ kind: 'page' | 'api'; path: string }> = [];
  const entries = await readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const full = join(base, e.name);
    if (e.isDirectory()) {
      const segName = e.name.startsWith('(') && e.name.endsWith(')') ? '' : e.name;
      const childPrefix = segName ? `${prefix}/${segName.replace(/^\[\.\.\.|^\[/, ':').replace(/\]$/, '')}` : prefix;
      const nested = await walkRoutes(full, childPrefix, isApiDir || e.name === 'api');
      out.push(...nested);
    } else if (e.isFile()) {
      if (e.name === 'page.tsx' || e.name === 'page.ts' || e.name === 'page.jsx' || e.name === 'page.js') {
        out.push({ kind: 'page', path: prefix || '/' });
      } else if (
        isApiDir &&
        (e.name === 'route.ts' || e.name === 'route.js' || e.name === 'route.tsx' || e.name === 'route.jsx')
      ) {
        out.push({ kind: 'api', path: prefix || '/' });
      }
    }
  }
  return out;
}

async function walkPagesDir(base: string, prefix: string): Promise<Array<{ kind: 'page' | 'api'; path: string }>> {
  if (!existsSync(base)) return [];
  const out: Array<{ kind: 'page' | 'api'; path: string }> = [];
  const entries = await readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_')) continue;
    const full = join(base, e.name);
    if (e.isDirectory()) {
      const child = `${prefix}/${e.name.replace(/^\[\.\.\.|^\[/, ':').replace(/\]$/, '')}`;
      out.push(...(await walkPagesDir(full, child)));
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !e.name.startsWith('_')) {
      const name = e.name.replace(/\.(tsx?|jsx?)$/, '');
      const segment = name === 'index' ? '' : `/${name}`;
      const path = `${prefix}${segment}` || '/';
      const isApi = path.startsWith('/api');
      out.push({ kind: isApi ? 'api' : 'page', path });
    }
  }
  return out;
}

export const nextjsAdapter: Adapter = {
  name: 'nextjs',

  async detect(scan: ProjectScan): Promise<boolean> {
    if (depsContain(scan, 'next')) return true;
    return scan.has('next.config.js') || scan.has('next.config.ts') || scan.has('next.config.mjs');
  },

  async profile(scan: ProjectScan) {
    const v = (scan.packageJson?.['dependencies'] as Record<string, string>)?.['next'];
    return {
      frameworks: ['nextjs'],
      ...(v && { stack: [`next@${v}`] }),
    };
  },

  async routes(scan: ProjectScan): Promise<{ pages?: PageSpec[]; api?: ApiSpec[] }> {
    const appDir = join(scan.root, 'app');
    const srcAppDir = join(scan.root, 'src/app');
    const pagesDir = join(scan.root, 'pages');
    const srcPagesDir = join(scan.root, 'src/pages');

    const collected: Array<{ kind: 'page' | 'api'; path: string }> = [];
    for (const root of [appDir, srcAppDir]) {
      if (existsSync(root) && (await stat(root)).isDirectory()) {
        collected.push(...(await walkRoutes(root, '', false)));
      }
    }
    for (const root of [pagesDir, srcPagesDir]) {
      if (existsSync(root) && (await stat(root)).isDirectory()) {
        collected.push(...(await walkPagesDir(root, '')));
      }
    }

    const pages: PageSpec[] = [];
    const api: ApiSpec[] = [];
    let i = 0;
    for (const r of collected) {
      if (r.kind === 'page') {
        pages.push({
          id: `page_${i++}`,
          path: r.path,
          requiresAuth: false,
          criticalCTAs: [],
        });
      } else {
        api.push({
          id: `api_${i++}`,
          method: 'GET',
          path: r.path,
          requiresAuth: false,
        });
      }
    }
    return { pages, api };
  },
};
