# 对标分析 v1.2 · 复核意见与实施就绪度评估

- 复核对象：`docs/GITHUB-BORROW-ANALYSIS-2026-10-29.md` / `Sentinel-对标GitHub借鉴分析-v1.2.html`
- 复核日期：2026-10-29
- 复核方式：第三方独立复核（非 v1.2 作者）；只采信可复现的证据
- 一句话结论：**方向成立、优先级大体成立；但 3 个 P0 目前不具备"照文档直接实施"的条件** —— 1 个环境阻断 + 2 个规格缺口。

---

## 0. 复核边界（先读这一节，否则会误读后文）

本次复核**没能读到 Sentinel 源码**。现象与证据：

| 检查 | 结果 |
|---|---|
| `ls -lO packages/reporters/src/aggregate.ts` | 文件大小为 `-`（iCloud 未落地的 dataless 文件） |
| `cat <repo>/package.json` | `Interrupted system call (EINTR)`，重试 20 次均失败 |
| 目录枚举（`os.listdir`，各层目录） | 一律 `EINTR`（会话沙箱禁止 `getdents`） |
| `brctl download` | `brctl: Trying to invoke brctl from a sandboxed process`（被沙箱拒绝） |
| 写入新文件到 `<repo>/docs/` | **成功**（可写不可读） |

因此本报告的性质是：

- ✅ 可复核并已复核：v1.2 的**内部一致性**（数字、编号、口径）、以及它在**公网可查的上游事实**（Next.js 官方文档与源码、GitHub 仓库元数据与 README 行号）。
- ❌ 无法复核：`packages/**` 的具体行号与代码片段、"11 条巡检规则 / 28 类事件 / 宪法第 275 行"、本机实跑数字、`cli/replay.ts` 是否真的实现了巡检通道。
- ⚠️ 因此本文**不含任何代码补丁**，只给"可执行的验收标准 + 待确认项"。凡涉及 Sentinel 内部行为的判断，均标注为"沿用 v1.2、未复核"。

**解除阻断（任选其一即可让下一轮直接进入实施）**：

```bash
# 方式 A：打成压缩包放到 Desktop（Desktop 会话可读、不可写）
cd "<repo>" && zip -qr ~/Desktop/sentinel-repo.zip . -x "node_modules/*" -x ".git/*"

# 方式 B：复制到非 iCloud 路径，并把会话工作目录指过去
cp -R "<repo>" /tmp/sentinel && cd /tmp/sentinel

# 方式 C：在本机（非沙箱）终端强制下载 iCloud 原件
brctl download -r "<repo>"
```

---

## 1. 结论摘要（按严重度）

| ID | 级别 | 结论 | 影响 |
|---|---|---|---|
| **F1** | 阻断 | 仓库不可读，3 个 P0 无法落地 | 实施前必须先解除 §0 的阻断 |
| **F2** | P0 | 44% / 67% / 100% 三个覆盖率数字**分母未定义**，且 67% 与正文给出的 9 行清单**不自洽** | 没有可复现的分母，就无法写验收标准，也无法判断"修完" |
| **F3** | P0 | v1.2 只在 `(group)` 上做了"先判 router 再套约定"，`@slot` / `(.)x` / `[...all]` / `[[...all]]` 仍按 App Router 语义一刀切 | P0-1 若照表实现，会把 4 类约定继续写错；这正是 v1.2 自己总结的那类错误 |
| **F4** | P1 | P0-0 标为"极轻（只改 reporters/aggregate.ts）"，但**判定"这条失败是不是我们自己造的"需要 provenance 贯通 5 个以上文件** | 排期会被低估；且 P0-0 对 P0-1 有隐藏依赖 |
| **F5** | P1 | "截图落盘 + 路径引用"**本身不解决"模型看不见"**：子代理若没有读取工具，路径 = 零信息 | P0-2 的核心目标（证据送达）会落空 |
| **F6** | P1 | 4000 字符截断的正确修法不是"放大阈值"，而是"分类型预算 + 结构保真截断 + **显式 truncated 标记**" | 否则模型仍会在残缺证据上断言根因，直接触碰红线 4 |
| **F7** | P1 | "被反方驳回的发现照样进报告"需要一个**一等公民的 findings 处置模型**，否则修复会散落成一堆 if | 报告语义与退出码都依赖它 |
| **F8** | P2 | 第 05 节 9 条清单与第 09 节行动清单**编号冲突**（`#3`/`#4` 指向不同对象），且 P2 三项在行动计划中缺席 | 读文档的人会对不上号 |
| **F9** | P2 | 上游引用复核 8 条：6 条通过、1 条部分通过、1 条**未通过**（playwright-mcp "已迁到 tools/mcp"） | v1.3 需作废或改标注 |
| **F10** | P2 | "44% 当前有效覆盖率"实际是**夹具的路由级有效率**，不是产品覆盖率 | 对外表述有夸大风险 |

