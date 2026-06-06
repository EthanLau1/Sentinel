# Sentinel Constitution v1.1

> 锁定版本：v1.1 · 2026-05-21
> 这份文件是 Sentinel 的宪法。后续所有代码、PR、子代理升级都必须通过它的检查。
> 修改宪法需要显式版本升级（v1.2、v2.0...），不能静默改动。

---

## 一句话定义

Sentinel 是项目内运行的 **Universal Debug Agent**。
通过功能地图理解项目，通过多源 Evidence 看见运行状态，
通过 LLM + critic 做根因分析，通过成本模型给出阶段适配的最优修复方案，
通过分级权限执行自修复和自更新。

---

## 服务范围（写死）

### ✅ 服务的项目类型

**Modern Web Stack 的 LLM 应用**

| 层 | 支持栈 |
|---|---|
| 前端 | Next.js / React / Vue / Svelte / Solid |
| 后端 | Node / Bun / Deno (Express / Hono / NestJS / tRPC / Next API) |
| 数据 | Postgres / MySQL / SQLite / Redis / Supabase / Neon |
| ORM  | Prisma / Drizzle |
| LLM  | Claude / OpenAI / Ollama / 任意 OpenAI 兼容端点 |
| LLM-app | Vercel AI SDK / LangChain / pgvector |

### ❌ 不服务的项目类型

- iOS / Android 原生
- 嵌入式 / IoT / 硬件 / 固件
- 桌面应用（Electron 仅基本支持）
- 游戏引擎 / 3D 渲染
- 操作系统 / 驱动 / 内核
- gRPC / WebSocket（v2 再说）
- 区块链智能合约（v2 扩展）

---

## 6 条红线

```
1. core/ 永远不依赖具体平台、框架、LLM、浏览器
2. core/ 超过 500 行必须拆
3. 子代理升级不能改 core
4. 任何结论必须绑定 Evidence；无 Evidence 不允许 root cause（只能 hypothesis）
5. 自动修复必须分 Tier，高风险只能建议
6. 每个真实案例进入 benchmark/cases/ 永久留档
```

任何 PR 违反任意一条 → 拒绝合并。

---

## 5 个核心类型（永远只有这 5 个）

```
FeatureMap   项目长什么样
Evidence     一条证据（sum type，包含 12 种）
BugFinding   一个 bug
FixOption    一个修复方案
Event<T>     bus 上流的消息
```

任何新功能不允许引入第 6 个核心类型。如果需要扩展，在已有类型上加字段或加联合类型成员。

---

## 4 个宪法级机制

### Self-Check（自检测）

入口：`sentinel doctor`

检查项：
- LLM API 是否可用（按 budget.yml 中配置）
- Playwright 是否可用
- Git 是否可用
- MCP / Skill provider 是否可用
- budget.yml 是否合法
- app.map.ts 是否缺字段
- Evidence 是否能写入
- Markdown / JSON / HTML report 是否能生成

任何一项失败 → `sentinel run` 拒绝启动。

### Self-Repair（自修复，分 4 级）

```
Tier 0   只报告，不修
Tier 1   自动修：格式问题、缺失配置、生成 app.map、内置 prompt 升级
Tier 2   自动写 patch，但需要人确认（生成 PR 等审查）
Tier 3   仅建议：架构、安全、数据库迁移、第三方 API breaking
```

Tier 由 `executor/` 硬规则判断，**不**靠 LLM prompt 决定。

### Self-Update（自更新，范围明确）

```
✅ 可自动更新                     ❌ 禁止自动更新
  - skills (markdown)               - core/kernel
  - prompts                         - budget guard
  - adapters (新框架支持)            - permission policy
  - knowledge cache                 - evidence schema
  - bug benchmark                   - 5 个核心类型定义
  - project rules
```

入口：`sentinel update`。每次自更新写入 `.sentinel/update.log`，可回滚。

### Minimum Vertical Slice（最小闭环）

第 3 周必须跑通端到端：

