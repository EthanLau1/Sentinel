/**
 * Browser MCP Server — Playwright + accessibility tree。
 *
 * 标准 Evidence（默认）：
 *   - screenshot
 *   - dom-snapshot
 *   - a11y tree（轻量，比截图省 95% token）
 *   - console errors
 *   - failed network requests
 *
 * 详细 Evidence（--detailed）：
 *   - storage (localStorage/sessionStorage/cookie)
 *   - 完整 response bodies
 *
 * 注意：playwright 是 peer dependency。运行时检查可用性。
 */

import type { MCPServer } from '@sentinel/core';
import type { ConsoleMessage, Response, Browser, Page, Cookie } from 'playwright';

export interface BrowserMCPConfig {
  baseUrl?: string;
  detailed?: boolean;
  /** 隐私脱敏：response body 中匹配此正则的 token 替换为 <REDACTED> */
  redactPattern?: RegExp;
}

interface PageState {
  url: string;
  title: string;
  console: Array<{ level: string; message: string }>;
  network: Array<{ url: string; method: string; status: number; duration_ms: number; failed: boolean }>;
  /**
   * 未捕获异常（pageerror）—— 与 console.error 分开存。
   * 为什么分开：console.error 是应用自己打的日志，未捕获异常是 JS 运行时崩了，
   * 两者的严重级别和修法完全不同，混在一起会把真故障淹没在噪音里。
   */
  pageErrors: string[];
}

/**
 * 巡检用的轻量页面快照 —— 不含截图 / DOM / a11y 树。
 * 为什么要单独一个工具：snapshot() 会带 base64 截图和整页 DOM，
 * 每个页面都调一次会让巡检成本翻好几倍；巡检只需要状态、报错和少量元信息。
 */
export interface BrowserInspection {
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

interface BrowserResult {
  url: string;
  title: string;
  screenshot?: string; // base64
  domSnapshot?: string;
  a11yTree?: unknown;
  console: Array<{ level: string; message: string }>;
  network: Array<{ url: string; method: string; status: number; duration_ms: number; failed: boolean }>;
  storage?: { localStorage: string[]; sessionStorage: string[]; cookieKeys: string[] };
}

/**
 * URL 断言的比较规则。
 *
 * 为什么不能精确比较：Next.js 的 `trailingSlash: true` 会把 `/about` 规范化成 `/about/`，
 * 精确比较永远不匹配 → 自动 flow 恒失败 → **修复后重跑被判失败 → 正确的修复被回滚**。
 * 实测（tailwind-nextjs-starter-blog）：Tier 1 拼写修复已落盘，却因
 * "Expected URL /about, got http://127.0.0.1:3104/about/" 被回滚，改动等于没做。
 *
 * 规则：路径去掉尾斜杠后必须相等；期望里带 query 时才比对 query（期望没带就不因实际多带参数而判失败）。
 */
export function urlMatches(actual: string, expected: string): boolean {
  if (!expected.startsWith('/')) return actual === expected;
  const norm = (raw: string): { path: string; query: string } => {
    const [withoutHash = ''] = raw.split('#');
    const [p = '', q = ''] = withoutHash.split('?');
    const path = p.length > 1 ? p.replace(/\/+$/, '') : p;
    return { path, query: q };
  };
  let actualPath: string;
  let actualSearch: string;
  try {
    const u = new URL(actual);
    actualPath = u.pathname;
    actualSearch = u.search.replace(/^\?/, '');
  } catch {
    return false;
  }
  const a = norm(actualPath + (actualSearch ? `?${actualSearch}` : ''));
  const e = norm(expected);
  if (a.path !== e.path) return false;
  if (e.query === '') return true;
  return a.query === e.query;
}

export function createBrowserMCPServer(config: BrowserMCPConfig = {}): MCPServer {
  let _playwright: typeof import('playwright') | null = null;
  let _browser: Browser | null = null;
  let _page: Page | null = null;
  const state: PageState = { url: '', title: '', console: [], network: [], pageErrors: [] };

  async function ensureBrowser(): Promise<void> {
    if (_page) return;
    if (!_playwright) {
      try {
        _playwright = await import('playwright');
      } catch {
        throw new Error(
          'playwright is required for browser MCP. Install: bun add -D playwright && bun playwright install chromium',
        );
      }
    }
    try {
      _browser = await _playwright.chromium.launch({ headless: true });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("Executable doesn't exist")) throw err;
      _browser = await _playwright.chromium.launch({ headless: true, channel: 'chrome' });
    }
    const ctx = await _browser.newContext();
    _page = await ctx.newPage();

    _page.on('console', (msg: ConsoleMessage) => {
      state.console.push({ level: msg.type(), message: msg.text() });
    });
    // 未捕获异常：以前根本没采 —— 页面白屏/JS 崩了，报告里却什么证据都没有
    _page.on('pageerror', (err: Error) => {
      state.pageErrors.push(err.message);
    });
    _page.on('response', async (resp: Response) => {
      const req = resp.request();
      const failed = !resp.ok();
      const timing = req.timing();
      state.network.push({
        url: resp.url(),
        method: req.method(),
        status: resp.status(),
        duration_ms: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : 0,
        failed,
      });
    });
  }