---

## 2. 上游事实复核（8 条）

复核基准：公网仓库当前 HEAD（2026-10-29）。注意 v1.2 的结论基于其自身快照，若上游已变动，以"当时快照"为准 —— 但下列第 8 条不是快照差异，而是**当前 HEAD 也找不到该路径**。

| # | v1.2 的陈述 | 复核 | 证据 |
|---|---|---|---|
| 1 | App Router 路由组"只用于组织，不进 URL" | ✅ 通过（原文一致） | `nextjs.org/docs/app/.../route-groups`："…organizational purposes and should not be included in the route's URL path" |
| 2 | 剥离逻辑只在 App Router 分支；`@slot` 不产生 URL | ✅ 通过（源码级） | `next.js/packages/next/src/shared/lib/router/utils/app-paths.ts` → `normalizeAppPath()`：`isGroupSegment(segment)` 跳过、`segment[0] === '@'` 跳过；并行路由文档："do not affect the URL structure" |
| 3 | Pages Router 文档没有 route group 概念 | ✅ 通过（抽样 2 页命中 0） | `nextjs.org/docs/pages/building-your-application/routing` 及其 `dynamic-routes` 子页，grep `route group` = 0 |
| 4 | playwright-mcp `--caps` 在 `README.md:415` | ✅ 通过（行号精确命中） | 第 415 行：`| --caps <caps> | comma-separated list of additional capabilities…` |
| 5 | stagehand：`observe()` 返回选择器、凭据不进模型；本地浏览器下 `cache` 无效 | ✅ 通过 | README 注释：`observe() returns real selectors, so credentials never reach the model`；`caching.mdx`："With a local browser there is no Browserbase session to key against, so the cache option has no effect" |
| 6 | unplugin-vue-router 已归档（2026-02-24） | ✅ 通过（日期精确） | GitHub API：`archived: true`，`pushed_at: 2026-02-24T07:56:26Z` |
| 7 | chrome-devtools-mcp 设计原则两句引文 | ⚠️ 部分通过 | 第一句原样；第二句原文是 `return a file path or resource URI, never the raw data stream`（v1.2 漏了 `or resource URI`）。**同段还有一句关键例外**："Some MCP clients support a built-in handling of heavy assets e.g. directly displaying images. This *could* be an exception." —— 这条例外直接关系到 §5.3 的截图方案选型 |
| 8 | "playwright-mcp 实现已迁到 `tools/mcp`，引用要换位置" | ❌ **未通过** | `microsoft/playwright` 无 `tools/` 目录（API 404），`packages/` 下无 mcp 包；`microsoft/playwright-mcp` **未归档**、`pushed_at = 2026-10-22`、实现仍在自身 `src/`。建议 v1.3 标"作废/待证"并给出你所依据的具体仓库与 commit |

**未能复核（需仓库或需作者提供快照）**：cats 的 `ResponseSchemaValidator.java:185` / `TestCaseExporterHtmlJs` / `ReplayCommand.java:60`（未能在 GitHub 上唯一确定 "cats" 是哪个仓库）；midscene 压缩器、schemathesis 第三类判定、aider/pr-agent 的 30% 限流、rr 的 macOS 限制。

> 附带一条元建议：v1.2 反复强调"可复核"，那么"42 份源码直读"应当在附录给出 `(repo, path, line)` 三元组清单，否则读者无法复算这个数字 —— 标准要对别人用，也要对自己用。

