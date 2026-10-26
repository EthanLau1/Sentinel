#!/usr/bin/env bun
/**
 * 回测：把 benchmarks/replay/ 里的夹具全部重跑一遍，确认**没有退化**。
 *
 * 方案 §7 要求「在 benchmark/ 重跑全部历史 case 确认未退化」。
 * 静态案例（benchmarks/cases/）跑一次就冻结，证明不了什么；
 * 可重放夹具（benchmarks/replay/）用**录制的模型回复**重跑决策链，
 * 任何解析/协议/硬规则的改动导致产出变化，都会在这里暴露。
 *
 * 用法：bun scripts/replay-benchmarks.mjs
 * 退出码：0 全部通过 / 1 有夹具退化 / 2 目录里没有夹具
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replayFixture } from '../packages/cli/src/replay.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const replayDir = join(repo, 'benchmarks', 'replay');
const contractDir = join(replayDir, 'contract');

if (!existsSync(replayDir)) {
  console.log('⏸ 还没有可重放夹具（benchmarks/replay/ 不存在）');
  console.log('   录制：bun scripts/record-replay.mjs --case=<案例 id> --run=<run 产物目录>');
  process.exit(2);
}

// 两类夹具，分开统计（它们守的不是同一件事）：
//   - 录制夹具（benchmarks/replay/*.json）：模型回复是**真录的** → 守"模型输出形态"这条路
//   - 契约夹具（benchmarks/replay/contract/*.json）：模型回复按人工真值构造 → 守"决策层"这条路
const recorded = readdirSync(replayDir).filter((f) => f.endsWith('.json')).sort();
const contract = existsSync(contractDir)
  ? readdirSync(contractDir).filter((f) => f.endsWith('.json')).sort()
  : [];

if (recorded.length === 0 && contract.length === 0) {
  console.log('⏸ 还没有可重放夹具（benchmarks/replay/ 是空的）');
  console.log('   录制：bun scripts/record-replay.mjs --case=<案例 id> --run=<run 产物目录>');
  console.log('   契约：bun scripts/build-contract-fixtures.mjs');
  process.exit(2);
}

console.log('Sentinel benchmark 回测（可重放夹具）');
console.log('');

let failed = 0;
const runGroup = async (label, files, dir) => {
  if (files.length === 0) return;
  console.log(`【${label}】${files.length} 个`);
  for (const f of files) {
    const fixture = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const result = await replayFixture(fixture);
    if (result.passed) {
      console.log(`  ✓ ${fixture.caseId}  根因 ${result.actual.rootCauseStatus} · ${result.actual.fixCount} 个方案 · 硬规则 tier ${result.actual.hardTier}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${fixture.caseId}  退化：`);
      for (const m of result.mismatches) console.log(`      - ${m}`);
    }
  }
  console.log('');
};

await runGroup('录制夹具（真录的模型回复）', recorded, replayDir);
await runGroup('契约夹具（人工真值构造的回复）', contract, contractDir);

const total = recorded.length + contract.length;
console.log(`  夹具 ${total} 个，通过 ${total - failed} 个，退化 ${failed} 个`);
if (failed > 0) {
  console.log('');
  console.log('  ❌ 有夹具退化 —— 说明本次改动改变了决策层的产出，需要人工判断是不是预期改动。');
  process.exit(1);
}
console.log('  ✅ 未退化');
