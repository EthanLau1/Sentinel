/**
 * benchmark 回测器 —— 把一次真实 run 变成「可重复执行」的回归用例。
 *
 * 为什么需要它：方案 §7 要求「在 benchmark/ 重跑全部历史 case 确认未退化」，
 * 而现有的 `benchmarks/cases/*.json` 是**静态记录**（跑一次就冻结），
 * 证明不了任何东西 —— 改坏了代码，历史 case 照样"通过"。
 *
 * 回测的做法：把真实 run 里模型的回复**录下来**，之后用录制的回复重跑整条决策链
 * （analyst → critic → verifier → planner → enhancer → executor），
 * 再把产出与当初记录的结果逐项比对。
 *
 * 它守住的是什么：**不是模型能力**（回复是录制的，模型没变），
 * 而是**决策层**——也就是最容易出现"报告说的和实际做的不一致"的地方：
 *   - JSON 解析兜底（think 块剥离、截断抢救）      E5 / E22
 *   - planner 两步协议 + diff 规范化（hunk 计数、结尾换行）  E13 / E23 / E24
 *   - executor 的 Tier 硬规则（补丁形状、硬风险、中文关键词） E18 / E20 / E21
 *   - 报告第 11 字段取的是硬规则 tier 而不是 LLM 自报值  E15
 * 这些正是本轮改得最多的地方，回测就是给它们上保险。
 *
 * 两种模式，同一条代码路径：
 *   - **回放**（默认）：用夹具里录制的回复跑，比对 `expected`
 *   - **录制**（--record）：用真实 provider 跑，把回复录进夹具
 */

import { Kernel, Budget, type BugFinding, type Evidence, type ProviderSet, type Subagent } from '@sentinel/core';
import {
  createAnalyst,
  createCritic,
  createVerifier,
  createPlanner,
  createEnhancer,
  createExecutor,
  validPatch,
  applyPatch,
  patchTargets,
} from '@sentinel/subagents';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** 回测夹具：一次真实 run 的可重放切片 */
export interface ReplayFixture {
  caseId: string;
  description?: string;
  /** 触发链路用的输入（来自真实 run 产物） */
  input: {
    flowId: string;
    error: string;
    evidence: Evidence[];
  };
  /** 录制的模型回复，按实际调用顺序（analyst → critic → planner×2） */
  llmResponses: string[];
  /**
   * 项目快照：被测文件在**修复前**的内容。
   * 有了它，回测才能验证「补丁能不能真的应用」——
   * 只验 validPatch 是不够的（E24 那种结尾少一个换行的错，validPatch 查不出来，
   * 只有真跑 git apply 才暴露）。
   */
  snapshot?: { files: Record<string, string> };
  /** 期望输出 —— 回测的判据 */
  expected: ReplayExpected;
  recordedAt?: string;
}

export interface ReplayExpected {
  rootCauseStatus: string;
  rootCauseContains?: string[];
  fixCount: number;
  /**
   * 推荐方案里必须点名的关键词（人工真值：被改坏的文件/标识符）。
   * 查的是**标题 + 说明**：planner 的契约是"方案必须点名具体文件与改什么"，
   * 只查标题会把"说明里点名了文件"的正常方案误判成退化。
   */
  recommendedMentions?: string[];
  /** 硬规则判出的 tier（executor.tier_decided） */
  hardTier?: number;
  /** 推荐方案的 patch 是否是合法 unified diff */
  patchValid?: boolean;
  /** 推荐方案的 patch 能不能真的应用到快照上（要 snapshot 才有意义） */
  patchApplies?: boolean;
}

export interface ReplayActual {
  rootCauseStatus: string;
  rootCause: string;
  fixCount: number;
  recommendedTitle: string;
  recommendedDescription: string;
  hardTier: number | null;
  patchValid: boolean | null;
  /** 补丁能不能真的应用到快照上（null = 没快照，没验） */
  patchApplies: boolean | null;
  llmCallsUsed: number;
  error?: string;
}

export interface ReplayResult {
  caseId: string;
  actual: ReplayActual;
  mismatches: string[];
  passed: boolean;
}

/** 录制模式用的 provider 包装：把每次回复记下来 */
export interface RecordingProvider {
  provider: ProviderSet['llm'];
  responses: string[];
}

