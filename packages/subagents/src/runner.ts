/**
 * Runner subagent — 跑 user flows，根据结果发 flow.passed / flow.failed。
 *
 * 触发：map.ready
 * 产出：flow.started / flow.passed / flow.failed
 */
import { collectSourceEvidence } from './source-evidence.js';
import { isDeepStrictEqual } from 'node:util';

import type {
  Subagent,
  KernelContext,
  FeatureMap,
  FlowSpec,
  FlowStep,
  Evidence,
} from '@sentinel/core';

export interface RunnerConfig {
  /** 单个 flow 超时 */
  flowTimeoutMs?: number;
  /**
   * 采集详细证据（cookie / storage 键名）。
   *
   * 以前 `--detailed` 是个空开关：CLI 把开关传给了 browser MCP，
   * 但 runner 取证时硬编码 `snapshot({ detailed: false })`，
   * `??` 遇到 false 不回落 → 全局开关被顶掉，什么都没多采。
   */
  detailed?: boolean;
}

export function createRunner(config: RunnerConfig = {}): Subagent {
  return {
    name: 'runner',

    register(ctx: KernelContext): void {
      // 缓存 flow 定义 —— 修复后要能重跑同一条 flow
      const flowsById = new Map<string, FlowSpec>();
      // sensor 交回来的证据，按 flowId 归档（flowId 由 evidence.ready 显式带回）
      const evidenceByFlow = new Map<string, Evidence[]>();

      // 以前 evidence.requested 运行时**根本没人发布** ——
      // sensor 订阅着它，却永远收不到请求，于是 --detailed 采不到 storage，
      // 采到的 storage 也没有消费者。现在 runner 真的会去请求。
      ctx.bus.subscribe<{ flowId?: string; evidence: Evidence[] }>('evidence.ready', (event) => {
        const { flowId, evidence } = event.payload;
        if (!flowId) return;
        evidenceByFlow.set(flowId, evidence);
      });

      ctx.bus.subscribe<FeatureMap>('map.ready', async (event) => {
        for (const flow of event.payload.flows) flowsById.set(flow.id, flow);
        for (const flow of event.payload.flows) {
          // 单条 flow 的内部异常（如证据采集失败）不能中断整轮，
          // 否则后续 flow 一个都不会跑，且没有任何日志说明漏了什么。
          try {
            await runFlow(ctx, flow, event.traceId, undefined, evidenceByFlow, config.detailed === true);
          } catch (err) {
            await ctx.bus.publish({
              type: 'flow.failed',
              payload: {
                flowId: flow.id,
                error: `runner error: ${(err as Error).message}`,
                evidence: [],
              },
              source: 'runner',
              traceId: event.traceId,
            });
          }
        }
      });

      // 修复应用后重跑受影响的 flow —— "改完能验证"才叫闭环。
      // 只重跑，不改其他 flow；重跑结果带上 phase/patchId，便于对比修复前后。
      ctx.bus.subscribe<{ fixId: string; flowId: string }>('patch.applied', async (event) => {
        const flow = flowsById.get(event.payload.flowId);
        if (!flow) return;
        try {
          await runFlow(ctx, flow, event.traceId, { phase: 'after-fix', patchId: event.payload.fixId }, evidenceByFlow, config.detailed === true);
        } catch (err) {
          await ctx.bus.publish({
            type: 'flow.failed',
            payload: {
              flowId: flow.id,
              error: `runner error: ${(err as Error).message}`,
              evidence: [],
              phase: 'after-fix',
              patchId: event.payload.fixId,
            },
            source: 'runner',
            traceId: event.traceId,
          });
        }
      });
    },
  };
}

