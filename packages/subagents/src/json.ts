/**
 * LLM 回复的 JSON 稳健提取。
 *
 * 为什么需要它：真实模型的回复有三种常见污染 ——
 *   ① <think>…</think> 推理块（MiniMax-M3 / 带思考的模型默认会输出）
 *   ② ```json … ``` markdown 围栏
 *   ③ JSON 前后的自然语言废话
 *
 * 裸 JSON.parse 对这三种全部失败。而这些失败一旦被静默吞掉，
 * 就会出现"模型明明答对了，系统却说什么都没拿到"——
 * 表现为根因永远停在 hypothesis、修复方案永远是空。
 *
 * 所以这里既做提取，也**必须给出失败原因**（返回 ok:false + reason），
 * 让调用方能把失败说出来，而不是回落到"无根因"。
 */

export type JsonExtract<T> = { ok: true; value: T } | { ok: false; reason: string };

/** 去掉 <think>…</think>（含未闭合的残块） */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/** 去掉 markdown 围栏（```json … ``` 或 ``` … ```） */
function stripFence(text: string): string {
  return text
    .replace(/^\s*```(?:json|JSON)?\s*/, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/** 从文本里截出第一个完整的 {...} 或 [...] 块 */
function sliceBalanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 转义 JSON 字符串字面量里的裸控制字符（换行/回车/制表符）。
 *
 * LLM 输出带 unified diff 这类多行内容时，常忘记把换行转义成 \n，
 * 于是 JSON.parse 报 "Expected '}'"。这一步是纯语法修复，不改变语义。
 */
function escapeRawControlChars(text: string): string {
  let out = '';
  let inStr = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === '\n' || ch === '\r' || ch === '\t')) {
      out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 抢救被 max_tokens 截断的 JSON 数组。
 *
 * 场景（实测 run15）：模型输出撞上输出上限，JSON 在中途被切断，
 * 表现为 `Unterminated string` —— 5 级兜底全失败 → 方案退化成通用模板，
 * 报告里写着"快速修复（绕过/补丁）"，跟本项目毫无关系。
 *
 * 能救的不是"猜出剩下的内容"，而是**保住已经写完的那几个对象**：
 * 找到最后一个完整闭合的顶层对象，砍掉残缺部分并闭合数组。
 * 数组本身完整时返回 null（不需要抢救）。
 */
export function salvageTruncatedJsonArray(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const text = stripFence(stripThink(raw));
  const start = text.indexOf('[');
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let escaped = false;
  const elementEnds: number[] = [];

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { if (inStr) escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 1 && ch === '}') elementEnds.push(i);
      if (depth === 0) return null; // 数组本身是完整的，不需要抢救
    }
  }

  if (elementEnds.length === 0) return null;
  const last = elementEnds[elementEnds.length - 1]!;
  return text.slice(start, last + 1) + ']';
}

/**
 * 从 LLM 回复中提取 JSON。
 * 失败时返回原因，便于调用方把"解析失败"如实报出来。
 */
export function extractJson<T = unknown>(raw: string): JsonExtract<T> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: '模型回复为空' };
  }

  const attempts: Array<{ label: string; text: string }> = [];
  const withoutThink = stripThink(raw);
  attempts.push({ label: '原样', text: raw.trim() });
  if (withoutThink !== raw) attempts.push({ label: '去 <think> 块', text: withoutThink.trim() });
  attempts.push({ label: '去 <think> + 去围栏', text: stripFence(withoutThink) });

  const errors: string[] = [];
  for (const attempt of attempts) {
    if (!attempt.text) continue;
    try {
      return { ok: true, value: JSON.parse(attempt.text) as T };
    } catch (err) {
      errors.push(`${attempt.label}: ${(err as Error).message}`);
    }
  }

  // 兜底 1：从文本里截出第一个平衡的 JSON 块再试
  for (const attempt of attempts) {
    const sliced = sliceBalanced(attempt.text);
    if (!sliced) continue;
    try {
      return { ok: true, value: JSON.parse(sliced) as T };
    } catch (err) {
      errors.push(`截取块: ${(err as Error).message}`);
      // 兜底 2：把字符串里的裸换行转义后再试（unified diff 最常见的失败原因）
      try {
        return { ok: true, value: JSON.parse(escapeRawControlChars(sliced)) as T };
      } catch (err2) {
        errors.push(`转义后: ${(err2 as Error).message}`);
      }
    }
  }

  // 兜底 3：输出被 max_tokens 截断 → 保住已经写完的那几个对象
  const salvaged = salvageTruncatedJsonArray(raw);
  if (salvaged) {
    try {
      return { ok: true, value: JSON.parse(salvaged) as T };
    } catch (err) {
      errors.push(`抢救截断的 JSON: ${(err as Error).message}`);
    }
  }

  return {
    ok: false,
    reason: `无法从模型回复中解析 JSON（${errors.join('；')}）。原文前 200 字符：${raw.slice(0, 200)}`,
  };
}
