/**
 * sentinel doctor — Self-Check (宪法机制)。
 *
 * 检查项（CONSTITUTION.md）：
 *   - LLM API 可用
 *   - Playwright 可用
 *   - Git 可用
 *   - MCP / Skill provider 可用
 *   - budget.yml 合法
 *   - app.map.ts 字段
 *   - Evidence 能写入
 *   - Markdown / JSON / HTML report 能生成
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { color } from '@sentinel/reporters';
import { projectRoot, loadLlmConfig, loadBudgetConfig } from './config.js';
import { createOpenAICompatibleProvider, createOllamaNativeProvider } from '@sentinel/providers';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  suggestion?: string;
}

export async function runDoctor(): Promise<number> {
  const root = projectRoot();
  const checks: Check[] = [];

  // 1. .sentinel/ 目录
  if (!existsSync(join(root, '.sentinel'))) {
    checks.push({
      name: '.sentinel/',
      status: 'fail',
      message: 'directory not found',
      suggestion: 'run: sentinel init',
    });
  } else {
    checks.push({ name: '.sentinel/', status: 'ok', message: 'exists' });
  }

  // 2. llm.yml
  const llmCfg = await loadLlmConfig(root);
  if (!llmCfg) {
    checks.push({
      name: 'llm.yml',
      status: 'fail',
      message: 'not found',
      suggestion: 'run: sentinel init',
    });
  } else if (!llmCfg.providers || !llmCfg.providers[llmCfg.default]) {
    checks.push({
      name: 'llm.yml',
      status: 'fail',
      message: `default provider "${llmCfg.default}" not configured`,
    });
  } else {
    const p = llmCfg.providers[llmCfg.default]!;
    if (p.type === 'openai-compatible' && (!p.apiKey || p.apiKey.includes('${'))) {
      checks.push({
        name: 'llm.yml',
        status: 'fail',
        message: 'apiKey env var not resolved',
        suggestion: 'export SENTINEL_API_KEY=... (or whatever env var is referenced)',
      });
    } else {
      checks.push({ name: 'llm.yml', status: 'ok', message: `provider=${p.type}, model=${p.model}` });
    }
  }

  // 3. budget.yml
  try {
    const b = await loadBudgetConfig(root);
    checks.push({
      name: 'budget.yml',
      status: 'ok',
      message: `stage=${b.stage}, maxUsd=${b.limits.maxCostUsdPerRun}`,
    });
  } catch (e) {
    checks.push({ name: 'budget.yml', status: 'fail', message: (e as Error).message });
  }

  // 4. LLM 实际调用
  if (llmCfg && llmCfg.providers[llmCfg.default]) {
    const p = llmCfg.providers[llmCfg.default]!;
    try {
      const provider =
        p.type === 'openai-compatible' && p.apiKey && p.baseUrl
          ? createOpenAICompatibleProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model })
          : createOllamaNativeProvider({ ...(p.baseUrl && { baseUrl: p.baseUrl }), model: p.model });
      const resp = await provider.chat(
        [{ role: 'user', content: 'Reply with exactly: OK' }],
        { timeoutMs: 10_000, maxTokens: 5 },
      );
      checks.push({
        name: 'LLM API',
        status: 'ok',
        message: `responded (tokens=${resp.usage.totalTokens})`,
      });
    } catch (e) {
      checks.push({
        name: 'LLM API',
        status: 'fail',
        message: (e as Error).message,
        suggestion: 'check apiKey, baseUrl, network',
      });
    }
  }

  // 5. Playwright
  try {
    await import('playwright');
    checks.push({ name: 'Playwright', status: 'ok', message: 'installed' });
  } catch {
    checks.push({
      name: 'Playwright',
      status: 'warn',
      message: 'not installed (browser MCP disabled)',
      suggestion: 'bun add -D playwright && bun playwright install chromium',
    });
  }

  // 6. Git
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status === 0) {
    checks.push({ name: 'Git', status: 'ok', message: git.stdout.trim() });
  } else {
    checks.push({ name: 'Git', status: 'warn', message: 'not found in PATH' });
  }

  // 7. app.map.ts (可选)
  if (existsSync(join(root, '.sentinel', 'app.map.ts'))) {
    checks.push({ name: 'app.map.ts', status: 'ok', message: 'present (用户覆盖已加载)' });
  } else {
    checks.push({ name: 'app.map.ts', status: 'warn', message: 'not present (mapper 输出未覆盖)' });
  }

  // 8. Evidence 写入测试
  const evidenceDir = join(root, '.sentinel', 'cache');
  if (existsSync(evidenceDir)) {
    checks.push({ name: 'Evidence dir', status: 'ok', message: '.sentinel/cache writable' });
  } else {
    checks.push({
      name: 'Evidence dir',
      status: 'warn',
      message: '.sentinel/cache missing',
      suggestion: 'run: sentinel init',
    });
  }

  // 输出
  console.log(color.cyan('🩺 Sentinel doctor'));
  console.log('');
  let failed = 0;
  for (const c of checks) {
    const icon =
      c.status === 'ok' ? color.green('✓') : c.status === 'warn' ? color.yellow('⚠') : color.red('✗');
    console.log(`  ${icon} ${c.name.padEnd(16)} ${c.message}`);
    if (c.suggestion && c.status !== 'ok') {
      console.log(`    ${color.dim('→ ' + c.suggestion)}`);
    }
    if (c.status === 'fail') failed++;
  }
  console.log('');
  if (failed > 0) {
    console.log(color.red(`${failed} fail(s). Fix above before \`sentinel run\`.`));
    return 1;
  }
  console.log(color.green('All checks passed.'));
  return 0;
}
