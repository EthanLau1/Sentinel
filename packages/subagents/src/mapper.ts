/**
 * Mapper subagent — 接收 project.scanned，输出 map.ready (FeatureMap)。
 */

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Subagent, KernelContext, FeatureMap, Event, FlowSpec, PageSpec, ApiSpec, AuthSpec } from '@sentinel/core';
import {
  ALL_ADAPTERS,
  createProjectScan,
  type Adapter,
  type ProjectScan,
} from '@sentinel/adapters';

export interface MapperConfig {
  /** 自定义 adapter 列表（覆盖默认全部） */
  adapters?: Adapter[];
}

export function createMapper(config: MapperConfig = {}): Subagent {
  const adapters = config.adapters ?? ALL_ADAPTERS;

  return {
    name: 'mapper',
    register(ctx: KernelContext): void {
      ctx.bus.subscribe<{ root: string }>('project.scanned', async (event: Event<{ root: string }>) => {
        const scan = await createProjectScan(event.payload.root);
        const map = await buildFeatureMap(scan, adapters);
        const merged = await applyUserMapOverride(event.payload.root, map);
        await ctx.bus.publish({
          type: 'map.ready',
          payload: merged,
          source: 'mapper',
          traceId: event.traceId,
        });
      });
    },
  };
}

async function applyUserMapOverride(root: string, base: FeatureMap): Promise<FeatureMap> {
  const candidates = [
    join(root, '.sentinel', 'app.map.ts'),
    join(root, '.sentinel', 'app.map.js'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return base;

  try {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const override = (mod.default ?? mod.overrides ?? mod.map) as Partial<FeatureMap> | undefined;
    if (!override || typeof override !== 'object') return base;
    return mergeFeatureMap(base, override);
  } catch {
    return base;
  }
}

function mergeFeatureMap(base: FeatureMap, override: Partial<FeatureMap>): FeatureMap {
  return {
    ...base,
    ...override,
    project: { ...base.project, ...(override.project ?? {}) },
    ...(override.auth ? { auth: { ...(base.auth ?? {}), ...override.auth } } : base.auth ? { auth: base.auth } : {}),
    pages: override.pages ?? base.pages,
    api: override.api ?? base.api,
    data: override.data ?? base.data,
    flows: override.flows ?? base.flows,
    risks: override.risks ?? base.risks,
  };
}

async function buildFeatureMap(scan: ProjectScan, adapters: Adapter[]): Promise<FeatureMap> {
  const detected: Adapter[] = [];
  for (const a of adapters) {
    try {
      if (await a.detect(scan)) detected.push(a);
    } catch {
      // 单个 adapter 失败不影响其他
    }
  }

  const profile = await aggregateProfile(scan, detected);
  const { pages, api } = await aggregateRoutes(scan, detected);
  const auth = await firstAuth(scan, detected);
  const data = await aggregateData(scan, detected);
  const risks = await aggregateRisks(scan, detected);

  const flows = generateFlows(pages, api);

  return {
    project: profile,
    ...(auth && { auth }),
    pages,
    api,
    data,
    flows,
    risks: [...risks, ...coverageRisks(pages, api, auth)],
  };
}

async function aggregateProfile(scan: ProjectScan, detected: Adapter[]) {
  const name = scan.packageJson?.['name'] as string | undefined;
  const frameworks: string[] = [];
  const stack: string[] = [];
  for (const a of detected) {
    if (a.profile) {
      try {
        const p = await a.profile(scan);
        if (p.frameworks) frameworks.push(...p.frameworks);
        if (p.stack) stack.push(...p.stack);
      } catch {
        // 忽略
      }
    }
  }
  return {
    name: name ?? basename(scan.root),
    stack,
    frameworks,
    runtime: detectRuntime(scan),
    packageManager: detectPM(scan),
  };
}

function detectRuntime(scan: ProjectScan): string {
  if (scan.has('bun.lockb') || scan.has('bun.lock')) return 'bun';
  if (scan.has('deno.json') || scan.has('deno.lock')) return 'deno';
  return 'node';
}

function detectPM(scan: ProjectScan): string {
  if (scan.has('bun.lockb') || scan.has('bun.lock')) return 'bun';
  if (scan.has('pnpm-lock.yaml')) return 'pnpm';
  if (scan.has('yarn.lock')) return 'yarn';
  return 'npm';
}

async function aggregateRoutes(scan: ProjectScan, detected: Adapter[]) {
  const allPages: FeatureMap['pages'] = [];
  const allApi: FeatureMap['api'] = [];
  for (const a of detected) {
    if (a.routes) {
      try {
        const r = await a.routes(scan);
        if (r.pages) allPages.push(...r.pages);
        if (r.api) allApi.push(...r.api);
      } catch {
        // 忽略
      }
    }
  }
  return { pages: allPages, api: allApi };
}

async function firstAuth(scan: ProjectScan, detected: Adapter[]) {
  for (const a of detected) {
    if (a.auth) {
      try {
        const v = await a.auth(scan);
        if (v) return v;
      } catch {
        // 忽略
      }
    }
  }
  return undefined;
}

async function aggregateData(scan: ProjectScan, detected: Adapter[]) {
  const out: FeatureMap['data'] = [];
  for (const a of detected) {
    if (a.data) {
      try {
        out.push(...(await a.data(scan)));
      } catch {
        // 忽略
      }
    }
  }
  return out;
}

async function aggregateRisks(scan: ProjectScan, detected: Adapter[]) {
  const out: FeatureMap['risks'] = [];
  for (const a of detected) {
    if (a.risks) {
      try {
        out.push(...(await a.risks(scan)));
      } catch {
        // 忽略
      }
    }
  }
  return out;
}

/**
 * Default coverage is read-only. Mutating and authenticated routes need explicit
 * project flows with fixtures and assertions, not guessed selectors or payloads.
 */
function generateFlows(pages: PageSpec[], api: ApiSpec[]): FlowSpec[] {
  const flows: FlowSpec[] = [];
  for (const page of pages) {
    if (page.requiresAuth || !isConcretePath(page.path)) continue;
    flows.push({
      id: `flow_page_${page.id}`,
      description: `Reach page ${page.path} and verify URL and body visibility`,
      steps: [
        { action: 'visit', url: page.path },
        { action: 'assert', kind: 'url', expected: page.path },
        { action: 'assert', kind: 'visible', selector: 'body' },
      ],
    });
  }
  for (const endpoint of api) {
    if (endpoint.method !== 'GET' || endpoint.requiresAuth || !isConcretePath(endpoint.path)) continue;
    flows.push({
      id: `flow_api_${endpoint.id}`,
      description: `GET ${endpoint.path} returns 2xx`,
      steps: [{ action: 'assert', kind: 'api', method: 'GET', path: endpoint.path, expectStatus: '2xx' }],
    });
  }
  return flows;
}

function isConcretePath(path: string): boolean {
  return path.startsWith('/') && !/\[[^\]]+\]|:[^/]+|\*/.test(path);
}

function coverageRisks(pages: PageSpec[], api: ApiSpec[], auth?: AuthSpec): FeatureMap['risks'] {
  const risks: FeatureMap['risks'] = [];
  if (pages.some(page => !page.requiresAuth && isConcretePath(page.path))) risks.push({ id: 'coverage_ui_content', area: 'ui', severity: 'medium', description: 'Auto page flows check route/status and body visibility only; add expected UI text assertions for business content.' });
  if (api.some(endpoint => endpoint.method === 'GET' && !endpoint.requiresAuth && isConcretePath(endpoint.path))) risks.push({ id: 'coverage_api_body', area: 'ui', severity: 'medium', description: 'Auto GET flows check 2xx status only; add expectedBody or bodyContains assertions for response semantics.' });
  if (auth) risks.push({ id: 'coverage_auth', area: 'auth', severity: 'medium', description: 'Auth flow not auto-run; add an explicit project flow with safe test credentials and outcome assertions.' });
  for (const page of pages) {
    if (page.requiresAuth || !isConcretePath(page.path)) {
      risks.push({ id: `coverage_page_${page.id}`, area: 'ui', severity: 'medium', description: `Page ${page.path} not auto-tested (auth or dynamic path); provide an explicit flow.` });
    }
    if (page.criticalCTAs.length) {
      risks.push({ id: `coverage_cta_${page.id}`, area: 'ui', severity: 'medium', description: `CTA on ${page.path} not auto-clicked; add an explicit flow with outcome assertions.` });
    }
  }
  for (const endpoint of api) {
    if (endpoint.method !== 'GET' || endpoint.requiresAuth || !isConcretePath(endpoint.path)) {
      risks.push({ id: `coverage_api_${endpoint.id}`, area: 'ui', severity: 'medium', description: `${endpoint.method} ${endpoint.path} not auto-tested (mutation, auth or dynamic path); provide an explicit flow.` });
    }
  }
  return risks;
}
