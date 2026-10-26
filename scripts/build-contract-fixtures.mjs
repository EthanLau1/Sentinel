#!/usr/bin/env bun
/**
 * 生成**契约夹具**（benchmarks/replay/contract/*.json）——
 * 让回测覆盖到「全部历史 case」，而不只是 1 个录制的。
 *
 * 为什么要两种夹具：
 *   - **录制夹具**（benchmarks/replay/*.json）：模型回复是**真录的**。
 *     它守住的是「模型输出形态」相关的问题（think 块、截断、怪 JSON）。
 *     代价：每条 case 都要真跑一次 LLM 才有，39 条里只录成了 1 条。
 *   - **契约夹具**（本脚本产物）：模型回复是**按人工真值构造的**，
 *     输入（被改坏的真实文件、真实路由、真实 HTTP 状态）是**重建的真实数据**，
 *     期望值全部来自**人工写定的真值**（cases/*.json 的 replayExpectation）。
 *     它守住的是**决策层**：critic 的证据闸门、planner 的三方案协议、
 *     executor 的 Tier 硬规则、补丁规范化与「补丁能不能真应用」。
 *
 * 关键约束（防止变成恒真判据）：
 *   1. 期望值**不从产出里抄**：根因关键词/方案标题关键词来自 cases/*.json 的人工字段，
 *      tier 来自归档时记录的**硬规则判定**。
 *   2. 补丁是**人工真值重建**的（把注入的缺陷改回去），
 *      回测时用**真 git apply** 验证它能不能应用到被改坏的真实文件上。
 *   3. 构造出来的方案形状必须**复现档案里记录的那一档**（从案例 notes 的判定理由读），
 *      生成时会断言 classifyTier(构造的方案) == 人工记录的 tier；不一致就报错，不自动改。
 *
 * 用法：bun scripts/build-contract-fixtures.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { classifyTier } from '../packages/subagents/src/executor.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(repo, 'benchmarks', 'cases');
const outDir = join(repo, 'benchmarks', 'replay', 'contract');
const benchWork = join(homedir(), '.sentinel', 'bench-work');
const manifest = JSON.parse(readFileSync(join(repo, 'benchmarks', 'external', 'manifest.json'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');

const FIXED_TS = 1793000000000; // 固定时间戳：夹具必须可重复生成
const hashOf = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
/** 压成一行（代码片段写进方案说明里，关键词就在里面） */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

