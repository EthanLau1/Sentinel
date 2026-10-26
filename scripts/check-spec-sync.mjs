#!/usr/bin/env node
/**
 * check-spec-sync — 规范 ↔ 实现 的一致性守卫。
 *
 * 方法：把"可核对的断言"变成有限可枚举集合，逐组求差集；差集即缺陷。
 * 本脚本只是这个方法的一次性执行器（方法本身见全局工作流「审计与验收」）。
 *
 * 设计要点：
 *   - 只读文件，不 import packages/core（宪法红线 1/3）
 *   - 已知未修项记在 scripts/spec-sync-baseline.json；
 *     只对"基线之外的新偏差"失败（新增偏差 = 回归）
 *   - baseline 只能由本脚本 --update-baseline 生成，手改会被 sha256 指纹检测出来
 *   - "blocked"（如 HTML reporter 尚未实现）单独列出，不算失败
 *
 * 三条防降标准锁（对应方案 §3.2）：
 *   锁1 手改 baseline  → sha256 指纹不匹配 → exit 2
 *   锁2 超期未清理    → 距 since ≥2 个 minor → exit 1（阻断，不只是警告）
 *   锁3 期望状态错    → 基线记录与实际检出不一致 → exit 2
 *
 * 用法：
 *   node scripts/check-spec-sync.mjs                  # 检查（CI 用）
 *   node scripts/check-spec-sync.mjs --update-baseline # 重新生成 baseline（仅修复后）
 * 退出码：0 一致 / 1 出现新偏差或基线待清理 / 2 baseline 文件本身有问题
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(repo, 'scripts', 'spec-sync-baseline.json');
const SHA_PATH = join(repo, 'scripts', 'spec-sync-baseline.sha256');

const read = (rel) => {
  try {
    return readFileSync(join(repo, rel), 'utf8');
  } catch {
    return '';
  }
};
const exists = (rel) => existsSync(join(repo, rel));
const list = (rel) => {
  try {
    return readdirSync(join(repo, rel));
  } catch {
    return [];
  }
};
const pkgOf = (file) => {
  for (const pkg of list('packages')) {
    if (list(join('packages', pkg, 'src')).includes(file)) return pkg;
  }
  return '';
};
/** 所有包的 src 文本拼在一起（不含 core/src/types.ts —— 那里只有类型声明） */
const allSrc = () =>
  list('packages')
    .flatMap((pkg) => list(join('packages', pkg, 'src')).filter((f) => f.endsWith('.ts')))
    .filter((f) => !(pkgOf(f) === 'core' && f === 'types.ts'))
    .map((f) => read(join('packages', pkgOf(f), 'src', f)))
    .join('\n');

/** @type {{dimension: string, id: string, detail: string}[]} */
const findings = [];
/** @type {{dimension: string, id: string, detail: string}[]} */
const blocked = [];
const add = (dimension, id, detail) => findings.push({ dimension, id, detail });
const addBlocked = (dimension, id, detail) => blocked.push({ dimension, id, detail });

