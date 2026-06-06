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

  it('正常 chat 返回内容 + 用量 + 估算成本', async () => {
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
      pricing: { input: 0.001, output: 0.003 }, // per 1K
    });
    const r = await provider.chat([{ role: 'user', content: 'ping' }]);
    expect(r.content).toBe('hi');
    expect(r.usage.totalTokens).toBe(12);
    // cost = 10/1000 * 0.001 + 2/1000 * 0.003 = 0.00001 + 0.000006
    expect(r.costUsd).toBeCloseTo(0.000016, 6);
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
      pricing: { input: 0.002, output: 0.002 },
    });
    expect(provider.estimateCost(2000)).toBeCloseTo(0.004, 4);
  });
});