```
map 项目
  → 打开首页
  → 登录
  → 跑一个流程
  → 收 Evidence
  → 出 1 个 BugFinding
  → 给 3 个 FixOption
  → 输出报告
```

没有这条闭环，不允许进入 M4。

---

## Evidence 诚实性规则

1. 每个 BugFinding 必须 `evidence.length ≥ 1`
2. 没有 Evidence 时 `rootCauseStatus` 只能为 `hypothesis`
3. 每条 Evidence 有 `hash`（content-addressed），PR / 报告以 hash 引用
4. critic 必须基于 Evidence 反向验证 analyst 的判断
5. 输出"insufficient evidence" 优于编造根因

---

## Knowledge Enhancement 多源规则

```
默认: 优先官方文档（单源即可，权威足够）

需要外部增强时:
  目标 = 1 个权威源 + 最多 2 个佐证源
  不强制 ≥3 源（避免噪音污染权威单源）

涉及以下情况时强制多源交叉:
  - 争议话题
  - 版本迁移（major bump）
  - 第三方 SDK 行为
  - 部署平台特性

源优先级:
  官方文档 > GitHub issue/PR > StackOverflow / 社区 > X.com

触发率上限: ≤30%（避免无谓搜索）

X.com:
  M6.2 阶段，仅留接口，默认关闭，需 API key 启用
  适合"最新实践 / 维护者口径 / 迁移提醒"
  不作为最终判断依据
```

---

## 核心成长路径

```
自检测 (doctor)
   ↓
自感知 (sense)
   ↓
自理解 (map)
   ↓
自诊断 (analyst → critic → verifier)
   ↓
自建议 (planner)
   ↓
分级自修复 (executor with Tier)
   ↓
安全自更新 (update with allowlist)
   ↓
benchmark 回归验证
```

任何阶段的失败都不能跳到下一阶段。

---

## 用户入口纪律

主入口（小白用户唯一需要的）：
```
sentinel run
```

调试入口（开发者）：
```
sentinel doctor    self-check
sentinel map       只生成 FeatureMap
sentinel sense     只收 Evidence
sentinel report    重新生成报告
sentinel update    自更新（skills/adapters/cache）
```

不允许新增第 6 个调试入口，除非宪法升级。

---

## 决策成本公式

```
score = confidence × w_conf
      + impact     × w_impact
      + stageFit   × w_stage
      − effort     × w_effort
      − risk       × w_risk
```

默认 weights:
```
w_conf = 0.35
w_impact = 0.25
w_stage = 0.20
w_effort = 0.10
w_risk = 0.10
```

用户可在 `.sentinel/budget.yml` 覆盖。Sentinel 内置三套 stage preset:
- **Idea / MVP** — 偏 effort / stageFit（快）
- **Launch** — 偏 risk / confidence（稳）
- **Scale** — 偏 maintenance / risk（长）

---

## Bug 报告固定 11 字段

```
1.  Bug ID
2.  严重级别 (P0/P1/P2/P3)
3.  影响功能
4.  复现步骤
5.  Evidence (引用 hash)
6.  根因判断 (hypothesis or confirmed)
7.  推荐方案 ★
8.  备选方案 × 2
9.  风险评估
10. 验证命令
11. 是否可自动修 (Tier 0/1/2/3)
```

任何输出格式（Markdown / JSON / HTML / CLI）都必须包含这 11 字段。缺一不行。

---

## 三个不可妥协的工程纪律

1. **Functional Core, Imperative Shell** — core 全是纯函数，副作用都在 providers 边缘
2. **Immutable Data Flow** — FeatureMap → Evidence → Bug → Fix 全程不修改
3. **Event-Driven Spine** — 子代理之间没有直接调用，只通过 bus 通信

---

## 宪法升级流程

修改本宪法需要：
1. 在 `CONSTITUTION-CHANGES.md` 写明"why / what / impact"
2. 升级版本号（v1.1 → v1.2 / v2.0）
3. 更新所有违反新条款的代码
4. 在 `benchmark/` 重跑全部历史 case，确认未退化

不允许"先改代码再补宪法"。
