import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOpenAICompatibleProvider } from '../src/llm/openai-compatible.js';

const ORIGINAL_FETCH = globalThis.fetch;

describe('OpenAI-compatible provider', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('正常 chat 返回内容 + 用量 + 估算成本（单价单位 = USD / 每百万 token）', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      pricing: { pricePerMTokIn: 2.5, pricePerMTokOut: 10 },
    });
    const r = await provider.chat([{ role: 'user', content: 'ping' }]);
    expect(r.content).toBe('hi');
    expect(r.usage.totalTokens).toBe(12);
    // cost = 10/1e6 * 2.5 + 2/1e6 * 10 = 0.000025 + 0.00002
    expect(r.costUsd).toBeCloseTo(0.000045, 8);
    expect(mockFetch).toHaveBeenCalledOnce();
    const call = mockFetch.mock.calls[0]!;
    expect(call[0]).toBe('https://x.com/v1/chat/completions');
    expect((call[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-test',
    });
  });

  it('HTTP 错误 → 抛带状态码', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/500/);
  });

  it('estimateCost 计算', () => {
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'x',
      apiKey: 'k',
      model: 'm',
      pricing: { pricePerMTokIn: 2, pricePerMTokOut: 2 },
    });
    // 2000 tokens，输入输出一半 → 1000/1e6*2 + 1000/1e6*2 = 0.004
    expect(provider.estimateCost(2000)).toBeCloseTo(0.004, 6);
  });

  it('provider 不返回 usage → 按字符估算 token，不能记 0（否则预算护栏失效）', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'abcdefgh' } }],
          // 故意不给 usage
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
      pricing: { pricePerMTokIn: 2.5, pricePerMTokOut: 10 },
    });
    const r = await provider.chat([{ role: 'user', content: 'ping' }]);
    expect(r.usage.totalTokens).toBeGreaterThan(0);
    expect(r.usage.promptTokens).toBeGreaterThan(0);
    expect(r.usage.completionTokens).toBeGreaterThan(0);
    expect(r.costUsd).toBeGreaterThan(0);
  });

  it('maxTokensPerRequest → 请求体带 max_tokens（限制单次超长响应）', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
      maxTokensPerRequest: 8000,
    });
    await provider.chat([{ role: 'user', content: 'x' }]);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(8000);
  });

  it('调用方显式传 maxTokens 时优先于配置上限', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hi' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      ),
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
      maxTokensPerRequest: 8000,
    });
    await provider.chat([{ role: 'user', content: 'x' }], { maxTokens: 128 });
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(128);
  });

  it('请求不返回时按 timeoutMs 中止，并给出可读错误（不能永久挂起）', async () => {
    // 模拟"服务端不回应"：只有 abort 才会结束
    mockFetch.mockImplementationOnce(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as unknown as typeof fetch,
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
    });
    await expect(
      provider.chat([{ role: 'user', content: 'x' }], { timeoutMs: 60 }),
    ).rejects.toThrow(/超时/);
  });

  it('provider 配置的 timeoutMs 生效（不传 options 也不会永久挂起）', async () => {
    mockFetch.mockImplementationOnce(
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as unknown as typeof fetch,
    );
    const provider = createOpenAICompatibleProvider({
      baseUrl: 'https://x.com/v1',
      apiKey: 'k',
      model: 'm',
      timeoutMs: 60,
    });
    await expect(provider.chat([{ role: 'user', content: 'x' }])).rejects.toThrow(/超时/);
  });
});
