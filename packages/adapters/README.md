# @sentinel/adapters

> 项目特征识别。让 Sentinel 知道你跑的是 Next.js 还是 Vue。

## 范围（v1）

```
frontend/
├─ nextjs.ts        Next.js 14+ (app router / pages router)
├─ react.ts         CRA / Vite + React
├─ vue.ts           Vue 3 + Vite
└─ svelte.ts        SvelteKit

backend/
├─ express.ts
├─ hono.ts
├─ nest.ts
└─ trpc.ts

data/
├─ prisma.ts
├─ drizzle.ts
└─ supabase.ts

llm-app/
├─ vercel-ai-sdk.ts
├─ langchain.ts
└─ pgvector.ts
```

## adapter 职责

每个 adapter 实现：

```
detect(projectRoot)     → boolean   该项目是否使用此栈
profile(projectRoot)    → ProjectProfile
routes(projectRoot)     → PageSpec[] | ApiSpec[]
auth(projectRoot)       → AuthSpec | undefined
data(projectRoot)       → DataSpec[]
risks(projectRoot)      → ProjectRisk[]
```

## 添加新 adapter

不需要改 core，不需要改其他 adapter。
直接在对应目录加文件，注册到 `adapters/index.ts`。

## v1 不做

- iOS / Android 原生
- Electron
- 游戏引擎
- 区块链