---

## 3. 数字复核：44% / 67% / 100% 的分母

v1.2 给出的唯一清单是 9 行：**真·已测 4 + 伪·已测 2 + 真·跳过 3**。逐个口径试算：

| 口径 | 分母 | 分子 | 结果 | 与 v1.2 是否一致 |
|---|---|---|---|---|
| A. 所有被当作页面的条目（含伪路由） | 9 | 4 | **44.4%** | ✅ 与"44%"一致 |
| B. 去掉伪路由后的真实页面 | 7 | 4 | **57.1%** | ❌ 与"修完路由 67%"不一致 |
| C. 固定分母 9，并把 2 条伪路由"修成真实页面"计入已测 | 9 | 6 | **66.7%** | ⚠️ 需要假设"这 2 条其实是真实页面被写错了网址" —— 但正文明确说它们"根本不是页面"，**自相矛盾** |
| D. 夹具实际有 6 个静态真实页 + 3 个动态页 | 6 | 4 | **66.7%** | ⚠️ 需要夹具共 9 个真实页 —— 与"9 行清单里只有 7 个真实页"冲突 |
| E. 动态路由补种子后 | 7 | 7 | **100%** | ✅ 在 B 口径下成立；但在 D 口径下应是 9/9 |

**结论：只有 44% 可以被复现。67% 无论用 A/B/E 哪种口径都推不出来**，必须引入 C 或 D 的额外假设，而这两种假设都与正文其它表述冲突。

**建议（v1.3 必改）**：

1. 在文档里贴出夹具的**文件树 → 期望 URL 清单**（9 行，含每行的 `router` 与 `约定类型`）。
2. 定义唯一口径并写死：
   `有效覆盖率 = 已真实访问且被测的真实页面数 / 夹具中真实页面总数（含动态路由）`
   伪路由**不进分母**，单列为 `harness-synthetic`。
3. 按该口径重算三个数字，并在每个百分比后标 `(分子/分母)`，例如 `44%(4/9 旧口径) → 57%(4/7) → 100%(7/7)`。
4. 标题里的"当前有效覆盖率"改名为 **"夹具路由级有效率"**，避免被读成产品覆盖率（F10）。

---

## 4. 路由语义：v1.2 只把"同类问题"改对了一半（F3）

v1.2 最大的更正是"括号目录在两种 router 下含义相反"。**这个方法论是对的，但没有推广到其余四类约定** —— 表格把它们统一按 App Router 语义判了。

| 约定 | App Router 正确语义 | Pages Router 正确语义 | v1.2 表格的判定 | 依据 |
|---|---|---|---|---|
| `(group)` | 不进 URL | **普通目录，进 URL** | ✅ 已按 router 区分 | Next 官方文档（§2 第 1、3 条） |
| `@slot` | 不进 URL（平行槽） | **普通目录，进 URL** | ❌ 按 App 语义一刀切 | 并行路由文档 "do not affect the URL structure"；`app-paths.ts` 跳过 `@` 段 |
| `(.)x` | 拦截路由，不产生独立 URL | **普通目录名，进 URL** | ❌ 未区分 | 拦截路由文档 `(.)` |
| `[...all]` | 多段捕获 | **同样支持**（`pages/[...slug].tsx`） | ❌ 表格暗示仅 App | Pages Router 动态路由文档出现 `[...slug]` |
| `[[...all]]` | 可选捕获（含基路径） | **同样支持**（`pages/[[...slug]].tsx`） | ❌ 同上 | Pages Router 文档出现 `[[...slug]]` |

**还有三件 v1.2 没提、但实现 P0-1 一定会踩到的事**：

1. **混合路由**：Next 允许 `app/` 与 `pages/` 同时存在，不是二选一。适配器必须支持 `mode = 'mixed'`，并对同一路径冲突按 Next 的解析优先级（app 优先）取一个、同时记一条 warning。
2. **"不是页面"的排除表**：`pages/api/**`、`pages/_app|_document|_error|404|500`、`app/**/route.ts`（Route Handler，不是页面）、`app/**/{layout,template,loading,error,not-found}.tsx` 都不得进 FeatureMap。v1.2 的五类约定表不含排除规则。
3. **`src/` 前缀与根目录并存**：Next 官方原文 "`src/app` or `src/pages` will be ignored if `app` or `pages` are present in the root directory" —— 根目录优先、`src/` 整棵被忽略。适配器必须复刻这条规则，否则会凭空多出一批页面 —— 又一个"自己造错误"的来源。

