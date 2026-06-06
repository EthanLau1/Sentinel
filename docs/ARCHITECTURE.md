# Sentinel Architecture

> 配套 CONSTITUTION.md v1.1
> 这份文件定义系统结构。修改它需要同步更新宪法或子代理文档。

---

## 系统分层

```
┌──────────────────────────────────────────────────────────┐
│  CLI 入口  (packages/cli/)                               │
│    sentinel run | doctor | map | sense | report | update │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│  Subagents 层  (packages/subagents/)                     │
│  ┌───────┬────────┬────────┬─────────┬────────┬───────┐ │
│  │mapper │ sensor │ runner │ analyst │ critic │planner│ │
│  └───┬───┴────┬───┴────┬───┴────┬────┴───┬────┴──┬────┘ │
│      └────────┴────────┴────────┴────────┴───────┘      │
│                          ↕                              │
│  ┌──────────┬────────────┐                              │
│  │ enhancer │ executor   │  (M6 / M7)                   │
│  └──────────┴────────────┘                              │
└──────────────────────────────────────────────────────────┘
                          ↕
                  ╔══════════════════╗
                  ║  Event Bus       ║
                  ║  (typed pub/sub) ║
                  ╚══════════════════╝
                          ↕
┌──────────────────────────────────────────────────────────┐
│  Providers 层  (可插拔，绝对不是 core 一部分)             │
│  ┌────────┬─────────┬─────────┬──────┬────────────┐     │
│  │  llm   │ memory  │ skills  │ mcp  │ knowledge  │     │
│  └────────┴─────────┴─────────┴──────┴────────────┘     │
└──────────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────────┐
│  Core  (≤500 行，0 外部依赖)                             │
│   types · ports · bus · kernel · budget                  │
│   只认识 5 个类型、5 个 Provider 接口、Event             │
│   不认识 Next.js / Playwright / OpenAI / 具体项目名       │
└──────────────────────────────────────────────────────────┘
```

---

## 6 条工程原则

| 原则 | 说明 |
|---|---|
| **极简核心** | core 自己写 ~500 行，不依赖任何 agent SDK |
| **万物可插拔** | LLM / Memory / Skills / MCP / Knowledge 全部 Provider 接口 |
| **绑死协议、放开实现** | 类型与接口固定，背后实现随便换 |
| **无状态优先** | 工具不存状态，存在用户那（git / memory provider） |
| **3 + N 模式** | 核心 3 个内置，其他 N 个留接口 |
| **不自动升级 core** | 自更新允许 skills/adapters/cache，禁止 core/budget/permission |

---

## 事件流

```
project.scanned     → mapper 处理     → 输出 FeatureMap
map.ready           → sensor 处理     → 收 Evidence
evidence.ready      → runner 处理     → 跑 user flow
flow.failed         → analyst 处理    → 出 BugDraft（含 hypothesis）
bug.draft           → critic 处理     → 验证或拒绝
bug.confirmed       → planner 处理    → 出 3 个 FixOption
fix.proposed        → enhancer 按需   → 增强 FixOption
fix.enhanced        → reporter 输出
                    → executor 决定 Tier → 自动 PR / 等待审批 / 仅建议
```

每个箭头都是 `Event<T>`，每个数据对象都不可变。

---

## 关键决策

### 为什么不用 Claude Agent SDK？

它是 MIT 开源，但设计假设 Anthropic Messages API 格式。我们：
- 自己写 ~300 行极简 agent loop
- LLM provider 完全抽象，OpenAI 兼容 API 可接任何后端
- 不锁死任何厂商

### 为什么子代理通过 Bus 通信？

- 解耦：加新子代理 = 订阅事件，不改其他代码
- 可观测：bus 日志 = 工具的"黑匣子"
- 可暂停：拦截事件 = 调试模式
- 可分布：将来子代理可跨进程

### 为什么 Core 必须无知？

如果 core 知道 Next.js，就不能服务 Vue。
如果 core 知道 OpenAI，就不能服务 Ollama。
如果 core 知道 Playwright，就不能服务任何不需要浏览器的场景。

**Core 的智慧来自"什么都不知道"**。

---

## 5 个核心类型（详细字段）

### FeatureMap

```
project: ProjectProfile {
  name, stack, frameworks, runtime,
  packageManager, deployTarget
}
auth?: AuthSpec {
  type: 'session' | 'jwt' | 'oauth' | 'magic-link' | 'otp',
  loginEndpoint, sessionStorage, testCredentials?
}
pages: PageSpec[]
api: ApiSpec[]
data: DataSpec[]
flows: FlowSpec[]
risks: ProjectRisk[]
```

