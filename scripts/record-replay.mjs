#!/usr/bin/env bun
/**
 * 录制一个**可重放**的 benchmark 夹具。
 *
 * 为什么要录制：现有的 `benchmarks/cases/*.json` 是静态记录，跑一次就冻结，
 * 改坏了代码它照样"通过"—— 证明不了任何东西。
 * 回测需要的是：把真实 run 里**模型的回复**录下来，之后用录制的回复重跑决策链，
 * 比对产出。守住的不是模型能力，而是决策层（JSON 兜底 / planner 协议 / tier 硬规则）。
 *
 * 期望值（expected）**不是**从这次录制的产出里抄的 —— 那样会永远"通过"。
 * 它来自**人工确认的 benchmark 案例**：
 *   - rootCauseStatus ← 案例的 sentinelJudgment
 *   - 关键词         ← 案例的 realRootCause ∩ recommendedFix.title（人工写的两处都提到的标识符）
 *   - fixCount       ← 3（planner 的契约：必须给 3 个方案）
 *   - hardTier       ← 案例的 recommendedFix.tier（归档时取自硬规则判定）
 *   - patchValid     ← 该案例的推荐方案确实带合法 patch 并被应用过
 *
 * 用法：
 *   bun scripts/record-replay.mjs --case=2026-10-26-006-1 --run=examples/nextjs-blog/reports
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLlmConfig } from '../packages/cli/src/config.ts';
import { createOpenAICompatibleProvider, createOllamaNativeProvider } from '../packages/providers/src/index.ts';
import { replayFixture, createRecordingProvider } from '../packages/cli/src/replay.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const replayDir = join(repo, 'benchmarks', 'replay');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const caseId = arg('case');
const runDir = arg('run');
if (!caseId || !runDir) {
  console.error('用法：bun scripts/record-replay.mjs --case=<案例 id> --run=<run 产物目录>');
  process.exit(2);
}

const caseFile = join(repo, 'benchmarks', 'cases', `${caseId}.json`);
if (!existsSync(caseFile)) {
  console.error(`✗ 找不到案例：${caseFile}`);
  process.exit(2);
}
const benchCase = JSON.parse(readFileSync(caseFile, 'utf8'));

const reportJson = join(runDir, 'sentinel-latest.json');
if (!existsSync(reportJson)) {
  console.error(`✗ 找不到 run 产物：${reportJson}`);
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportJson, 'utf8'));
const bug = (report.bugs ?? []).find((b) => b.affectedFeature === benchCase.feature);
if (!bug) {
  console.error(`✗ run 产物里没有 feature=${benchCase.feature} 的 bug`);
  console.error(`   可选：${(report.bugs ?? []).map((b) => b.affectedFeature).join(', ')}`);
  process.exit(1);
}

// ── 期望值：优先用**人工写进案例**的 replayExpectation ─────────────────────
// 为什么优先用人工的：期望值一旦从"这次录制的产出"里抄，就永远是"通过" ——
// 恒真判据。人工写的关键词 + 契约值（3 个方案）才是真正的判据。
const humanExpectation = benchCase.replayExpectation ?? null;

// 自动推导的关键词 = 人工写的两处（真实根因 / 推荐方案标题）都提到的标识符
const STOP = new Set([
  'const', 'let', 'var', 'function', 'return', 'undefined', 'null', 'true', 'false',
  'this', 'that', 'with', 'and', 'the', 'for', 'from', 'has', 'was', 'are', 'but',
  'not', 'you', 'all', 'can', 'did', 'its', 'jsx', 'tsx', 'npm', 'run', 'http',
  'https', 'app', 'src', 'lib', '组件', '数组', '声明', '渲染', '调用',
]);

function identifiers(text) {
  return [...new Set((text ?? '').match(/[A-Za-z_][A-Za-z0-9_./-]{2,}/g) ?? [])]
    .filter((t) => !STOP.has(t.toLowerCase()));
}

const rootTokens = identifiers(benchCase.realRootCause);
const titleTokens = identifiers(benchCase.recommendedFix?.title);
const shared = rootTokens.filter((t) => titleTokens.includes(t));
if (!humanExpectation && shared.length === 0) {
  console.error('✗ 真实根因与推荐方案标题里找不到共同标识符 —— 无法自动生成回测期望值');
  console.error('   （也可以在案例里手写 replayExpectation）');
  console.error(`   真实根因标识符：${rootTokens.join(', ') || '(无)'}`);
  console.error(`   方案标题标识符：${titleTokens.join(', ') || '(无)'}`);
  process.exit(1);
}
const keywords = shared.slice(0, 3);

// ── 真实 provider（录制模式） ────────────────────────────────────────────────
const llmCfg = await loadLlmConfig(repo);
if (!llmCfg) {
  console.error('✗ 找不到 LLM 配置（.sentinel/llm.yml 或 ~/.sentinel/llm.yml）');
  process.exit(2);
}
const pc = llmCfg.providers[llmCfg.default];
if (!pc) {
  console.error(`✗ LLM 配置里没有默认 provider：${llmCfg.default}`);
  process.exit(2);
}
const provider = pc.type === 'openai-compatible'
  ? createOpenAICompatibleProvider({
    baseUrl: pc.baseUrl ?? '',
    apiKey: pc.apiKey ?? '',
    model: pc.model,
    ...(pc.pricing ? { pricing: pc.pricing } : {}),
  })
  : createOllamaNativeProvider({ ...(pc.baseUrl && { baseUrl: pc.baseUrl }), model: pc.model });

const recorder = createRecordingProvider(provider);

// 项目快照：取文件证据里的原文（修复前的内容）——
// 有了它，回测才能验证「补丁能不能真的应用」（E24 那种结尾少换行的错，
// validPatch 查不出来，只有真跑 git apply 才暴露）。
const fileEvidence = (bug.evidence ?? []).find((e) => e.kind === 'file' && e.path && e.snippet);
const snapshot = fileEvidence ? { files: { [fileEvidence.path]: fileEvidence.snippet } } : undefined;

const fixture = {
  caseId,
  description: `${benchCase.project} · ${benchCase.feature} —— ${benchCase.realRootCause.slice(0, 60)}…`,
  input: {
    flowId: bug.affectedFeature,
    error: bug.symptom,
    evidence: bug.evidence ?? [],
  },
  llmResponses: [],
  ...(snapshot ? { snapshot } : {}),
  expected: {
    rootCauseStatus: benchCase.sentinelJudgment.rootCauseStatus,
    rootCauseContains: humanExpectation?.rootCauseContains ?? keywords,
    fixCount: 3,
    recommendedTitleContains: humanExpectation?.recommendedTitleContains ?? keywords,
    hardTier: humanExpectation?.hardTier ?? benchCase.recommendedFix?.tier,
    patchValid: humanExpectation?.patchValid ?? true,
    ...(snapshot ? { patchApplies: true } : {}),
  },
  recordedAt: new Date().toISOString(),
};

console.log(`▶ 录制中（${benchCase.project} / ${bug.affectedFeature}）…`);
const result = await replayFixture(fixture, { provider: recorder.provider });
fixture.llmResponses = recorder.responses;

if (recorder.responses.length === 0) {
  console.error('✗ 一次模型回复都没录到 —— 说明链路没跑起来，检查 run 产物与配置');
  process.exit(1);
}

mkdirSync(replayDir, { recursive: true });
const outFile = join(replayDir, `${caseId}.json`);
writeFileSync(outFile, JSON.stringify(fixture, null, 2) + '\n', 'utf8');

console.log(`✓ 已写入夹具：${outFile}`);
console.log(`   录到 ${recorder.responses.length} 条模型回复，实际用掉 ${result.actual.llmCallsUsed} 次`);
console.log(`   期望关键词（根因）：${fixture.expected.rootCauseContains.join(' / ')}`);
console.log(`   期望关键词（方案）：${fixture.expected.recommendedTitleContains.join(' / ')}`);
console.log(`   期望来源：${humanExpectation ? '案例里人工写的 replayExpectation' : '自动推导（建议人工确认后写进案例）'}`);
console.log(`   硬规则 tier 期望 ${fixture.expected.hardTier}，实际 ${result.actual.hardTier}`);
console.log(`   patch 合法：实际 ${result.actual.patchValid}`);
if (result.mismatches.length) {
  console.log('');
  console.log('⚠ 录制结果与人工确认的期望不一致（不阻断，但必须先弄清楚）：');
  for (const m of result.mismatches) console.log(`   - ${m}`);
  process.exit(1);
}
console.log('   ✓ 录制产出与人工确认的期望一致');
