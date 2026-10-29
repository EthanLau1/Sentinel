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
 *
 * ## 还有一道闸门：被 critic 拒绝的草稿不进发现列表
 *
 * 以前 `bug.rejected` 只被记进 run-status.json，报告里那条草稿照旧出现 ——
 * 等于把「critic 认为证据不足的根因假设」当成一条诊断卖给你。
 * 现在：证据不足 → 剔除并单列在报告的「被拒绝」区块；critic 自己没跑起来 → 保留但标明未验证。
 */

import type { BugFinding } from '@sentinel/core';
import { mergeBugFinding } from './aggregate.js';

/**
 * critic 拒绝的两种性质 —— 处置方式完全不同，不能混为一谈。
 *
 * - `insufficient-evidence`：critic 真的跑了，判定「证据不足以支撑这个根因假设」。
 *   这种草稿**不能进报告的发现列表** —— 报告里出现一条没被反向验证过的结论，
 *   等于把猜测当结论卖。
 * - `unavailable`：critic 自己没跑起来（模型不可用、调用失败）。
 *   这不是「假设不成立」，是「没人验过」—— 发现必须保留，但要在报告里标明未验证。
 */
export type RejectionKind = 'insufficient-evidence' | 'unavailable';

export interface RejectedFinding {
  bugId: string;
  reason: string;
  kind: RejectionKind;
}

export interface BugCollector {
  /** 收集到的 bug（按首次到达顺序） */
  readonly bugs: BugFinding[];
  /** 已有诊断覆盖的 flow —— 用于算"未解决 flow" */
  readonly coveredFlows: Set<string>;
  /** 被 critic 拒绝的草稿（含原因）—— 报告里要单独列出来，不能静默丢弃 */
  readonly rejected: RejectedFinding[];
  /** 处理 bug.confirmed（critic / verifier 确认） */
  onConfirmed(bug: BugFinding): void;
  /** 处理 fix.enhanced（planner / enhancer 出的富化版本） */
  onEnhanced(bug: BugFinding): void;
  /** 处理 bug.draft（未确认的草稿）—— 已存在同 id 时不覆盖 */
  onDraft(bug: BugFinding): void;
  /**
   * 处理 bug.rejected（critic 拒绝）。
   *
   * 顺序陷阱：bus 是顺序 await 分发，**critic 的处理函数比收集器先跑**，
   * 所以「拒绝」事件可能比「草稿」事件先到收集器。
   * 因此拒绝状态必须按 id 记下来，等草稿到达时再决定要不要收 ——
   * 早到的拒绝不能被后来的草稿覆盖掉。
   */
  onRejected(bugId: string, reason: string, kind?: RejectionKind): void;
}

export function createBugCollector(): BugCollector {
  const bugs: BugFinding[] = [];
  const coveredFlows = new Set<string>();
  const rejected: RejectedFinding[] = [];
  const rejections = new Map<string, RejectionKind>();

  const upsert = (bug: BugFinding): void => {
    // 被确认的结论不再算"被拒绝" ——
    // 否则同一条会既出现在诊断列表、又出现在报告的「被 Critic 拒绝的假设」区块，自相矛盾。
    const rejectedIdx = rejected.findIndex((r) => r.bugId === bug.id);
    if (rejectedIdx >= 0) rejected.splice(rejectedIdx, 1);
    rejections.delete(bug.id);
    const idx = bugs.findIndex((b) => b.id === bug.id);
    if (idx >= 0) bugs[idx] = mergeBugFinding(bugs[idx], bug);
    else bugs.push(bug);
    coveredFlows.add(bug.affectedFeature);
  };

  /** 某个 flow 下面还有没有别的诊断 —— 没有的话它就不算"被诊断覆盖" */
  const dropIfUncovered = (feature: string): void => {
    if (!bugs.some((b) => b.affectedFeature === feature)) coveredFlows.delete(feature);
  };

  return {
    bugs,
    coveredFlows,
    rejected,
    onConfirmed: upsert,
    onEnhanced: upsert,
    onDraft: (bug: BugFinding): void => {
      const kind = rejections.get(bug.id);
      if (kind === 'insufficient-evidence') {
        // critic 已判定证据不足 → 不进发现列表（理由进报告的「被拒绝」区块）
        dropIfUncovered(bug.affectedFeature);
        return;
      }
      if (!bugs.some((b) => b.id === bug.id)) bugs.push(bug);
      coveredFlows.add(bug.affectedFeature);
    },
    onRejected: (bugId: string, reason: string, kind: RejectionKind = 'insufficient-evidence'): void => {
      rejections.set(bugId, kind);
      rejected.push({ bugId, reason, kind });
      const idx = bugs.findIndex((b) => b.id === bugId);
      // 只有"真的判定证据不足"才剔除；"没验成"必须保留发现。
      if (idx >= 0 && kind === 'insufficient-evidence') {
        const [removed] = bugs.splice(idx, 1);
        if (removed) dropIfUncovered(removed.affectedFeature);
      }
    },
  };
}
