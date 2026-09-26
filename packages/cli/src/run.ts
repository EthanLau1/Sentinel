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
} from '@sentinel/providers';
import {
  createMapper,
  createSensor,
  createRunner,
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
  color,
} from '@sentinel/reporters';
import { loadBudgetConfig, loadLlmConfig, projectRoot } from './config.js';
import { demoBugs } from './demo.js';
import { autoInit } from './auto-init.js';
import { startDevServer, type DevServerHandle } from './dev-server.js';

export interface RunOptions {
  detailed?: boolean;
  noEnhance?: boolean;
  demo?: boolean;
  maxTier?: 0 | 1 | 2 | 3;
  reportFormat?: 'markdown' | 'json' | 'both';
}

function parseRunOptions(): RunOptions {
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
  };
  const tier = get('--tier');
  if (tier !== undefined) {
    const n = Number(tier);
    if (n === 0 || n === 1 || n === 2 || n === 3) out.maxTier = n;
  }
  const fmt = get('--report');
  if (fmt === 'markdown' || fmt === 'json' || fmt === 'both') out.reportFormat = fmt;
  return out;
}

export async function runRun(): Promise<number> {
  const root = projectRoot();
  const opts = parseRunOptions();

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
    await writeReports(root, bugs, opts.reportFormat ?? 'both');
    console.log('');
    console.log(color.dim('tokens: 0  cost: $0.0000  duration: demo'));
    console.log(color.dim('reports/sentinel-latest.{md,json}'));
    return 0;
  }

  // 1. 自动初始化（如果需要）
  await autoInit(root);

  // 2. 加载配置
  const llmCfg = await loadLlmConfig(root);
  if (!llmCfg) {
    console.error(color.red('✗ .sentinel/llm.yml not found after init. Please configure LLM provider.'));
    console.error(color.dim('  Open Sentinel WebUI to configure: sentinel ui'));
    return 1;
  }
  const budgetCfg = await loadBudgetConfig(root);
  const stage = budgetCfg.stage;
  const weights = budgetCfg.weights ?? PRESETS[stage.toLowerCase() as keyof typeof PRESETS] ?? DEFAULT_WEIGHTS;

  // 3. 自动启动 dev server（如果需要）
  let devServer: DevServerHandle | null = null;
  devServer = await startDevServer(root);
  if (!devServer) {
    console.error(color.red('No reachable project dev server. Check package.json scripts and run sentinel doctor.'));
    return 2;
  }
  const baseUrl = `http://127.0.0.1:${devServer.port}`;

  // 4. 构建 providers
  const llm = buildLlm(llmCfg);
  const memory = createNoneMemory();
  const skills = createMarkdownSkills({ root: join(root, '.sentinel/skills') });
  const mcp = createMCPRegistry();
  mcp.register(createHttpMCPServer({ ...(baseUrl ? { baseUrl } : {}) }));
  mcp.register(createFsMCPServer({ root }));
  const browser = createBrowserMCPServer({ detailed: opts.detailed === true, baseUrl });
  try {
    await browser.call('visit', { url: baseUrl });
  } catch (err) {
    try { await browser.call('close', {}); } catch { /* preserve the preflight error */ }
    devServer.stop();
    console.error(color.red(`Browser preflight failed: ${(err as Error).message}`));
    return 2;
  }
  mcp.register(browser);
  const knowledge = [createGithubKnowledge({}), createStackOverflowKnowledge()];

  // 未配置模型价格时仍限制 tokens 与时长，不把未知 API 费用当作 $0。
  const activeProvider = llmCfg.providers[llmCfg.default];
  const costKnown = activeProvider?.type === 'ollama-native' || Boolean(activeProvider?.pricing);
  if (!costKnown) console.log(color.yellow('API price unknown: USD budget cannot be enforced; token limit remains active.'));
  const budget = new Budget({
    ...(budgetCfg.limits.maxTokensPerRun !== undefined && { maxTokens: budgetCfg.limits.maxTokensPerRun }),
    ...(costKnown && budgetCfg.limits.maxCostUsdPerRun !== undefined && { maxUsd: budgetCfg.limits.maxCostUsdPerRun }),
    ...(budgetCfg.limits.maxDurationSecPerRun !== undefined && {
      maxDurationMs: budgetCfg.limits.maxDurationSecPerRun * 1000,
    }),
  });

  // 4. 收集 BugFinding（带 fixOptions）的捕获器
  const bugs: BugFinding[] = [];
  let unresolvedFailures = 0;
  let plannedFlows = 0;
  let passedFlows = 0;
  let failedFlows = 0;
  const coverage = { map: null as FeatureMap | null };
  const captureSub: Subagent = {
    name: 'capture',
    register(ctx) {
      ctx.bus.subscribe<FeatureMap>('map.ready', (event) => {
        plannedFlows = event.payload.flows.length;
        coverage.map = event.payload;
      });
      ctx.bus.subscribe('flow.passed', () => {
        passedFlows += 1;
      });
      ctx.bus.subscribe('flow.failed', () => {
        failedFlows += 1;
        unresolvedFailures += 1;
      });
      ctx.bus.subscribe('bug.insufficient_evidence', () => {
        if (unresolvedFailures === 0) unresolvedFailures = 1;
      });
      // 未确认根因也保留可复现症状与证据，供用户查看与补充诊断。
      ctx.bus.subscribe<BugFinding>('bug.draft', (e) => {
        if (!bugs.some((b) => b.id === e.payload.id)) bugs.push(e.payload);
      });
      ctx.bus.subscribe<BugFinding>('bug.confirmed', (e) => {
        const idx = bugs.findIndex((b) => b.id === e.payload.id);
        if (idx >= 0) bugs[idx] = e.payload;
        else bugs.push(e.payload);
      });
      // 再捕获 enhancer 出的最终版本（含 fixOptions + sources）
      ctx.bus.subscribe<{ bug: BugFinding; options: FixOption[] }>('fix.enhanced', (e) => {
        const idx = bugs.findIndex((b) => b.id === e.payload.bug.id);
        if (idx >= 0) bugs[idx] = e.payload.bug;
        else bugs.push(e.payload.bug);
        unresolvedFailures = Math.max(0, unresolvedFailures - 1);
      });
    },
  };

  // 5. 装配 kernel
  const subagents: Subagent[] = [
    createMapper(),
    createSensor({ detailed: opts.detailed === true }),
    createRunner(),
    createAnalyst(),
    createCritic(),
    createVerifier(),
    createPlanner({ stage, weights, requireVerified: true }),
  ];
  subagents.push(createEnhancer({ skipSearch: opts.noEnhance === true }));
  subagents.push(createExecutor({ maxTier: opts.maxTier ?? 1 }));
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
    console.error(color.red(`✗ run failed: ${(err as Error).message}`));
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

  // 7. 输出报告
  console.log('');
  console.log(printSummary(bugs));
  console.log('');
  for (const b of bugs) {
    console.log(printBug(b));
  }

  await writeReports(root, bugs, opts.reportFormat ?? 'both');

  // 8. 总结
  const usage = budget.snapshot();
  console.log('');
  console.log(color.dim(`flows: ${passedFlows} passed / ${failedFlows} failed / ${Math.max(0, plannedFlows - passedFlows - failedFlows)} not run; tokens: ${usage.tokens}  cost: ${costKnown ? `$${usage.usd.toFixed(4)}` : 'unknown'}  duration: ${dur}ms`));
  console.log(color.dim(`reports/sentinel-latest.{md,json}`));

  const incomplete = failed || unresolvedFailures > 0 || plannedFlows === 0 || passedFlows + failedFlows < plannedFlows;
  await writeFile(join(root, 'reports', 'sentinel-run-status.json'), JSON.stringify({
    status: incomplete ? 'incomplete' : 'complete',
    plannedFlows, passedFlows, failedFlows,
    untestedFlows: Math.max(0, plannedFlows - passedFlows - failedFlows),
    bugCount: bugs.length, costUsd: costKnown ? usage.usd : null, durationMs: dur,
    discoveredPages: coverage.map?.pages.length ?? 0,
    discoveredApi: coverage.map?.api.length ?? 0,
    coverageRisks: coverage.map?.risks.filter((risk) => risk.id.startsWith('coverage_')) ?? [],
  }, null, 2), 'utf8');
  if (incomplete) return 2;
  return bugs.some((b) => b.severity === 'P0' || b.severity === 'P1') ? 1 : 0;
}

