/**
 * 配置加载 — 严格按 CONFIG-SPEC.md。
 * 支持简单 YAML 子集（key: value、嵌套、字符串、数字、布尔、列表）+ ${ENV_VAR} 替换。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { color } from '@sentinel/reporters';

export interface LlmConfig {
  default: string;
  providers: Record<
    string,
    {
      type: 'openai-compatible' | 'ollama-native';
      baseUrl?: string;
      apiKey?: string;
      model: string;
      /**
       * 单价，单位 **USD / 每百万 token**（与各供应商报价表口径一致）。
       * 不配 → budget.yml 的 maxCostUsdPerRun 不生效，只剩 token 上限。
       */
      pricing?: { pricePerMTokIn: number; pricePerMTokOut: number };
    }
  >;
  agents?: Record<string, string>;
  /**
   * 配置里引用了但**当前环境没有设置**的环境变量。
   *
   * 以前 `${SENTINEL_API_KEY}` 没设置时会静默变成空字符串 ——
   * 配置看着是好的，实际 apiKey 是空的，然后自动转离线，用户完全不知道为什么。
   * 这个字段让 doctor 能点名说出缺哪个变量。
   */
  missingEnvVars?: string[];
}

export interface BudgetConfig {
  stage: 'Idea' | 'MVP' | 'Launch' | 'Scale';
  preset?: string;
  limits: {
    maxCostUsdPerRun?: number;
    maxTokensPerRun?: number;
    /** 单次 LLM 请求的 token 上限 —— 防止"单次超长响应"打爆预算 */
    maxTokensPerRequest?: number;
    maxDurationSecPerRun?: number;
  };
  weights?: {
    confidence: number;
    impact: number;
    stageFit: number;
    effort: number;
    risk: number;
  };
  /**
   * 配置里**不合法的字段** —— doctor 会据此判阻塞并拒绝启动。
   *
   * 为什么单独记在这里：以前非法值要么被悄悄换成默认值（`stage: 3` → 'MVP'），
   * 要么被原样带进运行时（`limits: 100` → `limits.maxCostUsdPerRun` 是 undefined），
   * 结果是"三条预算护栏全部静默失效"—— 用户以为有护栏，其实没有。
   */
  problems?: string[];
}

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/** budget.yml 当前版本真正读取的顶层字段 */
const KNOWN_BUDGET_KEYS = new Set(['stage', 'preset', 'limits', 'weights']);
/** budget.yml.limits 当前版本真正读取的字段 */
const KNOWN_LIMIT_KEYS = new Set([
  'maxCostUsdPerRun',
  'maxTokensPerRun',
  'maxTokensPerRequest',
  'maxDurationSecPerRun',
]);

export function expandEnv(value: string): string {
  return value.replace(ENV_REF, (_, name) => process.env[name as string] ?? '');
}

/**
 * 找出配置里引用了、但当前环境**没有设置**的环境变量。
 *
 * 为什么要单独找：`${SENTINEL_API_KEY}` 没设置时会被替换成空字符串，
 * 于是 `apiKey: ` 看着是"填了"，实际是空的 —— 自动转离线模式，
 * 用户看到的是"离线模式：不调用 LLM"，完全不知道是自己少 export 了一个变量。
 * 缺变量必须**点名**说出来。
 */
export function collectMissingEnvVars(text: string): string[] {
  const missing: string[] = [];
  for (const m of text.matchAll(ENV_REF)) {
    const name = m[1]!;
    if (!process.env[name] && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

/** 极简 YAML 解析器（支持 CONFIG-SPEC.md 用到的子集） */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = text.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> | unknown[] }> = [
    { indent: -1, obj: root },
  ];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch ? indentMatch[1]!.length : 0;
    const content = line.slice(indent);

    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const top = stack[stack.length - 1]!.obj;

    // List item
    if (content.startsWith('- ')) {
      const val = parseScalar(content.slice(2).trim());
      if (Array.isArray(top)) {
        top.push(val);
      } else {
        // shouldn't happen in well-formed yaml
      }
      continue;
    }

    const colon = content.indexOf(':');
    if (colon === -1) continue;
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();

    if (!rest) {
      // 嵌套对象 / 列表
      const newObj = {};
      if (Array.isArray(top)) {
        top.push({ [key]: newObj });
      } else {
        top[key] = newObj;
      }
      stack.push({ indent, obj: newObj });
      continue;
    }
    const val = parseScalar(rest);
    if (Array.isArray(top)) {
      top.push({ [key]: val });
    } else {
      top[key] = val;
    }
  }
  return root;
}