  function redact(text: string): string {
    if (!config.redactPattern) {
      // 默认脱敏：常见 token 模式
      return text
        .replace(/("?(token|api_key|apiKey|password|authorization)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<REDACTED>"')
        .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, '$1<REDACTED>');
    }
    return text.replace(config.redactPattern, '<REDACTED>');
  }

  async function snapshot(detailed: boolean): Promise<BrowserResult> {
    if (!_page) throw new Error('Browser not started');
    const page = _page;
    const url = page.url();
    const title = await page.title();

    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    const screenshot = screenshotBuffer.toString('base64');

    const domSnapshot = redact(await page.content());

    const a11yTree = redact(await page.locator('body').ariaSnapshot());

    const result: BrowserResult = {
      url,
      title,
      screenshot,
      domSnapshot,
      a11yTree,
      console: [...state.console],
      network: [...state.network],
    };

    if (detailed) {
      const localKeys = await page.evaluate(() => Object.keys(localStorage));
      const sessionKeys = await page.evaluate(() => Object.keys(sessionStorage));
      const cookies = await page.context().cookies();
      result.storage = {
        localStorage: localKeys,
        sessionStorage: sessionKeys,
        cookieKeys: cookies.map((c: Cookie) => c.name),
      };
    }

    return result;
  }

  /**
   * 轻量巡检快照 —— 只取判定"页面有没有毛病"需要的信息。
   * 与 snapshot() 的区别：不带截图 / DOM / a11y 树，成本低一个数量级。
   */
  async function inspect(): Promise<BrowserInspection> {
    if (!_page) throw new Error('Browser not started');
    const page = _page;
    // 等页面稳定再判定 —— 不等的话，SPA 还没渲染完就被量成"空白页"，
    // 白屏规则会变成假阳性制造机。等待有上限，绝不卡住。
    //
    // 三步都要，缺一步就会漏报（2026-10-26 真实 run 实测）：
    //   load        —— 等资源加载完，图片 404 在这一刻才暴露
    //   networkidle —— 等请求收尾
    //   短暂静默    —— 给迟到的客户端异常（useEffect 里 throw）留时间
    await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400).catch(() => {});
    const meta = await page.evaluate(() => {
      const html = document.documentElement;
      const body = document.body;
      const viewport = document.querySelector('meta[name="viewport"]');
      let bodyVisible = false;
      try {
        bodyVisible = Boolean(body && body.getBoundingClientRect().height > 0);
      } catch {
        bodyVisible = false;
      }
      return {
        lang: html?.getAttribute('lang') ?? null,
        viewport: viewport?.getAttribute('content') ?? null,
        hasTitle: Boolean(document.title && document.title.trim().length > 0),
        bodyTextLength: (body?.innerText ?? '').trim().length,
        bodyVisible,
      };
    });

    return {
      url: page.url(),
      title: await page.title(),
      console: [...state.console],
      pageErrors: [...state.pageErrors],
      network: [...state.network],
      meta,
    };
  }

