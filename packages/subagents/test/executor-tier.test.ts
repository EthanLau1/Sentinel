import { describe, it, expect } from 'vitest';
import { classifyTier, isAllowedTarget, patchTargets, validPatch } from '../src/executor.js';
import type { FixOption } from '@sentinel/core';

function opt(over: Partial<FixOption> = {}): FixOption {
  return {
    id: 'fix_1',
    title: 'fix',
    description: 'change',
    effort: 'low',
    risk: 'low',
    runtimeCost: 'none',
    regressionRisk: 'low',
    maintenanceCost: 'low',
    stageFit: 'MVP',
    tier: 1,
    confidence: 0.8,
    score: 0,
    sources: [],
    ...over,
  } as FixOption;
}

describe('Tier 硬规则 — 宪法要求 Tier 不靠 LLM 给', () => {
  it('低风险特征 → Tier 1', () => {
    expect(classifyTier(opt({ title: 'format file' })).tier).toBe(1);
    expect(classifyTier(opt({ title: 'fix typo in README' })).tier).toBe(1);
    expect(classifyTier(opt({ title: '生成 app.map' })).tier).toBe(1);
    expect(classifyTier(opt({ title: '补配置项' })).tier).toBe(1);
  });

  it('高风险特征 → Tier 3（只给建议）', () => {
    expect(classifyTier(opt({ title: 'update database migration' })).tier).toBe(3);
    expect(classifyTier(opt({ title: 'change permission model' })).tier).toBe(3);
    expect(classifyTier(opt({ title: 'fix api key handling' })).tier).toBe(3);
    expect(classifyTier(opt({ title: 'refactor auth login' })).tier).toBe(3);
    expect(classifyTier(opt({ title: 'bump package-lock' })).tier).toBe(3);
  });

  it('高风险优先于低风险（同时命中时取更保守的）', () => {
    // 标题像格式问题，但 patch 里动了凭据
    const d = classifyTier(opt({ title: 'format file', patch: 'apiKey = "sk-secret"' }));
    expect(d.tier).toBe(3);
    expect(d.reason).toContain('凭据');
  });

  it('无任何特征 → 降级为 Tier 2（不自动修）', () => {
    const d = classifyTier(opt({ title: 'refactor logic', description: 'change behaviour' }));
    expect(d.tier).toBe(2);
    expect(d.reason).toContain('降级');
  });

  it('判定理由必须写清楚（不能只给 tier）', () => {
    expect(classifyTier(opt({ title: 'format file' })).reason).toContain('低风险');
    expect(classifyTier(opt({ title: 'update database migration' })).reason).toContain('数据库迁移');
  });
});

describe('自动修改白名单', () => {
  it('常见源文件类型允许', () => {
    for (const p of ['src/a.ts', 'src/a.tsx', 'app/page.tsx', 'styles.css', 'README.md', 'package.json']) {
      expect(isAllowedTarget(p).allowed, p).toBe(true);
    }
  });

  it('高风险路径一律拒绝', () => {
    for (const p of [
      '.env', '.env.local',
      'prisma/migrations/001_init.sql',
      'db/schema.prisma',
      'src/auth/session.ts',
      'package-lock.json',
      'pnpm-lock.yaml',
    ]) {
      expect(isAllowedTarget(p).allowed, p).toBe(false);
    }
  });

  it('路径穿越被拒', () => {
    expect(isAllowedTarget('../evil.ts').allowed).toBe(false);
    expect(isAllowedTarget('a/../../b.ts').allowed).toBe(false);
  });

  it('非白名单扩展名被拒', () => {
    expect(isAllowedTarget('data.bin').allowed).toBe(false);
    expect(isAllowedTarget('Makefile').allowed).toBe(false);
  });

  it('拒绝时必须给出原因', () => {
    expect(isAllowedTarget('.env').reason).toContain('禁止改动');
    expect(isAllowedTarget('x.bin').reason).toContain('白名单');
  });
});

describe('patch 解析', () => {
  const patch = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';

  it('提取被改动的文件', () => {
    expect(patchTargets(patch)).toEqual(['src/a.ts']);
  });

  it('多个文件都能提取，且去重', () => {
    const multi =
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n' +
      '--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-old\n+new\n';
    expect(patchTargets(multi)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('合法 patch 通过校验，穿越 patch 被拒', () => {
    expect(validPatch(patch)).toBe(true);
    expect(validPatch('not a diff')).toBe(false);
    expect(validPatch('--- a/../evil\n+++ b/../evil\n@@ -1 +1 @@\n-a\n+b\n')).toBe(false);
  });
});
