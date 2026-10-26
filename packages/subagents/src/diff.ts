/**
 * unified diff 的接收端规范化。
 *
 * 为什么要规范化：LLM 产的 diff **格式常常不精确**，实测两类问题都会让产物彻底落不了盘：
 *
 *   ① hunk 头的行数与实际内容对不上
 *      LLM 写 `@@ -9,7 +9,7 @@`，但实际只给了 5 行上下文 + 1 减 + 1 加。
 *      `validPatch` 是严格校验器，会直接判它"格式非法" → 补丁被丢 → 报告说
 *      "Tier 2 写 patch 待审核"，磁盘上什么都没有。
 *      真实内容其实是对的，只是计数不准 —— 这属于**可修**的格式问题，不该整个丢掉。
 *
 *   ② `<think>` 推理块的残渣混进 diff
 *      模型先在推理里写了一遍示例 diff，再输出真正的 diff。
 *      接收端如果从第一个 `---` 开始截，就会把推理残渣当成 diff 的开头。
 *
 * 规范化只做两件事：**按实际行数重算 hunk 头** + **剥掉 think 残渣**。
 * 行号起点不改（改了反而更容易 apply 失败）；git apply 本身允许偏移匹配。
 */

export interface NormalizeResult {
  patch: string;
  /** 实际改动了哪些（可能被改写的行数写在这里，便于排查） */
  changed: boolean;
}

/**
 * 按实际内容重算每个 hunk 头的行数。
 * 输入必须是"结构像 diff"的文本；无法识别时原样返回（不制造新的错误）。
 */
export function normalizePatch(raw: string): NormalizeResult {
  // 先去掉尾部换行：split 出来的最后一个空串不是内容，
  // 当成上下文行会让 hunk 计数凭空 +1。
  const lines = raw.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.startsWith('@@')) {
      out.push(line);
      i += 1;
      continue;
    }

    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!header) {
      out.push(line);
      i += 1;
      continue;
    }

    const oldStart = Number(header[1]);
    const newStart = Number(header[3]);
    const body: string[] = [];
    let j = i + 1;

    // 收集 hunk 内容，直到下一个 hunk 头或下一个文件头
    while (j < lines.length && !lines[j]!.startsWith('@@') && !lines[j]!.startsWith('--- ')) {
      const l = lines[j]!;
      if (l.startsWith(' ') || l.startsWith('-') || l.startsWith('+') || l === '\\ No newline at end of file') {
        body.push(l);
        j += 1;
        continue;
      }
      // 空行在 diff 里是合法的上下文行（有的模型会漏掉前导空格）
      if (l.trim() === '') {
        body.push(' ');
        j += 1;
        continue;
      }
      break; // 不是 hunk 内容 → 收尾
    }

    let oldCount = 0;
    let newCount = 0;
    for (const l of body) {
      if (l.startsWith(' ') || l.startsWith('-')) oldCount += 1;
      if (l.startsWith(' ') || l.startsWith('+')) newCount += 1;
    }

    const declaredOld = header[2] === undefined ? 1 : Number(header[2]);
    const declaredNew = header[4] === undefined ? 1 : Number(header[4]);

    if (declaredOld !== oldCount || declaredNew !== newCount) {
      out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    } else {
      out.push(line);
    }
    out.push(...body);
    i = j;
  }

  return { patch: out.join('\n') + '\n', changed: out.join('\n') + '\n' !== raw };
}

/**
 * 剥掉 `<think>…</think>` 残渣（不闭合的尾块也一并去掉）。
 * 与 json.ts 的 stripThink 同规则，这里单独导出是为了 diff 侧独立使用。
 */
export function stripThinkResidue(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '');
}

/**
 * 补结尾换行。
 *
 * 为什么必须补（实测 run16）：`git apply` 要求 patch 以换行结束，
 * 少一个换行 → `error: corrupt patch at line N`（N = 最后一行）。
 * 这个错**在静态校验里查不出来**（validPatch 认为它是合法的），
 * 只在真跑 git 时才暴露 —— 一次就足以让 Tier 1 自动修复整条路径失效。
 */
export function ensureTrailingNewline(patch: string): string {
  return patch.endsWith('\n') ? patch : patch + '\n';
}
