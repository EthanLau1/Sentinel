# Sentinel Roadmap

> 13 周路线 · 配套 CONSTITUTION.md v1.1
> 关键节点：M3.5 / M4 / M5 / M9

---

## 总览

| 周 | 阶段 | 产出 |
|---|---|---|
| 1 | M0 Core 宪法 | types/ports/bus/kernel/budget |
| 2 | M1 + M2 最小感知 | LLM 通路 + 浏览器/HTTP/FS sensors |
| 3 | M3 + **M3.5 ⭐** | FeatureMap + 端到端 demo + benchmark 启动 |
| 4-6 | **M4 ⭐ 诊断大脑** | analyst + critic + verifier |
| 7-8 | **M5 ⭐ 成本决策** | 5 维成本 + 可配置 weights |
| 9 | M7 输出与执行 | Bug 报告 11 字段 + Tier executor |
| 10 | M8 用户入口 | sentinel run + sentinel doctor |
| 11-12 | M6 知识增强 | 官方/GitHub/SO（X.com 留接口） |
| 12.5 | M8.5 自更新 | skills/adapters/cache 自更新 |
| 13 | M9 真实验证 | benchmark 30+ 案例回测 |

---

## M0 — Core 宪法（第 1 周）

**目标**：写下宪法，地基稳固。

| 任务 | 产出 |
|---|---|
| 0.1 创建独立仓库骨架 | `Sentinel/` monorepo |
| 0.2 `core/src/types.ts` | 5 个核心类型 |
| 0.3 `core/src/ports.ts` | 5 个 Provider 接口 |
| 0.4 `core/src/bus.ts` | Event Bus（typed pub/sub，<100 行） |
| 0.5 `core/src/kernel.ts` | Agent loop（<200 行） |
| 0.6 `core/src/budget.ts` | Token / 钱预算护栏 |
| 0.7 `core/test/*.test.ts` | bus / kernel / budget 单测 |

**完成标准**:
- core 总行数 ≤ 500
- 0 外部依赖
- 单测覆盖 100%
- core 不 import 任何具体平台代码

---

## M1 + M2 — 最小感知（第 2 周）

**目标**：能跟 LLM 说话，能看见运行时。

### M1 LLM 通路

| 任务 | 产出 |
|---|---|
| 1.1 `providers/llm/openai-compatible.ts` | OpenAI 兼容（你的 API/DeepSeek/Ollama） |
| 1.2 `providers/llm/ollama-native.ts` | Ollama 原生（可选） |
| 1.3 `.sentinel/llm.yml` 规范 | 配置格式 |
| 1.4 `sentinel hello` 命令 | Hello world 测试 |

**完成标准**:
- `sentinel hello` 调你的 API 返回 "I'm alive."
- 记录 token / cost
- 超 budget.yml 配置自动停止

### M2 最小感知

| 任务 | 产出 |
|---|---|
| 2.1 `providers/mcp/built-in/http.ts` | 沿用现有 runtime-sentinel |
| 2.2 `providers/mcp/built-in/browser.ts` | Playwright + a11y tree |
| 2.3 `providers/mcp/built-in/fs.ts` | 文件系统读 |
| 2.4 `providers/mcp/registry.ts` | 3+N 注册表 |
| 2.5 `subagents/sensor/` | 编排 MCP 收 Evidence |

**完成标准**:
- `sentinel sense https://localhost:3000` 输出 Evidence[]
- 标准模式收 5 项：screenshot / DOM / a11y / console / network
- `--detailed` 才收 storage / cookie / response-bodies

---

## M3 + M3.5 — 项目理解 + 最小闭环（第 3 周）⭐

**目标**：扫一眼项目就懂它，跑通端到端。

### M3 项目理解

| 任务 | 产出 |
|---|---|
| 3.1 `adapters/frontend/nextjs.ts` | Next.js 探测 |
| 3.2 `adapters/backend/express.ts` + `hono.ts` | 后端探测 |
| 3.3 `adapters/data/prisma.ts` + `drizzle.ts` | ORM 探测 |
| 3.4 `subagents/mapper/` | 输出 FeatureMap |
| 3.5 `.sentinel/app.map.ts` 生成器 | 用户可手动覆盖 |

**完成标准**:
- 路由识别 ≥ 90%
- API 识别 ≥ 80%
- auth 识别 ≥ 60%
- 业务功能允许用户在 `app.map.ts` 覆盖

