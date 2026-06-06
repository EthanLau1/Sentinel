/**
 * StackOverflow KnowledgeProvider — 优先级 3。
 *
 * 用 StackExchange API 找已采纳答案。
 */

import type { KnowledgeProvider, SearchResult, SearchOptions } from '@sentinel/core';

interface SoResp {
  items: Array<{
    title: string;
    link: string;
    score: number;
    is_answered: boolean;
    creation_date: number;
    excerpt?: string;
  }>;
}

export function createStackOverflowKnowledge(): KnowledgeProvider {
  return {
    name: 'stackoverflow',
    priority: 3,

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
      const limit = options.limit ?? 5;
      const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&accepted=True&site=stackoverflow&pagesize=${limit}`;
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = (await res.json()) as SoResp;
        return data.items.map((item) => ({
          url: item.link,
          title: item.title,
          snippet: item.excerpt ?? '',
          authority: item.is_answered ? ('community' as const) : ('unverified' as const),
          publishedAt: item.creation_date * 1000,
        }));
      } catch {
        return [];
      }
    },
  };
}
