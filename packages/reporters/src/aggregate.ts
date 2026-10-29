/**
 * 报告聚合 — 同源错误合并 + 三类判定口径。
 *
 * 2026-06-15 的真实运行产出 25 条几乎相同的假阳性（同一个 URL 拼接故障）。
 * 报告必须把它们合并，否则用户要自己看出"这是一个问题被报了 25 次"。
 *
 * ## 判定口径只有一份（报告与退出码必须一致）
 *
 * 一条诊断只有三种可能，缺一不可：
 *
 * | 判定 | 含义 | 计入「项目缺陷」 |
 * |---|---|---|
 * | `project-defect` | 被测项目的真实缺陷 | ✅ |
 * | `tool-failure` | Sentinel 自身链路故障（工具坏了） | ❌ |
 * | `sentinel-invalid-url` | Sentinel 自己拼出来的占位 URL 打到 404 —— 覆盖缺口 | ❌ |
 *
 * 第三类为什么必须单独有：以前只有两类，工具故障被排除了，
 * 但「Sentinel 用 Next.js 路由约定拼出来的 URL」（如 `/posts/:id`、`/@modal`）
 * 访问必然 404，判成 P1 项目缺陷 —— 每次 run 都产假 P1，退出码也被拉成 1。
 * 那不是项目的 bug，是**自己测错了地址**。
 */

import type { BugFinding, Evidence } from '@sentinel/core';
import { clusterAndDedupe, type ClusterResult } from './cluster.js';

/** Sentinel 自身链路故障的特征串 —— 这类问题不是被测项目的缺陷 */
const TOOL_FAILURE_PATTERNS = [
  'Cannot navigate to invalid URL',
  'fetch() URL is invalid',
  'Protocol error',
  'browser MCP not registered',
  'runner error:',
  'has been closed',
  'Target page, context or browser has been closed',
];

/** 一条诊断的判定分类 —— 报告、退出码、统计全部用这一份口径 */
export type BugVerdict =
  | 'project-defect'
  | 'tool-failure'
  | 'sentinel-invalid-url';

export function evidenceText(e: Evidence): string {
  switch (e.kind) {
    case 'console':
    case 'log':
      return e.message;
    case 'http':
    case 'network':
      return `${e.method} ${e.url} ${e.status}`;
    case 'file':
      return e.path;
    default:
      return e.kind;
  }
}

/** 这条 bug 是否由 Sentinel 自身链路故障造成 */
export function isToolFailure(bug: BugFinding): boolean {
  const text = [bug.symptom, bug.rootCause ?? '', ...bug.evidence.map(evidenceText)].join('\n');
  return TOOL_FAILURE_PATTERNS.some((p) => text.includes(p));
}

/**
 * 取 URL 的路径部分。
 *
 * 必须剥掉 scheme / host / 端口 —— 否则 `http://127.0.0.1:3000/` 的端口号
 * 会被误判成「路由占位符」，把正常页面错判成 Sentinel 自造的假 URL。
 */
export function pathOfUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return (url.split('?')[0] ?? url).trim();
  }
}

/**
 * 路径里有没有「路由占位符」。
 *
 * 只认 Sentinel 自己拼出来的、**真实 URL 里不可能出现**的痕迹（段级判定）：
 *   `:id`（动态段占位）· `:slug*`（捕获段占位）· `@slot`（并行槽漏网）
 *
 * 刻意**不**认 `(` `)` `[` `]`：
 * Pages Router 的目录名就是 URL 段（`pages/(marketing)/about.tsx` 的真实地址是
 * `/(marketing)/about`，Next.js 官方文档如此），那是**真实路由**，
 * 它 404 了就是项目的问题，不能算成"Sentinel 自己拼错地址"。
 */
export function hasRoutePlaceholder(url: string): boolean {
  const path = pathOfUrl(url);
  return path
    .split('/')
    .some((seg) => seg.startsWith('@') || seg.startsWith(':') || seg.includes('*'));
}

