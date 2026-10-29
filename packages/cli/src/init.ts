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
    # 每百万 token 价格（美元）。不填则美元预算上限不会生效，只剩 token 限制。
    pricing:
      pricePerMTokIn: 2.5
      pricePerMTokOut: 10
    # 模型支持看图时改成 true：截图会随消息发给模型。
    # 保持 false（或删掉）时截图只落盘到 reports/evidence/，模型走纯文本通道。
    vision: false

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
  # 单次 LLM 请求的 token 上限 —— 防止"单次超长响应"打爆预算
  maxTokensPerRequest: 8000
  maxDurationSecPerRun: 900

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
// 留空 = 沿用 mapper 自动识别出的页面、接口与流程。

import type { FeatureMap } from '@sentinel/core';

const overrides: Partial<FeatureMap> = {
  // auth: {
  //   type: 'session',
  //   loginEndpoint: '/auth/login',
  //   sessionStorage: 'cookie',
  //   testCredentials: { email: 'sentinel@example.com', password: '...' },
  // },
  // 取消注释并填写即可覆盖自动生成的流程（留空则沿用自动流程）：
  // flows: [
  //   {
  //     id: 'critical.create-post',
  //     description: '用户能成功发布帖子',
  //     steps: [
  //       { action: 'visit', url: '/posts/new' },
  //       { action: 'fill', selector: 'textarea', value: 'test' },
  //       { action: 'click', selector: 'button[type=submit]' },
  //     ],
  //   },
  // ],
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
