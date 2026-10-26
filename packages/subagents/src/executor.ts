/**
 * Executor subagent — 接收 fix.enhanced，按 Tier 决定动作。
 *
 * Tier 0: 仅报告
 * Tier 1: 低风险自动修 → 应用后重跑受影响 flow，转绿则保留，转不绿自动回滚
 * Tier 2: 写 patch；可生成 PR（需显式开启）
 * Tier 3: 仅建议
 *
 * 红线：
 *   - **Tier 由硬规则判定**（classifyTier），不采信 LLM 给的 tier
 *   - 只改被测项目，且只改白名单文件类型
 *   - 永远不直接 push 到受保护分支；PR 走**新建的独立分支**（sentinel/fix-*）
 *   - 改动前备份原文件，验证不通过自动还原
 *   - 数据库迁移 / 权限 / 凭据相关一律降级为 Tier 3（仅建议）
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { Subagent, KernelContext, FixOption } from '@sentinel/core';
import { ensureTrailingNewline } from './diff.js';

export function validPatch(patch: unknown): patch is string {
  if (typeof patch !== 'string' || !patch.trim()) return false;
  const lines = patch.trimEnd().split('\n').filter((line) => !/^(diff --git |index [0-9a-f]+\.\.[0-9a-f]+(?: \d+)?$)/.test(line));
  let files = 0;
  for (let i = 0; i < lines.length;) {
    const old = /^--- a\/(.+)$/.exec(lines[i] ?? '');
    const next = /^\+\+\+ b\/(.+)$/.exec(lines[i + 1] ?? '');
    const target = old?.[1];
    if (!target || !next || target !== next[1] || target.split('/').some((part) => !part || part === '..' || part === '.')) return false;
    files += 1;
    i += 2;
    let hunks = 0;
    while (i < lines.length && !lines[i]!.startsWith('--- a/')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]!);
      if (!header) return false;
      let before = Number(header[2] ?? 1);
      let after = Number(header[4] ?? 1);
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('--- a/')) {
        const line = lines[i]!;
        if (line.startsWith(' ')) { before -= 1; after -= 1; }
        else if (line.startsWith('-')) before -= 1;
        else if (line.startsWith('+')) after -= 1;
        else if (line !== '\\ No newline at end of file') return false;
        if (before < 0 || after < 0) return false;
        i += 1;
      }
      if (before !== 0 || after !== 0) return false;
      hunks += 1;
    }
    if (!hunks) return false;
  }
  return files > 0;
}

// ── Tier 硬规则 ────────────────────────────────────────────────────────────
// 宪法：Tier 由 executor 硬规则判断，不靠 LLM prompt 决定。
// LLM 只能给建议，硬规则给最终判定 —— 而且 LLM 判 Tier 1 的，硬规则不认就降级。

export interface TierDecision {
  tier: 0 | 1 | 2 | 3;
  reason: string;
}

// 注意：JS 正则里汉字属于非 word 字符，`\b` 在汉字前不成立 ——
// 中文关键词一律不写前导 `\b`，否则「生成 app.map」这种最典型的低风险修复会漏判。
/** 一律仅建议（改这些等于改地基，出错的代价远高于收益） */
// 中文关键词同样要覆盖：LLM 用中文描述「数据库迁移」时，英文规则一律漏判，
// 实测中文 fix 描述（含 description/whyRecommended）完全命中不了这些正则。
const HARD_RISK_RULES: Array<{ re: RegExp; why: string }> = [
  { re: /\b(migrat\w*|schema\.sql|alembic|flyway|liquibase)\b|数据库迁移|数据迁移|迁移脚本/i, why: '数据库迁移' },
  { re: /\b(permission|permissions|rbac|acl|authorize|authorisation|authorization)\b|权限模型|权限校验|授权/i, why: '权限模型' },
  { re: /\b(auth|login|session|jwt|oauth|sso)\b|登录|会话|鉴权|认证/i, why: '登录/会话' },
  { re: /\b(secret|credential|password|api[\s_-]?key|private[\s_-]?key)\b|\.env\b|密钥|凭据|凭证/i, why: '凭据' },
  { re: /\b(security|vulnerab\w*|cve|sanitiz\w*|xss|csrf|cors)\b|安全漏洞|安全审计/i, why: '安全相关' },
  { re: /\b(lock\.json|lock\.yaml|package-lock|yarn\.lock|pnpm-lock|Cargo\.lock|go\.sum)\b/i, why: '依赖锁文件' },
  { re: /\b(ci|pipeline|dockerfile|compose)\b|\.github\/workflows|流水线|部署配置/i, why: '构建/部署配置' },
];

