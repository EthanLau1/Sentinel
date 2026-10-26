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
  const callers = list('packages').flatMap((pkg) =>
    list(join('packages', pkg, 'src')).filter((f) => f.endsWith('.ts')),
  );
  const used = callers.some((f) => read(join('packages', pkgOf(f), 'src', f)).includes('validateCase'));
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