async function runFlow(
  ctx: KernelContext,
  flow: FlowSpec,
  traceId: string,
  phase: { phase: 'after-fix'; patchId: string } | undefined,
  evidenceByFlow: Map<string, Evidence[]>,
  detailed: boolean,
): Promise<void> {
  const start = Date.now();
  await ctx.bus.publish({
    type: 'flow.started',
    payload: { flowId: flow.id },
    source: 'runner',
    traceId,
  });

  const failureEvidence: Evidence[] = [];
  // 本次 flow 实际访问的 URL —— 必须一起传下去：
  // 没有它，analyst/critic 只看到"某处超时"，无法把运行时证据和具体路由/文件对上。
  const visitedUrl = flow.steps.find((step) => step.action === 'visit')?.url;

  try {
    for (const step of flow.steps) {
      await executeStep(ctx, step, flow.id, traceId, evidenceByFlow, detailed);
    }
    await ctx.bus.publish({
      type: 'flow.passed',
      payload: {
        flowId: flow.id,
        duration_ms: Date.now() - start,
        ...(visitedUrl && { url: visitedUrl }),
        ...(phase ?? {}),
      },
      source: 'runner',
      traceId,
    });
  } catch (err) {
    // 失败时收 Evidence
    failureEvidence.push(
      ...(await collectFailureEvidence(ctx, flow, err as Error)),
    );

    await ctx.bus.publish({
      type: 'flow.failed',
      payload: {
        flowId: flow.id,
        error: (err as Error).message,
        evidence: failureEvidence,
        ...(visitedUrl && { url: visitedUrl }),
        ...(phase ?? {}),
      },
      source: 'runner',
      traceId,
    });
  }
}

async function executeStep(
  ctx: KernelContext,
  step: FlowStep,
  flowId: string,
  traceId: string,
  evidenceByFlow: Map<string, Evidence[]>,
  detailed: boolean,
): Promise<void> {
  switch (step.action) {
    case 'visit': {
      const browser = ctx.providers.mcp.get('browser');
      if (!browser) throw new Error('browser MCP not registered');
      await browser.call('visit', { url: step.url });
      // 被动巡检：访问成功不代表页面没毛病 ——
      // "返回 200 但控制台在报错 / 资源 404 / 白屏"是旧链路完全测不到的一类错。
      await publishInspection(ctx, browser, flowId, step.url, traceId, detailed, evidenceByFlow);
      return;
    }
    case 'fill': {
      const browser = ctx.providers.mcp.get('browser');
      if (!browser) throw new Error('browser MCP not registered');
      await browser.call('fill', { selector: step.selector, value: step.value });
      return;
    }
    case 'click': {
      const browser = ctx.providers.mcp.get('browser');
      if (!browser) throw new Error('browser MCP not registered');
      await browser.call('click', { selector: step.selector });
      return;
    }
    case 'wait': {
      await new Promise((r) => setTimeout(r, step.ms));
      return;
    }
    case 'assert': {
      if (step.kind === 'url' || step.kind === 'text' || step.kind === 'visible') {
        const browser = ctx.providers.mcp.get('browser');
        if (!browser) throw new Error('browser MCP not registered');
        const result = await browser.call('assert', step) as { passed?: unknown };
        if (result?.passed !== true) throw new Error(`Browser ${step.kind} assertion did not pass`);
        return;
      }
      if (step.kind === 'api') {
        const http = ctx.providers.mcp.get('http');
        if (!http) throw new Error('http MCP not registered');
        const method = step.method ?? 'GET';
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(`Unsupported API method: ${method}`);
        if (method !== 'GET' && (step.allowMutation !== true || typeof step.body !== 'string')) {
          throw new Error(`API ${method} requires explicit allowMutation and body`);
        }
        if (!step.path || !step.path.startsWith('/')) throw new Error('API assertion requires a relative path');
        if (step.expectStatus === undefined) throw new Error('API assertion requires expectStatus');
        const result = await http.call('request', { method, path: step.path, ...(step.body !== undefined ? { body: step.body } : {}) }) as { status?: unknown; body?: unknown };
        if (typeof result?.status !== 'number' || !Number.isInteger(result.status)) throw new Error('API response has no valid status');
        const passed = step.expectStatus === '2xx'
          ? result.status >= 200 && result.status < 300
          : step.expectStatus === 'not_5xx'
            ? result.status >= 100 && result.status < 500
            : result.status === step.expectStatus;
        if (!passed) throw new Error(`API ${method} ${step.path} returned ${result.status} (expected ${step.expectStatus})`);
        if ('expectedBody' in step && !isDeepStrictEqual(result.body, step.expectedBody)) throw new Error(`API ${method} ${step.path} body mismatch`);
        if (step.bodyContains !== undefined && !JSON.stringify(result.body).includes(step.bodyContains)) throw new Error(`API ${method} ${step.path} body missing expected text`);
        return;
      }
      throw new Error(`Unsupported assertion kind: ${step.kind}`);
    }
  }
}

