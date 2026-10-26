/**
 * Markdown Reporter — v1 主力。
 * 包含宪法规定的固定 11 字段。
 */

import type { BugFinding, FixOption } from '@sentinel/core';
import { isToolFailure } from './aggregate.js';
import { findTierDecision, type TierDecisionRecord } from './tier.js';

/** 报告选项：带上 executor 硬规则的 tier 判定（决定实际会不会改代码） */
export interface MarkdownOptions {
  /** executor 的硬规则判定结果 —— 报告必须展示它，而不是方案自报的 tier */
  tierDecisions?: TierDecisionRecord[];
  /** 运行模式：offline 时方案来自模板而不是模型，措辞要跟着变 */
  llmMode?: 'llm' | 'offline';
}

export function bugToMarkdown(bug: BugFinding, opts: MarkdownOptions = {}): string {
  const recommended = bug.fixOptions.find((o) => o.id === bug.recommendedFixId) ?? bug.fixOptions[0];
  const alternatives = bug.fixOptions.filter((o) => o.id !== recommended?.id);

  const lines: string[] = [];
  lines.push(`# ${severityIcon(bug.severity)} ${bug.severity} · ${bug.id}`);
  lines.push('');
  lines.push(`**${bug.title}**`);
  lines.push('');

  // 工具性失败：Sentinel 自身链路的问题，不是被测项目的缺陷 —— 必须说清楚
  if (isToolFailure(bug)) {
    lines.push('> ⚠ **工具性失败**：这是 Sentinel 自身链路的问题，不是被测项目的缺陷。请先修工具链再评估项目。');
    lines.push('');
  }

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
  // 结论来源必须标出来：规则判定（确定性事实）、模型推断、启发式回退不是一回事。
  // 离线模式下模型根本没参与（llmRequests=0），标成"模型推断"就是在冒充。
  const originTag = originLabel(bug.origin);
  lines.push(`**6. 根因判断** (${status}${originTag}, conf=${bug.confidence.toFixed(2)}):`);
  lines.push(`   ${bug.rootCause?.trim() ? bug.rootCause : '证据不足，未能定位根因（hypothesis）'}`);

  // 7. 推荐方案 —— 宪法要求 11 字段缺一不行，没有方案时也要出现
  if (recommended) {
    lines.push('**7. 推荐方案** ★:');
    lines.push(formatOption(recommended, '   '));
  } else {
    lines.push('**7. 推荐方案** ★: (待 planner 产出)');
  }

  // 8. 备选方案
  lines.push(`**8. 备选方案** (${alternatives.length}):`);
  if (alternatives.length === 0) lines.push('   (无)');
  for (const o of alternatives) {
    lines.push(formatOption(o, '   '));
  }

  // 9. 风险评估
  if (recommended) {
    lines.push(`**9. 风险评估**: effort=${recommended.effort}, risk=${recommended.risk}, regressionRisk=${recommended.regressionRisk}`);
  } else {
    lines.push('**9. 风险评估**: (无修复方案，暂无评估)');
  }

  // 10. 验证命令
  if (recommended?.verificationCommand || bug.verificationCommand) {
    lines.push(`**10. 验证命令**: \`${recommended?.verificationCommand ?? bug.verificationCommand}\``);
  } else {
    lines.push('**10. 验证命令**: (无)');
  }

  // 11. 是否可自动修
  //    用 executor 硬规则判出来的 tier，不是 LLM 自报的 —— 真正决定改不改代码的是前者
  if (recommended) {
    const decision = findTierDecision(opts.tierDecisions, recommended.id);
    const tier = decision?.tier ?? recommended.tier;
    const tierDesc = ['只报告', '自动修', '写 patch 待审核', '仅建议'][tier];
    const reason = decision ? `（依据：${decision.reason}）` : '';
    // 离线模式没有模型，方案来自通用模板 —— 写"LLM 原判"是撒谎
    const sourceLabel = opts.llmMode === 'offline' ? '方案模板' : 'LLM';
    const mismatch = decision?.llmTier !== undefined && decision.llmTier !== tier
      ? ` [${sourceLabel} 原判 Tier ${decision.llmTier}，硬规则已降级]`
      : '';
    lines.push(`**11. 是否可自动修**: Tier ${tier} — ${tierDesc}${reason}${mismatch}`);
  } else {
    lines.push('**11. 是否可自动修**: (无修复方案，暂不判定)');
  }

  return lines.join('\n');
}

export function reportToMarkdown(
  bugs: BugFinding[],
  meta: { generatedAt?: number; project?: string; llmMode?: 'llm' | 'offline' } = {},
  opts: MarkdownOptions = {},
): string {
  const lines: string[] = [];
  lines.push(`# Sentinel Report`);
  lines.push('');
  if (meta.project) lines.push(`**项目**: ${meta.project}`);
  lines.push(`**生成时间**: ${new Date(meta.generatedAt ?? Date.now()).toISOString()}`);
  lines.push(`**Bug 总数**: ${bugs.length}`);
  // 运行模式必须写在报告里 —— 否则"没做根因分析"看起来像"没发现问题"
  if (meta.llmMode === 'offline') {
    lines.push('**运行模式**: 离线（未调用 LLM、未联网）—— 巡检结论为确定性规则判定；未做 AI 根因分析');
  }

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
    lines.push(bugToMarkdown(b, opts));
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

/**
 * 结论来源的展示文案。
 *
 * 三种来源必须说清楚：
 *   rule      → 确定性规则判定（运行时事实）
 *   llm       → 模型推断
 *   heuristic → 启发式结论（**模型没有参与**：离线模式，或 LLM 调用失败后的兜底）
 *   未标注     → 旧数据，按模型推断处理
 */
function originLabel(origin: BugFinding['origin']): string {
  switch (origin) {
    case 'rule':
      return '，确定性规则判定';
    case 'heuristic':
      return '，启发式判定（未调用模型）';
    case 'llm':
      return '，模型推断';
    default:
      return '';
  }
}

function describeEvidence(e: import('@sentinel/core').Evidence): string {  switch (e.kind) {
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
