/**
 * @sentinel/sensors — re-exports + 沙箱辅助。
 *
 * 真正的 sensor 实现在 @sentinel/subagents/sensor。
 * 这个 package 提供工具函数，不引入新 subagent。
 */

export { createSensor } from '@sentinel/subagents';

import type { Evidence, EvidenceKind } from '@sentinel/core';

/** 标准模式 5 项 */
export const STANDARD_KINDS: EvidenceKind[] = [
  'screenshot',
  'dom-snapshot',
  'a11y',
  'console',
  'network',
];

/** 详细模式额外 3 项 */
export const DETAILED_KINDS: EvidenceKind[] = ['storage', 'log', 'http'];

/** 按 hash 去重 */
export function dedupe(evidence: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of evidence) {
    if (seen.has(e.hash)) continue;
    seen.add(e.hash);
    out.push(e);
  }
  return out;
}
