/**
 * auto-init — 如果目标项目没有 .sentinel/ 目录，自动初始化。
 * 不覆盖已有文件。
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { color } from '@sentinel/reporters';

const DEFAULT_LLM_TEMPLATE = `# Sentinel LLM Configuration
# Configure your LLM provider here, or use the WebUI settings page.

default: minimax

providers:
  minimax:
    type: openai-compatible
    baseUrl: https://api.minimaxi.com/v1
    apiKey: \${MINIMAX_API_KEY}
    model: MiniMax-M3

  local-fast:
    type: ollama-native
    baseUrl: http://localhost:11434
    model: qwen3:7b
`;

const DEFAULT_BUDGET_TEMPLATE = `# Sentinel Budget Configuration
stage: MVP

limits:
  maxCostUsdPerRun: 0.50
  maxTokensPerRun: 100000
  maxDurationSecPerRun: 300
`;

/**
 * 自动初始化目标项目的 .sentinel/ 目录。
 * 如果已存在则跳过。
 * 如果用户有全局 LLM 配置（~/.sentinel/llm.yml），优先复制那份。
 */
export async function autoInit(projectRoot: string): Promise<void> {
  const sentinelDir = join(projectRoot, '.sentinel');

  if (existsSync(join(sentinelDir, 'llm.yml'))) {
    // 已经初始化过，跳过
    return;
  }

  console.log(color.yellow('⚙  Auto-initializing .sentinel/ for this project...'));

  // 创建目录结构
  await mkdir(sentinelDir, { recursive: true });
  await mkdir(join(sentinelDir, 'skills/core'), { recursive: true });
  await mkdir(join(sentinelDir, 'skills/community'), { recursive: true });
  await mkdir(join(sentinelDir, 'skills/custom'), { recursive: true });
  await mkdir(join(sentinelDir, 'cache'), { recursive: true });
  await mkdir(join(sentinelDir, 'benchmark'), { recursive: true });

  // LLM 配置：优先从全局复制，否则用默认模板
  const globalLlmPath = join(homedir(), '.sentinel', 'llm.yml');
  let llmContent = DEFAULT_LLM_TEMPLATE;
  if (existsSync(globalLlmPath)) {
    const { readFile } = await import('node:fs/promises');
    llmContent = await readFile(globalLlmPath, 'utf8');
    console.log(color.dim('   Using global LLM config from ~/.sentinel/llm.yml'));
  }

  const llmPath = join(sentinelDir, 'llm.yml');
  await writeFile(llmPath, llmContent, 'utf8');

  // Budget 配置
  const budgetPath = join(sentinelDir, 'budget.yml');
  if (!existsSync(budgetPath)) {
    await writeFile(budgetPath, DEFAULT_BUDGET_TEMPLATE, 'utf8');
  }

  console.log(color.green('✓ .sentinel/ initialized'));
  console.log('');
}
