/**
 * 同源结论聚类 + 证据去重。
 *
 * ## 为什么要有
 *
 * 2026-06-15 的真实运行产出 25 条几乎相同的假阳性（同一个 URL 拼接故障）。
 * 25 条重复 finding 的代价是三重的：
 *   1. 报告噪声 —— 用户放弃阅读，整个工具失去意义；
 *   2. **成本** —— 每条重复 finding 各自消耗一次 LLM 调用；
 *   3. **淹没真问题** —— 25 条同源噪音会把唯一那条真根因埋掉。
 *
 * 以前 `aggregate.ts` 的归一化只抹数字，然后按「source + severity + 症状全文」**精确匹配**分组。
 * 精确匹配抓不到"同一个错、不同一个数字/路径/时间戳"的重复 ——
 * 而那正是真实运行里最常见的形态。
 *
 * ## 借了什么（借鉴清单见 docs/GITHUB-BORROW-ANALYSIS-2026-10-29.md §P1-E）
 *
 * cats 的 `ErrorSimilarityDetector`：相似度阈值 0.85、Jaccard 阈值 0.7、
 * 模式匹配加成 0.2、比较前缀长度 240；签名键按错误类型 / 错误细节 / 堆栈分层；
 * 归一化时剔除 TIMESTAMP / UUID / HASH / URL / PATH / NUM。
 * midscene 的 dump compactor：**压缩前后量化**（beforeBytes → afterBytes），
 * 不是"感觉变简洁了"。
 *
 * ## 刻意没抄
 *
 * cats 的 157 个 fuzzer 全量、Java/Quarkus 栈、**安全注入类 fuzzer**
 * （Sentinel 是"项目体检"，不是渗透测试）。
 */

import type { BugFinding, Evidence } from '@sentinel/core';

/** 相似度阈值：达到即认为是同一个问题（cats 同款口径） */
export const LEVENSHTEIN_THRESHOLD = 0.85;
/** Jaccard 阈值 */
export const JACCARD_THRESHOLD = 0.7;
/** 错误类型一致时的加成 */
export const PATTERN_MATCH_BONUS = 0.2;
/** 只比较前 N 个字符 —— 错误消息的差异通常在尾部 */
export const COMPARE_PREFIX_LENGTH = 240;

/** 错误类型签名键 —— 命中同一个就算"同类错误" */
const ERROR_TYPE_KEYS = [
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'EvalError',
  'URIError',
  'AggregateError',
  'TimeoutError',
  'NetworkError',
  'AssertionError',
  'Error',
  'Exception',
  'Warning',
];

/**
 * 归一化错误文本：抹掉易变部分，让"同一个错的不同现场"落到同一个签名上。
 *
 * 剔除：TIMESTAMP / UUID / HASH / URL / PATH / NUM（≥3 位）。
 *
 * 注意 NUM 只抹 **3 位及以上**的数：HTTP 状态码（500 / 404）是 3 位，
 * 但它必须保留 —— 否则"接口 500"和"接口 404"会被认成同一个问题。
 */
export function normalizeSignature(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<URL>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<HASH>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '<TS>')
    // 路径连同"行:列"一起吞掉 ——
    // 只吞路径会留下 ":3:1"，错误消息后面挂一段现场尾巴，
    // 字面相似度就掉到阈值以下（同一个错、不同行号反而合并不了）。
    .replace(/(?:\/[\w.@%-]+){2,}\/?[a-z]{0,4}(?::\d+){0,2}/g, '<PATH>')
    // 3 位数字先看是不是 HTTP 状态码 —— 500 与 404 是**两种不同的故障**，
    // 抹掉它们就会把"接口挂了"和"地址不存在"合并成一条，掩盖真实差异。
    .replace(/\b\d{3}\b/g, (m) => (Number(m) >= 100 && Number(m) <= 599 ? m : '<NUM>'))
    .replace(/\b\d{4,}\b/g, '<NUM>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 抽 HTTP 状态码。
 *
 * 只认"上下文里明确写着状态码"的地方（returned / status / http 后面）——
 * 否则 "found 250 items" 里的 250 会被当成状态码，把两条无关的问题拆开。
 */
export function statusCodes(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b(?:returned|status(?:\s*code)?|http)\D{0,10}?([1-5]\d{2})\b/gi)) {
    out.add(Number(m[1]));
  }
  return [...out];
}

