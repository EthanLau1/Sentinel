import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replayFixture, compareReplay, type ReplayFixture } from '../src/replay.js';

/**
 * benchmark 回测 —— 可重放夹具的回归保护。
 *
 * 守住的不是模型能力（回复是录制的或按人工真值构造的），而是**决策层**：
 * JSON 解析兜底、planner 两步协议、diff 规范化、Tier 硬规则、补丁能不能真应用。
 * 这些地方一旦改坏，报告就会"说的和做的不一致"—— 所以必须进 npm test。
 *
 * 两类夹具：
 *   - benchmarks/replay/*.json          录制夹具（真录的模型回复）
 *   - benchmarks/replay/contract/*.json 契约夹具（按人工真值构造的模型回复 + 真实被改坏的文件）
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const replayDir = join(repo, 'benchmarks', 'replay');
const contractDir = join(replayDir, 'contract');

function loadFixtures(): ReplayFixture[] {
  if (!existsSync(replayDir)) return [];
  const recorded = readdirSync(replayDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(replayDir, f), 'utf8')) as ReplayFixture);
  const contract = existsSync(contractDir)
    ? readdirSync(contractDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(contractDir, f), 'utf8')) as ReplayFixture)
    : [];
  return [...recorded, ...contract];
}

describe('benchmark 回测（可重放夹具）', () => {
  it('至少要有 1 个夹具（没有夹具的话回测就是恒真判据）', () => {
    const fixtures = loadFixtures();
    expect(fixtures.length, 'benchmarks/replay/ 里没有可重放夹具 —— 回测会变成恒真判据').toBeGreaterThan(0);
  });

  it('契约夹具必须覆盖到大部分历史案例（1 个夹具等于没回测）', () => {
    const casesDir = join(repo, 'benchmarks', 'cases');
    const caseCount = readdirSync(casesDir).filter((f) => f.endsWith('.json')).length;
    const covered = new Set(loadFixtures().map((f) => f.caseId));
    // 自反 3 条 + 漏检 1 条不可回放（原因写在方案 §13.12）→ 覆盖度下限 85%
    expect(
      covered.size / caseCount,
      `只有 ${covered.size}/${caseCount} 个案例有夹具 —— 回测覆盖面太小`,
    ).toBeGreaterThan(0.85);
  });

  it('全部夹具重放后都没有退化', async () => {
    const fixtures = loadFixtures();
    for (const f of fixtures) {
      const result = await replayFixture(f);
      expect(result.mismatches, `夹具 ${f.caseId} 退化`).toEqual([]);
      expect(result.passed).toBe(true);
    }
  }, 60000);

  it('夹具里的期望必须是人工写的判据（不能是空数组＝恒真）', () => {
    for (const f of loadFixtures()) {
      const confirmed = f.expected.rootCauseStatus === 'confirmed';
      expect(Array.isArray(f.expected.rootCauseContains), f.caseId).toBe(true);
      expect(f.expected.rootCauseContains.length, `${f.caseId} 的 rootCauseContains 不能为空`).toBeGreaterThan(0);
      // planner 契约：confirmed 必须给 3 个方案；hypothesis 停在 planner 之前 → 0 个
      expect(f.expected.fixCount, `${f.caseId} 的 fixCount 必须与根因状态一致`).toBe(confirmed ? 3 : 0);
      // 有快照就必须验「补丁能不能真应用」——validPatch 查不出 E24/E25 那类问题
      if (confirmed && f.snapshot) {
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
    recommendedDescription: '把 app/posts/page.tsx 里的 postList.map 改成 posts.map',
    hardTier: 1,
    patchValid: true,
    llmCallsUsed: 4,
  };

  it('一致时没有差异', () => {
    expect(compareReplay(base, {
      rootCauseStatus: 'confirmed',
      rootCauseContains: ['postList'],
      fixCount: 3,
      recommendedMentions: ['postList'],
      hardTier: 1,
      patchValid: true,
    })).toEqual([]);
  });

  it('根因状态变了要报出来', () => {
    const out = compareReplay({ ...base, rootCauseStatus: 'hypothesis' }, { rootCauseStatus: 'confirmed', fixCount: 3 });
    expect(out.join(' ')).toContain('根因状态');
  });

  it('关键词是同一组真值标识符的不同写法 → 任一命中即可（与归档判定同口径）', () => {
    const out = compareReplay({ ...base, rootCause: 'app/posts/page.tsx 里 posts.map 写错了' }, {
      rootCauseStatus: 'confirmed',
      rootCauseContains: ['postList', 'posts'],
      fixCount: 3,
    });
    expect(out).toEqual([]);
  });

  it('一个关键词都没命中要报出来', () => {
    const out = compareReplay({ ...base, rootCause: '与本缺陷无关的根因描述' }, {
      rootCauseStatus: 'confirmed',
      rootCauseContains: ['postList', 'posts'],
      fixCount: 3,
    });
    expect(out.join(' ')).toContain('真值关键词');
  });

  it('方案要点名的关键词一个都没出现要报出来', () => {
    const out = compareReplay({ ...base, recommendedTitle: '快速修复（绕过/补丁）', recommendedDescription: '' }, {
      rootCauseStatus: 'confirmed',
      fixCount: 3,
      recommendedMentions: ['postList'],
    });
    expect(out.join(' ')).toContain('真值关键词');
  });

  it('tier 变了要报出来（LLM tier 换成硬规则 tier 就会命中）', () => {
    const out = compareReplay({ ...base, hardTier: 2 }, { rootCauseStatus: 'confirmed', fixCount: 3, hardTier: 1 });
    expect(out.join(' ')).toContain('硬规则 tier');
  });
});
