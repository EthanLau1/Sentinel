import { describe, it, expect } from 'vitest';
import { normalizePatch, stripThinkResidue, ensureTrailingNewline } from '../src/diff.js';
import { validPatch } from '../src/executor.js';
import { extractDiff } from '../src/planner.js';

/**
 * E23 —— LLM 产的 diff 格式不精确，导致产物彻底落不了盘。
 * 这里用**真实 run15 的原始输出**当回归样本。
 */

/**
 * run15 真实拿到的 patch（原样保留模型输出，含两处格式问题）：
 *   ① `<think>` 推理块里先写了一遍示例 diff，残渣混在前面
 *   ② hunk 头声明 7 行，实际只给了 5 行
 */
const REAL_RUN15_PATCH =
  '<think>We need answer only JSON array exactly 3 objects. Need propose three fixes.\n' +
  '--- a/app/posts/page.tsx\n' +
  '+++ b/app/posts/page.tsx\n' +
  '@@ -9,7 +9,7 @@\n' +
  '      <h1>Posts</h1>\n' +
  '      <ul>\n' +
  '-        {postList.map((p) => (\n' +
  '+        {posts.map((p) => (\n' +
  '...\n' +
  'Could include context. Need only diff. Ensure no explanation.</think>\n' +
  '\n' +
  '--- a/app/posts/page.tsx\n' +
  '+++ b/app/posts/page.tsx\n' +
  '@@ -9,7 +9,7 @@\n' +
  '      <h1>Posts</h1>\n' +
  '      <ul>\n' +
  '-        {postList.map((p) => (\n' +
  '+        {posts.map((p) => (\n' +
  '          <li key={p.id}>{p.title}</li>\n' +
  '        ))}\n' +
  '      </ul>';

describe('E23 — think 残渣不能混进 diff', () => {
  it('stripThinkResidue 去掉闭合与未闭合的 think 块', () => {
    expect(stripThinkResidue('<think>abc</think>diff')).toBe('diff');
    expect(stripThinkResidue('<think>abc')).toBe('');
  });

  it('extractDiff 剥掉 think 残渣后再截 diff', () => {
    const d = extractDiff(REAL_RUN15_PATCH);
    expect(d).toBeDefined();
    expect(d).not.toContain('Could include context');
    expect(d).not.toContain('</think>');
    expect(d!.startsWith('--- a/app/posts/page.tsx')).toBe(true);
  });
});

describe('E23 — hunk 头的行数必须按实际内容重算', () => {
  it('计数不准的 hunk 被修正', () => {
    const bad = '--- a/x.ts\n+++ b/x.ts\n@@ -1,7 +1,7 @@\n keep\n-old\n+new\n';
    const { patch, changed } = normalizePatch(bad);
    expect(changed).toBe(true);
    expect(patch).toContain('@@ -1,2 +1,2 @@');
    expect(validPatch(patch)).toBe(true);
  });

  it('本来正确的 diff 不被改动', () => {
    const good = '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n';
    const { patch, changed } = normalizePatch(good);
    expect(changed).toBe(false);
    expect(patch).toBe(good);
  });

  it('缺结尾换行的 patch 被补上（E24：git apply 会报 corrupt patch）', () => {
    const noNewline = '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new';
    const { patch, changed } = normalizePatch(noNewline);
    expect(changed).toBe(true);
    expect(patch.endsWith('\n')).toBe(true);
    expect(patch).toBe(noNewline + '\n');
  });

  it('ensureTrailingNewline 只在缺的时候补', () => {
    expect(ensureTrailingNewline('a')).toBe('a\n');
    expect(ensureTrailingNewline('a\n')).toBe('a\n');
  });

  it('尾部换行不算成上下文行（否则计数凭空 +1）', () => {
    const withNewline = '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n';
    const { patch } = normalizePatch(withNewline);
    expect(patch).toContain('@@ -1,2 +1,2 @@');
    expect(validPatch(patch)).toBe(true);
  });

  it('空上下文行补上前导空格', () => {
    const withBlank = '--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n keep\n\n-old\n+new\n';
    const { patch } = normalizePatch(withBlank);
    expect(patch).toContain('@@ -1,3 +1,3 @@');
    expect(validPatch(patch)).toBe(true);
  });
});

describe('E23 — 真实 run15 的 patch 修复后可用', () => {
  it('规范化后 validPatch 通过', () => {
    const d = extractDiff(REAL_RUN15_PATCH)!;
    expect(validPatch(d)).toBe(true);
  });

  it('规范化后仍是纯重命名 → 硬规则判 Tier 1（这是判据「Tier 1 真实改码」的前提）', () => {
    const d = extractDiff(REAL_RUN15_PATCH)!;
    expect(d).toContain('--- a/app/posts/page.tsx');
    expect(d).toContain('+        {posts.map((p) => (');
  });
});