/** 可以自动修（低风险、可验证、可回滚） */
const LOW_RISK_RULES: Array<{ re: RegExp; why: string }> = [
  { re: /\b(format|prettier|eslint|lint|stylelint|whitespace|indentation|indent)\b/i, why: '格式/风格' },
  { re: /\b(typo|misspell\w*|spelling)\b|拼写/i, why: '拼写' },
  { re: /\bcomment\b|注释|docstring/i, why: '注释' },
  { re: /\bapp\.map\b|\bfeature\s*map\b|生成\s*app\.map/i, why: '生成 app.map' },
  { re: /\bmissing\s*config\b|缺少配置|缺配置|补配置|\.env\s*example/i, why: '缺失配置' },
  { re: /\bREADME\b|文档|documentation/i, why: '文档' },
];

export function classifyTier(opt: FixOption): TierDecision {
  const llmTier = opt.tier;
  const text = [
    opt.title,
    opt.description,
    opt.whyRecommended ?? '',
    opt.patch ?? '',
  ].join('\n');

  for (const rule of HARD_RISK_RULES) {
    if (rule.re.test(text)) {
      return { tier: 3, reason: `命中硬规则「${rule.why}」→ 仅建议，不自动改` };
    }
  }
  // LLM 判 Tier 3 是「更保守」的信号 —— 硬规则只能收紧，不能放宽它。
  // 宪法第 58 行「高风险只能建议」：放宽会把架构/安全类改动降级成"写个 patch 等人看"，
  // 那已经越过了 Tier 3 的边界。
  if (llmTier === 3) {
    return { tier: 3, reason: 'LLM 判定为高风险（Tier 3，仅建议），硬规则不放宽 → 仅建议，不自动改' };
  }
  for (const rule of LOW_RISK_RULES) {
    if (rule.re.test(text)) {
      return { tier: 1, reason: `命中低风险规则「${rule.why}」→ 可自动修` };
    }
  }
  if (isRenameOnlyPatch(opt.patch)) {
    return { tier: 1, reason: '命中补丁形状规则「单文件单 hunk 且仅标识符不同（拼写/重命名类）」→ 可自动修' };
  }
  return {
    tier: 2,
    // 措辞必须与实际一致：只有真的从 Tier 1 降下来才写"降级"，
    // 否则 LLM 本来就判 Tier 2 还写"降级"，报告会误导人。
    reason: llmTier === 1
      ? '未命中任何低风险规则（LLM 原判 Tier 1）→ 降级为需人工确认'
      : '未命中任何低风险规则 → 需人工确认',
  };
}

// ── 补丁形状判定 ────────────────────────────────────────────────────────────
// 为什么用形状而不是关键词：中文 LLM 描述「把 postList 改成 posts」不会写"拼写"，
// 关键词法必然漏判（实测 run12–run14 全部漏判，Tier 1 永远触发不了）。
// 补丁形状是确定性的：单文件、单 hunk、差异只在标识符 → 就是拼写/重命名类改动。
//
// 关键词表：JS/TS 关键字必须保留原样，否则 `null` → `undefined` 会被误判成"重命名"。
const JS_KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'is', 'keyof', 'let', 'namespace',
  'new', 'null', 'of', 'private', 'protected', 'public', 'readonly', 'require',
  'return', 'satisfies', 'set', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
]);

/** 把标识符替换成占位符（关键字保持原样），用于比较两行是否"只差名字" */
function tokenizeLine(line: string): string {
  return line.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (m) => (JS_KEYWORDS.has(m) ? m : '⟨ID⟩'));
}

/**
 * 判定一个 patch 是否只是「改了名字」（拼写/重命名类）——
 * 单文件、单 hunk、增删行数量相同，且逐对比较时除了标识符以外完全一致。
 */
export function isRenameOnlyPatch(patch: unknown): boolean {
  if (!validPatch(patch)) return false;
  const lines = patch.trimEnd().split('\n');
  const minus: string[] = [];
  const plus: string[] = [];
  let files = 0;
  let hunks = 0;

  for (let i = 0; i < lines.length;) {
    if (!lines[i]!.startsWith('--- a/')) {
      i += 1;
      continue;
    }
    files += 1;
    i += 2; // 跳过 +++ b/...
    while (i < lines.length && lines[i]!.startsWith('@@ ')) {
      hunks += 1;
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith('@@ ') && !lines[i]!.startsWith('--- a/')) {
        const line = lines[i]!;
        if (line.startsWith('-')) minus.push(line.slice(1));
        else if (line.startsWith('+')) plus.push(line.slice(1));
        i += 1;
      }
    }
  }

  if (files !== 1 || hunks !== 1) return false;
  if (minus.length === 0 || minus.length !== plus.length) return false;
  // 至少有一行真的变了（否则是无操作 patch）
  if (!minus.some((m, idx) => m !== plus[idx])) return false;
  return minus.every((m, idx) => tokenizeLine(m) === tokenizeLine(plus[idx]!));
}

