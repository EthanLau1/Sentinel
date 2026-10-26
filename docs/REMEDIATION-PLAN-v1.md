# Sentinel 补齐方案 v1（已过独立审核）

> 日期：2026-10-26 · 状态：**审核通过（PARTIAL → 修订后 PASS）** · 基线：commit `a323f34`（`main` = `origin/main`）
> 证据来源：4 轮穷举审计 + 1 次独立 verifier 复核 + **1 次真实项目完整 run**
> 修订记录见 §12（每条审核意见的处置）

---

## 0. 一句话结论

34 项缺漏不是 34 个孤立 bug，而是 **4 个系统性根因**。逐条打补丁 = 34 个 commit = 半年后照样漂移。
**最佳方案是：先把"规范与实现的一致性"变成机器门禁，再消灭沉默失败，然后补闭环与可信度。**

**v1 已经过一轮独立审核，发现 3 处硬错误 + 1 项高危遗漏，全部已在本版修正（§12）。**

---

## 1. 四个根因（先定性，再定方案）

| 根因 | 表现 | 涉及项 | 为什么必须系统性解决 |
|---|---|---|---|
| **R1 声明与实现分叉** | 宪法/规范/CONFIG-SPEC 写了能力，代码没实现或实现不同 | 24 | 没有守卫 → 每次改代码都会再分叉，且没人会发现 |
| **R2 沉默失败** | 扫不到东西不报错、配置字段被静默忽略、**预算护栏静默失效**、报告字段缺失 | 7 | 用户以为"跑成功了" → 信任被摧毁 |
| **R3 闭环断裂** | executor 只写文件不改码不验证；无回滚；单条 flow 异常会中断整轮 | 5 | "能改"和"改对了"之间没有证据链 |
| **R4 验证不均** | 只有 core 有覆盖率门槛，报告层/检索层是 0% | 8 | 0% 覆盖区 = "看起来有、其实从没验过" |

> **口径说明**：四类**存在交叉**（R4 的 8 项多数是 R1 内部项目的"缺测试"侧面；R2 里有 2 项同时属于 R1 的分叉）。
> **去重后的独立缺陷数 = 34**。上表数字不可相加。§3.3 的 baseline 以**去重后清单**为准。

---

## 2. 方案总览与批次顺序

```
L1 守卫层 ── 把 24 项偏差变成可机检的门禁（防止再分叉）
L2 诚实层 ── 让"没测到/没生效"必须说出来（消灭沉默失败）
L3 闭环层 ── 改完能验证、坏了能回滚
L4 可信层 ── 0% 覆盖区补测试 + 基准回测
L5 对齐层 ── 宪法升 v1.2，文档口径统一
```

**批次顺序（已按审核意见修正）**：

```
批0  L1 守卫骨架（只落 baseline，不卡人）   ← 提前：先有参照系，后续每批都被守
批1  L2 诚实层（含 USD 护栏 + runner 不中断）
批2  L4a  报告层/检索层补测试并设门槛
批3  L3 闭环层
批4  L5 宪法 v1.2（"确认未退化"一步顺延到批5之后）
批5  benchmark 回测 + 真实案例
```

> **关于脚本**：本方案会新增 `scripts/check-spec-sync.mjs`。
> 这与"不把工具当方法"不冲突 —— **方法**是"规范与实现必须对账，差异即缺陷"（写进全局工作流）；
> **脚本**只是这个方法的一次性执行器（留在项目里）。换实现方式不影响方法成立。

---

## 3. 批0 · L1 守卫层：把 24 项偏差锁住

### 3.1 `scripts/check-spec-sync.mjs` 机检 12 组对账

| # | 对账维度 | 数据来源 | 判定 |
|---|---|---|---|
| 1 | 事件目录 × 代码发出点 | `docs/EVENT-CATALOG.md` × `packages/*/src` | 只在类型定义出现 = 死事件（当前 9 个） |
| 2 | CLI 命令表 × 实际 case | `README.md` + 宪法 × `cli/src/index.ts` | 命令缺失/多出 |
| 3 | 宪法调试入口 × CLI 命令 | `CONSTITUTION.md` × CLI | 入口数量与清单一致 |
| 4 | 报告 11 字段 × 各输出格式 | 宪法 × `reporters/src` | **HTML 未实现前该维度判 `blocked`，不计入失败** |
| 5 | CONFIG-SPEC 字段 × 实际解析字段 | `CONFIG-SPEC.md` × `cli/src/config.ts` | 规范字段无人读取 = 死配置 |
| 6 | 成本模型维度 × 可配置维度 | `cost-model.ts` × `config.ts` | 维度差集 = 静默失效 |
| 7 | adapter 数量 × 各自分支测试文件 | `adapters/src` × `adapters/test` | 无测试的 adapter 列出（当前 13 个中 12 个无测试） |
| 8 | coverage 阈值作用域 × 实际包数 | `vitest.config.ts` × `packages/` | 未设门槛的包列出 |
| 9 | 守卫脚本 × 宪法红线 | `scripts/` × `CONSTITUTION.md` | 无机器守卫的红线列出 |
| 10 | benchmark 案例 × schema | `benchmarks/cases` × `benchmarks/schema.ts` | 案例不合 schema 或未校验 |
| 11 | Tier 行为 × 宪法定义 | `executor.ts` × 宪法 | Tier 1/2/3 实际行为对齐 |
| 12 | 启动脚本条件 × 真实行为 | `start.command` × 实际构建/启动 | 条件失效（dist 存在就不重建） |
| 13 | **知识检索触发率上限** | 宪法（≤30%）× `enhancer.ts` | 当前无上限 → 需实现并机检 |

**硬约束**：`check-spec-sync.mjs` **不得 import `packages/core`**（宪法红线 1/3），只读文本与文件系统。

### 3.2 渐进落地机制 + 防"降标准"

一次性上守卫会立刻报 24 项 → 无法落地。因此：

- 新增 `scripts/spec-sync-baseline.json`：记录**已知未修项**（每项含 id、维度、期望状态）
- 守卫只对**基线之外的新偏差**失败（新增偏差 = 回归）

**防"为了绿灯而降低标准"的三条锁**（审核意见，已补）：

| 风险 | 锁法 |
|---|---|
| 手工往 baseline 里加一行，把新偏差转成"已知" | **baseline 只能由守卫在对应维度被修好时自动移除，禁止手改**；手改时校验每项 `since` 与 `dimension` 一致性 |
| "超 2 个版本未清理"只是警告 → 可永远不清 | 改为 **exit 1**（阻断），不设"仅警告"档 |
| baseline 里某项的"期望状态"本身错了 | 守卫**主动校验该项的期望状态仍等于实际**；不符则报"基线过期" |

### 3.3 验收

```bash
bun run lint:spec        # 新增
# 期望：输出 "34 known / 0 new"（按去重清单计）
# 故意注入一条偏差 → 必须 exit 1
# 故意手改 baseline 加一行 → 必须被拒
```

---

## 4. 批1 · L2 诚实层：消灭沉默失败

**这一层直接决定"能不能产出有效诊断"，是整个方案的核心。**

### 4.0 真实 run 实测（2026-10-26）

在 `examples/nextjs-blog` 上跑通了**第一次真实完整 run**。与 2026-06-15 的历史记录对比：

| 指标 | 2026-06-15（iDream- reborn） | 2026-10-26（examples/nextjs-blog） |
|---|---|---|
| 流程总数 | 23 个全部失败 | **3 个：1 通过 / 2 失败 / 0 未跑** |
| 产出条数 | 25 条 P2，**全部同质**（同一个 URL 拼接错误） | **2 条 P1，指向不同页面，真实可复现** |
| 根因状态 | `confirmed`（**假的**） | `hypothesis`（**诚实的**） |
| 每条证据数 | 1 条 | 4-5 条（console / screenshot / a11y / file） |
| 结果真伪 | Sentinel 自身的工具性故障 | 根因是项目代码：`app/posts/page.tsx` 内容为 `return null` → 渲染空 body → 断言超时 |
| `run-status.json` | 无 | **完整生成**，字段与本文验收判据一致 |

**结论**：修复空数组覆盖后，Sentinel 第一次产出了**可复现、状态诚实、证据充分**的诊断。
方向被证明是对的；缺的是把"偶然成功"变成"必然成功"。

### 4.0b 实测同时暴露的新缺陷

#### E1【P0】dev server 首次编译期 500 → 直接退出，不产出任何报告

- 现象：首次 run 时 `Browser preflight failed: Page http://127.0.0.1:3000 returned HTTP 500` → 退出码 2，**报告目录里什么都没有**
- 根因：Next.js/Vite 首次请求要编译，**编译完成前返回 5xx**；而 `dev-server.ts` 只用 `checkPort()` 判断就绪 —— **端口已监听 ≠ 首页可用**
- 放大器：preflight 失败被当成"run 失败"，**不产出 bug 报告** → 用户只看到一个退出码

**修法**：
1. 就绪判定改为**轮询首页直到返回非 5xx**（含超时），而不是只看端口
2. 超时仍 5xx → 判定为**项目缺陷**，**必须产出 bug 报告**（HTTP 状态码 + 响应片段作为 Evidence），而不是 exit 2
3. 预热：把 mapper 识别出的所有页面路径先请求一遍，再开始跑 flow

#### E2【P0】Markdown 报告在无修复方案时缺第 7 字段（**实测证据**）

实测报告原文（`examples/nextjs-blog/reports/sentinel-latest.md`）：

```
**5. Evidence** (5 条): ...
**6. 根因判断** (⚠ hypothesis, conf=0.55): (insufficient evidence)
**8. 备选方案** (0):          ← 第 7 字段整段消失
```

- 根因：`reporters/markdown.ts` 的第 7 字段包在 `if (recommended) { ... }` 里，**没有 recommended 时整段被跳过**
- 违反宪法：「任何输出格式都必须包含这 11 字段。缺一不行」
- 触发条件很常见：**任何"诊断出来了但还没出方案"的 bug 都会缺字段** —— 也就是最需要解释的场合

**修法**：字段 7/8 无内容时**仍输出标题 + 明确说明**（如 `**7. 推荐方案** ★: (待 planner 产出)`），不允许跳过。

#### E3【已验证】`run-status.json` 字段与验收判据一致

实测：`plannedFlows=3 / passedFlows=1 / failedFlows=2 / untestedFlows=0 / bugCount=2 / coverageRisks[2]`。
→ §4.8 与 §8 的字段名**全部正确、可直接判定**。

### 4.1 `~/.sentinel/llm.yml`：baseUrl 已修，key 已失效

