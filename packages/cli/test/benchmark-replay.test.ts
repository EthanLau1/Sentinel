import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replayFixture, compareReplay, type ReplayFixture } from '../src/replay.js';

/**
 * benchmark 回测 —— 可重放夹具的回归保护。
 *
 * 守住的不是模型能力（回复是录制的），而是**决策层**：
 * JSON 解析兜底、planner 两步协议、diff 规范化、Tier 硬规则。
 * 这些地方一旦改坏，报告就会"说的和做的不一致"—— 所以必须进 npm test。
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const replayDir = join(repo, 'benchmarks', 'replay');

function loadFixtures(): ReplayFixture[] {
  if (!existsSync(replayDir)) return [];
  return readdirSync(replayDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(replayDir, f), 'utf8')) as ReplayFixture);
}

describe('benchmark 回测（可重放夹具）', () => {
  it('至少要有 1 个夹具（没有夹具的话回测就是恒真判据）', () => {
    const fixtures = loadFixtures();
    expect(fixtures.length, 'benchmarks/replay/ 里没有可重放夹具 —— 回测会变成恒真判据').toBeGreaterThan(0);
  });

  it('全部夹具重放后都没有退化', async () => {
    const fixtures = loadFixtures();
    for (const f of fixtures) {
      const result = await replayFixture(f);
      expect(result.mismatches, `夹具 ${f.caseId} 退化`).toEqual([]);
      expect(result.passed).toBe(true);
    }
  }, 30000);

  it('夹具里的期望必须是人工写的关键词（不能是空数组＝恒真）', () => {
    for (const f of loadFixtures()) {
      expect(Array.isArray(f.expected.rootCauseContains), f.caseId).toBe(true);
      expect(f.expected.rootCauseContains.length, `${f.caseId} 的 rootCauseContains 不能为空`).toBeGreaterThan(0);
      expect(f.expected.fixCount, `${f.caseId} 的 fixCount 必须是 3（planner 契约）`).toBe(3);
      // 有快照就必须验「补丁能不能真应用」——validPatch 查不出 E24/E25 那类问题
      if (f.snapshot) {
        expect(f.expected.patchApplies, `${f.caseId} 有快照就必须有 patchApplies 期望`).toBe(true);
      }
    }
  });

  it('录制回复不够时必须报错（不能悄悄返回空内容）', async () => {
    const f = loadFixtures()[0]!;
    const truncated: ReplayFixture = { ...f, llmResponses: f.llmResponses.slice(0, 1) };
    const result = await replayFixture(truncated);
    expect(result.passed).toBe(false);
    expect(result.mismatches.join(' ')).toMatch(/报错|录制的模型回复不够|rootCause/);
  }, 30000);
});

describe('compareReplay —— 判据本身要能判出差异', () => {
  const base = {
    rootCauseStatus: 'confirmed',
    rootCause: 'app/posts/page.tsx 引用未定义的 postList',
    fixCount: 3,
    recommendedTitle: '将 postList.map 修正为 posts.map',
    hardTier: 1,
    patchValid: true,
    llmCallsUsed: 4,
  };

  it('一致时没有差异', () => {
    expect(compareReplay(base, {
      rootCauseStatus: 'confirmed',
      rootCauseContains: ['postList'],
      fixCount: 3,
      recommendedTitleContains: ['postList'],
      hardTier: 1,
      patchValid: true,
    })).toEqual([]);
  });

  it('根因状态变了要报出来', () => {
    const out = compareReplay({ ...base, rootCauseStatus: 'hypothesis' }, { rootCauseStatus: 'confirmed', fixCount: 3 });
    expect(out.join(' ')).toContain('根因状态');
  });

  it('关键词数组要逐项检查（不能被拼成一个字符串去 includes）', () => {
    const out = compareReplay({ ...base, recommendedTitle: '只提到 posts' }, {
      rootCauseStatus: 'confirmed',
      fixCount: 3,
      recommendedTitleContains: ['postList', 'posts'],
    });
    expect(out.join(' ')).toContain('postList');
  });

  it('tier 变了要报出来（LLM tier 换成硬规则 tier 就会命中）', () => {
    const out = compareReplay({ ...base, hardTier: 2 }, { rootCauseStatus: 'confirmed', fixCount: 3, hardTier: 1 });
    expect(out.join(' ')).toContain('硬规则 tier');
  });
});
