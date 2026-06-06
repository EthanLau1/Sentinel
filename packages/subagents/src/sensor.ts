/**
 * Sensor subagent — 编排 MCP 收集 Evidence。
 *
 * 触发：evidence.requested
 * 产出：evidence.collected → evidence.ready
 */

import { createHash } from 'node:crypto';
import type { Subagent, KernelContext, Evidence, EvidenceKind } from '@sentinel/core';

export interface SensorConfig {
  detailed?: boolean;
}

export function createSensor(config: SensorConfig = {}): Subagent {
  return {
    name: 'sensor',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<{ kinds: EvidenceKind[]; target: string; flowId?: string }>(
        'evidence.requested',
        async (event) => {
          const collected: Evidence[] = [];

          for (const kind of event.payload.kinds) {
            try {
              const e = await collectOne(ctx, kind, event.payload.target, config.detailed === true);
              if (e) collected.push(e);
            } catch (err) {
              await ctx.bus.publish({
                type: 'evidence.failed',
                payload: { error: (err as Error).message, kind },
                source: 'sensor',
                traceId: event.traceId,
              });
            }
          }

          await ctx.bus.publish({
            type: 'evidence.ready',
            payload: collected,
            source: 'sensor',
            traceId: event.traceId,
          });
        },
      );
    },
  };
}

function hashEvidence(kind: string, content: unknown): string {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return createHash('sha256').update(`${kind}:${text}`).digest('hex').slice(0, 16);
}

async function collectOne(
  ctx: KernelContext,
  kind: EvidenceKind,
  target: string,
  detailed: boolean,
): Promise<Evidence | null> {
  const ts = Date.now();

  switch (kind) {
    case 'http': {
      const http = ctx.providers.mcp.get('http');
      if (!http) return null;
      const result = (await http.call('request', {
        method: 'GET',
        path: target,
      })) as { status: number; body: unknown; ok: boolean };
      const summary = JSON.stringify(result.body).slice(0, 500);
      return {
        kind: 'http',
        source: 'api',
        timestamp: ts,
        hash: hashEvidence('http', `${target}:${result.status}:${summary}`),
        url: target,
        method: 'GET',
        status: result.status,
        bodySummary: summary,
      };
    }

    case 'screenshot':
    case 'dom-snapshot':
    case 'a11y':
    case 'console':
    case 'network':
    case 'storage': {
      const browser = ctx.providers.mcp.get('browser');
      if (!browser) return null;

      // 第一次访问：visit
      // 后续不重复 visit
      // 简化：sensor 自己保证 target 已 visit（runner 已先 visit）
      const snap = (await browser.call('snapshot', { detailed })) as {
        url: string;
        screenshot?: string;
        domSnapshot?: string;
        a11yTree?: unknown;
        console: Array<{ level: string; message: string }>;
        network: Array<{ url: string; method: string; status: number; duration_ms: number; failed: boolean }>;
        storage?: { localStorage: string[]; sessionStorage: string[]; cookieKeys: string[] };
      };

      if (kind === 'screenshot' && snap.screenshot) {
        return {
          kind: 'screenshot',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('screenshot', snap.screenshot.slice(0, 100)),
          path: `data:image/png;base64,${snap.screenshot}`,
        };
      }
      if (kind === 'dom-snapshot' && snap.domSnapshot) {
        return {
          kind: 'dom-snapshot',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('dom', snap.domSnapshot),
          html: snap.domSnapshot.slice(0, 5000),
        };
      }
      if (kind === 'a11y' && snap.a11yTree) {
        return {
          kind: 'a11y',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('a11y', snap.a11yTree),
          tree: snap.a11yTree,
        };
      }
      if (kind === 'console') {
        // 只取 error / warn
        const msg = snap.console.find((c) => c.level === 'error') ?? snap.console.find((c) => c.level === 'warn');
        if (!msg) return null;
        return {
          kind: 'console',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('console', msg.message),
          level: msg.level === 'error' ? 'error' : 'warn',
          message: msg.message,
        };
      }
      if (kind === 'network') {
        const failed = snap.network.find((n) => n.failed);
        if (!failed) return null;
        return {
          kind: 'network',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('network', `${failed.url}:${failed.status}`),
          url: failed.url,
          method: failed.method,
          status: failed.status,
          duration_ms: failed.duration_ms,
          failed: failed.failed,
        };
      }
      if (kind === 'storage' && snap.storage) {
        return {
          kind: 'storage',
          source: 'browser',
          timestamp: ts,
          hash: hashEvidence('storage', JSON.stringify(snap.storage)),
          storage: 'localStorage',
          keys: snap.storage.localStorage,
        };
      }
      return null;
    }

    default:
      // log/file/git/db/trace
      if (kind === 'file') {
        return collectFileEvidence(ctx, target, ts);
      }
      if (kind === 'git') {
        return collectGitEvidence(ctx, target, ts);
      }
      if (kind === 'log') {
        return collectLogEvidence(ctx, target, ts);
      }
      // db/trace 暂不支持
      return null;
  }
}