/** 抽错误类型键（TypeError / TimeoutError / …） */
export function errorTypeKeys(text: string): string[] {
  const found = new Set<string>();
  for (const key of ERROR_TYPE_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(text)) found.add(key);
  }
  // 更一般的写法：任意以 Error / Exception 结尾的大驼峰
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]*(?:Error|Exception))\b/g)) {
    found.add(m[1]!);
  }
  return [...found];
}

/** Levenshtein 距离（滚动数组，O(n·m) 时间 / O(min) 空间） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** 归一化后的 Levenshtein 相似度（1 = 完全一样） */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** 词集合 Jaccard 相似度 */
export function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/**
 * 综合相似度（0~1）。
 *
 * 公式（本次自己定，写清楚以便核对）：
 *   base = 0.6 × Levenshtein 相似度 + 0.4 × Jaccard 相似度（都只看前 240 字符）
 *   若两边的**错误类型键**有交集 → +0.2（模式匹配加成）
 *   截到 1
 *
 * 为什么两个都要：Levenshtein 抓"改了几个字"，Jaccard 抓"词换了但意思一样"。
 * 只用一个都会漏掉一半的真实重复。
 */
export function similarity(aRaw: string, bRaw: string): number {
  const a = normalizeSignature(aRaw).slice(0, COMPARE_PREFIX_LENGTH);
  const b = normalizeSignature(bRaw).slice(0, COMPARE_PREFIX_LENGTH);
  if (!a || !b) return 0;

  // 硬否决 1：错误类型不同 → 不是同一个问题。
  // "TypeError: x is not a function" 与 "ReferenceError: y is not defined"
  // 字面相似度很高，但它们是两种完全不同的病，合并了会掩盖真实差异。
  const keysA = errorTypeKeys(aRaw);
  const keysB = errorTypeKeys(bRaw);
  if (keysA.length > 0 && keysB.length > 0 && !keysA.some((k) => keysB.includes(k))) return 0;

  // 硬否决 2：HTTP 状态码不同 → 不是同一个问题（500 与 404 只差一个字符，
  // 光看字面相似度会把"服务挂了"和"地址不存在"判成同一个）。
  const stA = statusCodes(aRaw);
  const stB = statusCodes(bRaw);
  if (stA.length > 0 && stB.length > 0 && !stA.some((s) => stB.includes(s))) return 0;

  const lev = levenshteinRatio(a, b);
  const jac = jaccardSimilarity(a, b);

  // 包含关系 → 同一个问题：短的那条是长的那条的"去掉现场尾巴"的版本。
  // "Cannot read properties of undefined (reading 'name')"
  //   ⊂ "Cannot read properties of undefined (reading 'name') at <path>"
  // 这种"同一个错、不同现场"是真实运行里最常见的重复形态 ——
  // 光靠字面相似度会因为尾巴太长而掉到阈值以下（0.81 < 0.85），那就合并不了。
  if (a.includes(b) || b.includes(a)) return 1;

  let score = 0.6 * lev + 0.4 * jac;
  // 模式匹配加成：同一个错误类型 → 更可能是同一个问题
  if (keysA.some((k) => keysB.includes(k))) score += PATTERN_MATCH_BONUS;
  return Math.min(1, score);
}

/** 一条 bug 的聚类签名 —— 只用症状与根因，不用标题（标题带 flowId，会把同类拆开） */
export function signatureOf(bug: BugFinding): string {
  return normalizeSignature(`${bug.symptom} ${bug.rootCause ?? ''}`);
}

