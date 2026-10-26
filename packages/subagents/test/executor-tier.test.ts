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

  it('离线模式：理由不能说"LLM 原判"—— 方案来自模板，没有模型参与', () => {
    const d = classifyTier(opt({ tier: 1, title: 'refactor logic' }), { offline: true });
    expect(d.tier).toBe(2);
    expect(d.reason).toContain('方案模板 原判');
    expect(d.reason).not.toContain('LLM');
  });
});

describe('E20 — 硬规则不得放宽 LLM 的「仅建议」判定', () => {
  it('LLM 判 Tier 3 → 硬规则保持 Tier 3（哪怕命中低风险关键词）', () => {
    const d = classifyTier(opt({ tier: 3, title: 'format file' }));
    expect(d.tier).toBe(3);
    expect(d.reason).toContain('不放宽');
  });

  it('LLM 判 Tier 3 + 未命中任何规则 → 仍然是 Tier 3', () => {
    const d = classifyTier(opt({ tier: 3, title: '调整重定向策略' }));
    expect(d.tier).toBe(3);
  });

  it('LLM 判 Tier 3 的方案不会被写成待审 patch', () => {
    // Tier 3 = 仅建议，不能降级成"写个 patch 等人看"
    expect(classifyTier(opt({ tier: 3, title: '调整重定向策略' })).tier).toBeGreaterThanOrEqual(3);
  });
});

describe('E21 — 硬风险规则要认中文描述', () => {
  it('中文「数据库迁移」→ Tier 3', () => {
    expect(classifyTier(opt({ title: '重构数据库迁移脚本' })).tier).toBe(3);
  });
  it('中文「权限校验」→ Tier 3', () => {
    expect(classifyTier(opt({ title: '调整权限校验逻辑' })).tier).toBe(3);
  });
  it('中文「密钥」→ Tier 3', () => {
    expect(classifyTier(opt({ description: '把密钥写进配置文件' })).tier).toBe(3);
  });
});

describe('E19 — 判定理由的措辞必须与事实一致', () => {
  it('LLM 本来就判 Tier 2 → 理由不能写「降级」', () => {
    const d = classifyTier(opt({ tier: 2, title: '调整重定向策略' }));
    expect(d.tier).toBe(2);
    expect(d.reason).not.toContain('降级');
  });

  it('LLM 判 Tier 1 但未命中低风险 → 理由写「降级」', () => {
    const d = classifyTier(opt({ tier: 1, title: '调整重定向策略' }));
    expect(d.reason).toContain('降级');
  });
});

describe('E18 — 补丁形状判定（纯标识符重命名 = 低风险）', () => {
  const RENAME = `--- a/app/posts/page.tsx
+++ b/app/posts/page.tsx
@@ -9,7 +9,7 @@
     <main>
       <h1>Posts</h1>
       <ul>
-        {postList.map((p) => (
+        {posts.map((p) => (
           <li key={p.id}>{p.title}</li>
         ))}
       </ul>
`;

  it('单文件单 hunk 只改标识符 → 判 Tier 1（中文描述不会说「拼写」，关键词法必然漏判）', () => {
    const d = classifyTier(opt({ tier: 1, title: '在 app/posts/page.tsx 中改用 posts.map 渲染', patch: RENAME }));
    expect(d.tier).toBe(1);
    expect(d.reason).toContain('补丁形状');
  });

  it('改动语义（新增组件）→ 不是 Tier 1', () => {
    const add = `--- a/app/page.tsx
+++ b/app/page.tsx
@@ -1,3 +1,7 @@
 export default function Page() {
-  return null;
+  return (
+    <main>
+      <h1>Home</h1>
+    </main>
+  );
 }
`;
    expect(classifyTier(opt({ tier: 1, title: '渲染首页', patch: add })).tier).toBe(2);
  });

  it('改的是字面量而非名字（null → undefined）→ 不是重命名', () => {
    const lit = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-return null;
+return undefined;
`;
    expect(classifyTier(opt({ tier: 1, title: '改默认值', patch: lit })).tier).toBe(2);
  });

  it('多文件 patch → 不是重命名（改太多）', () => {
    const multi = RENAME +
      `--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new
`;
    expect(classifyTier(opt({ tier: 1, title: '顺手改两处', patch: multi })).tier).toBe(2);
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
