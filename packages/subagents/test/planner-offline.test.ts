/**
 * planner 的离线兜底 —— README 承诺"离线模式给通用模板方案"。
 *
 * 背景：离线时不注册 critic，草稿（bug.draft）永远升级不成 confirmed，
 * planner 听不到任何东西 → 报告第 7-11 字段全空。
 * README 承诺的"离线也有通用方案"如果没兑现，就是又一条
 * "文档说能做、实际没做"—— 本项目最严重的缺陷类型。
 *
 * 这里守住两件事：
 *   ① 离线 + bug.draft → 真的有 fix.proposed，且明确标注是**通用模板**（不冒充模型推断）
 *   ② 非离线 + bug.draft → planner **不**插手（在线模式由 analyst/critic 升级成 confirmed，那条路上才有真方案）
 */

import { describe, expect, it } from 'vitest';
import { Budget, Kernel, type BugFinding, type FixOption, type ProviderSet, type Subagent } from '@sentinel/core';
import { createPlanner } from '../src/planner.js';

const bug: BugFinding = {
  id: 'b_draft_1',
  title: '首页 404',
  severity: 'P1',
  source: 'ui',
  affectedFeature: 'home',
  symptom: '访问首页返回 404',
  reproSteps: ['启动项目', '打开 /'],
  evidence: [],
  rootCauseStatus: 'hypothesis',
  counterEvidence: [],
  confidence: 0.6,
  fixOptions: [],
};

function providers(chat: ProviderSet['llm']['chat']): ProviderSet {
  return {
    llm: { name: 'fake', supportsTools: false, chat, estimateCost: () => 0 },
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

const offlineChat = async (): Promise<never> => { throw Error('offline: no model'); };

interface Captured {
  bug: BugFinding;
  options: FixOption[];
}

function capturePlanner(): { subagent: Subagent; captured: Captured[] } {
  const captured: Captured[] = [];
  const subagent: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ bug: BugFinding; options: FixOption[] }>('fix.proposed', (e) => {
        captured.push(e.payload);
      });
    },
  };
  return { subagent, captured };
}

describe('planner 离线兜底（通用模板方案）', () => {
  it('离线 + bug.draft → 出通用模板方案，并明确标注不是模型推断', async () => {
    const { subagent, captured } = capturePlanner();
    const kernel = new Kernel({
      providers: providers(offlineChat),
      budget: new Budget({}),
      subagents: [createPlanner({ offline: true }), subagent],
    });

    await kernel.kick('bug.draft', bug, 'analyst');

    expect(captured).toHaveLength(1);
    const options = captured[0]!.options;
    expect(options.length).toBeGreaterThanOrEqual(1);
    // 每条都必须是"通用模板"，且说清不是针对本项目的定论
    for (const option of options) {
      expect(option.title).toContain('通用模板');
      expect(option.whyRecommended).toContain('证据不足');
    }
    // 报告第 7-11 字段要有的东西不能是空壳
    expect(captured[0]!.bug.fixOptions).toHaveLength(options.length);
    expect(captured[0]!.bug.recommendedFixId).toBeTruthy();
    expect(options.some(o => o.id === captured[0]!.bug.recommendedFixId)).toBe(true);
    // 不许冒充模型结论
    expect(captured[0]!.bug.rootCauseStatus).toBe('hypothesis');
  });

  it('离线 + bug.draft 不调模型（模板是本地生成的）', async () => {
    let calls = 0;
    const { subagent } = capturePlanner();
    const kernel = new Kernel({
      providers: providers(async () => { calls++; throw Error('should not be called'); }),
      budget: new Budget({}),
      subagents: [createPlanner({ offline: true }), subagent],
    });
    await kernel.kick('bug.draft', bug, 'analyst');
    expect(calls).toBe(0);
  });

  it('非离线 + bug.draft → planner 不插手（在线由 critic 升级成 confirmed 再出真方案）', async () => {
    const { subagent, captured } = capturePlanner();
    const kernel = new Kernel({
      providers: providers(offlineChat),
      budget: new Budget({}),
      subagents: [createPlanner(), subagent],
    });
    await kernel.kick('bug.draft', bug, 'analyst');
    expect(captured).toHaveLength(0);
  });
});
