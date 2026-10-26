/**
 * 复现「假通过」：Next.js dev 下根布局编译失败时，
 * 浏览器里第一条路由 500、后面的路由却 <500 —— 于是 Sentinel 的 flow 判成 passed。
 * 用法：node scripts/probe-false-pass.mjs <baseUrl> <route1> <route2> ...
 */
import { chromium } from 'playwright';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3199';
const routes = process.argv.slice(3);

// playwright 自带的 chromium headless shell 可能没装；browser MCP 也是这么兜底的
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
}
const page = await browser.newPage();

for (const route of routes) {
  const full = `${baseUrl}${route}`;
  let last = 0;
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, [1000, 2000, 3000, 5000][attempt - 1]));
    const res = await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 15000 });
    last = res ? res.status() : 0;
    console.log(`  ${route} attempt${attempt}: status=${last} title=${JSON.stringify(await page.title())}`);
    if (last < 500) break;
  }
  const bodyText = (await page.textContent('body'))?.slice(0, 120).replace(/\s+/g, ' ') ?? '';
  console.log(`→ ${route} final=${last} body="${bodyText}"`);
}

await browser.close();
