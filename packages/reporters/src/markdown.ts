/**
 * Markdown Reporter — v1 主力。
 * 包含宪法规定的固定 11 字段。
 */

import type { BugFinding, FixOption } from '@sentinel/core';

export function bugToMarkdown(bug: BugFinding): string {
  const recommended = bug.fixOptions.find((o) => o.id === bug.recommendedFixId) ?? bug.fixOptions[0];
  const alternatives = bug.fixOptions.filter((o) => o.id !== recommended?.id);

  const lines: string[] = [];
  lines.push(`# ${severityIcon(bug.severity)} ${bug.severity} · ${bug.id}`);
  lines.push('');
  lines.push(`**${bug.title}**`);
  lines.push('');

  // 1. Bug ID
  lines.push(`**1. Bug ID**: \`${bug.id}\``);

  // 2. 严重级别
  lines.push(`**2. 严重级别**: ${bug.severity}`);

  // 3. 影响功能
  lines.push(`**3. 影响功能**: ${bug.affectedFeature}`);

  // 4. 复现步骤
  lines.push('**4. 复现步骤**:');
  for (const step of bug.reproSteps) {
    lines.push(`   - ${step}`);
  }

  // 5. Evidence
  lines.push(`**5. Evidence** (${bug.evidence.length} 条):`);
  for (const e of bug.evidence) {
    lines.push(`   - \`${e.hash}\` [${e.kind}/${e.source}] ${describeEvidence(e)}`);
  }

  // 6. 根因判断
  const status = bug.rootCauseStatus === 'confirmed' ? '✓ confirmed' : '⚠ hypothesis';
  lines.push(`**6. 根因判断** (${status}, conf=${bug.confidence.toFixed(2)}):`);
  lines.push(`   ${bug.rootCause ?? '(insufficient evidence)'}`);

  // 7. 推荐方案
  if (recommended) {
    lines.push('**7. 推荐方案** ★:');
    lines.push(formatOption(recommended, '   '));
  }

  // 8. 备选方案
  lines.push(`**8. 备选方案** (${alternatives.length}):`);
  for (const o of alternatives) {
    lines.push(formatOption(o, '   '));
  }

  // 9. 风险评估
  if (recommended) {
    lines.push(`**9. 风险评估**: effort=${recommended.effort}, risk=${recommended.risk}, regressionRisk=${recommended.regressionRisk}`);
  }

  // 10. 验证命令
  if (recommended?.verificationCommand || bug.verificationCommand) {
    lines.push(`**10. 验证命令**: \`${recommended?.verificationCommand ?? bug.verificationCommand}\``);
  } else {
    lines.push('**10. 验证命令**: (无)');
  }

  // 11. 是否可自动修
  if (recommended) {
    const tierDesc = ['只报告', '自动修', '写 patch 待审核', '仅建议'][recommended.tier];
    lines.push(`**11. 是否可自动修**: Tier ${recommended.tier} — ${tierDesc}`);
  }

  return lines.join('\n');
}

export function reportToMarkdown(bugs: BugFinding[], meta: { generatedAt?: number; project?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`# Sentinel Report`);
  lines.push('');
  if (meta.project) lines.push(`**项目**: ${meta.project}`);
  lines.push(`**生成时间**: ${new Date(meta.generatedAt ?? Date.now()).toISOString()}`);
  lines.push(`**Bug 总数**: ${bugs.length}`);

  const counts = bugs.reduce(
    (acc, b) => {
      acc[b.severity] = (acc[b.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  lines.push(`**分级**: P0=${counts['P0'] ?? 0}, P1=${counts['P1'] ?? 0}, P2=${counts['P2'] ?? 0}, P3=${counts['P3'] ?? 0}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const b of bugs) {
    lines.push(bugToMarkdown(b));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function severityIcon(s: BugFinding['severity']): string {
  return { P0: '🔴', P1: '🟠', P2: '🟡', P3: '🔵' }[s];
}

function formatOption(o: FixOption, indent: string): string {
  const tier = o.tier === 1 ? 'Tier 1 自动' : o.tier === 2 ? 'Tier 2 PR' : o.tier === 3 ? 'Tier 3 仅建议' : 'Tier 0';
  const sources = o.sources.length > 0
    ? `\n${indent}  来源: ${o.sources.map((s) => `[${s.authority}] ${s.url}`).join(', ')}`
    : '';
  return `${indent}- **${o.title}** (${tier}, score=${o.score.toFixed(2)})\n${indent}  ${o.description}${sources}`;
}

function describeEvidence(e: import('@sentinel/core').Evidence): string {
  switch (e.kind) {
    case 'console':
      return `${e.level}: ${e.message.slice(0, 120)}`;
    case 'network':
      return `${e.method} ${e.url} → ${e.status}${e.failed ? ' FAILED' : ''}`;
    case 'http':
      return `${e.method} ${e.url} → ${e.status}`;
    case 'screenshot':
      return `image (${e.path.slice(0, 60)}...)`;
    case 'a11y':
      return `accessibility tree`;
    case 'dom-snapshot':
      return `DOM (${e.html.length} chars)`;
    case 'log':
      return `[${e.level}] ${e.message.slice(0, 120)}`;
    default:
      return e.kind;
  }
}
