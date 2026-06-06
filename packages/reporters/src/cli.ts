/**
 * CLI Reporter — 终端彩色输出。
 * 不依赖 chalk / picocolors，自带最小 ANSI。
 */

import type { BugFinding } from '@sentinel/core';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

export const color = {
  red: (s: string) => `${C.red}${s}${C.reset}`,
  green: (s: string) => `${C.green}${s}${C.reset}`,
  yellow: (s: string) => `${C.yellow}${s}${C.reset}`,
  blue: (s: string) => `${C.blue}${s}${C.reset}`,
  cyan: (s: string) => `${C.cyan}${s}${C.reset}`,
  bold: (s: string) => `${C.bold}${s}${C.reset}`,
  dim: (s: string) => `${C.dim}${s}${C.reset}`,
};

export function printBug(bug: BugFinding): string {
  const sevColor = bug.severity === 'P0' ? color.red : bug.severity === 'P1' ? color.yellow : bug.severity === 'P2' ? color.blue : color.dim;
  const lines: string[] = [];
  lines.push('');
  lines.push(`${sevColor(bug.severity)} ${color.bold(bug.title)}`);
  lines.push(`${color.dim(`  id: ${bug.id} · ${bug.affectedFeature} · conf=${bug.confidence.toFixed(2)} · ${bug.rootCauseStatus}`)}`);
  if (bug.rootCause) {
    lines.push(`  ${color.cyan('根因')}: ${bug.rootCause}`);
  }
  lines.push(`  ${color.dim(`Evidence: ${bug.evidence.length} 条 (${bug.evidence.map((e) => e.kind).join(', ')})`)}`);

  if (bug.fixOptions.length > 0) {
    const recommended = bug.fixOptions.find((o) => o.id === bug.recommendedFixId) ?? bug.fixOptions[0];
    if (recommended) {
      const tierColor = recommended.tier <= 1 ? color.green : recommended.tier === 2 ? color.yellow : color.red;
      lines.push(`  ${color.bold('★ 推荐')}: ${recommended.title} ${tierColor(`Tier ${recommended.tier}`)}  score=${recommended.score.toFixed(2)}`);
    }
  }
  return lines.join('\n');
}

export function printSummary(bugs: BugFinding[]): string {
  const counts = bugs.reduce(
    (acc, b) => {
      acc[b.severity] = (acc[b.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return [
    color.bold(`Total: ${bugs.length}`),
    color.red(`P0: ${counts['P0'] ?? 0}`),
    color.yellow(`P1: ${counts['P1'] ?? 0}`),
    color.blue(`P2: ${counts['P2'] ?? 0}`),
    color.dim(`P3: ${counts['P3'] ?? 0}`),
  ].join('  ');
}