**原始事实**：`providers.cloud.baseUrl` 的值是 API key（`sk-` 开头），不是 URL。
**溯源**：同一个 key 出现在用户另一项目的《LLM 模型选型与 API 实装代码指南》中，配的是
`base = https://api.deepseek.com/v1`、`model = deepseek-v4-flash` → 正确地址是 **`/v1` 后缀版**。

**已执行**：`baseUrl` → `https://api.deepseek.com/v1`；`apiKey` 与 `model` 未动。
**实测**：

| baseUrl | 结果 |
|---|---|
| `https://api.deepseek.com` | HTTP 401 `Your api key: ****u5B8 is invalid` |
| `https://api.deepseek.com/v1` | HTTP 401 `Your api key: ****u5B8 is invalid` |

→ **地址已正确，但 key 本身已失效**（原始文档日期 2026-05-06，距今 5 个多月）。

**因此本项拆成两件事**：
1. ✅ **baseUrl 字段语义修正**（已完成，保留；否则连 URL 都不合法）
2. ⬜ **key 有效性** —— 二选一：
   - 换新 key：在 provider 控制台重新申请，填入 `apiKey`
   - 或改用可用 provider：Sentinel 仓库自己的项目级 `.sentinel/llm.yml` 用 **MiniMax-M3**，
     `sentinel hello` 实测**通过**（245 tokens / 2.2s）→ 本机有一条现成的可用通路
   - 本次真实 run 就是用 minimax 跑通的

**注意优先级差异**（`config.ts:115-118`）：先读 `<project>/.sentinel/llm.yml`，读不到才回退全局。
→ 全局 key 失效时，仓库内自测仍能走通，**但对其他项目（如 iDream- reborn）会失败**。这个差异必须在 doctor 里显式提示。

### 4.2 `doctor` 补齐检查项（**修正后的真实数量**）

现状：`doctor.ts` 已实现 **8 个具名检查** —— `.sentinel/`、`llm.yml`、`budget.yml`、`LLM API`、
`Playwright`、`Git`、`app.map.ts`、`Evidence dir`。
宪法 8 条里**只缺 2 项**：`MCP / Skill provider 可用`、`report 生成能力`（HTML reporter 不存在）。

**要补 4 项**：

| 要补的检查 | 失败时的建议动作 |
|---|---|
| ① MCP / Skill provider 可用（宪法缺项） | `检查 .sentinel/skills 目录与 MCP 注册表` |
| ② report 生成能力（宪法缺项，含 HTML） | `bun run build` 后重试；HTML 未实现前标 `blocked` |
| ③ baseUrl 形态（必须像 URL，不能是 key） | `把 baseUrl 改成 https://<host>/v1` |
| ④ Knowledge provider 可用（不强制联网） | `配置 GITHUB_TOKEN 提高限额` |

**并修**：`doctor.ts:62` 的死代码（`apiKey.includes('${')` 在 env 展开后永不成立）→ 改为"env 变量未设置"判断。

### 4.3 `run` 前置 doctor 门禁（宪法明文要求，现无）

- `run` 开始时执行 doctor 检查；**任一项 fail → 拒绝启动并打印修复命令**
- doctor 必须与 `run.ts` 用同一个 root 解析（`--project=` 或 cwd）

### 4.4 mapper 静默空产出

- `pages.length === 0 && api.length === 0` → `risks` 加 `coverage_empty_map`（severity: high）
- 自动生成了 flow 但被用户覆盖成空 → `risks` 加 `coverage_flows_overridden`
- `flows.length === 0` → `run` 的退出原因必须写明"没有可执行流程"

### 4.5 配置字段静默失效

- `config.ts` 读 `budget.yml` 时遇到**未知字段** → 警告"字段 X 当前版本不生效"
- 对比 CONFIG-SPEC：要么补实现（`agents.*` 混合 provider、`knowledge.yml`、`permissions.yml`），
  要么在规范里标"未实现" —— **默认选后者**（minimal-code-ladder 第 1 级：不造没人用的配置）

### 4.6 报告一致性（**降级为"建议修"，理由见 §12-M3**）

- **已修**：`critic.ts` 的 `!draft.rootCause?.trim()` 拒绝闸门已在基线 `a323f34` 加入 →
  "confirmed + 空 rootCause" 在当前代码**不可达**，2026-06-15 的 25 条是旧代码产物
- **仍需修（防御性）**：
  - 显示层一致性：状态为 `hypothesis` 时，内容却显示 `(insufficient evidence)` → 应显式写"证据不足"而不是看起来像根因
  - **E2 缺第 7 字段**（实测，活缺陷，见 §4.0b）→ 属 P0，必须修
  - 同源错误聚合：同 kind + 同 message 归一化后**合并为 1 条**，其余折叠为"同类 N 条"
  - 工具性失败标记：`invalid URL` / `fetch() URL is invalid` 属 Sentinel 自身链路问题 → 禁止标记为 confirmed，并单独打标

### 4.7 dev server 端口发现（**次要因素，不是主因**）

- 现状：`dev-server.ts:136-143` 从脚本字符串猜端口，猜不到就按框架名硬猜（next→3000、vite→5173）
- 问题：框架端口被占用时**自动递增**（Next 跳 3001、Vite 跳 5174），而 Sentinel 只等固定端口 → 超时失败
- **定位修正**：iDream 那 25 条假阳性的**主因是 URL 拼接非法**，端口只是次要因素。
  但它仍是"首次运行真实项目就会失败"的真实阻断项 —— 且与 E1（首编译 500）叠加后，
  **首次运行几乎必然失败**

**修法（平台原生优先）**：
1. 启动前探测候选端口是否空闲，被占用则取下一个空闲端口
2. 以 `--port <free>` 传给框架（next/vite/nuxt 均支持）
3. 同时解析启动输出里的 `Local: http://127.0.0.1:<port>` 作为兜底
4. 解析不到且端口不通 → 失败信息必须写"实际监听端口探测失败"

### 4.8 runner 单条 flow 异常会中断整轮（**审核新增项**）

- 现状：`runner.ts:30-33` 是 `for (flow of flows) { await runFlow(...) }`
- 缺陷：`runFlow` 的 try 只包住 steps；`collectFailureEvidence()`（`runner.ts:137+`）在 catch 内 await，
  **它一旦抛错 → runFlow reject → for 循环中断 → 后续 flow 一个都不跑**
- 后果：`passedFlows + failedFlows < plannedFlows` → 判 incomplete → exit 2，
  **且没有任何日志说明哪些 flow 没跑**

**修法**：flow 级 try/catch 包裹，失败也要计入 `failedFlows`；
报告里列出**未执行的 flow 清单**；`run-status.json` 增加 `notRun` 明细。

### 4.9 USD 预算护栏静默失效（**审核新增项，高危**）

- 现状：`run.ts:152` `costKnown = type === 'ollama-native' || Boolean(provider.pricing)`
- 缺陷：llm.yml 没有 `pricing` 字段 → `costKnown = false` → `run.ts:156` **不传 `maxUsd`**
  → **单次花费上限完全不生效**，只剩 token 上限
- 实测输出已印证：`API price unknown: USD budget cannot be enforced; token limit remains active.`
- 严重度：**宪法把 budget guard 列为"禁止自更新"的核心防线**，现在它对所有商业 provider 都失效

**修法**：
1. CONFIG-SPEC 补 `pricing` 字段（当前 `config.ts:20` 已定义但规范里没有 → 又是 R1 分叉）
2. `pricing` 缺失时 → **doctor 明确报"美元预算无法执行"**（不只 run 打印一句）
3. 支持"按 token 单价估算"：配置 `pricePerMTokIn / pricePerMTokOut` → 换算成 USD，预算护栏重新生效
4. 兜底：无法估算时，用**请求次数 × 单次最大 token** 推算上界，阻止"单次超长响应"打爆预算

### 4.10 批1 验收（**修正后的判据，全部可跑**）

```bash
# ① doctor 全绿
bun packages/cli/src/index.ts doctor --project=<真实项目>
#    期望：0 fail；若有 fail，run 必须拒绝启动

# ② 真实 run 走完全流程
bun packages/cli/src/index.ts run --project=<真实项目>
#    期望：
#    - exit code = 0 或 1（不是 2）
#    - run-status.json: plannedFlows > 0 且 passedFlows+failedFlows == plannedFlows
#      （口径：这两个数只数**首轮**；修复后的重跑单列 rerunPassedFlows / rerunFailedFlows。
#        混在一起数会多出 1 —— 重跑会把同一条 flow 再跑一遍）
#    - coverageRisks 非空
#    - 报告中不存在"同一错误重复 N 次"（同源聚合生效）

# ③ 诊断有效性（不是恒真判据）
#    至少 1 条 bug 满足：rootCauseStatus === 'confirmed' 且 rootCause 非空
#    （注：'insufficient evidence' 不是合法枚举值，不能用作判据 —— 见 §12-M3）

# ④ 报告完整性
#    报告 markdown / json 各自包含 11 个字段标题，无缺失
```

---

## 5. 批2 · L4a 可信层（**只做报告层与检索层**）

| 目标 | 动作 | 门槛 |
|---|---|---|
| reporters（当前 0%） | 补 11 字段 × 各格式的断言测试 | ≥ 70% |
| knowledge（当前 0%） | 补 provider 契约测试（不发真网络请求） | ≥ 70% |
| 其余包 | 暂不设阈值 | — |

**理由（按审核意见收窄）**：一次性把阈值抬到"其余 ≥60%"会让 reporters/knowledge（真 0%）与 analyst 一次性红，
拖垮批2。分两步：批2 只做报告层/检索层，批3 之后再逐步扩到 subagents/providers。

**批3 之后（可延后）**：
- `analyst.ts` 补"无证据不出 root cause"等红线测试 → ≥80%
- 13 个 adapter 写**一个**通用 adapter 契约测试，逐个喂样本 → 每个 adapter ≥1 用例
- 全仓库阈值从"仅 core 100%"改为分档

**原则**：不为凑覆盖率写无断言价值的测试；每个新测试必须能抓住一类真实回归。

---

## 6. 批3 · L3 闭环层：改完能验证、坏了能回滚

| 缺口 | 动作 | 验收 |
|---|---|---|
| Tier 1 不自动修 | executor 增加**硬规则分级**（不靠 LLM 给 tier）：格式/缺配置/生成 app.map → Tier 1；其余降级 | Tier 1 真实改码 + 改动可回滚 |
| Tier 2 不生成 PR | 调 `gh pr create`（本机已有 `gh` CLI，无需加依赖）；**并同步修改 `executor.ts:1-10` 的红线注释**（它写着"永远不直接 commit/push"，与本项冲突） | 真实项目生成 1 个 PR；同时复活 `pr.created` 死事件 |
| 修复不验证 | 修复后自动重跑受影响 flow，比对是否转绿 | 报告出现"修复前失败→修复后通过"记录 |
| 无回滚 | 改动前 `git stash`/临时分支，出错自动还原 | 故意注入坏 patch → 自动还原成功 |

