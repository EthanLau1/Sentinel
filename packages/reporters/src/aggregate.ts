/**
 * 报告聚合 — 同源错误合并 + 工具性失败识别。
 *
 * 2026-06-15 的真实运行产出 25 条几乎相同的假阳性（同一个 URL 拼接故障）。
 * 报告必须把它们合并，否则用户要自己看出"这是一个问题被报了 25 次"。
 */

import type { BugFinding, Evidence } from '@sentinel/core';

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
  return merged;
}

/**
 * 聚合同源 bug：同 source + 同 severity + 同症状只保留一条，其余折叠为计数。
 * 证据合并（最多 10 条），避免报告被同质证据淹没。
 */
export function aggregateDuplicateBugs(bugs: BugFinding[]): BugFinding[] {
  const groups = new Map<string, BugFinding[]>();
  for (const bug of bugs) {
    const key = `${bug.source}|${bug.severity}|${normalizeMessage(bug.symptom)}`;
    const group = groups.get(key);
    if (group) group.push(bug);
    else groups.set(key, [bug]);
  }

  const out: BugFinding[] = [];
  for (const group of groups.values()) {
    const [first, ...rest] = group;
    if (!first) continue;
    if (rest.length === 0) {
      out.push(first);
      continue;
    }
    const merged = [...first.evidence, ...rest.flatMap((r) => r.evidence)].slice(0, 10);
    out.push({
      ...first,
      title: `${first.title} [同类 ${group.length} 条已合并]`,
      symptom: `${first.symptom}\n   （已合并 ${rest.length} 条同源问题）`,
      evidence: merged,
    });
  }
  return out;
}
