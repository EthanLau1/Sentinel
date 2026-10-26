# 离线守卫夹具（offline-web-app）

> 一个**零依赖**、**故意带 5 个缺陷**的最小 web 项目。
> 它的唯一用途：证明 Sentinel 在**没有 LLM、没有外网**时也能测出确定性的错误。

## 为什么自己造一个项目

拿真实业务项目当夹具会有三个问题，导致"守卫"本身不可信：

1. **装不了依赖** —— 断网环境里 `npm install` 直接失败；
2. **说不清对错** —— 真实项目里的 bug 是"本来就有的"，无法判断"该不该测出来"；
3. **每次跑都不一样** —— 构建产物、端口、时序都会变，回归守卫会变成随机失败。

所以这里的每个缺陷都是**故意注入**的，答案唯一：
测出来了 = 守卫有效；没测出来 = 守卫失灵。

## 注入的缺陷（真值表）

| 编号 | 位置 | 注入内容 | 应命中的规则 | 应有的严重级别 |
|---|---|---|---|---|
| D1 | `/` | `console.error(...)` | `console-error` | P1 |
| D2 | `/` | `<img>` 指向 404 资源 | `client-error` | P2 |
| D3 | `/posts` | `setTimeout` 里抛未捕获异常 | `uncaught-exception` | P1 |
| D4 | `/` | `<html>` 缺 `lang` 属性 | `missing-lang` | P3（观察项，只作 hypothesis） |
| D5 | `/` | `fetch('/api/posts')`，接口返回 500 | `server-error` | P1 |

另外还内置了两个"不是缺陷"的对照项，用来检查守卫会不会误报：

| 对照项 | 做法 | 期望 |
|---|---|---|
| favicon | `/favicon.ico` 返回 204 | 不应产生任何 finding |
| `/posts` 页面 | 有 `lang` / `title` / `viewport`，正文有内容 | 不应触发 `missing-*` / `blank-page` |

## 文件说明

| 文件 | 作用 |
|---|---|
| `server.js` | 原生 Node http 服务，无任何依赖；端口取 `PORT` 环境变量（缺省 41337） |
| `package.json` | 只有一条 `dev` 脚本，供 Sentinel 自动启动 dev server |
| `.sentinel/app.map.js` | 告诉 Sentinel 要测哪几条路径（原生 Node 项目没有框架 adapter 能识别路由） |

## 怎么单独跑起来

```bash
node server.js            # http://127.0.0.1:41337
```

## 怎么被守卫使用

```bash
bun run guard:offline
```

守卫会把这个夹具**复制到临时目录**再跑 —— 所以夹具目录本身在 git 里始终是干净的
（跑完不会留下 `.sentinel/budget.yml` 之类的自动生成文件）。