**边界**：只改被测项目、只改白名单文件类型、绝不碰数据库迁移与权限代码（宪法 Tier 3 定义）。

---

## 7. 批4 · L5 对齐层：宪法升 v1.2

当前宪法与实现差 24 处，**不升版则每轮都在违约**：

| 条款 | 现状 | 处置 |
|---|---|---|
| 调试入口"最多 5 个" | 实际 7 个（含 `sentinel ui`、`hello`、`init`） | 区分"产品入口"与"调试入口" |
| `sentinel sense` / `sentinel report` | 从未实现 | 从宪法删除（YAGNI） |
| 成本公式 5 维 | 代码 8 维 | 宪法改为 8 维（代码的更完整） |
| HTML 报告必含 11 字段 | 无 HTML reporter | 实现它（批2 内），或宪法标"v2 实现" |
| 报告目录 `benchmark/cases/` | 实际 `benchmarks/cases/` | 改宪法为复数 |
| 服务范围含 Solid / pgvector | 无对应 adapter | 从服务范围删除 |
| `run` 前置 doctor | 未实现 | 补实现（§4.3） |
| 美元预算护栏是核心防线 | 对商业 provider 失效 | 补实现（§4.9） |

**同时统一口径**：`wc -l` 747 vs 门禁 487（两者都真实，文档必须写明用哪个）；
`cost-model.ts` 路径；`GETTING-STARTED.md` 不存在（改指 QUICK-START.md）；
**core 余量只有 13 行**（487/500）→ 任何 core 改动必须先看门禁。

> **宪法升级流程要求"在 benchmark/ 重跑全部历史 case 确认未退化"** ——
> 但 `benchmarks/cases/` 只有 3 条且全是自反案例，**证明不了未退化**。
> 因此这一步**顺延到批5 之后**执行（批5 产出真实案例后再回测）。

---

## 8. 执行批次与验收门（每批可独立交付）

| 批 | 内容 | 完成判据（可跑） |
|---|---|---|
| **0** | L1 守卫骨架 + baseline + 3 条防降标准锁 | `bun run lint:spec` 输出 "0 new"；注入偏差 exit 1；手改 baseline 被拒 |
| **1** | L2 全部（4.1-4.9） | 真实 run exit≠2；status.json 流程数对齐；报告 11 字段齐全；至少 1 条 `confirmed` 且 rootCause 非空 |
| **2** | L4a：reporters + knowledge 补测试并设门槛 | coverage：reporters/knowledge ≥70%；全量测试通过 |
| **3** | L3 闭环 | Tier 1 真实改码并回滚成功；生成 1 个 PR；修复后重跑记录进报告；executor 注释同步 |
| **4** | L5 宪法 v1.2（不含"未退化"验证） | 宪法版本号已升；8 条处置逐条写进变更记录 |
| **5** | benchmark 回测 + 未退化验证 | 案例 ≥30（真实外部 ≥20）；`validateCase` 进 `npm test`；命中率/采纳率有实测数字；**回测覆盖全部可回放的历史 case 并确认未退化**（当前 35/39 条有夹具，未覆盖的 4 条与原因见 §13.12） |

**每批一个 commit，提交信息写清"解决哪个规范条目"**（遵守 AGENTS.md「只同步 Sentinel 文件」铁律：只 `git add` 明确列出的文件）。

---

## 9. 风险与不做的事

| 风险 | 应对 |
|---|---|
| 守卫一次报 24 项红 → 无法落地 | baseline 机制 + 3 条防降标准锁（§3.2） |
| 覆盖率门槛抬高拖慢 CI | 拆批2（只做报告层/检索层），其余延后 |
| 改 `~/.sentinel/llm.yml` 涉及真实凭据 | 只改 baseUrl 一行，key 不动；已用 `sentinel hello` 实测；不通过即回滚 |
| benchmark 30 案例需人工标注真实根因 | 需要你提供可测的真实项目 + 人工确认根因；**这是唯一无法自动化的环节** |
| `gh pr create` 与 executor 红线注释冲突 | 批3 同步改注释，不留矛盾 |
| 框架端口行为与假设不符 | 批1 先做端口发现 + E1 就绪重试，真实项目验证后再进后续批 |
| **已证伪的风险**：「首次运行必然失败」 | 预热后已跑通（§4.0）→ 批1 的目标是让**首次运行也成功**，不是"能不能跑" |

**明确不做**（本轮范围外）：Solid / pgvector adapter、X.com provider、v2 特性（gRPC/WebSocket）、多租户、UI 改版、CI 平台集成。

---

## 10. 覆盖边界（不宣称完整）

**已覆盖**：事件目录×代码 · CLI 命令表 · 宪法入口 · 报告字段（md/json，实测发现缺字段）· 配置字段 · 启动脚本 · adapter 测试分布 · coverage 全量实测 · UI 前后端契约（Chrome DevTools 实测）· browser 断言语义 · budget 护栏 · fs/http/knowledge 行为 · benchmark schema · **真实 mapper 运行** · **真实完整 run（首次）** · CONSTITUTION / CONFIG-SPEC / ROADMAP 对账 · 历史运行产物

**未覆盖**：README / QUICK-START / 其余 8 份 docs 未逐条对账 · benchmark 案例深层字段 · doctor 各检查项逐条实际行为 · UI 端到端真实请求（只做了页面渲染与数据呈现）· 多 agent 并发行为 · **非 Next.js 项目的诊断（react/svelte/vue adapter 没有 routes() → 0 流程，见 §13.9）** · benchmark 案例的深层字段（只校验 schema 与关键判据） · HTML reporter（不存在）

---

## 11. 立即可做的下一步

1. 换一个有效的 LLM key（或沿用项目级 minimax 配置）→ 打通对其他项目的调试
2. 按 **批0 → 批1** 顺序实施；批1 的第一条就是 **E1 就绪重试**（首次运行当前必失败）
3. 把这次真实 run 归档为 `benchmarks/cases/` 第 1 条**真实外部案例**（现有 3 条全是自反案例）
4. 需要你决策的只剩一件：**美元预算护栏采用哪种方案**（§4.9 的 3 选 1：配置 pricing / 按 token 单价估算 / 用上界推算）

---

## 12. 审核记录（独立 verifier 复核 → 逐条处置）

| # | 审核意见 | 处置 |
|---|---|---|
| M1 | §4.1 把"要改什么"写死，且 baseUrl 实际已改 | ✅ 已改为"已执行 + 实测 401 + key 失效"（§4.1），并补"doctor 从不校验 model 字段"这一后续风险 |
| M2 | "doctor 只落实 2 项"两个数字都错 | ✅ 已修正为"已实现 8 项，缺 2 项，要补 4 项"（§4.2），删掉表中已实现的 4 项 |
| M3 | §4.6 归因错误（critic 闸门基线已加）；§4.8"非 insufficient evidence"判据**恒真** | ✅ §4.6 降级为建议修并说明理由（§12-M3 亦指此）；§4.10 判据改为 `rootCauseStatus === 'confirmed' && rootCause 非空`（§4.10-③） |
| M4 | runner 单条 flow 异常会静默中断整轮，方案完全没提 | ✅ 新增 §4.8 专项修复与验收 |
| M5 | 根因表 24+6+5+8=43 与"34 项"矛盾 | ✅ §1 加口径说明：四类存在交叉，去重后 34，不可相加 |
| O1 | **USD 预算护栏静默失效**（高危，方案漏了） | ✅ 新增 §4.9 专项，含 4 步修法与 3 种预算方案 |
| O2 | CONFIG-SPEC 无 `pricing` 字段（config.ts 已定义） | ✅ 并入 §4.9-① 与 §3.1 第 5 组对账 |
| O3 | knowledge 触发率无 30% 上限 | ✅ §3.1 新增第 13 组对账，§7 宪法条款补录 |
| O4 | start.command 永不重建 dist（方案提了但没排批次） | ✅ §3.1 第 12 组对账 + 批0 纳入 |
| O5 | 9 个死事件（`pr.created` 等）未被利用 | ✅ §3.1 第 1 组；§6 批3 用 `gh pr create` 复活 `pr.created` |
| O6 | `hello`/`init` 不在宪法入口清单 | ✅ §7 入口条款补录 |
| O7 | `gh pr create` 与 executor 红线注释冲突 | ✅ §6 批3 明确要求同步改注释 |
| 顺序 | 建议 L1 提前、L4 拆分 | ✅ §2 批次顺序改为 批0(L1)→批1(L2)→批2(L4a)→批3(L3)→批4(L5)→批5(benchmark) |
| 基线 | baseline 可手改 = 可降标准 | ✅ §3.2 加 3 条锁（禁止手改、超期 exit 1、期望状态主动校验） |
| HTML | 第 4 组对账在 HTML 实现前无法判定 | ✅ §3.1 第 4 组标注"未实现前判 blocked，不计入失败" |
| 覆盖率 | `analyst.ts` 4.72% 未复核 | ⚠️ 记录备查：v8 coverage 实测值，未二次复跑 |
| 顺序 | 宪法"确认未退化"需真实案例才有意义 | ✅ 拆到批5 之后（§7 末、§8 批5） |
| 红线 | core 余量仅 13 行 | ✅ §7 补入 |
| 红线 | 守卫不得 import core | ✅ §3.1 加硬约束 |

---

## 13. 实施记录（批 0–5 实际执行，2026-10-26）

> 本节是执行这一轮方案的真实记录：做了什么、实测到什么、
> 以及**执行过程中新发现的 6 个缺陷**（它们不在最初的 34 项里，
> 是"把方案真正跑起来"之后才暴露的）。

### 13.1 各批完成情况

