#!/usr/bin/env bun
/**
 * 断网守卫 —— 证明「离线模式一次外网请求都不许发」这句话不是空话。
 *
 * 宪法 v1.5 离线模式条款：**离线模式下一次外网请求都不许发**。
 * 这条以前只有"自觉"（实现里写了 skipSearch / skipLlmProbe），没有机检。
 * 本脚本把它变成可核对的事实。
 *
 * 它做四件事，每件都从**外部**取证，不相信被测代码的自报：
 *
 *   1. 把零依赖夹具复制到临时目录（不污染仓库）
 *   2. 在**断网沙箱**里跑一次真实的 `sentinel run --offline`
 *      - macOS：sandbox-exec（deny network-outbound，只放行 localhost）
 *      - 其它平台：退化为 preload 探针（记录出网请求）
 *   3. 核对 preload 探针的记录：**不允许出现任何非回环地址**
 *   4. 核对运行产物：必须真的检出了夹具里注入的 5 个缺陷，且 llmRequests=0
 *
 * 退出码：0 通过 / 1 失败 / 2 环境不具备（无法判定）
 *
 * 用法：
 *   bun scripts/check-offline-guard.mjs
 *   bun scripts/check-offline-guard.mjs --keep    # 保留临时目录，便于人工排查
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(repo, 'benchmarks', 'fixtures', 'offline-web-app');
const KEEP = process.argv.includes('--keep');

/** 夹具 README 里那张真值表 —— 期望检出的缺陷 */
const EXPECTED = [
  { id: 'D1', rule: 'console-error', match: /控制台报错/, severity: 'P1' },
  { id: 'D2', rule: 'client-error', match: /返回 404/, severity: 'P2' },
  { id: 'D3', rule: 'uncaught-exception', match: /未捕获异常/, severity: 'P1' },
  { id: 'D4', rule: 'missing-lang', match: /缺少 lang/, severity: 'P3' },
  { id: 'D5', rule: 'server-error', match: /返回 500/, severity: 'P1' },
];