function parseScalar(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~' || raw === '') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) return expandEnv(raw.slice(1, -1));
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  return expandEnv(raw);
}

export async function loadLlmConfig(projectRoot: string): Promise<LlmConfig | null> {
  const path = join(projectRoot, '.sentinel', 'llm.yml');
  return (await loadLlmConfigFile(path)) ?? loadLlmConfigFile(join(homedir(), '.sentinel', 'llm.yml'));
}

export async function loadLlmConfigFile(path: string): Promise<LlmConfig | null> {
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf8');
  const parsed = parseSimpleYaml(text);
  const cfg = parsed as unknown as LlmConfig;
  const missingEnvVars = collectMissingEnvVars(text);
  if (missingEnvVars.length > 0) return { ...cfg, missingEnvVars };
  return cfg;
}

/** 四个合法阶段 —— 大小写不敏感，写 `mvp` 也认，但统一成规范写法 */
const VALID_STAGES = ['Idea', 'MVP', 'Launch', 'Scale'] as const;
export type BudgetStage = (typeof VALID_STAGES)[number];

/**
 * 把 stage 归一成规范写法；不是合法阶段就返回 undefined（由 doctor 判阻塞）。
 */
export function normalizeStage(raw: unknown): BudgetStage | undefined {
  if (typeof raw !== 'string') return undefined;
  const hit = VALID_STAGES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
  return hit;
}

export async function loadBudgetConfig(projectRoot: string): Promise<BudgetConfig> {
  const path = join(projectRoot, '.sentinel', 'budget.yml');
  if (!existsSync(path)) {
    return {
      stage: 'MVP',
      limits: { maxCostUsdPerRun: 0.5, maxTokensPerRun: 100000, maxDurationSecPerRun: 900 },
    };
  }
  const text = await readFile(path, 'utf8');
  const parsed = parseSimpleYaml(text) as unknown as Record<string, unknown>;
  const problems: string[] = [];

  // 未知字段会被静默忽略 —— 必须说出来，否则用户以为配了就生效
  const unknown = Object.keys(parsed).filter((k) => !KNOWN_BUDGET_KEYS.has(k));
  if (unknown.length > 0) {
    console.warn(
      color.yellow(`⚠  budget.yml: 字段 ${unknown.join(', ')} 当前版本不生效（见 CONFIG-SPEC.md）`),
    );
  }

  // ── stage ──
  // 以前写成 `stage: 3`（数字）会被悄悄换成 'MVP' ——
  // 权重、方案档位全按另一套算，而用户以为自己配的是别的阶段。
  // 非法值必须被**记下来**（doctor 会据此阻塞），不能静默替换。
  const rawStage = parsed['stage'];
  let stage: BudgetConfig['stage'];
  if (rawStage === undefined || rawStage === null || rawStage === '') {
    stage = 'MVP';
  } else if (typeof rawStage !== 'string') {
    problems.push(`stage 必须是阶段名（Idea / MVP / Launch / Scale），当前是 ${JSON.stringify(rawStage)}`);
    stage = 'MVP';
  } else {
    const normalized = normalizeStage(rawStage);
    if (normalized) {
      stage = normalized;
    } else {
      problems.push(`stage "${rawStage}" 非法（只允许 Idea / MVP / Launch / Scale）`);
      stage = rawStage as BudgetConfig['stage'];
    }
  }

  // ── limits ──
  // `limits: 100`（写成了标量）以前会被原样带进运行时：
  // `limits.maxCostUsdPerRun` 是 undefined → 三条预算护栏全部静默失效。
  const rawLimits = parsed['limits'];
  let limits: BudgetConfig['limits'];
  if (rawLimits === undefined || rawLimits === null) {
    limits = { maxCostUsdPerRun: 0.5, maxTokensPerRun: 100000, maxDurationSecPerRun: 900 };
  } else if (typeof rawLimits !== 'object' || Array.isArray(rawLimits)) {
    problems.push(`limits 必须是一个对象（下面缩进的字段），当前是 ${JSON.stringify(rawLimits)}`);
    limits = {};
  } else {
    const lim = rawLimits as Record<string, unknown>;
    // limits 内部同样要查：写错层级（比如把 maxTokensPerRequest 写到顶层）同样会静默失效
    const unknownLimits = Object.keys(lim).filter((k) => !KNOWN_LIMIT_KEYS.has(k));
    if (unknownLimits.length > 0) {
      console.warn(
        color.yellow(
          `⚠  budget.yml limits: 字段 ${unknownLimits.join(', ')} 当前版本不生效（见 CONFIG-SPEC.md）`,
        ),
      );
    }
    for (const key of ['maxCostUsdPerRun', 'maxTokensPerRun', 'maxTokensPerRequest', 'maxDurationSecPerRun'] as const) {
      const v = lim[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        problems.push(`limits.${key} 非法（${JSON.stringify(v)}，必须是非负数）`);
      }
    }
    limits = lim as BudgetConfig['limits'];
  }

  const out: BudgetConfig = { stage, limits };
  const preset = parsed['preset'];
  if (typeof preset === 'string') out.preset = preset;
  const weights = parsed['weights'];
  if (weights !== undefined && weights !== null) out.weights = weights as NonNullable<BudgetConfig['weights']>;
  if (problems.length > 0) out.problems = problems;
  return out;
}

