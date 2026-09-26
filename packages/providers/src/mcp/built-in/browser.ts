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

export function createBrowserMCPServer(config: BrowserMCPConfig = {}): MCPServer {
  let _playwright: typeof import('playwright') | null = null;
  let _browser: Browser | null = null;
  let _page: Page | null = null;
  const state: PageState = { url: '', title: '', console: [], network: [] };

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
          state.console = [];
          state.network = [];
          const response = await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (response && response.status() >= 400) throw new Error(`Page ${full} returned HTTP ${response.status()}`);
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
          return snapshot(Boolean(args['detailed'] ?? config.detailed));
        }
        case 'assert': {
          const kind = args['kind'];
          if (kind === 'url') {
            const expected = args['expected'];
            if (typeof expected !== 'string' || !expected) throw new Error('URL assertion requires expected');
            const actual = page.url();
            const matches = expected.startsWith('/')
              ? new URL(actual).pathname + new URL(actual).search === expected
              : actual === expected;
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