/** 允许被自动修改的文件类型（白名单） */
const ALLOWED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.css', '.scss', '.less',
  '.json', '.md', '.mdx', '.txt', '.yml', '.yaml',
];

/** 绝对不许自动改的路径片段 */
const DENIED_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(migrations?|migrate)\//i,
  /(^|\/)schema\.prisma$/i,
  /(^|\/)(auth|session|permission|rbac)\b/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
];

export function isAllowedTarget(path: string): { allowed: boolean; reason: string } {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.includes('..')) return { allowed: false, reason: '路径含 ..' };
  for (const p of DENIED_PATH_PATTERNS) {
    if (p.test(normalized)) return { allowed: false, reason: `命中禁止改动的路径规则：${p}` };
  }
  const dot = normalized.lastIndexOf('.');
  const ext = dot >= 0 ? normalized.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { allowed: false, reason: `文件类型 ${ext || '(无扩展名)'} 不在自动修改白名单内` };
  }
  return { allowed: true, reason: '' };
}

/** 从 unified diff 里取出被改动的文件路径 */
export function patchTargets(patch: string): string[] {
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return [...new Set(out)];
}

// ── 应用 / 回滚 ────────────────────────────────────────────────────────────

interface ApplyResult {
  applied: boolean;
  files: string[];
  error?: string;
  /** 备份：路径 → 原内容（文件原本不存在时为 null） */
  backup: Map<string, string | null>;
}

async function runCommand(
  cwd: string,
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { cwd, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => resolvePromise({ code: -1, stdout, stderr: String(err) }));
    child.on('close', (code) => {
      if (stdin !== undefined && !child.stdin?.destroyed) child.stdin?.end(stdin);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin?.on('error', () => { /* git 提前退出时忽略 EPIPE */ });
      child.stdin?.end(stdin);
    }
  });
}

/**
 * 用 git apply 应用 patch。
 * 在项目根目录执行 —— git 会把"子目录之外的路径"忽略掉，
 * 天然保证不会改到被测项目之外的文件。
 */
/**
 * 给「零上下文」的 hunk 补上真实上下文。
 *
 * 为什么必须做：LLM 改一行时经常只输出那一行（`@@ -12,1 +12,1 @@`），
 * 而 **git 默认不接受零上下文的 diff**（报 "patch does not apply"）。
 * 加 `--unidiff-zero` 确实能过，但那样 git **不校验上下文** ——
 * 行号一过期就改错地方，对"自动改用户代码"来说太危险。
 *
 * 正确做法：读目标文件，把 hunk 前后的真实内容补成上下文行，
 * 让 git 自己去校验 —— 内容对不上就拒绝（安全），对得上就应用（可用）。
 * 补上下文之后行号过期也没关系，git 本来就允许偏移匹配。
 */