/**
 * 解析项目根目录。
 *
 * 两种写法都要认：
 *   --project=/path/to/project
 *   --project /path/to/project
 *
 * 为什么：帮助文本写的是空格式（`--project <path>`），而实现早期只认等号格式 ——
 * 用户按帮助写就会**静默落到 CWD 的项目**上（在别的目录跑等于测错对象，
 * 而且不报错，最难发现）。
 */
export function projectRoot(): string {
  const eq = process.argv.find((a) => a.startsWith('--project='));
  if (eq) return resolve(eq.slice('--project='.length));
  const i = process.argv.indexOf('--project');
  if (i !== -1) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) return resolve(next);
  }
  return resolve(process.cwd());
}

export function activeLlmProvider(config: LlmConfig): LlmConfig['providers'][string] {
  const provider = config.providers[config.default];
  if (!provider) throw new Error(`provider ${config.default} not found`);
  return provider;
}

export function maskSecret(value?: string): string {
  if (!value) return '';
  if (value.startsWith('${')) return value;
  if (value.length <= 10) return '<configured>';
  return `<configured:••••${value.slice(-4)}>`;
}

export function llmConfigToYaml(config: LlmConfig): string {
  const provider = activeLlmProvider(config);
  let yml = `default: ${config.default}\n\nproviders:\n`;
  yml += `  ${config.default}:\n`;
  yml += `    type: ${provider.type}\n`;
  if (provider.baseUrl) yml += `    baseUrl: ${provider.baseUrl}\n`;
  if (provider.apiKey) yml += `    apiKey: ${provider.apiKey}\n`;
  yml += `    model: ${provider.model}\n`;
  // pricing 必须写回去 ——
  // 以前这里不写，于是「用 Web Settings 存一次配置」就把 pricing 抹掉了，
  // 美元预算护栏随之静默失效（只剩 token 上限在起作用），用户毫无察觉。
  if (provider.pricing) {
    yml += `    pricing:\n`;
    yml += `      pricePerMTokIn: ${provider.pricing.pricePerMTokIn}\n`;
    yml += `      pricePerMTokOut: ${provider.pricing.pricePerMTokOut}\n`;
  }
  return yml;
}

export function publicLlmSettings(config: LlmConfig): {
  configured: true;
  providerName: string;
  type: 'openai-compatible' | 'ollama-native';
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKey: string;
  model: string;
} {
  const provider = activeLlmProvider(config);
  return {
    configured: true,
    providerName: config.default,
    type: provider.type,
    baseUrl: provider.baseUrl ?? '',
    apiKeyConfigured: Boolean(provider.apiKey),
    apiKey: maskSecret(provider.apiKey),
    model: provider.model,
  };
}
