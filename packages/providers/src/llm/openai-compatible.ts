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
  /**
   * 该模型**支持看图**时置 true —— 截图会作为图片随消息发给模型。
   *
   * 为什么默认关闭：
   *   1. 很多模型收图片会直接报错（"content must be a string"），整轮 run 会挂；
   *   2. 截图会**上传到外部 API** —— 这是把现场页面内容传出本机，必须用户显式同意；
   *   3. 图片 token 比文本贵得多，会打爆 token 预算。
   * 不开这个开关，截图仍然落盘在 reports/evidence/，报告里仍能打开。
   */
  vision?: boolean;
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

/**
 * 图片的粗略 token 估算。
 *
 * OpenAI 视觉模型一张 1024×1024 图约 1000+ token，跟 base64 长度只是弱相关。
 * 这里按 base64 长度折算，**只用于 provider 没返回 usage 时的兜底**，
 * 目的是别把带图请求记成 0 token（记 0 = 预算护栏完全失效）。
 */
function estimateImageTokens(base64Length: number): number {
  return Math.ceil(base64Length / 750);
}

/**
 * 把内部消息转成 OpenAI 协议的请求体形状。
 *
 * 有图时 content 变成数组（text + image_url）—— 这是 OpenAI 视觉输入的官方格式。
 * 只有 user 消息能带图：system / assistant 带图会被服务端拒。
 * provider 不支持视觉时，图片直接丢掉（不发也不报错），文本内容保持原样。
 */
function toWireMessage(
  m: ChatMessage,
  vision: boolean,
): { role: string; content: string | Array<Record<string, unknown>> } {
  const images = vision && m.role === 'user' ? (m.images ?? []) : [];
  if (images.length === 0) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      { type: 'text', text: m.content },
      ...images.map((img) => ({
        type: 'image_url',
        image_url: { url: `data:${img.mimeType};base64,${img.data}` },
      })),
    ],
  };
}

export function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
): LLMProvider {
  const pricing = config.pricing ?? { pricePerMTokIn: 0, pricePerMTokOut: 0 };
  const vision = config.vision === true;
  let warnedAboutMissingUsage = false;

  return {
    name: config.displayName ?? 'openai-compatible',
    supportsTools: true,
    supportsVision: vision,

    async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
      const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

      // 单次请求的 token 上限：调用方没指定时用配置兜底
      const maxTokens = options.maxTokens ?? config.maxTokensPerRequest;

      const body = {
        model: options.model ?? config.model,
        messages: messages.map((m) => toWireMessage(m, vision)),
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
          // 带图的请求，图片 token 也得算进去 —— 记 0 等于预算护栏失效
          const imageTokens = vision
            ? messages.reduce(
                (sum, m) =>
                  sum + (m.images ?? []).reduce((s, img) => s + estimateImageTokens(img.data.length), 0),
                0,
              )
            : 0;
          const promptTokens = estimateTokens(promptText) + imageTokens;
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