---

## 5. 三个 P0 的实施规格（可直接当验收标准用）

### 5.1 P0-0 判定口径：补第三类

**v1.2 的处理**：在 `reporters/aggregate.ts:11-19` 与 `cli/run.ts:688` 加一类"我们自己造的失败"。
**复核意见（F4）**：这条被标为"极轻"，但判定"是不是我们造的"必须在**失败产生之前**就知道网址的来源，`aggregate.ts` 拿不到这个信息。最小闭环至少要碰：

```
adapters（标记 route.provenance: 'declared' | 'synthesized'）
  → mapper（合成/补全动态种子时置 synthesized）
  → runner（失败事件带上 routeId）
  → aggregate（按 provenance 分流）
  → run.ts（退出码）
  → reporters（单列一节）
```

**建议的数据模型**（最小改动版）：

```ts
type RouteOrigin = 'declared' | 'synthesized';   // declared = 来自项目本身（文件树/sitemap/出站链接）
type FailureOrigin = 'product' | 'harness' | 'unknown';

interface Target {
  routeId: string;          // 稳定 ID，替代用 URL 字符串做键
  url: string;
  origin: RouteOrigin;      // 新增
}
```

**判定规则（按优先级，避免把真实 404 误判成 harness）**：

1. `origin === 'synthesized'` 且该 URL 从未在任何声明来源中出现 → `harness`
2. `origin === 'declared'` → `product`（即使是 404，那也是项目的 404）
3. 溯源信息缺失 → `unknown`（**默认按 product 处理但不计入退出码**，并在报告里要求人工确认）
4. 退出码：`product` 的 confirmed 缺陷 > 0 → 非零；只有 `harness`/`unknown` → 0，并打印 `N 条为工具自身产生，已排除`

**验收用例**：

| 用例 | 期望 |
|---|---|
| 夹具含 2 条伪路由（`/(.)photo`、`/@modal/photo`），全部 404 | 退出码 = 0；报告出现"工具自造 2 条，已排除" |
| 真实页面 `/legacy` 返回 404（项目自身缺陷） | 仍判 `product`，退出码非零 |
| 动态路由种子缺失导致访问 `/blog/:slug` 字面量 | 判 `harness`，不计入缺陷 |

**风险**：如果只用"URL 里含 `:` 或 404"来判定，会把真实坏链误判为 harness。必须用 provenance，不能用状态码。

### 5.2 P0-1 路由解析

**判定顺序（先 router，后约定）**：

```ts
const hasApp   = exists('app/**/page.*')   || exists('src/app/**/page.*');
const hasPages = exists('pages/**/*.tsx')  || exists('src/pages/**/*.tsx');
const mode = hasApp && hasPages ? 'mixed' : hasApp ? 'app' : hasPages ? 'pages' : 'unknown';
```

**单一事实来源**：路由解析结果统一成结构化模式，`isConcretePath()` 只读结构，不再用正则二次判断（v1.2 说"要一起改"，这里进一步要求"只有一处")：

```ts
type Seg = { kind: 'static'; value: string }
         | { kind: 'param'; name: string }          // [slug]
         | { kind: 'catchAll'; name: string }       // [...rest]
         | { kind: 'optionalCatchAll'; name: string }; // [[...rest]]

interface RoutePattern { router: 'app' | 'pages'; segments: Seg[]; origin: RouteOrigin; }
const isConcretePath = (p: RoutePattern) => p.segments.every(s => s.kind === 'static');
```

**验收夹具（12 条，必须两边都跑）**：

