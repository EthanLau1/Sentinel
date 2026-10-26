/**
 * 离线模式用的 LLM 桩 —— 任何调用都直接抛错。
 *
 * 为什么要有它：kernel 的 ProviderSet 里 llm 是必填项，
 * 而"没有 LLM 也要能跑"是 Sentinel 的目标之一（离线检测）。
 * 与其让各处的 `if (!llm)` 分支到处漏，不如给一个**一定会失败**的桩：
 * 任何试图调用模型的地方都会立刻拿到明确的错误，而不是静默地"假装成功"。
 *
 * 它不是"假模型"：不返回任何内容，也不消耗 token。
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from '@sentinel/core';

export class OfflineLLMError extends Error {
  constructor() {
    super('offline mode: LLM 调用已禁用（当前运行不联网、不调用模型）');
    this.name = 'OfflineLLMError';
  }
}

export function createOfflineLLMProvider(): LLMProvider {
  return {
    name: 'offline',
    supportsTools: false,
    async chat(_messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
      throw new OfflineLLMError();
    },
    estimateCost(): number {
      return 0;
    },
  };
}
