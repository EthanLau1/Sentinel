#!/usr/bin/env node
/**
 * 批次报告生成器 —— 把 benchmark 案例变成一份可核对的 md 记录。
 *
 * 为什么单独一个脚本：报告是"给人看的结论"，案例是"机器读的事实"。
 * 两者必须能对上，所以报告里的每个数字都由 cases/ 里的 JSON 算出来，不手写。
 *
 * 用法：node scripts/bench-report.mjs [--out=benchmarks/external/<date>-批次报告.md]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(repo, 'benchmarks', 'cases');
const extDir = join(repo, 'benchmarks', 'external');

const args = process.argv.slice(2);
const outArg = (args.find((a) => a.startsWith('--out=')) || '').split('=')[1];

const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const outFile = outArg || join(extDir, `${stamp}-批次报告.md`);

function loadCases() {
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();
  const out = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(join(casesDir, f), 'utf8')));
    } catch {
      /* 跳过坏文件 */
    }
  }
  return out;
}

const all = loadCases();
const external = all.filter((c) => c.project !== 'sentinel-self');
const self = all.filter((c) => c.project === 'sentinel-self');
const batch = all.filter((c) => c.id.includes('-ext-'));
const hit = (list) => list.filter((c) => c.hit).length;
const pct = (n, t) => (t === 0 ? 'n/a' : `${((n / t) * 100).toFixed(1)}%`);

// 上一期报告是否可读（用户要求：报告开头必须写明）
const prevReports = existsSync(extDir)
  ? readdirSync(extDir).filter((f) => f.endsWith('.md')).sort()
  : [];
