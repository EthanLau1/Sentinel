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

  // 1. 加载配置
  const llmCfg = await loadLlmConfig(root);
  if (!llmCfg) {
    console.error(color.red('✗ .sentinel/llm.yml not found. Run sentinel init.'));
    return 1;
  }
  const budgetCfg = await loadBudgetConfig(root);
  const stage = budgetCfg.stage;
  const weights = budgetCfg.weights ?? PRESETS[stage.toLowerCase() as keyof typeof PRESETS] ?? DEFAULT_WEIGHTS;

  // 2. 构建 providers
  const llm = buildLlm(llmCfg);
  const memory = createNoneMemory();
  const skills = createMarkdownSkills({ root: join(root, '.sentinel/skills') });
  const mcp = createMCPRegistry();
  mcp.register(createHttpMCPServer({}));
  mcp.register(createFsMCPServer({ root }));
  // browser 是可选的（Playwright 未装时不注册）
  try {
    mcp.register(createBrowserMCPServer({ detailed: opts.detailed === true }));
  } catch {
    // 静默
  }
  const knowledge = [createGithubKnowledge({}), createStackOverflowKnowledge()];

  // 3. 构建 budget
  const budget = new Budget({
    ...(budgetCfg.limits.maxTokensPerRun !== undefined && { maxTokens: budgetCfg.limits.maxTokensPerRun }),
    ...(budgetCfg.limits.maxCostUsdPerRun !== undefined && { maxUsd: budgetCfg.limits.maxCostUsdPerRun }),
    ...(budgetCfg.limits.maxDurationSecPerRun !== undefined && {
      maxDurationMs: budgetCfg.limits.maxDurationSecPerRun * 1000,
    }),
  });

  // 4. 收集 BugFinding（带 fixOptions）的捕获器
  const bugs: BugFinding[] = [];
  const captureSub: Subagent = {
    name: 'capture',
    register(ctx) {
      // 先捕获 critic 出的 confirmed（无 fixOptions），用作占位
      ctx.bus.subscribe<BugFinding>('bug.confirmed', (e) => {
        if (!bugs.find((b) => b.id === e.payload.id)) {
          bugs.push(e.payload);
        }
      });
      // 再捕获 enhancer 出的最终版本（含 fixOptions + sources）
      ctx.bus.subscribe<{ bug: BugFinding; options: FixOption[] }>('fix.enhanced', (e) => {
        const idx = bugs.findIndex((b) => b.id === e.payload.bug.id);
        if (idx >= 0) bugs[idx] = e.payload.bug;
        else bugs.push(e.payload.bug);
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
    createPlanner({ stage, weights }),
  ];
  if (!opts.noEnhance) subagents.push(createEnhancer());
  subagents.push(createExecutor({ maxTier: opts.maxTier ?? 1 }));
  subagents.push(captureSub);

  const kernel = new Kernel({
    providers: { llm, memory, skills, mcp, knowledge },
    budget,
    subagents,
  });

  // 6. 启动
  const startMs = Date.now();
  try {
    await kernel.kick('project.scanned', { root }, 'cli');
  } catch (err) {
    console.error(color.red(`✗ run failed: ${(err as Error).message}`));
  }
  await kernel.stop();
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
  console.log(color.dim(`tokens: ${usage.tokens}  cost: $${usage.usd.toFixed(4)}  duration: ${dur}ms`));
  console.log(color.dim(`reports/sentinel-latest.{md,json}`));

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