// ── 1. 事件目录 × 代码发出点 ────────────────────────────────────────────────
{
  const catalog = read('docs/EVENT-CATALOG.md');
  const declared = new Set(
    [...catalog.matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((m) => m[1]),
  );
  const code = allSrc();
  const used = new Set([...code.matchAll(/['"]([a-z]+\.[a-z_]+)['"]/g)].map((m) => m[1]));
  for (const ev of declared) {
    if (!used.has(ev)) add('events', ev, `事件 ${ev} 只在类型定义里出现，运行时不产生`);
  }
}

// ── 2. CLI 命令表 × 实际实现 ───────────────────────────────────────────────
{
  const readme = read('README.md');
  const documented = new Set([...readme.matchAll(/sentinel ([a-z]+)/g)].map((m) => m[1]));
  const cli = read('packages/cli/src/index.ts');
  const implemented = new Set([...cli.matchAll(/case '([a-z]+)'/g)].map((m) => m[1]));
  for (const cmd of documented) {
    if (!implemented.has(cmd)) add('cli', `command:${cmd}`, `README 里的 sentinel ${cmd} 没有实现`);
  }
  for (const cmd of implemented) {
    if (!documented.has(cmd)) add('cli', `command:${cmd}`, `sentinel ${cmd} 已实现但 README 没写`);
  }
}

// ── 3. 宪法入口清单 × CLI 实际命令 ───────────────────────────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  const cli = read('packages/cli/src/index.ts');
  const implemented = new Set([...cli.matchAll(/case '([a-z]+)'/g)].map((m) => m[1]));

  // 宪法里"工具入口"代码块中列出的命令
  const entryBlock = /\*\*工具入口[^`]*```\n([\s\S]*?)```/.exec(constitution);
  const declared = new Set(
    entryBlock
      ? [...entryBlock[1].matchAll(/sentinel ([a-z]+)/g)].map((m) => m[1])
      : [],
  );
  for (const cmd of declared) {
    if (!implemented.has(cmd)) {
      add('constitution', `entry:${cmd}`, `宪法列出 sentinel ${cmd}，但 CLI 没实现`);
    }
  }
  // run 是产品入口（单独一节），不要求出现在工具入口块里
  for (const cmd of implemented) {
    if (cmd === 'run') continue;
    if (declared.size > 0 && !declared.has(cmd)) {
      add('constitution', `entry:${cmd}`, `CLI 实现了 sentinel ${cmd}，宪法入口清单里没有`);
    }
  }
}

// ── 4. 报告 11 字段（可能被条件跳过） ───────────────────────────────────────
{
  const md = read('packages/reporters/src/markdown.ts');
  const lines = md.split('\n');
  // 同一字段在 if / else 两个分支都出现 → 无论有没有方案都会输出 → 安全
  const occurrences = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /\*\*(\d+)\. ([^*]+)\*\*/.exec(lines[i]);
    if (!m) continue;
    const no = Number(m[1]);
    if (no < 1 || no > 11) continue;
    let guarded = false;
    for (let j = i - 1; j >= 0 && j > i - 4; j--) {
      if (/^\s*(if|} else if)\b/.test(lines[j])) {
        guarded = true;
        break;
      }
    }
    const cur = occurrences.get(no) ?? { count: 0, guarded: false, title: m[2] };
    cur.count += 1;
    cur.guarded = cur.guarded || guarded;
    occurrences.set(no, cur);
  }
  for (const [no, info] of occurrences) {
    if (info.guarded && info.count < 2) {
      add('report', `field:${no}`, `报告第 ${no} 字段（${info.title}）只在条件分支里出现，无方案时会整段消失`);
    }
  }
}

// ── 4. CONFIG-SPEC 字段 × 实际解析 ────────────────────────────────────────
{
  const spec = read('docs/CONFIG-SPEC.md');
  const configSrc = read('packages/cli/src/config.ts');
  const specTypes = new Set(
    [...spec.matchAll(/type:\s*(ollama-native|openai-compatible|ollama)\b/g)].map((m) => m[1]),
  );
  const codeTypes = new Set(
    [...configSrc.matchAll(/'(openai-compatible|ollama-native)'/g)].map((m) => m[1]),
  );
  for (const t of specTypes) {
    if (!codeTypes.has(t)) {
      add('config', `llm-type:${t}`, `CONFIG-SPEC 写了 type: ${t}，代码只支持 ${[...codeTypes].join(' / ')}`);
    }
  }
  const known = new Set(
    [...configSrc.matchAll(/KNOWN_BUDGET_KEYS = new Set\(\[([^\]]+)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])),
  );
  for (const key of known) {
    if (!new RegExp(`^\\s*${key}:`, 'm').test(spec)) {
      add('config', `budget-key:${key}`, `代码读取 budget.yml 的 ${key}，CONFIG-SPEC 没写`);
    }
  }
}

// ── 5. 成本模型维度 × 可配置维度 ───────────────────────────────────────────
{
  const costSrc = read('packages/subagents/src/cost-model.ts');
  const configSrc = read('packages/cli/src/config.ts');
  const iface = /export interface CostWeights \{([\s\S]*?)\n\}/.exec(costSrc);
  const dims = iface
    ? [...iface[1].matchAll(/^\s*([a-zA-Z]+)\??:\s*number/gm)].map((m) => m[1])
    : [];
  const weightsBlock = /weights\?:\s*\{([\s\S]*?)\n\s{2}\}/.exec(configSrc);
  const configurable = new Set(
    weightsBlock ? [...weightsBlock[1].matchAll(/([a-zA-Z]+):\s*number/g)].map((m) => m[1]) : [],
  );
  for (const d of dims) {
    if (!configurable.has(d)) {
      add('cost', `dim:${d}`, `成本模型有 ${d} 维度，但 budget.yml 的 weights 无法配置它`);
    }
  }
}

// ── 6. adapter 数量 × 各自分支测试 ──────────────────────────────────────────
{
  const adapterFiles = list('packages/adapters/src').flatMap((dir) =>
    list(join('packages/adapters/src', dir)).filter(
      (f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'scan.ts' && f !== 'index.ts',
    ),
  );
  const testSources = list('packages/adapters/test')
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => read(join('packages/adapters/test', f)))
    .join('\n');
  for (const a of adapterFiles) {
    const name = a.replace(/\.ts$/, '');
    // 测试里以 ../src/<dir>/<name>.js 的形式 import
    if (!new RegExp(`src/[a-z-]+/${name}\\.js`).test(testSources)) {
      add('adapters', `untested:${name}`, `adapter ${name} 没有分支测试`);
    }
  }
}

// ── 7. coverage 阈值作用域 × 实际包数 ─────────────────────────────────────
{
  const vitest = read('vitest.config.ts');
  const thresholds = /thresholds:\s*\{([\s\S]*?)\n\s{4}\}/.exec(vitest);
  const guarded = thresholds
    ? [...thresholds[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];
  const pkgs = list('packages').filter((p) => list(join('packages', p, 'src')).length > 0);
  // 只有"整包"级别的阈值才算该包被守住；
  // 子目录阈值（如 knowledge）不能冒充整个 providers 都被守住。
  const guardedPkgs = pkgs.filter((p) =>
    guarded.some((g) => g === `packages/${p}/src/**/*.ts`),
  );
  for (const p of pkgs) {
    if (!guardedPkgs.includes(p)) {
      // 描述里带全仓库计数：包数量变化会让所有同类基线条目过期 → 强制刷新
      add(
        'coverage',
        `unguarded:${p}`,
        `packages/${p} 没有整包覆盖率门槛（全仓库 ${pkgs.length} 个包，${guardedPkgs.length} 个设门槛，${pkgs.length - guardedPkgs.length} 个没有）`,
      );
    }
  }
}

// ── 8. 宪法红线 × 机器守卫 ─────────────────────────────────────────────────
{
  const guarded = [
    ['core-purity', 'scripts/check-core-purity.mjs'],
    ['core-lines', 'scripts/check-core-lines.mjs'],
  ];
  for (const [id, script] of guarded) {
    if (!exists(script)) {
      add('redline', `unguarded:${id}`, `宪法红线 ${id} 没有机器守卫（${script} 不存在）`);
    }
  }
}

// ── 9. benchmark 案例 × schema 必填字段 ────────────────────────────────────
{
  const required = [
    'id', 'project', 'feature', 'stage', 'symptom', 'realRootCause',
    'sentinelJudgment', 'hit', 'recommendedFix', 'fixAdopted',
    'fixPassedVerification', 'createdAt', 'sentinelVersion',
  ];
  for (const f of list('benchmarks/cases').filter((x) => x.endsWith('.json'))) {
    let obj = {};
    try {
      obj = JSON.parse(read(join('benchmarks/cases', f)));
    } catch {
      add('benchmark', `invalid:${f}`, '案例不是合法 JSON');
      continue;
    }
    const missing = required.filter((k) => obj[k] === undefined);
    if (missing.length > 0) {
      add('benchmark', `schema:${f}`, `案例缺字段：${missing.join(', ')}`);
    }
  }
  // 调用点要连**测试**一起找：validateCase 的作用是校验案例文件格式，
  // 真正调用它的就是测试（packages/cli/test/benchmarks.test.ts）——
  // 只搜 src 会把它误报成"没人用"。
  const callers = list('packages').flatMap((pkg) =>
    list(join('packages', pkg, 'src')).filter((f) => f.endsWith('.ts')),
  );
  const testCallers = list('packages').flatMap((pkg) =>
    list(join('packages', pkg, 'test')).filter((f) => f.endsWith('.ts')),
  );
  const used =
    callers.some((f) => read(join('packages', pkgOf(f), 'src', f)).includes('validateCase')) ||
    testCallers.some((f) => {
      const pkg = list('packages').find((p) => list(join('packages', p, 'test')).includes(f));
      return pkg ? read(join('packages', pkg, 'test', f)).includes('validateCase') : false;
    });
  if (!used) add('benchmark', 'validateCase-unused', 'validateCase 没有任何调用点 —— 案例格式不会被校验');
}

// ── 10. 启动脚本条件 ───────────────────────────────────────────────────────
{
  const start = read('start.command');
  if (/\[ -f "sentinel-ui\/dist\/index\.html" \] \|\|/.test(start)) {
    add('startup', 'stale-dist', 'start.command 只在 dist 缺失时构建 —— 改过源码后启动仍是旧前端');
  }
}

// ── 11. 知识检索触发率上限 ─────────────────────────────────────────────────
{
  const enhancer = read('packages/subagents/src/enhancer.ts');
  if (!/maxSearchRate|triggerRate|RATE_LIMIT|maxSearches|searchBudget/i.test(enhancer)) {
    add('enhancer', 'no-rate-limit', '宪法要求触发率 ≤30%，enhancer 没有每次 run 的触发比例上限');
  }
}

// ── 12. HTML reporter（未实现 → blocked，不计入失败） ─────────────────────
if (!exists('packages/reporters/src/html.ts')) {
  addBlocked('report', 'html-reporter', 'HTML reporter 未实现 —— 宪法要求三格式，当前只有 md/json');
}

// ── 13. Tier 硬规则分级（不靠 LLM 给 tier） ───────────────────────────────
{
  const executor = read('packages/subagents/src/executor.ts');
  if (!/classifyTier|deriveTier|hardRule|TIER_RULES|decideTier/.test(executor)) {
    add('executor', 'tier-not-hardcoded', '宪法要求 Tier 由 executor 硬规则判断，当前直接采用 planner/LLM 产出的 tier');
  }
}

// ── 14. 宪法「护栏口径可核对」条款 × run-status 实际字段 ───────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  const runSrc = read('packages/cli/src/run.ts');
  // 只截「run-status.json 必须能核对护栏口径」这一条
  const clause = /必须能核对护栏口径([\s\S]*?)(?=\n\s*\d+\.|\n---)/.exec(constitution);
  const fields = clause
    ? [...new Set([...clause[1].matchAll(/`([a-zA-Z][a-zA-Z0-9]*)`/g)].map((m) => m[1]))]
    : [];
  for (const f of fields) {
    if (!new RegExp(`\\b${f}\\b`).test(runSrc)) {
      add('budget-report', `field:${f}`, `宪法要求 run-status.json 写出 ${f}，run.ts 里没有这个字段`);
    }
  }
}

// ── 15. 报告的 Tier 必须来自 executor 硬规则 ─────────────────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  const runSrc = read('packages/cli/src/run.ts');
  // 宪法原文：「Tier 由 `executor/` 硬规则判断，**不**靠 LLM prompt 决定」
  if (/Tier 由 `executor\/` 硬规则判断/.test(constitution)) {
    if (!/executor\.tier_decided/.test(runSrc)) {
      add(
        'tier',
        'report-tier-not-hardcoded',
        '宪法要求 Tier 由 executor 硬规则判断，但 run.ts 没订阅 executor.tier_decided —— 报告第 11 字段会显示 LLM 自报的 tier，与"实际改不改代码"不一致',
      );
    }
  }
}

// ── 16. 死事件：目录声明了订阅者，代码里却没人消费 ───────────────────────
{
  const catalog = read('docs/EVENT-CATALOG.md');
  // 只管目录里明确写了订阅者的事件；标了「(内部)」的是过程事件，不要求外部消费者
  const withSubscribers = new Map(
    [...catalog.matchAll(/\|\s*`([a-z]+\.[a-z_]+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|/g)]
      .map((m) => [m[1], m[2]])
      .filter(([, subs]) => subs && subs !== '(内部)'),
  );
  const code = allSrc();
  const published = new Set([...code.matchAll(/type:\s*'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]));
  const subscribed = new Set(
    [...code.matchAll(/subscribe(?:<[^>]*>)?\(\s*'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]),
  );
  for (const [ev, subs] of withSubscribers) {
    if (!published.has(ev)) continue; // 没发出就不用管（由第 1 组负责）
    if (!subscribed.has(ev)) {
      add('dead-event', ev, `事件 ${ev} 在目录里声明订阅者是「${subs}」，但代码里没有任何订阅者 —— 它的载荷会被静默丢弃`);
    }
  }
  // 代码里发布了但目录里没登记的事件 → 目录缺行（规范↔实现分叉）
  const declared = new Set([...catalog.matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((m) => m[1]));
  for (const ev of published) {
    if (!declared.has(ev)) {
      add('event-catalog', ev, `代码里发布了事件 ${ev}，但 docs/EVENT-CATALOG.md 里没有登记`);
    }
  }
}

// ── 17. 宪法 Tier 定义 × executor 的 tier 闸门与判定 ─────────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  const executor = read('packages/subagents/src/executor.ts');
  const runSrc = read('packages/cli/src/run.ts');

  // 宪法第 130 行：「Tier 2 自动写 patch，但需要人确认（生成 PR 等审查）」
  // → maxTier 默认值不能低于 2，否则 Tier 2 分支整个被跳过：
  //    报告写着"Tier 2 — 写 patch 待审核"，磁盘上什么都没有。
  if (/Tier 2\s*自动写 patch/.test(constitution)) {
    const execDefault = /maxTier\s*=\s*config\.maxTier\s*\?\?\s*(\d)/.exec(executor);
    const cliDefault = /maxTier:\s*opts\.maxTier\s*\?\?\s*(\d)/.exec(runSrc);
    for (const [where, m] of [['executor.ts', execDefault], ['run.ts', cliDefault]]) {
      if (m && Number(m[1]) < 2) {
        add(
          'tier',
          `max-tier-default-${where}`,
          `宪法要求 Tier 2 自动写 patch，但 ${where} 的 maxTier 默认值是 ${m[1]} —— Tier 2 分支会被整个跳过，报告说"写 patch"实际不落盘`,
        );
      }
    }
  }

  // 宪法第 58 行「高风险只能建议」：硬规则只能收紧，不能把 LLM 判的 Tier 3 放宽成 Tier 2
  if (/高风险只能建议/.test(constitution)) {
    if (!/llmTier\s*===\s*3/.test(executor)) {
      add(
        'tier',
        'tier-not-relaxed-by-llm',
        '宪法要求高风险只能建议（Tier 3），但 executor 没有「LLM 判 Tier 3 时硬规则不放宽」的守卫 —— 硬规则可能把 Tier 3 放宽成 Tier 2（写 patch/建 PR）',
      );
    }
  }
}

// ── 18. 离线链路：开关 × 守卫脚本 × 夹具 × 结论口径 ────────────────────
//
// 为什么要有这一组：重守卫（bun run guard:offline）要跑真实浏览器，1-2 分钟，
// 不能塞进 lint:spec。但"离线的开关还在不在""守卫脚本有没有被删"可以静态查。
// 这一组就是那部分 —— 它保证重守卫不会在某次重构后被静默废掉。
{
  const constitution = read('docs/CONSTITUTION.md');
  const runSrc = read('packages/cli/src/run.ts');
  const doctorSrc = read('packages/cli/src/doctor.ts');
  const offlineStub = read('packages/providers/src/llm/offline.ts');
  const typesSrc = read('packages/core/src/types.ts');
  const analystSrc = read('packages/subagents/src/analyst.ts');
  const jsonReporter = read('packages/reporters/src/json.ts');
  const mdReporter = read('packages/reporters/src/markdown.ts');

  // 18.1 宪法声明了红线 8（离线不发外网请求）→ 必须有守卫脚本
  if (/离线模式一次外网请求都不许发/.test(constitution)) {
    for (const [id, script] of [
      ['offline-guard', 'scripts/check-offline-guard.mjs'],
      ['offline-guard-preload', 'scripts/offline-guard-preload.mjs'],
    ]) {
      if (!exists(script)) {
        add('offline', `unguarded:${id}`, `宪法红线 8 要求离线模式不外网，但守卫脚本 ${script} 不存在`);
      }
    }
  }

  // 18.2 离线路径的三个开关还在不在
  //     skipLlmProbe：doctor 的 LLM 探测本身就是外网请求
  if (!/skipLlmProbe:\s*offline/.test(runSrc)) {
    add('offline', 'probe-not-skipped', '离线模式必须跳过 doctor 的 LLM 探测（探测本身就是外网请求）');
  }
  if (!/skipSearch:[^}]*\|\|\s*offline/.test(runSrc)) {
    add('offline', 'search-not-skipped', '离线模式必须关闭外部知识检索');
  }
  //     critic 是 LLM 反向验证，没有模型时只会把每条发现都拒掉 → 离线不注册它
  if (!/if\s*\(!offline\)\s*\{[^}]*createCritic/.test(runSrc)) {
    add('offline', 'critic-registered-offline', '离线模式不应注册 critic（没有模型时它只会把每条发现都拒掉）');
  }

  // 18.3 离线 LLM 桩必须调用即抛错（不能静默返回假结果）
  if (offlineStub && !/throw new OfflineLLMError/.test(offlineStub)) {
    add('offline', 'stub-not-throwing', '离线 LLM 桩必须调用即抛错 —— 静默返回等于"假装成功"');
  }
  if (doctorSrc && !/skipLlmProbe/.test(doctorSrc)) {
    add('offline', 'doctor-no-skip', 'doctor 必须支持跳过 LLM 探测（离线模式下探测本身就是外网请求）');
  }

  // 18.4 夹具必须在 —— 守卫没有夹具就无从判定"该测出的有没有测出"
  for (const f of [
    'benchmarks/fixtures/offline-web-app/server.js',
    'benchmarks/fixtures/offline-web-app/.sentinel/app.map.js',
    'benchmarks/fixtures/offline-web-app/package.json',
  ]) {
    if (!exists(f)) {
      add('offline', `missing-fixture:${f}`, `离线守卫的夹具缺文件 ${f}`);
    }
  }

  // 18.5 结论口径三档：rule / llm / heuristic
  //     heuristic = 模型未参与（LLM 调用失败后降级）—— 少一档就会把启发式冒充成模型推断
  if (!/origin\?:\s*'rule'\s*\|\s*'llm'\s*\|\s*'heuristic'/.test(typesSrc)) {
    add('offline', 'origin-missing-heuristic', "BugFinding.origin 必须有三档：'rule' | 'llm' | 'heuristic'（heuristic = 模型未参与）");
  }
  if (!/llmHypothesis\s*\?\s*'llm'\s*:\s*'heuristic'/.test(analystSrc)) {
    add('offline', 'analyst-origin-not-distinguished', "analyst 必须按模型是否真的参与来标 origin（参与 → 'llm'，没参与 → 'heuristic'）");
  }
  if (!/heuristic/.test(jsonReporter)) {
    add('offline', 'json-by_origin-no-heuristic', 'JSON 报告的 by_origin 必须能区分 heuristic（未标 origin 的旧数据才按 llm 处理）');
  }
  if (!/case 'heuristic'/.test(mdReporter)) {
    add('offline', 'md-origin-no-heuristic', "Markdown 报告必须有 heuristic 的独立标签 —— 否则启发式结论会被读成模型推断");
  }

  // 18.6 离线案例必须可回放 —— 巡检规则改坏了要有回归保护
  //     回放器不支持巡检通道 → 离线案例无法进回测 → 规则退化无人发现。
  const replaySrc = read('packages/cli/src/replay.ts');
  if (!/channel\?:\s*'flow\.failed'\s*\|\s*'page\.visited'/.test(replaySrc)) {
    add('offline', 'replay-no-inspection-channel', '回放器必须支持巡检通道（page.visited）—— 否则离线案例进不了回测，巡检规则改坏了没有回归保护');
  }
  if (!/createInspector/.test(replaySrc)) {
    add('offline', 'replay-no-inspector', '回放器必须装配 inspector（巡检通道靠它判定）');
  }
  // 巡检通道的夹具必须点名规则与严重级别，否则"观察项冒充已确认缺陷"抓不住
  const replayCases = list('benchmarks/replay/contract').filter((f) => f.endsWith('.json'));
  let inspectionCases = 0;
  for (const f of replayCases) {
    let obj = {};
    try {
      obj = JSON.parse(read(join('benchmarks/replay/contract', f)));
    } catch {
      add('offline', `replay-invalid:${f}`, '巡检夹具不是合法 JSON');
      continue;
    }
    if (obj.channel !== 'page.visited') continue;
    inspectionCases += 1;
    if (!obj.selectRule) {
      add('offline', `replay-no-rule:${f}`, '巡检通道夹具必须用 selectRule 指定关心的规则');
    }
    if (!obj.expected?.severity) {
      add('offline', `replay-no-severity:${f}`, '巡检通道夹具必须写明期望的严重级别 —— 否则"质量观察项被冒充成已确认缺陷"抓不住');
    }
    if (!obj.expected?.rule) {
      add('offline', `replay-no-expected-rule:${f}`, '巡检通道夹具必须写明期望命中的规则');
    }
  }
  if (inspectionCases === 0) {
    add('offline', 'replay-no-inspection-cases', '没有任何巡检通道回放夹具 —— 巡检规则改坏了没有回归保护');
  }
}

// ── 19. 宪法红线计数 × 实际条数 ─────────────────────────────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  // 标题写"6 条红线"、正文列 7 条 —— 曾经发生过（v1.4 加红线时漏改标题）。
  // 数字对不上时，读者会按标题以为只有 6 条，漏看真正生效的条款。
  const m = /## (\d+) 条红线/.exec(constitution);
  if (m) {
    const block = /## \d+ 条红线[\s\S]*?```\n([\s\S]*?)```/.exec(constitution);
    const actual = block
      ? block[1].split('\n').filter((l) => /^\d+\.\s/.test(l.trim())).length
      : 0;
    if (actual > 0 && Number(m[1]) !== actual) {
      add(
        'constitution',
        'redline-count-mismatch',
        `宪法标题写"${m[1]} 条红线"，实际列了 ${actual} 条 —— 读者会按标题漏看条款`,
      );
    }
  }
}

// ── 20. 宪法 core 行数口径 × 实际值 ─────────────────────────────────────
{
  const constitution = read('docs/CONSTITUTION.md');
  // 宪法里写死了两个口径（wc -l 与守卫口径）。改了 core 又不更新宪法，
  // 文档口径就与实际脱节 —— 而"数字必标口径"正是本项目的硬要求。
  const block = /`wc -l` 口径\s*=\s*(\d+) 行（[^）]*?(\d+) 个文件）\s*\n守卫口径（不含空行注释）\s*=\s*(\d+) 行/.exec(
    constitution,
  );
  if (block) {
    const coreFiles = list('packages/core/src').filter((f) => f.endsWith('.ts'));
    const wcTotal = coreFiles.reduce((n, f) => {
      const raw = read(join('packages/core/src', f));
      return n + raw.split('\n').length - (raw.endsWith('\n') ? 1 : 0);
    }, 0);
    if (Number(block[1]) !== wcTotal) {
      add(
        'constitution',
        'core-lines-wc-mismatch',
        `宪法写 wc -l 口径 ${block[1]} 行，实际 ${wcTotal} 行（${coreFiles.length} 个文件）—— 文档口径与实际脱节`,
      );
    }
    if (Number(block[2]) !== coreFiles.length) {
      add(
        'constitution',
        'core-files-mismatch',
        `宪法写 core 有 ${block[2]} 个文件，实际 ${coreFiles.length} 个`,
      );
    }
    // 守卫口径：直接问守卫脚本自己
    const guardTotal = (() => {
      let total = 0;
      for (const f of coreFiles) {
        const raw = read(join('packages/core/src', f));
        let inBlock = false;
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          if (inBlock) {
            if (t.includes('*/')) inBlock = false;
            continue;
          }
          if (t.startsWith('/*')) {
            if (!t.includes('*/')) inBlock = true;
            continue;
          }
          if (t.startsWith('//')) continue;
          total++;
        }
      }
      return total;
    })();
    if (Number(block[3]) !== guardTotal) {
      add(
        'constitution',
        'core-lines-guard-mismatch',
        `宪法写守卫口径 ${block[3]} 行，实际 ${guardTotal} 行（不含空行注释）—— 文档口径与实际脱节`,
      );
    }
  }
}

// ── 21. README 声称的数字 × 代码实际值 ────────────────────────────────
//
// 为什么要有这一组：README 里"巡检规则（10 条）"曾与代码的 11 条不符
// （表格里 11 行都对，只有标题数字数错了）——
// 数字错了读者就会以为少了一类检测能力，或以为表格多了一行。
// 凡是 README 里出现的"可数的东西"，数字都必须由代码核对。
{
  const readme = read('README.md');
  const inspectorSrc = read('packages/subagents/src/inspector.ts');

  // 21.1 巡检规则条数
  const ruleNames = new Set(
    [...inspectorSrc.matchAll(/rule:\s*'([a-z-]+)'/g)].map((m) => m[1]),
  );
  const ruleCount = ruleNames.size;
  const claimed = /巡检规则（(\d+) 条）/.exec(readme);
  if (claimed && Number(claimed[1]) !== ruleCount) {
    add(
      'readme',
      'inspection-rule-count',
      `README 说"巡检规则（${claimed[1]} 条）"，代码里实际 ${ruleCount} 条 —— 数字与实现不符`,
    );
  }
  const claimedEn = /The (ten|eleven|twelve|nine|eight) inspection rules/.exec(readme);
  if (claimedEn) {
    const enNum = { eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }[claimedEn[1]] ?? 0;
    if (enNum !== ruleCount) {
      add(
        'readme',
        'inspection-rule-count-en',
        `README 英文说"${claimedEn[1]} inspection rules"，代码里实际 ${ruleCount} 条`,
      );
    }
  }
  // 表格里必须真的列全了所有规则（不只是数字对）
  // 只查规则表那一段 —— 全文包含会漏判：
  // 规则名在别处（正文、宪法引用）出现过，就算表格里删了一行也查不出来。
  // 中文表和英文表是两张独立的表，两张都要查。
  const ruleTables = [];
  const cnStart = readme.indexOf('**巡检规则（');
  if (cnStart !== -1) {
    const cnEnd = readme.indexOf('**The ', cnStart);
    ruleTables.push(readme.slice(cnStart, cnEnd === -1 ? undefined : cnEnd));
  }
  const enStart = readme.indexOf('**The eleven inspection rules**');
  if (enStart !== -1) {
    const enEnd = readme.indexOf('**怎么确认这次跑的是离线', enStart);
    ruleTables.push(readme.slice(enStart, enEnd === -1 ? undefined : enEnd));
  }
  if (ruleTables.length === 0) {
    add('readme', 'rule-table-not-found', 'README 里找不到巡检规则表 —— 无法核对规则是否列全');
  }
  for (const rule of ruleNames) {
    for (const [i, table] of ruleTables.entries()) {
      if (!table.includes(`\`${rule}\``)) {
        add(
          'readme',
          `rule-not-documented:${rule}:table${i}`,
          `巡检规则 ${rule} 在代码里有，但 README 的规则表（第 ${i + 1} 张：${i === 0 ? '中文' : '英文'}）里没有`,
        );
      }
    }
  }

  // 21.2 报告字段数（README 说 11 个）
  const md = read('packages/reporters/src/markdown.ts');
  const fieldNos = new Set(
    [...md.matchAll(/\*\*(\d+)\.\s/g)].map((m) => Number(m[1])),
  );
  const maxField = Math.max(...fieldNos);
  const fieldClaim = /报告的 (\d+) 个字段/.exec(readme);
  if (fieldClaim && Number(fieldClaim[1]) !== maxField) {
    add(
      'readme',
      'report-field-count',
      `README 说"报告的 ${fieldClaim[1]} 个字段"，markdown reporter 实际输出到第 ${maxField} 个字段`,
    );
  }

  // 21.3 Tier 档数（README 说 4 档）
  const tierClaim = /分 (\d+) 档/.exec(readme);
  if (tierClaim && Number(tierClaim[1]) !== 4) {
    add('readme', 'tier-count', `README 说"分 ${tierClaim[1]} 档"，宪法定义的 Tier 是 4 档（0/1/2/3）`);
  }

  // 21.4 工作流步骤数：README 的流程图必须列全代码里装配的角色
  //     漏一个角色 = 读者按图理解会缺一块（比如少了 Inspector，
  //     就会以为"访问成功 = 页面没毛病"）。
  const runSrc = read('packages/cli/src/run.ts');
  // Sensor 不单独成步 —— 它就是流程图里的 "Runner + Browser/HTTP"：
  // Runner 访问页面时发 evidence.requested，Sensor 收集证据。
  const pipelineRoles = [
    'Mapper', 'Runner', 'Inspector', 'Analyst',
    'Critic', 'Verifier', 'Planner', 'Enhancer', 'Executor',
  ];
  const stepsClaim = /这 (\d+) 步（每一步只干一件事）/.exec(readme);
  const expectedSteps = pipelineRoles.length;
  if (stepsClaim && Number(stepsClaim[1]) !== expectedSteps) {
    add(
      'readme',
      'workflow-step-count',
      `README 说"这 ${stepsClaim[1]} 步"，代码里装配的流水线角色是 ${expectedSteps} 个 —— 数字与实现不符`,
    );
  }
  // 每个角色都要在 README 的步骤表里出现
  // 按行取表格范围 —— 用 indexOf('---') 会被表头分隔行 |---| 截断
  const readmeLines = readme.split('\n');
  const stepStartLine = readmeLines.findIndex((l) => l.includes('对着人话看这'));
  const stepTable =
    stepStartLine === -1
      ? ''
      : readmeLines.slice(stepStartLine, stepStartLine + 20).join('\n');
  for (const role of pipelineRoles) {
    if (!stepTable.includes(`| ${role} |`)) {
      add('readme', `workflow-role-missing:${role}`, `流水线角色 ${role} 在代码里装配了，但 README 的步骤表里没有`);
    }
  }

  // 21.5 "已经能用"里不许出现 baseline 里记着的"能力未实现"项
  //     这条防的是本项目最严重的缺陷类型："报告说能做、实际没做"。
  //     README 的"已经能用"小节是读者判断"这工具现在能干嘛"的唯一依据，
  //     把未实现的能力写进去 = 骗读者。
  //
  //     为什么用显式映射而不是关键词猜测：
  //     baseline 里大部分条目是"覆盖率门槛 / 死事件"这类工程债，
  //     不是 README 会声称的用户能力；用关键词猜会既漏又误报。
  //     这里只列**用户能感知的能力**，每个都对应 baseline 里的一条。
  const unimplementedCapabilities = [
    {
      baselineId: 'enhancer::no-rate-limit',
      // README 里出现这些短语 = 声称该能力已具备
      claimedPhrases: ['最多触发 30%', 'at most 30% of flows', '30% 的流程'],
      detail: '宪法要求知识增强每次 run 的触发流程占比 ≤30%，代码里没有这个限流（只看平均置信度 <0.7）',
    },
  ];
  const workingStart = readme.indexOf('**已经能用');
  const workingEnd = readme.indexOf('**还没有', workingStart);
  const workingSection =
    workingStart === -1 ? '' : readme.slice(workingStart, workingEnd === -1 ? undefined : workingEnd);
  if (workingSection) {
    for (const cap of unimplementedCapabilities) {
      for (const phrase of cap.claimedPhrases) {
        if (workingSection.includes(phrase)) {
          add(
            'readme',
            `unimplemented-in-working-section:${cap.baselineId}`,
            `README 的"已经能用"里出现「${phrase}」—— 声称该能力已具备，` +
              `但代码里没有（${cap.detail}）`,
          );
        }
      }
    }
  }
}

// ── 输出与基线比对 ─────────────────────────────────────────────────────────
const key = (f) => `${f.dimension}::${f.id}`;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

let pkgVersion = '0.0.0';
try {
  pkgVersion = JSON.parse(read('package.json')).version || '0.0.0';
} catch {
  /* package.json 读不到时按 0.0.0 处理 */
}

const UPDATE = process.argv.includes('--update-baseline');

// ── 写入模式：重新生成 baseline（唯一合法的写入路径） ─────────────────────
if (UPDATE) {
  const items = findings.map((f) => ({
    dimension: f.dimension,
    id: f.id,
    since: pkgVersion,
    expect: f.detail,
  }));
  const json = JSON.stringify({ version: pkgVersion, items }, null, 2) + '\n';
  writeFileSync(BASELINE_PATH, json);
  writeFileSync(SHA_PATH, sha256(json) + '  spec-sync-baseline.json\n');
  console.log(`✓ baseline 已重写：${items.length} 项已知未修（version ${pkgVersion}）`);
  if (blocked.length > 0) {
    console.log(`  ⏸ blocked（未实现，不计入失败）: ${blocked.length}`);
  }
  process.exit(0);
}

// ── 读取模式 ───────────────────────────────────────────────────────────────
let raw = '';
try {
  raw = readFileSync(BASELINE_PATH, 'utf8');
} catch {
  console.error('✗ 读不到 scripts/spec-sync-baseline.json');
  console.error('  首次使用请执行：node scripts/check-spec-sync.mjs --update-baseline');
  process.exit(2);
}

let baseline;
try {
  baseline = JSON.parse(raw);
} catch (err) {
  console.error(`✗ baseline 不是合法 JSON：${err.message}`);
  process.exit(2);
}

// 锁 1a：baseline 必须有配套指纹 —— 手改 JSON 而没走 --update-baseline 会被拒
let expectedSha = '';
try {
  expectedSha = readFileSync(SHA_PATH, 'utf8').trim().split(/\s+/)[0] ?? '';
} catch {
  console.error('✗ 缺少 scripts/spec-sync-baseline.sha256');
  console.error('  baseline 被手工改过，或尚未生成。用 --update-baseline 重建。');
  process.exit(2);
}
const actualSha = sha256(raw);
if (expectedSha !== actualSha) {
  console.error('✗ baseline 指纹不匹配 —— baseline 被手工修改过');
  console.error(`  期望 ${expectedSha.slice(0, 12)}… / 实际 ${actualSha.slice(0, 12)}…`);
  console.error('  禁止手改 baseline（那等于把新偏差改名叫"已知"）。');
  console.error('  合法做法：node scripts/check-spec-sync.mjs --update-baseline');
  process.exit(2);
}

// 锁 1b：每项必须有 dimension / id / since / expect
if (!Array.isArray(baseline.items)) {
  console.error('✗ baseline.items 必须是数组');
  process.exit(2);
}
for (const item of baseline.items) {
  if (
    !item ||
    typeof item.dimension !== 'string' ||
    typeof item.id !== 'string' ||
    typeof item.since !== 'string' ||
    typeof item.expect !== 'string'
  ) {
    console.error(`✗ baseline 条目缺 dimension/id/since/expect：${JSON.stringify(item)}`);
    process.exit(2);
  }
  if (!/^\d+\.\d+\.\d+/.test(item.since)) {
    console.error(`✗ baseline 条目的 since 不是版本号：${item.since}`);
    process.exit(2);
  }
}

const known = new Set(baseline.items.map((i) => `${i.dimension}::${i.id}`));
const fresh = findings.filter((f) => !known.has(key(f)));
const resolved = baseline.items.filter((i) => !findings.some((f) => key(f) === key(i)));

// 锁 3：期望状态主动校验 —— 记录时的描述与现在实际检出的不一致 → 基线过期
const stale = baseline.items.filter((i) => {
  const f = findings.find((x) => key(x) === key(i));
  return f && f.detail !== i.expect;
});

// 锁 2：超期未清理 → 阻断（记录时的版本距今 ≥2 个 minor）
const [curMaj, curMin] = pkgVersion.split('.').map((n) => Number(n) || 0);
const expired = baseline.items.filter((i) => {
  const [sMaj, sMin] = i.since.split('.').map((n) => Number(n) || 0);
  return curMaj > sMaj || (curMaj === sMaj && curMin - sMin >= 2);
});

console.log('规范 ↔ 实现 一致性检查');
console.log('');
if (blocked.length > 0) {
  console.log(`  ⏸  blocked（未实现，不计失败）: ${blocked.length}`);
  for (const b of blocked) console.log(`     ${b.dimension}::${b.id} — ${b.detail}`);
  console.log('');
}
console.log(`  已知未修: ${known.size}`);
console.log(`  新增偏差: ${fresh.length}`);

let code = 0;

if (stale.length > 0) {
  code = 2;
  console.log('');
  console.log('  ❌ 基线过期（期望状态与实际检出不一致）:');
  for (const s of stale) {
    const actual = findings.find((x) => key(x) === key(s));
    console.log(`     ${s.dimension}::${s.id}`);
    console.log(`       基线记录: ${s.expect}`);
    console.log(`       实际检出: ${actual.detail}`);
  }
  console.log('     → 请确认修复方向后运行 --update-baseline');
}

if (expired.length > 0) {
  code = code || 1;
  console.log('');
  console.log('  ⏰ 已超期未清理（距记录时 ≥2 个版本）:');
  for (const e of expired) console.log(`     ${e.dimension}::${e.id} (since ${e.since})`);
}

if (fresh.length > 0) {
  code = code || 1;
  console.log('');
  console.log('  ❌ 新增偏差（回归）:');
  for (const f of fresh) console.log(`     [${f.dimension}] ${f.id} — ${f.detail}`);
}

if (resolved.length > 0) {
  code = code || 1;
  console.log('');
  console.log('  ✅ 已修复（应从 baseline 移除）:');
  for (const r of resolved) console.log(`     ${r.dimension}::${r.id}`);
  console.log('     → 运行 node scripts/check-spec-sync.mjs --update-baseline');
}

console.log('');
if (code === 0) console.log('  ✓ 规范与实现一致（无新增偏差）');
process.exit(code);