export function createRecordingProvider(inner: ProviderSet['llm']): RecordingProvider {
  const responses: string[] = [];
  const provider: ProviderSet['llm'] = {
    name: `${inner.name}+recording`,
    supportsTools: inner.supportsTools,
    estimateCost: (t: number) => inner.estimateCost(t),
    async chat(messages, options) {
      const res = await inner.chat(messages, options);
      responses.push(res.content);
      return res;
    },
  };
  return { provider, responses };
}

/** 回放模式：按顺序吐录制的回复；用完了必须报错，不能悄悄返回空 */
function createReplayProvider(responses: string[], used: { n: number }): ProviderSet['llm'] {
  return {
    name: 'replay',
    supportsTools: false,
    estimateCost: () => 0,
    async chat() {
      if (used.n >= responses.length) {
        throw new Error(
          `录制的模型回复不够：第 ${used.n + 1} 次调用没有对应录制（已录 ${responses.length} 条）`,
        );
      }
      const content = responses[used.n++]!;
      return { content, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, costUsd: 0 };
    },
  };
}

function fakeProviders(llm: ProviderSet['llm']): ProviderSet {
  return {
    llm,
    memory: { name: 'none', async recall() { return []; }, async remember() {} },
    skills: { async list() { return []; }, async load() { throw new Error('unused'); }, async refresh() {} },
    mcp: { register() {}, unregister() {}, get() { return undefined; }, list() { return []; } },
    knowledge: [],
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return predicate();
}

/**
 * 把补丁真的应用到快照上（临时 git 仓库 + executor 的 applyPatch）。
 *
 * 为什么必须真跑 git：只验 validPatch 是不够的 ——
 * E24 那种"结尾少一个换行"的错，validPatch 认为合法，只有 git apply 才报错。
 */
async function applyOnSnapshot(
  snapshot: { files: Record<string, string> },
  patch: string,
): Promise<boolean> {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-replay-'));
  try {
    for (const [p, content] of Object.entries(snapshot.files)) {
      const full = join(root, p);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'replay@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'replay'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'snapshot'], { cwd: root });
    const result = await applyPatch(root, patch, patchTargets(patch));
    return result.applied;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 跑一次回测。`provider` 给了就是录制模式（用真实模型跑并记录），
 * 不给就是回放模式（用夹具里录制的回复跑）。
 */
export async function replayFixture(
  fixture: ReplayFixture,
  options: { provider?: ProviderSet['llm']; stage?: 'Idea' | 'MVP' | 'Launch' | 'Scale' } = {},
): Promise<ReplayResult> {
  const used = { n: 0 };
  // 回放模式自己维护取回复的下标 —— 不能和"调用次数"共用一个计数器，
  // 否则包装层先自增，取回复时就跳过了第 0 条（实测整个链路错位一格）。
  const replayIndex = { n: 0 };
  const inner = options.provider ?? createReplayProvider(fixture.llmResponses, replayIndex);
  // 两种模式都要能数出调用次数（录制模式尤其需要：录到几条、用掉几条）
  const providerErrors: string[] = [];
  const llm: ProviderSet['llm'] = {
    name: inner.name,
    supportsTools: inner.supportsTools,
    estimateCost: (t: number) => inner.estimateCost(t),
    async chat(messages, opts) {
      used.n += 1;
      try {
        return await inner.chat(messages, opts);
      } catch (err) {
        // provider 的失败（回放时最常见的是"录制的回复不够"）必须被回测看见 ——
        // agent 会把 LLM 报错当成"证据不足"吞掉，产出看着只是"空"，看不出原因。
        providerErrors.push((err as Error).message);
        throw err;
      }
    },
  };

  let bug: BugFinding | undefined;
  // hypothesis 案例：critic 拒了 → 链路停在 planner 之前，根本不会有 fix.enhanced。
  // 只盯 fix.enhanced 会让这类案例的实际产出恒为"(无)"，判据形同虚设。
  let draft: BugFinding | undefined;
  const tierByFix = new Map<string, number>();
  const captureSub: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<{ bug: BugFinding }>('fix.enhanced', (e) => { bug = e.payload.bug; });
      ctx.bus.subscribe<BugFinding>('bug.draft', (e) => { draft = e.payload; });
      ctx.bus.subscribe<{ fixId: string; tier: number }>('executor.tier_decided', (e) => {
        tierByFix.set(e.payload.fixId, e.payload.tier);
      });
    },
  };

  const kernel = new Kernel({
    providers: fakeProviders(llm),
    budget: new Budget({}),
    subagents: [
      createAnalyst(),
      createCritic(),
      createVerifier(),
      createPlanner({ stage: options.stage ?? 'MVP', requireVerified: true }),
      createEnhancer({ skipSearch: true }),
      createExecutor(),
      captureSub,
    ],
  });

  let error: string | undefined;
  try {
    await kernel.kick('flow.failed', fixture.input, 'replay');
    // 等到 executor 判完 tier（它一定在 planner 之后跑）；
    // provider 报错时链路已经终止，不必再干等
    await waitFor(() => tierByFix.size > 0 || providerErrors.length > 0, 8000);
  } catch (err) {
    error = (err as Error).message;
  }
  await kernel.stop();
  if (!error && providerErrors.length > 0) error = providerErrors[0];

  // 没有 fix.enhanced 时退回 bug.draft —— hypothesis 案例的产出就在这里
  const finalBug = bug ?? draft;
  const recommended = finalBug?.fixOptions?.find((o) => o.id === finalBug?.recommendedFixId) ?? finalBug?.fixOptions?.[0];

  // 补丁能不能真应用（有快照 + 有 patch 才验）
  let patchApplies: boolean | null = null;
  if (fixture.snapshot && recommended?.patch) {
    patchApplies = await applyOnSnapshot(fixture.snapshot, recommended.patch);
  }

  const actual: ReplayActual = {
    rootCauseStatus: finalBug?.rootCauseStatus ?? '(无)',
    rootCause: finalBug?.rootCause ?? '',
    fixCount: finalBug?.fixOptions?.length ?? 0,
    recommendedTitle: recommended?.title ?? '',
    recommendedDescription: recommended?.description ?? '',
    hardTier: recommended ? tierByFix.get(recommended.id) ?? null : null,
    patchValid: recommended?.patch !== undefined ? validPatch(recommended.patch) : null,
    patchApplies,
    llmCallsUsed: used.n,
    ...(error ? { error } : {}),
  };

  const mismatches = compareReplay(actual, fixture.expected);
  return { caseId: fixture.caseId, actual, mismatches, passed: mismatches.length === 0 };
}

/** 逐项比对：任何一项对不上都算退化 */
export function compareReplay(actual: ReplayActual, expected: ReplayExpected): string[] {
  const out: string[] = [];
  if (actual.error) out.push(`回放过程报错：${actual.error}`);
  if (actual.rootCauseStatus !== expected.rootCauseStatus) {
    out.push(`根因状态：期望 ${expected.rootCauseStatus}，实际 ${actual.rootCauseStatus}`);
  }
  // 关键词是**同一组真值标识符的不同写法** → 命中任意一个即算命中，
  // 与归档时的命中判定（bench-external.mjs 用 .some()）同一口径。
  // 用 every() 会让「模型换了个说法」的正常案例永远判成退化。
  const rootCauseKws = expected.rootCauseContains ?? [];
  if (rootCauseKws.length > 0 && !rootCauseKws.some((kw) => actual.rootCause.includes(kw))) {
    out.push(`根因文本不含任何一个真值关键词 ${JSON.stringify(rootCauseKws)}：${actual.rootCause}`);
  }
  if (actual.fixCount !== expected.fixCount) {
    out.push(`方案数：期望 ${expected.fixCount}，实际 ${actual.fixCount}`);
  }
  if (expected.recommendedMentions !== undefined) {
    // 数组要逐项检查 —— 直接 String.includes(array) 会被拼成 "a,b" 一次匹配，永远不命中
    // 查标题 + 说明：planner 的契约是"方案必须点名具体文件与改什么"
    const mentioned = `${actual.recommendedTitle}\n${actual.recommendedDescription}`;
    if (!expected.recommendedMentions.some((kw) => mentioned.includes(kw))) {
      out.push(
        `推荐方案（标题+说明）不含任何一个真值关键词 ${JSON.stringify(expected.recommendedMentions)}：` +
        `${actual.recommendedTitle} / ${actual.recommendedDescription}`,
      );
    }
  }
  if (expected.hardTier !== undefined && actual.hardTier !== expected.hardTier) {
    out.push(`硬规则 tier：期望 ${expected.hardTier}，实际 ${actual.hardTier}`);
  }
  if (expected.patchValid !== undefined && actual.patchValid !== expected.patchValid) {
    out.push(`推荐方案 patch 合法性：期望 ${expected.patchValid}，实际 ${actual.patchValid}`);
  }
  if (expected.patchApplies !== undefined && actual.patchApplies !== expected.patchApplies) {
    out.push(`补丁能否应用到快照：期望 ${expected.patchApplies}，实际 ${actual.patchApplies}`);
  }
  return out;
}