### Evidence (sum type, 12 种)

```
ScreenshotEvidence       浏览器截图
DOMSnapshotEvidence      DOM 树快照
AccessibilityEvidence    a11y tree（轻量替代截图）
ConsoleEvidence          浏览器 console.log/error
NetworkEvidence          浏览器网络请求
HttpEvidence             API 直接响应
LogEvidence              后端日志
FileEvidence             代码文件片段
GitEvidence              git log / diff / blame
DbEvidence               数据库查询结果
TraceEvidence            OpenTelemetry / Sentry
StorageEvidence          localStorage / sessionStorage / cookie（--detailed）

每条都有: kind, source, timestamp, data, hash
```

### BugFinding

```
id, title, severity (P0/P1/P2/P3)
source (ui/api/auth/data/env/perf/deploy)
affectedFeature
symptom (现象)
reproSteps[]
evidence: Evidence[]                  ← ≥1 才允许 confirmed
rootCauseStatus: 'hypothesis' | 'confirmed'
rootCause (只在 confirmed 时填)
counterEvidence[] (反证)
confidence (0-1)
verificationCommand
fixOptions: FixOption[]
recommendedFixId
```

### FixOption

```
id, title, description
effort (low/medium/high)
risk (low/medium/high)
runtimeCost (none/low/medium/high)
devCost, regressionRisk, maintenanceCost
stageFit (Idea/MVP/Launch/Scale)
tier (0/1/2/3)                        ← 决定 executor 行为
confidence
score (公式算出，可解释)
patch?: string (diff)
verificationCommand?
sources[]: { url, authority, recency, type }
whyRecommended
```

### Event<T>

```
type (枚举字符串)
payload: T
timestamp
traceId                               ← 同一次跑共享
source (哪个子代理发的)
```

---

## 5 个 Provider 接口

```
LLMProvider {
  chat(messages, options) → Response
  estimateCost(tokens) → usd
  supportsTools: boolean
  name
}

MemoryProvider {
  recall(query) → string[]
  remember(fact) → void
  name                                ← NoneProvider 默认
}

SkillsLoader {
  list() → SkillMeta[]
  load(name) → SkillContent (markdown)
  refresh()                           ← 自更新入口
}

MCPRegistry {
  register(name, server)
  get(name) → MCPServer
  list() → MCPServer[]                ← 内置 3 + 用户 N
}

KnowledgeProvider {
  search(query, options) → SearchResult[]
  priority: number                    ← 用于源排序
}
```

---

## 子代理职责

| 子代理 | 输入事件 | 输出事件 | 职责 |
|---|---|---|---|
| **mapper** | `project.scanned` | `map.ready` | 扫栈/路由/API/数据/flows，产出 FeatureMap |
| **sensor** | `map.ready`, `flow.failed` | `evidence.ready` | 编排 MCP 收 Evidence |
| **runner** | `evidence.ready` | `flow.passed` / `flow.failed` | 跑 user flows |
| **analyst** | `flow.failed` | `bug.draft` | 出 hypothesis（不出 confirmed） |
| **critic** | `bug.draft` | `bug.confirmed` / `bug.rejected` | 反向验证 |
| **planner** | `bug.confirmed` | `fix.proposed` | 出 3 个 FixOption + 推荐 |
| **enhancer** | `fix.proposed` | `fix.enhanced` | 按需多源知识增强 |
| **executor** | `fix.enhanced` | `report.ready` | 按 Tier 决定动作（PR / 审查 / 仅建议） |

---

## 数据流不可变性

```
mapper      产出 FeatureMap   →  freeze
sensor      产出 Evidence[]   →  freeze
analyst     产出 BugDraft     →  freeze
critic      产出 BugFinding   →  freeze（基于 BugDraft 复制+修改字段）
planner     产出 FixOption[]  →  freeze
enhancer    产出新 FixOption[]→  freeze（不修改原有，生成新版）
```

任何一步都可以重放，因为输入永远不变。

---

## 安全边界

| 边界 | 规则 |
|---|---|
| 文件写入 | 只能写 `.sentinel/`、`reports/`、`benchmarks/`、用户允许的 `--out` |
| Shell 执行 | Tier 0/1/2 不允许，Tier 3 仅生成命令字符串 |
| 网络请求 | 仅 LLM API + Knowledge sources（按 budget.yml 白名单） |
| 敏感数据 | 默认不收 cookie/localStorage/response body，需 `--detailed` |
| Token 拦截 | 报告中的 token、密钥、PII 自动脱敏 |
