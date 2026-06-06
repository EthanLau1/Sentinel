/**
 * 官方文档 KnowledgeProvider — 优先级 1（最高权威）。
 *
 * 策略：根据 query 中检测到的库名，去对应官方域查文档。
 * 简化实现：复用通用 web search 接口，限定 domain。
 */

import type { KnowledgeProvider, SearchResult, SearchOptions } from '@sentinel/core';

export interface DocsKnowledgeConfig {
  /** 官方域映射 */
  officialDomains?: Record<string, string>;
  /** 通用 web 搜索回调 */
  search: (query: string, options?: { site?: string; limit?: number }) => Promise<SearchResult[]>;
}

const DEFAULT_OFFICIAL_DOMAINS: Record<string, string> = {
  'next.js': 'nextjs.org',
  next: 'nextjs.org',
  react: 'react.dev',
  vue: 'vuejs.org',
  svelte: 'svelte.dev',
  prisma: 'prisma.io',
  drizzle: 'orm.drizzle.team',
  supabase: 'supabase.com',
  hono: 'hono.dev',
  trpc: 'trpc.io',
  vercel: 'vercel.com',
  bun: 'bun.sh',
};

export function createDocsKnowledge(config: DocsKnowledgeConfig): KnowledgeProvider {
  const domains = { ...DEFAULT_OFFICIAL_DOMAINS, ...(config.officialDomains ?? {}) };

  function detectDomain(query: string): string | undefined {
    const lower = query.toLowerCase();
    for (const [keyword, domain] of Object.entries(domains)) {
      if (lower.includes(keyword)) return domain;
    }
    return undefined;
  }

  return {
    name: 'docs',
    priority: 1, // 最高

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const site = detectDomain(query);
      const params: { site?: string; limit?: number } = {};
      if (site) params.site = site;
      if (options.limit !== undefined) params.limit = options.limit;
      const results = await config.search(query, params);
      return results.map((r) => ({ ...r, authority: 'official' as const }));
    },
  };
}
