# M0 — 第 1 周精确清单

> 这是写代码前的最后一份文档。
> 每行都是可执行任务，完成时打 ✅。

---

## 🎯 W1 目标

写下宪法对应的代码。**只写 core，不写业务**。
完成标准：core 总行数 ≤ 500，0 外部依赖，单测覆盖 100%。

---

## Day 1 — 仓库初始化

- [ ] 1.1 `package.json` (workspaces 配置)
- [ ] 1.2 `tsconfig.json` (root, strict mode)
- [ ] 1.3 `vitest.config.ts` (测试配置)
- [ ] 1.4 `.editorconfig` + `.prettierrc`
- [ ] 1.5 `packages/core/package.json` (name: `@sentinel/core`)
- [ ] 1.6 `packages/core/tsconfig.json`
- [ ] 1.7 `bun install` 验证 workspaces 工作

**产出**：`bun run typecheck` 通过，目录结构有了。

---

## Day 2 — types.ts（5 个核心类型）

- [ ] 2.1 `core/src/types.ts`
  - [ ] `FeatureMap` (含 ProjectProfile / AuthSpec / PageSpec / ApiSpec / DataSpec / FlowSpec / ProjectRisk)
  - [ ] `Evidence` (sum type，12 种成员)
  - [ ] `BugFinding` (含 rootCauseStatus / counterEvidence / fixOptions)
  - [ ] `FixOption` (含 5 维成本 / tier / score / sources)
  - [ ] `Event<T>` (含 type / payload / traceId)
- [ ] 2.2 类型 export，每一个加 JSDoc 一行说明
- [ ] 2.3 行数检查：`wc -l packages/core/src/types.ts` ≤ 200

**产出**：5 个核心类型定义，宪法第 5 条满足。

---

## Day 3 — ports.ts（5 个 Provider 接口）

- [ ] 3.1 `core/src/ports.ts`
  - [ ] `LLMProvider` (chat / estimateCost / supportsTools / name)
  - [ ] `MemoryProvider` (recall / remember / name)
  - [ ] `SkillsLoader` (list / load / refresh)
  - [ ] `MCPRegistry` (register / get / list)
  - [ ] `KnowledgeProvider` (search / priority)
- [ ] 3.2 每个接口加 JSDoc，说明输入输出契约
- [ ] 3.3 验证：`grep -E "(playwright|openai|next|express)" packages/core/src/*.ts` 必须返回空（红线 1）

**产出**：5 个 Provider 接口，core 跟外部世界唯一通道。

---

## Day 4 — bus.ts（Event Bus）

- [ ] 4.1 `core/src/bus.ts`
  - [ ] `Bus` 类（typed pub/sub）
  - [ ] `subscribe<T>(type, handler)` 方法
  - [ ] `publish<T>(event)` 方法
  - [ ] `traceId` 自动生成
  - [ ] `record()` 录制模式（用于回放）
- [ ] 4.2 行数检查 ≤ 100

- [ ] 4.3 `core/test/bus.test.ts`
  - [ ] 测试 sub→pub→handler 链路
  - [ ] 测试 traceId 跨事件保持
  - [ ] 测试 unsubscribe
  - [ ] 测试多个订阅者收同一事件
  - [ ] 测试 record 模式能完整回放

**产出**：Bus 单测 100% 覆盖，可以放心建子代理。

---

## Day 5 — kernel.ts + budget.ts

- [ ] 5.1 `core/src/budget.ts`
  - [ ] `Budget` 类（max tokens / max usd）
  - [ ] `consume(tokens, usd)` 方法
  - [ ] `assert()` 超限抛错
  - [ ] 行数 ≤ 50

- [ ] 5.2 `core/src/kernel.ts`
  - [ ] `runAgent(config)` 主 loop
  - [ ] 子代理注册机制
  - [ ] hooks 拦截点（pre/post）
  - [ ] checkpoint 接口（暂不实现）
  - [ ] 行数 ≤ 200

- [ ] 5.3 `core/test/budget.test.ts`
  - [ ] 超 token 抛错
  - [ ] 超 usd 抛错
  - [ ] consume 累加正确

- [ ] 5.4 `core/test/kernel.test.ts`
  - [ ] 子代理注册成功
  - [ ] hooks 按顺序执行
  - [ ] budget 超限时 loop 停止

**产出**：core 5 个文件全部完成，单测齐全。

---

## Day 6 — 验收 + ARCHITECTURE 微调

- [ ] 6.1 全量行数核查
  ```
  wc -l packages/core/src/*.ts
  # types + ports + bus + kernel + budget ≤ 500
  ```
- [ ] 6.2 全量依赖核查
  ```
  cat packages/core/package.json | jq .dependencies
  # 必须为空对象 {}
  ```
- [ ] 6.3 全量耦合核查
  ```
  grep -rE "(playwright|openai|next|express|prisma|claude)" packages/core/src/
  # 必须无输出
  ```
- [ ] 6.4 测试覆盖
  ```
  bun test packages/core --coverage
  # 期望 100%
  ```
- [ ] 6.5 在 `ARCHITECTURE.md` 末尾追加"M0 实施记录"章节
- [ ] 6.6 用真实数字更新 [ROADMAP.md](./ROADMAP.md) 的 M0 完成标准

**产出**：M0 验收通过，可以进 W2。

---

## Day 7 — 留 buffer / 文档同步

- [ ] 7.1 修任何 W1 发现的 bug
- [ ] 7.2 写第一条 git commit message 模板
- [ ] 7.3 在 README 加"M0 已完成"徽章
- [ ] 7.4 准备 W2 的 LLM API key（你的 API endpoint + key）
- [ ] 7.5 准备 W2 的 Playwright 安装（`bun add -d @playwright/test`）

---

## ⛔ W1 禁止做的事

| 禁止 | 理由 |
|---|---|
| 写任何业务逻辑 | core 不该认识业务 |
| import 任何外部库到 core | 红线 1 |
| 加第 6 个核心类型 | 宪法第 5 条 |
| 直接调用 LLM | M1 才做 |
| 写 Playwright 代码 | M2 才做 |
| 在 core 里写 console.log | core 是纯函数，副作用不归它 |

---

## ✅ W1 验收会议（自查）

W1 结束时回答这 5 个问题：

1. core 总行数是多少？≤ 500 ?
2. core 有 import 任何外部库吗？
3. core 有写死任何具体框架/平台名字吗？
4. 5 个核心类型定义清楚了吗？
5. 5 个 Provider 接口契约写清楚了吗？

**5 个全 yes → 进 W2。**
**任何 1 个 no → 回炉，不允许进 W2。**

---

## 🚀 W2 预告（给你提前心理准备）

W2 = M1 (LLM 通路) + M2 (最小感知)

```
M1: providers/llm/openai-compatible.ts
    + sentinel hello 命令验证
M2: providers/mcp/built-in/{browser,http,fs}.ts
    + sensor 子代理编排 MCP
    + sentinel sense 命令验证
```

W2 你的 API endpoint 必须就绪。

---

## 📌 M0 一行总结

> 写 5 个文件 + 3 个测试。core 自洽、纯净、不知道任何具体世界。
> 写完了，宪法就有了实体。