| # | 文件 | 期望 URL |
|---|---|---|
| 1 | `app/(marketing)/pricing/page.tsx` | `/pricing` |
| 2 | `app/@modal/photo/page.tsx` | 无独立 URL |
| 3 | `app/(.)photo/page.tsx` | 无独立 URL（记为拦截目标） |
| 4 | `app/docs/[...parts]/page.tsx` | `/docs/*`（实例 `/docs/a/b`） |
| 5 | `app/shop/[[...rest]]/page.tsx` | `/shop` 与 `/shop/*` |
| 6 | `app/blog/[slug]/page.tsx` | `/blog/*`（单段） |
| 7 | `pages/(group)/grouped.tsx` | `/(group)/grouped` |
| 8 | `pages/@modal/photo.tsx` | `/@modal/photo` |
| 9 | `pages/docs/[...parts].tsx` | `/docs/*` |
| 10 | `pages/shop/[[...rest]].tsx` | `/shop` 与 `/shop/*` |
| 11 | `pages/api/health.ts`、`app/health/route.ts`、`pages/_app.tsx` | 均不产生页面 |
| 12 | `app/x/page.tsx` + `pages/x.tsx` | 单一 `/x`（app 优先）+ 一条冲突 warning |

**风险**：改路由会改变覆盖率基线与 `benchmarks/cases/` 的历史数字，需要一次性 re-baseline，并在 PR 里说明"数字变化来自口径修正，不是能力提升"。

### 5.3 P0-2 打通证据链

v1.2 的三处断点（DOM 空壳 / 截图不可见 / a11y 截断）都成立，但**修法要补一刀（F5）**：把大块证据换成"路径"，只有在**存在一条能读到该路径的通道**时才有意义。

**截图：三条路，建议按这个顺序做**

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A. 多模态直传 | 把 PNG 作为 image content 交给模型 | 信息最完整 | 需模型支持视觉；token 成本高；破坏"纯本地小模型"假设 |
| **B. 视觉摘要器（建议默认）** | 独立 subagent 读图，产出结构化描述（布局/可见文案/异常/遮挡），再进证据链 | 与模型能力解耦、可缓存、可测试 | 多一次模型调用 |
| C. 工具化按需取 | 给 analyst 一个 `read_evidence(path)` 工具 | 最通用、最省 token | 需要 tool-calling 循环，改动最大 |

推荐 `B 为默认 + A 作为 --caps vision 可选能力`（正好落在 v1.2 的第 8 条借鉴点"能力分级"上）；`C` 列为 P2。**无论选哪个，都必须先落盘**：`.sentinel/cache/<runId>/<evidenceId>.png`。

**DOM**：`<body> empty (textLength=0…)` 这个占位串说明"生产者缺失"。修法是让 runner 在页面访问后真正取 `document.documentElement.outerHTML` 落盘，再投影一份**结构摘要**（title / landmarks / 表单字段名 / 按钮 / 链接锚文本 / 可见文本 top-N）。

**截断：改"预算 + 保真 + 标记"三件事**

1. 预算按**证据类型**给，不按全局 4000：建议初值 `a11y 6000 字符 / dom 摘要 4000 / console 2000 / network 2000`（**注意**：`formatEvidence` 里的"37 字符固定前缀"其实随 `kind/source/hash` 长度变化，预算要定义在 payload 上，不是"前缀+4000"）。
2. 截断要"结构保真"：头 60% + 尾 20% + 结构摘要 20%；JSON 按数组元素截断，不要切在字符串/转义序列中间（现在的 `.slice(0, 4000)` 会切出非法 JSON 片段）。
3. **必须带 `truncated: true` 与 `originalSize`** —— 现在的模型根本不知道自己看到的是半棵树，却照常下根因断言；这一条比"截断本身"更接近红线 4。

**报告：findings 处置态（F7）**

```ts
type Disposition = 'confirmed' | 'draft' | 'rejected' | 'unverified';
interface Finding { id: string; disposition: Disposition; severity: Severity;
                    evidenceIds: string[]; critic?: { verdict: 'upheld'|'rejected'; reason: string; evidenceIds: string[] } }
```

- 报告分三块：**已确认**（进退出码）/ **未确认（仅供参考）**（不计入退出码）/ **已驳回（附录，附反方理由）**。
- `aggregate.ts` 里 `bug.draft` 无条件进报告的逻辑必须改成按 `disposition` 分流。

