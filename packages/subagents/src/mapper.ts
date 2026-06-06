/**
 * Mapper subagent — 接收 project.scanned，输出 map.ready (FeatureMap)。
 */

import { basename } from 'node:path';
import type { Subagent, KernelContext, FeatureMap, Event, FlowSpec, FlowStep, PageSpec, ApiSpec, AuthSpec } from '@sentinel/core';
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
        await ctx.bus.publish({
          type: 'map.ready',
          payload: map,
          source: 'mapper',
          traceId: event.traceId,
        });
      });
    },
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

  const flows = generateFlows(pages, api, auth);

  return {
    project: profile,
    ...(auth && { auth }),
    pages,
    api,
    data,
    flows,
    risks,
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
 * 从检测到的 pages + api 自动生成基础 user flows。
 *
 * 策略：
 * 1. 每个 page → visit flow（验证页面可访问）
 * 2. 每个 API → HTTP 调用 flow（验证不返回 5xx）
 * 3. 如有 auth → 登录 flow
 * 4. 组合流程：首页 → 导航到子页面 → 触发 CTA
 */
function generateFlows(pages: PageSpec[], api: ApiSpec[], auth?: AuthSpec): FlowSpec[] {
  const flows: FlowSpec[] = [];
  let flowIdx = 0;

  // 1. 如果有 auth，生成登录 flow
  if (auth) {
    const loginSteps: FlowStep[] = [];
    const loginUrl = auth.loginEndpoint ?? '/login';
    loginSteps.push({ action: 'visit', url: loginUrl });

    if (auth.testCredentials) {
      const entries = Object.entries(auth.testCredentials);
      if (entries.length >= 1) {
        loginSteps.push({ action: 'fill', selector: 'input[name="email"], input[type="email"], #email', value: entries[0]?.[1] ?? 'test@test.com' });
      }
      if (entries.length >= 2) {
        loginSteps.push({ action: 'fill', selector: 'input[name="password"], input[type="password"], #password', value: entries[1]?.[1] ?? 'password' });
      }
      loginSteps.push({ action: 'click', selector: 'button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")' });
      loginSteps.push({ action: 'wait', ms: 2000 });
    }

    flows.push({
      id: `flow_auth_login_${flowIdx++}`,
      description: 'Login with test credentials',
      steps: loginSteps,
    });
  }

  // 2. 每个 page → visit flow (最多 15 个防止太多)
  const importantPages = pages.slice(0, 15);
  for (const page of importantPages) {
    const steps: FlowStep[] = [
      { action: 'visit', url: page.path },
      { action: 'wait', ms: 1500 },
    ];

    // 如果有 CTA，点第一个
    if (page.criticalCTAs.length > 0) {
      steps.push({ action: 'click', selector: page.criticalCTAs[0]! });
      steps.push({ action: 'wait', ms: 1000 });
    }

    flows.push({
      id: `flow_page_${flowIdx++}`,
      description: `Visit page ${page.path} and verify loads`,
      steps,
    });
  }

  // 3. 每个 API → http check (最多 10 个)
  const importantApi = api.slice(0, 10);
  for (const endpoint of importantApi) {
    // API 验证用 visit（对于 GET）或用 assert
    const steps: FlowStep[] = [
      { action: 'assert', kind: 'api', method: endpoint.method, path: endpoint.path, expectStatus: 'not_5xx' },
    ];

    flows.push({
      id: `flow_api_${flowIdx++}`,
      description: `${endpoint.method} ${endpoint.path} should not return 5xx`,
      steps,
    });
  }

  // 4. 组合流程：首页 → 导航到有 CTA 的页面 → 点击 CTA
  const ctaPages = pages.filter(p => p.criticalCTAs.length > 0).slice(0, 3);
  if (pages.length > 0 && ctaPages.length > 0) {
    const homePath = pages.find(p => p.path === '/')?.path ?? pages[0]!.path;
    for (const ctaPage of ctaPages) {
      if (ctaPage.path === homePath) continue;
      const steps: FlowStep[] = [
        { action: 'visit', url: homePath },
        { action: 'wait', ms: 1000 },
        { action: 'visit', url: ctaPage.path },
        { action: 'wait', ms: 1500 },
        { action: 'click', selector: ctaPage.criticalCTAs[0]! },
        { action: 'wait', ms: 2000 },
      ];
      flows.push({
        id: `flow_nav_cta_${flowIdx++}`,
        description: `Navigate from home to ${ctaPage.path} and trigger CTA`,
        steps,
      });
    }
  }

  return flows;
}

