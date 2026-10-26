/**
 * Inspector subagent — 被动巡检器。
 *
 * 存在的理由（2026-10-26）：
 *   以前的检测链路是"访问失败才算错"—— 页面返回 4xx/5xx 或断言不通过才会产出 bug。
 *   但真实项目里最常见的错是**页面返回 200、页面里却在报错**：
 *   JS 崩了、图片 404、接口 500、白屏。这些在旧链路里一条都测不出来。
 *
 *   巡检器不看"流程有没有失败"，只看"这次访问的现场有没有毛病"，
 *   判定全部用**确定性规则**，不依赖 LLM —— 所以没有模型、没有网络也能测出错误。
 *
 * 红线：
 *   - 每条发现必须带 Evidence（否则进不了报告）
 *   - 规则判定只能确认"运行时事实"（控制台报错、失败请求、5xx…），
 *     质量类观察项（缺 lang / 缺 viewport / 慢响应）只能作为 hypothesis 出现
 */

import { createHash } from 'node:crypto';
import type {
  Subagent,
  KernelContext,
  Evidence,
  BugFinding,
  BugSource,
  Severity,
} from '@sentinel/core';

/** 巡检看到的页面现场 —— 与 browser MCP 的 inspect 工具返回结构一致 */
export interface InspectionSnapshot {
  url: string;
  title: string;
  console: Array<{ level: string; message: string }>;
  pageErrors: string[];
  network: Array<{ url: string; method: string; status: number; duration_ms: number; failed: boolean }>;
  meta: {
    lang: string | null;
    viewport: string | null;
    hasTitle: boolean;
    bodyTextLength: number;
    bodyVisible: boolean;
  };
}

/** 一条规则命中 */
export interface RuleViolation {
  /** 规则 id —— 报告里要能看出是哪条规则判的 */
  rule: string;
  severity: Severity;
  source: BugSource;
  title: string;
  /** 根因陈述 —— 必须是"事实陈述"，不是猜测 */
  rootCause: string;
  confidence: number;
  evidence: Evidence[];
  /**
   * error = 运行时故障（可确认）；observation = 质量观察（只作假设）。
   * 分开的理由：把"缺 viewport"和"JS 崩了"放同一档，报告会失真。
   */
  kind: 'error' | 'observation';
}

export interface InspectorConfig {
  /** 慢响应阈值（ms）—— 超过算 P3 观察项 */
  slowThresholdMs?: number;
}

const DEFAULT_SLOW_THRESHOLD_MS = 3000;

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function now(): number {
  return Date.now();
}

/** 取路径部分（去掉 origin 和 query），用于标题与去重 */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** 主文档请求 —— 它的 4xx/5xx 由 visit 直接抛错，不该再算一条子资源错误 */
function isMainDocument(entryUrl: string, pageUrl: string): boolean {
  try {
    return new URL(entryUrl).pathname === new URL(pageUrl).pathname;
  } catch {
    return false;
  }
}

/**
 * 规则判定 —— 纯函数，不碰任何 provider。
 * 拆出来是为了能直接单测：规则改坏了，测试必须报错。
 */