const failures = [];
const notes = [];
const fail = (msg) => { failures.push(msg); console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => { notes.push(msg); console.log(`  · ${msg}`); };

// ── 0. 前置检查 ───────────────────────────────────────────────────────────
console.log('断网守卫：离线模式不得发外网请求');
console.log('');

if (!existsSync(FIXTURE)) {
  console.error(`✗ 找不到夹具：${FIXTURE}`);
  process.exit(2);
}

const sandboxExec = '/usr/bin/sandbox-exec';
const hasSandbox = existsSync(sandboxExec);
if (!hasSandbox) {
  note('本机没有 sandbox-exec（macOS 专有）—— 只用 preload 探针判定，缺少 OS 层断网');
}

// ── 1. 夹具复制到临时目录 ─────────────────────────────────────────────────
const work = mkdtempSync(join(tmpdir(), 'sentinel-offline-guard-'));
const project = join(work, 'offline-web-app');
cpSync(FIXTURE, project, { recursive: true });
note(`夹具已复制到 ${project}`);

const netLog = join(work, 'network.log');
writeFileSync(netLog, '', 'utf8');

// ── 2. 组装运行命令 ───────────────────────────────────────────────────────
// preload 探针：从外部记录每一个出网请求。
// 它用 bun --preload 注入 —— 探针代码在被测代码之前加载。
const cliEntry = join(repo, 'packages', 'cli', 'src', 'index.ts');
const preload = join(repo, 'scripts', 'offline-guard-preload.mjs');
const bunArgs = ['--preload', preload, cliEntry, 'run', `--project=${project}`, '--offline', '--report', 'both'];

let sandboxProfile = null;
if (hasSandbox) {
  // 只放行回环地址：dev server 在本地，浏览器也要连本地。
  // 用 localhost:* 而不是写死端口 —— 端口由 dev server 动态挑选。
  sandboxProfile = join(work, 'no-net.sb');
  writeFileSync(
    sandboxProfile,
    '(version 1)\n(allow default)\n(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n',
    'utf8',
  );
}

const env = { ...process.env, SENTINEL_GUARD_NET_LOG: netLog, BROWSER: 'none' };

console.log('运行：sentinel run --offline（断网）');
console.log('');

let exitCode = 0;
let stdout = '';
let stderr = '';
try {
  const cmd = hasSandbox ? sandboxExec : 'bun';
  const args = hasSandbox ? ['-f', sandboxProfile, 'bun', ...bunArgs] : bunArgs;
  const proc = spawnSync(cmd, args, {
    cwd: repo,
    env,
    encoding: 'utf8',
    timeout: 240_000,
  });
  stdout = proc.stdout ?? '';
  stderr = proc.stderr ?? '';
  exitCode = proc.status ?? 1;
  if (proc.error) {
    console.error(`✗ 运行失败：${proc.error.message}`);
    process.exit(2);
  }
} finally {
  // 报告留在临时目录里供核对
}

// ── 3. 核对探针记录：不允许任何非回环出网 ─────────────────────────────────
console.log('核对出网记录');
const lines = readFileSync(netLog, 'utf8').split('\n').filter(Boolean);
const requests = [];
for (const line of lines) {
  try { requests.push(JSON.parse(line)); } catch { /* 忽略坏行 */ }
}
const external = requests.filter((r) => r.loopback === false);
if (external.length === 0) {
  ok(`出网记录 ${requests.length} 条，全部为回环地址（本机 dev server）`);
} else {
  fail(`发现 ${external.length} 条非回环出网请求 —— 离线模式违反宪法条款：`);
  for (const r of external.slice(0, 10)) {
    console.log(`      ${r.kind} ${r.url} → ${r.host}${r.port ? ':' + r.port : ''}`);
  }
}
if (requests.length === 0) {
  note('一条出网请求都没有 —— 连本地 dev server 都没走 HTTP（说明 flow 没跑起来，请看下面的产出核对）');
}

// ── 4. 核对运行产物 ───────────────────────────────────────────────────────
console.log('');
console.log('核对运行产出');

const statusPath = join(project, 'reports', 'sentinel-run-status.json');
const reportPath = join(project, 'reports', 'sentinel-latest.json');

if (!existsSync(statusPath) || !existsSync(reportPath)) {
  fail('没有产出 run-status.json / sentinel-latest.json —— run 没有跑完');
  console.log('');
  console.log('--- 退出码 ---', exitCode);
  console.log('--- stdout 末尾 ---');
  console.log(stdout.split('\n').slice(-40).join('\n'));
  if (stderr) {
    console.log('--- stderr 末尾 ---');
    console.log(stderr.split('\n').slice(-20).join('\n'));
  }
  finish();
}

const status = JSON.parse(readFileSync(statusPath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

// 4.1 必须是离线模式
if (status.llmMode === 'offline') ok('run-status.llmMode = offline');
else fail(`run-status.llmMode = ${JSON.stringify(status.llmMode)}，期望 offline`);

// 4.2 一次 LLM 请求都不能有
if (status.llmRequests === 0) ok('llmRequests = 0');
else fail(`llmRequests = ${status.llmRequests}，期望 0`);

// 4.3 一次外部知识检索都不能有
const knowledgeRequests = status.knowledgeRequests ?? [];
if (knowledgeRequests.length === 0) ok('knowledgeRequests = 0 条（没有查过 GitHub / StackOverflow）');
else fail(`knowledgeRequests = ${knowledgeRequests.length} 条，离线模式不允许检索外部知识`);

// 4.4 必须真的检出了注入的 5 个缺陷
const bugs = report.bugs ?? [];
for (const want of EXPECTED) {
  const hit = bugs.find((b) => want.match.test(b.title ?? ''));
  if (!hit) {
    fail(`未检出 ${want.id}（期望标题匹配 ${want.match}）`);
    continue;
  }
  const sevOk = hit.severity === want.severity;
  if (!sevOk) {
    fail(`${want.id} 严重级别是 ${hit.severity}，期望 ${want.severity}`);
    continue;
  }
  ok(`${want.id} 检出：${hit.title}`);
}

// 4.5 报告必须写明是离线模式
if (report.llm_mode === 'offline') ok('报告 llm_mode = offline');
else fail(`报告 llm_mode = ${JSON.stringify(report.llm_mode)}，期望 offline`);

// 4.6 结论来源必须是规则判定，不能冒充模型推断
const byOrigin = report.summary?.by_origin ?? {};
if (byOrigin.rule > 0) ok(`by_origin.rule = ${byOrigin.rule}（结论来自确定性规则）`);
else fail(`by_origin.rule = ${byOrigin.rule ?? 0}，离线模式应至少有一条规则判定结论`);
// 离线模式一次模型都没调过（llmRequests=0），任何 'llm' 来源的结论都是冒充。
if (byOrigin.llm === undefined || byOrigin.llm === 0) {
  ok('by_origin.llm = 0（没有模型参与，却声称有模型结论 —— 已排除）');
} else {
  fail(`by_origin.llm = ${byOrigin.llm}，但本次 llmRequests = 0 —— 报告在冒充模型推断`);
}
if ((byOrigin.heuristic ?? 0) > 0) {
  note(`by_origin.heuristic = ${byOrigin.heuristic}（模型未参与的启发式结论，口径如实标注）`);
}

finish();

// ── 收尾 ─────────────────────────────────────────────────────────────────
function finish() {
  console.log('');
  if (!KEEP) {
    rmSync(work, { recursive: true, force: true });
  } else {
    note(`临时目录保留在 ${work}`);
  }
  if (failures.length === 0) {
    console.log(`  ✅ 断网守卫通过（出网记录 ${requests.length} 条，全部回环）`);
    process.exit(0);
  }
  console.log(`  ❌ 断网守卫失败：${failures.length} 项`);
  for (const f of failures) console.log(`     - ${f}`);
  process.exit(1);
}