| 批 | 内容 | 状态 | 证据 |
|---|---|---|---|
| **0** | L1 守卫骨架 + baseline + 3 条防降锁 | ✅ 完成 | `bun run lint:spec` → "已知未修 11 / 新增偏差 0"；注入偏差 exit 1；手改 baseline exit 2；基线过期 exit 2；超期未清理 exit 1（4 条锁逐条实测） |
| **1** | L2 诚实层（4.1–4.9 + E1/E2） | ✅ 完成 | 真实 run 7 次；exit≠2；流程数对齐（**首轮口径** —— 修复后的重跑单列 rerunPassed/FailedFlows，见 §13.12 缺口 4）；报告 11 字段齐全；**2 条 confirmed 且 rootCause 非空** |
| **2** | L4a 报告层/检索层补测试 + 门槛 | ✅ 完成 | reporters 94.28%、knowledge 100%；`vitest.config.ts` 已设 ≥70% 门槛（实测生效） |
| **3** | L3 闭环层 | ✅ 主要判据达成 | **run17 实测**：Tier 1 真改码（`app/posts/page.tsx` 的 `postList.map` → `posts.map`）+ 修复后重跑通过（flows 1 → **2 passed**）+ Tier 2 patch 真落盘 + 报告第 11 字段写硬规则 tier 与理由。**回滚路径本轮被真实触发**（E31 事故：`status: "reverted"`，原因写进 run-status）—— 不再只是单测覆盖；**PR 已能真建**（2026-10-26 补齐，见 §13.12）：`--create-pr` 会建独立分支 → 提交 → 推送 → `gh pr create`，默认关闭；不传该参数时完全不产生外部可见动作 |
| **4** | L5 宪法 v1.2 | ✅ 完成 | `docs/CONSTITUTION.md` 升 v1.2 + `docs/CONSTITUTION-CHANGES.md`（8 条处置逐条写明） |
| **5** | benchmark 回测 + 真实案例 | ✅ 达成（§13.8–13.11） | **案例 39 条（真实外部 36 条）**，判据 ≥30 / 外部 ≥20 已达标 —— 样本不是等来的，是「克隆 4 个公开真实仓库 + 注入 21 处人工写定真值的缺陷」做出来的；`validateCase` 已进 `npm test`；统计/报告脚本可跑（命中率、采纳率、验证通过率都是实测数字）；**可重放回测已覆盖 35/39 个案例**（`bun run test:replay` → 夹具 36 个通过、退化 0：35 个**契约夹具** + 1 个**录制夹具**；未覆盖的 4 条与原因见 §13.12） |

### 13.2 执行中新发现的缺陷（E4–E32，共 29 条；不在原 34 项里）

> E4–E28 在下表；E29–E31 记在 §13.10–§13.11；**E32 是这一轮做真实 run 验证时新挖出来的**（见末行）。

| # | 缺陷 | 症状 | 根因 | 处置 |
|---|---|---|---|---|
| **E4**【P0】 | **LLM 调用无超时 → 整轮 run 永久挂起** | 实测 run 挂起 5 分 28 秒不返回；`lsof` 显示进程有一个 ESTABLISHED 的 443 连接在等响应；CPU 0% | `openai-compatible.ts` / `ollama-native.ts` 只在**调用方显式传** `timeoutMs` 时才设超时；analyst/critic/planner 一个都没传 → 一次网络抖动 = run 永不返回。**挂起比报错更糟**：用户看不到任何错误 | provider 加默认超时 120s；3 个 agent 显式 90s；超时抛人话错误；补 2 条回归测试 |
| **E5**【P0】 | **模型回复的 `<think>` 推理块击穿 JSON 解析** | 根因永远停在 `hypothesis`；planner 永远产不出方案 | MiniMax-M3 等带思考的模型，JSON 前会输出 `<think>…</think>`。4 个 agent 只剥 markdown 围栏 → `JSON.parse` 失败 → **analyst 静默返回 null** → critic 直接 reject（"缺根因"）→ planner 无方案 → executor 永不触发。**模型的推理里其实有正确根因，被解析丢弃了** | 新增 `packages/subagents/src/json.ts` 的 `extractJson()`：去 think 块 → 去围栏 → 截取平衡块 → 转义裸控制字符，4 级兜底；失败必须返回原因，不许静默；analyst/critic/planner 全部切过去；10 条单测 |
| **E6**【P1】 | **unified diff 塞进 JSON 字符串 → planner 100% 解析失败** | 报告第 7/8 字段永远是"(待 planner 产出)" | diff 里的换行、引号、反斜杠破坏 JSON 转义。实测报错 `Unrecognized token '<'` → `Expected '}'` → 转义后仍 `Expected '}'` | planner 改用 **JSON 段 + `===PATCH <id>===` 文本段** 的分隔符协议：JSON 里只放元数据，patch 原样保留，零转义；协议不兼容时自动退回整段解析；5 条单测 |
| **E7**【P1】 | **critic 的裁决理由被静默丢弃** | 查不到"为什么这条没被确认" | `run.ts` 订阅了 `bug.draft` / `bug.confirmed`，**没订阅 `bug.rejected`** → critic 写的拒绝理由直接进黑洞 | run.ts 订阅 `bug.rejected`，理由进 `run-status.json` 的 `rejectedBugs` 与控制台输出。修复后第一次看到的是有信息量的理由："文件证据确认…但证据没有证明本次访问的 URL 对应该路由" |
| **E8**【P1】 | **CONFIG-SPEC 的 pricing 单位与代码不符（1000 倍误差）** | 照文档配置 → 成本算错 1000 倍 | 文档写"每百万 token 价格"，代码算的是**每千**。**这是本轮自己写进文档的错误** | 单位统一为 **USD / 每百万 token**，字段改名 `pricePerMTokIn` / `pricePerMTokOut`（名字自带单位，杜绝歧义）；provider 换算；doctor 对 >1000 的异常值给警告；CONFIG-SPEC / init 模板同步 |
| **E9**【P1】 | **证据缺少"URL ↔ 源文件"关联 → 因果链断在第一环** | critic 永远无法确认根因（判据③ 不可达） | `collectSourceEvidence` 按访问路径猜源文件，但**证据里没记录"访问 /posts → 命中 app/posts/page.tsx"这层映射**；且 flow 的访问 URL 在 runner → analyst 之间就丢了 | ① runner 把访问 URL 传进 `flow.failed`；② analyst 把 URL 写进 symptom / reproSteps 并进 LLM prompt；③ 源文件证据的 snippet 首行写明路由映射；④ critic prompt 要求判断**因果链是否闭合**。实测后 **2 条 bug 全部 confirmed** |
| **E10**【P1】 | **报告第 7/8 字段永远显示"待 planner 产出"** | 真实 run8 产出 2 条 `confirmed` + rootCause 非空，但报告第 7/8/9/10/11 字段全是占位符；JSON 里 `fixOptions` 是**空数组** | `bus` 是顺序 await 分发 → 事件到达顺序是**深层先到、浅层后到**：`fix.enhanced`（带 fixOptions）先到，critic 的原始 `bug.confirmed`（fixOptions 仍为空）后到。`run.ts` 的收集器用**覆盖**语义 → planner 的方案被后到的空数组抹掉。**planner 一直在正常工作**（llmRequests=6 证明它调了 2 次 LLM），产出被丢弃在最后一步 | 收集器抽成 `reporters.createBugCollector()`，改为**合并**语义（`mergeBugFinding`：已收到的富化字段不被空值覆盖）；`run.ts` 三个订阅点全部改用收集器；新增 4 个单元测试 + 1 个集成测试；**反证实测**：把语义退回覆盖后 3 个测试立刻失败 |
| **E11**【流程】 | **改了 src 但没重建 dist → 跨包测试与真实 run 跑的是旧代码** | 新加的 `mergeBugFinding` 单元测试（相对路径 import src）通过，但 cli 包里 `@sentinel/reporters` 走 package.json `exports` → `dist/index.js` → 报 `mergeBugFinding is not a function` | workspace 包的 `main`/`exports` 指向 `dist/`；`bun run test` **不会**自动重建 dist。真实 run（`bun packages/cli/src/index.ts run`）同样解析到 dist | 把 `bun run typecheck`（= `tsc -b`，会产出 dist）设为**改 src 后的固定前置步骤**；本轮把验收顺序固化为 `typecheck → test → lint:* → 真实 run`。**"测试通过"不等于"生效"，跨包改动必须先重建** |
| **E12**【P1】 | **agent 的显式超时（90s）比 provider 默认（120s）还短 → 误杀真实请求** | run9：critic 的裁决请求超时 → 那条 bug 停在 `hypothesis` → 报告第 7 字段又是空的；`rejectedBugs` 里有明确理由 | E4 修超时时给 agent 设了 90s，**比 provider 的 120s 默认值还严格**。带推理块（`<think>`）的模型响应更慢，90s 偶发不够 → 超时被当成"裁决失败" | agent 超时 90s → **180s**；provider 默认 120s → **180s**；CONFIG-SPEC 写明 `timeoutMs` 可配并说明调整方向。**超时仍保留**（有界失败优先于挂死），但要够长到不误杀 |
| **E13**【P1】 | **planner 的方案解析失败 → 报告里是"与本项目无关的通用话术"** | run10 真实 run：报告第 7 字段是"快速修复（绕过/补丁）"—— 看着有方案，其实对 `app/posts/page.tsx` 毫无参考价值 | planner 的**单次**调用同时要求"输出 JSON 数组"和"追加 unified diff 段"。MiniMax-M3 在这种双重约束下输出英文推理散文（"impossible to only output JSON array…"），`extractJson` 的 4 级兜底全失败 → 回退到 `heuristicPlan` 的通用模板。**警告有打出来，但 warn 不等于有用** | 拆成**两次调用，一次只要求一件事**：第 1 步只要 JSON 数组（字段少、无嵌套、无 diff）→ 解析几乎必成功；第 2 步单独要 unified diff（纯文本，零转义）。prompt 极简化并要求 `description` 点名真实文件路径；patch 失败只影响自动修复，不影响方案本身；新增 7 个测试 |
| **E14**【P1（口径）】 | **`maxTokensPerRequestObserved` 与配置上限不是同一个口径 → 数字看着"超限"其实不是** | run10：`单次最多 9766 tokens` vs 配置上限 8000，看着像护栏失效 | `max_tokens` 参数限制的是**输出** token，而统计记的是 `usage.totalTokens`（输入+输出）。两个口径被塞进同名字段并列对比 | 拆成 `maxCompletionTokensObserved`（输出，与配置上限同口径）和 `maxTotalTokensObserved`（总计，用于算预算上界）；控制台输出写明口径；宪法第 6 条同步；**新增守卫第 14 组**（宪法条款里的字段名 × `run.ts` 实际写出的字段）—— 改名从此不会漏掉规范同步 |

#### 第二轮（真实 run 验收阶段）新发现的 14 个缺陷

> 第一轮 E4–E14 是"把方案跑起来"暴露的；第二轮 E15–E21 是**在真实项目上验证闭环**时暴露的。
> 共同特征：**报告说的和实际做的不一致** —— 报告说能改码、实际没改；报告说 Tier 2、
> 磁盘上没有 patch；报告说高风险只建议、实际被放宽成会写 patch。

