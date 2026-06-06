/**
 * Enhancer subagent — 知识增强（M6）。
 *
 * 接收 fix.proposed → 按需触发外部知识搜索 → 输出 fix.enhanced
 *
 * 触发规则（CONFIG-SPEC.md）：
 *   - confidence < 0.7
 *   - 涉及第三方 SDK
 *   - 涉及最近版本 bump
 *   - 涉及安全
 *   - 本地未匹配
 *
 * 多源规则（v1.1）：
 *   - 默认: 1 个权威源足够
 *   - 争议/迁移: 1 权威 + 最多 2 佐证
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  Subagent,
  KernelContext,
  FixOption,
  KnowledgeSource,
  KnowledgeProvider,
  SearchResult,
} from '@sentinel/core';

export interface EnhancerConfig {
  /** 缓存目录（默认 .sentinel/cache/knowledge） */
  cacheDir?: string;
  /** 缓存 TTL（小时） */
  cacheTtlHours?: number;
  /** 强制启用：每次 bug 都搜（默认 false） */
  alwaysSearch?: boolean;
  /** 启用 X.com（默认 false） */
  enableX?: boolean;
}

export function createEnhancer(config: EnhancerConfig = {}): Subagent {
  const cacheDir = config.cacheDir ?? '.sentinel/cache/knowledge';
  const ttlMs = (config.cacheTtlHours ?? 48) * 60 * 60 * 1000;

  return {
    name: 'enhancer',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<{ bug: import('@sentinel/core').BugFinding; options: FixOption[] }>('fix.proposed', async (event) => {
        const { bug, options } = event.payload;

        // 决定是否搜
        const shouldSearch = decideSearch(options, config.alwaysSearch ?? false);
        if (!shouldSearch) {
          await ctx.bus.publish({
            type: 'fix.enhanced',
            payload: { bug, options },
            source: 'enhancer',
            traceId: event.traceId,
          });
          return;
        }

        // 用 option 标题做查询
        const query = buildQuery(options);
        const results = await searchAll(ctx, query, cacheDir, ttlMs);

        // 给每个 option 附加 sources（取 top 3）
        const sorted = results
          .filter((r) => !!r)
          .sort((a, b) => priorityWeight(a.authority) - priorityWeight(b.authority));
        const top = sorted.slice(0, 3);

        const enhanced = options.map((o, i) => ({
          ...o,
          sources: i === 0 ? top.map(toKnowledgeSource) : [],
        }));

        await ctx.bus.publish({
          type: 'fix.enhanced',
          payload: { bug: { ...bug, fixOptions: enhanced }, options: enhanced },
          source: 'enhancer',
          traceId: event.traceId,
        });
      });
    },
  };
}

function decideSearch(options: FixOption[], alwaysSearch: boolean): boolean {
  if (alwaysSearch) return true;
  if (options.length === 0) return false;
  // 平均置信度 < 0.7 → 搜
  const avg = options.reduce((a, b) => a + b.confidence, 0) / options.length;
  return avg < 0.7;
}

function buildQuery(options: FixOption[]): string {
  return options[0]?.title ?? options[0]?.description ?? '';
}

function priorityWeight(a: 'official' | 'community' | 'unverified'): number {
  if (a === 'official') return 1;
  if (a === 'community') return 2;
  return 3;
}

function toKnowledgeSource(r: SearchResult): KnowledgeSource {
  const recency = recencyOf(r.publishedAt);
  return {
    url: r.url,
    authority: r.authority,
    recency,
    type: detectType(r.url),
  };
}

function recencyOf(publishedAt?: number): 'fresh' | 'recent' | 'aged' {
  if (!publishedAt) return 'aged';
  const days = (Date.now() - publishedAt) / 1000 / 60 / 60 / 24;
  if (days <= 90) return 'fresh';
  if (days <= 365) return 'recent';
  return 'aged';
}

function detectType(url: string): KnowledgeSource['type'] {
  if (/github\.com/.test(url)) return 'github';
  if (/stackoverflow\.com/.test(url)) return 'stackoverflow';
  if (/x\.com|twitter\.com/.test(url)) return 'x';
  return 'docs';
}

async function searchAll(
  ctx: KernelContext,
  query: string,
  cacheDir: string,
  ttlMs: number,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const cached = await readCache(cacheDir, query, ttlMs);
  if (cached) return cached;

  const sorted = [...ctx.providers.knowledge].sort((a, b) => a.priority - b.priority);
  const all: SearchResult[] = [];
  for (const provider of sorted) {
    try {
      const results = await provider.search(query, { limit: 3 });
      all.push(...results);
    } catch {
      // 单源失败不阻塞
    }
  }

  await writeCache(cacheDir, query, all);
  return all;
}

async function readCache(dir: string, key: string, ttlMs: number): Promise<SearchResult[] | null> {
  const file = join(dir, hash(key) + '.json');
  if (!existsSync(file)) return null;
  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text) as { ts: number; data: SearchResult[] };
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeCache(dir: string, key: string, data: SearchResult[]): Promise<void> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const file = join(dir, hash(key) + '.json');
  await writeFile(file, JSON.stringify({ ts: Date.now(), data }, null, 2), 'utf8');
}

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Helper for users to detect provider with search method (used for KnowledgeProvider type compat)
export type { KnowledgeProvider };
