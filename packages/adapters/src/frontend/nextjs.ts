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

/**
 * 两种路由器的目录语义完全不同 —— **先判是哪一种，再套约定**。
 *
 * App Router（`app/`、`src/app/`）额外支持三种"不进 URL 的目录名"：
 *   - 路由组 `(group)`：只做目录组织，不算路由段
 *   - 并行槽 `@slot`：渲染在父路径上，**也不算路由段**
 *   - 拦截路由 `(.)x` / `(..)x` / `(...)x`：拦截的是别的路径，自身不是独立页面
 *   （依据：Next.js 官方文档 Intercepting Routes / Route Groups）
 *
 * Pages Router（`pages/`、`src/pages/`）**没有**这些约定：
 *   文件路径就是 URL 路径 —— 官方原话 "Each page is associated with a route based on
 *   its file name" / "nested folder structure ... routed in the same way"。
 *   所以 `pages/(marketing)/about.tsx` 的真实地址是 `/(marketing)/about`，
 *   剥离它会访问到不存在的页面。
 */
type RouterMode = 'app' | 'pages';

/**
 * 一个文件系统段名解析后的结果。
 *
 * 解析集中在这里定义一次，两种路由树共用 ——
 * 免得各写一遍各错一遍（上一版就是 pages 漏了路由组、app 漏了并行槽）。
 */
type Segment =
  /** 静态段：about */
  | { kind: 'static'; value: string }
  /** 动态段：[id] → :id */
  | { kind: 'dynamic'; value: string }
  /** 捕获段：[...slug] → :slug */
  | { kind: 'catchall'; value: string }
  /** 可选捕获段：[[...slug]] → :slug* */
  | { kind: 'optional'; value: string }
  /** 路由组：(group) —— 只做目录组织，不进 URL（仅 App Router） */
  | { kind: 'group' }
  /** 并行路由槽：@modal —— 页面渲染在父路径上，槽名本身不进 URL（仅 App Router） */
  | { kind: 'slot' }
  /**
   * 拦截路由：(.)x / (..)x / (…)x（仅 App Router）。
   * up = 要往上退几个**路由段**（路由组和并行槽都不算段）。
   */
  | { kind: 'intercept'; up: number; value: string };

/**
 * 解析一个段名（目录名，或去掉扩展名的页面文件名）。
 *
 * 顺序很关键：拦截路由必须先于路由组判断，
 * 否则 "(.)photo" 会被当成路由组整个丢掉，拦截语义直接消失。
 */
function parseSegment(name: string, mode: RouterMode): Segment {
  // Pages Router 没有 App Router 的那三种约定 —— 目录名/文件名就是 URL 段。
  if (mode === 'pages') {
    if (name.startsWith('[[') && name.endsWith(']]')) {
      return { kind: 'optional', value: name.slice(2, -2).replace(/^\.\.\./, '') };
    }
    if (name.startsWith('[') && name.endsWith(']')) {
      const inner = name.slice(1, -1);
      if (inner.startsWith('...')) return { kind: 'catchall', value: inner.slice(3) };
      return { kind: 'dynamic', value: inner };
    }
    return { kind: 'static', value: name };
  }

  // 并行路由槽：@modal
  if (name.startsWith('@')) return { kind: 'slot' };

  // 拦截路由：(.)x / (..)x / (...)x，也支持叠加：(..)(..)x
  const intercept = /^((?:\(\.{1,3}\))+)(.+)$/.exec(name);
  if (intercept) {
    const groups = intercept[1]?.match(/\(\.{1,3}\)/g) ?? [];
    let up = 0;
    for (const g of groups) {
      const dots = g.slice(1, -1);
      // 官方语义：(.) 同级 · (..) 上一级 · (..)(..) 上两级 · (...) 从根目录起
      if (dots.length === 3) up = Number.POSITIVE_INFINITY;
      else up += dots.length - 1;
    }
    return { kind: 'intercept', up, value: intercept[2] ?? '' };
  }

  // 路由组：(marketing)
  if (name.startsWith('(') && name.endsWith(')')) return { kind: 'group' };

  // 可选捕获段：[[...slug]]
  if (name.startsWith('[[') && name.endsWith(']]')) {
    return { kind: 'optional', value: name.slice(2, -2).replace(/^\.\.\./, '') };
  }

  // 动态段 [id] / 捕获段 [...slug]
  if (name.startsWith('[') && name.endsWith(']')) {
    const inner = name.slice(1, -1);
    if (inner.startsWith('...')) return { kind: 'catchall', value: inner.slice(3) };
    return { kind: 'dynamic', value: inner };
  }

  return { kind: 'static', value: name };
}

/**
 * 把一段加进 URL 段列表（原地修改）。
 *
 * - 路由组 / 并行槽：原地丢弃，子目录继承父路径
 * - 拦截路由：先按路由段往上退，再放真实段
 */
function pushSegment(url: string[], seg: Segment, mode: RouterMode): void {
  if (seg.kind === 'group' || seg.kind === 'slot') return;

  if (seg.kind === 'intercept') {
    const up = seg.up === Number.POSITIVE_INFINITY ? url.length : Math.min(seg.up, url.length);
    url.splice(url.length - up, up);
    pushSegment(url, parseSegment(seg.value, mode), mode);
    return;
  }

  if (seg.kind === 'static') url.push(seg.value);
  else if (seg.kind === 'dynamic' || seg.kind === 'catchall') url.push(`:${seg.value}`);
  else url.push(`:${seg.value}*`);
}

