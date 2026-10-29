import { describe, it, expect } from 'vitest';
import type { BugFinding, Evidence } from '@sentinel/core';
import {
  clusterAndDedupe,
  clusterBugs,
  dedupeEvidence,
  errorTypeKeys,
  jaccardSimilarity,
  levenshteinRatio,
  normalizeSignature,
  similarity,
  statusCodes,
  LEVENSHTEIN_THRESHOLD,
} from '../src/cluster.js';

/**
 * 同源聚类 + 证据去重。
 *
 * 这组用例盯**两个方向**的错误：
 *   - 该合并的没合并（漏）：URL/路径/时间戳/数字不同的同一个错，是真实运行里最常见的重复形态；
 *   - 不该合并的合并了（误）：500 与 404、TypeError 与 ReferenceError 只差几个字符，
 *     字面相似度很高 —— 合并了就等于**掩盖真实差异**。
 */

function bug(over: Partial<BugFinding> = {}): BugFinding {
  return {
    id: 'bug_1',
    title: '页面报错',
    severity: 'P1',
    source: 'ui',
    affectedFeature: 'flow_1',
    symptom: "Cannot read properties of undefined (reading 'name')",
    reproSteps: ['访问 /posts'],
    evidence: [],
    rootCauseStatus: 'hypothesis',
    counterEvidence: [],
    confidence: 0.5,
    fixOptions: [],
    ...over,
  };
}

function ev(hash: string, message: string): Evidence {
  return { kind: 'console', source: 'browser', hash, timestamp: 1, level: 'error', message };
}

describe('签名归一化', () => {
  it('URL / 路径 / 时间戳 / 长数字都被抹掉', () => {
    const sig = normalizeSignature(
      'GET https://a.com/x failed at /Users/ethan/app/page.tsx:12:5 on 2026-10-29T10:00:00Z id=889923',
    );
    // 归一化最后会统一转小写，所以占位符也是小写
    expect(sig).toContain('<url>');
    expect(sig).toContain('<ts>');
    expect(sig).not.toContain('889923');
    expect(sig).not.toContain('a.com');
  });

  it('HTTP 状态码必须保留（500 与 404 是两种故障）', () => {
    const sig = normalizeSignature('API GET /posts returned 500');
    expect(sig).toContain('500');
    expect(normalizeSignature('API GET /posts returned 404')).toContain('404');
  });

  it('错误类型键能抽出来', () => {
    expect(errorTypeKeys('TypeError: x is not a function')).toContain('TypeError');
    expect(errorTypeKeys('ReferenceError: y is not defined')).toContain('ReferenceError');
    // TypeError 里不应该再抽出 "Error"（那会把两类错误判成同类）
    expect(errorTypeKeys('TypeError: x is not a function')).not.toContain('Error');
  });

  it('状态码只在有上下文时才认（250 items 不是状态码）', () => {
    expect(statusCodes('API GET /x returned 500')).toEqual([500]);
    expect(statusCodes('HTTP 404 Not Found')).toEqual([404]);
    expect(statusCodes('found 250 items')).toEqual([]);
  });
});

describe('相似度', () => {
  it('同一个错的不同现场 → 高相似度', () => {
    const a = "Cannot read properties of undefined (reading 'name')";
    const b = "Cannot read properties of undefined (reading 'name') at /Users/x/page.tsx:3:1";
    expect(similarity(a, b)).toBeGreaterThanOrEqual(LEVENSHTEIN_THRESHOLD);
  });

  it('不同错误类型 → 直接判为不同（硬否决）', () => {
    const a = 'TypeError: props.map is not a function';
    const b = 'ReferenceError: props is not defined';
    expect(similarity(a, b)).toBe(0);
  });

  it('不同状态码 → 直接判为不同（硬否决）', () => {
    const a = 'API GET /posts returned 500';
    const b = 'API GET /posts returned 404';
    expect(similarity(a, b)).toBe(0);
  });

  it('Levenshtein 与 Jaccard 各自的行为', () => {
    expect(levenshteinRatio('abc', 'abc')).toBe(1);
    expect(levenshteinRatio('', '')).toBe(1);
    expect(levenshteinRatio('abc', 'abd')).toBeLessThan(1);
    expect(jaccardSimilarity('a b c', 'a b c')).toBe(1);
    expect(jaccardSimilarity('a b', 'x y')).toBe(0);
  });
});

describe('同源聚类', () => {
  it('只差 URL 与路径的重复 → 合并成一条', () => {
    const bugs = [
      bug({ id: 'a', symptom: '访问 https://a.com/posts 失败：Cannot read properties of undefined' }),
      bug({ id: 'b', symptom: '访问 https://b.com/posts 失败：Cannot read properties of undefined' }),
    ];
    const clusters = clusterBugs(bugs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('不同问题 → 不合并', () => {
    const bugs = [
      bug({ id: 'a', symptom: '页面渲染为空' }),
      bug({ id: 'b', symptom: '接口返回了超时错误' }),
    ];
    expect(clusterBugs(bugs)).toHaveLength(2);
  });

  it('严重度不同 → 不合并（同一页面的 P0 与 P1 是两个问题）', () => {
    const bugs = [
      bug({ id: 'a', severity: 'P1', symptom: '页面渲染为空' }),
      bug({ id: 'b', severity: 'P0', symptom: '页面渲染为空' }),
    ];
    expect(clusterBugs(bugs)).toHaveLength(2);
  });

  it('来源不同 → 不合并', () => {
    const bugs = [
      bug({ id: 'a', source: 'ui', symptom: '页面渲染为空' }),
      bug({ id: 'b', source: 'api', symptom: '页面渲染为空' }),
    ];
    expect(clusterBugs(bugs)).toHaveLength(2);
  });
});

describe('证据去重与量化', () => {
  it('同一 hash 的证据只留一份，且给出压缩前后字节数', () => {
    const evidence = [ev('h1', 'boom'), ev('h1', 'boom'), ev('h2', 'other')];
    const { items, stats } = dedupeEvidence(evidence);
    expect(items).toHaveLength(2);
    expect(stats.beforeCount).toBe(3);
    expect(stats.afterCount).toBe(2);
    expect(stats.afterBytes).toBeLessThan(stats.beforeBytes);
  });

  it('合并结果带量化数字（合并几条、剩几组、证据省多少字节）', () => {
    const bugs = [
      bug({ id: 'a', evidence: [ev('h1', 'boom')] }),
      bug({ id: 'b', evidence: [ev('h1', 'boom'), ev('h2', 'other')] }),
    ];
    const result = clusterAndDedupe(bugs);
    expect(result.bugs).toHaveLength(1);
    expect(result.mergedCount).toBe(1);
    expect(result.clusterCount).toBe(1);
    expect(result.evidence.beforeCount).toBe(3);
    expect(result.evidence.afterCount).toBe(2);
    expect(result.evidence.afterBytes).toBeLessThan(result.evidence.beforeBytes);
    expect(result.bugs[0]!.title).toContain('同类 2 条已合并');
  });
});
