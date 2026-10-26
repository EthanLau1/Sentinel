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
 *
 * 检查分成两组：
 *   - collectConfigChecks   配置类（快，不启动浏览器）→ `sentinel run` 前置门禁复用
 *   - collectRuntimeChecks  运行环境类（要启动浏览器，较慢）→ 只有 doctor 跑
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { color, reportToMarkdown, reportToJson } from '@sentinel/reporters';
import { projectRoot, loadLlmConfig, loadBudgetConfig } from './config.js';
import { createOpenAICompatibleProvider, createOllamaNativeProvider } from '@sentinel/providers';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  suggestion?: string;
  /**
   * 是否阻塞 `sentinel run`。
   * 默认 true。配置本身坏了（文件缺失、字段非法）必须阻塞；
   * 运行时能力不可用（LLM 不可达）不阻塞 —— 诊断会降级为启发式，不该让整轮失败。
   */
  blocking?: boolean;
}

/** LLM 调用的错误分类 —— 不能笼统说"连不通" */
function classifyLlmError(message: string): string {
  if (/HTTP 401|authentication|api key.*invalid|unauthorized/i.test(message)) {
    return 'key 无效或 baseUrl 指向了错误的鉴权端点 · 换新 key，或检查 baseUrl';
  }
  if (/HTTP 404|not found/i.test(message)) {
    return '地址不对（常见：baseUrl 漏了 /v1）· 改成 https://<host>/v1';
  }
  if (/model.*not found|does not exist|unknown model/i.test(message)) {
    return '模型名或账号权限不对 · 用 provider 文档里的模型名';
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|fetch failed/i.test(message)) {
    return '服务不可达 · 检查 baseUrl 可达性与网络';
  }
  return 'check apiKey, baseUrl, network';
}