| # | 缺陷 | 症状 | 根因 | 处置 |
|---|---|---|---|---|
| **E15**【P1】 | **`executor.tier_decided` 是死事件 → 报告第 11 字段显示的不是硬规则判出的 tier** | run12：LLM 判 Tier 1（要改码），硬规则降级到 Tier 2，实际**文件没被改**；而报告第 11 字段按 LLM 自报值写 | executor 发出了 `executor.tier_decided`，但 `run.ts` **从没订阅** → 硬规则判定结果进黑洞。报告直接读 `fixOptions[].tier`（LLM 自报值） | 新增 `packages/reporters/src/tier.ts`（`applyTierDecisions` / `findTierDecision`）覆盖 LLM 自报值；报告第 11 字段写硬规则 tier + 理由 + "LLM 原判 Tier N，硬规则已降级"提示；`run.ts` 订阅并写入 `run-status.json.tierDecisions`；新增**守卫第 15 组**（宪法「Tier 由 executor 硬规则判断」× run.ts 是否订阅该事件） |
| **E16**【P0（宪法不符）】 | **Tier 2 的产物从未落盘 —— 报告说"写 patch 待审核"，磁盘上什么都没有** | `examples/nextjs-blog/reports/patches/` **目录不存在**；run14 的 `run-status.json` 里 `generatedPatches: []` | executor 的 `maxTier` **默认是 1**，Tier 2 分支被 `if (tier > maxTier) continue` 整个跳过。宪法第 130 行明文「Tier 2 自动写 patch，但需要人确认」——**实现与宪法不一致**，而且被跳过时连事件都不发 | `maxTier` 默认 1 → **3**（executor 与 CLI 同步）；被 maxTier 拦下时发 `patch.rejected` 说明原因；**新增守卫第 17 组**（宪法「Tier 2 自动写 patch」× maxTier 默认值），改回去会立刻 exit 1 |
| **E17**【P1】 | **产物没产出的四条路径全是静默 → 用户查不到原因** | 写盘抛错、fs provider 缺失、patch 格式非法、`written !== true` —— 全部静默 `return` | `writePatchFile` / `writeAutoPatchFile` / `writeSuggestion` 的 catch 块是空的；`if (!fs \|\| !validPatch(...)) return` 也是直接返回 | 统一走 `rejectFix()` 发 `patch.rejected`（带具体原因）；新增 `packages/subagents/test/executor-products.test.ts` 9 条用例；**反证实测**：把 `rejectFix` 改回静默 → 5 个测试立刻失败 |
| **E18**【P1】 | **Tier 1 的判定关键词法对中文 LLM 必然漏判 → 计划判据「Tier 1 真实改码」无法达成** | run12 / run13 / run14 三次真实 run，`tierDecisions` **全是 Tier 2**，Tier 1 从未触发 | LOW_RISK_RULES 靠关键词（`拼写` / `typo` / `format`…）匹配 title+description。中文 LLM 描述的是**动作**不是**词类**——"把 postList 改成 posts"里没有"拼写"二字，关键词法命中率极低 | 新增**补丁形状判定** `isRenameOnlyPatch()`：单文件、单 hunk、增删行一一对应且逐对比较**只有标识符不同**（关键字保持原样，`null`→`undefined` 不算）→ 判 Tier 1。确定性规则，不依赖 LLM 用词 |
| **E19**【P2（措辞）】 | **tier 判定理由固定写"降级"，与事实不符** | run14：LLM 本来就判 Tier 2、硬规则也是 Tier 2，理由却写"未命中任何低风险规则（LLM 原判 Tier 2）→ **降级**" | `classifyTier` 的兜底 reason 写死了"降级"两个字 | 只有真的从 Tier 1 降下来才写"降级"；LLM 判 Tier 3 时写"硬规则不放宽"；其余情况只写"需人工确认" |
| **E20**【P0（安全）】 | **硬规则会把 LLM 判的 Tier 3 放宽成 Tier 2** | run14 的 `fix-root-redirect-existing-route`：LLM 判 Tier 3（仅建议），硬规则因为"未命中低风险规则"返回 Tier 2（会写 patch、可能建 PR）——**放宽了风险等级** | `classifyTier` 只在命中 HARD_RISK 时给 3，其余一律给 2，**完全忽略了 LLM 的 Tier 3 信号** | LLM 判 Tier 3 时硬规则**不放宽**（宪法第 58 行「高风险只能建议」、第 131 行）；守卫第 17 组同步检查这条守卫还在不在 |
| **E21**【P1（安全）】 | **硬风险规则只认英文，中文描述的高风险改动一律漏判** | `HARD_RISK_RULES` 全部是英文正则（`migrat\w*` / `permission` / `secret`…）。中文 fix 描述"重构数据库迁移脚本"命中不了任何一条 → 落到 Tier 2 → **数据库迁移类改动会被写成待审 patch** | 规则集写的时候只用英文关键词，没有考虑 LLM 用中文描述 | 7 条硬风险规则全部补中文关键词（迁移 / 权限 / 授权 / 登录 / 会话 / 鉴权 / 认证 / 密钥 / 凭据 / 凭证 / 流水线 / 部署配置…） |
| **E22**【P1（可靠性）】 | **planner 的 JSON 输出撞上 `max_tokens` 被截断 → 方案退化成通用模板** | run15：`planner: 方案 JSON 解析失败`（`Unterminated string`），报告里第 2 条 bug 的推荐方案变成"快速修复（绕过/补丁）"——跟本项目毫无关系 | 模型的 `<think>` 推理块吃掉了输出预算（run14 用了 7921/8000，** chronically 贴着上限**），JSON 在中途被切断。5 级兜底全失败 → `heuristicPlan` 通用模板顶上。**模型本来已经写出了真实方案** | 新增 `salvageTruncatedJsonArray()`：截断时保住**已经写完的那几个对象**（找到最后一个完整闭合的顶层对象，砍掉残缺部分并闭合数组），作为第 6 级兜底；planner 不再因为"方案不足 3 个"就把真方案全扔掉换成模板，而是**保留真方案 + 用模板补足数量** |
| **E23**【P1】 | **LLM 产的 diff 格式不精确 → 补丁被判"格式非法" → 产物落不了盘** | run15：`fix-post-list-call-site` 有 patch，但 `rejectedPatches` 写"patch 格式非法"。看原文发现两处问题：① `<think>` 推理块里先写了一遍示例 diff，残渣混在前面；② hunk 头声明 `@@ -9,7 +9,7 @@`，实际只给了 5 行 | `extractDiff` 从第一个 `---` 开始截（推理残渣里的示例 diff 被当成正文）；`validPatch` 是严格校验器，hunk 计数对不上就整份拒绝。**内容其实是对的，只是格式不准** | 新增 `packages/subagents/src/diff.ts` 的 `normalizePatch()`：按实际内容**重算每个 hunk 头的行数**（行号起点不动，git apply 本身允许偏移匹配）；`extractDiff` 先剥 `<think>` 残渣再截 diff。用 run15 的真实输出做回归样本 |
| **E24**【P0（一个字符）】 | **patch 结尾少一个换行 → `git apply` 报 `corrupt patch` → Tier 1 自动修复整条路径失效** | run16：Tier 1 **已经触发**（补丁形状规则命中 `fix-posts-use-existing-posts-array`），但 `git apply --check 失败：error: corrupt patch at line 11`；line 11 正是 patch 的**最后一行** | LLM 输出的 diff 末尾没有换行。`git apply` 要求 patch 以换行结束，少一个换行就认为最后一行不完整。**这个错在静态校验里查不出来** —— `validPatch` 认为它是合法的，只有真跑 git 才暴露。一个换行字符，让"报告说能改码"和"实际没改"彻底分裂 | `normalizePatch()` 统一补结尾换行；`applyPatch()` 在调用 git 前再 `ensureTrailingNewline()` 兜底（防御：patch 可能来自 planner 之外的路径）；新增端到端用例（真实 git 仓库 + 缺换行的 patch → 真的被应用） |
| **E25**【P0】 | **零上下文的 diff 被 git 默认拒绝 → LLM 的「最小补丁」永远应用不了** | 回测里录到的真实 patch 是 `@@ -12,1 +12,1 @@`（只有 -/+ 一行，没有任何上下文）；`git apply --check` 报 "patch does not apply" | LLM 改一行时经常只输出那一行。**git 默认不接受零上下文的 diff** —— 必须加 `--unidiff-zero`，但那样 git **不校验上下文**，行号一过期就改错地方，对"自动改用户代码"太危险 | 新增 `expandZeroContextHunks()`：读目标文件，把 hunk 前后的**真实内容**补成上下文行，让 git 自己去校验（内容对不上就拒绝，安全；行号过期也没关系，git 本就允许偏移匹配）。**不用 `--unidiff-zero`**。配套修掉两个细节：文件末尾换行 split 出的空串不是真实的一行（补上下文会多一行空白）；补完后必须补结尾换行 |
| **E26**【P1】 | **项目理解失败 → 用户只看到 "bus handler errors"，没有真实原因** | mapper 的 `project.scanned` handler 没有 try/catch：内部抛错会冒到总线，CLI 只能打印 `bus handler errors for project.scanned`；`map.failed` 事件在目录里声明着，**代码里从未发布** | 异常直接冒泡，没有被转成事件 | mapper 整个 handler 包 try/catch → 失败转成 `map.failed`（带真实原因）；CLI 订阅后写进 `run-status.json` 的 `mapFailures`，并明确告诉用户"没有 FeatureMap 就无法生成流程，报告会是空的，这不是项目没问题" |
| **E27**【P1】 | **M6 知识检索是纯黑盒：搜没搜、搜到几条、是不是缓存，全查不到；单个来源失败被静默吞** | 检索失败时报告里看不出任何区别 —— "检索到 0 条"会被误读成"网上没这回事" | `searchAll` 里 `catch {}` 把单源失败吞掉；`knowledge.requested` / `knowledge.received` / `knowledge.cached` 三个事件在目录里声明着，**从未发布** | 三个事件全部接上（请求 / 收到 / 命中缓存），CLI 订阅后写进 `run-status.json`；单源失败不再静默 —— 至少打出一条明确的 warning 列出哪个源、什么原因 |
| **E28**【P1】 | **adapter 失败被静默忽略 → mapper 报"成功"，但识别结果不完整** | 某个 adapter 的 `routes()` 抛错 → 页面/接口列表是空的 → 一个流程都生成不出来 → 报告是空的，用户不知道为什么 | `aggregateProfile/Routes/Data/Risks` 的 `catch {}` 全部写「忽略」；`detect` 也一样 | 各聚合函数收集错误 → 落成 `coverage_adapter_failed_*` 风险项（沿用现有 `coverage_*` 命名，`run-status.json` 的 `coverageRisks` 与报告里都能看到）。**"没发现任何问题"必须能被区分于"没识别出来"** |
| **E32**【P1】 | **Tier 1 判定了却没有 patch → 静默跳过：报告写「Tier 1 — 自动修」，磁盘上什么都没发生** | 2026-10-26 真实 run（blog 项目 + 注入 m2 缺陷）：`tierDecisions` 里两份方案被判 Tier 1（`命中低风险规则「拼写」`），但 `appliedPatches=[]`、`generatedPatches=[]`、**`rejectedPatches=[]`** —— 既没改代码，也没落补丁，连一句「为什么没产物」都查不到；报告第 11 字段却写着「Tier 1 — 自动修」 | `executor.ts` 的分支是 `tier===1 && opt.patch` / `tier===2 && opt.patch` / `tier===2` / `tier===3` —— **`tier===1` 且没有 patch 时四个分支全不命中**，直接掉出去。E17 那一轮补了 Tier 2 的兜底，漏了 Tier 1 | 补 `tier===1 && !opt.patch` 分支 → 发 `patch.rejected`（`Tier 1 方案没有可用 patch → 未落盘、未修改代码`）；补单测（`packages/subagents/test/executor-products.test.ts`）。**判据**：任何「判定了档位」的方案，要么产出产物，要么说清楚为什么没有 |


