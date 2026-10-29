import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOllamaNativeProvider } from '../src/llm/ollama-native.js';

/**
 * Ollama 原生视觉输入走 `images` 字段（base64 数组），
 * 不是 OpenAI 那种 content 数组 —— 写错格式模型会静默收不到图。
 */

const ORIGINAL_FETCH = globalThis.fetch;

describe('Ollama native provider 的视觉输入', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  function okResponse(): Response {
    return new Response(
      JSON.stringify({
        message: { role: 'assistant', content: '看到了' },
        prompt_eval_count: 10,
        eval_count: 2,
        done: true,
      }),
      { status: 200 },
    );
  }

  it('vision: true → 图片进 images 字段（base64 数组）', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const provider = createOllamaNativeProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2-vision',
      vision: true,
    });
    expect(provider.supportsVision).toBe(true);
    await provider.chat([
      { role: 'user', content: '看这张图', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
    ]);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].content).toBe('看这张图');
    expect(body.messages[0].images).toEqual(['AAAA']);
  });

  it('vision 关闭（默认）→ 不带 images 字段，supportsVision 为 false', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    const provider = createOllamaNativeProvider({
      baseUrl: 'http://localhost:11434',
      model: 'qwen3:7b',
    });
    expect(provider.supportsVision).toBe(false);
    await provider.chat([
      { role: 'user', content: '看这张图', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
    ]);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0].images).toBeUndefined();
  });
});