function buildLlm(llmCfg: NonNullable<Awaited<ReturnType<typeof loadLlmConfig>>>) {
  const cfg = llmCfg.providers[llmCfg.default];
  if (!cfg) throw new Error(`provider ${llmCfg.default} not found`);
  if (cfg.type === 'openai-compatible') {
    return createOpenAICompatibleProvider({
      baseUrl: cfg.baseUrl ?? '',
      apiKey: cfg.apiKey ?? '',
      model: cfg.model,
      ...(cfg.pricing ? { pricing: cfg.pricing } : {}),
    });
  }
  return createOllamaNativeProvider({
    ...(cfg.baseUrl && { baseUrl: cfg.baseUrl }),
    model: cfg.model,
  });
}

async function writeReports(root: string, bugs: BugFinding[], format: 'markdown' | 'json' | 'both'): Promise<void> {
  const dir = join(root, 'reports');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  if (format === 'markdown' || format === 'both') {
    const md = reportToMarkdown(bugs, { project: root.split('/').pop() ?? 'project' });
    await writeFile(join(dir, 'sentinel-latest.md'), md, 'utf8');
  }
  if (format === 'json' || format === 'both') {
    const json = reportToJson(bugs, { project: root.split('/').pop() ?? 'project' });
    await writeFile(join(dir, 'sentinel-latest.json'), JSON.stringify(json, null, 2), 'utf8');
  }
}
