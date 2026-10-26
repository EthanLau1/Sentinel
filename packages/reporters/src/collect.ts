/**
 * 报告数据收集器 —— 把 bus 事件转成最终报告里的 bug 列表。
 *
 * 为什么单独成文件：事件的**到达顺序**和"谁先到"是两件事。
 * bus 是顺序 await 分发，所以链路是"深层先到、浅层后到"：
 *
 *   critic 发 bug.confirmed
 *     → verifier 转发 bug.confirmed（source=verifier）
 *       → planner 出方案，发 fix.proposed
 *         → enhancer 补充来源，发 fix.enhanced  ← 带 fixOptions，先到
 *     → critic 那条 bug.confirmed 回到收集器    ← fixOptions 仍为空，后到
 *
 * 收集器如果用"覆盖"语义，后到的空 fixOptions 会把 planner 的方案抹掉，
 * 报告第 7/8 字段就永远显示"待 planner 产出"。
 * 所以这里必须是**合并**语义：已收到的富化字段不被空值覆盖。
 *
 * 单独成文件还有一个理由：这段逻辑必须能被真实代码路径的测试直接覆盖。
 * 之前它藏在 run.ts 的闭包里，测试只能绕开它调用别的函数，
 * 于是"报告第 7/8 字段永远空"这个缺陷躲过了所有测试。
 */

import type { BugFinding } from '@sentinel/core';
import { mergeBugFinding } from './aggregate.js';

export interface BugCollector {
  /** 收集到的 bug（按首次到达顺序） */
  readonly bugs: BugFinding[];
  /** 已有诊断覆盖的 flow —— 用于算"未解决 flow" */
  readonly coveredFlows: Set<string>;
  /** 处理 bug.confirmed（critic / verifier 确认） */
  onConfirmed(bug: BugFinding): void;
  /** 处理 fix.enhanced（planner / enhancer 出的富化版本） */
  onEnhanced(bug: BugFinding): void;
  /** 处理 bug.draft（未确认的草稿）—— 已存在同 id 时不覆盖 */
  onDraft(bug: BugFinding): void;
}

export function createBugCollector(): BugCollector {
  const bugs: BugFinding[] = [];
  const coveredFlows = new Set<string>();

  const upsert = (bug: BugFinding): void => {
    const idx = bugs.findIndex((b) => b.id === bug.id);
    if (idx >= 0) bugs[idx] = mergeBugFinding(bugs[idx], bug);
    else bugs.push(bug);
    coveredFlows.add(bug.affectedFeature);
  };

  return {
    bugs,
    coveredFlows,
    onConfirmed: upsert,
    onEnhanced: upsert,
    onDraft: (bug: BugFinding): void => {
      if (!bugs.some((b) => b.id === bug.id)) bugs.push(bug);
      coveredFlows.add(bug.affectedFeature);
    },
  };
}
