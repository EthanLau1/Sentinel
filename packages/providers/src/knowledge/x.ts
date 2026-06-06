/**
 * X.com KnowledgeProvider — 优先级 4（M6.2，默认关闭）。
 *
 * 仅留接口。M6.2 阶段：用户配置 API key 后启用。
 * 适合"最新实践 / 维护者口径 / 迁移提醒"。
 */

import type { KnowledgeProvider, SearchResult, SearchOptions } from '@sentinel/core';

export interface XKnowledgeConfig {
  apiKey?: string;
  enabled?: boolean;
}

export function createXKnowledge(config: XKnowledgeConfig = {}): KnowledgeProvider {
  const enabled = config.enabled === true && Boolean(config.apiKey);

  return {
    name: 'x',
    priority: 4,

    async search(_query: string, _options: SearchOptions = {}): Promise<SearchResult[]> {
      if (!enabled) return [];
      // M6.2 完整实现：调用 X API v2 Recent Search
      // 当前阶段保留接口，避免 PR 中误开。
      return [];
    },
  };
}