### M3.5 最小闭环（这是宪法级机制）

| 任务 | 产出 |
|---|---|
| 3.5.1 端到端 demo | map → 登录 → 流程 → Evidence → 1 个 Bug → 3 个 Fix → 报告 |
| 3.5.2 `benchmarks/cases/` 启动 | 第一条真实案例归档 |
| 3.5.3 报告格式（极简版） | Markdown，包含 11 字段 |

**完成标准**:
- 在 examples/nextjs-blog 跑通完整流程
- benchmark 至少 1 条 case
- 不靠 LLM 也能跑（hypothesis 形式）

---

## M4 — 诊断大脑（第 4-6 周）⭐

**目标**：从证据到根因，且不胡说。

| 任务 | 产出 |
|---|---|
| 4.1 `subagents/runner/` | 执行 user flows，产出 flow.failed |
| 4.2 `subagents/analyst/` | 喂证据 + 代码上下文，输出 BugDraft（hypothesis） |
| 4.3 `subagents/critic/` | 反向验证（OpenHands SOTA 关键） |
| 4.4 verifier 模块 | 设计可执行的验证步骤 |
| 4.5 `skills/bug-classifier.md` | 内置 skill |
| 4.6 严重度评分（P0/P1/P2/P3） | 基于影响范围 |

**诊断三步走**（写死规则）：
```
analyst    出根因假设
critic     检查证据是否支持
verifier   设计验证方法
```

每个 BugDraft 必须包含：
- 现象
- 证据
- 根因假设
- 反证
- 置信度
- 下一步验证

**没有 Evidence 时**：
- 不能输出 root cause
- 只能输出 `insufficient evidence` 或 `need_more_data`

**完成标准**（10 个真实案例基线）:
- 8 个能给出正确根因方向
- 10 个都引用 Evidence
- 0 条无 Evidence 结论

---

## M5 — 方案决策（第 7-8 周）⭐

**目标**：每个 bug 给 3 个方案 + 阶段适配的推荐。

| 任务 | 产出 |
|---|---|
| 5.1 `subagents/planner/` | 生成 FixOption × 3 |
| 5.2 `core/cost-model.ts` | 5 维成本评分 |
| 5.3 `.sentinel/budget.yml` | stage + weights + 预算上限 |
| 5.4 `skills/fix-cost-judge.md` | 内置决策 skill |
| 5.5 推荐引擎 | 按公式排序 |

**5 维成本**：
1. 开发成本 (effort)
2. 改动风险 (risk)
3. 回归风险 (regressionRisk)
4. 运行成本 (runtimeCost)
5. 维护成本 (maintenanceCost)

**推荐公式**：
```
score = confidence × 0.35
      + impact     × 0.25
      + stageFit   × 0.20
      − effort     × 0.10
      − risk       × 0.10
```

weights 可在 `budget.yml` 覆盖。

**完成标准**:
- 同一个 bug 在 MVP / Scale 阶段推荐不同方案
- 决策可解释（whyRecommended 字段必填）
- 至少 3 套预设 weights（Idea/MVP / Launch / Scale）

---

## M7 — 输出与执行（第 9 周）

**目标**：人类能看，机器能用。

| 任务 | 产出 |
|---|---|
| 7.1 `reporters/markdown.ts` | v1 主力，包含 11 字段 |
| 7.2 `reporters/json.ts` | 机器可读 |
| 7.3 `reporters/cli.ts` | 终端彩色 |
| 7.4 `subagents/executor/` | Tier 0/1/2/3 分级修复 |

**Bug 报告固定 11 字段**：
1. Bug ID
2. 严重级别
3. 影响功能
4. 复现步骤
5. Evidence (引用 hash)
6. 根因判断
7. 推荐方案 ★
8. 备选方案 × 2
9. 风险评估
10. 验证命令
11. 是否可自动修

**Tier 行为**:
- Tier 0：仅报告
- Tier 1：自动修（生成 app.map / 改格式）
- Tier 2：自动写 patch + 生成 PR
- Tier 3：仅生成建议

**完成标准**:
- Markdown / JSON 输出包含全部 11 字段
- Tier 1 在 demo 项目自动跑通
- Tier 2 在真实项目中生成至少 1 个 PR

---

## M8 — 用户入口（第 10 周）

**目标**：5 分钟上手。

