/**
 * sentinel init — 一键生成 .sentinel/ 配置 + skill 目录结构。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectRoot } from './config.js';
import { color } from '@sentinel/reporters';

const LLM_TEMPLATE = `# Sentinel LLM 配置
# 详见 https://github.com/your/sentinel/blob/main/CONFIG-SPEC.md

default: my-cloud-api

providers:
  my-cloud-api:
    type: openai-compatible
    baseUrl: https://your-api.com/v1
    apiKey: \${SENTINEL_API_KEY}
    model: gpt-4o

  local-fast:
    type: ollama-native
    baseUrl: http://localhost:11434
    model: qwen3:7b
`;

const BUDGET_TEMPLATE = `# Sentinel 预算配置
stage: MVP

limits:
  maxCostUsdPerRun: 0.50
  maxTokensPerRun: 100000
  maxDurationSecPerRun: 300

# 可选：自定义权重（默认沿用 stage 对应预设）
# weights:
#   confidence: 0.35
#   impact: 0.25
#   stageFit: 0.20
#   effort: -0.10
#   risk: -0.10
`;

const APP_MAP_TEMPLATE = `// Sentinel FeatureMap 用户覆盖
// mapper 的输出会跟这里 merge

import type { FeatureMap } from '@sentinel/core';

const overrides: Partial<FeatureMap> = {
  // auth: {
  //   type: 'session',
  //   loginEndpoint: '/auth/login',
  //   sessionStorage: 'cookie',
  //   testCredentials: { email: 'sentinel@example.com', password: '...' },
  // },
  flows: [
    // {
    //   id: 'critical.create-post',
    //   description: '用户能成功发布帖子',
    //   steps: [
    //     { action: 'visit', url: '/posts/new' },
    //     { action: 'fill', selector: 'textarea', value: 'test' },
    //     { action: 'click', selector: 'button[type=submit]' },
    //   ],
    // },
  ],
};

export default overrides;
`;

export async function runInit(): Promise<void> {
  const root = projectRoot();
  const dir = join(root, '.sentinel');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'skills/core'), { recursive: true });
  await mkdir(join(dir, 'skills/community'), { recursive: true });
  await mkdir(join(dir, 'skills/custom'), { recursive: true });
  await mkdir(join(dir, 'cache'), { recursive: true });
  await mkdir(join(dir, 'benchmark'), { recursive: true });

  const llmPath = join(dir, 'llm.yml');
  if (!existsSync(llmPath)) {
    await writeFile(llmPath, LLM_TEMPLATE, 'utf8');
    console.log(color.green(`✓ wrote ${llmPath}`));
  }

  const budgetPath = join(dir, 'budget.yml');
  if (!existsSync(budgetPath)) {
    await writeFile(budgetPath, BUDGET_TEMPLATE, 'utf8');
    console.log(color.green(`✓ wrote ${budgetPath}`));
  }

  const mapPath = join(dir, 'app.map.ts');
  if (!existsSync(mapPath)) {
    await writeFile(mapPath, APP_MAP_TEMPLATE, 'utf8');
    console.log(color.green(`✓ wrote ${mapPath}`));
  }

  console.log('');
  console.log(color.bold('Sentinel initialized.'));
  console.log(`Next: ${color.cyan('export SENTINEL_API_KEY=...')} then ${color.cyan('sentinel doctor')}`);
}