export function evaluateInspection(
  snapshot: InspectionSnapshot,
  config: InspectorConfig = {},
): RuleViolation[] {
  const slowThresholdMs = config.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const violations: RuleViolation[] = [];
  const path = pathOf(snapshot.url);
  const seen = new Set<string>();

  const push = (v: RuleViolation): void => {
    // 同一条规则 + 同一个对象只报一次（同一个页面可能重复打同一个错）
    const key = `${v.rule}:${v.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(v);
  };

  // ── 1. 未捕获异常（JS 运行时崩了）────────────────────────────
  for (const msg of snapshot.pageErrors) {
    push({
      rule: 'uncaught-exception',
      severity: 'P1',
      source: 'ui',
      title: `页面 ${path} 抛出未捕获异常`,
      rootCause: `页面加载后抛出未捕获异常：${msg}`,
      confidence: 0.9,
      kind: 'error',
      evidence: [
        {
          kind: 'console',
          source: 'browser',
          timestamp: now(),
          hash: hashOf(`pageerror:${msg}`),
          level: 'error',
          message: `Uncaught exception: ${msg}`,
        },
      ],
    });
  }

  // ── 2. 控制台 error（应用自己打的错误日志）────────────────────
  const pageErrorTexts = new Set(snapshot.pageErrors);
  const seenConsole = new Set<string>();
  for (const c of snapshot.console) {
    if (c.level !== 'error') continue;
    if (pageErrorTexts.has(c.message)) continue; // 已在规则 1 报过
    // "Failed to load resource: ... 404" 是浏览器对资源失败的复述，
    // 没有 URL、没有上下文 —— 网络规则（3~5）会用真实 URL 报同一件事。
    // 这里跳过它，否则同一次失败会出两条噪音 finding。
    if (/failed to load resource/i.test(c.message)) continue;
    if (seenConsole.has(c.message)) continue;
    seenConsole.add(c.message);
    const short = c.message.slice(0, 120);
    push({
      rule: 'console-error',
      severity: 'P1',
      source: 'ui',
      title: `页面 ${path} 控制台报错：${short}`,
      rootCause: `页面加载后控制台输出 error：${short}`,
      confidence: 0.7,
      kind: 'error',
      evidence: [
        {
          kind: 'console',
          source: 'browser',
          timestamp: now(),
          hash: hashOf(`console:${c.message}`),
          level: 'error',
          message: c.message,
        },
      ],
    });
  }

  // ── 3~5. 网络层：5xx / 4xx / 连接失败 ─────────────────────────
  for (const n of snapshot.network) {
    if (isMainDocument(n.url, snapshot.url)) continue;
    const short = shortUrl(n.url);
    if (n.status >= 500) {
      push({
        rule: 'server-error',
        severity: 'P1',
        source: 'api',
        title: `页面 ${path} 请求 ${short} 返回 ${n.status}`,
        rootCause: `页面加载时请求 ${short} 返回 HTTP ${n.status}（服务端错误）`,
        confidence: 0.85,
        kind: 'error',
        evidence: [networkEvidence(n)],
      });
    } else if (n.status >= 400) {
      push({
        rule: 'client-error',
        severity: 'P2',
        source: 'api',
        title: `页面 ${path} 请求 ${short} 返回 ${n.status}`,
        rootCause: `页面加载时请求 ${short} 返回 HTTP ${n.status}（资源或接口不存在/被拒绝）`,
        confidence: 0.6,
        kind: 'error',
        evidence: [networkEvidence(n)],
      });
    } else if (n.failed && n.status === 0) {
      push({
        rule: 'request-failed',
        severity: 'P1',
        source: 'api',
        title: `页面 ${path} 请求 ${short} 失败`,
        rootCause: `页面加载时请求 ${short} 失败（连接被拒绝或超时）`,
        confidence: 0.8,
        kind: 'error',
        evidence: [networkEvidence(n)],
      });
    }
  }

  // ── 6. 白屏（页面有响应但什么都没渲染出来）────────────────────
  if (snapshot.meta.bodyTextLength === 0 && !snapshot.meta.bodyVisible) {
    push({
      rule: 'blank-page',
      severity: 'P1',
      source: 'ui',
      title: `页面 ${path} 渲染为空白`,
      rootCause: `页面返回正常状态但没有渲染出任何内容（正文为空且不可见）——通常是渲染期异常导致`,
      confidence: 0.65,
      kind: 'error',
      evidence: [
        {
          kind: 'dom-snapshot',
          source: 'browser',
          timestamp: now(),
          hash: hashOf(`blank:${snapshot.url}`),
          html: `<body> empty (textLength=0, visible=false) @ ${snapshot.url}`,
        },
      ],
    });
  }

  // ── 7. 慢响应（观察项）──────────────────────────────────────
  for (const n of snapshot.network) {
    if (n.duration_ms < slowThresholdMs) continue;
    const short = shortUrl(n.url);
    push({
      rule: 'slow-response',
      severity: 'P3',
      source: 'perf',
      title: `页面 ${path} 请求 ${short} 耗时 ${n.duration_ms}ms`,
      rootCause: `请求 ${short} 耗时 ${n.duration_ms}ms，超过阈值 ${slowThresholdMs}ms`,
      confidence: 0.5,
      kind: 'observation',
      evidence: [networkEvidence(n)],
    });
  }

  // ── 8~10. 基础可访问性 / SEO（观察项）───────────────────────
  if (snapshot.meta.lang === null) {
    push({
      rule: 'missing-lang',
      severity: 'P3',
      source: 'ui',
      title: `页面 ${path} 的 <html> 缺少 lang 属性`,
      rootCause: `<html> 元素没有 lang 属性，屏幕阅读器无法确定朗读语种`,
      confidence: 0.9,
      kind: 'observation',
      evidence: [metaEvidence(snapshot, 'lang')],
    });
  }
  if (snapshot.meta.viewport === null) {
    push({
      rule: 'missing-viewport',
      severity: 'P3',
      source: 'ui',
      title: `页面 ${path} 缺少 viewport meta`,
      rootCause: `没有 <meta name="viewport">，移动端浏览器会按桌面宽度渲染`,
      confidence: 0.9,
      kind: 'observation',
      evidence: [metaEvidence(snapshot, 'viewport')],
    });
  }
  if (!snapshot.meta.hasTitle) {
    push({
      rule: 'missing-title',
      severity: 'P3',
      source: 'ui',
      title: `页面 ${path} 缺少标题`,
      rootCause: `document.title 为空，搜索结果与浏览器标签页都没有可读名称`,
      confidence: 0.85,
      kind: 'observation',
      evidence: [metaEvidence(snapshot, 'title')],
    });
  }

  // ── 11. 混合内容（https 页面里加载 http 资源）────────────────
  if (snapshot.url.startsWith('https://')) {
    for (const n of snapshot.network) {
      if (!n.url.startsWith('http://')) continue;
      push({
        rule: 'mixed-content',
        severity: 'P2',
        source: 'deploy',
        title: `页面 ${path} 加载了 http 资源`,
        rootCause: `https 页面请求了 http 资源 ${shortUrl(n.url)}，浏览器会拦截`,
        confidence: 0.8,
        kind: 'error',
        evidence: [networkEvidence(n)],
      });
    }
  }

  return violations;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url.slice(0, 120);
  }
}

function networkEvidence(n: { url: string; method: string; status: number; duration_ms: number; failed: boolean }): Evidence {
  return {
    kind: 'network',
    source: 'browser',
    timestamp: now(),
    hash: hashOf(`network:${n.method}:${n.url}:${n.status}`),
    url: n.url,
    method: n.method,
    status: n.status,
    duration_ms: n.duration_ms,
    failed: n.failed,
  };
}

function metaEvidence(snapshot: InspectionSnapshot, field: string): Evidence {
  return {
    kind: 'dom-snapshot',
    source: 'browser',
    timestamp: now(),
    hash: hashOf(`meta:${field}:${snapshot.url}`),
    html: `<meta-check field="${field}" url="${snapshot.url}" lang=${JSON.stringify(snapshot.meta.lang)} viewport=${JSON.stringify(snapshot.meta.viewport)} hasTitle=${snapshot.meta.hasTitle}>`,
  };
}

interface PageVisitedPayload {
  flowId: string;
  url: string;
  snapshot: InspectionSnapshot;
}

/** 运行时错误证据 —— verifier 的闸门认这几种 */
function hasRuntimeErrorEvidence(evidence: Evidence[]): boolean {
  return evidence.some(
    (e) =>
      (e.kind === 'console' && e.level === 'error') ||
      (e.kind === 'network' && (e.failed || e.status >= 400)) ||
      (e.kind === 'http' && e.status >= 400) ||
      (e.kind === 'log' && e.level === 'error'),
  );
}

export function createInspector(config: InspectorConfig = {}): Subagent {
  return {
    name: 'inspector',

    register(ctx: KernelContext): void {
      ctx.bus.subscribe<PageVisitedPayload>('page.visited', async (event) => {
        const { flowId, url, snapshot } = event.payload;
        const violations = evaluateInspection(snapshot, config);

        for (const v of violations) {
          // 代码证据（路由 → 源文件）能定位到就附上，定位不到就如实只带运行时证据
          const codeEvidence = await collectRouteEvidence(ctx, snapshot.url);
          const evidence = [...v.evidence, ...(codeEvidence ? [codeEvidence] : [])];

          const bug: BugFinding = {
            id: `bug_rule_${v.rule}_${hashOf(`${flowId}:${v.title}`).slice(0, 8)}`,
            title: v.title,
            severity: v.severity,
            source: v.source,
            affectedFeature: flowId,
            symptom: v.rootCause,
            reproSteps: [`访问 ${pathOf(url)}`, `观察：${v.title}`],
            evidence,
            // 规则判定的是"运行时事实"，不是模型推断 —— 标成 rule 供报告区分
            origin: 'rule',
            rootCauseStatus: v.kind === 'error' && hasRuntimeErrorEvidence(evidence) ? 'confirmed' : 'hypothesis',
            rootCause: v.rootCause,
            counterEvidence: [],
            confidence: v.confidence,
            fixOptions: [],
          };

          await ctx.bus.publish({
            // 运行时故障 → 直接进确认通道（确定性事实不需要 LLM 反向验证）；
            // 质量观察项 → 只作草稿，避免把"缺 viewport"说成已确认的缺陷
            type: bug.rootCauseStatus === 'confirmed' ? 'bug.confirmed' : 'bug.draft',
            payload: bug,
            source: 'inspector',
            traceId: event.traceId,
          });
        }
      });
    },
  };
}

/**
 * 路由 → 源文件 的证据。
 *
 * 复用 runner 用的那套映射（app/…page、pages/… 等）——
 * 巡检器和 runner 对"这个 URL 对应哪个文件"的判断必须一致，
 * 两套映射各写一遍必然漂移。
 */
async function collectRouteEvidence(ctx: KernelContext, url: string): Promise<Evidence | null> {
  const { collectSourceEvidenceForRoute } = await import('./source-evidence.js');
  return collectSourceEvidenceForRoute(ctx, url);
}
