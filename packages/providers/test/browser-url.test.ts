import { describe, it, expect } from 'vitest';
import { urlMatches } from '../src/mcp/built-in/browser.js';

/**
 * E31：URL 断言不能精确比较。
 *
 * 事故（tailwind-nextjs-starter-blog，trailingSlash: true）：
 * 期望 /about，实际 http://127.0.0.1:3104/about/ → 断言失败 →
 * 修复后重跑被判失败 → **正确的 Tier 1 修复被回滚**，改动等于没做。
 */
describe('E31 — URL 断言的尾斜杠容错', () => {
  it('尾斜杠规范化后应视为匹配', () => {
    expect(urlMatches('http://127.0.0.1:3104/about/', '/about')).toBe(true);
    expect(urlMatches('http://127.0.0.1:3104/about', '/about')).toBe(true);
    expect(urlMatches('http://127.0.0.1:3104/about/', '/about/')).toBe(true);
  });

  it('根路径不受尾斜杠规则影响', () => {
    expect(urlMatches('http://127.0.0.1:3104/', '/')).toBe(true);
  });

  it('路径不同必须判不匹配（不能放宽成"差不多就行"）', () => {
    expect(urlMatches('http://127.0.0.1:3104/about/', '/blog')).toBe(false);
    expect(urlMatches('http://127.0.0.1:3104/posts/1/', '/posts')).toBe(false);
  });

  it('期望带 query 时要精确比对 query', () => {
    expect(urlMatches('http://127.0.0.1:3104/list?page=2', '/list?page=2')).toBe(true);
    expect(urlMatches('http://127.0.0.1:3104/list?page=3', '/list?page=2')).toBe(false);
  });

  it('期望没带 query 时，不因实际多了参数而判失败', () => {
    expect(urlMatches('http://127.0.0.1:3104/about/?ref=nav', '/about')).toBe(true);
  });

  it('绝对 URL 的期望仍按精确比较', () => {
    expect(urlMatches('http://127.0.0.1:3104/about', 'http://127.0.0.1:3104/about')).toBe(true);
    expect(urlMatches('http://127.0.0.1:3104/about', 'http://127.0.0.1:3104/about/')).toBe(false);
  });
});
