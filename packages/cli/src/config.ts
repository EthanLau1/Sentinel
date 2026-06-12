/**
 * 配置加载 — 严格按 CONFIG-SPEC.md。
 * 支持简单 YAML 子集（key: value、嵌套、字符串、数字、布尔、列表）+ ${ENV_VAR} 替换。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface LlmConfig {
  default: string;
  providers: Record<
    string,
    {
      type: 'openai-compatible' | 'ollama-native';
      baseUrl?: string;
      apiKey?: string;
      model: string;
    }
  >;
  agents?: Record<string, string>;
}

export interface BudgetConfig {
  stage: 'Idea' | 'MVP' | 'Launch' | 'Scale';
  preset?: string;
  limits: {
    maxCostUsdPerRun?: number;
    maxTokensPerRun?: number;
    maxDurationSecPerRun?: number;
  };
  weights?: {
    confidence: number;
    impact: number;
    stageFit: number;
    effort: number;
    risk: number;
  };
}

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

export function expandEnv(value: string): string {
  return value.replace(ENV_REF, (_, name) => process.env[name as string] ?? '');
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
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf8');
  const parsed = parseSimpleYaml(text);
  return parsed as unknown as LlmConfig;
}

export async function loadBudgetConfig(projectRoot: string): Promise<BudgetConfig> {
  const path = join(projectRoot, '.sentinel', 'budget.yml');
  if (!existsSync(path)) {
    return {
      stage: 'MVP',
      limits: { maxCostUsdPerRun: 0.5, maxTokensPerRun: 100000, maxDurationSecPerRun: 300 },
    };
  }
  const text = await readFile(path, 'utf8');
  const parsed = parseSimpleYaml(text) as unknown as BudgetConfig;
  return {
    stage: parsed.stage ?? 'MVP',
    limits: parsed.limits ?? { maxCostUsdPerRun: 0.5, maxTokensPerRun: 100000, maxDurationSecPerRun: 300 },
    ...(parsed.preset && { preset: parsed.preset }),
    ...(parsed.weights && { weights: parsed.weights }),
  };
}

export function projectRoot(): string {
  const arg = process.argv.find((a) => a.startsWith('--project='));
  if (arg) return resolve(arg.slice('--project='.length));
  return resolve(process.cwd());
}