export async function expandZeroContextHunks(
  projectRoot: string,
  patch: string,
  contextLines = 3,
): Promise<string> {
  // 结尾换行先去掉 —— 否则 split 出来的最后一个空串会被当成 hunk 内容
  const lines = patch.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const out: string[] = [];
  let i = 0;
  let changed = false;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.startsWith('--- a/')) {
      out.push(line);
      i += 1;
      continue;
    }

    const target = line.slice('--- a/'.length).trim();
    out.push(line);
    i += 1;
    if (lines[i]?.startsWith('+++ ')) {
      out.push(lines[i]!);
      i += 1;
    }

    // 读目标文件（读不到就保持原样，交给 git 去报错）
    let fileLines: string[] | undefined;
    try {
      const content = await readFile(join(projectRoot, target), 'utf8');
      fileLines = content.split('\n');
      // 文件末尾的换行会 split 出一个空串 —— 它不是真实的一行，剔掉
      // （否则补出来的上下文会多一行空白，patch 直接失效）
      if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '') fileLines.pop();
    } catch {
      fileLines = undefined;
    }

    while (i < lines.length && lines[i]!.startsWith('@@')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]!);
      if (!header) {
        out.push(lines[i]!);
        i += 1;
        continue;
      }
      const oldStart = Number(header[1]);
      const newStart = Number(header[3]);
      const oldCount = header[2] === undefined ? 1 : Number(header[2]);
      const newCount = header[4] === undefined ? 1 : Number(header[4]);

      // 收集 hunk 内容
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j]!.startsWith('@@') && !lines[j]!.startsWith('--- ')) {
        body.push(lines[j]!);
        j += 1;
      }

      const hasContext = body.some((l) => l.startsWith(' '));
      if (hasContext || !fileLines) {
        out.push(lines[i]!, ...body);
        i = j;
        continue;
      }

      // 零上下文 → 按内容找锚点，再补前后真实内容
      const removed = body.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
      const anchor = locateAnchor(fileLines, removed, oldStart);
      const delta = anchor - oldStart;
      const before: string[] = [];
      const after: string[] = [];
      for (let n = anchor - 1; n >= 1 && before.length < contextLines; n -= 1) {
        const c = fileLines[n - 1];
        if (c === undefined) break;
        before.unshift(c);
      }
      const oldEnd = anchor + oldCount - 1;
      for (let n = oldEnd + 1; n <= fileLines.length && after.length < contextLines; n += 1) {
        const c = fileLines[n - 1];
        if (c === undefined) break;
        after.push(c);
      }

      const beforeCtx = before.map((c) => ` ${c}`);
      const afterCtx = after.map((c) => ` ${c}`);
      const newOldStart = oldStart + delta - before.length;
      const newNewStart = newStart + delta - before.length;
      const newOldCount = oldCount + before.length + after.length;
      const newNewCount = newCount + before.length + after.length;

      out.push(`@@ -${newOldStart},${newOldCount} +${newNewStart},${newNewCount} @@`);
      out.push(...beforeCtx, ...body, ...afterCtx);
      changed = true;
      i = j;
    }
  }

  return changed ? out.join('\n') + '\n' : patch;
}

/**
 * 在文件里按**内容**定位 hunk 的真实位置。
 *
 * 为什么必须按内容找：模型给的行号经常不准。
 * 实测（virtual-event-starter-kit）：补丁声称改第 42 行，实际那行在第 39 行，
 * 而零上下文补丁 git 不会做偏移匹配 → 直接 "patch does not apply"。
 * 如果按声称的行号去补上下文，补出来的上下文和 hunk 内容根本不在一处 → 补丁照样打不上。
 */
