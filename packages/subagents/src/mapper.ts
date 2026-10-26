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
        try {
          const scan = await createProjectScan(event.payload.root);
          const map = await buildFeatureMap(scan, adapters);
          const merged = await applyUserMapOverride(event.payload.root, map);
          await ctx.bus.publish({
            type: 'map.ready',
            payload: merged,
            source: 'mapper',
            traceId: event.traceId,
          });
        } catch (err) {
          // 项目理解失败必须说出来 —— 不接住的话，异常会冒到总线，
          // 用户只看到 "bus handler errors for project.scanned"，
          // 既不知道真实原因，也不知道"没扫出任何流程"意味着什么（E26）。
          await ctx.bus.publish({
            type: 'map.failed',
            payload: { error: (err as Error).message },
            source: 'mapper',
            traceId: event.traceId,
          });
        }
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
  const merged: FeatureMap = {
    ...base,
    ...override,
    project: { ...base.project, ...(override.project ?? {}) },
    ...(override.auth ? { auth: { ...(base.auth ?? {}), ...override.auth } } : base.auth ? { auth: base.auth } : {}),
    pages: pickOverride(base.pages, override.pages),
    api: pickOverride(base.api, override.api),
    data: pickOverride(base.data, override.data),
    flows: pickOverride(base.flows, override.flows),
    risks: pickOverride(base.risks, override.risks),
  };
  // 用户给了空 flows 数组 → 自动流程被放弃，必须说出来而不是静默少测
  if (base.flows.length > 0 && override.flows && override.flows.length === 0) {
    merged.risks = [
      ...merged.risks,
      {
        id: 'coverage_flows_overridden',
        area: 'ui',
        severity: 'high',
        description: 'app.map.ts 提供空的 flows 数组，自动生成的流程未被采用。填入 flows 才会测业务路径。',
      },
    ];
  }
  return merged;
}

/**
 * 空数组视为"用户没有覆盖"。
 * 模板里的 `flows: []` 只是占位，若当成有效覆盖，会把自动生成的流程全部抹掉，
 * 让整个项目在没有任何流程的情况下被判定为"扫描完成"。
 */
function pickOverride<T>(base: T[], override: T[] | undefined): T[] {
  return override && override.length > 0 ? override : base;
}

async function buildFeatureMap(scan: ProjectScan, adapters: Adapter[]): Promise<FeatureMap> {
  // adapter 失败不能静默 —— 失败意味着"这个栈没被完整识别"，
  // 而结果看起来是"扫完了但没发现什么"（E28）
  const errors: string[] = [];
  const detected: Adapter[] = [];
  for (const a of adapters) {
    try {
      if (await a.detect(scan)) detected.push(a);
    } catch (err) {
      errors.push(`adapter ${a.name} 的 detect 失败：${(err as Error).message}`);
    }
  }

  const profile = await aggregateProfile(scan, detected, errors);
  const { pages, api } = await aggregateRoutes(scan, detected, errors);
  const auth = await firstAuth(scan, detected, errors);
  const data = await aggregateData(scan, detected, errors);
  const risks = await aggregateRisks(scan, detected, errors);

  const flows = generateFlows(pages, api);

  const mapRisks: FeatureMap['risks'] = [...risks, ...coverageRisks(pages, api, auth)];
  // 识别不完整必须出现在报告里 —— 否则"没发现任何问题"会被误读成"项目没问题"
  for (const [i, msg] of errors.entries()) {
    mapRisks.push({
      id: `coverage_adapter_failed_${i}`,
      area: 'ui',
      severity: 'medium',
      description: `框架识别不完整 —— ${msg}`,
    });
  }
  // 扫不到任何页面或接口 —— 后面所有流程都会是 0，必须显式说出来
  if (pages.length === 0 && api.length === 0) {
    mapRisks.push({
      id: 'coverage_empty_map',
      area: 'ui',
      severity: 'high',
      description: 'Mapper 未识别到任何页面或 API —— 没有可测目标。检查项目结构、框架识别，或 app.map.ts 覆盖。',
    });
  }

  return {
    project: profile,
    ...(auth && { auth }),
    pages,
    api,
    data,
    flows,
    risks: mapRisks,
  };
}

async function aggregateProfile(scan: ProjectScan, detected: Adapter[], errors: string[]) {
  const name = scan.packageJson?.['name'] as string | undefined;
  const frameworks: string[] = [];
  const stack: string[] = [];
  for (const a of detected) {
    if (a.profile) {
      try {
        const p = await a.profile(scan);
        if (p.frameworks) frameworks.push(...p.frameworks);
        if (p.stack) stack.push(...p.stack);
      } catch (err) {
        errors.push(`adapter ${a.name} 的 profile 失败：${(err as Error).message}`);
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

async function aggregateRoutes(scan: ProjectScan, detected: Adapter[], errors: string[]) {
  const allPages: FeatureMap['pages'] = [];
  const allApi: FeatureMap['api'] = [];
  for (const a of detected) {
    if (a.routes) {
      try {
        const r = await a.routes(scan);
        if (r.pages) allPages.push(...r.pages);
        if (r.api) allApi.push(...r.api);
      } catch (err) {
        errors.push(`adapter ${a.name} 的 routes 失败：${(err as Error).message}`);
      }
    }
  }
  return { pages: allPages, api: allApi };
}

async function firstAuth(scan: ProjectScan, detected: Adapter[], errors: string[]) {
  for (const a of detected) {
    if (a.auth) {
      try {
        const v = await a.auth(scan);
        if (v) return v;
      } catch (err) {
        errors.push(`adapter ${a.name} 的 auth 失败：${(err as Error).message}`);
      }
    }
  }
  return undefined;
}

async function aggregateData(scan: ProjectScan, detected: Adapter[], errors: string[]) {
  const out: FeatureMap['data'] = [];
  for (const a of detected) {
    if (a.data) {
      try {
        out.push(...(await a.data(scan)));
      } catch (err) {
        errors.push(`adapter ${a.name} 的 data 失败：${(err as Error).message}`);
      }
    }
  }
  return out;
}

async function aggregateRisks(scan: ProjectScan, detected: Adapter[], errors: string[]) {
  const out: FeatureMap['risks'] = [];
  for (const a of detected) {
    if (a.risks) {
      try {
        out.push(...(await a.risks(scan)));
      } catch (err) {
        errors.push(`adapter ${a.name} 的 risks 失败：${(err as Error).message}`);
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
