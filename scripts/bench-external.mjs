#!/usr/bin/env node
/**
 * 批量真实外部项目 benchmark —— 把「真实外部案例」从个位数扩到可核对的规模。
 *
 * 为什么需要它：方案判据要求「案例 ≥30（真实外部 ≥20）」，
 * 而 §13.4 写的是「需要 20 个可测的真实项目」。真实项目可以自己找：
 * 克隆公开的真实仓库 + 注入一处**已知真值**的缺陷 = 真值由构造决定，
 * 不依赖 Sentinel 的产出（避免「期望值从产出里抄 = 恒真判据」）。
 *
 * 五条硬约束：
 * 1. 真值只来自 manifest（人工读源码写下的缺陷定义），不从报告里抄。
 * 2. 「命中」= rootCauseStatus=confirmed 且根因文本含真值关键词（状态和内容都要中）。
 * 3. 「修复通过验证」= 修复前后**同一个真实 dev server** 上该路由的状态码对比
 *    （修复前 ≥500 → 修复后 <500），不是 Sentinel 自称修好了。
 * 4. tier 只来自 run-status.tierDecisions（硬规则），不采信 LLM 自报值。
 * 5. 一处注入若影响了多个路由，就归档多条案例（每条一个 feature），不合并计数。
 *
 * 用法：
 *   node scripts/bench-external.mjs                 # 跑全部
 *   node scripts/bench-external.mjs --only=<proj>   # 只跑某个项目
 *   node scripts/bench-external.mjs --mutation=<id> # 只跑某处注入
 *   node scripts/bench-external.mjs --list          # 只列清单
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = process.env['SENTINEL_BENCH_WORK'] || join(homedir(), '.sentinel', 'bench-work');
const manifestPath = join(repo, 'benchmarks', 'external', 'manifest.json');
const casesDir = join(repo, 'benchmarks', 'cases');
const sentinelCli = join(repo, 'packages', 'cli', 'src', 'index.ts');

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const onlyMutation = (args.find((a) => a.startsWith('--mutation=')) || '').split('=')[1] || null;
const listOnly = args.includes('--list');
/** 单次 run 的最长等待：超过就判定卡死，避免 harness 无限挂着 */
const maxRunMs = Number((args.find((a) => a.startsWith('--max-run-ms=')) || '').split('=')[1]) || 20 * 60 * 1000;

/* ---------------------------------------------------------------- 基础工具 */

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (...a) => console.log(...a);

async function httpStatus(port, path) {
  try {
    // 必须跟随重定向：Next.js 常把 /about 308 到 /about/（trailingSlash），
    // 用 manual 会把 308 当成"没坏"，测到的不是真实页面状态。
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'follow' });
    return res.status;
  } catch {
    return 0;
  }
}