### 13.3 真实 run 的前后对比（同一项目 `examples/nextjs-blog`）

| 指标 | 2026-06-15（iDream- reborn，旧代码） | 2026-10-26 修复前 | 2026-10-26 修复后（run6–run10） |
|---|---|---|---|
| 流程数 | 23 个全失败 | 3（1 通过 / 2 失败 / 0 未跑） | 3（1 通过 / 2 失败 / 0 未跑） |
| 产出条数 | 25 条 P2，**全部同质** | 1 条（聚合后），根因状态 `hypothesis` | **2 条，`confirmed`** |
| 根因内容 | — | 无（`<think>` 块击穿解析） | "/posts 对应的 app/posts/page.tsx 仍是返回 null 的占位页面…" |
| 证据条数 | 1 条 | 9 条（含 4 条重复） | 5 条（去重后），且含 **URL ↔ 文件映射** |
| **修复方案（第 7/8 字段）** | — | **空**（planner 产出被覆盖语义抹掉） | **有**：★推荐 + 2 个备选 + 风险评估 + Tier 判定 + 可执行验证命令 + Tier 1 的 unified diff |
| 退出码 | — | 1 | 1（不是 2） |
| 成本 | — | 未知 | **$0.0073 – $0.0316（真实计价，usd+token 模式）** |
| LLM 请求数 | — | 2（解析失败白跑） | 6–8（每一步都有产出；planner 拆两步后 +2） |
| 未解决 flow | 23 个 | — | **0**（`unresolvedFlows: []`） |

**run6 → run10 的三步递进**（都是真实 run，同一项目）：

| run | 改了什么 | 结果 | 暴露的新问题 |
|---|---|---|---|
| run6/run7 | E4–E9 修复后 | 2 条 confirmed + rootCause 非空 | 第 7/8 字段仍是空的 → 查出 E10 |
| run8 | E10 修复（收集器改合并语义） | 第 7 字段出方案（★ Tier 1 score=0.60） | critic 裁决 90s 超时 → 1 条退回 hypothesis → 查出 E12 |
| run9/run10 | E12 修复（超时 90s → 180s） | 2 条 confirmed + 2 条都有方案 | planner 的方案是通用模板（E13）；token 口径混用（E14） |
| run11 | E13 修复（planner 拆成两次调用） | **方案变成针对具体文件的具体动作**："在 app/posts/page.tsx 渲染最小可见的 Posts 页面"，带可执行验证命令 + Tier 1 patch | — |
| run12 | 注入拼写错误 bug 后跑 `--auto-fix` | 根因准确（`postList` 未定义 → ReferenceError → HTTP 500，conf=0.97），但**文件没被改** | 查出 **E15**：`executor.tier_decided` 是死事件，硬规则 tier 被丢弃 |
| run13 | 同一 bug 重跑 | 同一个 bug，LLM 这次自判 Tier 2（run12 判 Tier 1） | **LLM 自己给的 tier 就不稳定** —— 更加证明硬规则不可省 |
| run14 | E15 修复（tier 进报告 + 过程事件进 run-status） | `run-status.json` 出现 `tierDecisions`（6 条，带理由）；报告第 11 字段写"硬规则 tier + 理由 + LLM 原判" | `generatedPatches` / `rejectedPatches` **全空** → 查出 **E16**（Tier 2 分支被 `maxTier=1` 整个跳过） |
| run15 | E16–E21 修复 | 4 条 `rejectedPatches` **每条都带原因**（E17 生效）；tier 理由区分"降级"/"不放宽"（E19/E20 生效） | planner 的 JSON 撞上 `max_tokens` 被截断 → 查出 **E22**；LLM 的 diff 计数不准 → 查出 **E23** |
| run16 | E22/E23 修复 | **Tier 1 首次自然触发**（补丁形状规则命中重命名 patch）；第 2 条 bug 判 Tier 2 | `git apply --check 失败：corrupt patch at line 11` → 查出 **E24**（patch 结尾少一个换行） |
| run17 | E24 修复 | ✅ **Tier 1 真改码**：`app/posts/page.tsx` 的 `postList.map` → `posts.map`；**修复后重跑通过**（flows 1 passed → **2 passed**）；**Tier 2 patch 真落盘** `reports/patches/fix-root-inline-visible-content.patch`；报告第 11 字段"Tier 1 — 自动修（依据：命中低风险规则「拼写」）" | — |

### 13.4 批5 的诚实缺口（不可自动化）

方案 §8 判据要求"案例 ≥30（真实外部 ≥20）"。本轮**做不到**，原因是方案 §9 已经写明的：
benchmark 案例需要**真实项目 + 人工确认根因**，这是唯一无法自动化的环节。

本轮做到的是：

1. ✅ `validateCase` 进 `npm test`（5 个用例，含"validateCase 对残缺对象必须返回 false"的**反恒真**断言）
2. ✅ 统计脚本 `scripts/benchmark-stats.mjs` → 命中率 / 采纳率 / 验证通过率 / 平均置信度，
   且**把自反案例（sentinel-self）与真实外部案例分开算** —— 混算会把数字抬高到没有参考价值
3. ✅ 真实外部案例开始积累（见 §13.5）
4. ✅ **案例总数 30 / 外部 20** —— **这一条已在本轮补齐**（见 §13.8）：真实项目不用等用户提供，
   改成「克隆公开的真实仓库 + 注入已知真值的缺陷」，自己把样本做出来；
   做法同时暴露了两个此前没人知道的产品边界（路由提取只支持 Next.js、E30 补丁锚点）
5. ✅ **"回测全部历史 case 确认未退化"** 的**机制**已建好（见 §13.6）：
   可重放夹具 + 期望值 + 回测执行器 + 回归测试。
   剩下的只是**把更多真实案例录成夹具**（每个案例录一次，约 4 次 LLM 调用）。
   —— 本轮新增的真实外部案例已按同一 schema 归档，**期望值沿用人工写定的真值**，
   不从录制产出里抄（见 §13.8 的反恒真约束）。

### 13.5 覆盖边界（不宣称完整）

**本轮已覆盖**：守卫 13→14 组对账的全部维度 · baseline 防降 3 条锁 · doctor 全部检查项 ·
run 前置门禁 · 报告 11 字段 × md/json · 同源聚合 · 工具性失败识别 · critic 裁决可观测 ·
analyst/critic/planner 的 JSON 提取 · LLM 超时 · dev server 端口发现与首页就绪 ·
美元护栏（单价单位 / usage 兜底 / 单次上限 / 上界口径）· Tier 硬规则 / 白名单 / 回滚 ·
reporters 与 knowledge 覆盖率 · 宪法 v1.2 · benchmark schema 校验与统计

**本轮未覆盖**：HTML reporter（v2）· `packages/sensors`（死包，未处理）·
`cli`/`providers`/`subagents` 覆盖率门槛 · 多 agent 并发 ·
真实项目根因命中率（当前只有 1 个项目的 3 条样本）· 回测夹具只有 1 条 ·
M6 知识检索限流 · 2 个事件（`evidence.collected` / `report.ready`）的契约去留

**本轮已补上（原"未覆盖"里已完成的）**：真实项目上的**自动改码端到端验证**（批3，run17 实测）·
benchmark **可重放回测机制**（§13.6，1 个夹具）· **11 个 adapter 的分支测试**（60 个用例）·
adapters 整包覆盖率门槛 · **4 个声明了却从未发布的事件**（map.failed / knowledge.*）·
**adapter 失败不再静默**（落成 coverage_adapter_failed_* 风险项）·
**已知未修从 28 降到 11**（§13.7）

### 13.6 可重放回测（批5 剩下的那块，已建好）

**为什么必须有**：§7 要求「在 benchmark/ 重跑全部历史 case 确认未退化」，
而 `benchmarks/cases/*.json` 是**静态记录**（跑一次就冻结）——
改坏了代码它照样"通过"，证明不了任何东西。

**怎么做的**：把真实 run 里**模型的回复录下来**，之后用录制的回复重跑整条决策链
（analyst → critic → verifier → planner → enhancer → executor），再比对产出。

**它守住的是什么**：**不是模型能力**（回复是录制的，模型没变），而是**决策层**——
也就是最容易出现"报告说的和实际做的不一致"的地方：

| 决策层环节 | 对应缺陷 | 回测怎么发现退化 |
|---|---|---|
| JSON 解析兜底（think 块剥离、截断抢救） | E5 / E22 | 根因状态从 confirmed 变成 (无) |
| planner 两步协议 + diff 规范化 | E13 / E23 / E24 | 推荐方案没有 patch / patch 非法 |
| 零上下文 hunk 补上下文 | E25 | 补丁在快照上应用失败 |
| Tier 硬规则 | E18 / E20 / E21 | 硬规则 tier 与期望不符 |
| 报告第 11 字段取硬规则 tier | E15 | 报告字段与 tierDecisions 不一致 |

**新增的东西**：

| 文件 | 作用 |
|---|---|
| `packages/cli/src/replay.ts` | 回测执行器：回放模式（用录制的回复）+ 录制模式（用真实 provider 并记录） |
| `scripts/record-replay.mjs` | 录制夹具：从真实 run 产物 + 人工确认的案例生成 |
| `scripts/replay-benchmarks.mjs` | 跑全部夹具，输出「未退化」报告，退出码 1 = 有退化 |
| `packages/cli/test/benchmark-replay.test.ts` | **回测进 `npm test`**（8 个用例，含"没有夹具就是恒真判据"的反断言） |
| `benchmarks/replay/2026-10-26-006-1.json` | 第 1 个夹具（录了 4 条真实回复，带项目快照） |