/** 证据或症状里是否出现过「带路由占位符的地址」 */
function mentionsPlaceholderUrl(bug: BugFinding): boolean {
  for (const e of bug.evidence) {
    if ((e.kind === 'network' || e.kind === 'http') && hasRoutePlaceholder(e.url)) return true;
  }
  const text = `${bug.title}\n${bug.symptom}\n${bug.reproSteps.join('\n')}`;
  return text
    .split(/[\s'"，。、；：）)\]]+/)
    .some((token) => (token.includes('://') || token.startsWith('/')) && hasRoutePlaceholder(token));
}

/** 有没有 404（地址不存在） */
function hasNotFound(bug: BugFinding): boolean {
  for (const e of bug.evidence) {
    if ((e.kind === 'network' || e.kind === 'http') && e.status === 404) return true;
  }
  return /HTTP 404|404 Not Found|status(?: code)?[:= ]+404/i.test(`${bug.symptom} ${bug.rootCause ?? ''}`);
}

/** 有没有服务端故障或前端运行时异常 —— 有的话就不是「地址不存在」，是真缺陷 */
function hasServerFault(bug: BugFinding): boolean {
  for (const e of bug.evidence) {
    if ((e.kind === 'network' || e.kind === 'http') && e.status >= 500) return true;
    if (e.kind === 'console' && e.level === 'error') return true;
    if (e.kind === 'log' && e.level === 'error') return true;
  }
  return false;
}

/**
 * 这条 bug 是不是「Sentinel 自己拼的 URL 打到了 404」。
 *
 * 判据（三条同时成立）：
 *   1. 只有 404，没有 5xx / console error —— 否则是真缺陷；
 *   2. 出问题的地址带路由占位符（`/posts/:id`、`/@modal`）；
 *   3. 也就是说：**这个地址本来就不存在，是 Sentinel 自己拼错的**。
 *
 * 这类问题算「覆盖缺口」而不是项目缺陷 —— 报告必须说出来，但不能算成项目有 P1。
 */
export function isSentinelInvalidUrl(bug: BugFinding): boolean {
  if (hasServerFault(bug)) return false;
  if (!hasNotFound(bug)) return false;
  return mentionsPlaceholderUrl(bug);
}

/**
 * 统一的判定入口 —— 报告、退出码、统计都调它。
 *
 * 以前报告层判「工具性失败」、CLI 层另判一次，两处口径必然漂移。
 */
export function classifyBug(bug: BugFinding): BugVerdict {
  if (isToolFailure(bug)) return 'tool-failure';
  if (isSentinelInvalidUrl(bug)) return 'sentinel-invalid-url';
  return 'project-defect';
}

/** 归一化错误文本：抹掉易变部分（数字 ID、时间戳），用于判定"同源" */
export function normalizeMessage(text: string): string {
  return text
    .replace(/\d{3,}/g, '#')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * 合并同一 bug 的两个版本 —— **已收到的富化字段不被空值覆盖**。
 *
 * 为什么需要它：bus 是顺序 await 分发，事件的到达顺序是"深层先到、浅层后到"。
 * 典型链路：critic 发 `bug.confirmed` → verifier 转发 → planner 出方案 → enhancer 补充
 * → 发 `fix.enhanced`（带 fixOptions）→ 报告层先拿到富化版本；
 * **随后**浅层的 `bug.confirmed`（critic 的原始 bug，fixOptions 还是空数组）才到达。
 * 若用覆盖语义，富化版本被空数组抹掉 → 报告第 7/8 字段永远显示"待 planner 产出"。
 */
export function mergeBugFinding(prev: BugFinding | undefined, next: BugFinding): BugFinding {
  if (!prev) return next;
  const merged: BugFinding = { ...next };
  if (prev.fixOptions && prev.fixOptions.length > 0 && (!next.fixOptions || next.fixOptions.length === 0)) {
    merged.fixOptions = prev.fixOptions;
  }
  if (prev.recommendedFixId && !next.recommendedFixId) {
    merged.recommendedFixId = prev.recommendedFixId;
  }
  // recommendedFixId 必须指向**真实存在**的方案 ——
  // next 带来新方案集时，prev 的 recommendedFixId 可能已经不在里面了。
  // 那样报告里"推荐方案"和"是否可自动修"就各说各的（一个指向不存在的 id，
  // 另一个按真实的第一条算），机器读起来是自相矛盾的。
  const options = merged.fixOptions ?? [];
  if (options.length > 0) {
    const exists = merged.recommendedFixId && options.some((o) => o.id === merged.recommendedFixId);
    if (!exists) merged.recommendedFixId = options[0]!.id;
  }
  return merged;
}

/**
 * 聚合同源 bug：同 source + 同 severity + **签名相似度 ≥ 0.85** 的算一条，其余折叠为计数。
 *
 * 以前是"症状全文精确匹配" —— 抓不到"同一个错、只差一个数字/路径/时间戳"的重复，
 * 而那正是真实运行里最常见的形态（2026-06-15 一次跑出 25 条几乎相同的假阳性）。
 * 相似度算法与归一化规则见 `cluster.ts`（阈值口径来自 cats 的 ErrorSimilarityDetector）。
 * 证据同时去重（同一 hash 只留一份），并给出**压缩前后字节数** —— "变简洁了"要能核对。
 */
export function aggregateDuplicateBugs(bugs: BugFinding[]): BugFinding[] {
  return clusterAndDedupe(bugs).bugs;
}

/**
 * 同上，但**带量化结果** —— 报告与 run-status.json 要能说清"合并了多少、去重省了多少字节"。
 */
export function aggregateDuplicateBugsWithStats(bugs: BugFinding[]): ClusterResult {
  return clusterAndDedupe(bugs);
}
