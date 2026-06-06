/**
 * Runner subagent — 跑 user flows，根据结果发 flow.passed / flow.failed。
 *
 * 触发：map.ready
 * 产出：flow.started / flow.passed / flow.failed
 */

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
}

export function createRunner(_config: RunnerConfig = {}): Subagent {
  return {
    name: 'runner',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<FeatureMap>('map.ready', async (event) => {
        for (const flow of event.payload.flows) {
          await runFlow(ctx, flow, event.traceId);
        }
      });
    },
  };
}

async function runFlow(ctx: KernelContext, flow: FlowSpec, traceId: string): Promise<void> {
  const start = Date.now();
  await ctx.bus.publish({
    type: 'flow.started',
    payload: { flowId: flow.id },
    source: 'runner',
    traceId,
  });

  const failureEvidence: Evidence[] = [];

  try {
    for (const step of flow.steps) {
      await executeStep(ctx, step);
    }
    await ctx.bus.publish({
      type: 'flow.passed',
      payload: { flowId: flow.id, duration_ms: Date.now() - start },
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
      },
      source: 'runner',
      traceId,
    });
  }
}

async function executeStep(ctx: KernelContext, step: FlowStep): Promise<void> {
  switch (step.action) {
    case 'visit': {
      const browser = ctx.providers.mcp.get('browser');
      if (!browser) throw new Error('browser MCP not registered');
      await browser.call('visit', { url: step.url });
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
      // API assertion: make actual HTTP request to verify
      if (step.kind === 'api') {
        const http = ctx.providers.mcp.get('http');
        if (http) {
          const method = (step as Record<string, unknown>)['method'] as string ?? 'GET';
          const path = (step as Record<string, unknown>)['path'] as string ?? '/';
          try {
            const result = (await http.call('request', { method, path })) as { status: number };
            const expectStatus = (step as Record<string, unknown>)['expectStatus'] as string;
            if (expectStatus === 'not_5xx' && result.status >= 500) {
              throw new Error(`API ${method} ${path} returned ${result.status} (expected non-5xx)`);
            }
          } catch (err) {
            if (err instanceof Error && err.message.includes('returned')) throw err;
            // HTTP call failed entirely
            throw new Error(`API ${method} ${path} request failed: ${(err as Error).message}`);
          }
        }
      }
      return;
    }
  }
}

async function collectFailureEvidence(
  ctx: KernelContext,
  _flow: FlowSpec,
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
      const snap = (await browser.call('snapshot', { detailed: false })) as {
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

  return out;
}
