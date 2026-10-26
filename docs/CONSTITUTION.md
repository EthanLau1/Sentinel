# Sentinel Constitution v1.2

> 锁定版本：v1.2 · 2026-10-26
> 这份文件是 Sentinel 的宪法。后续所有代码、PR、子代理升级都必须通过它的检查。
> 修改宪法需要显式版本升级（v1.2、v2.0...），不能静默改动。
> v1.1 → v1.2 的逐条处置见 `CONSTITUTION-CHANGES.md`。

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
| 前端 | Next.js / React / Vue / Svelte |
| 后端 | Node / Bun / Deno (Express / Hono / NestJS / tRPC / Next API) |
| 数据 | Postgres / MySQL / SQLite / Redis / Supabase / Neon |
| ORM  | Prisma / Drizzle |
| LLM  | Claude / OpenAI / Ollama / 任意 OpenAI 兼容端点 |
| LLM-app | Vercel AI SDK / LangChain |

> 范围以 `packages/adapters/src/` 里**真实存在的 adapter** 为准：
> 当前 13 个（frontend 4 / backend 4 / data 3 / llm-app 2）。
> 没有 adapter 的栈不在服务范围内 —— 写进宪法却做不出来，等于没有承诺。

### ❌ 不服务的项目类型

- iOS / Android 原生
- 嵌入式 / IoT / 硬件 / 固件
- 桌面应用（Electron 仅基本支持）
- 游戏引擎 / 3D 渲染
- 操作系统 / 驱动 / 内核
- Solid / pgvector（无 adapter，等有需求再按宪法升级流程加入）
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
6. 每个真实案例进入 benchmarks/cases/ 永久留档
```

任何 PR 违反任意一条 → 拒绝合并。

### 红线的执行方式：守卫优先于自觉

凡是本宪法里**能机检**的条款，都必须有对应的守卫脚本，
否则"遵守宪法"只靠人的自觉 —— 第二次改代码就会漂移。

当前守卫：

| 守卫 | 覆盖 |
|---|---|
| `bun run lint:core` | 红线 1（core 纯度） |
| `bun run lint:lines` | 红线 2（core 行数） |
| `bun run lint:spec` | 红线 4/6 + 本文件的入口清单、服务范围、成本维度、报告字段、配置字段、启动脚本 |

> `lint:spec` 用 baseline 机制只拦**新增**偏差：
> 已知未修项记在 `scripts/spec-sync-baseline.json`，修好后由脚本重新生成。
> 手改 baseline 会被 sha256 指纹拒绝；超期未清理会阻断；基线描述与实际不符会报"基线过期"。

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
- budget.yml 是否合法（含未知字段提示）
- app.map.ts 是否缺字段
- Evidence 是否能写入
- Markdown / JSON report 是否能生成；HTML 未实现前标 `blocked`
- 美元预算护栏是否**可执行**（配了 pricing 才算可执行）
- 单次响应 token 上限是否配置

**任何一项失败 → `sentinel run` 拒绝启动**，但要区分两类：

| 类别 | 判定 | run 的行为 |
|---|---|---|
| 配置本身坏了 | doctor 检查项 `fail` 且 `blocking` | **拒绝启动**并打印修复命令 |
| 外部服务不可达 | LLM API 不可达（`blocking: false`） | **不阻塞**，诊断降级为启发式 |

理由：把"LLM 暂时不可用"和"配置写错了"混为一谈，会让用户在网络抖动时被完全挡住，
反而把工具变得不可用。降级路径必须留，且必须在输出里说明降级了。

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
6. **"没做到"必须说出来**：LLM 调用失败、JSON 解析失败、裁决被拒 ——
   都要落到 `run-status.json` 或控制台输出，不允许静默回落到"无根因"
7. **挂起比报错更糟**：所有外部调用（LLM / HTTP）必须有超时；
   没有超时的调用 = 一次网络抖动就能让整轮 run 永不返回

---

## 成本与预算护栏（可执行性条款）

美元预算护栏是核心防线，但**只有配了价格才可执行**：

```
llm.yml:
  providers:
    <name>:
      pricing:
        pricePerMTokIn: 0.30      # USD / 每百万 token（输入）
        pricePerMTokOut: 1.20     # USD / 每百万 token（输出）

