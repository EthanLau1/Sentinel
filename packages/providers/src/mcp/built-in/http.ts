/**
 * HTTP MCP Server — API probe。
 * 沿用 Runtime Sentinel 的核心理念：纯 fetch，不带浏览器开销。
 */

import type { MCPServer } from '@sentinel/core';

export interface HttpMCPConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

interface HttpResult {
  status: number;
  ok: boolean;
  duration_ms: number;
  body: unknown;
  headers: Record<string, string>;
  setCookie?: string;
}

export function createHttpMCPServer(config: HttpMCPConfig = {}): MCPServer {
  return {
    name: 'http',
    tools: [
      {
        name: 'request',
        description: 'Send an HTTP request and return status, body, headers',
        inputSchema: {
          type: 'object',
          required: ['method', 'path'],
          properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            path: { type: 'string' },
            body: { type: 'string' },
            headers: { type: 'object' },
            token: { type: 'string', description: 'session/jwt token' },
            cookieName: { type: 'string' },
            timeoutMs: { type: 'number' },
          },
        },
      },
    ],

    async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      if (toolName !== 'request') throw new Error(`Unknown http tool: ${toolName}`);
      return httpRequest(config, args);
    },
  };
}

async function httpRequest(
  config: HttpMCPConfig,
  args: Record<string, unknown>,
): Promise<HttpResult> {
  const method = String(args['method'] ?? 'GET');
  const path = String(args['path']);
  const body = args['body'] as string | undefined;
  const headers = (args['headers'] as Record<string, string>) ?? {};
  const token = args['token'] as string | undefined;
  const cookieName = (args['cookieName'] as string) ?? 'session';
  const timeoutMs = (args['timeoutMs'] as number) ?? 10_000;

  const url = config.baseUrl ? `${config.baseUrl.replace(/\/$/, '')}${path}` : path;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.defaultHeaders ?? {}),
    ...headers,
  };
  if (token) finalHeaders['Cookie'] = `${cookieName}=${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      ...(body && { body }),
      signal: ctrl.signal,
    });

    const duration_ms = Date.now() - start;
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // 留作字符串
    }

    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    const result: HttpResult = {
      status: res.status,
      ok: res.ok,
      duration_ms,
      body: parsed,
      headers: respHeaders,
    };
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) result.setCookie = setCookie;
    return result;
  } finally {
    clearTimeout(timer);
  }
}
