# @sentinel/core

> Core 是 Sentinel 的"宪法实现"。
> ≤ 500 行 · 0 外部依赖 · 不知道任何具体平台/框架/LLM/浏览器。

## 内容（M0 周完成）

```
src/
├─ types.ts     5 个核心类型: FeatureMap / Evidence / BugFinding / FixOption / Event
├─ ports.ts     5 个 Provider 接口: LLM / Memory / Skills / MCP / Knowledge
├─ bus.ts       Event Bus (typed pub/sub)
├─ kernel.ts    Agent loop + 子代理编排
└─ budget.ts    Token / 钱预算护栏

test/
├─ bus.test.ts
├─ kernel.test.ts
└─ budget.test.ts
```

## 红线

1. 永远不 import 任何具体平台代码
2. 总行数 ≤ 500
3. 单测覆盖 100%
4. 任何升级先升宪法版本号

## 不允许的事

```
import { Page } from 'playwright';      ❌
import OpenAI from 'openai';             ❌
import { NextRequest } from 'next';      ❌
```

```
type LLMProvider { ... }                 ✅
type MCPServer { ... }                   ✅
function dispatch(event: Event<T>) { }   ✅
```
