/**
 * 离线守卫夹具的 FeatureMap 覆盖。
 *
 * 为什么需要它：Sentinel 靠"框架 adapter"识别页面和接口
 * （Next.js / Vue / Express 等）。本夹具是一个**零依赖**的原生 Node 服务，
 * 没有任何 adapter 会认出它 —— 不给覆盖的话，mapper 会报
 * "未识别到任何页面或 API"，一个 flow 都跑不了。
 *
 * 给覆盖不是"作弊"：这正是真实项目里 app.map.ts 的用途 ——
 * 告诉 Sentinel "这个项目要测哪几条路径"。
 *
 * 格式与 packages/subagents/src/mapper.ts 的 applyUserMapOverride 一致：
 * 导出 default（或 overrides / map），字段是 FeatureMap 的部分覆盖。
 */

export default {
  pages: [
    {
      id: 'home',
      path: '/',
      title: '离线守卫首页',
      requiresAuth: false,
      criticalCTAs: [],
    },
    {
      id: 'posts',
      path: '/posts',
      title: '离线守卫文章页',
      requiresAuth: false,
      criticalCTAs: [],
    },
  ],
  api: [
    {
      id: 'posts',
      method: 'GET',
      path: '/api/posts',
      requiresAuth: false,
    },
  ],
  // 显式给 flows：自动生成的 flow 只断言"URL 对得上 + body 可见"，
  // 这里额外把"接口必须 2xx"写清楚，让 D5（接口 500）有确定的失败点。
  flows: [
    {
      id: 'flow_page_home',
      description: '打开首页，页面可见',
      steps: [
        { action: 'visit', url: '/' },
        { action: 'assert', kind: 'url', expected: '/' },
        { action: 'assert', kind: 'visible', selector: 'body' },
      ],
    },
    {
      id: 'flow_page_posts',
      description: '打开文章页，页面可见',
      steps: [
        { action: 'visit', url: '/posts' },
        { action: 'assert', kind: 'url', expected: '/posts' },
        { action: 'assert', kind: 'visible', selector: 'body' },
      ],
    },
    {
      id: 'flow_api_posts',
      description: 'GET /api/posts 应返回 2xx',
      steps: [
        { action: 'assert', kind: 'api', method: 'GET', path: '/api/posts', expectStatus: '2xx' },
      ],
    },
  ],
};
