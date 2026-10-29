/**
 * sentinel run — 主入口。整个 vertical slice：
 *   project.scanned → mapper → runner → analyst → critic → planner → enhancer → executor → reporter
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  Budget,
  Kernel,
  type BugFinding,
  type Evidence,
  type FeatureMap,
  type FixOption,
  type Subagent,
} from '@sentinel/core';
import {
  createOpenAICompatibleProvider,
  createOllamaNativeProvider,
  createNoneMemory,
  createMarkdownSkills,
  createMCPRegistry,
  createBrowserMCPServer,
  createHttpMCPServer,
  createFsMCPServer,
  createGithubKnowledge,
  createStackOverflowKnowledge,
  createOfflineLLMProvider,
} from '@sentinel/providers';
import {
  createMapper,
  createSensor,
  createRunner,
  createInspector,
  createAnalyst,
  createCritic,
  createVerifier,
  createPlanner,
  createEnhancer,
  createExecutor,
  PRESETS,
  DEFAULT_WEIGHTS,
} from '@sentinel/subagents';
import {
  reportToMarkdown,
  reportToJson,
  printBug,
  printSummary,
  aggregateDuplicateBugs,
  isToolFailure,
  createBugCollector,
  applyTierDecisions,
  buildCoverageInfo,
  coverageIsUninformative,
  type CoverageInfo,
  type TierDecisionRecord,
  color,
} from '@sentinel/reporters';
import { loadBudgetConfig, loadLlmConfig, projectRoot } from './config.js';
import { createStatusEventCollector } from './status-events.js';
import { collectConfigChecks } from './doctor.js';
import { demoBugs } from './demo.js';
import { autoInit } from './auto-init.js';
import { startDevServer, type DevServerHandle } from './dev-server.js';

export interface RunOptions {
  detailed?: boolean;
  noEnhance?: boolean;
  demo?: boolean;
  maxTier?: 0 | 1 | 2 | 3;
  reportFormat?: 'markdown' | 'json' | 'both';
  /** 允许 Tier 1 真正改动被测项目源码（默认关闭） */
  autoFix?: boolean;
  /** 允许为 Tier 2 方案生成 PR（默认关闭） */
  createPr?: boolean;
  /** 强制离线：不调用 LLM、不联网（没有 LLM 配置时也会自动进入） */
  offline?: boolean;
  /** 显式指定 dev server 端口（--port） */
  port?: number;
  /** 显式指定被测地址（--url）—— 不自启 dev server，直接测这个地址 */
  url?: string;
}

/** 导出以便单测：参数解析是纯函数，越界/格式错必须在这里被挡住 */
export function parseRunOptions(): RunOptions {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(f);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i === -1 ? undefined : argv[i + 1];
  };
  const out: RunOptions = {
    detailed: has('--detailed'),
    noEnhance: has('--no-enhance'),
    demo: has('--demo'),
    // 这两个开关会改动被测项目 / 产生外部可见动作，必须显式开启
    autoFix: has('--auto-fix'),
    createPr: has('--create-pr'),
    offline: has('--offline'),
  };
  const tier = get('--tier');
  if (tier !== undefined) {
    const n = Number(tier);
    if (n === 0 || n === 1 || n === 2 || n === 3) out.maxTier = n;
  }
  const fmt = get('--report');
  if (fmt === 'markdown' || fmt === 'json' || fmt === 'both') out.reportFormat = fmt;
  // --port / --url 是逃生口：端口推断错了、服务在别的地址时，用户可以直接指定
  const port = get('--port');
  if (port !== undefined) {
    if (/^\d+$/.test(port)) {
      const n = Number(port);
      // 越界端口会让 socket 层抛 ERR_SOCKET_BAD_PORT，
      // 用户看到的是一句裸的 "Fatal: Port should be >= 0 and < 65536" ——
      // 必须在这里拦下来并说人话。0 也不行（= 让系统随机端口，等于白等 30s）。
      if (n < 1 || n > 65535) {
        throw new Error(`--port 必须在 1-65535 之间，收到 ${n}`);
      }
      out.port = n;
    } else {
      throw new Error(`--port 必须是数字，收到 "${port}"`);
    }
  }
  const url = get('--url');
  if (url !== undefined) {
    if (!/^https?:\/\//i.test(url)) throw new Error(`--url 必须是 http(s) 地址，收到 "${url}"`);
    out.url = url;
  }
  return out;
}

