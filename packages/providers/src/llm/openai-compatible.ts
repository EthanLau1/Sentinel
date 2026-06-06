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
  /** 估算成本时使用，单位 USD per 1K tokens */
  pricing?: {
    input: number;
    output: number;
  };
  /** Provider 显示名（默认 'openai-compatible'） */
  displayName?: string;
}

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

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
): LLMProvider {
  const pricing = config.pricing ?? { input: 0, output: 0 };

  return {
    name: config.displayName ?? 'openai-compatible',
    supportsTools: true,

    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
      const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

      const body = {
        model: options.model ?? config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
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
      const timer = options.timeoutMs
        ? setTimeout(() => ctrl.abort(), options.timeoutMs)
        : undefined;

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

        const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const costUsd =
          (usage.prompt_tokens / 1000) * pricing.input +
          (usage.completion_tokens / 1000) * pricing.output;

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
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    estimateCost(tokens: number): number {
      // 粗略估算：假设输入输出各占一半
      const half = tokens / 2 / 1000;
      return half * pricing.input + half * pricing.output;
    },
  };
}
