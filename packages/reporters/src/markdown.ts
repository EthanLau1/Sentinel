/**
 * Markdown Reporter — v1 主力。
 * 包含宪法规定的固定 11 字段。
 */

import type { BugFinding, FixOption } from '@sentinel/core';
import { classifyBug } from './aggregate.js';
import { findTierDecision, type TierDecisionRecord } from './tier.js';
import { coverageIsUninformative, type CoverageInfo } from './coverage.js';

/** 报告选项：带上 executor 硬规则的 tier 判定（决定实际会不会改代码） */
export interface MarkdownOptions {
  /** executor 的硬规则判定结果 —— 报告必须展示它，而不是方案自报的 tier */
  tierDecisions?: TierDecisionRecord[];
  /** 运行模式：offline 时方案来自模板而不是模型，措辞要跟着变 */
  llmMode?: 'llm' | 'offline';
  /** 本次覆盖范围 —— 报告必须告诉用户"测了什么、没测什么" */
  coverage?: CoverageInfo;
  /**
   * 被拒绝的补丁（executor 判定"没法产出这个改动"）。
   *
   * 为什么必须进报告：硬规则可能把方案判成 Tier 1「自动修」，
   * 但执行时发现没有可用 patch → 什么都没改。
   * 报告如果只写"Tier 1 — 自动修"，就是"报告说能做、实际没做"。
   */
  rejectedPatches?: Array<{ fixId: string; reason: string }>;
  /**
   * 被 critic 判定「证据不足」而剔除的草稿。
   *
   * 剔除 ≠ 藏起来：报告必须单列出来并写明理由，
   * 否则用户会以为"这条问题 Sentinel 查过了没问题"。
   */
  rejectedFindings?: Array<{ bugId: string; reason: string }>;
  /**
   * 因为 critic 自己没跑起来（模型不可用）而未经反向验证的发现。
   * 这些发现保留在列表里，但必须标明"没验过"。
   */
  unverifiedBugIds?: string[];
  /**
   * 同源合并与证据去重的**量化结果**。
   *
   * 为什么必须写进报告：以前"合并了 25 条重复"只是体感，
   * 现在给出可核对的数字 —— 合并了几条、证据从几条/几字节变成几条/几字节。
   * 少写这一行，用户会怀疑"是不是把不同的问题也合并掉了"。
   */
  dedupe?: {
    mergedCount: number;
    clusterCount: number;
    evidence: { beforeCount: number; afterCount: number; beforeBytes: number; afterBytes: number };
  };
}