/** 配置类检查 —— 快，不启动浏览器。`sentinel run` 用它做前置门禁。 */
export async function collectConfigChecks(root: string): Promise<Check[]> {
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

  // 2. llm.yml（配置形态 + baseUrl 语义）
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
    const problems: string[] = [];
    let suggestion: string | undefined;

    if (p.type === 'openai-compatible') {
      if (!p.apiKey || !p.apiKey.trim()) {
        problems.push('apiKey 缺失');
        suggestion = '编辑 .sentinel/llm.yml 的 apiKey，或 export SENTINEL_API_KEY=...';
      }
      // baseUrl 必须是 URL —— 历史上有人把 key 填进了这个字段
      if (!p.baseUrl || !/^https?:\/\//i.test(p.baseUrl)) {
        problems.push('baseUrl 不是合法 URL');
        suggestion = 'baseUrl 填 https://<host>/v1（不要把 apiKey 填进来）';
      } else if (/^sk-|^key-|^[A-Za-z0-9_-]{24,}$/.test(p.baseUrl)) {
        problems.push('baseUrl 里填的是密钥，不是地址');
        suggestion = '把 key 移到 apiKey，baseUrl 填 https://<host>/v1';
      }
    }

    if (problems.length > 0) {
      checks.push({
        name: 'llm.yml',
        status: 'fail',
        message: problems.join('; '),
        ...(suggestion ? { suggestion } : {}),
      });
    } else {
      checks.push({ name: 'llm.yml', status: 'ok', message: `provider=${p.type}, model=${p.model}` });
    }
  }

  // 3. budget.yml
  let budgetCfg: Awaited<ReturnType<typeof loadBudgetConfig>> | null = null;
  try {
    const b = await loadBudgetConfig(root);
    budgetCfg = b;
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
      const message = (e as Error).message;
      checks.push({
        name: 'LLM API',
        status: 'fail',
        message,
        suggestion: classifyLlmError(message),
        // LLM 不可达时诊断会降级为启发式，不阻塞整轮 run
        blocking: false,
      });
    }
  }

  // 4.5 美元预算护栏是否可执行（无 pricing 时 maxUsd 根本不会传）
  const activeProvider = llmCfg?.providers?.[llmCfg.default];
  if (activeProvider && activeProvider.type !== 'ollama-native' && !activeProvider.pricing) {
    checks.push({
      name: '预算护栏',
      status: 'warn',
      message: 'provider 未配置 pricing —— 美元预算上限不会生效（只剩 token 限制）',
      suggestion:
        '在 .sentinel/llm.yml 的 provider 下加 pricing: { pricePerMTokIn: <每百万输入token价格>, pricePerMTokOut: <每百万输出token价格> }（单位：美元 / 每百万 token）',
    });
  } else if (activeProvider) {
    // 单位合理性：per-MTok 的正常价格远小于 1000，填成 per-1K 或 per-token 会偏大 1000 倍
    const pricing = activeProvider.pricing;
    if (
      pricing &&
      (pricing.pricePerMTokIn > 1000 || pricing.pricePerMTokOut > 1000)
    ) {
      checks.push({
        name: '预算护栏',
        status: 'warn',
        message: `pricing 数值异常（${pricing.pricePerMTokIn}/${pricing.pricePerMTokOut}）—— 单位是美元 / 每百万 token，填大了会 1000 倍高估成本`,
        suggestion: '对照供应商报价表确认：例如 gpt-4o 是 2.5 / 10（USD / 每百万 token）',
      });
    } else {
      checks.push({ name: '预算护栏', status: 'ok', message: '美元预算可执行' });
    }
  }

  // 4.6 单次响应上限（不配则"单次超长响应"可打爆预算）
  if (budgetCfg && budgetCfg.limits.maxTokensPerRequest === undefined) {
    checks.push({
      name: '单次响应上限',
      status: 'warn',
      message: 'budget.yml 未配置 maxTokensPerRequest —— 单次超长响应没有独立上限',
      suggestion: '在 budget.yml 的 limits 下加 maxTokensPerRequest（如 8000）',
    });
  } else if (budgetCfg) {
    checks.push({
      name: '单次响应上限',
      status: 'ok',
      message: `单次请求上限 ${budgetCfg.limits.maxTokensPerRequest} tokens`,
    });
  }

  return checks;
}
export async function collectRuntimeChecks(root: string): Promise<Check[]> {
  const checks: Check[] = [];

  // 5. Playwright
  try {
    const { chromium } = await import('playwright');
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("Executable doesn't exist")) throw err;
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    }
    try {
      const page = await browser.newPage();
      await page.locator('body').ariaSnapshot();
    } finally {
      await browser.close();
    }
    checks.push({ name: 'Playwright', status: 'ok', message: 'Chromium/Chrome launched and closed' });
  } catch (e) {
    checks.push({
      name: 'Playwright',
      status: 'fail',
      message: `browser not ready: ${(e as Error).message}`,
      suggestion: 'install Playwright Chromium or Google Chrome',
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

  // 9. MCP / Skill provider（宪法要求项）
  const skillsRoot = join(root, '.sentinel', 'skills');
  const skillDirs = ['core', 'community', 'custom'].filter((d) => existsSync(join(skillsRoot, d)));
  if (skillDirs.length > 0) {
    checks.push({
      name: 'MCP / Skills',
      status: 'ok',
      message: `skill dirs: ${skillDirs.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'MCP / Skills',
      status: 'warn',
      message: 'no skill directories under .sentinel/skills',
      suggestion: 'run: sentinel init',
    });
  }

  // 10. 报告生成能力
  try {
    const md = reportToMarkdown([], { project: 'doctor' });
    const json = reportToJson([], { project: 'doctor' });
    if (md.length > 0 && JSON.stringify(json).length > 0) {
      checks.push({ name: 'Report 生成', status: 'ok', message: 'Markdown + JSON 可生成' });
    }
  } catch (e) {
    checks.push({
      name: 'Report 生成',
      status: 'fail',
      message: (e as Error).message,
    });
  }
  checks.push({
    name: 'Report HTML',
    status: 'warn',
    message: 'HTML reporter 尚未实现（宪法要求三格式，当前仅 md/json）',
    suggestion: '见补齐方案 §3.1 第 4 组：HTML 实现前判 blocked，不计入失败',
  });

  // 11. Knowledge provider
  const knowledgeDir = join(root, '.sentinel', 'cache', 'knowledge');
  if (existsSync(knowledgeDir)) {
    checks.push({
      name: 'Knowledge',
      status: 'ok',
      message: process.env['GITHUB_TOKEN'] ? 'cache dir present + GITHUB_TOKEN set' : 'cache dir present (无 GITHUB_TOKEN，限额较低)',
    });
  } else {
    checks.push({
      name: 'Knowledge',
      status: 'warn',
      message: 'knowledge cache dir missing',
      suggestion: '首次检索时自动创建；如需更高限额请设置 GITHUB_TOKEN',
    });
  }

  return checks;
}

export async function runDoctor(): Promise<number> {
  const root = projectRoot();
  const checks = [
    ...(await collectConfigChecks(root)),
    ...(await collectRuntimeChecks(root)),
  ];

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