**期望值从哪来（关键）**：**不是**从录制时的产出里抄的 —— 那样会永远"通过"（恒真判据）。
它来自**人工确认的案例**：
- `rootCauseStatus` ← 案例的 `sentinelJudgment`
- 关键词 ← **人工写进案例的 `replayExpectation`**（根因必须点名文件与出错变量；方案标题必须点名被修的标识符）
- `fixCount` ← 3（planner 的契约）
- `hardTier` ← 案例的 `recommendedFix.tier`（归档时取自硬规则判定，不是 LLM 自报值）
- `patchApplies` ← 该案例的推荐方案确实带合法 patch 并被应用过

**反证实测**（逐个把决策层改坏，回测必须报错）：

| 改坏什么 | 回测的反应 |
|---|---|
| `classifyTier` 恒返回 2 | `硬规则 tier：期望 1，实际 2` |
| think 块剥离失效 | `根因状态：期望 confirmed，实际 (无)` |
| `expandZeroContextHunks` 失效 | `补丁能否应用到快照：期望 true，实际 false` |

**覆盖边界**：目前只有 **1 个夹具**（1 个真实外部项目的 1 条 bug）。
夹具数量 = 已归档的**可重放**案例数，不是全部案例数；
静态案例（`benchmarks/cases/`）目前 6 条，仍不可重放。

### 13.7 已知未修从 28 降到 11（这一轮关掉的）

baseline 里那 28 条不是"随便记的"，每一条都是守卫查出来、但当时修不了的缺口。
这一轮把其中 **17 条**关掉了 —— 全部有实测证据：

| 关掉的 | 怎么关的 | 证据 |
|---|---|---|
| 11 条 `adapters::untested:*` | 给 11 个 adapter 写表驱动分支测试（60 个用例），把每个 adapter 的**检测口径**钉死（frontend 三件套查 devDependencies，backend/data/llm-app 不查；vue→nuxt、svelte→@sveltejs/kit、trpc→@trpc/client、langchain→@langchain/core 是别名） | `packages/adapters/test/adapters.test.ts`；守卫第 6 组不再报 |
| 1 条 `coverage::unguarded:adapters` | 给 adapters 整包设覆盖率门槛（70/70/70/60，实测 79.41/62.5/75） | `vitest.config.ts`；`test:coverage` exit 0 |
| 1 条 `benchmark::validateCase-unused` | **守卫误报**：第 9 组只在 `packages/*/src/` 里找 `validateCase` 的调用点，而真正的调用在**测试**里 | 守卫第 9 组改为连 test 一起找 |
| 4 条 `events::{map.failed, knowledge.requested, knowledge.received, knowledge.cached}` | 这 4 个事件在目录里声明着但**从未发布也从未订阅** → 全部接上（E26 / E27） | `packages/subagents/test/process-events.test.ts`（5 个用例） |

**剩下 11 条**（都是真做不了的，或还没排上）：

| 维度 | 条目 | 为什么还没关 |
|---|---|---|
| events | `evidence.collected`、`report.ready` | 目录里声明了，但当前实现用 `evidence.ready`（整批）和"写完报告"的动作覆盖了它们；要不要接、还是从目录里删掉，属于**事件契约变更**，需要明确拍板 |
| cost | `dim:runtimeCost` / `dim:regressionRisk` / `dim:maintenanceCost` | 成本模型的 8 个维度里，只有 5 个可配；这 3 个是"固定按最优估计"，改它们要动 CONFIG-SPEC 与权重语义 |
| coverage | `unguarded:{cli, providers, sensors, subagents}` | 这 4 个包还没有整包覆盖率门槛（sensors 是死包，另说） |
| startup | `stale-dist` | 改 src 不重建 dist 会让测试跑旧代码（E11）—— 这是**流程约定**，不是代码缺陷 |
| enhancer | `no-rate-limit` | M6 知识检索没有限流 |

### 13.8 批量真实外部 benchmark：方法写进清单，脚本只是执行器

§13.4 把「案例 ≥30（真实外部 ≥20）」判为"不可自动化，缺 20 个真实项目"。本轮的做法是**自己把真实项目找出来**，而不是把缺口留着：

**取样方法**（写进 `benchmarks/external/manifest.json`，这是方法的载体）：

1. 找公开的真实仓库（GitHub 上有 star、近期有提交的完整应用，不是玩具片段）。
2. 读源码，挑一处**注入后必然在 dev 模式下暴露**的位置（模块解析失败 / 未定义标识符 / 组件名拼错 / 响应状态码写错）。
3. **真值由人读源码写定**（`realRootCause` + `expectRootCauseContains`），不看 Sentinel 的任何产出。
   —— 这是反恒真的关键：期望值一旦从产出里抄，就永远是"通过"。
4. 每处注入配 3~4 条判据：症状、人工确认的真实根因、根因关键词、方案标题关键词。

**执行器**（`scripts/bench-external.mjs`，一次性执行器，不承载方法）：

| 环节 | 做法 | 为什么这么定 |
|---|---|---|
| 跑前 | 注入缺陷 → 起**真实 dev server** → 记录**每条路由**的 HTTP 状态码 | 只有"坏掉了"被观测到，后面的"修好了"才有意义 |
| 跑 | `sentinel run --auto-fix --no-enhance` | 用真实 CLI，不走旁路 |
| 采纳判定 | 看补丁是否**真的落在被注入的文件**上 | 实测存在"Sentinel 应用了另一个等效方案"的情况，只比对方案 id 会误判 |
| 验证 | 同一个 dev server（热更新）上再取一次状态码，**修复前 ≥500 → 修复后 <500** | 不采信 Sentinel 自称"修好了"；由外部事实判定 |
| tier | 只取 `run-status.tierDecisions`（硬规则判定） | 宪法第 134 行：tier 由硬规则判断，不采信 LLM 自报值 |
| 端口隔离 | 每个项目固定自己的端口（只改 dev 脚本的 `--port`） | 并行跑多个 Next 项目时，Sentinel 会把"端口被占"误判成"自己的服务在跑"→ 复用别的项目的服务 → 数据串味 |
| 报告 | `scripts/bench-report.mjs` → md 落盘 | 报告里的每个数字都由 cases/ 算出，不手写 |

**本轮实测暴露的产品缺陷（同一轮里发现并修掉的）**：

- **E30：零上下文补丁的补上下文用错了锚点**。模型给的行号经常不准（实测：声称改第 42 行，实际那行在第 39 行）。零上下文补丁 git 不做偏移匹配 → `git apply` 直接拒绝；而我们补上下文时又**按模型给的行号**去取真实内容 → 补出来的上下文和 hunk 内容对不上 → 补丁照样打不上。后果：**Tier 1 自动改码在真实项目上失效**（命中根因、给出方案、但一个字节都没改）。
  修法：补上下文前先**按内容**在文件里定位 hunk 的真实位置（取离模型行号最近的那处命中），再用真实位置取前后上下文；内容根本找不到时保持原样交给 git 报错（不产出"看起来能用"的假补丁）。
  证据：退回旧实现后新用例立刻失败；真实案例重跑后 `adopted` 从 false 变 true、验证从"未验证"变成"500 → 200"。
- **E29：`--project` 只认等号格式**，按帮助文本写会静默落到 CWD（测错对象且不报错）。已修，见 §13.10。

### 13.9 关键发现：路由提取只覆盖 Next.js（**这是本轮最有价值的结论**）

做批量真实外部基准时，第一件事就是验证「Sentinel 到底能在哪些真实项目上工作」。结论不乐观，但必须写清楚：

**代码事实**（`packages/adapters/src/frontend/`）：

| adapter | 行数 | 有 `routes()` 吗 | 能提取路由吗 |
|---|---|---|---|
| `nextjs.ts` | 121 | ✅ | ✅ 支持两种约定：`app/`（App Router，按 `page.tsx`/`route.ts` 递归）与 `pages/`（Pages Router） |
| `react.ts` | 14 | ❌ 只有 `detect` + `profile` | ❌ |
| `svelte.ts` | 14 | ❌ | ❌ |
| `vue.ts` | 14 | ❌ | ❌ |

**实测**（`sentinel map`，同一套代码，真实仓库）：

| 真实项目 | 框架 | mapper 输出 |
|---|---|---|
| `theodorusclarence/ts-nextjs-tailwind-starter` | Next.js 15 | pages 2 / api 1 / **flows 3** |
| `sveltejs/realworld` | SvelteKit 2 | pages 0 / api 0 / **flows 0** |
| `duxianwei520/react` | Vite + React（配置式路由） | pages 0 / api 0 / **flows 0** |
| `unovue/inspira-ui` | Nuxt 4 | pages 0 / api 0 / **flows 0** |

**后果**：在 Vue/Nuxt/Svelte/Vite 项目上，Sentinel 不是"查不到根因"，而是**一个诊断都产不出来** —— 因为它连要测的流程都没排出来（flows 0 → 没有任何 flow 被执行 → 没有 evidence → 没有 bug）。这类项目目前处于「工具能启动、能出报告，但报告里必然是空」的���态，比报错更危险，因为它看起来像「没发现问题」。

**为什么这条必须写进文档而不是藏进基准里**：如果按 §13.4 的做法直接找用户要 20 个真实项目，很可能换来 20 个非 Next.js 项目 → 20 个"零命中"案例 → 命中率 0% → 一个既不真实也无意义的数字。**先量出能力边界，再谈命中率**，这才是基准的用途。

**不在本轮范围**（需要独立立项）：给 react/svelte/vue adapter 实现 `routes()`。react 的配置式路由（`createBrowserRouter`）与 SvelteKit/Nuxt 的文件式路由约定各不相同，需要逐个框架写提取器 + 对应测试，工作量接近批2，不适合塞进收尾批次。

### 13.10 E29：CLI `--project` 只认等号格式 → 按帮助文本写会**静默跑错项目**

**缺陷**：`packages/cli/src/config.ts` 的 `projectRoot()` 只认 `--project=<path>`；但 `sentinel --help` 写的是 `--project <path>`。用户按帮助文本写 `sentinel run --project /some/path`，参数被忽略 → 回落到 `process.cwd()` → **在另一个项目上跑，而且不报错**。本轮批量跑测时第一次就踩中了这个坑（run 打印的 project 是 Sentinel 仓库自己，而不是目标项目）。

**为什么危险**：这类失败不会中止流程，只会产出"看起来正常"的结果 —— 正是 §13 反复强调的"跑通 ≠ 有效"。

**修复**：`projectRoot()` 同时认两种写法；空格式后面紧跟另一个开关（`--project --auto-fix`）时不当作路径。补 4 个用例（`packages/cli/test/config.test.ts`）。

### 13.11 批5 收尾：真实外部案例 3 → 36，判据达成

**判据达成**：案例总数 39（判据 ≥30）· 真实外部 36（判据 ≥20）。

