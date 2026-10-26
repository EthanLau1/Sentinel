/**
 * OpenAI-compatible LLM Provider.
 *
 * 同时支持：
 *   - 用户自有 API（任何 /v1/chat/completions 兼容端点）
 *   - DeepSeek API
 *   - Ollama 的 OpenAI 兼容模式
 *   - 任何基于 OpenAI 协议的本地推理服务
 */

import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
} from '@sentinel/core';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * 单价，单位 **USD / 每百万 token**（与各供应商报价表口径一致）。
   * 不配则 costUsd 恒为 0 → 美元预算护栏不可执行。
   */
  pricing?: {
    pricePerMTokIn: number;
    pricePerMTokOut: number;
  };
  /** 单次请求的输出 token 上限 —— 防止"单次超长响应"打爆预算 */
  maxTokensPerRequest?: number;
  /** 单次请求超时（ms）—— 不设 = 一次网络抖动就能让整个 run 永久挂起 */
  timeoutMs?: number;
  /** Provider 显示名（默认 'openai-compatible'） */
  displayName?: string;
}

/**
 * LLM 请求默认超时。
 * 不设超时的后果不是"失败"，而是"永久挂起"：run 永远不返回，
 * 用户看不出任何错误 —— 比报错更糟的一种失败。
 */
/** 默认 LLM 请求超时（ms）—— 兜底值，agent 会显式传更合适的值 */
export const DEFAULT_LLM_TIMEOUT_MS = 180_000;

interface OpenAIChatResp {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 粗略 token 估算：英文约 4 字符/token，中文约 1.5 字符/token —— 取保守值 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
): LLMProvider {
  const pricing = config.pricing ?? { pricePerMTokIn: 0, pricePerMTokOut: 0 };
  let warnedAboutMissingUsage = false;

  return {
    name: config.displayName ?? 'openai-compatible',
    supportsTools: true,

    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
      const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

      // 单次请求的 token 上限：调用方没指定时用配置兜底
      const maxTokens = options.maxTokens ?? config.maxTokensPerRequest;

      const body = {
        model: options.model ?? config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(maxTokens !== undefined && { max_tokens: maxTokens }),
        ...(options.tools && {
          tools: options.tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }),
      };

      const ctrl = new AbortController();
      const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
        }

        const data = (await res.json()) as OpenAIChatResp;
        const choice = data.choices[0];
        if (!choice) throw new Error('LLM returned no choices');

        // Provider 不返回 usage 时不能记 0 —— 记 0 等于预算护栏完全失效
        let usage = data.usage;
        if (!usage) {
          const promptText = messages.map((m) => m.content).join('\n');
          const completionText = choice.message.content ?? '';
          const promptTokens = estimateTokens(promptText);
          const completionTokens = estimateTokens(completionText);
          usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
          };
          if (!warnedAboutMissingUsage) {
            warnedAboutMissingUsage = true;
            console.warn(
              '[sentinel] LLM 未返回 usage，token 数按字符估算 —— 预算护栏基于估算值（成本偏高，不会漏记）',
            );
          }
        }

        const costUsd =
          (usage.prompt_tokens / 1_000_000) * pricing.pricePerMTokIn +
          (usage.completion_tokens / 1_000_000) * pricing.pricePerMTokOut;

        const toolCalls = choice.message.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        return {
          content: choice.message.content ?? '',
          ...(toolCalls && { toolCalls }),
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
          costUsd,
        };
      } catch (err) {
        // 超时要给出人话，而不是 "This operation was aborted"
        if (ctrl.signal.aborted) {
          throw new Error(`LLM 请求超时（${timeoutMs}ms，model=${config.model}）—— 请求已中止`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },

    estimateCost(tokens: number): number {
      // 粗略估算：假设输入输出各占一半
      const half = tokens / 2;
      return (
        (half / 1_000_000) * pricing.pricePerMTokIn +
        (half / 1_000_000) * pricing.pricePerMTokOut
      );
    },
  };
}
