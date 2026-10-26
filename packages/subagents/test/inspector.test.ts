import { describe, expect, it } from 'vitest';

import { evaluateInspection, type InspectionSnapshot } from '../src/inspector.js';

/** 造一份"干净的"巡检快照 —— 每个用例只改自己关心的那一项 */
function snapshot(overrides: Partial<InspectionSnapshot> = {}): InspectionSnapshot {
  return {
    url: 'http://127.0.0.1:3000/blog',
    title: 'Blog',
    console: [],
    pageErrors: [],
    network: [],
    meta: {
      lang: 'zh-CN',
      viewport: 'width=device-width, initial-scale=1',
      hasTitle: true,
      bodyTextLength: 120,
      bodyVisible: true,
    },
    ...overrides,
  };
}

const rulesOf = (s: InspectionSnapshot, config?: { slowThresholdMs?: number }): string[] =>
  evaluateInspection(s, config ?? {}).map((v) => v.rule);

describe('inspector 规则判定（不依赖 LLM）', () => {
  it('干净页面不报任何问题', () => {
    expect(rulesOf(snapshot())).toEqual([]);
  });

  it('未捕获异常 → P1 错误，证据是 console error', () => {
    const violations = evaluateInspection(
      snapshot({ pageErrors: ['TypeError: x is not a function'] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe('uncaught-exception');
    expect(violations[0]!.severity).toBe('P1');
    expect(violations[0]!.kind).toBe('error');
    expect(violations[0]!.evidence[0]!.kind).toBe('console');
    expect(violations[0]!.evidence[0]!.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('控制台 error → P1；同一条消息只报一次', () => {
    const violations = evaluateInspection(
      snapshot({
        console: [
          { level: 'error', message: 'boom' },
          { level: 'error', message: 'boom' },
          { level: 'warn', message: 'ignored' },
          { level: 'log', message: 'noise' },
        ],
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe('console-error');
  });

  it('与未捕获异常重复的 console 消息不重复报', () => {
    const violations = evaluateInspection(
      snapshot({
        pageErrors: ['boom'],
        console: [{ level: 'error', message: 'boom' }],
      }),
    );
    expect(rulesOf(snapshot({ pageErrors: ['boom'], console: [{ level: 'error', message: 'boom' }] }))).toEqual([
      'uncaught-exception',
    ]);
    expect(violations.map((v) => v.rule)).toEqual(['uncaught-exception']);
  });

  it('子资源 5xx → P1；4xx → P2；连接失败 → P1', () => {
    const violations = evaluateInspection(
      snapshot({
        network: [
          { url: 'http://127.0.0.1:3000/api/x', method: 'GET', status: 500, duration_ms: 10, failed: true },
          { url: 'http://127.0.0.1:3000/img/a.png', method: 'GET', status: 404, duration_ms: 10, failed: true },
          { url: 'http://127.0.0.1:3000/socket', method: 'GET', status: 0, duration_ms: 10, failed: true },
        ],
      }),
    );
    const byRule = Object.fromEntries(violations.map((v) => [v.rule, v.severity]));
    expect(byRule['server-error']).toBe('P1');
    expect(byRule['client-error']).toBe('P2');
    expect(byRule['request-failed']).toBe('P1');
  });

  it('主文档自己的 4xx 不算子资源错误（visit 已经报过了）', () => {
    const violations = evaluateInspection(
      snapshot({
        network: [
          { url: 'http://127.0.0.1:3000/blog', method: 'GET', status: 404, duration_ms: 10, failed: true },
        ],
      }),
    );
    expect(violations).toEqual([]);
  });

  it('白屏（正文为空且不可见）→ P1', () => {
    const violations = evaluateInspection(
      snapshot({ meta: { ...snapshot().meta, bodyTextLength: 0, bodyVisible: false } }),
    );
    expect(rulesOf(snapshot({ meta: { ...snapshot().meta, bodyTextLength: 0, bodyVisible: false } }))).toEqual([
      'blank-page',
    ]);
    expect(violations[0]!.severity).toBe('P1');
  });

  it('缺 lang / viewport / 标题 → P3 观察项（不是错误）', () => {
    const s = snapshot({
      meta: { lang: null, viewport: null, hasTitle: false, bodyTextLength: 10, bodyVisible: true },
    });
    const violations = evaluateInspection(s);
    expect(violations.map((v) => v.rule).sort()).toEqual(['missing-lang', 'missing-title', 'missing-viewport']);
    expect(violations.every((v) => v.kind === 'observation' && v.severity === 'P3')).toBe(true);
  });

  it('慢响应 → P3 观察项，阈值可配', () => {
    const s = snapshot({
      network: [{ url: 'http://127.0.0.1:3000/big.js', method: 'GET', status: 200, duration_ms: 4200, failed: false }],
    });
    expect(rulesOf(s)).toContain('slow-response');
    expect(rulesOf(snapshot({
      network: [{ url: 'http://127.0.0.1:3000/big.js', method: 'GET', status: 200, duration_ms: 4200, failed: false }],
    }), { slowThresholdMs: 5000 })).not.toContain('slow-response');
  });

  it('https 页面加载 http 资源 → 混合内容', () => {
    const s = snapshot({
      url: 'https://example.com/page',
      network: [{ url: 'http://cdn.example.com/a.js', method: 'GET', status: 200, duration_ms: 10, failed: false }],
    });
    expect(rulesOf(s)).toContain('mixed-content');
  });

  it('每条命中都带证据，hash 内容寻址且不重复', () => {
    const violations = evaluateInspection(
      snapshot({
        pageErrors: ['boom'],
        console: [{ level: 'error', message: 'other' }],
      }),
    );
    const hashes = violations.flatMap((v) => v.evidence.map((e) => e.hash));
    expect(hashes.length).toBeGreaterThan(0);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
