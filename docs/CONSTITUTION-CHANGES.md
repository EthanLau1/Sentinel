# 宪法变更记录 — v1.1 → v1.2

> 日期：2026-10-26
> 依据：`docs/REMEDIATION-PLAN-v1.md` §7（L5 对齐层）
> 证据：4 轮穷举审计 + 1 次独立 verifier 复核 + 4 次真实项目完整 run

## why

现行宪法 v1.1 与实现之间有 **8 处**结构性分叉：每一条都是"宪法写了、实现没做，或反过来"。
后果不是文档不准，而是**每轮开发都在违约**，且违约无人发现（没有守卫）。

分叉集中在 4 类：

1. **写死却不存在** —— `sentinel sense` / `sentinel report` 从未实现，却写在宪法入口纪律里；
   HTML reporter 被要求输出 11 字段，但整个 reporter 不存在；
   服务范围列了 Solid / pgvector，但仓库里没有对应 adapter。
2. **做了却没写** —— `sentinel ui` / `hello` / `init` 三个真实入口不在宪法清单里；
   成本公式实际 8 维，宪法写 5 维；实际目录是 `benchmarks/cases/`，宪法写 `benchmark/cases/`。
3. **规则无法执行** —— "run 前置 doctor 门禁"与"美元预算护栏是核心防线"两条防线在实现里都是空的：
   前者不存在，后者对所有商业 provider 静默失效。
4. **口径不一致** —— core 行数 `wc -l` 747 与门禁 487 并存，文档不写清用哪个；
   `GETTING-STARTED.md` 不存在；`core/cost-model.ts` 路径写错（实际在 `subagents/`）。

## what（逐条处置）

| # | 条款 | v1.1 | v1.2 | 依据 |
|---|---|---|---|---|
| 1 | 用户入口纪律 | 调试入口 5 个，含未实现的 `sense`/`report` | 分「产品入口（1 个）」与「工具入口（6 个）」；删除 `sense`/`report`；补 `ui`/`hello`/`init` | CLI 实测 7 个 case；`sense`/`report` 零实现 |
| 2 | 服务范围 | 含 Solid / pgvector | 删除（无 adapter）；LLM-app 改为 Vercel AI SDK / LangChain | `packages/adapters/src/` 实测 13 个 adapter，无 Solid/pgvector |
| 3 | 成本公式 | 5 维 | 8 维（后 3 维为可选因子） | `packages/subagents/src/cost-model.ts` `CostWeights` 实测 |
| 4 | 报告 11 字段 | Markdown / JSON / HTML 三格式都必须含 | Markdown / JSON **必须**；HTML 标为 **v2 实现**，当前判 `blocked` | 无 HTML reporter；守卫第 4 组对账 |
| 5 | benchmark 目录 | `benchmark/cases/` | `benchmarks/cases/` | 目录实测 |
| 6 | run 前置 doctor | 写在 Self-Check 里但未实现 | 明确写成**强制门禁**：配置类 fail → run 拒绝启动；LLM 不可达 → 不阻塞（降级为启发式） | `packages/cli/src/run.ts` 已实现 |
| 7 | 美元预算护栏 | 列在"禁止自动更新"里，暗示它是防线 | 写成**可执行性条款**：必须配 `pricing`（USD/每百万 token）否则护栏不可执行，doctor 必须报出来；单次响应另有 `maxTokensPerRequest` 上限 | §4.9 已实现 |
| 8 | 核心行数口径 | 只写"超过 500 行必须拆" | 补口径：`wc -l` 与门禁口径（不含空行注释）都真实，引用时必须写明用哪个 | 两种口径实测 747 / 487 |

**同时修正的路径错误**：`core/cost-model.ts` → `packages/subagents/src/cost-model.ts`；
`GETTING-STARTED.md` → `QUICK-START.md`（根目录，前者不存在）。

**同时新增一条纪律（本次审计的直接产物）**：

> **守卫优先于自觉** —— 凡是宪法里能机检的条款，必须有对应守卫脚本；
> 否则"遵守宪法"只靠人的自觉，第二次改代码就会漂移。

对应实现：`scripts/check-spec-sync.mjs`（13 组规范↔实现对账）+ `bun run lint:spec`。

## impact

| 影响面 | 变化 |
|---|---|
| 代码 | 无（v1.2 全部条款在本次补齐方案里已有对应实现或已明确标记为 v2/blocked） |
| 文档 | `docs/CONSTITUTION.md` 升 v1.2；`docs/ROADMAP.md` 与 `docs/W2-W13-COMPLETION.md` 的 5 维表述同步 |
| CI | 新增 `bun run lint:spec`；现有 `lint:core` / `lint:lines` 保持不变 |
| 守卫 | 守卫第 2 组（CLI 命令表）与第 3 组（宪法入口）按新入口清单重新对账 |
| 未退化验证 | 按宪法升级流程第 4 条，需在 `benchmarks/` 重跑全部历史 case 确认未退化 —— **顺延到补齐方案批5（真实案例落地后）执行**，理由：`benchmarks/cases/` 现有 3 条全是自反案例，证明不了未退化 |

## 未处置 / 明确留到 v2

- **HTML reporter**：v1.2 标为 v2 实现，不在本轮补。守卫把该维度判 `blocked`，不计入失败。
- **Solid / pgvector adapter**：从服务范围删除；是否支持由需求方决定，不写进宪法。
- **`sentinel sense` / `sentinel report`**：从宪法删除（YAGNI）。需要时以新入口提出，走宪法升级流程。
- **成本公式后 3 维（runtimeCost / regressionRisk / maintenanceCost）**：
  模型里有，但 `budget.yml` 的 `weights` 目前无法配置它们 —— 这是**代码侧待补**，不是宪法问题，已登记在守卫 baseline。
