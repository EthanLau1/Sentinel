/**
 * Ollama 原生 API Provider（非 OpenAI 兼容模式）。
 * 用于需要本地推理且不想走 OpenAI 协议的场景。
 */

import type {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
} from '@sentinel/core';

export interface OllamaNativeConfig {
  baseUrl?: string;
  model: string;
}

interface OllamaResp {
  message: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done: boolean;
}

export function createOllamaNativeProvider(config: OllamaNativeConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';

  return {
    name: 'ollama-native',
    supportsTools: false,

    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
      const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
      const body = {
        model: options.model ?? config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        ...(options.temperature !== undefined && {
          options: { temperature: options.temperature },
        }),
      };

      const ctrl = new AbortController();
      const timer = options.timeoutMs
        ? setTimeout(() => ctrl.abort(), options.timeoutMs)
        : undefined;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as OllamaResp;
        const promptTokens = data.prompt_eval_count ?? 0;
        const completionTokens = data.eval_count ?? 0;
        return {
          content: data.message.content,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          costUsd: 0, // 本地无成本
        };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    estimateCost(): number {
      return 0;
    },
  };
}