/** URL 段列表 → 路径；空列表就是根路径 */
function toPath(url: string[]): string {
  return url.length ? `/${url.join('/')}` : '/';
}

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];
const ROUTE_FILES = ['route.ts', 'route.js', 'route.tsx', 'route.jsx'];

/** 收集到的一条路由（带来源标记：并行槽产出的不算独立可访问地址） */
interface CollectedRoute {
  kind: 'page' | 'api';
  path: string;
  /** 来自并行槽 —— 只有父路径本身有真页面时才可访问 */
  fromSlot: boolean;
}

/**
 * 遍历 App Router 目录树（app/ 或 src/app/）。
 *
 * url 是「已经落到 URL 上的段」，路由组和并行槽不进 url，
 * 所以 app/(marketing)/about/page.tsx → /about、app/@modal/page.tsx → /。
 */
async function walkRoutes(
  base: string,
  url: string[],
  isApiDir: boolean,
  inSlot: boolean,
): Promise<CollectedRoute[]> {
  if (!existsSync(base)) return [];
  const out: CollectedRoute[] = [];
  const entries = await readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const full = join(base, e.name);
    if (e.isDirectory()) {
      const seg = parseSegment(e.name, 'app');
      const child = url.slice();
      pushSegment(child, seg, 'app');
      const nested = await walkRoutes(
        full,
        child,
        isApiDir || e.name === 'api',
        inSlot || seg.kind === 'slot',
      );
      out.push(...nested);
    } else if (e.isFile()) {
      if (PAGE_FILES.includes(e.name)) {
        out.push({ kind: 'page', path: toPath(url), fromSlot: inSlot });
      } else if (isApiDir && ROUTE_FILES.includes(e.name)) {
        out.push({ kind: 'api', path: toPath(url), fromSlot: inSlot });
      }
    }
  }
  return out;
}

/**
 * 遍历 Pages Router 目录树（pages/ 或 src/pages/）。
 *
 * 与 App Router 的差别：**目录名就是 URL 段**，没有路由组/并行槽/拦截路由这些约定。
 */
async function walkPagesDir(
  base: string,
  url: string[],
): Promise<CollectedRoute[]> {
  if (!existsSync(base)) return [];
  const out: CollectedRoute[] = [];
  const entries = await readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_')) continue;
    const full = join(base, e.name);
    if (e.isDirectory()) {
      const child = url.slice();
      pushSegment(child, parseSegment(e.name, 'pages'), 'pages');
      out.push(...(await walkPagesDir(full, child)));
    } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
      const name = e.name.replace(/\.(tsx?|jsx?)$/, '');
      // index 渲染在父路径上
      if (name === 'index') {
        out.push({ kind: isApiPath(toPath(url)) ? 'api' : 'page', path: toPath(url), fromSlot: false });
        continue;
      }
      const child = url.slice();
      pushSegment(child, parseSegment(name, 'pages'), 'pages');
      const path = toPath(child);
      out.push({ kind: isApiPath(path) ? 'api' : 'page', path, fromSlot: false });
    }
  }
  return out;
}

/**
 * Pages Router 里哪些是 API 路由。
 *
 * 以前用 `path.startsWith('/api')` —— 于是 `/apixyz`、`/api-docs` 全被当成 API。
 * 必须是 `/api` 或 `/api/` 开头才算。
 */
function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
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

    const collected: CollectedRoute[] = [];
    for (const root of [appDir, srcAppDir]) {
      if (existsSync(root) && (await stat(root)).isDirectory()) {
        collected.push(...(await walkRoutes(root, [], false, false)));
      }
    }
    for (const root of [pagesDir, srcPagesDir]) {
      if (existsSync(root) && (await stat(root)).isDirectory()) {
        collected.push(...(await walkPagesDir(root, [])));
      }
    }

    // 并行槽产出的路径，只有在**同一路径另有真实页面**时才可独立访问 ——
    // `app/@modal/page.tsx` 单独存在时并不代表 "/" 这个地址能打开。
    const realPagePaths = new Set(
      collected.filter((r) => r.kind === 'page' && !r.fromSlot).map((r) => r.path),
    );
    const usable = collected.filter(
      (r) => !r.fromSlot || (r.kind === 'page' && realPagePaths.has(r.path)),
    );

    const pages: PageSpec[] = [];
    const api: ApiSpec[] = [];
    // 同一个真实路径可能从多个目录树解析出来（并行槽、路由组、app+pages 并存），
    // 去重后才不会生成重复流程
    const seenPages = new Set<string>();
    const seenApi = new Set<string>();
    let i = 0;
    for (const r of usable) {
      if (r.kind === 'page') {
        if (seenPages.has(r.path)) continue;
        seenPages.add(r.path);
        pages.push({
          id: `page_${i++}`,
          path: r.path,
          requiresAuth: false,
          criticalCTAs: [],
        });
      } else {
        if (seenApi.has(r.path)) continue;
        seenApi.add(r.path);
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