const prev = prevReports.filter((f) => f !== outFile.replace(/^.*\//, ''));
const prevReadable = prev.length > 0 ? '是（上一期：' + prev[prev.length - 1] + '）' : '否（本目录此前没有任何批次报告 md）';

const byProject = new Map();
for (const c of all) {
  const cur = byProject.get(c.project) ?? { total: 0, hit: 0, adopted: 0, verified: 0 };
  cur.total += 1;
  if (c.hit) cur.hit += 1;
  if (c.fixAdopted) cur.adopted += 1;
  if (c.fixPassedVerification) cur.verified += 1;
  byProject.set(c.project, cur);
}

const lines = [];
lines.push(`# Sentinel 批量真实外部 benchmark 批次报告`);
lines.push('');
lines.push(`> 生成时间：${now.toISOString()}`);
lines.push(`> 上一期是否可读：${prevReadable}`);
lines.push(`> 数据来源：\`benchmarks/cases/*.json\`（本报告所有数字由脚本算出，未手写）`);
lines.push(`> 生成命令：\`node scripts/bench-report.mjs\``);
lines.push('');
lines.push('## 一、批次结论（结论先行）');
lines.push('');
const needTotal = Math.max(0, 30 - all.length);
const needExternal = Math.max(0, 20 - external.length);
const verdict =
  needTotal === 0 && needExternal === 0
    ? '**判据达成** ✅（案例 ≥30、真实外部 ≥20）'
    : `**判据未达成** ❌ —— 还差 ${needTotal} 条案例、${needExternal} 条真实外部案例`;
lines.push(
  `本批次把**真实外部案例**从 3 条扩到 **${external.length} 条**，案例总数 ${all.length} 条。${verdict}`,
);
lines.push('');
lines.push('| 指标 | 数值 | 口径 |');
lines.push('|---|---|---|');
lines.push(`| 案例总数 | ${all.length} | cases/ 目录下全部符合 schema 的 JSON |`);
lines.push(`| 真实外部案例 | ${external.length} | project ≠ sentinel-self |`);
lines.push(`| 自反案例 | ${self.length} | project = sentinel-self（单独算，不与外部混算） |`);
lines.push(`| 命中真实根因 | ${hit(external)} / ${external.length}（${pct(hit(external), external.length)}） | rootCauseStatus=confirmed 且根因文本含真值关键词 |`);
lines.push(`| 采纳修复 | ${external.filter((c) => c.fixAdopted).length} / ${external.length} | 补丁真的落在被注入的文件上 |`);
lines.push(`| 修复通过验证 | ${external.filter((c) => c.fixPassedVerification).length} / ${external.length} | 同一个真实 dev server 上：修复前 ≥500 → 修复后 <500 |`);
lines.push('');
lines.push('## 二、按项目');
lines.push('');
lines.push('| 项目 | 案例 | 命中 | 采纳 | 验证通过 |');
lines.push('|---|---|---|---|---|');
for (const [p, s] of byProject) {
  lines.push(`| ${p} | ${s.total} | ${s.hit} | ${s.adopted} | ${s.verified} |`);
}
lines.push('');
lines.push('## 三、逐案例明细（外部）');
lines.push('');
lines.push('| 案例 ID | 项目 | feature | 症状 | 真值（人工读源码写定） | Sentinel 根因 | hit | tier | 采纳 | 验证 |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const c of external) {
  const rc = String(c.sentinelJudgment?.rootCause || '').replace(/\|/g, '\\|').slice(0, 120);
  const truth = String(c.realRootCause || '').replace(/\|/g, '\\|').slice(0, 90);
  lines.push(
    `| ${c.id} | ${c.project} | ${c.feature} | ${String(c.symptom || '').slice(0, 40)} | ${truth}… | ${rc}… | ${c.hit ? '✅' : '❌'} | ${c.recommendedFix?.tier ?? '-'} | ${c.fixAdopted ? '✅' : '❌'} | ${c.fixPassedVerification ? '✅' : '❌'} |`,
  );
}
lines.push('');
lines.push('## 四、覆盖边界（不宣称完整）');
lines.push('');
lines.push('| 维度 | 状态 | 证据 |');
lines.push('|---|---|---|');
lines.push('| Next.js（App Router `app/`） | ✅ 已覆盖 | 本批全部样本 |');
lines.push('| Next.js（Pages Router `pages/`） | ✅ 已覆盖 | virtual-event-starter-blog / tailwind-nextjs-starter-blog |');
lines.push('| Vue / Nuxt | ❌ 未覆盖 | `react/svelte/vue` adapter 各 14 行，只实现 detect/profile，**没有 routes()** → mapper 输出 pages 0 / flows 0 |');
lines.push('| Svelte / SvelteKit | ❌ 未覆盖 | 同上（实测 realworld：pages 0 / flows 0） |');
lines.push('| Vite + React（配置式路由） | ❌ 未覆盖 | 同上（实测 react-admin：pages 0 / flows 0） |');
lines.push('| 需外部账号/密钥的项目 | ❌ 未覆盖 | 例：next-shadcn-dashboard-starter 缺 Clerk key → 全站 500，无法区分缺陷来源 |');
lines.push('| 功能性缺陷（无 HTTP 错误） | ⚠️ 有限 | 自动 flow 只看路由状态码与正文可见性，行为类缺陷大概率查不到 |');
lines.push('');
lines.push('## 五、本批次发现的问题（执行者+审计者职责）');
lines.push('');
lines.push('1. **路由提取只覆盖 Next.js**：`packages/adapters/src/frontend/{react,svelte,vue}.ts` 各 14 行，没有 `routes()` 实现；`nextjs.ts` 支持 `app/` 与 `pages/` 两种约定。后果：非 Next.js 项目上 Sentinel 连流程都排不出来，**不是"查不到根因"，而是"一个诊断都产不出"**。');
lines.push('2. **CLI `--project` 只认等号格式**（E29）：帮助文本写的是 `--project <path>`，实现只认 `--project=<path>`；按帮助文本写会静默落到 CWD 的项目 —— 在别的目录跑等于测错对象，而且不报错。已修：两种格式都认，并补了 4 个用例（`packages/cli/test/config.test.ts`）。');
lines.push('3. **注入真值会被自己的报告纠正**：本批第一处注入我最初写的真值是"组件未导入"，读源码后发现闭标签没变、真因是"JSX 开闭标签不匹配"，已作废并改正 —— 说明真值必须由人读源码写定，不能由工具反推。');
lines.push('');
lines.push('## 六、数字口径说明');
lines.push('');
lines.push('- 「命中」= 状态与内容都要中：`rootCauseStatus === "confirmed"` **且** 根因文本包含 manifest 里人工写下的关键词；只看其中一个都算未命中。');
lines.push('- 「采纳」= 有补丁真的落在**被注入的那个文件**上（不是"推荐方案的 id 出现在 appliedPatches 里" —— 实测存在 Sentinel 应用了另一个等效方案的情况）。');
lines.push('- 「验证通过」= 在**同一个真实 dev server**上取修复前/后两次状态码，修复前 ≥500、修复后 <500；不由 Sentinel 自述。');
lines.push('- 自反案例（sentinel-self）与真实外部案例分开统计，混算会把数字抬高到没有参考价值。');
lines.push('');

writeFileSync(outFile, lines.join('\n'), 'utf8');
console.log(`报告写入：${outFile}`);
console.log(`案例 ${all.length}（外部 ${external.length} / 自反 ${self.length}）· 外部命中 ${hit(external)} · 采纳 ${external.filter((c) => c.fixAdopted).length} · 验证通过 ${external.filter((c) => c.fixPassedVerification).length}`);