export function bugToMarkdown(bug: BugFinding, opts: MarkdownOptions = {}): string {
  const recommended = bug.fixOptions.find((o) => o.id === bug.recommendedFixId) ?? bug.fixOptions[0];
  const alternatives = bug.fixOptions.filter((o) => o.id !== recommended?.id);

  const lines: string[] = [];
  lines.push(`# ${severityIcon(bug.severity)} ${bug.severity} · ${bug.id}`);
  lines.push('');
  lines.push(`**${bug.title}**`);
  lines.push('');

  // 三类判定 —— 报告和退出码必须用同一份口径（见 aggregate.ts）
  const verdict = classifyBug(bug);
  if (verdict === 'tool-failure') {
    lines.push('> ⚠ **工具性失败**：这是 Sentinel 自身链路的问题，不是被测项目的缺陷。请先修工具链再评估项目。');
    lines.push('');
  } else if (verdict === 'sentinel-invalid-url') {
    lines.push(
      '> ⚠ **覆盖缺口（Sentinel 自造地址）**：这条 404 是 Sentinel 用路由约定拼出来的占位地址打出来的' +
      '（例如 `/posts/:id`、`/@modal`），**不是被测项目的缺陷**。' +
      '真实地址请写进 `.sentinel/app.map.ts`；本条不计入项目缺陷，也不触发失败退出码。',
    );
    lines.push('');
  }

  // critic 没跑起来 → 这条结论没被反向验证过，必须说清楚
  if (opts.unverifiedBugIds?.includes(bug.id)) {
    lines.push('> ⚠ **未经反向验证**：critic 未能运行（模型不可用），本条结论只是假设，尚未被验证。');
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
    // 判成"自动修"但实际没改 —— 必须同时说出来
    const rejection = opts.rejectedPatches?.find((r) => r.fixId === recommended.id);
    const outcome = rejection ? ` **⚠ 实际未修改：${rejection.reason}**` : '';
    // 离线模式没有模型，方案来自通用模板 —— 写"LLM 原判"是撒谎
    const sourceLabel = opts.llmMode === 'offline' ? '方案模板' : 'LLM';
    const mismatch = decision?.llmTier !== undefined && decision.llmTier !== tier
      ? ` [${sourceLabel} 原判 Tier ${decision.llmTier}，硬规则已降级]`
      : '';
    lines.push(`**11. 是否可自动修**: Tier ${tier} — ${tierDesc}${reason}${mismatch}${outcome}`);
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

  // 同源合并与证据去重要给出**数字** —— "看起来简洁了"不是结论，"25 条 → 3 组"才是
  if (opts.dedupe && (opts.dedupe.mergedCount > 0 || opts.dedupe.evidence.afterCount < opts.dedupe.evidence.beforeCount)) {
    const d = opts.dedupe;
    lines.push(
      `**同源合并**: ${d.mergedCount} 条重复发现已合并（剩 ${d.clusterCount} 组）；` +
        `证据去重 ${d.evidence.beforeCount} 条 → ${d.evidence.afterCount} 条` +
        `（${d.evidence.beforeBytes} → ${d.evidence.afterBytes} 字节）`,
    );
  }

  // 分级只是"总览"，口径必须写清楚：非项目缺陷的条目不参与项目健康判断
  const nonDefects = bugs.filter((b) => classifyBug(b) !== 'project-defect');
  if (nonDefects.length > 0) {
    const toolCount = nonDefects.filter((b) => classifyBug(b) === 'tool-failure').length;
    const gapCount = nonDefects.length - toolCount;
    lines.push(
      `**口径**: 上面 ${bugs.length} 条里有 ${nonDefects.length} 条不是项目缺陷` +
      `（工具性失败 ${toolCount} 条 · Sentinel 自造地址造成的覆盖缺口 ${gapCount} 条）` +
      `—— 它们不计入「项目有 P0/P1」，也不触发失败退出码。`,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 覆盖范围区块必须排在 bug 列表**前面** ——
  // 用户先看到"没测到东西"，再看到 0 条 bug，顺序反了就会读成"项目没问题"。
  if (opts.coverage) {
    lines.push(...coverageSection(opts.coverage, bugs.length));
    lines.push('---');
    lines.push('');
  }

  if (bugs.length === 0) {
    const cov = opts.coverage;
    const warned = cov && coverageIsUninformative(cov);
    // 有流程失败 / 未跑 → 绝不能说"都通过了巡检"。
    // 以前只判 plannedFlows > 0 就写"全部通过"，
    // 于是表格里写着"1 失败 / 2 未跑"、正文却说"都通过了" —— 报告自己打自己。
    const incomplete = cov && (cov.failedFlows > 0 || cov.untestedFlows > 0);
    if (warned) {
      lines.push('**本次未产生任何诊断** —— 因为没有识别到可测目标（见上方覆盖范围），不是"项目没有问题"。');
    } else if (incomplete) {
      lines.push(
        `**本次未产生任何诊断** —— 但有 ${cov!.failedFlows} 条流程失败、${cov!.untestedFlows} 条流程未跑，**结果不完整**，不能当作"没有问题"。`,
      );
    } else {
      lines.push('**本次未产生任何诊断** —— 已识别的目标都通过了巡检。');
    }
    lines.push('');
  }

  for (const b of bugs) {
    lines.push(bugToMarkdown(b, opts));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 被 critic 拒绝的草稿 —— 剔除不等于藏起来
  if (opts.rejectedFindings && opts.rejectedFindings.length > 0) {
    lines.push('## 被 Critic 拒绝的假设');
    lines.push('');
    lines.push(
      `以下 ${opts.rejectedFindings.length} 条根因假设经过反向验证后被判定「证据不足」，` +
      '**不作为诊断计入上面的列表**。列出来是为了让你知道 Sentinel 查过但没查实 —— ' +
      '如果你认为其中某条是真问题，需要补证据（截图 / 复现步骤 / 源码位置）后重跑。',
    );
    lines.push('');
    for (const r of opts.rejectedFindings) {
      lines.push(`- \`${r.bugId}\` — ${r.reason}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 覆盖范围区块。
 *
 * 存在的理由：mapper 早就把"没识别到页面"这类缺口写成了 risk，
 * 但旧报告层不读它 —— 缺口只落在 run-status.json 里，用户看的报告里没有。
 * 结果就是"0 个 bug"被当成"项目健康"。
 */
function coverageSection(coverage: CoverageInfo, bugCount: number): string[] {
  const lines: string[] = [];
  lines.push('## 覆盖范围 / Coverage');
  lines.push('');

  if (coverageIsUninformative(coverage)) {
    // 文案不能硬写"0 个 bug" —— 本函数只在"一条流程都没跑"时才被调用，
    // 但万一有别的路径进来，写死了就会和上面的「Bug 总数」自相矛盾。
    lines.push('> ⚠ **本次未识别到可测目标 —— 本次结果没有任何信息量，不代表项目健康。**');
    lines.push('>');
    lines.push(
      `> 识别到的页面 ${coverage.pages} 个、接口 ${coverage.api} 个、可执行流程 ${coverage.plannedFlows} 条。`,
    );
    if (bugCount > 0) {
      lines.push('>');
      lines.push(`> 注意：本次仍产出了 ${bugCount} 条诊断，但它们来自有限的覆盖，结果不完整。`);
    }
    lines.push('>');
    lines.push(
      '> Next.js 项目开箱即用；其它框架（Vue / Svelte / React SPA / Express / Hono / Nest / tRPC）需要手写 `.sentinel/app.map.ts` 声明可测页面与流程。',
    );
    lines.push('');
  }

  lines.push('| 项目 / Item | 数量 / Count |');
  lines.push('|---|---|');
  lines.push(`| 识别到的页面 / Pages discovered | ${coverage.pages} |`);
  lines.push(`| 识别到的接口 / APIs discovered | ${coverage.api} |`);
  lines.push(`| 自动生成流程 / Auto-generated flows | ${coverage.flows} |`);
  lines.push(`| 规划执行流程 / Planned flows | ${coverage.plannedFlows} |`);
  lines.push(`| 通过 / 失败 / 未跑 / Passed / Failed / Not run | ${coverage.passedFlows} / ${coverage.failedFlows} / ${coverage.untestedFlows} |`);
  lines.push('');

  // 自己拼的地址打出来的失败必须单列 ——
  // 混在 failedFlows 里会被读成"项目坏了 N 处"，而那其实是 Sentinel 测错了地址。
  if (coverage.selfGeneratedFailures > 0) {
    lines.push(
      `> ⚠ **本次有 ${coverage.selfGeneratedFailures} 条失败来自 Sentinel 自己拼的地址**（路由占位符没被替换成真实值），` +
      '**不是被测项目的缺陷**，也不计入失败退出码。真实地址请写进 `.sentinel/app.map.ts`。',
    );
    lines.push('');
  }

  if (coverage.mapFailures.length > 0) {
    lines.push('**项目理解失败 / Project understanding failed**（下面的数字全部不可信）:');
    for (const f of coverage.mapFailures) {
      lines.push(`   - ${f}`);
    }
    lines.push('');
  }

  if (coverage.risks.length > 0) {
    lines.push(`**覆盖缺口 / Coverage gaps**（${coverage.risks.length} 项，本次没测到的地方）:`);
    for (const r of coverage.risks) {
      lines.push(`   - \`${r.id}\` (${r.severity}) ${r.description}`);
    }
    lines.push('');
  }

  return lines;
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

function describeEvidence(e: import('@sentinel/core').Evidence): string {  switch (e.kind) {    case 'console':
      return `${e.level}: ${e.message.slice(0, 120)}`;
    case 'network':
      return `${e.method} ${e.url} → ${e.status}${e.failed ? ' FAILED' : ''}`;
    case 'http':
      return `${e.method} ${e.url} → ${e.status}`;
    case 'screenshot':
      // 截图现在落盘成真实文件（reports/evidence/*.png），报告要给出能打开的路径；
      // 只有落盘失败时才退回内联 data URI。
      return e.path.startsWith('data:')
        ? `image (内联 ${e.path.slice(0, 40)}…)`
        : `截图文件 ${e.path}`;
    case 'a11y':
      // 以前只显示字面量 "accessibility tree" —— 用户看不到任何内容，
      // 也就无法人工复核、无法反驳 Agent。这里给一个能读的预览。
      return `accessibility tree（${a11yPreview(e.tree)}）`;
    case 'dom-snapshot':
      // 同理：以前只有 "DOM (N chars)"，看不出页面长什么样
      return `DOM（${e.html.length} 字符）${domPreview(e.html)}`;
    case 'log':
      return `[${e.level}] ${e.message.slice(0, 120)}`;
    case 'storage':
      // 以前落到 default 分支只显示 "storage" —— 采到的 key 名单看不见，
      // --detailed 唯一的产出在报告里等于不存在。
      return `${e.storage} (${e.keys.length} keys: ${e.keys.slice(0, 8).join(', ')}${e.keys.length > 8 ? ', …' : ''})`;
    case 'git':
      return `git ${e.subject} ${e.ref}`;
    case 'db':
      return `db ${e.query} (${e.rows} rows)`;
    case 'trace':
      return `trace ${e.service}/${e.traceId}`;
    default:
      return e.kind;
  }
}

/** a11y 树的可读预览（前几行）—— 完整内容在 JSON 报告里 */
function a11yPreview(tree: unknown): string {
  const text = typeof tree === 'string' ? tree : JSON.stringify(tree);
  if (!text) return '(空)';
  const first = text.split('\n').filter((l) => l.trim()).slice(0, 3).join(' / ');
  return first.length > 160 ? `${first.slice(0, 160)}…` : first;
}

/** DOM 的可读预览（标签骨架）—— 完整内容在 JSON 报告里 */
function domPreview(html: string): string {
  const skeleton = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!skeleton) return '（空标签）';
  return skeleton.length > 120 ? `「${skeleton.slice(0, 120)}…」` : `「${skeleton}」`;
}
