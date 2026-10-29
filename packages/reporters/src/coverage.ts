/**
 * Coverage — 本次到底测了什么、没测什么。
 *
 * 为什么必须单独成文件：
 *   "0 个 bug" 有两种完全不同的含义 ——
 *     A. 全部测了，没发现问题      （好消息）
 *     B. 一个可测目标都没识别出来   （本次结果没有任何信息量）
 *   两者在旧报告里长得一模一样，用户只能靠猜。
 *   coverageRisks 早就生成了（mapper.ts），但报告层从来不读它 ——
 *   缺口只落在 run-status.json 里，用户看的报告看不到。
 *
 * 口径说明：
 *   empty        = 一个页面/接口都没识别出来
 *   plannedFlows = 本次实际规划并尝试执行的流程数（= 0 同样意味着"没测到东西"）
 */

import type { FeatureMap } from '@sentinel/core';

export interface CoverageRisk {
  id: string;
  area: string;
  severity: string;
  description: string;
}

export interface CoverageInfo {
  /** 识别到的页面数 */
  pages: number;
  /** 识别到的接口数 */
  api: number;
  /** 自动生成的流程数（FeatureMap.flows） */
  flows: number;
  /** 本次实际规划执行的流程数 */
  plannedFlows: number;
  passedFlows: number;
  failedFlows: number;
  /** 规划了但没跑的流程数 */
  untestedFlows: number;
  /** 一个页面/接口都没识别出来 */
  empty: boolean;
  /** 覆盖缺口：没自动测的路由、没点的 CTA、没跑鉴权流程… */
  risks: CoverageRisk[];
  /** 项目理解失败（mapper 报错）——有它就意味着后面所有数字都是 0 */
  mapFailures: string[];
}

export interface CoverageStats {
  plannedFlows: number;
  passedFlows: number;
  failedFlows: number;
  mapFailures?: string[];
}

/**
 * 从 FeatureMap + 本次运行统计构造覆盖信息。
 *
 * map 为 null 表示项目理解失败 —— 此时 pages/api/flows 全是 0，
 * 必须配合 mapFailures 才能说清"为什么是 0"。
 */
export function buildCoverageInfo(map: FeatureMap | null, stats: CoverageStats): CoverageInfo {
  const pages = map?.pages.length ?? 0;
  const api = map?.api.length ?? 0;
  const plannedFlows = stats.plannedFlows;
  const passedFlows = stats.passedFlows;
  const failedFlows = stats.failedFlows;
  return {
    pages,
    api,
    flows: map?.flows.length ?? 0,
    plannedFlows,
    passedFlows,
    failedFlows,
    untestedFlows: Math.max(0, plannedFlows - passedFlows - failedFlows),
    empty: pages === 0 && api === 0,
    risks: (map?.risks ?? [])
      .filter((risk) => risk.id.startsWith('coverage_'))
      .map((risk) => {
        // 自动发现没识别到页面/接口，但用户手写的 flows 确实跑起来了 ——
        // 这条提示要改口，否则报告一边说"没有可测目标"，一边列着实际跑过的流程。
        if (risk.id === 'coverage_empty_map' && plannedFlows > 0) {
          return {
            id: risk.id,
            area: risk.area,
            severity: 'low',
            description:
              '自动发现未识别到页面或接口 —— 本次的可测目标来自手写 .sentinel/app.map.ts 的 flows（不是没测到东西）',
          };
        }
        return {
          id: risk.id,
          area: risk.area,
          severity: risk.severity,
          description: risk.description,
        };
      }),
    mapFailures: stats.mapFailures ?? [],
  };
}

/**
 * 本次结果是否"没有任何信息量"。
 *
 * 两种情况都算：
 *   - 一个页面/接口都没识别出来（empty）
 *   - 识别出来了，但一个流程都没跑（plannedFlows === 0）——
 *     比如所有页面都需要鉴权，自动流程全部放弃
 */
export function coverageIsUninformative(coverage: CoverageInfo): boolean {
  // 判据只有一个：**有没有真的跑过流程**。
  //
  // 以前是 `coverage.empty || coverage.plannedFlows === 0` ——
  // 于是"用户手写了 flows、页面 0 个但流程跑了 1 条"的情况被判成"没有信息量"，
  // 报告里同时出现「Bug 总数: 2」和「0 个 bug 不代表项目健康」，自相矛盾。
  //
  // empty 的含义是"**自动发现**没找到页面/接口"，而手写 flows 正是为这种情况准备的：
  // 页面 0 个 + 流程 1 条 = 测过了，而且测出了东西 —— 这恰恰是**有信息量**的。
  return coverage.plannedFlows === 0;
}