| 任务 | 产出 |
|---|---|
| 8.1 `cli/init.ts` | `sentinel init` 一键初始化 |
| 8.2 `cli/run.ts` | `sentinel run` 主入口 |
| 8.3 `cli/doctor.ts` | `sentinel doctor` Self-Check |
| 8.4 README + GETTING-STARTED + demo | 文档 |

**完成标准**:
- 陌生人 5 分钟内跑出第一份 bug list
- `sentinel doctor` 失败时给可执行修复命令
- 主入口只有 `sentinel run`，其他是调试用

---

## M6 — 知识增强（第 11-12 周）

**目标**：方案融合外部最新最优解。

### M6.1 必做

| 任务 | 产出 |
|---|---|
| 6.1.1 `providers/knowledge/docs.ts` | 官方文档检索 |
| 6.1.2 `providers/knowledge/github.ts` | GitHub issue/PR/release |
| 6.1.3 `providers/knowledge/stackoverflow.ts` | StackOverflow |
| 6.1.4 `subagents/enhancer/` | 触发判断 + 多源 + 评分 |
| 6.1.5 `.sentinel/cache/knowledge/` | 48h 缓存 |

### M6.2 可选（X.com）

| 任务 | 产出 |
|---|---|
| 6.2.1 `providers/knowledge/x.ts` | 留接口，默认关闭 |
| 6.2.2 API key 配置流程 | 用户启用即用 |

**触发规则**（只有这些情况才搜）:
- LLM 置信度低
- 错误涉及第三方 SDK
- 错误涉及新版本框架
- 错误涉及部署平台
- 本地知识库没有类似案例

**多源规则**（v1.1 修正）:
- 默认：官方文档单源即可
- 争议/版本迁移/SDK：1 个权威源 + 最多 2 个佐证源
- 不强制 ≥3 源

**完成标准**:
- 触发率 ≤ 30%
- 增强后 sources 字段必填
- 缓存命中率 ≥ 50%（重复跑同项目）

---

## M8.5 — 自更新机制（第 12.5 周）

**目标**：核心稳定，外围进化。

| 任务 | 产出 |
|---|---|
| 8.5.1 `cli/update.ts` | `sentinel update` 命令 |
| 8.5.2 `providers/skills/refresh()` | 从 GitHub 拉社区 skill |
| 8.5.3 `providers/adapters/refresh()` | 拉新 adapter |
| 8.5.4 `.sentinel/update.log` | 更新日志，可回滚 |

**允许自更新**：skills / prompts / adapters / cache / benchmark / rules
**禁止自更新**：core / budget guard / permission / evidence schema

**完成标准**:
- 自更新写日志可回滚
- 受保护文件改动会被拒绝
- 更新前自动备份

---

## M9 — 真实验证（第 13 周）

**目标**：不是 demo，是真能用。

| 任务 | 产出 |
|---|---|
| 9.1 在真实项目跑通完整流程 | 真实项目验证 |
| 9.2 在 1 个开源 Next.js 项目跑通 | 第三方验证 |
| 9.3 收集 30+ benchmark 案例 | 案例库 |
| 9.4 跟 OpenHands / aider 对比 | 横向对比 |

**benchmark 案例每条记录**:
```
项目 / 功能 / 失败现象 / 真实根因
Sentinel 判断 / 是否命中 / 推荐方案 / 是否被采纳
修复后是否通过
```

**完成标准**:
- benchmark 30+ 案例
- 根因命中率 ≥ 80%
- 方案采纳率 ≥ 60%

---

## 关键节点的"可证伪"指标

| 节点 | 指标 | 怎么测 |
|---|---|---|
| M0 | core ≤ 500 行 · 0 依赖 | `wc -l packages/core/src/*.ts` |
| M2 | Evidence 5 类齐全 | demo 跑出真实数据 |
| M3.5 | 端到端跑通 | 1 条 benchmark 案例 |
| M4 | 10 案例 8 命中 · 0 无证据结论 | benchmark 回测 |
| M5 | MVP/Scale 推荐不同 | 决策可解释字段 |
| M6 | 触发率 ≤ 30% | run 日志统计 |
| M9 | 30+ 案例 · 命中 80% · 采纳 60% | benchmark 全跑 |

---

## 不允许的捷径

- 跳过 M3.5 直接进 M4 → 拒绝
- M4 没拿到 10 案例就进 M5 → 拒绝
- core 超 500 行不拆 → 拒绝
- 任何子代理直接调用其他子代理（绕过 bus）→ 拒绝
- 修改 core 不升级宪法版本 → 拒绝