/**
 * Collect file evidence — reads relevant source code snippet around the target path.
 * target format: "filepath:lineNumber" or just "filepath"
 */
async function collectFileEvidence(
  ctx: KernelContext,
  target: string,
  ts: number,
): Promise<Evidence | null> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return null;

  try {
    // Parse target: could be "src/app/page.tsx:42" or "src/app/page.tsx"
    const parts = target.split(':');
    const filePath = parts[0]!;
    const lineHint = parts[1] ? parseInt(parts[1], 10) : undefined;

    const content = (await fs.call('read', { path: filePath })) as string;
    if (!content) return null;

    const lines = content.split('\n');
    let lineRange: [number, number] | undefined;
    let snippet: string;

    if (lineHint && lineHint > 0) {
      // Show ±15 lines around the hint
      const start = Math.max(1, lineHint - 15);
      const end = Math.min(lines.length, lineHint + 15);
      lineRange = [start, end];
      snippet = lines.slice(start - 1, end).join('\n');
    } else {
      // Show first 60 lines
      const end = Math.min(lines.length, 60);
      lineRange = [1, end];
      snippet = lines.slice(0, end).join('\n');
    }

    return {
      kind: 'file',
      source: 'fs',
      timestamp: ts,
      hash: hashEvidence('file', `${filePath}:${snippet.slice(0, 200)}`),
      path: filePath,
      lineRange,
      snippet,
    };
  } catch {
    return null;
  }
}

/**
 * Collect git evidence — recent log, diff, or blame for a target path.
 * target format: "log" | "diff" | "blame:filepath"
 */
async function collectGitEvidence(
  ctx: KernelContext,
  target: string,
  ts: number,
): Promise<Evidence | null> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return null;

  try {
    let subject: 'log' | 'diff' | 'blame' = 'log';
    let ref = 'HEAD~5..HEAD';
    let data = '';

    if (target.startsWith('blame:')) {
      subject = 'blame';
      const filePath = target.slice(6);
      ref = filePath;
      // Try to read git blame via shell exec on fs MCP
      try {
        const result = (await fs.call('exec', { command: `git blame --line-porcelain -L 1,50 "${filePath}"` })) as string;
        data = result?.slice(0, 3000) ?? '';
      } catch {
        // fallback: just note that blame was requested
        data = `(git blame unavailable for ${filePath})`;
      }
    } else if (target === 'diff' || target.startsWith('diff')) {
      subject = 'diff';
      ref = 'HEAD';
      try {
        const result = (await fs.call('exec', { command: 'git diff HEAD~3..HEAD --stat' })) as string;
        data = result?.slice(0, 3000) ?? '';
      } catch {
        data = '(git diff unavailable)';
      }
    } else {
      // Default: git log
      subject = 'log';
      try {
        const result = (await fs.call('exec', { command: 'git log --oneline -20' })) as string;
        data = result?.slice(0, 2000) ?? '';
      } catch {
        data = '(git log unavailable)';
      }
    }

    if (!data) return null;

    return {
      kind: 'git',
      source: 'git',
      timestamp: ts,
      hash: hashEvidence('git', `${subject}:${data.slice(0, 200)}`),
      ref,
      subject,
      data,
    };
  } catch {
    return null;
  }
}

/**
 * Collect log evidence — reads recent backend/server logs if available.
 * target: log file path or service name
 */
async function collectLogEvidence(
  ctx: KernelContext,
  target: string,
  ts: number,
): Promise<Evidence | null> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return null;

  try {
    // Try to read log file or recent output
    const content = (await fs.call('read', { path: target })) as string;
    if (!content) return null;

    // Take last 50 lines of log
    const lines = content.split('\n');
    const tail = lines.slice(-50).join('\n');

    // Find error lines
    const errorLines = lines.filter(l => /error|exception|fatal|panic/i.test(l));
    const message = errorLines.length > 0
      ? errorLines.slice(-5).join('\n')
      : tail.slice(0, 500);

    return {
      kind: 'log',
      source: 'backend',
      timestamp: ts,
      hash: hashEvidence('log', `${target}:${message.slice(0, 200)}`),
      level: errorLines.length > 0 ? 'error' : 'info',
      message,
      service: target,
    };
  } catch {
    return null;
  }
}