budget.yml:
  limits:
    maxCostUsdPerRun: 0.50       # 需要 pricing 才生效
    maxTokensPerRun: 100000      # 本次 run 的 token 总量上限
    maxTokensPerRequest: 8000    # 单次 LLM 请求的输出上限
    maxDurationSecPerRun: 300
```

规则：

1. `pricing` 缺失 → **美元护栏不可执行**，doctor 必须明确报出来（不是只打印一句警告）
2. `pricing` 单位固定为 **USD / 每百万 token** —— 与各供应商报价表一致，不允许换算歧义
3. 单价数值异常（>1000）→ doctor 警告"单位可能填错"
4. `maxTokensPerRequest` 缺失 → 单次超长响应没有独立上限，doctor 必须报出来
5. Provider 不返回 usage → token 数按字符估算，**不允许记 0**（记 0 等于护栏失效）
6. `run-status.json` 必须能核对护栏口径：`costMode` / `llmRequests` /
   `maxCompletionTokensObserved` / `maxTotalTokensObserved` /
   `maxTokensPerRequestConfigured` / `tokenUpperBound`
   （"请求次数 × 单次最大总 token"= 本次 run 的 token 上界）
   **两个口径不许混用**：`max_tokens` 配置限制的是**输出** token，
   所以要和 `maxCompletionTokensObserved` 比；
   `maxTotalTokensObserved`（输入+输出）是预算消耗口径，只用于算上界。

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

触发率上限: ≤30%（每次 run 中触发检索的流程占比）

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
自感知 (sensor)
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

**产品入口（小白用户唯一需要的）**：
```
sentinel run
```

**工具入口（开发者 / 运维）**：
```
sentinel doctor    self-check
sentinel map       只生成 FeatureMap
sentinel ui        WebUI（浏览器里看报告与项目）
sentinel init      生成 .sentinel/ 配置
sentinel hello     测 LLM 连通性
sentinel update    自更新（skills/adapters/cache）
```

- 调试入口共 6 个（`doctor` / `map` / `ui` / `init` / `hello` / `update`），
  其中 `ui` / `init` / `hello` 属于"使用类"入口，不计入调试入口上限。
- 不允许新增第 7 个入口，除非宪法升级。
- **不写从未实现的入口** —— 写进宪法却做不出来，等于对外做了做不到的承诺。

---

## 决策成本公式

```
score = confidence × w_conf
      + impact     × w_impact
      + stageFit   × w_stage
      − effort     × w_effort
      − risk       × w_risk
```

实现见 `packages/subagents/src/cost-model.ts`（`CostWeights`，8 个维度）。

默认 weights（5 个必备）：
```
w_conf = 0.35
w_impact = 0.25
w_stage = 0.20
w_effort = 0.10
w_risk = 0.10
```

可选因子（3 个，负向影响总分，当前 `budget.yml` 尚不能配置 —— 已登记为待修项）：
```
runtimeCost      运行时开销
regressionRisk   回归风险
maintenanceCost  维护成本
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

**Markdown 与 JSON 两种格式必须包含这 11 字段，缺一不行。**
字段内容为空时**仍要输出字段标题 + 明确说明**（如 `(待 planner 产出)`），
不允许整段跳过 —— 跳过会让"没产出"看起来像"不需要"。

**HTML 报告为 v2 实现**：当前无 HTML reporter，该维度在守卫里判 `blocked`，
不计失败，但**不得**因此宣称"三格式已满足"。

---

## 三个不可妥协的工程纪律

1. **Functional Core, Imperative Shell** — core 全是纯函数，副作用都在 providers 边缘
2. **Immutable Data Flow** — FeatureMap → Evidence → Bug → Fix 全程不修改
3. **Event-Driven Spine** — 子代理之间没有直接调用，只通过 bus 通信

---

## 核心行数口径（引用时必须写明用哪个）

```
`wc -l` 口径            = 747 行（含空行与注释，6 个文件）
守卫口径（不含空行注释） = 487 行
```

两个数**都是真实的**，红线是"超过 500 行必须拆"，按**守卫口径**判定。
文档引用行数时必须写明用的是哪个口径，禁止只写一个裸数字。

---

## 宪法升级流程

修改本宪法需要：
1. 在 `CONSTITUTION-CHANGES.md` 写明"why / what / impact"
2. 升级版本号（v1.1 → v1.2 / v2.0）
3. 更新所有违反新条款的代码
4. 在 `benchmarks/` 重跑全部历史 case，确认未退化

不允许"先改代码再补宪法"。

