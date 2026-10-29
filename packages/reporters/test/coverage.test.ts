/**
 * 覆盖范围（coverage）—— 报告必须说清"这次测了什么、没测什么"。
 *
 * 这组用例守的是 2026-10-27 修复轮第二轮的三条结论：
 *   1. 「没有信息量」只认 plannedFlows === 0；
 *   2. flow-only 场景（自动发现 0 页面，但手写 app.map.ts 的 flows 跑了）**不算**没有信息量；
 *   3. 有流程失败 / 未跑时，报告**不能**说"都通过了巡检"。
 *
 * 以前这三条都判错过：
 *   - 判据写成 `empty || plannedFlows === 0` → 手写 flows 的场景被误判成"没测到东西"，
 *     报告一边写「Bug 总数: 2」一边写「0 个 bug 不代表项目健康」，自相矛盾；
 *   - 空 bug 分支无条件写"所有巡检通过" → 表格写着「1 失败 / 2 未跑」，正文却说都通过了。
 */

import { describe, it, expect } from 'vitest';
import type { FeatureMap } from '@sentinel/core';
import { buildCoverageInfo, coverageIsUninformative, reportToMarkdown } from '../src/index.js';

const MAP: FeatureMap = {
  project: {
    name: 'demo',
    stack: ['nextjs'],
    frameworks: ['next'],
    runtime: 'node',
    packageManager: 'bun',
  },
  pages: [{ id: 'page_0', path: '/', requiresAuth: false, criticalCTAs: [] }],
  api: [{ id: 'api_0', method: 'GET', path: '/api/items', requiresAuth: false }],
  data: [],
  flows: [{ id: 'flow_0', description: '打开首页', steps: [{ action: 'visit', url: '/' }] }],
  risks: [],
};

/** 自动发现什么都没找到，但用户手写了 flows —— 这是"测过了"，不是"没测到东西"。 */
const EMPTY_MAP: FeatureMap = {
  ...MAP,
  pages: [],
  api: [],
  flows: [],
  risks: [
    {
      id: 'coverage_empty_map',
      area: 'ui',
      severity: 'high',
      description: '自动发现未识别到任何页面或接口',
    },
  ],
};

describe('coverage · buildCoverageInfo', () => {
  it('统计识别到的页面 / 接口 / 自动生成流程', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 1, passedFlows: 1, failedFlows: 0 });
    expect(cov.pages).toBe(1);
    expect(cov.api).toBe(1);
    expect(cov.flows).toBe(1);
    expect(cov.plannedFlows).toBe(1);
    expect(cov.passedFlows).toBe(1);
    expect(cov.failedFlows).toBe(0);
    expect(cov.untestedFlows).toBe(0);
    expect(cov.empty).toBe(false);
  });

  it('untestedFlows = 规划 - 通过 - 失败（不会算出负数）', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 5, passedFlows: 2, failedFlows: 1 });
    expect(cov.untestedFlows).toBe(2);
    const weird = buildCoverageInfo(MAP, { plannedFlows: 1, passedFlows: 3, failedFlows: 0 });
    expect(weird.untestedFlows).toBe(0);
  });

  it('map 为 null（项目理解失败）→ 全部 0 且 empty=true', () => {
    const cov = buildCoverageInfo(null, { plannedFlows: 0, passedFlows: 0, failedFlows: 0 });
    expect(cov.pages).toBe(0);
    expect(cov.api).toBe(0);
    expect(cov.flows).toBe(0);
    expect(cov.empty).toBe(true);
  });

  it('只保留 coverage_ 前缀的 risk（其它 risk 不属于覆盖缺口）', () => {
    const map: FeatureMap = {
      ...MAP,
      risks: [
        { id: 'coverage_missing_cta', area: 'ui', severity: 'medium', description: '有 CTA 没被点过' },
        { id: 'auth_weak', area: 'auth', severity: 'high', description: '鉴权弱' },
      ],
    };
    const cov = buildCoverageInfo(map, { plannedFlows: 1, passedFlows: 1, failedFlows: 0 });
    expect(cov.risks.map((r) => r.id)).toEqual(['coverage_missing_cta']);
  });

  it('coverage_empty_map 在 plannedFlows > 0 时改口（不能还说"没测到东西"）', () => {
    const cov = buildCoverageInfo(EMPTY_MAP, { plannedFlows: 1, passedFlows: 1, failedFlows: 0 });
    expect(cov.risks).toHaveLength(1);
    expect(cov.risks[0]!.description).toContain('手写');
    expect(cov.risks[0]!.description).toContain('app.map.ts');
    // 原文是「自动发现未识别到任何页面或接口」—— 改口后必须不再是这句
    expect(cov.risks[0]!.description).not.toBe('自动发现未识别到任何页面或接口');
    expect(cov.risks[0]!.severity).toBe('low');
  });

  it('mapFailures 原样透传（有它就说明后面的 0 是因为项目理解失败）', () => {
    const cov = buildCoverageInfo(null, {
      plannedFlows: 0,
      passedFlows: 0,
      failedFlows: 0,
      mapFailures: ['加载 .sentinel/app.map.ts 失败：语法错误'],
    });
    expect(cov.mapFailures).toHaveLength(1);
    expect(cov.mapFailures[0]).toContain('app.map.ts');
  });
});

describe('coverage · coverageIsUninformative', () => {
  it('plannedFlows === 0 → 没有信息量（哪怕识别到了页面）', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 0, passedFlows: 0, failedFlows: 0 });
    expect(cov.empty).toBe(false);
    expect(coverageIsUninformative(cov)).toBe(true);
  });

  it('flow-only 场景（自动发现 0 页面，但流程跑了）→ 有信息量', () => {
    const cov = buildCoverageInfo(EMPTY_MAP, { plannedFlows: 1, passedFlows: 1, failedFlows: 0 });
    expect(cov.empty).toBe(true);
    expect(coverageIsUninformative(cov)).toBe(false);
  });
});

describe('coverage · 报告文本', () => {
  it('一条流程都没跑 → 报告出醒目横幅', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 0, passedFlows: 0, failedFlows: 0 });
    const md = reportToMarkdown([], { project: 'demo' }, { coverage: cov });
    expect(md).toContain('本次未识别到可测目标');
    expect(md).toContain('不代表项目健康');
  });

  it('flow-only 场景 → 不出横幅，并列出覆盖表格', () => {
    const cov = buildCoverageInfo(EMPTY_MAP, { plannedFlows: 1, passedFlows: 1, failedFlows: 0 });
    const md = reportToMarkdown([], { project: 'demo' }, { coverage: cov });
    expect(md).not.toContain('本次未识别到可测目标');
    expect(md).toContain('## 覆盖范围 / Coverage');
    expect(md).toContain('| 规划执行流程 / Planned flows | 1 |');
  });

  it('有失败 / 未跑 → 写"结果不完整"，不能说"都通过了巡检"', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 3, passedFlows: 1, failedFlows: 1 });
    const md = reportToMarkdown([], { project: 'demo' }, { coverage: cov });
    expect(md).toContain('结果不完整');
    expect(md).not.toContain('都通过了巡检');
    expect(md).toContain('1 条流程失败');
    expect(md).toContain('1 条流程未跑');
  });

  it('全部跑完且都通过 → 才写"已识别的目标都通过了巡检"', () => {
    const cov = buildCoverageInfo(MAP, { plannedFlows: 2, passedFlows: 2, failedFlows: 0 });
    const md = reportToMarkdown([], { project: 'demo' }, { coverage: cov });
    expect(md).toContain('已识别的目标都通过了巡检');
    expect(md).not.toContain('结果不完整');
  });
});
