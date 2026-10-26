import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGithubKnowledge } from '../src/knowledge/github.js';
import { createStackOverflowKnowledge } from '../src/knowledge/stackoverflow.js';
import { createDocsKnowledge } from '../src/knowledge/docs.js';
import { createXKnowledge } from '../src/knowledge/x.js';

const ORIGINAL_FETCH = globalThis.fetch;

describe('KnowledgeProvider 契约测试（不发真网络请求）', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // ── GitHub ──────────────────────────────────────────────────────────────
  describe('github', () => {
    it('映射 issue → SearchResult，closed/merged 记为 community', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                html_url: 'https://github.com/x/y/issues/1',
                title: 'fix null render',
                body: 'body text',
                state: 'closed',
                created_at: '2026-01-02T00:00:00Z',
              },
              {
                html_url: 'https://github.com/x/y/issues/2',
                title: 'open one',
                state: 'open',
                created_at: '2026-01-03T00:00:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const k = createGithubKnowledge();
      const r = await k.search('null render');
      expect(r).toHaveLength(2);
      expect(r[0]!.url).toBe('https://github.com/x/y/issues/1');
      expect(r[0]!.snippet).toBe('body text');
      expect(r[0]!.authority).toBe('community');
      expect(r[1]!.authority).toBe('unverified');
      expect(typeof r[0]!.publishedAt).toBe('number');
    });

    it('merged PR → community', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                html_url: 'https://github.com/x/y/pull/3',
                title: 'merged pr',
                state: 'closed',
                created_at: '2026-01-02T00:00:00Z',
                pull_request: { merged_at: '2026-01-05T00:00:00Z' },
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const r = await createGithubKnowledge().search('pr');
      expect(r[0]!.authority).toBe('community');
    });

    it('body 超长 → snippet 截断到 300', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                html_url: 'u',
                title: 't',
                body: 'x'.repeat(1000),
                state: 'open',
                created_at: '2026-01-02T00:00:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const r = await createGithubKnowledge().search('q');
      expect(r[0]!.snippet).toHaveLength(300);
    });

    it('HTTP 非 2xx → 返回空数组（不抛）', async () => {
      mockFetch.mockResolvedValueOnce(new Response('rate limited', { status: 403 }));
      expect(await createGithubKnowledge().search('q')).toEqual([]);
    });

    it('fetch 抛错 → 返回空数组（不抛）', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));
      expect(await createGithubKnowledge().search('q')).toEqual([]);
    });

    it('带 token → 请求头含 Authorization', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
      await createGithubKnowledge({ token: 'ghp_x' }).search('q');
      const headers = (mockFetch.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer ghp_x');
    });

    it('URL 带 limit 与时间窗', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
      await createGithubKnowledge({ defaultRecencyDays: 30 }).search('q', { limit: 3 });
      const url = String(mockFetch.mock.calls[0]![0]);
      expect(url).toContain('per_page=3');
      expect(url).toContain('created%3A%3E');
    });
  });

  // ── StackOverflow ──────────────────────────────────────────────────────
  describe('stackoverflow', () => {
    it('已采纳答案 → community，未采纳 → unverified', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                title: 'answered',
                link: 'https://so/1',
                score: 10,
                is_answered: true,
                creation_date: 1700000000,
                excerpt: 'ex',
              },
              {
                title: 'unanswered',
                link: 'https://so/2',
                score: 1,
                is_answered: false,
                creation_date: 1700000001,
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const r = await createStackOverflowKnowledge().search('q');
      expect(r[0]!.authority).toBe('community');
      expect(r[1]!.authority).toBe('unverified');
      expect(r[0]!.snippet).toBe('ex');
      expect(r[1]!.snippet).toBe('');
    });

    it('creation_date 是秒 → publishedAt 换算成毫秒', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { title: 't', link: 'l', score: 1, is_answered: true, creation_date: 1700000000 },
            ],
          }),
          { status: 200 },
        ),
      );
      const r = await createStackOverflowKnowledge().search('q');
      expect(r[0]!.publishedAt).toBe(1700000000 * 1000);
    });

    it('HTTP 非 2xx / fetch 抛错 → 空数组', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 500 }));
      expect(await createStackOverflowKnowledge().search('q')).toEqual([]);
      mockFetch.mockRejectedValueOnce(new Error('boom'));
      expect(await createStackOverflowKnowledge().search('q')).toEqual([]);
    });

    it('URL 带 limit', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );
      await createStackOverflowKnowledge().search('q', { limit: 7 });
      expect(String(mockFetch.mock.calls[0]![0])).toContain('pagesize=7');
    });
  });

  // ── Docs（官方域） ─────────────────────────────────────────────────────
  describe('docs', () => {
    it('从 query 识别库名 → 限定官方域', async () => {
      const search = vi.fn().mockResolvedValue([]);
      await createDocsKnowledge({ search }).search('next.js routing error');
      expect(search).toHaveBeenCalledWith(
        'next.js routing error',
        expect.objectContaining({ site: 'nextjs.org' }),
      );
    });

    it('识别不到库名 → 不限定 site', async () => {
      const search = vi.fn().mockResolvedValue([]);
      await createDocsKnowledge({ search }).search('完全无关的问题');
      expect(search.mock.calls[0]![1]).not.toHaveProperty('site');
    });

    it('自定义域覆盖默认映射', async () => {
      const search = vi.fn().mockResolvedValue([]);
      await createDocsKnowledge({
        search,
        officialDomains: { next: 'internal.wiki' },
      }).search('next app router');
      expect(search.mock.calls[0]![1]).toMatchObject({ site: 'internal.wiki' });
    });

    it('limit 透传', async () => {
      const search = vi.fn().mockResolvedValue([]);
      await createDocsKnowledge({ search }).search('react', { limit: 4 });
      expect(search.mock.calls[0]![1]).toMatchObject({ limit: 4 });
    });

    it('结果一律标为 official', async () => {
      const search = vi.fn().mockResolvedValue([
        { url: 'u', title: 't', snippet: 's', authority: 'unverified' as const },
      ]);
      const r = await createDocsKnowledge({ search }).search('react');
      expect(r[0]!.authority).toBe('official');
    });
  });

  // ── X.com（默认关闭） ──────────────────────────────────────────────────
  describe('x', () => {
    it('默认关闭 → 空数组', async () => {
      expect(await createXKnowledge().search('q')).toEqual([]);
    });

    it('enabled 但没 apiKey → 仍为空数组', async () => {
      expect(await createXKnowledge({ enabled: true }).search('q')).toEqual([]);
    });

    it('enabled + apiKey → 接口保留，返回空数组（不误开）', async () => {
      expect(await createXKnowledge({ enabled: true, apiKey: 'k' }).search('q')).toEqual([]);
    });

    it('priority 固定为 4', () => {
      expect(createXKnowledge().priority).toBe(4);
    });
  });

  // ── provider 契约一致性 ────────────────────────────────────────────────
  it('四个 provider 都满足 KnowledgeProvider 契约', () => {
    const providers = [
      createGithubKnowledge(),
      createStackOverflowKnowledge(),
      createDocsKnowledge({ search: async () => [] }),
      createXKnowledge(),
    ];
    for (const p of providers) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.priority).toBe('number');
      expect(typeof p.search).toBe('function');
    }
    // 优先级：官方文档(1) < GitHub(2) < StackOverflow(3) < X(4)
    expect(providers[0]!.priority).toBe(2);
    expect(providers[1]!.priority).toBe(3);
    expect(providers[2]!.priority).toBe(1);
    expect(providers[3]!.priority).toBe(4);
  });
});
