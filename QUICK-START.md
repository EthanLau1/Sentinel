# Sentinel Quick Start

最短路径让 Sentinel 跑起来。

---

## 30 秒体验（演示模式，无需配置 LLM）

```bash
cd Sentinel
bun install
bun packages/cli/src/index.ts run --demo
```

**注意：Demo 输出的是 3 个硬编码的示例报告**（非真实检测），用于预览 output 格式。真正的 bug 检测需要配置 LLM。

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

期望输出 "All checks passed."

### Step 4: 启动目标项目

```bash
# ⚠️ 重要！必须先启动目标项目的 dev server
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
- 目标项目的 dev server **没有运行** → Runner 无法访问页面
- 项目太简单/运行正常 → 确实没有 bug

解决：确保 `npm run dev` 在运行，然后重试。

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