export async function runRun(): Promise<number> {
  const root = projectRoot();
  let opts: RunOptions;
  try {
    opts = parseRunOptions();
  } catch (err) {
    // 参数写错是用户输入问题，不是内部故障 —— 说人话，给用法，别抛 "Fatal"
    console.error(color.red((err as Error).message));
    console.error(color.dim('   用法: --port <1-65535>   --url http://127.0.0.1:3000'));
    return 2;
  }

  console.log(color.cyan('🛰  Sentinel run'));
  console.log(color.dim(`   project: ${root}`));
  console.log('');

  if (opts.demo === true) {
    const bugs = demoBugs();
    console.log(color.yellow('demo mode: no LLM key required'));
    console.log('');
    console.log(printSummary(bugs));
    console.log('');
    for (const b of bugs) {
      console.log(printBug(b));
    }
    await writeReports(root, bugs, opts.reportFormat ?? 'both', [], 'offline');
    console.log('');
    console.log(color.dim('tokens: 0  cost: $0.0000  duration: demo'));
    console.log(color.dim('reports/sentinel-latest.{md,json}'));
    return 0;
  }

  // 1. 自动初始化（如果需要）
  await autoInit(root);

  // 2. 加载配置
  const llmCfg = await loadLlmConfig(root);
  // 离线模式：没有 LLM（或显式 --offline）时自动进入。
  // 这是 Sentinel 的目标之一：没有本地模型、没有网络，也能测出 web 项目的确定性错误。
  let offline = opts.offline === true || !llmCfg;
  let llmMode: 'llm' | 'offline' = offline ? 'offline' : 'llm';
  const budgetCfg = await loadBudgetConfig(root);
  const stage = budgetCfg.stage;
  const weights = budgetCfg.weights ?? PRESETS[stage.toLowerCase() as keyof typeof PRESETS] ?? DEFAULT_WEIGHTS;

  // 2.5 前置门禁（宪法：配置本身坏了 → run 拒绝启动；LLM 不可达不阻塞，可降级）
  //     离线模式下跳过 LLM 探测 —— 探测本身就是外网请求。
  const configChecks = await collectConfigChecks(root, { skipLlmProbe: offline });
  const configFails = configChecks.filter((c) => c.status === 'fail' && c.blocking !== false);
  if (configFails.length > 0) {
    console.error(color.red('✗ Pre-flight checks failed — run refused to start:'));
    for (const c of configFails) {
      console.error(`  ${color.red('✗')} ${c.name}: ${c.message}`);
      if (c.suggestion) console.error(color.dim(`    → ${c.suggestion}`));
    }
    console.error(color.dim('   完整自检：sentinel doctor --project=' + root));
    return 2;
  }
  const softFails = configChecks.filter((c) => c.status === 'fail' && c.blocking === false);
  for (const c of softFails) {
    console.log(color.yellow(`⚠  ${c.name}: ${c.message}`));
    if (c.suggestion) console.log(color.dim(`   → ${c.suggestion}`));
    console.log(color.dim('   该项不阻塞运行，诊断将降级为启发式。'));
  }

  // 2.6 LLM 探不通 → 整轮转离线。
  // 为什么不在每个子代理里各降级一次：子代理的 LLM 超时是 180s，
  // 四个子代理各等一次 = 一轮 run 白等十几分钟，还每次都失败。
  // 一次探测（10s 超时）判死活，然后整轮走离线路径 —— 一次等待，全轮可用。
  if (!offline) {
    const llmProbe = configChecks.find((c) => c.name === 'LLM API');
    if (llmProbe?.status === 'fail') {
      offline = true;
      llmMode = 'offline';
      console.log(color.yellow('⚡ LLM 不可达 → 本次自动转为离线模式（不调用模型、不联网）'));
    }
  }

  if (offline) {
    console.log(color.yellow('⚡ 离线模式：不调用 LLM、不联网'));
    console.log(color.dim('   仍会做巡检（控制台报错 / 失败请求 / 5xx / 白屏 / 基础可访问性），但不做 AI 根因分析。'));
    if (opts.offline === true && llmCfg) {
      console.log(color.dim('   （--offline 显式开启：已忽略 .sentinel/llm.yml）'));
    }
    console.log('');
  }

  // 3. 自动启动 dev server（如果需要）
  let devServer: DevServerHandle | null = null;
  devServer = await startDevServer(root, {
    ...(opts.port !== undefined && { port: opts.port }),
    ...(opts.url !== undefined && { url: opts.url }),
  });
  if (!devServer) {
    console.error(color.red('No reachable project dev server. Check package.json scripts and run sentinel doctor.'));
    console.error(color.dim('   也可以用 --port <端口> 或 --url <地址> 显式指定被测服务。'));
    return 2;
  }
  const baseUrl = devServer.baseUrl;

  // 4. 构建 providers
  // 两个口径必须分开：
  //   maxCompletionTokens —— 输出 token，对应 max_tokens 参数（配置上限比的就是它）
  //   maxTotalTokens      —— 输入+输出，对应预算消耗（budget.consume 用的是 totalTokens）
  // 之前只记 totalTokens 却和 max_tokens 配置放在一起比，数字看着"超限"其实是口径混用。
  const llmStats = { requests: 0, maxCompletionTokens: 0, maxTotalTokens: 0 };
  // 离线模式用"一定会失败的桩" —— 任何试图调用模型的地方立刻拿到明确错误，
  // 而不是各处写 if (!llm) 判断、漏一处就静默降级。
  const llm = offline
    ? createOfflineLLMProvider()
    : withRequestCounter(buildLlm(llmCfg!, budgetCfg.limits.maxTokensPerRequest), llmStats);
  const memory = createNoneMemory();
  const skills = createMarkdownSkills({ root: join(root, '.sentinel/skills') });
  const mcp = createMCPRegistry();
  mcp.register(createHttpMCPServer({ ...(baseUrl ? { baseUrl } : {}) }));
  mcp.register(createFsMCPServer({ root }));
  const browser = createBrowserMCPServer({ detailed: opts.detailed === true, baseUrl });
  let preflight: { message: string; status: number } | null = null;
  if (devServer.homepageStatus >= 500) {
    // dev server 已经等过首页（45s）仍返回 5xx —— 应用自身在报错，不必再问浏览器
    preflight = { message: `首页返回 HTTP ${devServer.homepageStatus}`, status: devServer.homepageStatus };
    console.log(color.yellow(`⚠  Preflight: ${preflight.message}`));
    console.log(color.dim('   应用已启动但首页返回 5xx —— 继续执行，将作为 bug 记录。'));
  } else {
    try {
      await browser.call('visit', { url: baseUrl });
    } catch (err) {
      const message = (err as Error).message;
      const status = Number(/returned HTTP (\d{3})/.exec(message)?.[1] ?? 0);
      if (status < 500) {
        // 连不上 dev server —— 没有可诊断的对象，直接退出
        try { await browser.call('close', {}); } catch { /* preserve the preflight error */ }
        devServer.stop();
        console.error(color.red(`Browser preflight failed: ${message}`));
        return 2;
      }
      // 应用已启动但首页返回 5xx —— 这是被测项目的缺陷，必须留下诊断而不是静默退出
      preflight = { message, status };
      console.log(color.yellow(`⚠  Preflight: ${message}`));
      console.log(color.dim('   应用已启动但首页返回 5xx —— 继续执行，将作为 bug 记录。'));
    }
  }
  mcp.register(browser);
  const knowledge = [createGithubKnowledge({}), createStackOverflowKnowledge()];

  // 未配置模型价格时仍限制 tokens 与时长，不把未知 API 费用当作 $0。
  const activeProvider = offline ? undefined : llmCfg!.providers[llmCfg!.default];
  const costKnown = offline
    ? false
    : activeProvider?.type === 'ollama-native' || Boolean(activeProvider?.pricing);
  if (!offline && !costKnown) {
    console.log(color.yellow('API price unknown: USD budget cannot be enforced; token limit remains active.'));
    console.log(color.dim('   → 在 .sentinel/llm.yml 的 provider 下加 pricing（USD / 每百万 token）即可启用美元上限'));
  }
  if (budgetCfg.limits.maxTokensPerRequest === undefined) {
    console.log(color.yellow('maxTokensPerRequest not set: a single long response is not capped.'));
    console.log(color.dim('   → budget.yml 的 limits 加 maxTokensPerRequest（如 8000）可限制单次响应长度'));
  }
  const budget = new Budget({
    ...(budgetCfg.limits.maxTokensPerRun !== undefined && { maxTokens: budgetCfg.limits.maxTokensPerRun }),
    ...(costKnown && budgetCfg.limits.maxCostUsdPerRun !== undefined && { maxUsd: budgetCfg.limits.maxCostUsdPerRun }),
    ...(budgetCfg.limits.maxDurationSecPerRun !== undefined && {
      maxDurationMs: budgetCfg.limits.maxDurationSecPerRun * 1000,
    }),
  });

  // 4. 收集 BugFinding（带 fixOptions）的捕获器
  // 收集逻辑放在 reporters 的 createBugCollector 里 —— 它必须能被真实代码路径的测试直接覆盖。
  const collector = createBugCollector();
  const failedFlowIds = new Set<string>();
  let insufficientEvidenceCount = 0;
  const insufficientEvidence: Array<{ bugId?: string; reason?: string }> = [];
  const rejectedBugs: Array<{ bugId: string; reason: string }> = [];
  const appliedPatches: Array<{
    fixId: string;
    files: string[];
    flowId?: string;
    status: 'applied' | 'reverted';
    reason?: string;
  }> = [];
  // 过程事件的收集器（可测模块）—— 之前这些信息根本没有出口：
  // 硬规则 tier 判定、落盘待审的 patch、被拒的补丁、建好的 PR、预算超限、证据采集失败
  const statusEvents = createStatusEventCollector();
  let plannedFlows = 0;
  let passedFlows = 0;
  let failedFlows = 0;
  // 修复后重跑（phase='after-fix'）单独计数，不混进首轮的 p/f
  let rerunPassedFlows = 0;
  let rerunFailedFlows = 0;
  const coverage = { map: null as FeatureMap | null };

  // preflight 发现首页 5xx —— 记为一条可复现的缺陷，不静默退出
  if (preflight) {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(`${preflight.status}:${baseUrl}`).digest('hex').slice(0, 16);
    const evidence: Evidence = {
      kind: 'http',
      source: 'api',
      hash,
      timestamp: Date.now(),
      url: baseUrl,
      method: 'GET',
      status: preflight.status,
      bodySummary: preflight.message.slice(0, 400),
    };
    collector.bugs.push({
      id: `bug_preflight_${Date.now().toString(36)}`,
      title: `首页返回 HTTP ${preflight.status}`,
      severity: 'P0',
      source: 'ui',
      affectedFeature: '首页',
      symptom: preflight.message,
      reproSteps: [`访问 ${baseUrl}`, `观察首页返回 HTTP ${preflight.status}`],
      evidence: [evidence],
      rootCauseStatus: 'hypothesis',
      counterEvidence: [],
      confidence: 0.6,
      fixOptions: [],
    });
  }
  // 过程状态：map 失败 / 知识检索过程 —— 都必须有出口
  const mapFailures: Array<{ error: string }> = [];
  const knowledgeRequests: Array<{ query: string; sources: string[] }> = [];
  const knowledgeResults: Array<{ count: number }> = [];
  const knowledgeCacheHits: Array<{ key: string; ttl: number }> = [];

  const captureSub: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<FeatureMap>('map.ready', (event) => {
        plannedFlows = event.payload.flows.length;
        coverage.map = event.payload;
      });
      // 项目理解失败：没有 map 就跑不了任何流程 —— 原因必须留在状态里
      ctx.bus.subscribe<{ error: string }>('map.failed', (e) => {
        mapFailures.push({ error: e.payload.error });
        console.error(color.red(`✗ 项目理解失败：${e.payload.error}`));
        console.error(color.dim('   没有 FeatureMap 就无法生成流程 —— 报告会是空的，这不是"项目没问题"。'));
      });
      // 知识检索过程：之前 M6 是完全黑盒的（搜没搜、搜到几条、是不是缓存，全查不到）
      ctx.bus.subscribe<{ query: string; sources: string[] }>('knowledge.requested', (e) => {
        knowledgeRequests.push({ query: e.payload.query, sources: e.payload.sources });
      });
      ctx.bus.subscribe<unknown[]>('knowledge.received', (e) => {
        knowledgeResults.push({ count: e.payload.length });
      });
      ctx.bus.subscribe<{ key: string; ttl: number }>('knowledge.cached', (e) => {
        knowledgeCacheHits.push({ key: e.payload.key, ttl: e.payload.ttl });
      });
      // 流程计数必须**分阶段**：
      // 修复后的重跑（phase='after-fix'）会把同一条 flow 再跑一遍，
      // 如果和首轮混在一起数，passed+failed 会比 planned 多 1 ——
      // 判据「p+f == planned」就永远不成立，而且"哪些 flow 真跑过"也说不清。
      ctx.bus.subscribe<{ flowId: string; phase?: string }>('flow.passed', (e) => {
        if (e.payload.phase === 'after-fix') { rerunPassedFlows += 1; return; }
        passedFlows += 1;
      });
      ctx.bus.subscribe<{ flowId: string; phase?: string }>('flow.failed', (e) => {
        if (e.payload.phase === 'after-fix') { rerunFailedFlows += 1; return; }
        failedFlows += 1;
        failedFlowIds.add(e.payload.flowId);
      });
      // 失败但没有任何 bug 覆盖的 flow 才算"未解决"；有诊断的失败是已处理。
      ctx.bus.subscribe<{ bugId?: string; reason?: string }>('bug.insufficient_evidence', (e) => {
        insufficientEvidenceCount += 1;
        insufficientEvidence.push({
          ...(e.payload.bugId && { bugId: e.payload.bugId }),
          ...(e.payload.reason && { reason: e.payload.reason }),
        });
      });
      // 未确认根因也保留可复现症状与证据，供用户查看与补充诊断。
      ctx.bus.subscribe<BugFinding>('bug.draft', (e) => {
        collector.onDraft(e.payload);
      });
      // 修复/回滚结果必须落到状态里 —— 否则"改完有没有验证过"查不到
      ctx.bus.subscribe<{ fixId: string; files: string[]; flowId?: string }>('patch.applied', (e) => {
        appliedPatches.push({
          fixId: e.payload.fixId,
          files: e.payload.files,
          ...(e.payload.flowId && { flowId: e.payload.flowId }),
          status: 'applied',
        });
      });
      ctx.bus.subscribe<{ fixId: string; files: string[]; flowId?: string; reason: string }>('patch.reverted', (e) => {
        const idx = appliedPatches.findIndex((p) => p.fixId === e.payload.fixId);
        const entry = {
          fixId: e.payload.fixId,
          files: e.payload.files,
          ...(e.payload.flowId && { flowId: e.payload.flowId }),
          status: 'reverted' as const,
          reason: e.payload.reason,
        };
        if (idx >= 0) appliedPatches[idx] = entry;
        else appliedPatches.push(entry);
      });
      // executor 的硬规则判定不能丢 —— 报告第 11 字段必须展示它，
      // 否则会出现"报告说 Tier 1 能自动修、实际没改"且用户查不到原因
      ctx.bus.subscribe<{ fixId: string; tier: 0 | 1 | 2 | 3; reason: string; llmTier?: number }>(
        'executor.tier_decided',
        (e) => statusEvents.onTierDecided(e.payload),
      );
      // 落盘待审的 patch —— 用户要知道"建议改哪个文件、去哪看"
      ctx.bus.subscribe<{ fixId: string; files: string[]; applied: boolean; approvalRequired: boolean }>(
        'patch.generated',
        (e) => statusEvents.onPatchGenerated(e.payload),
      );
      // 补丁被拒 —— 原因必须能看到（不在白名单 / 应用失败）
      ctx.bus.subscribe<{ fixId: string; reason: string }>('patch.rejected', (e) => {
        statusEvents.onPatchRejected(e.payload);
      });
      // PR —— 建了哪个 PR、地址与分支
      ctx.bus.subscribe<{ fixId: string; title: string; url?: string; branch?: string }>('pr.created', (e) => {
        statusEvents.onPrCreated(e.payload);
      });
      // 预算超限 —— 哪一项超了、上限是多少
      ctx.bus.subscribe<{ kind: string; limit: number }>('budget.exceeded', (e) => {
        statusEvents.onBudgetExceeded(e.payload);
      });
      // 证据采集失败 —— 诊断不完整时必须说出来
      ctx.bus.subscribe<{ error: string; kind: string }>('evidence.failed', (e) => {
        statusEvents.onEvidenceFailed(e.payload);
      });
      // critic 的裁决理由不能丢 —— 否则"为什么没确认"永远查不到
      ctx.bus.subscribe<{ bugId: string; reason: string }>('bug.rejected', (e) => {
        rejectedBugs.push({ bugId: e.payload.bugId, reason: e.payload.reason });
      });
      // 合并而不是覆盖 —— bus 顺序 await 分发，事件到达顺序是"深层先到、浅层后到"：
      // verifier→planner→enhancer→fix.enhanced（带 fixOptions）先到，
      // critic 的原始 bug.confirmed（fixOptions 仍是空数组）后到。
      // 覆盖语义会把 planner 的方案抹成空数组 → 报告第 7/8 字段永远显示"待 planner 产出"。
      // 合并逻辑在 reporters.createBugCollector 里，可被真实代码路径的测试覆盖。
      ctx.bus.subscribe<BugFinding>('bug.confirmed', (e) => {
        collector.onConfirmed(e.payload);
      });
      // 再捕获 enhancer 出的最终版本（含 fixOptions + sources）
      ctx.bus.subscribe<{ bug: BugFinding; options: FixOption[] }>('fix.enhanced', (e) => {
        collector.onEnhanced(e.payload.bug);
      });
    },
  };

  // 5. 装配 kernel
  const subagents: Subagent[] = [
    createMapper(),
    createSensor({ detailed: opts.detailed === true }),
    createRunner({ detailed: opts.detailed === true }),
    // 巡检器：确定性规则，不依赖 LLM —— 有没有模型都会跑
    createInspector(),
    createAnalyst(),
    createVerifier(),
    createPlanner({ stage, weights, requireVerified: true, offline }),
  ];
  // critic 是"LLM 反向验证"环节：没有模型时它做不了这件事，
  // 硬跑只会把每条发现都拒掉（理由：critic verification unavailable），制造噪音。
  // 所以离线模式不注册它 —— 未确认的发现仍然以 draft 形式出现在报告里。
  if (!offline) {
    subagents.push(createCritic());
  }
  // 离线模式必须彻底关掉外部知识检索 —— 目标就是"没有网络也能用"
  subagents.push(createEnhancer({ skipSearch: opts.noEnhance === true || offline }));
  subagents.push(
    createExecutor({
      // 默认 3 = 宪法定义的 Tier 1/2/3 各自产出对应产物；
      // 真正改用户代码仍然要显式 --auto-fix。
      maxTier: opts.maxTier ?? 3,
      projectRoot: root,
      // 改用户源码、推分支、开 PR 都是对外部状态的可见改动 —— 必须显式开启
      autoApply: opts.autoFix === true,
      createPr: opts.createPr === true,
      // 离线模式：方案来自模板而不是模型，报告措辞要跟着变
      offline,
    }),
  );
  subagents.push(captureSub);

  const kernel = new Kernel({
    providers: { llm, memory, skills, mcp, knowledge },
    budget,
    subagents,
  });

  // 6. 启动
  const startMs = Date.now();
  let failed = false;
  try {
    await kernel.kick('project.scanned', { root }, 'cli');
  } catch (err) {
    failed = true;
    const message = (err as Error).message;
    const isBudget = /budget\.(tokens|usd|duration) exceeded/.test(message);
    console.error(
      color.red(
        isBudget
          ? `✗ run 因预算护栏中断：${message}`
          : `✗ run failed: ${message}`,
      ),
    );
    if (isBudget) {
      console.error(
        color.dim(
          '   已产出的诊断保留在报告里；未执行完的流程记在 run-status.json 的 untestedFlows。',
        ),
      );
    }
  } finally {
    try {
      await kernel.stop();
    } finally {
      try { await browser.call('close', {}); } finally {
        devServer.stop();
        console.log(color.dim('   Dev server stopped.'));
      }
    }
  }
  const dur = Date.now() - startMs;

  // 7. 输出报告（同源错误先聚合，避免几十条同质问题淹没用户）
  // 报告里的 tier 必须是硬规则判出来的那个（不是 LLM 自报的）
  const reportedBugs = aggregateDuplicateBugs(applyTierDecisions(collector.bugs, statusEvents.tierDecisions));
  const coverageInfo = buildCoverageInfo(coverage.map, {
    plannedFlows,
    passedFlows,
    failedFlows,
    mapFailures: mapFailures.map((f) => f.error),
  });
  console.log('');
  console.log(printSummary(reportedBugs));
  console.log('');
  // 终端也必须说清"没测到东西 ≠ 没问题" ——
  // 只在报告文件里写，盯着终端输出的用户还是会把 0 个 bug 读成"项目健康"。
  if (coverageIsUninformative(coverageInfo)) {
    console.log(
      color.yellow(
        `⚠  本次未识别到可测目标（页面 ${coverageInfo.pages} / 接口 ${coverageInfo.api} / 流程 ${coverageInfo.plannedFlows}）—— 本次结果没有任何信息量，不代表项目健康。`,
      ),
    );
    if (coverageInfo.mapFailures.length > 0) {
      for (const f of coverageInfo.mapFailures) console.log(color.dim(`   项目理解失败：${f}`));
    } else {
      console.log(
        color.dim(
          '   Next.js 项目开箱即用；其它框架需手写 .sentinel/app.map.ts 声明可测页面与流程。',
        ),
      );
    }
    console.log('');
  }
  for (const b of reportedBugs) {
    console.log(printBug(b));
  }

  await writeReports(
    root,
    reportedBugs,
    opts.reportFormat ?? 'both',
    statusEvents.tierDecisions,
    llmMode,
    coverageInfo,
    statusEvents.rejectedPatches,
  );

  // 8. 总结
  const usage = budget.snapshot();
  console.log('');
  console.log(color.dim(`flows: ${passedFlows} passed / ${failedFlows} failed / ${Math.max(0, plannedFlows - passedFlows - failedFlows)} not run${rerunPassedFlows + rerunFailedFlows > 0 ? `（修复后重跑：${rerunPassedFlows} passed / ${rerunFailedFlows} failed，不计入上面的口径）` : ''}; tokens: ${usage.tokens}  cost: ${costKnown ? `$${usage.usd.toFixed(4)}` : 'unknown'}  duration: ${dur}ms`));
  console.log(
    color.dim(
      offline
        ? `llm: 离线模式（未调用 LLM、未联网）· 巡检结论为确定性规则判定`
        : `llm: ${llmStats.requests} 次请求` +
            ` / 单次输出最多 ${llmStats.maxCompletionTokens} tokens` +
            `（配置上限 ${budgetCfg.limits.maxTokensPerRequest ?? '未设'}）` +
            ` / 单次总计最多 ${llmStats.maxTotalTokens} tokens` +
            `  → 预算 token 上界 ${llmStats.requests * llmStats.maxTotalTokens}` +
            `  预算模式 ${costKnown ? 'usd+token' : 'token-only'}`,
    ),
  );
  const uncovered = [...failedFlowIds].filter((id) => !collector.coveredFlows.has(id));
  if (uncovered.length > 0) {
    console.log(color.yellow(`   未产生诊断的失败 flow: ${uncovered.join(', ')}`));
  }
  if (rejectedBugs.length > 0) {
    console.log(color.yellow(`   critic 未确认 ${rejectedBugs.length} 条（原因见 run-status.json）:`));
    for (const r of rejectedBugs.slice(0, 3)) {
      console.log(color.dim(`     ${r.bugId}: ${r.reason.slice(0, 160)}`));
    }
  }
  if (appliedPatches.length > 0) {
    const reverted = appliedPatches.filter((p) => p.status === 'reverted').length;
    console.log(
      color.yellow(
        `   已应用 ${appliedPatches.length} 个修复${reverted ? `，其中 ${reverted} 个验证未通过已回滚` : ''}（详见 run-status.json）`,
      ),
    );
  }
  if (insufficientEvidence.length > 0) {
    console.log(color.yellow(`   证据不足 ${insufficientEvidence.length} 条（见 run-status.json）`));
    for (const i of insufficientEvidence.slice(0, 3)) {
      if (i.reason) console.log(color.dim(`     ${i.reason.slice(0, 160)}`));
    }
  }
  console.log(color.dim(`reports/sentinel-latest.{md,json}`));

  // 未解决 = 失败却没有对应诊断的 flow；证据不足的失败也算未解决。
  const unresolvedFlowIds = [...failedFlowIds].filter((id) => !collector.coveredFlows.has(id));
  const unresolvedFailures =
    unresolvedFlowIds.length + (failedFlowIds.size === 0 ? insufficientEvidenceCount : 0);
  const notRunFlows = Math.max(0, plannedFlows - passedFlows - failedFlows);
  const incomplete = failed || unresolvedFailures > 0 || plannedFlows === 0 || notRunFlows > 0;
  await writeFile(join(root, 'reports', 'sentinel-run-status.json'), JSON.stringify({
    status: incomplete ? 'incomplete' : 'complete',
    // 本次运行模式：offline = 没调用 LLM、没联网（结论只来自确定性规则）
    llmMode,
    plannedFlows, passedFlows, failedFlows,
    // 修复后重跑单独计数：口径写清楚，避免与首轮 p/f 相加后看不出真实情况
    rerunPassedFlows, rerunFailedFlows,
    untestedFlows: notRunFlows,
    unresolvedFlows: unresolvedFlowIds,
    insufficientEvidenceCount,
    // 为什么没拿到根因 / 为什么没被确认 —— 不再静默丢弃
    insufficientEvidence,
    rejectedBugs,
    appliedPatches,
    // 硬规则 tier 判定：每个方案最终被判成哪一档、依据是什么
    tierDecisions: statusEvents.tierDecisions,
    // 过程信息：之前这些都查不到（事件发出但没人消费）
    generatedPatches: statusEvents.generatedPatches,
    rejectedPatches: statusEvents.rejectedPatches,
    createdPrs: statusEvents.createdPrs,
    budgetExceeded: statusEvents.budgetExceeded,
    evidenceFailures: statusEvents.evidenceFailures,
    bugCount: collector.bugs.length,
    reportedBugCount: reportedBugs.length,
    toolFailures: reportedBugs.filter((b) => isToolFailure(b)).length,
    costUsd: costKnown ? usage.usd : null, durationMs: dur,
    // 预算护栏口径（可核对，不靠猜）
    costMode: costKnown ? 'usd+token' : 'token-only',
    llmRequests: llmStats.requests,
    // 口径写清楚：观测值分"输出"与"总计"两个字段，不共用一个名字
    maxCompletionTokensObserved: llmStats.maxCompletionTokens,
    maxTotalTokensObserved: llmStats.maxTotalTokens,
    maxTokensPerRequestConfigured: budgetCfg.limits.maxTokensPerRequest ?? null,
    tokenUpperBound: llmStats.requests * llmStats.maxTotalTokens,
    // 项目理解失败（有 map 失败时，后面这些数字全是 0，报告会是空的）
    mapFailures,
    // 知识检索过程：搜了什么、搜到几条、是不是缓存
    knowledgeRequests,
    knowledgeResults,
    knowledgeCacheHits,
    discoveredPages: coverage.map?.pages.length ?? 0,
    discoveredApi: coverage.map?.api.length ?? 0,
    coverageRisks: coverage.map?.risks.filter((risk) => risk.id.startsWith('coverage_')) ?? [],
  }, null, 2), 'utf8');
  if (incomplete) return 2;
  // 工具性失败不是被测项目的缺陷，不应让"项目有问题"的退出码被触发
  const projectBugs = reportedBugs.filter((b) => !isToolFailure(b));
  return projectBugs.some((b) => b.severity === 'P0' || b.severity === 'P1') ? 1 : 0;
}

