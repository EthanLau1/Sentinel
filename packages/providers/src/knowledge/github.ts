/**
 * GitHub KnowledgeProvider — 优先级 2。
 *
 * 用 GitHub Search API 找：
 *   - issue/PR 标题或正文匹配
 *   - 已 closed/merged 的优先（更可信）
 *
 * 不带 token 时受 rate limit 限制（每小时 60 次）。
 */

import type { KnowledgeProvider, SearchResult, SearchOptions } from '@sentinel/core';

export interface GitHubKnowledgeConfig {
  /** Optional token for higher rate limit */
  token?: string;
  /** Default 6 months */
  defaultRecencyDays?: number;
}

interface GitHubIssueResp {
  items: Array<{
    html_url: string;
    title: string;
    body?: string;
    state: 'open' | 'closed';
    created_at: string;
    pull_request?: { merged_at?: string };
  }>;
}

export function createGithubKnowledge(config: GitHubKnowledgeConfig = {}): KnowledgeProvider {
  return {
    name: 'github',
    priority: 2,

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const days = options.recencyDays ?? config.defaultRecencyDays ?? 180;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const limit = options.limit ?? 5;

      const q = `${query} in:title,body created:>${since}`;
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${limit}&sort=reactions`;

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (config.token) headers['Authorization'] = `Bearer ${config.token}`;

      try {
        const res = await fetch(url, { headers });
        if (!res.ok) return [];
        const data = (await res.json()) as GitHubIssueResp;
        return data.items.map((item) => {
          const merged = item.pull_request?.merged_at;
          const isClosed = item.state === 'closed';
          return {
            url: item.html_url,
            title: item.title,
            snippet: (item.body ?? '').slice(0, 300),
            authority: merged || isClosed ? ('community' as const) : ('unverified' as const),
            publishedAt: new Date(item.created_at).getTime(),
          };
        });
      } catch {
        return [];
      }
    },
  };
}