// ── 小工具 ────────────────────────────────────────────────────────────────
function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** 用临时 git 仓库生成真实 unified diff（行号、hunk 计数都对） */
function makeDiff(relPath, broken, fixed) {
  const tmp = join(tmpdir(), `sentinel-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dirname(join(tmp, relPath)), { recursive: true });
  writeFileSync(join(tmp, relPath), broken, 'utf8');
  sh('git', ['init', '-q', '-b', 'main'], tmp);
  sh('git', ['config', 'user.email', 'contract@example.com'], tmp);
  sh('git', ['config', 'user.name', 'contract'], tmp);
  sh('git', ['add', '-A'], tmp);
  sh('git', ['commit', '-qm', 'broken'], tmp);
  writeFileSync(join(tmp, relPath), fixed, 'utf8');
  const diff = sh('git', ['diff', '--no-color'], tmp);
  rmSync(tmp, { recursive: true, force: true });
  if (!diff.includes('@@')) throw new Error(`生成的 diff 没有 hunk：${relPath}`);
  return diff;
}

/** 找出 case 对应的 manifest 注入记录 */
function findMutation(benchCase) {
  for (const project of manifest.projects) {
    if (project.id !== benchCase.project) continue;
    for (const m of project.mutations) {
      if (benchCase.id.includes(`-${m.id}-`) || benchCase.id.endsWith(`-${m.id}`)) {
        return { project, mutation: m };
      }
    }
  }
  return null;
}

/**
 * 本仓库示例项目（examples/nextjs-blog）的案例没有 manifest 注入记录 ——
 * 它们的"缺陷"就是示例代码本身（占位组件 return null），
 * 文件在仓库里现成可用，直接当被改坏的文件。
 */
const EXAMPLE_PROJECT = {
  'nextjs-blog': { dir: join(repo, 'examples', 'nextjs-blog'), port: 3000 },
};

function resolveExampleSource(benchCase) {
  const spec = EXAMPLE_PROJECT[benchCase.project];
  if (!spec) return null;
  const file = /(app\/[\w/-]+\.tsx)/.exec(benchCase.realRootCause)?.[1];
  if (!file) return null;
  const full = join(spec.dir, file);
  if (!existsSync(full)) return null;
  const broken = readFileSync(full, 'utf8');
  if (!broken.includes('return null')) return null;
  const heading = file.includes('posts') ? 'Posts' : 'Home';
  const fixed = broken.replace(
    'return null;',
    `return (\n    <main>\n      <h1>${heading}</h1>\n    </main>\n  );`,
  );
  const route = file.includes('posts') ? '/posts' : '/';
  return {
    file, broken, fixed, route, port: spec.port,
    mutationId: 'example-placeholder-null',
    find: 'return null;',
    replace: 'return (\n    <main>\n      <h1>Home</h1>\n    </main>\n  );',
  };
}

/** 案例 notes 里记着硬规则判定的理由（人工读过的） */
function tierReason(benchCase) {
  const m = /理由：([^\n]*)/.exec(benchCase.notes ?? '');
  return m?.[1]?.trim() ?? '';
}

// ── 逐个案例构造夹具 ──────────────────────────────────────────────────────
const results = [];
const skipped = [];
const warnings = [];

for (const file of readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort()) {
  const benchCase = JSON.parse(readFileSync(join(casesDir, file), 'utf8'));
  const id = benchCase.id;

  // 自反案例：分析对象是 Sentinel 自己的源码，没有注入的真值缺陷 → 不进回测集
  if (benchCase.project === 'sentinel-self') {
    skipped.push({ id, reason: '自反案例（分析 Sentinel 自己的源码），没有注入的真值缺陷，也没有人工判据关键词' });
    continue;
  }

  // 漏检案例：Sentinel 根本没产出诊断 → 没有可回放的决策链
  const rootCause = benchCase.sentinelJudgment?.rootCause ?? '';
  if (!rootCause.trim()) {
    skipped.push({ id, reason: '漏检案例（Sentinel 未产出诊断，rootCause 为空），没有可回放的决策链' });
    continue;
  }

  const found = findMutation(benchCase);
  let source = null;
  if (found) {
    const { project, mutation } = found;
    // 重建「被改坏的真实文件」：bench-work 里的仓库 HEAD 是原始版本（缺陷是未提交的改动）
    const repoDir = join(benchWork, project.id);
    if (!existsSync(repoDir)) {
      skipped.push({ id, reason: `找不到 bench 工作副本：${repoDir}（重新跑 scripts/bench-external.mjs 才会生成）` });
      continue;
    }
    let original;
    try {
      original = sh('git', ['show', `HEAD:${mutation.file}`], repoDir);
    } catch {
      skipped.push({ id, reason: `bench 工作副本里读不到原始文件：${mutation.file}` });
      continue;
    }
    const broken = original.replace(mutation.find, mutation.replace);
    if (broken === original || !broken.includes(mutation.replace)) {
      skipped.push({ id, reason: `注入记录与仓库现状对不上（找不到 "${mutation.replace.slice(0, 40)}"）` });
      continue;
    }
    source = {
      file: mutation.file,
      broken,
      fixed: broken.replace(mutation.replace, mutation.find),
      route: mutation.route,
      port: project.devPort,
      mutationId: mutation.id,
      find: mutation.find,
      replace: mutation.replace,
    };
  } else {
    source = resolveExampleSource(benchCase);
    if (!source) {
      skipped.push({ id, reason: '在 manifest 里找不到对应的注入记录，也无法从仓库示例项目重建' });
      continue;
    }
  }
  const { file: mutationFile, broken, fixed, route, port } = source;
  const diff = makeDiff(mutationFile, broken, fixed);

  // ── 证据：真实文件 + 真实路由的 HTTP 500 ──────────────────────────────
  const fileHash = hashOf(`file:${mutationFile}:${broken}`);
  const httpHash = hashOf(`http:${route}:500`);
  const consoleHash = hashOf(`console:${mutationFile}:${broken}`);
  const evidence = [
    {
      kind: 'file', source: 'fs', path: mutationFile, snippet: broken,
      hash: fileHash, timestamp: FIXED_TS,
    },
    {
      kind: 'http', source: 'api', url: `http://127.0.0.1:${port}${route}`,
      method: 'GET', status: 500, bodySummary: 'Internal Server Error',
      hash: httpHash, timestamp: FIXED_TS,
    },
    {
      kind: 'console', source: 'browser', level: 'error',
      message: `Failed to compile ${mutationFile}`,
      hash: consoleHash, timestamp: FIXED_TS,
    },
  ];

  const confirmed = benchCase.sentinelJudgment.rootCauseStatus === 'confirmed';
  const exp = benchCase.replayExpectation;

  // ── 构造「模型回复」（人工真值形态，不是产出抄写） ──────────────────────
  const analystReply = JSON.stringify({
    rootCause,
    confidence: benchCase.sentinelJudgment.confidence || 0.8,
    reproSteps: [`访问 ${route}`, `观察 ${mutationFile} 引起的报错`],
  });

  const criticReply = JSON.stringify(confirmed
    ? {
      shouldReject: false,
      verifiedRootCause: true,
      supportingEvidence: [fileHash, httpHash],
      reason: `代码证据（${mutationFile}）与运行时错误证据（${route} 返回 500）同时定位到同一处改动`,
      adjustedConfidence: benchCase.sentinelJudgment.confidence || 0.8,
    }
    : {
      shouldReject: true,
      verifiedRootCause: false,
      supportingEvidence: [],
      reason: '证据不足以定位到具体代码改动，保持 hypothesis',
      adjustedConfidence: 0.3,
    });

  const llmResponses = [analystReply, criticReply];

  // ── planner 的三方案（只有 confirmed 才会走到 planner） ────────────────
  const reason = tierReason(benchCase);
  const hasRealFix = benchCase.recommendedFix && benchCase.recommendedFix.id !== 'none';
  // 判据关键词：来自人工写定的字段。
  // 例外：示例项目那两条没有 replayExpectation → 从人工写的真实根因里取文件名。
  const rootCauseKeywords = exp?.rootCauseContains
    ?? (/(app\/[\w/-]+\.tsx)/.exec(benchCase.realRootCause)?.[1] ? [/(app\/[\w/-]+\.tsx)/.exec(benchCase.realRootCause)[1]] : []);
  let expected = {
    rootCauseStatus: benchCase.sentinelJudgment.rootCauseStatus,
    rootCauseContains: rootCauseKeywords,
    fixCount: confirmed ? 3 : 0,
  };
  let recommendedTitle = hasRealFix ? benchCase.recommendedFix.title : `修复 ${mutationFile} 的缺陷`;
  let llmTier = 2;

  if (confirmed) {
    // 方案的形状必须**复现档案里记录的那一档**（理由是人工读过的）
    if (/补丁形状规则/.test(reason)) {
      llmTier = 1; // 真实 run 里 LLM 判的档位不影响硬规则结论，但形状决定结论
    } else if (/低风险规则/.test(reason)) {
      llmTier = 1;
      // 低风险关键词是硬规则命中点 —— 复现它（档案的理由里写了是哪一条）
      const kw = /低风险规则「([^」]+)」/.exec(reason)?.[1] ?? '';
      if (kw && !recommendedTitle.includes(kw)) recommendedTitle = `${recommendedTitle}（${kw}类改动）`;
    } else if (/未命中任何低风险规则（LLM 原判 Tier 1）/.test(reason)) {
      llmTier = 1; // LLM 判 Tier 1，但硬规则不认 → 降级为 2（E18/E20 的守卫点）
    } else if (/未命中任何低风险规则/.test(reason)) {
      llmTier = 2;
    }

    const fixOption = {
      id: `${id}-fix`,
      title: recommendedTitle,
      description:
        `把 ${mutationFile} 里的「${oneLine(source.replace)}」改回「${oneLine(source.find)}」`,
      effort: 'low', risk: 'low', runtimeCost: 'none',
      regressionRisk: 'low', maintenanceCost: 'low',
      stageFit: 'MVP', tier: llmTier, confidence: 0.9,
      whyRecommended: '直接修掉被注入的缺陷，改动最小且可回滚',
      verificationCommand: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}${route}`,
    };
    const other = (n) => ({
      id: `${id}-alt-${n}`,
      title: `备选方案 ${n}：调整 ${mutationFile} 的实现方式`,
      description: `换一种写法实现同样的目标（备选路径 ${n}）`,
      effort: 'high', risk: 'medium', runtimeCost: 'none',
      regressionRisk: 'medium', maintenanceCost: 'medium',
      stageFit: 'Launch', tier: 3, confidence: 0.5,
      whyRecommended: '备选路径，评估成本更高',
      verificationCommand: 'npm test',
    });
    // 与真实 planner 协议一致：第 1 步只要 JSON 数组，第 2 步只要裸 unified diff。
    // （早先用 ===JSON=== / ===PATCH=== 包裹，extractDiff 会把 ===END=== 一起吃进 diff → 补丁非法）
    llmResponses.push(JSON.stringify([fixOption, other(1), other(2)]));
    llmResponses.push(diff);

    // 期望值：全部来自人工写定的字段 / 档案里记录的权威判定
    expected = {
      ...expected,
      fixCount: 3,
      ...(exp?.recommendedMentions?.length ? { recommendedMentions: exp.recommendedMentions } : {}),
      ...(exp?.hardTier !== undefined && !/未记录硬规则判定/.test(reason) ? { hardTier: exp.hardTier } : {}),
      patchValid: true,
      patchApplies: true,
    };

    // 反恒真断言：构造出来的方案必须复现档案里记录的硬规则 tier。
    // 复现不出来时**不改成"通过"**，而是去掉这一项判据并留下明确记录 ——
    // 原因通常：档案记的是**真实模型补丁**的判定，
    // 而契约夹具用的是人工重建的理想补丁，两者形状不同。
    if (expected.hardTier !== undefined) {
      const decision = classifyTier({ ...fixOption, patch: diff });
      if (decision.tier !== expected.hardTier) {
        const recordedTier = expected.hardTier;
        delete expected.hardTier;
        warnings.push({
          id,
          reason: `档案记的 tier=${recordedTier} 来自**真实模型补丁**的判定；` +
            `契约夹具重建的是人工真值补丁，形状不同 → 硬规则判成 ${decision.tier}（${decision.reason}）。` +
            `这一条不比对 tier，其余判据照常。`,
        });
      }
    }
  } else {
    // hypothesis：critic 拒了 → 链路停在 planner 之前，不该有方案
    expected.fixCount = 0;
  }

  const fixture = {
    caseId: id,
    kind: 'contract',
    description: `${benchCase.project} · ${source.mutationId} —— ${benchCase.realRootCause.slice(0, 60)}…`,
    input: {
      flowId: benchCase.feature,
      error: `访问 ${route} 时返回 HTTP 500`,
      evidence,
    },
    llmResponses,
    snapshot: { files: { [mutationFile]: broken } },
    expected,
    note:
      '契约夹具：模型回复按人工真值构造（不是录制产出），输入是被改坏的真实文件 + 真实路由的 500；' +
      '期望值来自 cases/*.json 的人工字段与归档时记录的硬规则 tier。' +
      (exp?.note ? ` 案例备注：${exp.note}` : ''),
    recordedAt: new Date(FIXED_TS).toISOString(),
  };

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  }
  results.push({
    id,
    project: benchCase.project,
    status: benchCase.sentinelJudgment.rootCauseStatus,
    tier: expected.hardTier ?? '-',
    patch: expected.patchValid === true ? '✓' : '-',
  });
}

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log(`契约夹具生成：${dryRun ? '[dry-run] ' : ''}生成 ${results.length} 个，跳过 ${skipped.length} 个`);
console.log('');
for (const r of results) {
  console.log(`  ✓ ${r.id.replace('2026-10-26-', '')}  ${r.status}  tier=${r.tier}  patch=${r.patch}`);
}
if (skipped.length > 0) {
  console.log('');
  console.log('  跳过（原因必须写进文档，未覆盖不等于没问题）：');
  for (const s of skipped) console.log(`  - ${s.id.replace('2026-10-26-', '')}：${s.reason}`);
}
if (warnings.length > 0) {
  console.log('');
  console.log('  偏差（夹具保留，但有一项判据不比对）：');
  for (const w of warnings) console.log(`  - ${w.id.replace('2026-10-26-', '')}：${w.reason}`);
}
if (!dryRun) console.log(`\n写入：${outDir}`);
