/**
 * sentinel hello — 验证 LLM 通路。
 */

import { Budget } from '@sentinel/core';
import { createOpenAICompatibleProvider, createOllamaNativeProvider } from '@sentinel/providers';
import { color } from '@sentinel/reporters';
import { loadLlmConfig, loadBudgetConfig, projectRoot } from './config.js';

export async function runHello(): Promise<number> {
  const root = projectRoot();
  const llmCfg = await loadLlmConfig(root);
  if (!llmCfg) {
    console.error(color.red('✗ .sentinel/llm.yml not found. Run `sentinel init` first.'));
    return 1;
  }
  const budgetCfg = await loadBudgetConfig(root);

  const providerName = llmCfg.default;
  const providerCfg = llmCfg.providers[providerName];
  if (!providerCfg) {
    console.error(color.red(`✗ provider "${providerName}" not found in llm.yml`));
    return 1;
  }

  let provider;
  if (providerCfg.type === 'openai-compatible') {
    if (!providerCfg.baseUrl || !providerCfg.apiKey) {
      console.error(color.red('✗ openai-compatible provider needs baseUrl and apiKey'));
      return 1;
    }
    provider = createOpenAICompatibleProvider({
      baseUrl: providerCfg.baseUrl,
      apiKey: providerCfg.apiKey,
      model: providerCfg.model,
    });
  } else {
    provider = createOllamaNativeProvider({
      ...(providerCfg.baseUrl && { baseUrl: providerCfg.baseUrl }),
      model: providerCfg.model,
    });
  }

  const budget = new Budget({
    ...(budgetCfg.limits.maxTokensPerRun !== undefined && { maxTokens: budgetCfg.limits.maxTokensPerRun }),
    ...(budgetCfg.limits.maxCostUsdPerRun !== undefined && { maxUsd: budgetCfg.limits.maxCostUsdPerRun }),
    ...(budgetCfg.limits.maxDurationSecPerRun !== undefined && {
      maxDurationMs: budgetCfg.limits.maxDurationSecPerRun * 1000,
    }),
  });

  console.log(color.cyan('🛰  Sentinel hello'));
  console.log(color.dim(`   provider: ${provider.name} (${providerCfg.model})`));
  console.log('');

  try {
    const start = Date.now();
    const resp = await provider.chat([
      { role: 'system', content: '你是 Sentinel。回答必须精确。' },
      { role: 'user', content: '请回复一句简短问候，证明你正在工作。' },
    ]);
    const dur = Date.now() - start;
    budget.consume(resp.usage.totalTokens, resp.costUsd);

    console.log(color.green('✓ LLM responded:'));
    console.log(color.bold(`  "${resp.content.trim()}"`));
    console.log('');
    console.log(color.dim(`  tokens: ${resp.usage.totalTokens}`));
    console.log(color.dim(`  cost: $${resp.costUsd.toFixed(6)}`));
    console.log(color.dim(`  duration: ${dur}ms`));
    return 0;
  } catch (err) {
    console.error(color.red(`✗ LLM call failed: ${(err as Error).message}`));
    return 1;
  }
}
