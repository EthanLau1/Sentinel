import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { nextjsAdapter } from '../src/frontend/nextjs.js';
import { createProjectScan } from '../src/scan.js';

/**
 * 路由解析的回归测试。
 *
 * 钉住的是「产出路径真的能被访问到」：
 *   - App Router 有路由组 / 并行槽 / 拦截路由三种"不进 URL 的目录名"；
 *   - Pages Router 没有这些约定 —— 目录名就是 URL 段。
 * 解析错一步就会产出一个 404 的伪路径，而这类错误不报错，
 * 只会静默生成访问不通的巡检流程，最后变成假 P1。
 *
 * App / Pages 刻意用**两套夹具**：两套路由树的目录语义不同，
 * 混在一份夹具里断言会互相干扰（App 的 /about 和 Pages 的 /(group)/about 同时出现）。
 */

async function writeAt(root: string, rel: string): Promise<void> {
  const full = join(root, rel);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, 'export default () => null', 'utf8');
}

async function makeProject(files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sentinel-nextjs-routes-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fake-app', dependencies: { next: '15.0.0' } }),
    'utf8',
  );
  for (const f of files) await writeAt(root, f);
  return root;
}

const APP_FILES = [
  'app/page.tsx',
  'app/(marketing)/page.tsx',
  'app/(marketing)/about/page.tsx',
  'app/@modal/page.tsx',
  'app/dashboard/page.tsx',
  'app/dashboard/@sidebar/page.tsx',
  'app/(.)photo/page.tsx',
  'app/[[...all]]/page.tsx',
  'app/[id]/page.tsx',
  'app/api/users/route.ts',
  'app/api/(v1)/orders/route.ts',
];

const PAGES_FILES = [
  'pages/index.tsx',
  'pages/(marketing)/about.tsx',
  'pages/shop/[[...slug]].tsx',
  'pages/api/legacy.ts',
  'pages/apixyz.tsx',
];

async function collect(files: string[]): Promise<{ pages: string[]; api: string[] }> {
  const root = await makeProject(files);
  const scan = await createProjectScan(root);
  const routes = await nextjsAdapter.routes!(scan);
  return {
    pages: (routes.pages ?? []).map((p) => p.path),
    api: (routes.api ?? []).map((a) => a.path),
  };
}

const collectApp = () => collect(APP_FILES);
const collectPages = () => collect(PAGES_FILES);

describe('nextjsAdapter · App Router 约定', () => {
  it('路由组不进 URL', async () => {
    const { pages } = await collectApp();
    expect(pages).toContain('/about');
    expect(pages.some((p) => p.includes('marketing'))).toBe(false);
  });

  it('并行槽不产出 /@slot，也不自己新增可访问地址', async () => {
    const { pages } = await collectApp();
    expect(pages.some((p) => p.includes('@'))).toBe(false);
    // app/@modal/page.tsx 有 app/page.tsx 作伴 → 归到 '/'
    expect(pages).toContain('/');
    // app/dashboard/@sidebar/page.tsx 有 app/dashboard/page.tsx 作伴 → 归到 '/dashboard'
    expect(pages).toContain('/dashboard');
  });

  it('拦截路由产出规范路径', async () => {
    const { pages } = await collectApp();
    // app/(.)photo/page.tsx → 拦截同级的 photo
    expect(pages).toContain('/photo');
    expect(pages.some((p) => p.includes('(.)'))).toBe(false);
  });

  it('可选捕获段不产生带方括号的垃圾路径', async () => {
    const { pages } = await collectApp();
    expect(pages).toContain('/:all*');
    expect(pages.some((p) => p.includes(']'))).toBe(false);
    expect(pages.some((p) => p.includes('['))).toBe(false);
  });

  it('动态段用 :param 占位', async () => {
    const { pages } = await collectApp();
    expect(pages).toContain('/:id');
    expect(pages.some((p) => p.includes('[id]'))).toBe(false);
  });

  it('API 路由剥离路由组，路径保持 /api 前缀', async () => {
    const { api } = await collectApp();
    expect(api).toContain('/api/users');
    expect(api).toContain('/api/orders');
    expect(api.some((p) => p.includes('(v1)'))).toBe(false);
  });

  it('同一个真实路径只产出一条', async () => {
    const { pages, api } = await collectApp();
    expect(new Set(pages).size).toBe(pages.length);
    expect(new Set(api).size).toBe(api.length);
    // app/page.tsx、app/(marketing)/page.tsx、app/@modal/page.tsx 都落到 /
    expect(pages.filter((p) => p === '/')).toHaveLength(1);
  });
});

describe('nextjsAdapter · Pages Router 约定', () => {
  it('目录名就是 URL 段（没有路由组/并行槽/拦截这些约定）', async () => {
    const { pages } = await collectPages();
    // pages/(marketing)/about.tsx 的真实地址就是 /(marketing)/about
    expect(pages).toContain('/(marketing)/about');
    expect(pages).not.toContain('/about');
  });

  it('可选捕获段用 :param* 表示', async () => {
    const { pages } = await collectPages();
    expect(pages).toContain('/shop/:slug*');
  });

  it('/api 前缀判定要有边界（/apixyz 不是 API）', async () => {
    const { pages, api } = await collectPages();
    expect(api).toContain('/api/legacy');
    expect(pages).toContain('/apixyz');
    expect(api).not.toContain('/apixyz');
  });

  it('页面和 API 不会互相串味', async () => {
    const { pages, api } = await collectPages();
    const isApiPath = (p: string): boolean => p === '/api' || p.startsWith('/api/');
    expect(pages.some(isApiPath)).toBe(false);
    expect(api.every(isApiPath)).toBe(true);
  });
});