function locateAnchor(fileLines: string[], removed: string[], stated: number): number {
  if (removed.length === 0) return stated;
  const hits: number[] = [];
  for (let i = 0; i + removed.length <= fileLines.length; i += 1) {
    let ok = true;
    for (let k = 0; k < removed.length; k += 1) {
      if (fileLines[i + k] !== removed[k]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i + 1);
  }
  if (hits.length === 0) return stated;
  let best = hits[0]!;
  for (const h of hits) {
    if (Math.abs(h - stated) < Math.abs(best - stated)) best = h;
  }
  return best;
}

/**
 * 把 patch 应用到指定目录 —— 导出是为了让回测器走**同一条真实路径**
 * （自己另写一份 git apply 调用 = 两份实现 = 回测测不到真实行为）。
 */
export async function applyPatch(projectRoot: string, patch: string, targets: string[]): Promise<ApplyResult> {
  const backup = new Map<string, string | null>();
  for (const t of targets) {
    try {
      backup.set(t, await readFile(join(projectRoot, t), 'utf8'));
    } catch {
      backup.set(t, null);
    }
  }

  // git apply 要求 patch 以换行结束，少一个换行就报 "corrupt patch at line N"
  const patchText = ensureTrailingNewline(patch);
  // 零上下文的 hunk（LLM 改一行时常见）git 默认不认 → 先补上下文再交给 git 校验
  const applicable = await expandZeroContextHunks(projectRoot, patchText);

  const check = await runCommand(projectRoot, 'git', ['apply', '--check', '-p1', '-'], applicable);
  if (check.code !== 0) {
    return {
      applied: false,
      files: targets,
      error: `git apply --check 失败：${(check.stderr || check.stdout).slice(0, 300)}`,
      backup,
    };
  }

  const applied = await runCommand(projectRoot, 'git', ['apply', '-p1', '-'], applicable);
  if (applied.code !== 0) {
    return {
      applied: false,
      files: targets,
      error: `git apply 失败：${(applied.stderr || applied.stdout).slice(0, 300)}`,
      backup,
    };
  }

  return { applied: true, files: targets, backup };
}

/** 还原备份 */
async function restoreBackup(projectRoot: string, backup: Map<string, string | null>): Promise<string[]> {
  const restored: string[] = [];
  for (const [path, content] of backup) {
    try {
      if (content === null) {
        const { unlink } = await import('node:fs/promises');
        await unlink(join(projectRoot, path));
      } else {
        await mkdir(dirname(join(projectRoot, path)), { recursive: true });
        await writeFile(join(projectRoot, path), content, 'utf8');
      }
      restored.push(path);
    } catch {
      // 还原失败也要说出来
    }
  }
  return restored;
}

export interface ExecutorConfig {
  /** 允许处理的最高 Tier（默认 3 = 宪法定义的 Tier 1/2/3 全部产出对应产物） */
  maxTier?: 0 | 1 | 2 | 3;
  /** 被测项目根目录（Tier 1 自动修复需要） */
  projectRoot?: string;
  /** 是否允许真正改动被测项目源码（默认 false） */
  autoApply?: boolean;
  /** 是否允许生成 PR（默认 false） */
  createPr?: boolean;
}

export function createExecutor(config: ExecutorConfig = {}): Subagent {
  // 默认 3，不是 1 —— 宪法第 130 行要求「Tier 2 自动写 patch，但需要人确认」。
  // 曾经默认 1，导致 Tier 2 的分支整个被跳过：patch 文件永不落盘，
  // 报告却写着"Tier 2 — 写 patch 待审核"，报告说能做、实际没做。
  const maxTier = config.maxTier ?? 3;
  const projectRoot = config.projectRoot ? resolve(config.projectRoot) : undefined;
  const autoApply = config.autoApply === true;
  const createPr = config.createPr === true;
  /** 已应用 patch 的备份 —— 验证不通过时按它还原 */
  const appliedBackups = new Map<string, { root: string; backup: Map<string, string | null> }>();

  return {
    name: 'executor',

    register(ctx: KernelContext): void {
      // 修复后重跑仍然失败 → 自动回滚（"坏了能回滚"是闭环的另一半）
      ctx.bus.subscribe<{ flowId: string; error: string; phase?: string; patchId?: string }>(
        'flow.failed',
        async (event) => {
          if (event.payload.phase !== 'after-fix' || !event.payload.patchId) return;
          const entry = appliedBackups.get(event.payload.patchId);
          if (!entry || !projectRoot) return;
          const restored = await restoreBackup(entry.root, entry.backup);
          appliedBackups.delete(event.payload.patchId);
          await ctx.bus.publish({
            type: 'patch.reverted',
            payload: {
              fixId: event.payload.patchId,
              flowId: event.payload.flowId,
              files: restored,
              reason: `修复后重跑仍失败（${event.payload.error.slice(0, 120)}）→ 已回滚`,
            },
            source: 'executor',
            traceId: event.traceId,
          });
        },
      );

      ctx.bus.subscribe<{ bug: import('@sentinel/core').BugFinding; options: FixOption[] }>('fix.enhanced', async (event) => {
        for (const opt of event.payload.options) {
          // Tier 由硬规则判定 —— 不采信 LLM 给的 tier
          const decision = classifyTier(opt);
          const tier = decision.tier;

          await ctx.bus.publish({
            type: 'executor.tier_decided',
            payload: {
              fixId: opt.id,
              tier,
              reason: decision.reason,
              llmTier: opt.tier,
            },
            source: 'executor',
            traceId: event.traceId,
          });

          if (tier > maxTier) {
            // 被 maxTier 拦下也必须有出口 —— 静默跳过等于"报告说能做、实际没做"
            await ctx.bus.publish({
              type: 'patch.rejected',
              payload: {
                fixId: opt.id,
                reason: `Tier ${tier} 超出本次允许的最高 Tier（maxTier=${maxTier}）→ 未产出补丁`,
                tier,
                maxTier,
              },
              source: 'executor',
              traceId: event.traceId,
            });
            continue;
          }
          // Tier 0 = 只报告不修（宪法定义），这不是"被拒绝"，
          // 它的出口是 executor.tier_decided，不重复记成 rejected。
          if (tier === 0) continue;

          if (tier === 1 && opt.patch) {
            await handleTier1(
              ctx, opt, event.payload.bug.affectedFeature, event.traceId,
              projectRoot, autoApply, appliedBackups,
            );
          } else if (tier === 2 && opt.patch) {
            await writePatchFile(ctx, opt, event.traceId);
            // 只给推荐方案建 PR —— 一个 bug 对应一个 PR，否则会一次推多个 PR
            const recommendedId =
              event.payload.bug.recommendedFixId
              ?? (event.payload.options.length === 1 ? event.payload.options[0]!.id : undefined);
            if (createPr && projectRoot && isRecommended(recommendedId, opt.id)) {
              await handlePr(ctx, opt, projectRoot, event.traceId);
            }
          } else if (tier === 2) {
            // Tier 2 但 LLM 没给 patch → 也要说出来（否则报告说"Tier 2 写 patch"，
            // 磁盘上什么都没有）
            await rejectFix(ctx, opt, event.traceId, 'Tier 2 方案没有可用 patch（LLM 未产出或格式非法）→ 未落盘');
          } else if (tier === 3) {
            await writeSuggestion(ctx, opt, event.traceId);
          }
        }
      });
    },
  };
}

async function handleTier1(
  ctx: KernelContext,
  opt: FixOption,
  flowId: string,
  traceId: string,
  projectRoot: string | undefined,
  autoApply: boolean,
  appliedBackups: Map<string, { root: string; backup: Map<string, string | null> }>,
): Promise<void> {
  // 默认只落盘 patch，不动用户代码 —— 改代码必须显式开启
  if (!autoApply || !projectRoot) {
    await writeAutoPatchFile(ctx, opt, traceId);
    return;
  }

  if (!validPatch(opt.patch)) {
    // 格式非法的 patch 不能静默丢掉 —— 必须说出来，否则用户以为"自动修了"
    await ctx.bus.publish({
      type: 'patch.rejected',
      payload: { fixId: opt.id, reason: 'patch 格式非法（不是合法的 unified diff）' },
      source: 'executor',
      traceId,
    });
    return;
  }
  const targets = patchTargets(opt.patch);
  for (const t of targets) {
    const check = isAllowedTarget(t);
    if (!check.allowed) {
      await ctx.bus.publish({
        type: 'patch.rejected',
        payload: { fixId: opt.id, file: t, reason: check.reason },
        source: 'executor',
        traceId,
      });
      return;
    }
  }

  const result = await applyPatch(projectRoot, opt.patch, targets);
  if (!result.applied) {
    await ctx.bus.publish({
      type: 'patch.rejected',
      payload: { fixId: opt.id, files: targets, reason: result.error ?? 'patch 应用失败' },
      source: 'executor',
      traceId,
    });
    return;
  }

  appliedBackups.set(opt.id, { root: projectRoot, backup: result.backup });

  await ctx.bus.publish({
    type: 'patch.applied',
    payload: { fixId: opt.id, files: targets, flowId },
    source: 'executor',
    traceId,
  });
}

/** PR 分支名：fixId 可能带非法字符，先净化 */
function prBranchName(fixId: string): string {
  const safe = fixId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `sentinel/fix-${safe || 'unknown'}`;
}

/**
 * 真正建一个 PR（Tier 2，需人工审查）。
 *
 * 为什么要真做：之前这里写死了 `gh pr create --dry-run`，
 * 于是 CLI 的 `--create-pr` 传了也没用 —— 报告写着"已建 PR"，
 * 磁盘上什么都没有（"报告说能做、实际没做"）。
 * 现在 `--create-pr` = 真的建 PR，链路是：
 *   建独立分支 → 应用补丁 → 提交 → 推送分支 → gh pr create → 切回原分支
 *
 * 红线：
 *   - 只推**新建的分支**，绝不推当前分支（受保护分支）
 *   - 目标文件必须过白名单（isAllowedTarget）
 *   - 被改动的**已跟踪文件**必须没有未提交改动（否则会把用户的半成品混进 PR）
 *   - 任何一步失败都要切回原分支并说清楚原因，不留半成品状态
 */
async function handlePr(
  ctx: KernelContext,
  opt: FixOption,
  projectRoot: string,
  traceId: string,
): Promise<void> {
  const title = `chore(sentinel): ${opt.title}`;
  const body = `${opt.description}\n\n${opt.whyRecommended ?? ''}\n\n---\n由 Sentinel 自动生成（Tier 2，需人工审查）`;

  if (!opt.patch || !validPatch(opt.patch)) {
    await rejectFix(ctx, opt, traceId, 'Tier 2 方案没有合法 patch → 未建 PR');
    return;
  }
  const targets = patchTargets(opt.patch);
  for (const t of targets) {
    const check = isAllowedTarget(t);
    if (!check.allowed) {
      await rejectFix(ctx, opt, traceId, `PR 涉及不允许改动的文件（${t}）：${check.reason} → 未建 PR`);
      return;
    }
  }

  // ── 前置检查：仓库状态、远端、gh ──────────────────────────────────────
  const inRepo = await runCommand(projectRoot, 'git', ['rev-parse', '--show-toplevel']);
  if (inRepo.code !== 0) {
    await rejectFix(ctx, opt, traceId, '被测目录不是 git 仓库 → 未建 PR');
    return;
  }
  // 只看已跟踪文件的改动：未跟踪文件不会被我们提交（只 add 补丁涉及的文件）
  const dirty = await runCommand(projectRoot, 'git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty.stdout.trim() !== '') {
    await rejectFix(
      ctx, opt, traceId,
      `工作区有未提交的改动（${dirty.stdout.trim().split('\n')[0]}）→ 未建 PR（避免把无关改动混进 PR）`,
    );
    return;
  }
  const currentRes = await runCommand(projectRoot, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const currentBranch = currentRes.stdout.trim();
  const remote = await runCommand(projectRoot, 'git', ['remote', 'get-url', 'origin']);
  if (remote.code !== 0) {
    await rejectFix(ctx, opt, traceId, '没有 origin 远端 → 未建 PR');
    return;
  }
  const gh = await runCommand(projectRoot, 'gh', ['--version']);
  if (gh.code !== 0) {
    await rejectFix(ctx, opt, traceId, '找不到 gh CLI → 未建 PR');
    return;
  }

  // 基础分支：优先用 origin/HEAD，认不出来就用当前分支
  const baseRes = await runCommand(projectRoot, 'git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const base = baseRes.code === 0 ? baseRes.stdout.trim().replace(/^origin\//, '') : currentBranch;

  // ── 建分支 → 应用补丁 → 提交 → 推送 → 建 PR ───────────────────────────
  const branch = prBranchName(opt.id);
  const sw = await runCommand(projectRoot, 'git', ['switch', '-c', branch]);
  if (sw.code !== 0) {
    await rejectFix(ctx, opt, traceId, `创建分支 ${branch} 失败 → 未建 PR：${(sw.stderr || sw.stdout).slice(0, 200)}`);
    return;
  }

  const applied = await applyPatch(projectRoot, opt.patch, targets);
  if (!applied.applied) {
    await restoreBackup(projectRoot, applied.backup);
    await runCommand(projectRoot, 'git', ['switch', currentBranch]);
    await rejectFix(ctx, opt, traceId, `补丁应用失败 → 未建 PR：${(applied.error ?? '').slice(0, 200)}`);
    return;
  }

  await runCommand(projectRoot, 'git', ['add', '--', ...targets]);
  const commit = await runCommand(projectRoot, 'git', ['commit', '-m', title]);
  if (commit.code !== 0) {
    await restoreBackup(projectRoot, applied.backup);
    await runCommand(projectRoot, 'git', ['reset', '-q']);
    await runCommand(projectRoot, 'git', ['switch', currentBranch]);
    await rejectFix(
      ctx, opt, traceId,
      `git commit 失败 → 未建 PR：${(commit.stderr || commit.stdout).slice(0, 200)}（git 需要先配置 user.email / user.name）`,
    );
    return;
  }

  const push = await runCommand(projectRoot, 'git', ['push', '-u', 'origin', branch]);
  if (push.code !== 0) {
    await runCommand(projectRoot, 'git', ['switch', currentBranch]);
    await rejectFix(
      ctx, opt, traceId,
      `推送分支失败 → 未建 PR：${(push.stderr || push.stdout).slice(0, 200)}（分支 ${branch} 已在本地提交，可手动建 PR）`,
    );
    return;
  }

  const pr = await runCommand(
    projectRoot, 'gh',
    ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body],
  );
  if (pr.code !== 0) {
    await runCommand(projectRoot, 'git', ['switch', currentBranch]);
    await rejectFix(
      ctx, opt, traceId,
      `gh pr create 失败 → 未建 PR：${(pr.stderr || pr.stdout).slice(0, 200)}（分支 ${branch} 已推送，可手动建 PR）`,
    );
    return;
  }
  const url = pr.stdout.trim().split('\n').filter((l) => l.trim() !== '').pop()?.trim() ?? '';

  // 用户的检出状态复原：修复内容留在 PR 分支上，工作区回到原分支
  if (currentBranch && currentBranch !== 'HEAD') {
    await runCommand(projectRoot, 'git', ['switch', currentBranch]);
  }

  await ctx.bus.publish({
    type: 'pr.created',
    payload: { fixId: opt.id, title, url, branch },
    source: 'executor',
    traceId,
  });
}

async function writeAutoPatchFile(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return rejectFix(ctx, opt, traceId, 'fs provider 不可用 → 待审 patch 未落盘');
  if (!validPatch(opt.patch)) {
    return rejectFix(ctx, opt, traceId, 'patch 格式非法（不是合法的 unified diff）→ 待审 patch 未落盘');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(opt.id)) {
    return rejectFix(ctx, opt, traceId, `fixId 非法（${opt.id}）→ 待审 patch 未落盘`);
  }
  // Tier 1 仍不直接改源代码，只写到 .sentinel/auto-patches/<id>.diff，交给用户审核后 git apply。
  const path = `.sentinel/auto-patches/${opt.id}.diff`;
  try {
    const result = await fs.call('write', { path, content: opt.patch ?? '' });
    if (!result || typeof result !== 'object' || !('written' in result) || result.written !== true) {
      return rejectFix(ctx, opt, traceId, `待审 patch 落盘失败：fs.write 未返回 written=true（${path}）`);
    }
    await ctx.bus.publish({
      type: 'patch.generated',
      payload: { fixId: opt.id, files: [path], applied: false, approvalRequired: true },
      source: 'executor',
      traceId,
    });
  } catch (err) {
    await rejectFix(ctx, opt, traceId, `待审 patch 落盘失败：${errText(err)}`);
  }
}

async function writePatchFile(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return rejectFix(ctx, opt, traceId, 'fs provider 不可用 → Tier 2 patch 未落盘');
  if (!validPatch(opt.patch)) {
    return rejectFix(ctx, opt, traceId, 'patch 格式非法（不是合法的 unified diff）→ Tier 2 patch 未落盘');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(opt.id)) {
    return rejectFix(ctx, opt, traceId, `fixId 非法（${opt.id}）→ Tier 2 patch 未落盘`);
  }
  const path = `reports/patches/${opt.id}.patch`;
  try {
    const result = await fs.call('write', { path, content: opt.patch ?? '' });
    if (!result || typeof result !== 'object' || !('written' in result) || result.written !== true) {
      return rejectFix(ctx, opt, traceId, `Tier 2 patch 落盘失败：fs.write 未返回 written=true（${path}）`);
    }
    await ctx.bus.publish({
      type: 'patch.generated',
      payload: { fixId: opt.id, files: [path], applied: false, approvalRequired: true },
      source: 'executor',
      traceId,
    });
  } catch (err) {
    await rejectFix(ctx, opt, traceId, `Tier 2 patch 落盘失败：${errText(err)}`);
  }
}

async function writeSuggestion(ctx: KernelContext, opt: FixOption, traceId: string): Promise<void> {
  const fs = ctx.providers.mcp.get('fs');
  if (!fs) return rejectFix(ctx, opt, traceId, 'fs provider 不可用 → Tier 3 建议未落盘');
  const path = `reports/suggestions/${opt.id}.md`;
  const md = `# ${opt.title}\n\n${opt.description}\n\n**Tier 3 建议（不自动修复）**\n\n## 为什么\n${opt.whyRecommended ?? ''}\n`;
  try {
    const result = await fs.call('write', { path, content: md });
    if (!result || typeof result !== 'object' || !('written' in result) || result.written !== true) {
      return rejectFix(ctx, opt, traceId, `Tier 3 建议落盘失败：fs.write 未返回 written=true（${path}）`);
    }
  } catch (err) {
    await rejectFix(ctx, opt, traceId, `Tier 3 建议落盘失败：${errText(err)}`);
  }
}

/**
 * 统一出口：产物没产出 = patch.rejected。
 * 以前这些路径全是静默 return —— 事件发出去了没人知道，
 * 报告却写着"Tier 2 — 写 patch 待审核"，磁盘上什么都没有。
 */
async function rejectFix(ctx: KernelContext, opt: FixOption, traceId: string, reason: string): Promise<void> {
  await ctx.bus.publish({
    type: 'patch.rejected',
    payload: { fixId: opt.id, reason },
    source: 'executor',
    traceId,
  });
}

/** 推荐方案判定：只给被标记为推荐（或唯一）的方案建 PR —— 一个 bug 对应一个 PR */
function isRecommended(recommendedFixId: string | undefined, fixId: string): boolean {
  return recommendedFixId === fixId;
}

function errText(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.slice(0, 200);
}
