import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/json.js';

describe('extractJson — LLM 回复的稳健 JSON 提取', () => {
  it('纯 JSON 直接可解析', () => {
    const r = extractJson<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });

  it('<think> 推理块在前 → 仍能解析（MiniMax-M3 的真实返回形态）', () => {
    const raw = '<think>We need output JSON only. Let me think...</think>\n\n{"rootCause":"x","confidence":0.3}';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('x');
  });

  it('未闭合的 <think> 残块 → 仍能解析', () => {
    const raw = '<think>thinking forever...\n{"rootCause":"y"}';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('y');
  });

  it('markdown 围栏 → 仍能解析', () => {
    const raw = '```json\n{"rootCause":"z"}\n```';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('z');
  });

  it('JSON 前后有废话 → 截取平衡块后能解析', () => {
    const raw = '好的，我的分析如下：\n{"rootCause":"w","nested":{"a":[1,2]}}\n希望有帮助！';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('w');
  });

  it('think + 围栏 + 废话 三重污染 → 仍能解析', () => {
    const raw = '<think>abc</think>\n说明：\n```json\n{"rootCause":"v"}\n```\n结束';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('v');
  });

  it('数组也支持', () => {
    const raw = '<think>x</think>[{"id":1}]';
    const r = extractJson<Array<{ id: number }>>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
  });

  it('字符串里的花括号不会破坏截取', () => {
    const raw = '<think>x</think>{"text":"a { b } c","rootCause":"ok"}';
    const r = extractJson<{ rootCause: string }>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toBe('ok');
  });

  it('字符串里的裸换行（模型忘转义）→ 转义后能解析', () => {
    const raw = '<think>x</think>[{"id":"a","patch":"--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new"}]';
    const r = extractJson<Array<{ id: string; patch: string }>>(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]!.id).toBe('a');
      expect(r.value[0]!.patch).toContain('+++ b');
    }
  });

  it('完全不是 JSON → 失败并给出原因（不能静默）', () => {
    const r = extractJson('我今天不太想输出 JSON');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('无法从模型回复中解析 JSON');
  });

  it('空回复 → 失败并给出原因', () => {
    const r = extractJson('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('空');
  });

  it('失败原因里带原文片段，便于排查', () => {
    const r = extractJson('NOT_JSON_AT_ALL');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('NOT_JSON_AT_ALL');
  });
});