**验收（golden 测试，建议放 `packages/subagents/test/evidence.golden.test.ts`）**：

| # | 断言 |
|---|---|
| 1 | 任何证据序列化结果都不含 `data:image/png;base64`，也不含 `[image data; inspect separately]` |
| 2 | 每条被截断证据都带 `truncated=true` 与 `originalSize` |
| 3 | 单次 prompt 估算 token 不超预算；超预算时按"失败证据 > 项目证据 > 通过证据"降级，并记录丢弃清单 |
| 4 | DOM 证据长度 > 0 且包含 `<body`（防止空壳回归） |
| 5 | a11y 证据在失败路径**与**成功路径都产出（现在只在失败时产出） |
| 6 | 被 critic 驳回的 finding 不出现在"已确认"区，退出码不受其影响 |

---

## 6. 建议的 v1.3 修订清单（逐条可勾）

| # | 改动 | 位置 |
|---|---|---|
| R1 | 补夹具路由清单与唯一覆盖率口径，重算 44/67/100 | §02、§09 |
| R2 | `@slot` / `(.)x` / `[...all]` / `[[...all]]` 按 router 分列（采用 §4 表） | §04 |
| R3 | 补混合路由、`src/` 前缀、排除表三项 | §04、§05#1 |
| R4 | P0-0 成本从"极轻"改为"轻-中"，并注明依赖 provenance 数据模型 | §05#0 |
| R5 | 截图方案写成 A/B/C 三选一 + 推荐 B | §05#2、§08 |
| R6 | 截断修法改为"预算 + 保真 + truncated 标记" | §03、§05#2 |
| R7 | 增加 findings 处置态与报告三块结构 | §03、§05#2 |
| R8 | 统一编号：借鉴项 `B0..B8`、行动项 `A0..A4`，两者不再共用数字 | §05、§09 |
| R9 | 作废/改标注"playwright-mcp 已迁 tools/mcp" | §07、§09 |
| R10 | chrome-devtools 引文补 `or resource URI`，并保留"客户端可直接显示图片"的例外 | §03 |
| R11 | "44% 当前有效覆盖率"改名"夹具路由级有效率" | 头部指标、§02 |
| R12 | 附录补 42 份源码直读的 `(repo, path, line)` 清单 | 附录 |

---

## 7. 修订后的执行顺序（与 v1.2 的差异）

v1.2 主张 **0 → 2 → 1**（理由：证据链更便宜、不碰 core）。本次复核建议 **0 → 1 → 2**：

| 阶段 | 内容 | 理由 |
|---|---|---|
| 0（0.5 天） | P0-0 + provenance 最小闭环 | 立刻止血 CI 假红，投入产出比最高 |
| 1（1–2 天） | P0-1 路由表 + 单一解析器 + 12 条夹具 | 改动面是**单包**（adapters）+ 1 个判定函数；且它是"假 P1"的**源头** |
| 2（2–3 天） | P0-2 证据链（DOM 生产者 → 截图通道 → 预算/截断 → 报告处置态） | 跨 3 个包 + 提示词语义 + 报告层，是三者中改动面最大的；且它的收益是"结论质量"，不是"假红数量" |

分歧点说清楚：**如果团队当下更痛的是"模型结论不可信"而不是"CI 老是红"，那么 2 先行也合理**。但 v1.2 给出的"更便宜"这个理由不成立 —— 证据链是三件事里最贵的一件。

---

## 8. 无法复核清单（需要仓库可读后才能补）

1. `packages/subagents/src/analyst.ts:31` 的具体实现与 `4000`/`37` 两个数字
2. `packages/reporters/src/aggregate.ts:11-19`、`packages/cli/src/run.ts:688` 的实际逻辑
3. `cli/replay.ts` 是否真的完整实现巡检通道（v1.2 作废 ② 的依据）
4. "11 条巡检规则 / 28 类事件 / 宪法第 275 行 / doctor.ts:407"
5. 本机实跑的路由清单（9 条）与 a11y 三种夹具的字节数
6. `packages/adapters/src/frontend/nextjs.ts` 是否真的只有 App Router 分支剥离括号