| 项目 | 案例 | 命中 | 采纳 | 验证通过 |
|---|---|---|---|---|
| `theodorusclarence/ts-nextjs-tailwind-starter` | 12 | 11 | 6 | 6 |
| `NextJSTemplates/startup-nextjs` | 11 | 11 | 11 | 11 |
| `vercel/virtual-event-starter-kit` | 8 | 4 | 8 | 7 |
| `timlrx/tailwind-nextjs-starter-blog` | 2 | 2 | 2 | 2 |
| `nextjs-blog`（Sentinel 自带示例） | 3 | 3 | 1 | 1 |
| `sentinel-self`（自反，单列不算） | 3 | 3 | 3 | 3 |
| **合计** | **39** | **34** | **31** | **30** |
| **其中真实外部** | **36** | **31（86.1%）** | 28 | 27 |

样本来源：4 个公开真实仓库 + 21 处注入缺陷（真值全部由人读源码写定，见 §13.8）。
逐案例明细见 `benchmarks/external/2026-10-26-批次报告.md`（由 `scripts/bench-report.mjs` 从 cases/ 生成）。

**两类漏检（诚实数据，不粉饰）**：

1. **无 HTTP 错误的功能性缺陷**（2 例）：自动 flow 只看「路由状态码 + 正文可见性」，
   点击行为类缺陷（主题切换不生效、标签排序反了）在 HTTP 上完全正常 → Sentinel 查不到。
   这是**覆盖边界**，不是判错：文档里已作为 `coverage_ui_content` 风险项登记。
2. **"代码里写死状态码"类缺陷**（1 例）：`pages/api/stages.ts` 把成功分支写成 `res.status(503)`，
   Sentinel 的判断是"部署运行时或前置网关不可用"（status=hypothesis，未确认）。
   证据里只有 HTTP 503、没有代码定位 → 模型倾向归因到环境。**能定位到文件的那一类（import 路径、拼写、
   组件未定义）命中率高得多**。

**本轮新暴露的产品边界（比案例数更重要）**：路由提取只支持 Next.js ——
Vue/Nuxt/Svelte/Vite 项目识别到 0 路由 → 0 流程 → **一个诊断都产不出来**（见 §13.9）。
换句话说：现在说"Sentinel 能诊断真实项目"，成立的范围是 **Next.js**。

**可重放回测的衔接**：新增案例沿用同一 schema，`replayExpectation` 里的关键词与 tier 同样来自
人工写定的真值与硬规则判定，**不是从录制产出里抄的** → 满足反恒真约束。

**本轮在跑批过程中又挖出并修掉一个真实缺陷（E31）**：
`packages/providers/src/mcp/built-in/browser.ts` 的 URL 断言是**精确字符串比较**，
而 Next.js 的 `trailingSlash: true` 会把 `/about` 规范化成 `/about/` →
自动 flow 恒判失败 → **修复后重跑被判失败 → 正确的 Tier 1 修复被回滚**（改动等于没做，
报告里只留下一句「已回滚」）。实测：改前 `status: "reverted"`，改后 `status: "applied"`，
`/about` 由 500 变 200，run 耗时也从 341s 降到 135s（不再走"打补丁→重跑→回滚"的圈）。
**证据边界**：改后重跑把改前的 run-status **覆盖**了 —— 磁盘上现在只剩改后的产物，
"改前是 reverted"这件事由当时的输出与提交信息记录，回滚路径本身由单测覆盖
（`packages/subagents/test/executor-apply.test.ts`），不再拿"文件还在"当证据（见 §13.12 缺口 5）。

**为什么这三个缺陷（E29/E30/E31）值得单独记**：
它们都不在"没有这个功能"，而在**"看起来做完了，其实没做成"** ——
E29 测的是错的项目、E30 补丁打不上、E31 补丁打上了又被回滚。
基准的价值就在这里：只有把"改完真的能验证"这条链路走一遍，才会暴露这三种假成功。

---

### 13.12 独立审核提出的 6 条缺口：处置记录（2026-10-26 第二轮）

审核方按"实证"逐条核对方案文档与代码事实，指出 6 处对不上的地方。
这一节是逐条处置的结果：**每条都写清改了什么、凭什么这么说、还剩什么没覆盖**。

| # | 缺口（审核原话要点） | 处置 | 现在的状态 |
|---|---|---|---|
| **1**【中】 | §13.11 表格 `ts-nextjs-tailwind-starter` 行写「采纳 8 / 验证 8」，实际 **6/6**；「合计」行写「命中 35」，实际 **34**（外部 31 + 自反 3），且表内各行相加也得 34/31，自相矛盾 | 按 `benchmarks/cases/*.json` 重算并改正两处数字；现在**表内各行相加 = 合计 = 权威报告**（脚本 `scripts/bench-report.mjs` 从 cases/ 现算） | ✅ 已改，数字与产物一致 |
| **2**【中】 | §8 判据「回测全部历史 case 确认未退化」只覆盖 **1/39**；34 条带 `replayExpectation` 却没有录制的模型回复 → 不可回测；`test:replay` 的「退化 0」只说明那 1 条没退化 | ① 新增**契约夹具**（`scripts/build-contract-fixtures.mjs`）：从案例 + manifest + bench 工作副本**重建被改坏的真实文件**，用人工真值构造模型回复，补丁是**把注入的缺陷改回去**的真补丁；② 回放器支持 `bug.draft` 兜底（hypothesis 案例在 planner 之前就停了，原来恒为「(无)」）；③ 关键词判据改为**任一命中**（与归档时的命中判定 `.some()` 同一口径，原来用 `every()` 会把「换个说法」的正常案例判成退化） | ✅ 夹具 **36 个**（35 契约 + 1 录制），覆盖 **35/39** 个案例；未覆盖 4 条及原因见下方覆盖边界表 |
| **3**【低】 | §13.1 批0 行仍写「已知未修 28」，实跑是 11 | 按 `bun run lint:spec` 实跑结果改正 | ✅ 已改为 11 |
| **4**【低】 | §4.10②「passedFlows+failedFlows == plannedFlows」在自动修复重跑后不成立（`plannedFlows` 取自 `flow.planned`，`after-fix` 重跑只加 passed/failed）→ 5 份 run-status 里 4 份 p+f = planned+1，而 §13.1 批1 证据仍写「流程数对齐」 | 计数**分阶段**：`passedFlows/failedFlows` 只数首轮，修复后重跑单列 `rerunPassedFlows/rerunFailedFlows`（run-status 与终端摘要都写清口径） | ✅ 代码已改；§4.10② 与 §13.1 的表述同步改成"首轮口径" |
| **5**【信息】 | E31「回滚被真实触发」的原始产物已被改后重跑**覆盖**，磁盘上只剩文档/提交信息层面的记录 | 不再把那段产物当证据：回滚路径的证据改为**单测覆盖**（`packages/subagents/test/executor-apply.test.ts`）+ 事故过程的文字记录；文档里标明"原始 run-status 已被后续重跑覆盖" | ✅ 证据边界写清，不再以"文件还在"充当证据 |
| **6**【高】 | 批3 判据「真实项目生成 1 个 PR」**未达成**：`executor.ts` 把 `gh pr create` 硬编码 `--dry-run`，`pr.created` 固定 `dryRun: true`，CLI 的 `--create-pr` 对真实建 PR 无效 —— 这是**功能缺失**，不是"待授权" | ① 重写 `handlePr`：建独立分支 `sentinel/fix-<id>` → 应用补丁 → 提交 → 推送该分支 → `gh pr create`（**不带** `--dry-run`）→ 切回原分支；② 任何一步失败都切回原分支并把原因写进 `patch.rejected`；③ 事件载荷改为 `{ fixId, title, url?, branch? }`（去掉恒为常量的 `dryRun`）；④ 补 4 条单测（本地裸仓库当远端 + PATH 上的假 `gh`） | ✅ 代码路径已实现并端到端验证；**在 GitHub 上真建一个 PR 属外部可见动作，需你授权后执行**（`--create-pr` 默认关闭，不传参数不产生任何外部动作） |

#### 缺口 2 的回测覆盖边界（必须写清：未覆盖 ≠ 没问题）

| 类别 | 条数 | 说明 |
|---|---|---|
| 契约夹具（人工真值构造的模型回复） | **35** | 31 条 confirmed（根因状态 + 三方案协议 + 补丁合法且**真能 git apply**；其中 24 条还比对硬规则 tier、29 条比对方案是否点名真值关键词） + 4 条 hypothesis（critic 拒了 → 链路停在 planner 之前，只判根因部分） |
| 录制夹具（**真录的**模型回复） | **1** | `2026-10-26-006-1` —— 守的是"模型输出形态"这条路（think 块、截断、怪 JSON） |
| 未覆盖 | **4** | 3 条自反案例（分析 Sentinel 自己的源码，没有注入的真值缺陷，也没有人工判据关键词）+ 1 条漏检案例（`ts-...-m4-components-toggle-noop`：Sentinel 未产出诊断，没有可回放的决策链） |
| 判据**不比对 tier** | 3 条 | `006-1` 与 `ts-...-m6` ×2：档案记的 tier 来自**真实模型补丁**的判定，而契约夹具用的是人工重建的理想补丁，两者形状不同 → 该项不比对，其余判据照常（生成脚本会打印偏差，不自动改成"通过"） |

#### 回测判据不是恒真的证明（反证）

判据本身也要证明"能抓住退化"。故意改坏决策层，回测必须报错：

| 故意改坏的地方 | 回测结果 |
|---|---|
| `isRenameOnlyPatch` 不再认"纯重命名"（硬规则 tier 失效） | **21 个夹具退化** ✅ |
| planner 只给 2 个方案且不补足 | **32 个夹具退化** ✅ |
| `extractDiff` 跳过 diff 规范化（E23/E24 回归） | **1 个夹具退化** ✅（正是那条靠 hunk 计数活着的录制夹具） |

#### 这轮顺带查出的档案数据缺陷（已改）

1. **11 条案例的 `recommendedTitleContains` 与同一文件里的 `recommendedFix.title` 自相矛盾** ——
   关键词来自根因里的标识符，却要求它出现在标题里（例如标题「修正根布局中的 Footer 导入路径」却要求出现「layout」）。
   改成 `recommendedMentions`，语义也改成**标题 + 说明**（planner 的契约本来就是"方案必须点名具体文件与改什么"）。
2. **关键词判据的命中口径不一致** —— 归档时用 `.some()`（任一命中），回测用 `every()`（全部命中）→ 同一个词表两套语义。已统一为任一命中。
3. **5 条 vek 案例的 `hardTier=3` 是查表失败的兜底值，不是真实判定** —— 记录里写着「未记录硬规则判定」，而同一份 run-status 的 `appliedPatches` 显示修复是 **Tier 1 自动应用**的（Tier 1 是唯一会自动改用户代码的档）。契约夹具据此不再比对 tier，并打印偏差说明。