/**
 * 同源聚类：把"同一个问题"归成一组。
 *
 * 硬过滤：**source 与 severity 必须相同** —— 同一个页面上的 P0 与 P1 不是同一个问题。
 * 软判定：签名的综合相似度 ≥ 阈值。
 */
export function clusterBugs(bugs: BugFinding[]): BugFinding[][] {
  const clusters: BugFinding[][] = [];
  const sigs: string[] = [];
  for (const bug of bugs) {
    const sig = signatureOf(bug);
    let placed = false;
    for (let i = 0; i < clusters.length; i += 1) {
      const rep = clusters[i]![0]!;
      if (rep.source !== bug.source || rep.severity !== bug.severity) continue;
      if (similarity(sigs[i]!, sig) >= LEVENSHTEIN_THRESHOLD) {
        clusters[i]!.push(bug);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([bug]);
      sigs.push(sig);
    }
  }
  return clusters;
}

/** 证据去重的量化结果 —— "变简洁了"必须变成可比的数字 */
export interface EvidenceDedupeStats {
  beforeCount: number;
  afterCount: number;
  beforeBytes: number;
  afterBytes: number;
}

/** 证据去重：同一条证据（按 hash + 类型）只留一份 */
export function dedupeEvidence(evidence: Evidence[]): {
  items: Evidence[];
  stats: EvidenceDedupeStats;
} {
  const seen = new Set<string>();
  const items: Evidence[] = [];
  let beforeBytes = 0;
  for (const e of evidence) {
    const json = JSON.stringify(e);
    beforeBytes += json.length;
    const key = `${e.kind}:${e.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(e);
  }
  const afterBytes = items.reduce((n, e) => n + JSON.stringify(e).length, 0);
  return {
    items,
    stats: {
      beforeCount: evidence.length,
      afterCount: items.length,
      beforeBytes,
      afterBytes,
    },
  };
}

/** 聚类 + 证据去重的整体结果 */
export interface ClusterResult {
  /** 合并后的 bug（每组一条） */
  bugs: BugFinding[];
  /** 合并了多少条重复 finding */
  mergedCount: number;
  /** 合并后剩几组 */
  clusterCount: number;
  /** 证据去重的压缩前后对比 */
  evidence: EvidenceDedupeStats;
}

/**
 * 聚合同源 bug + 证据去重（带量化）。
 *
 * 证据上限从 10 条**收紧到 8 条**：同源合并后证据本来就重复，
 * 留 10 条往往只是同一条证据的 10 个副本。
 */
export function clusterAndDedupe(bugs: BugFinding[], evidenceLimit = 8): ClusterResult {
  const clusters = clusterBugs(bugs);
  const out: BugFinding[] = [];
  let beforeCount = 0;
  let beforeBytes = 0;
  let afterCount = 0;
  let afterBytes = 0;

  for (const group of clusters) {
    const [first, ...rest] = group;
    if (!first) continue;
    const allEvidence = [...first.evidence, ...rest.flatMap((r) => r.evidence)];
    beforeCount += allEvidence.length;
    const { items, stats } = dedupeEvidence(allEvidence);
    afterCount += items.length;
    beforeBytes += stats.beforeBytes;
    afterBytes += stats.afterBytes;

    if (rest.length === 0) {
      out.push({ ...first, evidence: items.slice(0, evidenceLimit) });
      continue;
    }
    out.push({
      ...first,
      title: `${first.title} [同类 ${group.length} 条已合并]`,
      symptom: `${first.symptom}\n   （已合并 ${rest.length} 条同源问题）`,
      evidence: items.slice(0, evidenceLimit),
    });
  }

  return {
    bugs: out,
    mergedCount: bugs.length - out.length,
    clusterCount: out.length,
    evidence: { beforeCount, afterCount, beforeBytes, afterBytes },
  };
}