function buildLlm(
  llmCfg: NonNullable<Awaited<ReturnType<typeof loadLlmConfig>>>,
  maxTokensPerRequest?: number,
) {
  const cfg = llmCfg.providers[llmCfg.default];
  if (!cfg) throw new Error(`provider ${llmCfg.default} not found`);
  if (cfg.type === 'openai-compatible') {
    return createOpenAICompatibleProvider({
      baseUrl: cfg.baseUrl ?? '',
      apiKey: cfg.apiKey ?? '',
      model: cfg.model,
      ...(cfg.pricing ? { pricing: cfg.pricing } : {}),
      ...(maxTokensPerRequest !== undefined && { maxTokensPerRequest }),
    });
  }
  return createOllamaNativeProvider({
    ...(cfg.baseUrl && { baseUrl: cfg.baseUrl }),
    model: cfg.model,
  });
}

/**
 * 给 provider 包一层计数器 —— LLMProvider 是接口（core 未改），包一层即可统计请求数。
 * 「请求次数 × 单次最大 token」= 本次 run 的 token 上界，用于核对预算护栏是否够用。
 */
function withRequestCounter(
  provider: ReturnType<typeof buildLlm>,
  stats: { requests: number; maxCompletionTokens: number; maxTotalTokens: number },
): typeof provider {
  return {
    name: provider.name,
    supportsTools: provider.supportsTools,
    estimateCost: (tokens: number) => provider.estimateCost(tokens),
    async chat(messages, options) {
      stats.requests += 1;
      const res = await provider.chat(messages, options);
      if (res.usage.completionTokens > stats.maxCompletionTokens) {
        stats.maxCompletionTokens = res.usage.completionTokens;
      }
      if (res.usage.totalTokens > stats.maxTotalTokens) {
        stats.maxTotalTokens = res.usage.totalTokens;
      }
      return res;
    },
  };
}

async function writeReports(
  root: string,
  bugs: BugFinding[],
  format: 'markdown' | 'json' | 'both',
  tierDecisions: TierDecisionRecord[] = [],
  llmMode: 'llm' | 'offline' = 'llm',
  coverage?: CoverageInfo,
  rejectedPatches: Array<{ fixId: string; reason: string }> = [],
): Promise<void> {
  const dir = join(root, 'reports');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  if (format === 'markdown' || format === 'both') {
    const md = reportToMarkdown(
      bugs,
      { project: root.split('/').pop() ?? 'project', llmMode },
      { tierDecisions, llmMode, ...(coverage ? { coverage } : {}), rejectedPatches },
    );
    await writeFile(join(dir, 'sentinel-latest.md'), md, 'utf8');
  }
  if (format === 'json' || format === 'both') {
    const json = reportToJson(bugs, {
      project: root.split('/').pop() ?? 'project',
      llmMode,
      ...(coverage ? { coverage } : {}),
      tierDecisions,
      rejectedPatches,
    });
    await writeFile(join(dir, 'sentinel-latest.json'), JSON.stringify(json, null, 2), 'utf8');
  }
}
