#!/usr/bin/env node
/**
 * 把一次真实 run 的产物转成 benchmark 案例草稿。
 *
 * 宪法红线 6：每个真实案例必须进入 benchmarks/cases/ 永久留档。
 *
 * 这个脚本只做**机械部分**（读产物、算统计、生成草稿）。
 * 三件事必须由人确认，脚本不猜：
 *   - realRootCause      真实根因（人工判断）
 *   - hit                Sentinel 是否命中真实根因
 *   - fixAdopted         修复是否被采纳
 *   - fixPassedVerification 修复是否通过验证
 * 草稿里这些字段一律标成待确认，由人核对后改。
 *
 * 用法：node scripts/archive-benchmark-case.mjs --project=<dir> [--run=<reports dir>]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(repo, 'benchmarks', 'cases');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const projectDir = arg('project');
if (!projectDir) {
  console.error('用法：node scripts/archive-benchmark-case.mjs --project=<被测项目目录> [--run=<reports 目录>]');
  process.exit(2);
}
const reportsDir = arg('run') ?? join(projectDir, 'reports');
const reportJson = join(reportsDir, 'sentinel-latest.json');
const statusJson = join(reportsDir, 'sentinel-run-status.json');

if (!existsSync(reportJson) || !existsSync(statusJson)) {
  console.error(`✗ 找不到 run 产物：${reportJson} / ${statusJson}`);
  process.exit(2);
}

const report = JSON.parse(readFileSync(reportJson, 'utf8'));
const status = JSON.parse(readFileSync(statusJson, 'utf8'));
const bugs = report.bugs ?? [];
if (bugs.length === 0) {
  console.error('✗ 这次 run 没有产出 bug，无需归档');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const projectName = basename(projectDir);
const existing = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
const seq = String(existing.length + 1).padStart(3, '0');

const created = [];
for (const [i, b] of bugs.entries()) {
  const id = `${today}-${seq}-${i + 1}`;
  const kinds = [...new Set((b.evidence ?? []).map((e) => e.kind))];
  const caseObj = {
    id,
    project: projectName,
    feature: b.affectedFeature,
    stage: 'MVP',
    symptom: b.symptom,
    // ↓↓↓ 待人工确认 ↓↓↓
    realRootCause: 'TODO-人工确认真实根因',
    sentinelJudgment: {
      rootCauseStatus: b.rootCauseStatus,
      ...(b.rootCause ? { rootCause: b.rootCause } : {}),
      confidence: b.confidence,
      evidenceCount: (b.evidence ?? []).length,
      evidenceKinds: kinds,
    },
    hit: false,
    recommendedFix: {
      id: `${b.id}_fix_1`,
      title: b.fixOptions?.[0]?.title ?? 'TODO-人工确认推荐方案',
      tier: b.fixOptions?.[0]?.tier ?? 0,
      effort: b.fixOptions?.[0]?.effort ?? 'low',
      risk: b.fixOptions?.[0]?.risk ?? 'low',
      score: b.fixOptions?.[0]?.score ?? 0,
    },
    fixAdopted: false,
    fixPassedVerification: false,
    notes:
      `由 scripts/archive-benchmark-case.mjs 从真实 run 产物生成（${status.status}）。` +
      `TODO：人工确认真实根因 / 是否命中 / 是否采纳 / 是否通过验证后再把 hit 等改为真值。`,
    createdAt: new Date().toISOString(),
    sentinelVersion: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
  };

  const file = join(casesDir, `${id}.json`);
  writeFileSync(file, JSON.stringify(caseObj, null, 2) + '\n', 'utf8');
  created.push(file);
  console.log(`✓ 已生成草稿：${file}`);
  console.log(`   根因状态 ${b.rootCauseStatus}，证据 ${caseObj.sentinelJudgment.evidenceCount} 条`);
}

console.log('');
console.log(`  共 ${created.length} 条草稿。TODO 字段人工确认后才算数。`);
console.log(`  确认后跑：node scripts/benchmark-stats.mjs`);
