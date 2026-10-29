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
import { projectRoot, loadLlmConfig, loadBudgetConfig, normalizeStage } from './config.js';
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

/**
 * LLM 调用的错误分类 —— 不能笼统说"连不通"。
 *
 * `providerType` 决定 404 怎么解释：
 *   openai-compatible 的 404 多半是 baseUrl 漏了 /v1；
 *   ollama-native 的 404 则是模型名不对（或服务没起）——
 *   以前不区分，一律说"baseUrl 漏了 /v1"，把用户往错方向带。
 */
function classifyLlmError(message: string, providerType?: 'openai-compatible' | 'ollama-native'): string {
  if (/HTTP 401|authentication|api key.*invalid|unauthorized/i.test(message)) {
    return 'key 无效或 baseUrl 指向了错误的鉴权端点 · 换新 key，或检查 baseUrl';
  }
  if (/HTTP 404|not found/i.test(message)) {
    if (providerType === 'ollama-native') {
      return 'Ollama 服务里没有这个模型 · 确认模型名（ollama list）或先 pull 下来';
    }
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
export async function collectConfigChecks(
  root: string,
  options?: { skipLlmProbe?: boolean },
): Promise<Check[]> {
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
  // 2.0 配置里引用了但没设置的环境变量 —— 必须点名说出来。
  //     以前 `${SENTINEL_API_KEY}` 没设置会静默变空串，
  //     apiKey 变成空 → 自动转离线，用户完全不知道自己少 export 了一个变量。
  if (llmCfg?.missingEnvVars?.length) {
    checks.push({
      name: '环境变量',
      status: 'fail',
      message: `未设置：${llmCfg.missingEnvVars.join(', ')} —— 配置里的 ${llmCfg.missingEnvVars.map((v) => `\${${v}}`).join(', ')} 被替换成了空字符串`,
      suggestion: `export ${llmCfg.missingEnvVars[0]}=<你的值>（或直接把值写进 .sentinel/llm.yml）`,
      // 不阻塞：缺 key 还能离线跑确定性检测。但必须让用户知道缺的是哪个变量。
      blocking: false,
    });
  }
  if (!llmCfg) {
    checks.push({
      name: 'llm.yml',
      status: 'fail',
      message: 'not found — 将以离线模式运行（只做确定性检测，不做根因分析）',
      suggestion: '想要 AI 根因分析就配置 LLM：sentinel ui',
      // 不阻塞：没有 LLM 也能跑 ——
      // 巡检器（inspector）用确定性规则照样能测出页面报错、资源 404、接口 5xx 等问题。
      // 以前这里是 blocking，等于"没有模型 = 连启动都不行"，与"离线也能检测"的目标直接冲突。
      blocking: false,
    });
  } else if (!llmCfg.providers || !llmCfg.providers[llmCfg.default]) {
    checks.push({
      name: 'llm.yml',
      status: 'fail',
      message: `default provider "${llmCfg.default}" not configured — 将以离线模式运行（只做确定性检测）`,
      suggestion: '编辑 .sentinel/llm.yml 里的 default 与 providers',
      blocking: false,
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
        message: `${problems.join('; ')} — 将以离线模式运行（只做确定性检测）`,
        ...(suggestion ? { suggestion } : {}),
        // LLM 配置坏了也不阻塞：巡检器不依赖模型，照样能测出确定性问题。
        // 阻塞的话等于"key 写错 = 整个工具不能用"，与"离线也能检测"的目标冲突。
        blocking: false,
      });
    } else {
      checks.push({ name: 'llm.yml', status: 'ok', message: `provider=${p.type}, model=${p.model}` });
    }
  }

  // 3. budget.yml
  //    这一项是**真阻塞**的：stage 决定权重与方案档位，limits 决定护栏 ——
  //    这两项错了，后面算出来的分数和预算全不可信，不能"降级继续"。
  //    （以前唯一的阻塞项是「.sentinel/ 目录存在」，而 autoInit 会先把它建出来，
  //      所以那条检查永远不可能失败 —— 「配置坏了拒绝启动」等于没实现。）
  let budgetCfg: Awaited<ReturnType<typeof loadBudgetConfig>> | null = null;
  try {
    const b = await loadBudgetConfig(root);
    budgetCfg = b;
    const problems: string[] = [...(b.problems ?? [])];
    if (!normalizeStage(b.stage)) {
      problems.push(`stage "${b.stage}" 非法（只允许 Idea / MVP / Launch / Scale）`);
    }
    const limits = (b.limits ?? {}) as Record<string, unknown>;
    for (const key of ['maxCostUsdPerRun', 'maxTokensPerRun', 'maxTokensPerRequest', 'maxDurationSecPerRun']) {
      const v = limits[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        problems.push(`limits.${key} 非法（${String(v)}）`);
      }
    }
    if (problems.length > 0) {
      checks.push({
        name: 'budget.yml',
        status: 'fail',
        message: `${problems.join('; ')} —— 阶段/预算配置非法`,
        suggestion: '修 .sentinel/budget.yml：stage 取 Idea/MVP/Launch/Scale，limits 取非负数',
        blocking: true,
      });
    } else {
      checks.push({
        name: 'budget.yml',
        status: 'ok',
        message: `stage=${b.stage}, maxUsd=${b.limits.maxCostUsdPerRun}`,
      });
    }
  } catch (e) {
    checks.push({ name: 'budget.yml', status: 'fail', message: (e as Error).message, blocking: true });
  }

  // 4. LLM 实际调用
  //    离线模式（--offline / 没配 LLM）下**必须跳过**：探测本身就是一次外网请求，
  //    "没有网络也能用"的前提是这条路径一个包都不发。
  if (options?.skipLlmProbe) {
    checks.push({
      name: 'LLM API',
      status: 'ok',
      message: 'skipped（离线模式：不发起任何模型请求）',
    });
  } else if (llmCfg && llmCfg.providers[llmCfg.default]) {
    const p = llmCfg.providers[llmCfg.default]!;
    // 探测必须用**配置里声明的那种 provider**。
    // 以前 openai-compatible 缺 apiKey 时会回退去探 Ollama，
    // 然后把 "Ollama HTTP 404" 解释成 "baseUrl 漏了 /v1" ——
    // 一条彻底误导的建议（用户的问题是缺 key，不是地址错）。
    const missingField = !p.apiKey?.trim() ? 'apiKey' : !p.baseUrl?.trim() ? 'baseUrl' : undefined;
    if (p.type === 'openai-compatible' && missingField) {
      checks.push({
        name: 'LLM API',
        status: 'fail',
        message: `provider "${llmCfg.default}" 是 openai-compatible，但缺少 ${missingField} —— 无法探测`,
        suggestion:
          missingField === 'apiKey'
            ? '编辑 .sentinel/llm.yml 的 apiKey，或 export 对应的环境变量'
            : '编辑 .sentinel/llm.yml 的 baseUrl（要带 /v1）',
        blocking: false,
      });
    } else {
      try {
        const provider =
          p.type === 'openai-compatible'
            ? createOpenAICompatibleProvider({ baseUrl: p.baseUrl!, apiKey: p.apiKey!, model: p.model })
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
          suggestion: classifyLlmError(message, p.type),
          // LLM 不可达时诊断会降级为启发式，不阻塞整轮 run
          blocking: false,
        });
      }
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
  //    三态，不能只看"能不能起来"：
  //      ok   = Playwright 自带的 Chromium 起来了（版本受控）
  //      warn = 借用了系统 Google Chrome（能跑，但版本不受控，取证行为可能漂移）
  //      fail = 两个都没有
  //    以前只判"能不能起来"，借系统 Chrome 也报 OK ——
  //    干净机器上没装 Chrome 的用户会一路走到 browser preflight 才炸。
  try {
    const { chromium } = await import('playwright');
    let browser;
    let usingSystemChrome = false;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("Executable doesn't exist")) throw err;
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
      usingSystemChrome = true;
    }
    try {
      const page = await browser.newPage();
      await page.locator('body').ariaSnapshot();
    } finally {
      await browser.close();
    }
    if (usingSystemChrome) {
      checks.push({
        name: 'Playwright',
        status: 'warn',
        message: 'Playwright Chromium 未安装，当前借用系统 Google Chrome 运行（版本不受控）',
        suggestion: 'bunx playwright install chromium —— 装上后取证行为才稳定',
      });
    } else {
      checks.push({ name: 'Playwright', status: 'ok', message: 'Playwright Chromium launched and closed' });
    }
  } catch (e) {
    checks.push({
      name: 'Playwright',
      status: 'fail',
      message: `browser not ready: ${(e as Error).message}`,
      suggestion: 'bunx playwright install chromium（装系统 Google Chrome 只能兜底）',
      blocking: true,
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
      // 报告生成不出来 = 这一轮跑的诊断没有落点 —— 必须阻塞
      blocking: true,
    });
  }
  checks.push({
    name: 'Report HTML',
    status: 'warn',
    message: 'HTML reporter 尚未实现（宪法要求三格式，当前仅 md/json）',
    suggestion: '已记入 docs/FIX-ROUND-2026-10-27.md 的"不做的事"，本轮不实现',
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
  // 退出码语义必须和「阻塞 / 非阻塞」对齐 ——
  // 以前只要有一条 fail 就 exit 1 并说 "Fix above before `sentinel run`"，
  // 可其中"没配 LLM"这类项根本不阻塞 run：用户按提示去修，跑还是会跑。
  // 提示与实际行为对不上 = 用户白折腾。
  let blockingFailed = 0;
  let softFailed = 0;
  for (const c of checks) {
    const icon =
      c.status === 'ok' ? color.green('✓') : c.status === 'warn' ? color.yellow('⚠') : color.red('✗');
    console.log(`  ${icon} ${c.name.padEnd(16)} ${c.message}`);
    if (c.suggestion && c.status !== 'ok') {
      console.log(`    ${color.dim('→ ' + c.suggestion)}`);
    }
    if (c.status === 'fail') {
      if (c.blocking === false) softFailed++;
      else blockingFailed++;
    }
  }
  console.log('');
  if (blockingFailed > 0) {
    console.log(color.red(`${blockingFailed} fail(s). Fix above before \`sentinel run\`.`));
    return 1;
  }
  if (softFailed > 0) {
    console.log(color.yellow(`${softFailed} 项需注意（不阻塞 run：诊断会降级为启发式 / 自动转离线）。`));
    console.log(color.dim('   阻塞项为 0 —— 可以直接 `sentinel run`。'));
    return 0;
  }
  console.log(color.green('All checks passed.'));
  return 0;
}