  async function close(): Promise<void> {
    if (_browser) {
      await _browser.close();
      _browser = null;
      _page = null;
    }
  }

  return {
    name: 'browser',
    tools: [
      { name: 'visit', description: 'Navigate to URL', inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } },
      { name: 'click', description: 'Click element', inputSchema: { type: 'object', required: ['selector'], properties: { selector: { type: 'string' } } } },
      { name: 'fill', description: 'Fill input', inputSchema: { type: 'object', required: ['selector', 'value'], properties: { selector: { type: 'string' }, value: { type: 'string' } } } },
      { name: 'snapshot', description: 'Collect Evidence', inputSchema: { type: 'object', properties: { detailed: { type: 'boolean' } } } },
      { name: 'inspect', description: 'Lightweight page inspection (console errors, failed requests, meta) without screenshot/DOM', inputSchema: { type: 'object', properties: {} } },
      { name: 'assert', description: 'Assert browser URL, text or visibility', inputSchema: { type: 'object', required: ['kind'], properties: { kind: { type: 'string' }, expected: { type: 'string' }, selector: { type: 'string' } } } },
      { name: 'close', description: 'Close browser', inputSchema: { type: 'object' } },
    ],

    async call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
      if (toolName === 'close') return close().then(() => ({ closed: true }));
      await ensureBrowser();
      const page = _page!;

      switch (toolName) {
        case 'visit': {
          const target = String(args['url']);
          const full = config.baseUrl && !target.startsWith('http')
            ? `${config.baseUrl.replace(/\/$/, '')}${target.startsWith('/') ? target : `/${target}`}`
            : target;
          // dev server 首次访问某个路由要先编译，编译完成前会返回 5xx。
          // 对 5xx 做有限重试；4xx 是确定性错误，立即抛出。
          let response: Response | null = null;
          let status = 0;
          const retryDelays = [1000, 2000, 3000, 5000];
          for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelays[attempt - 1]!));
            state.console = [];
            state.network = [];
            state.pageErrors = [];
            response = await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 15000 });
            status = response ? response.status() : 0;
            if (status < 500) break;
          }
          if (response && status >= 400) throw new Error(`Page ${full} returned HTTP ${status}`);
          return { url: page.url(), title: await page.title() };
        }
        case 'click': {
          await page.click(String(args['selector']), { timeout: 5000 });
          return { clicked: true };
        }
        case 'fill': {
          await page.fill(String(args['selector']), String(args['value']), { timeout: 5000 });
          return { filled: true };
        }
        case 'snapshot': {
          // 「显式 true 或全局开启」——
          // 以前写的是 `args['detailed'] ?? config.detailed`，但 `??` 只在 null/undefined 时回落，
          // 调用方传 false 时全局开关就被覆盖掉了 → --detailed 是个空开关。
          return snapshot(args['detailed'] === true || config.detailed === true);
        }
        case 'inspect': {
          return inspect();
        }
        case 'assert': {
          const kind = args['kind'];
          if (kind === 'url') {
            const expected = args['expected'];
            if (typeof expected !== 'string' || !expected) throw new Error('URL assertion requires expected');
            const actual = page.url();
            const matches = urlMatches(actual, expected);
            if (!matches) throw new Error(`Expected URL ${expected}, got ${actual}`);
          } else if (kind === 'text') {
            const expected = args['expected'];
            if (typeof expected !== 'string' || !expected) throw new Error('Text assertion requires expected');
            const selector = args['selector'];
            if (selector !== undefined && (typeof selector !== 'string' || !selector)) throw new Error('Invalid text selector');
            await (typeof selector === 'string' ? page.locator(selector).getByText(expected) : page.getByText(expected)).first().waitFor({ state: 'visible', timeout: 5000 });
          } else if (kind === 'visible') {
            const selector = args['selector'];
            if (typeof selector !== 'string' || !selector) throw new Error('Visibility assertion requires selector');
            await page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 });
          } else {
            throw new Error(`Unsupported browser assertion: ${String(kind)}`);
          }
          return { passed: true };
        }
        default:
          throw new Error(`Unknown browser tool: ${toolName}`);
      }
    },
  };
}
