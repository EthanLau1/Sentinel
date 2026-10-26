#!/usr/bin/env node
/**
 * benchmark 统计 —— 把归档案例变成可核对的数字。
 *
 * 为什么需要它：宪法红线 6 要求真实案例永久留档，
 * 但"留了档"不等于"能用"。命中率 / 采纳率 / 验证通过率必须有实测数字，
 * 否则"效果好不好"永远是嘴上说的。
 *
 * 用法：node scripts/benchmark-stats.mjs
 * 退出码：0 正常 / 2 有案例不合 schema
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(repo, 'benchmarks', 'cases');

/** 与 benchmarks/schema.ts 相同的校验（脚本不能 import TS 源） */
function validateCase(c) {
  if (!c || typeof c !== 'object') return false;
  const r = c;
  return (
    typeof r.id === 'string' &&
    typeof r.project === 'string' &&
    typeof r.feature === 'string' &&
    typeof r.symptom === 'string' &&
    typeof r.realRootCause === 'string' &&
    typeof r.hit === 'boolean' &&
    typeof r.fixAdopted === 'boolean' &&
    typeof r.fixPassedVerification === 'boolean'
  );
}

const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
const cases = [];
const invalid = [];

for (const f of files) {
  let obj;
  try {
    obj = JSON.parse(readFileSync(join(casesDir, f), 'utf8'));
  } catch (e) {
    invalid.push(`${f}: JSON 解析失败`);
    continue;
  }
  if (!validateCase(obj)) {
    invalid.push(`${f}: 不符合 schema`);
    continue;
  }
  cases.push(obj);
}

const pct = (n, total) => (total === 0 ? 'n/a' : `${((n / total) * 100).toFixed(1)}%`);

const hit = cases.filter((c) => c.hit).length;
const adopted = cases.filter((c) => c.fixAdopted).length;
const verified = cases.filter((c) => c.fixPassedVerification).length;
const confirmed = cases.filter((c) => c.sentinelJudgment?.rootCauseStatus === 'confirmed').length;
const avgConfidence =
  cases.length === 0
    ? 0
    : cases.reduce((s, c) => s + (c.sentinelJudgment?.confidence ?? 0), 0) / cases.length;

const projects = new Set(cases.map((c) => c.project));
// 自反案例（sentinel 自己的 bug）不能和真实外部案例混在一起算命中率 ——
// 它们的样本是挑选过的，混算会把数字抬高到没有参考价值。
const selfCases = cases.filter((c) => c.project === 'sentinel-self');
const externalCases = cases.filter((c) => c.project !== 'sentinel-self');

console.log('Sentinel benchmark 统计');
console.log('');
console.log(`  案例总数          ${cases.length}`);
console.log(`  覆盖项目数        ${projects.size}`);
console.log(`  命中真实根因      ${hit} / ${cases.length}  (${pct(hit, cases.length)})`);
console.log(`  判定为 confirmed  ${confirmed} / ${cases.length}  (${pct(confirmed, cases.length)})`);
console.log(`  用户采纳修复      ${adopted} / ${cases.length}  (${pct(adopted, cases.length)})`);
console.log(`  修复通过验证      ${verified} / ${cases.length}  (${pct(verified, cases.length)})`);
console.log(`  平均置信度        ${avgConfidence.toFixed(3)}`);
console.log('');
console.log('  口径拆分（自反案例不能和真实外部案例混算）:');
console.log(
  `    自反案例 sentinel-self  ${selfCases.length} 条` +
    (selfCases.length ? `  命中 ${selfCases.filter((c) => c.hit).length}` : ''),
);
console.log(
  `    真实外部案例             ${externalCases.length} 条` +
    (externalCases.length
      ? `  命中 ${externalCases.filter((c) => c.hit).length}  (${pct(
          externalCases.filter((c) => c.hit).length,
          externalCases.length,
        )})`
      : ''),
);
console.log('');

const byProject = new Map();
for (const c of cases) {
  const cur = byProject.get(c.project) ?? { total: 0, hit: 0 };
  cur.total += 1;
  if (c.hit) cur.hit += 1;
  byProject.set(c.project, cur);
}
console.log('  按项目:');
for (const [project, s] of byProject) {
  console.log(`    ${project}: ${s.hit}/${s.total} 命中`);
}
console.log('');

if (invalid.length > 0) {
  console.log('  ❌ 有案例不合 schema:');
  for (const i of invalid) console.log(`     ${i}`);
  process.exit(2);
}

if (cases.length < 30) {
  console.log(
    `  ⚠ 案例数 ${cases.length} < 30（方案批5 判据）。真实外部案例需要真实项目 + 人工确认根因，无法自动生成。`,
  );
}
