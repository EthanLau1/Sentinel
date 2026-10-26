/**
 * Ollama 原生 API Provider（非 OpenAI 兼容模式）。
 * 用于需要本地推理且不想走 OpenAI 协议的场景。
 */

import { DEFAULT_LLM_TIMEOUT_MS } from './openai-compatible.js';
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
      // 不设超时的后果不是"失败"，而是"永久挂起" —— 整个 run 永远不返回
      const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

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
      } catch (err) {
        if (ctrl.signal.aborted) {
          throw new Error(`LLM 请求超时（${timeoutMs}ms，model=${config.model}）—— 请求已中止`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },

    estimateCost(): number {
      return 0;
    },
  };
}
