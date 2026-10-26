'use strict';
/**
 * 离线守卫夹具 —— 零依赖（只用 Node 内置 http）的被测项目。
 *
 * 存在的理由：断网守卫需要**每次都能跑**的被测对象。
 * 用真实业务项目（Next.js 等）当夹具会带来三个问题：
 *   1. 要装依赖（离线环境装不了）
 *   2. 启动慢、端口随机、构建产物不确定
 *   3. 缺陷是"注入"的还是"本来就有的"说不清 —— 命中率无法解释
 *
 * 所以这里自建一个**缺陷全部已知**的最小项目：每个缺陷都是故意注入的，
 * 因此"Sentinel 有没有测出来"这件事有唯一正确答案。
 *
 * 注入的缺陷（见 README.md 的对照表）：
 *   D1 首页加载时 console.error
 *   D2 首页引用一张 404 的图片
 *   D3 /posts 页面抛出未捕获异常
 *   D4 首页 <html> 缺少 lang 属性
 *   D5 首页请求 /api/posts，接口返回 500
 *
 * 端口：优先读 PORT 环境变量（Sentinel 启动 dev server 时会注入），
 * 其次读 --port 参数，最后兜底 41337。
 */

const http = require('node:http');

function resolvePort() {
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  const idx = process.argv.indexOf('--port');
  if (idx !== -1) {
    const argPort = Number(process.argv[idx + 1]);
    if (Number.isInteger(argPort) && argPort > 0) return argPort;
  }
  return 41337;
}

const PORT = resolvePort();

/**
 * 首页：故意带 D1（控制台报错）、D2（图片 404）、D4（缺 lang）、D5（接口 500）。
 * 有意保留 title / viewport / 正文 —— 这三项没问题，
 * 否则一次运行会同时命中三条质量观察项，判据就"混"了，看不出是哪条规则起的作用。
 */
const HOME_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>离线守卫首页</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<h1>离线守卫首页</h1>
<p>这是一个故意留了缺陷的页面，用来验证 Sentinel 在没有 LLM、没有网络时还能测出错误。</p>
<img src="/assets/missing-image.png" alt="故意缺失的图片">
<script>
  console.error('离线守卫演示：前端配置加载失败');
  fetch('/api/posts').then(function (r) { return r.json(); }).catch(function () { /* 500 属于 D5 */ });
</script>
</body>
</html>`;

/**
 * /posts：故意带 D3（未捕获异常）。
 * 异常放在 setTimeout 里 —— 这样正文已经渲染出来，
 * 不会被 blank-page 规则（正文为空）误伤，两条规则互不干扰。
 */
const POSTS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>离线守卫文章页</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<h1>文章列表</h1>
<p>这个页面在加载后会抛出未捕获异常。</p>
<script>
  setTimeout(function () {
    throw new Error('posts 组件初始化失败');
  }, 50);
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HOME_HTML);
    return;
  }
  if (path === '/posts') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(POSTS_HTML);
    return;
  }
  if (path === '/api/posts') {
    // D5：接口 500
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'posts service unavailable' }));
    return;
  }
  if (path === '/assets/missing-image.png') {
    // D2：图片 404（路由存在但故意返回 404，路径更接近真实项目）
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  if (path === '/favicon.ico') {
    // 浏览器会自动请求 favicon —— 返回 204（不是 4xx），
    // 免得它变成一条与被测缺陷无关的 client-error 噪音。
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  // dev-server 会从启动输出里解析真实端口 —— 格式必须含 "127.0.0.1:<port>"
  console.log(`offline-web-app listening on http://127.0.0.1:${PORT}`);
});
