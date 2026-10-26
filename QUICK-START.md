# Sentinel Quick Start

最短路径让 Sentinel 跑起来。

## 先搞清楚：跑一次会发生什么

1. 把你的项目跑起来（在目标项目里自动起 dev server）
2. 用真实浏览器把你的页面点一遍、把接口调一遍
3. 把出错的现场（状态码、控制台输出、截图）存成**证据**
4. 找根因 → 有个"反方"复核一遍 → 给出 3 个修法并排序
5. 出一份报告，写在你项目自己的 `.sentinel/` 目录里

全过程中它**不会**改你的代码，除非你加了 `--auto-fix`（只对 Tier 1 小改动生效，改完会重新验证，不行自动还原）。

> 前提：要有一个 LLM API key（或者本机装 Ollama 走本地模型，免费）。
> 没配 key 时 `--demo` 只是给你看报告长什么样，**不真的找 bug**。

---

## 没有 LLM、没有网络也能测（离线模式）

```bash
bun packages/cli/src/index.ts run --project=/path/to/your-app --offline
```

**离线模式下它照样能测出确定性的错误**：页面抛未捕获异常、控制台报错、
图片 404、接口 5xx、白屏、慢响应、缺 lang/viewport/标题 —— 全部用**规则**判定，不调用任何模型。

- 没配任何 LLM 时**自动进入**离线模式；LLM 探不通（断网 / key 失效）也会自动转离线
- 离线模式**一次外网请求都不发**，不做 AI 根因分析
- 报告里会写明"运行模式：离线"，`reports/sentinel-run-status.json` 里写 `llmMode: "offline"`

规则清单见 [README.md](./README.md) 第 14 节。

---

## 30 秒体验（演示模式，无需配置 LLM）

```bash
cd Sentinel
bun install
bun packages/cli/src/index.ts run --demo
```

**注意：Demo 输出的是 3 个硬编码的示例报告**（非真实检测），用于预览 output 格式。真正的 bug 检测需要配置 LLM —— 或者用上面的离线模式（规则检测，不需要 LLM）。

---

## 5 分钟上手（Web UI）

```bash
bun packages/cli/src/index.ts ui
```

打开 http://127.0.0.1:4317/

在 Web UI 中：
1. 侧边栏看到项目列表
2. 点击 "Run" → Run Debug
3. 查看 bug 列表 → 点击查看详情 → 查看推荐修复

---

## 对真实项目调试（完整流程）

### Step 1: 初始化

```bash
bun packages/cli/src/index.ts init --project=/path/to/your-app
```

这会在目标项目中创建 `.sentinel/` 目录。

### Step 2: 配置 LLM

编辑 `/path/to/your-app/.sentinel/llm.yml`：

```yaml
default: minimax

providers:
  minimax:
    type: openai-compatible
    baseUrl: https://api.minimaxi.com/v1
    apiKey: your-api-key
    model: MiniMax-M3
```

或用本地模型（免费）：

```yaml
default: ollama

providers:
  ollama:
    type: ollama-native
    baseUrl: http://localhost:11434
    model: qwen3:7b
```

### Step 3: 验证配置

```bash
bun packages/cli/src/index.ts doctor --project=/path/to/your-app
```

**配置正确的环境**下期望输出 `All checks passed.`。如果 doctor 报 `N fail(s)`，通常是 LLM 连接失败、`llm.yml` 缺字段或 `playwright` 未安装，参考下方"常见问题"逐条排查。

### Step 4: 确认目标项目能跑起来

Sentinel 会**自动启动**你的 dev server —— 它认 `package.json` 里的 `dev` / `start` / `serve` / `dev:start` / `start:dev` 脚本，
并自动判断该用 bun、pnpm、yarn 还是 npm。**如果服务已经在跑，它直接复用，而且不会杀你自己的进程。**

你只需要保证两件事：
- 目标项目依赖已装好（有 `node_modules`）
- `package.json` 里有上面那类脚本之一

想自己先起也可以（这样 Sentinel 会直接复用它）：

```bash
cd /path/to/your-app
npm run dev
```

### Step 5: 运行调试

```bash
# 在另一个终端
bun packages/cli/src/index.ts run --project=/path/to/your-app
```

### Step 6: 查看结果

```bash
# CLI 直接显示 bug 列表
# 报告文件：
cat /path/to/your-app/reports/sentinel-latest.md

# 或用 Web UI 查看（更方便）：
bun packages/cli/src/index.ts ui
```

---

## ⚠️ 常见问题

### "Total: 0 P0: 0 P1: 0" — 没找到 bug？

原因：
- **自动启动 dev server 失败**（项目没有 `dev`/`start`/`serve` 脚本，或依赖没装）→ 报错 `No reachable project dev server`
- 项目太简单 / 运行正常 → 确实没有 bug
- 流程没排出来 → 没东西可测（比如项目全是 Vue/Nuxt/Svelte/Vite 这类 adapter 覆盖不到的栈）

解决：先确认目标项目能自己跑起来（`npm run dev` 不报错），再重试。

### "browser MCP not registered"

原因：Playwright 未安装。

解决：
```bash
npx playwright install chromium
```

### LLM 返回 404 / 连接失败

原因：`baseUrl` 配置错误。

常见正确值：
- MiniMax: `https://api.minimaxi.com/v1`
- OpenAI: `https://api.openai.com/v1`
- Ollama: `http://localhost:11434/v1`

注意 URL 末尾必须有 `/v1`。

### Budget exceeded

默认限制 $0.5/次。调整 `.sentinel/budget.yml`：

```yaml
limits:
  maxCostUsdPerRun: 2.0
  maxTokensPerRun: 50000
```

---

## 生成的文件说明

运行后在目标项目中会产生：

```
your-app/
├── .sentinel/
│   ├── llm.yml                    ← LLM 配置
│   ├── budget.yml                 ← 预算配置
│   ├── app.map.ts                 ← 项目映射（可手动覆盖）
│   ├── app.map.generated.json     ← 自动生成的 FeatureMap
│   ├── auto-patches/              ← Tier 1 自动修复 diff
│   └── cache/                     ← Evidence 缓存
├── reports/
│   ├── sentinel-latest.md         ← Markdown 报告
│   ├── sentinel-latest.json       ← JSON 报告
│   ├── patches/                   ← Tier 2 补丁
│   └── suggestions/               ← Tier 3 建议
```

---

## 修复 Tier 说明

| Tier | 含义 | 行为 |
|------|------|------|
| 0 | 仅观察 | 只记录，不生成 patch |
| 1 | 自动修复 | 生成 diff 写入 `.sentinel/auto-patches/` |
| 2 | 需审批 | 生成 diff 写入 `reports/patches/` |
| 3 | 仅建议 | 生成建议文档写入 `reports/suggestions/` |

应用补丁：
```bash
cd /path/to/your-app
git apply .sentinel/auto-patches/bug_xxx_fix_1.diff
```

---

## macOS 快捷启动

双击运行：
```
scripts/Start Sentinel.command
```

或添加 Kiro Hook 一键触发（已配置）。
