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
  skipSearch?: boolean;
  /** 缓存目录（默认 .sentinel/cache/knowledge） */
  cacheDir?: string;
  /** 缓存 TTL（小时） */
  cacheTtlHours?: number;
  /** 强制启用：每次 bug 都搜（默认 false）—— 只覆盖"置信度阈值"，**不覆盖** 30% 上限 */
  alwaysSearch?: boolean;
  /** 启用 X.com（默认 false） */
  enableX?: boolean;
  /**
   * 触发检索的流程占比上限（默认 = MAX_SEARCH_RATE = 0.3）。
   * CLI 只允许调**低**（0 ~ 0.3）—— 上限是宪法条款，不能被调高。
   */
  maxSearchRate?: number;
}

/**
 * 宪法硬条款：每次 run 中触发检索的**流程占比**上限（docs/CONSTITUTION.md §知识增强）。
 *
 * 以前这里只有一条"平均置信度 < 0.7 就搜" —— 置信度低的流程一多，
 * 检索会跟着涨，成本和外部服务压力都不受控。
 * 30% 是**每次 run 的流程占比**，不是"每条 bug"——
 * 所以计数单位是**流程**（bug.affectedFeature），同一个流程只检索一次。
 */
export const MAX_SEARCH_RATE = 0.3;

/**
 * 不知道本次 run 有多少流程时的保守分母。
 *
 * 真实运行里 `map.ready` 一定先于 `fix.proposed` 到达，分母是准的。
 * 拿不到时（单测 / mapper 失败）用 10 兜底 —— 宁可少搜，不要在不知道分母时放开搜。
 */
const UNKNOWN_FLOW_ESTIMATE = 10;

/** 知识检索的触发统计 —— 写进 run-status.json，让"有没有超限"可核对 */
export interface KnowledgeSearchStats {
  /** 本次 run 的流程总数（来自 map.ready；拿不到时为 null） */
  totalFlows: number | null;
  /** 实际触发检索的流程数 */
  searchedFlows: number;
  /** 实际触发占比（0~1） */
  rate: number;
  /** 配置的上限（默认 0.3） */
  cap: number;
  /** 按上限算出来的允许次数（floor） */
  maxSearches: number;
  /** 因为超出上限而跳过的次数 */
  skippedByCap: number;
  /** 因为同一流程已经检索过而跳过的次数 */
  skippedSameFlow: number;
}

/** 上限换算成"最多允许检索几个流程" —— floor，不许四舍五入（30% 是上限不是目标） */
export function maxSearchesFor(totalFlows: number | null, cap: number = MAX_SEARCH_RATE): number {
  const denominator = totalFlows === null ? UNKNOWN_FLOW_ESTIMATE : totalFlows;
  if (denominator <= 0) return 0;
  return Math.floor(denominator * cap);
}

export function createEnhancer(config: EnhancerConfig = {}): Subagent & { knowledgeStats: () => KnowledgeSearchStats } {
  const cacheDir = config.cacheDir ?? '.sentinel/cache/knowledge';
  const ttlMs = (config.cacheTtlHours ?? 48) * 60 * 60 * 1000;
  const cap = config.maxSearchRate ?? MAX_SEARCH_RATE;

  // 本次 run 的状态 —— 子代理实例一次 run 只用一次
  let totalFlows: number | null = null;
  const searchedFlows = new Set<string>();
  let skippedByCap = 0;
  let skippedSameFlow = 0;

  return {
    name: 'enhancer',

    knowledgeStats(): KnowledgeSearchStats {
      const maxSearches = maxSearchesFor(totalFlows, cap);
      return {
        totalFlows,
        searchedFlows: searchedFlows.size,
        rate: totalFlows && totalFlows > 0 ? searchedFlows.size / totalFlows : 0,
        cap,
        maxSearches,
        skippedByCap,
        skippedSameFlow,
      };
    },

    register(ctx: KernelContext): void {
      // 流程总数是分母 —— 没有它就算不出"占比"。
      // map.ready 由 mapper 在所有流程开始前发出，所以这里拿到的一定是全量。
      ctx.bus.subscribe<import('@sentinel/core').FeatureMap>('map.ready', (event) => {
        totalFlows = event.payload.flows.length;
      });

      ctx.bus.subscribe<{ bug: import('@sentinel/core').BugFinding; options: FixOption[] }>('fix.proposed', async (event) => {
        const { bug, options } = event.payload;

        // 计数单位是**流程**（affectedFeature），不是 bug ——
        // 宪法写的是"触发检索的流程占比"，同一流程出 3 个 bug 也只算 1 次。
        const flowKey = bug.affectedFeature || bug.id;
        const alreadySearched = searchedFlows.has(flowKey);
        const budgetLeft = searchedFlows.size < maxSearchesFor(totalFlows, cap);
        const wanted = decideSearch(options, config.alwaysSearch ?? false);

        // 决定是否搜：置信度阈值 + 宪法占比上限，两者都要过
        const shouldSearch = !config.skipSearch && !alreadySearched && budgetLeft && wanted;
        if (!shouldSearch) {
          // 被挡下来的要**记一笔** —— 报告里要能看出"为什么这条没有知识来源"
          if (!config.skipSearch && wanted) {
            if (alreadySearched) skippedSameFlow += 1;
            else if (!budgetLeft) skippedByCap += 1;
          }
          await ctx.bus.publish({
            type: 'fix.enhanced',
            payload: { bug, options },
            source: 'enhancer',
            traceId: event.traceId,
          });
          return;
        }
        searchedFlows.add(flowKey);

        // 用 option 标题做查询
        const query = buildQuery(options);
        const results = await searchAll(ctx, query, cacheDir, ttlMs, event.traceId);

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
  traceId: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const cached = await readCache(cacheDir, query, ttlMs);
  if (cached) {
    // 命中缓存也要有事件 —— 否则"这次没联网"与"这次搜了但没结果"分不清
    await ctx.bus.publish({
      type: 'knowledge.cached',
      payload: { key: hash(query), ttl: ttlMs },
      source: 'enhancer',
      traceId,
    });
    return cached;
  }

  // 检索过程必须可观测：M6 之前是完全黑盒的
  await ctx.bus.publish({
    type: 'knowledge.requested',
    payload: { query, sources: ctx.providers.knowledge.map((p) => p.name) },
    source: 'enhancer',
    traceId,
  });

  const sorted = [...ctx.providers.knowledge].sort((a, b) => a.priority - b.priority);
  const all: SearchResult[] = [];
  const failed: string[] = [];
  for (const provider of sorted) {
    try {
      const results = await provider.search(query, { limit: 3 });
      all.push(...results);
    } catch (err) {
      // 单源失败不阻塞其它源，但**必须说出来** ——
      // 静默吞掉的话，"检索到 0 条"会被误读成"网上没有这回事"（E27）
      failed.push(`${provider.name}: ${(err as Error).message}`);
    }
  }
  if (failed.length > 0) {
    console.warn(`[sentinel] enhancer: 知识检索部分来源失败 —— ${failed.join('；')}`);
  }

  await ctx.bus.publish({
    type: 'knowledge.received',
    payload: all,
    source: 'enhancer',
    traceId,
  });

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
