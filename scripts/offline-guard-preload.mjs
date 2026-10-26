/**
 * 断网探针（preload）—— 记录 Sentinel 进程发出的**每一个**对外请求。
 *
 * 为什么需要它：
 *   "离线模式没发外网请求"这句话，光看 `llmRequests: 0` 是**证明不了**的 ——
 *   那个计数器只在接了真模型时才挂在 provider 上，离线分支根本没挂它。
 *   换句话说：即使有人把离线模式误接成真模型，计数器照样是 0。
 *   恒真的判据等于没有判据。
 *
 *   所以这里从**外面**观测：任何出网请求（fetch / http.request / https.request）
 *   都被记录下来。谁发、发去哪、发了多少次，全部留痕。
 *
 * 用法：
 *   bun --preload ./scripts/offline-guard-preload.mjs packages/cli/src/index.ts run ...
 *   环境变量 SENTINEL_GUARD_NET_LOG 指定记录文件（JSONL，每行一条）。
 *
 * 判定由外层脚本做：
 *   - 记录里出现任何**非回环地址** → 离线模式发了外网请求 → 守卫失败
 *   - 记录为空或只有回环地址 → 离线模式确实没碰外网
 *
 * 注意：本探针只覆盖 Sentinel 自己的进程。
 * 浏览器（Playwright Chromium）是独立进程，它的外网行为由 OS 层沙箱管（见 check-offline-guard.mjs）。
 */

import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const LOG = process.env['SENTINEL_GUARD_NET_LOG'];

/** 回环地址：本地 dev server 属于正常流量，不算"发外网" */
function isLoopback(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
}

function record(entry) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    /* 记录失败不能影响被测流程 */
  }
}

function classifyUrl(raw) {
  try {
    const u = new URL(String(raw));
    return { host: u.hostname, port: u.port, loopback: isLoopback(u.hostname) };
  } catch {
    return { host: '(无法解析)', port: '', loopback: false };
  }
}

// ── fetch ────────────────────────────────────────────────────────────────
const origFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const raw = typeof input === 'string' ? input : (input?.url ?? String(input));
  const info = classifyUrl(raw);
  record({ kind: 'fetch', url: String(raw), ...info });
  return origFetch.call(this, input, init);
};

// ── http.request / https.request ─────────────────────────────────────────
// 只包一层"记一笔"，不改变原行为 —— 守卫要的是观测，不是拦截。
function wrapRequest(mod, kind) {
  const orig = mod.request;
  if (typeof orig !== 'function') return;
  mod.request = function (...args) {
    const first = args[0];
    const options = typeof first === 'string' || first instanceof URL ? { ...(args[1] ?? {}) } : (first ?? {});
    const raw = options.href ?? options.url ?? (typeof first === 'string' ? first : undefined);
    const info = classifyUrl(raw ?? '');
    record({ kind, url: String(raw ?? '(未指定)'), ...info });
    return orig.apply(this, args);
  };
}

wrapRequest(http, 'http.request');
wrapRequest(https, 'https.request');
