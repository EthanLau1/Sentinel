# @sentinel/providers

> 全部可插拔。Sentinel 跟外部世界对话的唯一通道。

## 5 类 Provider

```
llm/                LLM 提供商
├─ openai-compatible.ts    你的 API / DeepSeek / Ollama / 任何 OpenAI 兼容
└─ ollama-native.ts        可选

memory/             记忆（默认无）
├─ none.ts                 默认
├─ files.ts                本地 markdown
└─ mem0.ts                 Mem0 适配器

skills/             技能（markdown）
└─ markdown.ts             仅一种格式

mcp/                工具协议
├─ registry.ts             3+N 注册表
└─ built-in/
   ├─ browser.ts           Playwright + a11y
   ├─ http.ts              HTTP probe（沿用 runtime-sentinel）
   └─ fs.ts                文件系统读

knowledge/          外部知识源（M6）
├─ docs.ts                 官方文档（M6.1）
├─ github.ts               GitHub issue/PR（M6.1）
├─ stackoverflow.ts        StackOverflow（M6.1）
└─ x.ts                    X.com（M6.2，留接口默认关闭）
```

## 原则

1. 所有 provider 实现 `core/ports.ts` 中的接口
2. provider 之间互不依赖
3. 加新 provider = 加文件，不改 core
4. 同类 provider 可以并存（用户在 .sentinel/*.yml 选）

## 3+N 模式

每类 provider 内置 3 个核心实现，其他 N 个留接口给用户/社区。

| 类 | 核心 3 | 用户可加 |
|---|---|---|
| LLM | openai-compatible / ollama-native | 任何 OpenAI 兼容端点 |
| MCP | browser / http / fs | github / supabase / sentry / ... |
| Skills | probe-author / bug-classifier / fix-cost-judge | 社区 GitHub 拉新 |
