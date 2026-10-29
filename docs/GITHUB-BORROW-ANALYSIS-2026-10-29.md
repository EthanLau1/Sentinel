# Sentinel 对标 GitHub 项目 · 借鉴点分析

> 日期：2026-10-29 · 版本 **v1.3**（v1.0 → v1.1 → v1.2 → v1.3 的逐条更正见第 8 节，含 **5 处作废**表述；
> **v1.3：P0-A / P0-B / P0-C 三块已落地**，落地过程中的新发现见 §10）
> 目的：回答「GitHub 上有没有类似项目？具体学哪几个点？为什么是必须的？」
> 取证方式：GitHub API 直读源码 + Next.js 官方文档与**源码** + 本机实跑 Sentinel 真实代码 + 独立 verifier 对抗性复核（12 条断言逐条裁决 + 14 条事实性错误抽查）
> 覆盖边界：本文所有「实测」结论均由本机跑通；所有「借鉴」结论均给出上游文件路径

---

## 0. 一句话结论

**最该学的不是"加更多框架支持"，而是三件事：把"什么算项目缺陷"判对、把证据真正送进模型、把重复结论收敛掉。**

并且要修正一个更根本的认识：**"修好路由解析"不等于"覆盖率会上去"**（见 §4.3），而且**修路由不是最该先做的那件事**（见 §5）。

---

## 1. 对标清单（均已核实存在且活跃）