/**
 * 被动巡检：把"这次访问的现场"交给 inspector。
 *
 * 为什么巡检失败不能算 flow 失败：巡检是**额外**的检查手段，
 * 它坏了（比如页面刚被关掉）不代表被测项目有问题 ——
 * 让它拖垮整个 flow，等于用一个辅助功能制造假失败。
 */
async function publishInspection(
  ctx: KernelContext,
  browser: { call(name: string, args: Record<string, unknown>): Promise<unknown> },
  flowId: string,
  url: string,
  traceId: string,
  detailed = false,
  evidenceByFlow: Map<string, Evidence[]> = new Map(),
): Promise<void> {
  try {
    const snapshot = await browser.call('inspect', {});
    if (!snapshot || typeof snapshot !== 'object') return;

    // 详细证据（storage / cookie 键名）必须真的去要 ——
    // 以前 evidence.requested 运行时没有任何人发布，sensor 永远收不到请求，
    // 于是 --detailed 采不到东西，采到的东西也没有消费者。
    let extraEvidence: Evidence[] = [];
    if (detailed) {
      try {
        // 先清掉上一轮的残留，再请求 ——
        // bus 的 publish 会 await 完所有 handler 才返回，
        // 所以请求返回时，sensor 的 evidence.ready 已经落到 evidenceByFlow 里了。
        evidenceByFlow.delete(flowId);
        await ctx.bus.publish({
          type: 'evidence.requested',
          payload: { kinds: ['storage'], target: url, flowId },
          source: 'runner',
          traceId,
        });
        extraEvidence = evidenceByFlow.get(flowId) ?? [];
      } catch (err) {
        console.warn(`[sentinel] runner: 详细证据采集失败（不影响巡检）：${(err as Error).message}`);
      }
    }

    await ctx.bus.publish({
      type: 'page.visited',
      payload: { flowId, url, snapshot, ...(extraEvidence.length > 0 && { extraEvidence }) },
      source: 'runner',
      traceId,
    });
  } catch (err) {
    console.warn(`[sentinel] runner: 巡检 ${url} 失败（不影响 flow 结果）：${(err as Error).message}`);
  }
}

async function collectFailureEvidence(
  ctx: KernelContext,
  flow: FlowSpec,
  err: Error,
): Promise<Evidence[]> {
  const out: Evidence[] = [];
  const ts = Date.now();
  const { createHash } = await import('node:crypto');
  const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

  // Always add the error itself as console-level evidence
  out.push({
    kind: 'console',
    source: 'browser',
    timestamp: ts,
    hash: h(`error:${err.message}`),
    level: 'error',
    message: err.message,
    ...(err.stack ? { stack: err.stack } : {}),
  });

  // Try browser evidence
  const browser = ctx.providers.mcp.get('browser');
  if (browser) {
    try {
      const snap = (await browser.call('snapshot', {})) as {
        screenshot?: string;
        domSnapshot?: string;
        a11yTree?: unknown;
        console: Array<{ level: string; message: string }>;
        network: Array<{ url: string; method: string; status: number; duration_ms: number; failed: boolean }>;
      };

      if (snap.screenshot) {
        out.push({
          kind: 'screenshot',
          source: 'browser',
          timestamp: ts,
          hash: h(`shot:${snap.screenshot.slice(0, 50)}`),
          path: `data:image/png;base64,${snap.screenshot}`,
        });
      }
      if (snap.a11yTree) {
        out.push({
          kind: 'a11y',
          source: 'browser',
          timestamp: ts,
          hash: h(`a11y:${JSON.stringify(snap.a11yTree).slice(0, 200)}`),
          tree: snap.a11yTree,
        });
      }
      for (const c of snap.console) {
        if (c.level === 'error' || c.level === 'warn') {
          out.push({
            kind: 'console',
            source: 'browser',
            timestamp: ts,
            hash: h(`console:${c.message}`),
            level: c.level === 'error' ? 'error' : 'warn',
            message: c.message,
          });
        }
      }
      for (const n of snap.network) {
        if (n.failed || n.status >= 400) {
          out.push({
            kind: 'network',
            source: 'browser',
            timestamp: ts,
            hash: h(`net:${n.url}:${n.status}`),
            url: n.url,
            method: n.method,
            status: n.status,
            duration_ms: n.duration_ms,
            failed: n.failed,
          });
        }
      }
    } catch {
      // browser unavailable — continue with what we have
    }
  }

  const source = await collectSourceEvidence(ctx, flow);
  if (source) out.push(source);
  return out;
}