/** 推断 dev server 端口 —— 与 Sentinel 自己的推断保持一致，这样它能复用我起的服务 */
function inferPort(p) {
  if (p.devPort) return p.devPort;
  const pkg = JSON.parse(readFileSync(join(WORK, p.id, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  const name = ['dev', 'start', 'serve', 'dev:start', 'start:dev'].find((n) => scripts[n]);
  const content = String(scripts[name] || '');
  const m = /(?:--port|(?:^|[\s=])PORT=|-p)\s*(\d{4,5})/i.exec(content);
  if (m) return parseInt(m[1], 10);
  if (content.includes('next')) return 3000;
  if (content.includes('vite')) return 5173;
  if (content.includes('nuxt')) return 3000;
  return 3000;
}

/**
 * 端口隔离：并行跑多个 Next.js 项目时，Sentinel 会把「推断端口已被占用」
 * 误判成「该项目自己的 dev server 已在跑」→ 复用**别的项目的**服务 → 数据串味。
 * 所以给每个项目固定一个自己的端口，写进它的 dev 脚本。
 * 只改 dev 脚本的端口参数，不动任何被测代码。
 */
function isolatePort(dir, p) {
  if (!p.devPort) return;
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  // 必须按 Sentinel 的优先级顺序挑脚本，不能按 package.json 里的键序 ——
  // 有些项目（blog）把 start 写在 dev 前面，改错脚本 = 端口没隔离上。
  const key = ['dev', 'start', 'serve', 'dev:start', 'start:dev'].find((k) => pkg.scripts?.[k]);
  if (!key) return;
  if (String(pkg.scripts[key]).includes('--port')) return;
  pkg.scripts[key] = `${pkg.scripts[key]} --port ${p.devPort}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------ 项目准备工作 */

function ensureProject(p) {
  const dir = join(WORK, p.id);
  if (!existsSync(dir)) {
    log(`  克隆 ${p.repo}`);
    mkdirSync(WORK, { recursive: true });
    sh('git', ['clone', '--depth', '1', p.repo, dir]);
  }
  if (!existsSync(join(dir, 'node_modules'))) {
    log(`  安装依赖: ${p.install}`);
    sh('bash', ['-lc', p.install], { cwd: dir });
  }
  const sentinelDir = join(dir, '.sentinel');
  mkdirSync(join(sentinelDir, 'skills'), { recursive: true });
  isolatePort(dir, p);
  // 项目级 LLM 配置：走 minimax（key 走环境变量，不落盘）
  writeFileSync(
    join(sentinelDir, 'llm.yml'),
    [
      '# 批量 benchmark 用：key 走环境变量，不写进文件',
      'default: minimax',
      'providers:',
      '  minimax:',
      '    type: openai-compatible',
      '    baseUrl: https://api.minimaxi.com/v1',
      '    apiKey: ${MINIMAX_API_KEY}',
      '    model: MiniMax-M3',
      '    pricing:',
      '      pricePerMTokIn: 0.30',
      '      pricePerMTokOut: 1.20',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(sentinelDir, 'budget.yml'),
    'stage: MVP\n\nlimits:\n  maxCostUsdPerRun: 0.50\n  maxTokensPerRun: 100000\n  maxTokensPerRequest: 8000\n  maxDurationSecPerRun: 900\n',
    'utf8',
  );
  return dir;
}

function resetProject(dir, p) {
  sh('git', ['checkout', '--', '.'], { cwd: dir, quiet: true });
  rmSync(join(dir, 'reports'), { recursive: true, force: true });
  // git checkout 会把 package.json 里的端口隔离参数一起还原 → 重新打上
  isolatePort(dir, p);
}

/* ---------------------------------------------------------------- 注入缺陷 */

function applyMutation(dir, m) {
  const file = join(dir, m.file);
  if (!existsSync(file)) throw new Error(`注入失败：文件不存在 ${m.file}`);
  const src = readFileSync(file, 'utf8');
  const count = src.split(m.find).length - 1;
  if (count !== 1) {
    throw new Error(`注入失败：${m.file} 中 find 片段出现 ${count} 次（要求恰好 1 次）`);
  }
  writeFileSync(file, src.replace(m.find, m.replace), 'utf8');
}

/* -------------------------------------------------------------- 跑 Sentinel */

function runSentinel(dir, logFile) {
  // 实时落盘：批量跑时必须能看到 run 跑到哪一步（spawnSync 缓冲会让人瞎等）
  const fd = openSync(logFile, 'w');
  const child = spawn(
    'bun',
    [sentinelCli, 'run', `--project=${dir}`, '--no-enhance', '--auto-fix', '--report', 'both'],
    { cwd: repo, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const safeWrite = (d) => {
    try { writeSync(fd, d); } catch { /* fd 已关（子进程退出后仍可能有尾巴数据） */ }
  };
  child.stdout.on('data', safeWrite);
  child.stderr.on('data', safeWrite);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const done = (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { closeSync(fd); } catch { /* 已关闭 */ }
      resolve(code ?? 1);
    };
    // 用 'exit' 而不是 'close'：'close' 要等所有管道 EOF，
    // 而 Sentinel 起的 dev server / 浏览器会把管道一直挂着 → 永远等不到。
    child.on('exit', (code, signal) => done(signal ? 1 : code));
    child.on('close', (code) => done(code));
    // 兜底：超过 maxRunMs 仍未退出就判定为卡死，不能无限等
    timer = setTimeout(() => {
      try { writeSync(fd, `\n[bench] run 超时 ${maxRunMs}ms，强制结束\n`); } catch { /* fd 已关 */ }
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      done(1);
    }, maxRunMs);
    timer.unref?.();
  });
}

/** 先跑 mapper：flow id 与路由的对应关系只在这里有 */
function runMap(dir) {
  const out = spawnSync('bun', [sentinelCli, 'map', `--project=${dir}`], {
    cwd: repo,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.status;
}

function readReports(dir) {
  const bugPath = join(dir, 'reports', 'sentinel-latest.json');
  const statusPath = join(dir, 'reports', 'sentinel-run-status.json');
  if (!existsSync(bugPath) || !existsSync(statusPath)) return { report: null, status: null };
  return {
    report: JSON.parse(readFileSync(bugPath, 'utf8')),
    status: JSON.parse(readFileSync(statusPath, 'utf8')),
  };
}

/** flow id → 路由（来自 mapper 落盘的 FeatureMap） */
function loadFlowRoutes(dir) {
  const mapPath = join(dir, '.sentinel', 'app.map.generated.json');
  if (!existsSync(mapPath)) return new Map();
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const out = new Map();
  for (const pg of map.pages || []) out.set(`flow_page_${pg.id}`, pg.path);
  for (const ep of map.api || []) out.set(`flow_api_${ep.id}`, ep.path);
  return out;
}

/* ------------------------------------------------------- 采纳 + 独立验证 */

/** 起真实 dev server（端口与 Sentinel 推断一致 → 它会复用这个服务，不重复起） */
async function startDevServer(dir, p, port) {
  const child = spawn('bash', ['-lc', p.dev], {
    cwd: dir,
    env: { ...process.env, PORT: String(port), BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.resume();
  child.stderr?.resume();
  // 等端口可用（不等首页 —— 首页可能就是坏的）
  const start = Date.now();
  let up = false;
  while (Date.now() - start < 120000) {
    const code = await httpStatus(port, '/');
    if (code > 0) {
      up = true;
      break;
    }
    await sleep(1000);
  }
  return {
    up,
    stop() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          /* 已退出 */
        }
      }
    },
  };
}

/** 应用 Tier 2 patch（Tier 1 已在 run 期间自动改好源码） */
function applyTier2Patch(dir, fixId) {
  const patchDir = join(dir, 'reports', 'patches');
  if (!existsSync(patchDir)) return { applied: false, reason: '没有 patches 目录' };
  const file = readdirSync(patchDir).find((f) => f.startsWith(fixId));
  if (!file) return { applied: false, reason: '没有对应 patch 文件' };
  const patchPath = join(patchDir, file);
  const check = spawnSync('git', ['apply', '--check', '-v', patchPath], { cwd: dir, encoding: 'utf8' });
  if (check.status !== 0) {
    const msg = (check.stderr || check.stdout || '').trim().split('\n').slice(-2).join(' ');
    return { applied: false, reason: `git apply --check 失败：${msg}` };
  }
  const apply = spawnSync('git', ['apply', patchPath], { cwd: dir, encoding: 'utf8' });
  return apply.status === 0
    ? { applied: true, reason: `git apply ${file}` }
    : { applied: false, reason: `git apply 失败：${(apply.stderr || '').trim()}` };
}

/* ---------------------------------------------------------------- 案例归档 */

function buildCase({ p, m, bug, feature, tier, tierReason, adopted, adoptedReason, verified, verifiedReason, status }) {
  const fixOpts = bug?.fixOptions || [];
  const rec = bug?.recommendedFixId ? fixOpts.find((f) => f.id === bug.recommendedFixId) : fixOpts[0];
  const now = new Date();
  const seq = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const evidence = bug?.evidence || [];
  return {
    id: `${seq}-ext-${p.id}-${m.id}-${feature.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    project: p.id,
    feature,
    stage: 'MVP',
    symptom: bug?.symptom || m.symptom,
    realRootCause: m.realRootCause,
    sentinelJudgment: {
      rootCauseStatus: bug?.rootCauseStatus ?? 'hypothesis',
      rootCause: bug?.rootCause ?? '',
      confidence: bug?.confidence ?? 0,
      evidenceCount: evidence.length,
      evidenceKinds: [...new Set(evidence.map((e) => e.kind))],
    },
    hit: !!bug && bug.rootCauseStatus === 'confirmed' && (m.expectRootCauseContains || []).some((k) => String(bug.rootCause || '').includes(k)),
    recommendedFix: rec
      ? { id: rec.id, title: rec.title, tier, effort: rec.effort, risk: rec.risk, score: rec.score }
      : { id: 'none', title: '未产出修复方案', tier, effort: 'S', risk: 'S', score: 0 },
    fixAdopted: adopted,
    fixPassedVerification: verified,
    replayExpectation: {
      rootCauseContains: m.expectRootCauseContains,
      recommendedTitleContains: m.expectTitleContains || [],
      hardTier: tier,
      patchValid: adopted,
      note: m.note,
    },
    notes: [
      `真值来源：公开仓库 ${p.repo} 注入已知缺陷 ${m.id}；真值由人工读源码写定，未参考 Sentinel 产出。`,
      bug
        ? `命中判定：rootCauseStatus=${bug.rootCauseStatus} 且根因文本含真值关键词 ${JSON.stringify(m.expectRootCauseContains)}。`
        : `⚠ Sentinel 在该 feature 上未产生诊断（漏检）。`,
      `tier 来源：run-status.tierDecisions（硬规则），理由：${tierReason}`,
      `采纳：${adoptedReason}`,
      `验证：${verifiedReason}`,
      `run 状态：failedFlows=${status?.failedFlows ?? 'n/a'} passedFlows=${status?.passedFlows ?? 'n/a'} appliedPatches=${JSON.stringify(status?.appliedPatches ?? [])}`,
    ].join('\n'),
    createdAt: now.toISOString(),
    sentinelVersion: 'v1.2-batch',
  };
}

/* -------------------------------------------------------------------- 主流程 */

async function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const projects = only ? manifest.projects.filter((p) => p.id === only) : manifest.projects;

  if (listOnly) {
    for (const p of projects) {
      log(`${p.id}  (${p.repo})  注入 ${p.mutations.length} 处`);
      for (const m of p.mutations) log(`   - ${m.id}  ${m.route}  ${m.symptom}`);
    }
    return;
  }

  if (!process.env['MINIMAX_API_KEY']) {
    log('❌ 环境变量 MINIMAX_API_KEY 未设置 —— 不打印 key，请自行导出后再跑。');
    process.exit(2);
  }

  const results = [];
  for (const p of projects) {
    log('');
    log(`━━ ${p.id} ━━`);
    const dir = ensureProject(p);
    const port = inferPort(p);
    const mutations = onlyMutation ? p.mutations.filter((m) => m.id === onlyMutation) : p.mutations;
    const projectResults = [];

    for (const m of mutations) {
      log(`  ▶ ${m.id}  ${m.route}`);
      resetProject(dir, p);
      applyMutation(dir, m);

      // 先跑 mapper：flow id ↔ 路由的对应关系只在这里有
      const mapStatus = runMap(dir);
      if (mapStatus !== 0) log(`    ⚠ mapper 退出码 ${mapStatus}（flow 对齐可能不准）`);
      const flowRoutes = loadFlowRoutes(dir);

      // 起真实 dev server，记录**每条路由**的修复前状态码
      // （共享组件坏掉会同时影响多条路由，逐条对照才算严谨）
      const srv = await startDevServer(dir, p, port);
      const routes = [...new Set([m.route, ...flowRoutes.values()])];
      const before = new Map();
      for (const r of routes) before.set(r, await httpStatus(port, r));
      const beforeStatus = before.get(m.route) ?? 0;
      log(`    修复前 ${m.route} → HTTP ${beforeStatus}`);

      const logFile = join(WORK, `${p.id}-${m.id}.log`);
      const t0 = Date.now();
      const exitCode = await runSentinel(dir, logFile);
      log(`    run 退出码 ${exitCode}，耗时 ${Math.round((Date.now() - t0) / 1000)}s`);

      const { report, status: st } = readReports(dir);
      if (!report || !st) {
        log('    ❌ 没有产出报告（见日志）');
        results.push({ project: p.id, mutation: m.id, outcome: 'no-report' });
        srv.stop();
        await sleep(2000);
        continue;
      }

      const bugs = report.bugs || [];
      const keywords = m.expectRootCauseContains || [];
      const matched = bugs.filter((b) => keywords.some((k) => String(b.rootCause || '').includes(k)));
      // 目标 route 的 finding 排前面
      matched.sort((a, b) => {
        const ra = flowRoutes.get(a.affectedFeature) === m.route ? 0 : 1;
        const rb = flowRoutes.get(b.affectedFeature) === m.route ? 0 : 1;
        return ra - rb;
      });
      if (matched.length === 0) {
        log('    ⚠ 没有与真值匹配的诊断（漏检或根因表述不同）');
      }

      // tier 只来自硬规则
      const recId = matched[0]?.recommendedFixId;
      const decision = (st.tierDecisions || []).find((d) => d.fixId === recId);
      const tier = decision?.tier ?? 3;
      const tierReason = decision?.reason ?? '未记录硬规则判定';

      // 采纳：判据是「补丁是否真的落在被注入的文件上」
      const appliedOnTarget = (st.appliedPatches || []).find((a) =>
        (a.files || []).some((f) => f.replace(/^\.\//, '') === m.file),
      );
      let adopted = false;
      let adoptedReason = '';
      if (appliedOnTarget) {
        adopted = true;
        adoptedReason = `Tier 1 自动应用（${appliedOnTarget.fixId} → ${JSON.stringify(appliedOnTarget.files)}）`;
      } else if (tier === 2 && recId) {
        const r = applyTier2Patch(dir, recId);
        adopted = r.applied;
        adoptedReason = r.reason;
      } else {
        adoptedReason = `tier=${tier}（${tierReason}），无落在被注入文件上的补丁`;
      }

      // 修复后：同一个 dev server（Next dev 热更新）再取一次状态码
      let afterStatus = 0;
      const after = new Map();
      if (adopted) {
        await sleep(3000); // 等热更新编译
        for (const r of routes) after.set(r, await httpStatus(port, r));
        afterStatus = after.get(m.route) ?? 0;
        log(`    修复后 ${m.route} → HTTP ${afterStatus}`);
      }

      const caseBugs = matched.length > 0 ? matched : [];
      for (const bug of caseBugs) {
        const feature = bug.affectedFeature;
        const route = flowRoutes.get(feature) || m.route;
        let verified = false;
        let verifiedReason = '';
        if (adopted) {
          const code = after.get(route) ?? (await httpStatus(port, route));
          const prev = before.get(route) ?? 0;
          // 判据：这条路由**确实曾经坏过**（修复前 ≥500），且修复后好了
          verified = code > 0 && code < 500 && prev >= 500;
          verifiedReason = `修复前 HTTP ${prev} → 修复后 HTTP ${code}（${route}）`;
        } else {
          verifiedReason = '未采纳修复，不做验证';
        }
        const c = buildCase({
          p, m, bug, feature, tier, tierReason, adopted, adoptedReason, verified, verifiedReason, status: st,
        });
        const file = join(casesDir, `${c.id}.json`);
        writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
        log(`    [${feature}] hit=${c.hit} tier=${tier} adopted=${adopted} verified=${verified}`);
        results.push({
          project: p.id, mutation: m.id, feature, route, outcome: 'case',
          hit: c.hit, tier, adopted, verified, bugId: bug.id,
        });
        projectResults.push({
          project: p.id, mutation: m.id, feature, route, outcome: 'case',
          hit: c.hit, tier, adopted, verified, bugId: bug.id,
        });
      }
      if (caseBugs.length === 0) {
        // 没有诊断也要留痕：这是真实的漏检数据
        const c = buildCase({
          p, m, bug: null, feature: 'unknown', tier, tierReason, adopted, adoptedReason,
          verified: false, verifiedReason: '未采纳修复，不做验证', status: st,
        });
        const file = join(casesDir, `${c.id}.json`);
        writeFileSync(file, JSON.stringify(c, null, 2) + '\n', 'utf8');
        log(`    [漏检] 未产生诊断 → 已归档为 hit=false 案例`);
        results.push({ project: p.id, mutation: m.id, feature: 'unknown', outcome: 'case', hit: false, tier, adopted, verified: false });
        projectResults.push({ project: p.id, mutation: m.id, feature: 'unknown', outcome: 'case', hit: false, tier, adopted, verified: false });
      }

      srv.stop();
      await sleep(2000);
    }

    // 每项目一个结果文件：多个 worker 并行时，共用一个文件会互相覆盖
    const outFile = join(repo, 'benchmarks', 'external', `results-${p.id}.json`);
    writeFileSync(
      outFile,
      JSON.stringify({ ranAt: new Date().toISOString(), project: p.id, results: projectResults }, null, 2) + '\n',
      'utf8',
    );
    log('');
    log(`汇总写入 ${outFile}`);
  }

  const cases = results.filter((r) => r.outcome === 'case');
  log(`本轮案例 ${cases.length} 条 · 命中 ${cases.filter((c) => c.hit).length} · 采纳 ${cases.filter((c) => c.adopted).length} · 验证通过 ${cases.filter((c) => c.verified).length}`);
}

main().catch((e) => {
  console.error('❌', e);
  process.exit(1);
});