| 仓库 | Star | 语言 | 与 Sentinel 的关系 |
|---|---|---|---|
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 38.8k | TS | 浏览器 MCP；源码在 Playwright monorepo `packages/playwright-core/src/tools/mcp` |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 54.4k | TS | 浏览器工具面治理 + token 优化原则 |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | 25.9k | TS | AI 浏览器操作（observe/act/extract + 缓存） |
| [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene) | 15.4k | TS | 自然语言 E2E + **单文件 HTML 报告** + 证据压缩 |
| [yamadashy/repomix](https://github.com/yamadashy/repomix) | 29.1k | TS | 仓库打包：文件分级 / 超限切分 / tree-sitter WASM |
| [The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent) | 13.7k | Python | PR 审查：coverage 双清单 / 合并三规则 / doctor 门禁 |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | 49.8k | Python | 符号级 repo map（tree-sitter + PageRank + 预算二分） |
| [schemathesis/schemathesis](https://github.com/schemathesis/schemathesis) | 3.7k | Python | OpenAPI 变异算子 + 负向守卫 + FAILURE/ERROR 分离 |
| [Endava/cats](https://github.com/Endava/cats) | 1.4k | Java | 根因签名聚类 + 三态判定 + **多格式导出器注册表** |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | 36.7k | TS | Trace/Observation 观测模型 |
| [open-telemetry/semantic-conventions](https://github.com/open-telemetry/semantic-conventions) | 676 | Jinja | 属性命名 + requirement_level 纪律（**GenAI 约定已迁出**） |
| [rr-debugger/rr](https://github.com/rr-debugger/rr) | 10.7k | C++ | 回放确定性 / 环境指纹校验 / chaos 模式 |

---

## 2. 必须借鉴的 9 个点

### P0-A 先修判定口径：`isToolFailure` 缺了第三类 ★本轮新增

**借鉴**：[schemathesis](https://github.com/schemathesis/schemathesis) `src/schemathesis/engine/__init__.py:10` 的 `SUCCESS / FAILURE / ERROR / INTERRUPTED / SKIP` 五态分离 —— `ERROR` 只装"工具自己坏了"，产品违约归 `FAILURE`。

**落点**：`packages/reporters/src/aggregate.ts:11-19` 的 `TOOL_FAILURE_PATTERNS`

**Sentinel 现状**：7 条模式全是"工具自身崩了"（browser 未注册、页面已关闭、URL 非法…）。**没有第三类**：
> "Sentinel 自己生成了一个不存在的 URL，于是 404 了" —— 这既不是被测项目的缺陷，也不是工具故障，是**我们自己的知识错了**。

**为什么是必须的**：
1. `run.ts:688`：`const projectBugs = reportedBugs.filter((b) => !isToolFailure(b));` → 返回 1 就是"项目有问题"。**404 不在模式里 → 被算成项目缺陷 → 退出码变红。**
2. 也就是说：**在路由修好之前，Sentinel 每跑一次都在制造假 P1，并让 CI 变红。** 这比路由本身更该先修。
3. 它是宪法红线 4「任何结论必须绑定 Evidence」在**判定层**的缺口 —— 现在是"无证据也要算缺陷"。

**代价**：极轻。加一条模式 + 一个"路由来自 Sentinel 自己的映射"判定
**注意**：不能简单把所有 404 都排除 —— 必须是"**这个 URL 是 Sentinel 自己生成的**"才算，否则会掩盖项目真实的 404。

---

### P0-B 证据链：三处空壳 / 一处截断 / 一处丢弃

**借鉴**：[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) `docs/design-principles.md`
> **Token-Optimized**: Return semantic summaries. "LCP was 3.2s" is better than 50k lines of JSON. **Files are the right location for large amounts of data.**
> **Reference over Value**: for heavy assets (screenshots, traces, videos), **return a file path or resource URI, never the raw data stream**.
> **Human-Agent Collaboration**: Output must be readable by machines (structured) AND humans (summaries).

**落点**：`packages/subagents/src/runner.ts`（证据生产）、`packages/subagents/src/analyst.ts`（`formatEvidence`）、`packages/reporters/src/markdown.ts`（渲染）

**Sentinel 现状（逐格实测）**：

| 证据类型 | core 定义 | 采集 | 运行时生产者 | 进 analyst prompt | 报告里显示 |
|---|---|---|---|---|---|
| `a11y` | ✅ types.ts:118 | ✅ browser.ts:174 `ariaSnapshot()` | ✅ runner.ts:322（**仅失败路径**） | ⚠️ **超 4000 字符即被砍断** | ❌ 字面量 `accessibility tree` |
| `dom-snapshot` | ✅ types.ts:117 | ✅ browser.ts:172 `page.content()` | ❌ **无人 push** | ❌ 拿不到 | ❌ `DOM (N chars)` |
| `screenshot` | ✅ types.ts:116 | ✅ browser.ts:170 | ✅ runner.ts:313 | ❌ **模型完全看不到** | ❌ base64 前 60 字符 |
| `console` / `network` | ✅ | ✅ | ✅ | ✅ | ✅ |

三处最严重的问题：

1. **`dom-snapshot` 是空壳**。`runner.ts:305` 在类型里声明了 `domSnapshot?: string`，但**没有任何一处把它 push 进证据链**。运行时能产出的 `dom-snapshot` 只有 `inspector.ts:226/335` 的**合成占位串**（`<body> empty (textLength=0…)`）。于是 core 定义了类型、reporters 有渲染分支、analyst 有格式化分支，**唯独没有真实生产者** —— 而报告里 `DOM (N chars)` 会让人以为看过真实 DOM。
2. **`screenshot` 对模型完全不可见**。`formatEvidence` 把 base64 换成字面量 `'[image data; inspect separately]'`，但**没有任何环节去 "inspect separately"**。每次失败白拉一张 PNG，换回零信息。报告层再把 base64 砍到前 60 字符（`markdown.ts:292` 还会重复输出 `data:image/png;base64,` 前缀）。
3. **`a11y` 被截断**。`formatEvidence` = 固定前缀 37 字符 + `JSON.stringify(detail).slice(0, 4000)` → 输出上限 **4037 字符**。实测三种页面：

| 夹具 | aria 树长度 | formatEvidence 输出 | 触发截断 |
|---|---|---|---|
| 30 链接 + 40 行 4 列表格 + 表单 | 6330 | 4037 | **是** |
| 表头 + 5 列 40 行 | 7442 | 4037 | **是** |
| 40 条长文本列表 | 3767 | 4009 | **否** |

   → **阈值是"aria 树超过约 4000 字符"，不是"某个页面规模必然触发"。** 触发时 JSON 从尾部被砍断，模型拿到半棵树。

**为什么是必须的**：
1. 模型拿到**半棵 a11y 树**却照样下根因断言 —— 与宪法红线 4 冲突：现在是"有残缺证据也在断言"。
2. **更严重的一层**（verifier 实测）：`bug.draft` 由 `run.ts:404` → `collector.onDraft()` **无条件进报告**；而 `bug.rejected`（critic 驳回）只写进 `run-status.json`，**不拦截 draft 入报告**。所以一次被 critic 驳回的发现，仍会以 hypothesis 级出现在报告里；若模型给了根因，报告里就会带着一个**未经证实的根因**。这直接踩红线 4。
3. 报告用户看不到 a11y / DOM 内容 → **无法人工复核，无法反驳 Agent**。
4. 成本与噪音同比例放大。

**代价**：轻。零新依赖。项目已有 `.sentinel/cache/` 可直接落盘
**不要抄**：chrome-devtools 的 puppeteer + 内嵌 DevTools bundle（重、只支持 Chrome、默认上报统计、Performance 工具可能发外网 → 破离线）

**额外借鉴（verifier 补，本项目完全没有）**：playwright-mcp 的 `--caps` 能力分级（`README.md:415`，可选 `vision,pdf,devtools,config,network,storage`）。Sentinel 现在 `grep -rniE "capabilit|feature.?flag" packages/*/src` **零命中** —— 没有任何"这次 run 覆盖了哪些能力"的概念，而"覆盖诚实性"是宪法的核心。

---

### P0-C 路由约定：先判 router，再套约定

**借鉴**：`vuejs/router`（文件式路由约定已迁入官方 router 仓库）+ `hannoeru/vite-plugin-pages` 的约定表
**落点**：`packages/adapters/src/frontend/nextjs.ts` 的 `routes()`

**Sentinel 现状（真实 Kernel + Mapper + nextjsAdapter 实跑）**：
```
识别到的页面数: 9   API 数: 1
自动生成的流程数: 7
实际会被 visit 的 URL:
   /(.)photo        ← 不存在（App Router 拦截路由）
   /@modal/photo    ← 不存在（App Router 并行路由槽）
   /(group)/grouped ← 正确（Pages Router 保留字面量目录名）
   /pricing  /  /legacy  ← 正确
真实却被跳过（coverage 里只写一句 "not auto-tested"）:
   /blog/:slug  /docs/:parts  /shop/:[...rest]
```

**9 个"页面"里：2 个是伪页面、3 个真路由被跳过、4 个真且被测 → 有效覆盖率 44%。**

**为什么是必须的**：
1. Sentinel 的核心承诺是"自动体检"。非 Next.js 项目现在产出 0 个可测目标；**唯一能用的 Next.js 适配器自己就错 22%**。
2. `FeatureMap` 里的"页面数"是用户直接看到的数字。**9 个页面里有 2 个根本不是页面** → 覆盖率、报告、修复建议全部建立在错误基数上。
3. 假流程必然真的去访问不存在的 URL 并 404（不会被 `isToolFailure` 拦下 → 见 P0-A）→ Sentinel 自己制造噪音并让退出码变红。
4. **这是所有后续工作的前置**：路由不准，巡检规则、修复建议全都没有作用对象。
5. 现有测试只覆盖最简单情形（`packages/adapters/test/nextjs.test.ts` 只建了 `app/page.tsx` / `app/posts/page.tsx` / `app/api/posts/route.ts`），五类约定一个都没测。

**代价**：轻-中。纯函数解析，不碰 `packages/core`，不新增依赖，不影响离线模式
**不要抄**：整套 unplugin 插件体系（build 期插件 vs 运行时扫描器，形态不兼容）。只抄"文件 → 路由路径"的约定表与动态参数语义。

---

### P1-D 单文件 HTML 报告

**借鉴（两处）**：
- [midscene](https://github.com/web-infra-dev/midscene)：`packages/core/src/report-html-template.ts` 的 `REPORT_HTML_TEMPLATE` + `packages/core/src/dump/html-utils.ts` `generateAgentReportComment()`（"Structured report JSON is stored in script[type=\"midscene_web_dump\"] tags…"）→ **单文件 + 人读与 agent 读同一份**
- [cats](https://github.com/Endava/cats)：`src/main/java/com/endava/cats/report/` 下 `TestCaseExporterHtmlJs.java` / `TestCaseExporterHtmlOnly.java` / `TestCaseExporterHtmlJsCluster.java` → **多格式导出器注册表**（每个导出器声明自己的 `getSpecificHelperFiles()`）

**落点**：`packages/reporters/src/html.ts`（与 `markdown.ts` / `json.ts` 并列）

**Sentinel 现状**：`packages/reporters/src/index.ts` 只导出 markdown / json / cli / coverage / tier / aggregate / collect。`packages/cli/src/doctor.ts:407` 自己报："HTML reporter 尚未实现（宪法要求三格式，当前仅 md/json）"。宪法 `docs/CONSTITUTION.md:517` 写明"HTML 报告为 v2 实现……**不得**因此宣称三格式已满足"。

**为什么是必须的**：
1. 宪法已把它列为 v2 目标，补上就是**兑现承诺**。
2. 证据是 DOM / a11y / 截图 —— Markdown 承载不了。**HTML 报告是"证据驱动"唯一能落地的形态**（与 P0-B 配套：证据要能被展开看）。
3. 用户是编程小白：一份能点开、能展开证据、能看懂结论的可视化报告 = 能自己复核 Agent 的判断。
4. **cats 的"导出器接口 + 各自附属文件"比 midscene 更贴合 Sentinel 的 md/json/html 三格式需求** —— 宪法要的正是"多格式"，不是"一个 HTML"。

**代价**：中
**不要抄**：`apps/report` 整个前端工程
**⚠️ 需先决策**：仓库已有 `sentinel-ui/`（React + Vite 交互式调试 UI）——那是**调试工作台，不是报告产物**。建议**另出单文件 HTML**

---

### P1-E 根因聚类 + 证据去重（两层都要）

**借鉴**：
- [cats](https://github.com/Endava/cats) `src/main/java/com/endava/cats/report/ErrorSimilarityDetector.java`：`LEVENSHTEIN_THRESHOLD = 0.85`、`JACCARD_THRESHOLD = 0.7`、`PATTERN_MATCH_BONUS = 0.2`、`COMPARE_PREFIX_LENGTH = 240`；签名键 `ERROR_TYPE_KEYS` / `ERROR_DETAIL_KEYS` / `STACK_KEYS`；归一化剔除 TIMESTAMP / UUID / HASH / URL / PATH / NUM
- [midscene](https://github.com/web-infra-dev/midscene) `packages/core/src/dump/report-dump-compactor.ts`：按 `data-group-id` 合并去重多个 dump script 标签，返回 `{ beforeBytes, afterBytes, beforeDumpCount, afterDumpCount }` **压缩前后量化对比**

**落点**：`packages/reporters/src/aggregate.ts`

**Sentinel 现状**：
- `aggregate.ts:43-49` 的 `normalizeMessage()` 只用正则抹数字。文件头自己写着："2026-06-15 的真实运行产出 25 条几乎相同的假阳性"。
- `aggregate.ts:85` 的 `aggregateDuplicateBugs` **只合并 bug**，**证据本身仍按条数上限截断**。

**为什么是必须的**：
1. **25 条重复 finding = 报告噪声 = 用户放弃阅读 = 整个工具失去意义**。这是已记录在案的真实事故。
2. 每条重复 finding **各自消耗一次 LLM 调用**（Analyst 按 bug 逐条分析）→ 成本与噪声同比例放大。
3. 25 条同源噪音会把唯一那条真根因淹掉。
4. **证据实体也要去重**：midscene 的"压缩前后量化"给了一个可测口径 —— 不是"感觉变简洁了"，而是 `beforeBytes → afterBytes`。

**代价**：轻。Levenshtein 约 30 行可零依赖手写 → 纯函数可进 `packages/core`
**不要抄**：cats 的 157 个 fuzzer 全量、Java/Quarkus 栈、**安全注入类 fuzzer**（Sentinel 是"项目体检"不是渗透测试）

---

### P1-F 过程可追溯 = 宪法红线 6 的存储载体

**借鉴**：[langfuse](https://github.com/langfuse/langfuse) `packages/shared/src/domain/observations.ts`（`parentObservationId` / `level` / `statusMessage`）+ `packages/shared/src/server/otel/OtelIngestionProcessor.ts:70-74` 的**别名归一 + 未知值返回 undefined 走回退**（不兜底成 DEFAULT）

**落点**：`packages/cli`（NDJSON 落盘）—— **不要新建 core 类型**

**Sentinel 现状**：`packages/core/src/bus.ts` 已经内置录制能力：
```ts
startRecording(): void   // bus.ts:84
stopRecording(): Event[] // bus.ts:90
```
全项目检索：**只有 `packages/core/test/bus.test.ts:115,121,130` 在用，生产代码零调用** → `bus.ts:10` 注释承诺的"record 模式可完整回放（黑匣子）"**从未在真实运行中启用**。

**为什么是必须的**：
1. Sentinel 有 Critic / Verifier 两道反证机制，但**一旦结论错了，用户没有任何手段定位是哪一步判错的**。
2. **它同时是宪法红线 6「每个真实案例进入 `benchmarks/cases/` 永久留档」的存储载体** —— 红线 6 现在没有自动化的落地路径，落盘 NDJSON 就是那个载体。
3. `parentObservationId` 表达 9 步的嵌套关系 → "哪一步的判断错了"从"猜"变成"查"。

**最小实现路径**：
1. CLI run 入口调 `bus.startRecording()`，结束时 `stopRecording()` 写 NDJSON；
2. 每条事件补 `parentId`；
3. 用 langfuse 的 level 归一表收敛到 `DEBUG/DEFAULT/WARNING/ERROR`，**未知值走回退而不是兜底成 DEFAULT**（与现有 `origin: 'rule'|'llm'|'heuristic'` 三档口径同构）。

**代价**：轻-中。NDJSON 落盘即可，**不引 OTel SDK**（破离线 + 增依赖）
**⚠️ 红线注意**：`packages/core/src/types.ts:11` 写死"宪法第 5 条：不允许引入第 6 个核心类型"。**不要进 core**，core 的 `Event<T>` 保持唯一载体。

---

### P1-G 知识增强 30% 限流（宪法硬条款，v1.1 起已升到 P1）

**借鉴**：[aider](https://github.com/Aider-AI/aider) `repomap.py:get_ranked_tags_map_uncached()` 的"全局预算 + 重要性排序 + 二分截断"；[pr-agent](https://github.com/The-PR-Agent/pr-agent) `pr_agent/algo/token_budget.py` 的软/硬双阈值
**落点**：`packages/subagents/src/enhancer.ts` 的 `decideSearch()`

**Sentinel 现状**：只有一条 `avg confidence < 0.7`。宪法 `docs/CONSTITUTION.md:404` 要求"触发率上限: ≤30%（每次 run 中触发检索的流程占比）"，**未实现**，已诚实标注为已知未修项。

**为什么是必须的**：
1. 这是**宪法硬条款**，不是优化项 —— v1.1 把它排 P2 与自己的论证自相矛盾，本轮升到 P1。
2. 宪法自己写了教训（红线 8 变更记录）："以前只有实现里的自觉……没有机检 —— 第二次改代码就会漂移"。
3. `lint:spec` 用 baseline 机制只拦**新增**偏差，它现在是"已记录的已知偏差" —— 这不等于它就该一直排在后面。

**代价**：轻

---

### P2-H API 契约校验（变异算子 + 负向守卫）

**借鉴**：[schemathesis](https://github.com/schemathesis/schemathesis)
- `src/schemathesis/core/mutations.py:16` 五个 `OperatorKind`：`CHANGE_TYPE` / `NEGATE_CONSTRAINTS` / `REMOVE_REQUIRED_PROPERTY` / `VALUE_VIOLATOR` / `SYNTAX_FUZZING`
- `src/schemathesis/generation/meta.py:35` 覆盖场景枚举 **52 项**，负向含 `INCORRECT_TYPE` / `MISSING_PARAMETER` / `OBJECT_MISSING_REQUIRED_PROPERTY` / `VALUE_ABOVE_MAXIMUM` / `STRING_ABOVE_MAX_LENGTH` / `ARRAY_ABOVE_MAX_ITEMS` …
- `src/schemathesis/openapi/checks.py:867` **7 道序列化守卫**：判定"产品 bug 还是用例写错"的标准不是"服务器报错了"，而是**"我发出去的请求按 schema 序列化之后是否仍然非法"**
- `src/schemathesis/engine/__init__.py:10` 状态分离：`SUCCESS / FAILURE / ERROR / INTERRUPTED / SKIP`

**落点**：`packages/adapters`（schema → 变异计划）+ `packages/subagents/src/inspector.ts`（契约规则族）

**为什么是必须的**：
1. 现在 API 侧只查状态码 —— **"返回 200 但 body 不符 schema"根本查不出来**，而这正是最常见的契约违约。
2. 7 道守卫是"判产品 bug vs 判测试写错"的最短路径 → 直接服务红线 4 与报告诚实性。
3. 现有 11 条巡检规则全是 DOM/网络级，**没有一条是契约级**。

**代价**：中。算子与场景清单是纯数据（可进 core），schema 校验需要 `ajv` → 只进 `packages/adapters`
**必须注意**：离线且本地无 schema 时，用 cats 的 `ValidationResult.notPerformed()`（`ResponseSchemaValidator.java:185`）三态 —— 显式标"未执行"，**不能静默跳过**

**不要抄**：Hypothesis/Python 工具链；schemathesis 的 18 个框架错误解析器

---

### P2-I 回放的环境指纹校验

**借鉴**：[rr](https://github.com/rr-debugger/rr) `src/ReplaySession.cc:909` `is_same_execution_point()` + `:252` 环境指纹不符即拒绝回放
> "Trace was recorded on a machine that defines ticks differently" / "Error: Replay diverged."

**落点**：`packages/cli/src/replay.ts`

**Sentinel 现状**：回放**已支持双通道**（`channel?: 'flow.failed' | 'page.visited'`，含 `selectRule` / `expected.severity`，宪法 `docs/CONSTITUTION.md:275` 的要求**已满足**），但**没有校验"录制环境"与"回放环境"是否一致**。

**为什么是必须的**：schema 版本 / prompt 版本 / 模型 id / adapter 版本任一变化，回放"通过"都是**假绿** —— 比没有回归保护更危险。环境不符应把回放标为**不可信**。

**代价**：轻
**不要抄**：rr 的 syscall 拦截 / perf counters / ptrace / Cap'n Proto（Linux-only ≥4.7）

---

## 3. 总表

| # | 借鉴点 | 来源 | 落点 | 代价 | 优先级 |
|---|---|---|---|---|---|
| 0 | **判定口径补第三类**（自己造的错误 URL 不算项目缺陷） | schemathesis | `reporters/aggregate.ts` | 极轻 | **P0** |
| 2 | **证据链打通**（空壳 / 截断 / 丢弃三处） | chrome-devtools-mcp、playwright-mcp | `runner.ts`、`analyst.ts`、`reporters/markdown.ts` | 轻 | **P0** |
| 1 | **路由约定正确解析**（先判 router） | vuejs/router、vite-plugin-pages | `adapters/frontend/nextjs.ts` | 轻-中 | **P0** |
| 4 | **根因聚类 + 证据去重** | cats、midscene | `reporters/aggregate.ts` | 轻 | P1 |
| 5 | **过程可追溯**（= 红线 6 载体） | langfuse | `packages/cli` | 轻-中 | P1 |
| 6 | **30% 限流口径**（宪法硬条款） | aider、pr-agent | `subagents/enhancer.ts` | 轻 | P1 |
| 3 | **单文件 HTML 报告**（宪法 v2 目标） | midscene、cats | `reporters/html.ts` | 中 | P2 |
| 7 | **API 契约变异 + 负向守卫** | schemathesis、cats | `adapters`、`subagents/inspector.ts` | 中 | P2 |
| 8 | **回放环境指纹校验** | rr | `cli/replay.ts` | 轻 | P2 |

**为什么这个顺序（与 v1.1 不同）**：
1. **第 0 项最前**：它决定退出码。在路由修好之前，Sentinel 每次跑都在产假 P1 并让 CI 变红 —— 这是**当下正在发生的错误**，不是未来的改进。
2. **第 2 项先于第 1 项**：证据外置是**结构性修复**，路由修复只是**减少触发次数**；且前者成本更低（零依赖、不碰 core）。
3. **第 1 项排第三**：它价值最高、工作量也最大（要写两套 router 约定表 + 夹具），适合在便宜的修法落地后做。
4. 30% 限流升到 P1：它是宪法硬条款，v1.1 把它排 P2 与自己的论证自相矛盾。

---

## 4. 新增发现

### 4.1 同一个目录名在 app/ 与 pages/ 下语义相反（源码级证实）

Next.js 官方文档：
- Route Groups 是 **App Router 专属**约定。官方页在 `/docs/app/api-reference/file-conventions/route-groups`，原文："should **not be included** in the route's URL path"。
- Pages Router 文档（`/docs/pages/building-your-application/routing/dynamic-routes.md`）**通篇没有 route group / 括号概念**；`/docs/pages/llms.txt` 全文检索 `route group|parenthes|(group)` = **0 命中**。

Next.js **源码**（决定性）：
- `packages/next/src/shared/lib/router/utils/app-paths.ts:23` `normalizeAppPath()` 才剥离 `isGroupSegment`（`(x)`）与 `@slot`；
- `packages/next/src/build/route-discovery.ts:63` `normalizeAppRoute()` → `normalizeAppPath()`，**只在 App Router 分支调用**（`:232`）；
- Pages Router 走 `getPageFromPath()`（`:77-97`），它**只去文件扩展名与 `/index`**，不剥 group；`:310` 的 `pagesType === PAGE_TYPES.APP ? normalizeMetadataRoute(pageKey) : pageKey` 明确 **PAGES 分支原样保留**。

**结论**：`pages/(group)/grouped.tsx` 的真实 URL 是 **`/(group)/grouped`**（字面量保留）。

**对 Sentinel 的意义**：
1. `walkPagesDir` 输出 `/(group)/grouped` —— **这一项其实是对的**。v1.0/v1.1 把它算成"伪路由"是**判断错误**。
2. 真正的洞是：**Adapter 没有"先判断用哪个 router，再套对应约定"这一层**。`walkRoutes`（app）与 `walkPagesDir`（pages）是两套各写一遍的规则，互不参照 —— 与 `inspector.ts` 里那句"两套映射各写一遍必然漂移"是同一个病，同一项目里犯了第二次。
3. 顺带修正两条：App Router 的 `[...parts]` 是**多段捕获**（`/docs/a/b`），Sentinel 输出 `:parts`（单段）→ 语义错；`[[...rest]]` 是**可选**捕获（`/shop` 也匹配），Sentinel 输出 `:[...rest]` → 语法就非法。

### 4.2 `isConcretePath` 的"意外正确"

`mapper.ts:293`：`return path.startsWith('/') && !/\[[^\]]+\]|:[^/]+|\*/.test(path);`

它把 `:parts` 判成动态而跳过 —— 这**恰好**掩盖了 §4.1 里 catch-all 的错误输出。**这是运气，不是设计**：按 §4.1 把 catch-all 改成 `*` 后，`isConcretePath` 里的 `\*` 分支会开始生效（正确跳过）；只改一半就会出现"路由修对了却仍测不到"的错配。
→ **改路由解析必须与 `isConcretePath` 一起改，并配一条端到端断言。**

### 4.3 动态路由是独立的天花板（修路由 ≠ 覆盖率上升）

`mapper.ts:268 generateFlows()`：每个页面 = 1 条 visit 流程，每个 GET 接口 = 1 条 assert 流程，且必须 `isConcretePath` 为真。
→ 3 个**真·存在**的动态页面**永远不会被自动测**（coverage 里只留一句 "not auto-tested"）。

**即使把路由约定全修对、伪路由全剔除，覆盖率也只从 44% 变成 4/6 ≈ 67%。** 要突破必须另外补一条能力 —— 从动态路由派生一个可访问的具体 URL（种子值 / 已知 ID / 从 API 列表取第一个 ID）。

**借鉴**：cats 的 `stateful replay`（`ReplayCommand.java:60` "re-running upstream 2XX producer steps first to mint fresh IDs"）与 schemathesis 的 `DependencyGraph.iter_links()`（`POST /users` → `GET /users/{id}` 的生产者→消费者链）—— **先跑生产者拿到 ID，再去测消费者**，正好是动态路由的解法。
**必须区分**"哪些接口是生产者"（有副作用的 POST 不能随便跑）→ 需要一条"只读优先、副作用显式声明"的策略。

### 4.4 报告里的"hypothesis 级条目"是一道被忽视的闸门

- `run.ts:404` → `collector.onDraft()`：**未确认的 draft 无条件进报告**；
- `run.ts:456` → `rejectedBugs.push(...)`：**critic 驳回只写进 `run-status.json`，不拦截 draft 入报告**。

→ **"被 critic 驳回"在报告里表现得和"未确认"一样**。用户看到的是"这个项目有 3 个问题"，而不是"这 3 条被反方驳回了"。
→ 这也是 verifier 实测出的最严重一点：在线模式下模型会自编根因（"路由不存在导致 404"），带进报告。

### 4.5 路由修复必须留下回归案例

宪法红线 6："每个真实案例进入 `benchmarks/cases/` 永久留档"（当前 44 个案例）。本次发现的 5 类路由错误应当：
1. 在 `packages/adapters/test/nextjs.test.ts` 增加**夹具**（app 与 pages 两套，含五类约定）；
2. 在 `benchmarks/cases/` 增加**案例**（走 mapper → flows 的真实链路，断言"不产生伪 URL"）。

### 4.6 FeatureMap 缺"页面真实性"字段

`PageSpec` 现在把三类东西混在一起：**真静态路由** / **动态路由** / **伪路由（组、槽位、拦截）**。下游无法区分 → coverage 只能靠字符串正则猜。
建议加两个字段（如 `dynamic?: boolean`、`concrete?: boolean`），让 mapper 自己说清"哪些我测了、哪些我测不了、哪些根本不是路由"。
**⚠️ 注意**：`PageSpec` 在 `packages/core/src/types.ts`，加字段要过宪法"core 类型不新增"的纪律 —— 加**字段**不等于加**类型**，但要走 `docs/CONSTITUTION.md` 的升版流程。

### 4.7 报告漏掉的 6 个可借鉴机制（verifier 补充，已逐条核实）

| # | 机制 | 来源与位置 | 为什么 Sentinel 需要 |
|---|---|---|---|
| 1 | **能力分级 `--caps`** | playwright-mcp `README.md:415`（`vision,pdf,devtools,config,network,storage`） | 项目 `grep -rniE "capabilit|feature.?flag" packages/*/src` **零命中** —— 没有"这次 run 覆盖了哪些能力"的概念，而这正是宪法的核心 |
| 2 | **`observe()`：选择器不进模型** | stagehand `README.md:67,125,220`："observe() returns real selectors, so credentials never reach the model" | 项目 `a11yTree` 是**整页快照**（`browser.ts:174` `body.ariaSnapshot()`）→ 必然包含表单字段名、可能含用户标识。**这是隐私/凭据外泄面** |
| 3 | **证据实体去重 + 压缩量化** | midscene `packages/core/src/dump/report-dump-compactor.ts`（`data-group-id` 分组、`beforeBytes/afterBytes`） | 项目只合并 bug，不合并证据；且"变简洁了"不可测，`beforeBytes→afterBytes` 可测 |
| 4 | **多格式导出器注册表** | cats `report/TestCaseExporterHtmlJs.java` / `HtmlOnly` / `HtmlJsCluster` | 宪法要 md/json/html **三格式**，cats 的"导出器接口 + 各自附属文件"天然支持多格式 |
| 5 | **`notPerformed()` 三态** | cats `ResponseSchemaValidator.java:185` | "没做 ≠ 没问题"是红线 4 的通用范式；项目 coverage 只有 `empty` / `plannedFlows` 两档，**缺"未执行"** |
| 6 | **幂等重放不重复付费** | stagehand `cache: true` = "identical calls come back from Browserbase, no tokens spent" | 项目 `patch.applied` 后重跑受影响的 flow 已有机制，但**会重复调模型**；缓存契约可让重跑零成本 |

---

## 5. 明确不建议借鉴的

| 项目 | 原因 |
|---|---|
| chrome-devtools-mcp 整套 puppeteer + DevTools bundle | 重、只支持 Chrome、默认上报统计、Performance 工具可能发外网 → 破离线 |
| stagehand 的 Browserbase 云 + SDK RPC 形态 | 破离线 |
| stagehand 的视觉定位 / midscene 的 bbox grounding | 需多模态模型 → 破离线 |
| repomix 的 tree-sitter 源码压缩 | 我们的输入是现场证据，压缩会丢行号 |
| repomix 的 git 变更排序 | 无 git 时静默降级 —— 必须显式标注"未排序"，否则是隐性降级 |
| aider 的 `map_mul_no_files=8` | 为聊天式浏览设计，与"单次体检"语义不同 |
| aider 的 PageRank magic number（×10 / ×50 / ×0.1 / sqrt） | 抄语义不抄数字 |
| pr-agent 的 git providers / servers / mosaico / telemetry / 向量库 | 引入即破坏"本地运行"定位 |
| OTel `gen_ai.*` 命名空间整套 | 语义债；**且 GenAI 约定已迁出本仓**（`docs/gen-ai/gen-ai-agent-spans.md` 现为跳转页，新仓 `open-telemetry/semantic-conventions-genai`） |
| rr 的 syscall 拦截 / perf counters / ptrace | Linux-only、内核层 |
| cats 的注入类 fuzzer | 有破坏性，越出"项目体检"范围 |

**负向结论（避免走弯路）**：
- **pr-agent 没有 HTML 报告**（仓库树 761 项无 `.html` 报告文件，README 无 html 字样）→ 但 **cats 有**（`TestCaseExporterHtmlJs` / `HtmlOnly` / `HtmlJsCluster`）→ HTML 有**两个**可抄来源，cats 的导出器注册表更贴合三格式需求。
- **playwright-mcp 的实现已迁出该仓**（`src/README.md` 指向 `packages/playwright-core/src/tools/mcp`）。
- **`posva/unplugin-vue-router` 已归档**（`archived=true`，最后推送 2026-02-24），实验性文件路由迁入 `vuejs/router` —— 引用请用新仓，别写"已合并"。
- **OTel GenAI 语义约定正在跨仓迁移中**，stability 标 `development` → 现在绑定就是绑定一个移动靶。
- **stagehand v4 缓存在本地浏览器下确实无效** —— 官方文档 `packages/docs/v4/best-practices/caching.mdx:17` 原文："With a local browser there is no Browserbase session to key against, so the `cache` option has no effect and every call runs inference."

---

## 6. 覆盖边界

| 已核实 | 未核实 |
|---|---|
| 12 个对标仓库的存在、star、语言、活跃度（GitHub API） | 各仓库**运行时行为**（未 clone 运行，结论基于源码文本） |
| 借鉴机制的**上游文件路径与代码片段** | repomix `output.git.sortByChanges` 默认值 |
| Sentinel 侧：adapter 契约、11 条巡检规则、宪法条款与行号、事件目录（EventType **28** 项） | aider 的 Vue/Svelte 符号抽取（**已确认 .scm 不覆盖**） |
| **本机实跑**：路由解析 9→7 条流程 / 2 个伪 URL / 44% 有效覆盖率 | stagehand v4 缓存的服务端实现细节 |
| **本机实跑**：三种夹具的 aria 体积（6330 / 7442 / 3767）与截断行为 | midscene `report-dump-compactor` 的实际压缩率 |
| **Next.js 官方文档 + 源码**：路由组归属、两种 router 的映射与捕获段语义、`normalizeAppPath` 调用点 | pr-agent `mosaico` 的实际渲染形态；cats HTML 导出器的渲染效果 |
| **逐格实测**：四类证据的采集 / 生产者 / prompt / 报告四段链路 | Next.js 各历史版本对可选捕获的差异（以当前官方文档为准） |
| 失败过滤规则不含状态码；`run.ts:688` 退出码逻辑；`bug.draft` 无条件进报告 | 真实浏览器端到端（本机无 Playwright Chromium，走的是系统 Chrome 与等价夹具） |

---

## 7. 覆盖边界说明：独立复核的裁决

本轮由独立 verifier 对 12 条断言逐条裁决 + 14 条事实性错误抽查。**结论：verifier 的 4 条有效更正已采纳，2 条误判已驳回。**

| verifier 的意见 | 裁决 | 依据 |
|---|---|---|
| A6：Pages Router 不剥离路由组 | **采纳**（已在 v1.1 修正方向，v1.2 进一步修正"伪路由数量"） | Next.js 源码 `route-discovery.ts:63,77-97,232,310` |
| A3：critic 驳回不阻止 draft 进报告 | **采纳并升级** | `run.ts:404` / `run.ts:456` 亲自核实 |
| A4：formatEvidence 输出 4037 | **采纳** | 前缀 37 字符 + 4000 |
| A4：aria 树 1996 不触发截断 | **部分采纳** —— 那是 verifier 自己夹具的数；我的 6330 可复现。但**它指出的表述问题成立**：阈值是"树 > ~4000 字符"，不是"某个页面规模必触发"（夹具 C 3767 就不触发） | 三种夹具实测 |
| A12：cats 也有 HTML 导出器，"HTML 只能从 midscene 抄"不成立 | **采纳** | `TestCaseExporterHtmlJs.java` 等 |
| A12：stagehand 缓存"无中生有" | **驳回** —— verifier 只读了 README，没读 docs 目录 | `caching.mdx:17` 原文确有该 Note |
| B2：证据外置应先于路由 | **采纳**（并补上更前的第 0 项） | 见 §3 排序理由 |
| B4：schemathesis / langfuse 路径缺包前缀 | **采纳** | 见 §2 H 与 P1-F |

---

## 8. 更正记录

> 规则：发现自己之前下过的结论是错的，立刻明确说"这条结论作废"，并解释为什么错。

### v1.0 → v1.1

**作废 ① 「Pages Router 下 `(group)` 应该剥掉」** —— 方向反了。错因：把 App Router 的约定当成两个 router 的共同约定。

**作废 ② 「`benchmarks/replay` 只覆盖决策层，不覆盖运行时故障」** —— 二手结论未核实。`cli/replay.ts` 早就完整实现了巡检通道。错因：轻信子代理结论。

**更正 ③ 「3 条假 bug 写进报告」** —— 夸大。必然发生的是 3 次访问 + 覆盖率污染；是否成为确认缺陷取决于 critic。

**更正 ④ 「全项目找不到录制调用」** —— 检索词选错（真实 API 是 `startRecording()`/`stopRecording()`）。结论侥幸正确。

**更正 ⑤ 「证据问题只是 4000 字符截断」** —— 严重低估，实为三处断点。

### v1.1 → v1.2

**作废 ③ 「`/(group)/grouped` 是伪路由」** —— v1.1 修正了方向，但**没有把结论贯彻到底**：既然 Pages Router 保留字面量目录名，那 Sentinel 输出 `/(group)/grouped` 就是**对的**，不该再算进"3 个伪路由"。
→ 伪路由 **3 → 2**（只剩 `/(.)photo`、`/@modal/photo`）；有效覆盖率 **33% → 44%**；真·已测 **3 → 4**。
→ 错因：改了事实却没回头重算所有依赖它的数字。

**作废 ④ 「HTML 报告只能从 midscene 抄」** —— 我只验证了 pr-agent 没有 HTML（确实没有），却没验证 cats。cats 有 `TestCaseExporterHtmlJs` / `HtmlOnly` / `HtmlJsCluster` 三个 HTML 导出器，且它的"导出器接口 + 各自附属文件"注册表模式**比 midscene 更贴合宪法要求的三格式**。
→ 错因：用一个负向结论（pr-agent 没有）替代了穷举核查（谁有）。

**更正 ⑤ 「有效覆盖率 33%」** —— 见上，作废 ③ 的连带修正。

**更正 ⑥ 「aria 树 6330 字符」作为通用阈值** —— 数字可复现（同夹具），但表述误导：阈值是"aria 树 > ~4000 字符"，另一种页面规模（3767 字符）就不触发。已改为三夹具对照表。

**更正 ⑦ 「24 个事件类型」** —— 实测 `EventType` 是 **28** 项。

**更正 ⑧ 上游路径与行号** —— schemathesis 缺 `src/schemathesis/` 前缀且 `specs/openapi/` 实为 `openapi/`；langfuse 缺 `packages/shared/src/server/otel/` 前缀；playwright-mcp 源码实为 `packages/playwright-core/src/tools/mcp`；宪法"回放器必须支持巡检通道"在 **275** 行（267 是守卫表行）；`doctor.ts` 的 HTML 消息在 **407** 行；`unplugin-vue-router` 是**归档**不是"已合并"。

**驳回 verifier ① 「stagehand 缓存无中生有」** —— 它只读了 README，没读 `packages/docs/v4/best-practices/caching.mdx:17`，那里确有该 Note。保留原表述。

---

## 9. 建议下一步

**第 0 块（最前，因为它决定退出码）**
1. **判定口径**：给 `isToolFailure` 补第三类 —— "这个 URL 是 Sentinel 自己生成的"不算被测项目缺陷。同时在 coverage 里标出这批"我们自己造的失败"。

**第 1 块（结构上修红线 4）**
2. **打通证据链**：让 `dom-snapshot` 真正入链（或明确删除这个空壳类型）；给 screenshot 一条真能看见的路（落盘 + 路径引用）；`formatEvidence` 改为"摘要 + 落盘路径"；报告层让 a11y / DOM 可展开；**并把"被 critic 驳回"与"未确认"在报告上区分开**。

**第 2 块**
3. **修路由约定**：先判 app/ 还是 pages/，再套对应约定；补齐五类约定；同步改 `isConcretePath`；加 app + pages 两套夹具。

**第 3 块**
4. **留回归案例**：5 类路由错误写进 `packages/adapters/test/nextjs.test.ts` + `benchmarks/cases/`（宪法红线 6）。

**单独排期（独立于路由修复）**
5. **动态路由取种子值** —— 覆盖率从 67% 走向 100% 的唯一路径，借鉴 cats 的 stateful replay。
6. **接上事件录制**（`bus.startRecording()` → NDJSON）—— 宪法红线 6 的存储载体 + "哪一步判错了"可查。
7. **HTML 报告**（midscene 单文件 + cats 导出器注册表）。
8. **根因聚类 + 证据去重**、**30% 限流口径**、**API 契约校验**、**回放指纹校验**。

以上全部**不碰 `packages/core/src/types.ts` 的类型数量、不新增依赖、不破离线模式**，都能用现有 `bun run lint:*` 与 `guard:offline` 守住。

---

## 10. v1.3：P0-A / P0-B / P0-C 已落地（2026-10-29 修复轮）

执行记录：[FIX-ROUND-2026-10-29.md](./FIX-ROUND-2026-10-29.md)。

| 块 | 状态 | 落地方式 |
|---|---|---|
| P0-A 判定口径补第三类 | ✅ 已落地 | `aggregate.ts` 新增 `sentinel-invalid-url` + `classifyBug()` 唯一口径；报告 / JSON / 退出码 / run-status 全部统一 |
| P0-B 证据链 | ✅ 已落地 | `dom-snapshot` 有真实生产者；截图落盘成 `reports/evidence/*.png`；`formatEvidence` 分类型结构化截断；`bug.rejected` 真的拦截 draft 入报告 |
| P0-C 路由约定 | ✅ 已落地 | `nextjs.ts` 按官方语义重写：**先判 app/ 还是 pages/，再套对应约定** |

### 更正 ⑨ 「路由组 / 并行槽 / 拦截路由是通用的目录约定」—— 只有 App Router 才有

落地时按 Next.js 官方文档逐条核对，发现这三类约定**全是 App Router 专属**：

- 官方 Intercepting Routes 页：`(.)` 同级 · `(..)` 上一级 · `(..)(..)` 上两级 · **`(...)` 从根 `app` 目录起**；
  且"(..) 基于**路由段**而不是文件系统层级"—— **路由组与并行槽都不算路由段**。
- 官方 Route Groups 页只存在于 `/docs/app/...`；官方 Pages Router 的 Pages and Layouts 页原文是
  "Each page is associated with a route based on its file name"、"nested folder structure ... routed in the same way"。

→ 结论：**Pages Router 的目录名就是 URL 段**，`pages/(marketing)/about.tsx` 的真实地址是 `/(marketing)/about`。
这与 v1.1 的更正 ③ 一致（"Pages Router 保留字面量目录名"），但 §2 P0-C 的落点描述里
"补齐五类约定"没有把这一点写死，落地时容易连 Pages Router 一起剥掉（本次第一版实现就踩了，已改回）。

→ 连带影响：**「Sentinel 自造地址」的判定不能认 `(` `)` `[` `]`** ——
Pages Router 的字面量目录段是**真实路由**，它 404 了就是项目缺陷。
第三类只认 `:id` / `:slug*` / `@slot` 这类"真实 URL 里不可能出现"的占位符。

### 更正 ⑩ 「(...) = 上两级」—— 官方语义是"从根目录起"

`(...)` 应回到 `app` 根，而不是固定上两级。深度 ≤2 时两种算法结果一致，深度 ≥3 时才会分叉
（本次实现按官方语义：`(...)` 直接清空当前路径段）。

### 尚未落地的部分（诚实记录）

- **模型仍然看不到截图**：`core/ports.ts` 的 `ChatMessage.content` 是 `string`，要支持图片必须改 core 端口
  （宪法红线 3 + core 行数 491/500）。本轮改为"落盘 + 如实标注模型未做视觉判读"。
- **动态路由仍不会被自动测**（§4.3 的覆盖率天花板）：需要"从动态路由派生一个可访问的具体 URL"，
  属独立排期项（借鉴 cats 的 stateful replay）。
- **路由约定只覆盖 Next.js**：Vue / React SPA 等适配器仍无 `routes()`，非 Next.js 项目仍需手写 `.sentinel/app.map.ts`。
