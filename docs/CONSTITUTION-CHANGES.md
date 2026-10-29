# 宪法变更记录

> 按版本从新到旧排列。

## v1.5 → v1.6（2026-10-29）

### why

本轮要让**模型真的看到截图**（P1-3）。以前截图只是证据里的一个路径字符串，
模型通道只认文本，analyst 只能如实写"模型未对该图做视觉判读"——
诚实，但等于白采：最有信息量的现场（页面长什么样）被挡在模型之外。

要让模型看图，就得让"图片"能随消息一起发出去，也就是要改 `ChatMessage` / `LLMProvider` 端口。
**而红线 3 写的是"子代理升级不能改 core"。**

这一条一直只有一句话，两个方向都能解释：
① 严格读：任何子代理相关的改动都不许碰 core → 那视觉能力只能靠类型强转硬塞，契约不落在端口上；
② 宽泛读：只要子代理逻辑写在 core 之外，随便改 core → 红线形同虚设。

所以本次不是"要不要破例"，而是**把这条红线说到能机检的程度**：
子代理的**逻辑**升级不许改 core；新增 provider 能力只能以**可选端口扩展**落地，
且必须同时满足红线 1（core 不依赖任何具体实现）、红线 2（总行数 ≤500），并按升级流程留档。

### what

| # | 条款 | v1.5 | v1.6 |
|---|---|---|---|
| 1 | 红线 3 | 只有一句"子代理升级不能改 core" | 补**执行口径**：子代理逻辑升级不许改 core；新增 provider 能力走**可选端口扩展**，core 只许加可选字段/类型定义，且不破红线 1/2 |
| 2 | 核心行数口径 | 763 / 491 | **770 / 494**（本轮给 `ports.ts` 加了视觉输入的端口定义，两个数都重新核过） |

**本轮实例（视觉输入）**：

- `packages/core/src/ports.ts`（+3 行，守卫口径 491 → 494）：
  `ChatMessage.images?: ContentImage[]` + `LLMProvider.supportsVision?: boolean` + `ContentImage` 类型。
  两者都是**可选**的 —— 不开视觉的 provider 与老测试桩一行都不用改。
- `packages/providers/src/llm/openai-compatible.ts`：`vision: true` 时按 OpenAI 官方
  `content: [{type:'text'},{type:'image_url',image_url:{url:'data:image/png;base64,…'}}]` 发图；
  关闭时图片被忽略（不发也不报错）。provider 不返回 usage 时，图片 token 也计入估算（记 0 = 预算护栏失效）。
- `packages/providers/src/llm/ollama-native.ts`：`vision: true` 时走 Ollama 原生 `images` 字段（base64 数组）。
- `packages/subagents/src/analyst.ts`：截图读盘 → base64 → 随消息附给模型；
  **只有真的附上了图**，文字描述才改成"已作为图片附给模型"，否则仍如实写"模型通道只支持文本"。
  最多 3 张、单张 ≤5MB、读失败跳过（不让整轮 run 挂）。
- `packages/cli/src/config.ts` + `run.ts` + `init.ts`：`llm.yml` 新增 `vision` 字段，
  默认 **false**（截图是本机现场内容，发给模型等于传出本机，必须用户显式同意）。

### impact

| 规范条款 | 红线 3 补执行口径；核心行数口径 770 / 494 |
|---|---|
| 守卫 | `lint:spec` 继续核对两个行数口径（改 core 不改宪法会直接报"文档口径与实际脱节"）；`lint:core`（纯度）、`lint:lines`（≤500）不变 |
| 未退化验证 | `lint:spec` 0 偏差；`lint:core` / `lint:lines` 通过；全量用例全绿；`guard:offline` 通过 |
| 向后兼容 | `images` / `supportsVision` 都是可选字段 —— 不开视觉的老 provider、老测试桩、老 `llm.yml` 全部照旧工作；截图仍落盘在 `reports/evidence/`，报告里仍能打开 |

**顺带记一条判断**（本轮的取舍，不是新条款）：
"截图传给模型 = 把本机现场内容传出本机"，所以 `vision` 默认关闭，
且 `llmConfigToYaml` 必须把它写回去 —— 否则"用 Web Settings 存一次配置"
就把这个开关悄悄抹掉，用户以为截图已经给模型了，实际一直在走纯文本通道
（与 v1.4 记的 `pricing` 被抹掉是同一类缺陷）。

## v1.4 → v1.5（2026-10-26）

### why

v1.4 让 Sentinel 能在"没有 LLM、没有网络"时检测出确定性错误。但那条承诺**只写在文档里**：

> "离线模式下一次外网请求都不许发"

这句话靠什么保证？靠实现里的自觉 —— `skipLlmProbe`（doctor 别探测）、`skipSearch`（别检索）。
自觉的问题是：第二次改代码就会漂移，漂了没人知道，而且**没有任何机制能发现它漂了**。

更严重的是，这件事在本项目里**有真实的失败先例**：v1.4 的开发过程中，
离线模式的报告出现了 `by_origin.llm = 1` 但 `llmRequests = 0` 的组合 ——
模型压根没参与，报告却把一条**启发式降级**的结论标成了"模型推断"。
这就是本项目最忌讳的形态：**报告说能做、实际没做**。
如果连"有没有偷偷联网"都只能靠自觉，那下一次失真会更难被发现。

所以本次的目标不是加功能，是把一句承诺变成**可核对的事实**：
守卫必须能从**被测进程之外**取证，并且守卫自己必须能失败。

### what

| # | 条款 | v1.4 | v1.5 |
|---|---|---|---|
| 1 | 红线 | 7 条 | **8 条**：新增「离线模式一次外网请求都不许发，且这条必须有机器守卫证明（不能靠自觉）」 |
| 2 | 离线模式章节 | 只写了"不许发外网请求" | 新增「断网守卫（红线 8）」小节：四步取证法、退出码、双向反证记录；新增「静态守卫（进 lint:spec）」小节：五类静态断言 |
| 3 | Evidence 诚实性规则 | 9 条 | **10 条**：新增「模型没参与就不能标成模型推断」—— `llmRequests = 0` 的运行里出现任何 `origin='llm'` 的结论即为失真 |
| 4 | 结论来源口径 | `origin` 两档（`rule` / `llm`） | **三档**（`rule` / `llm` / `heuristic`）：`heuristic` = 模型未参与的启发式判定 |
| 5 | 核心行数口径 | 747 / 487 | **763 / 491**（本轮给 `types.ts` 加了注释与字段，两个数都重新核过） |
| 6 | 离线案例回放 | 巡检通道无法回放 | 新增「离线案例要能回放」小节：回放器必须支持巡检通道，巡检夹具必须点名规则与严重级别 |

**顺带修掉的一个既有缺陷**：宪法标题一直写"6 条红线"，正文实际列了 7 条
（v1.4 加红线 7 时漏改标题）。本次升到 8 条，标题与内容一致。
另加了一条静态断言专门盯这个 —— 标题数字与实际条数不符时直接报错，
避免"读者按标题漏看真正生效的条款"。

代码侧实现（本次同步落地）：

- **断网守卫**（`scripts/check-offline-guard.mjs`，新）：复制零依赖夹具到临时目录 →
  macOS 用 `sandbox-exec` 真断网（只放行回环）→ 跑真实的 `sentinel run --offline` →
  核对出网记录 / `llmRequests` / `knowledgeRequests` / D1–D5 检出情况 / 报告口径。
  退出码 `0` 通过 / `1` 失败 / `2` 环境不具备。
- **出网探针**（`scripts/offline-guard-preload.mjs`，新）：用 `bun --preload` 从**外部**
  记录每一个出网请求（`fetch` / `http.request` / `https.request`），区分回环与非回环。
- **离线夹具**（`benchmarks/fixtures/offline-web-app/`，新）：零依赖的 Node http 服务，
  故意注入 5 个缺陷（D1–D5）并附真值表，另带 2 个"不是缺陷"的对照项用于查误报。
  答案唯一 —— 测出来了 = 守卫有效；没测出来 = 守卫失灵。
- **`origin` 三档**（`packages/core/src/types.ts` + `packages/subagents/src/analyst.ts` +
  `packages/reporters/src/{json,markdown}.ts`）：模型调用失败后降级出来的结论，
  `origin` 标 `heuristic` 而不是 `llm`；报告第 6 字段显示「启发式判定（未调用模型）」。
  未标 `origin` 的旧数据仍按 `llm` 处理（向后兼容）。
- **`lint:spec` 新增三组断言**（18/19/20）：离离开关 × 守卫脚本 × 夹具 × 结论口径、
  宪法红线计数 × 实际条数、宪法 core 行数口径 × 实际值。
- **离线案例入档**（`benchmarks/cases/2026-10-26-007-1..5.json`，新）：D1–D5 五条真实案例，
  每条都按真实产物逐字段对账（结论状态、证据数、修复方案标题/tier/score 全部对齐报告与 run-status）。
- **回放器支持巡检通道**（`packages/cli/src/replay.ts`）：新增 `channel: 'page.visited'`。
  离线发现来自 `page.visited` → `inspector`，和在线的 `flow.failed` → `analyst` 是两条路；
  回放器只支持后者时，巡检规则改坏了**没有回归保护**。
  新增 `selectRule`（一次 visit 命中多条规则时要指定看哪条）、
  `expected.rule`（规则改名/张冠李戴时靠标题关键词抓不住）、
  `expected.severity`（观察项冒充运行时故障时，根因状态判据抓不住）。
- **巡检通道夹具**（`benchmarks/replay/contract/2026-10-26-007-1..5.json`，新）：
  5 个夹具按夹具源码的真实注入构造现场快照，走 inspector 判定。
  planner 的 LLM 失败在巡检通道里是**预期**的（离线没有模型，方案走通用模板兜底），
  所以回放器不把它记成回放报错。

### impact

| 影响面 | 变化 |
|---|---|
| 代码 | 新增 12 个文件（守卫 / 探针 / 夹具 4 个 / 案例 5 个 / 回放夹具 5 个 / 新测试 1 个），改 7 个文件 |
| 规范条款 | 红线 7 → 8；Evidence 规则 9 → 10；`origin` 两档 → 三档；离线模式章节新增两个小节 |
| 守卫 | 新增 `bun run guard:offline`（红线 8，重守卫）；`lint:spec` 新增 3 组静态断言 |
| 未退化验证 | `lint:spec` 0 偏差；`lint:core` / `lint:lines` 通过；`bun run test` 349 用例全绿；`guard:offline` 通过 |

**守卫的双向反证**（必须能自己失败，否则等于没有守卫）：

| 反证 | 做法 | 结果 |
|---|---|---|
| 守卫能抓住联网 | 往离线路径注入 `fetch('https://example.com/leak-probe')` | 守卫报「发现 1 条非回环出网请求」，退出码 1 |
| 守卫能抓住漏检 | 把 inspector 的 `console-error` 规则关掉 | 守卫报「未检出 D1」，退出码 1 |
| 静态断言不是恒真 | 依次破坏离离开关 / `origin` 档位 / 红线计数 / 行数口径 / 删守卫脚本 / 删夹具 | 6 类破坏全部被 `lint:spec` 报错 |
| 回放夹具不是恒真 | 关掉 `console-error` 规则 | 巡检夹具报「没有命中指定的规则」，回放失败 |
| 静态断言能守住回放通道 | 删掉回放器的巡检通道 / 删掉夹具的 severity 期望 | 2 类破坏都被 `lint:spec` 报错 |

**过程中发现并补掉的一个判据漏洞**（值得单独记，因为它是"反证没反到位"的典型）：

第一次反证时，我把 `missing-lang` 规则的 `kind` 从 `observation` 改成 `error`，
期望夹具报退化 —— **它没报**。查下去才发现：判 `confirmed` 的条件是
「kind='error' **且** 带运行时错误证据」，而缺 lang 的证据是 `dom-snapshot`，不算运行时错误，
所以它仍然是 hypothesis，判据"正确地"没报警。

也就是说：**那次反证改错了地方，等于没反证**。
补上 `expected.severity` 后重做反证 —— 让观察项带上运行时错误证据真正冒充成已确认缺陷，
夹具立刻报出三条退化（根因状态、方案数、硬规则 tier）。

**教训：反证必须命中判据的真实通路，否则"守卫没报错"是假阳性。**

---

## v1.3 → v1.4（2026-10-26）

### why

项目的第二个目标：**让 Sentinel 在"没有本地 LLM、没有网络"的情况下也能检测出 web 项目的错误。**

v1.3 状态下这个目标**做不到**，卡在三处（全部有源码证据）：

| # | 阻碍 | 位置 | 后果 |
|---|---|---|---|
| 1 | 没配 `llm.yml` → `run` 直接 `return 1` | `packages/cli/src/run.ts` | 没有模型 = 连启动都不行 |
| 2 | `llm.yml` 缺失被 doctor 判成 blocking | `packages/cli/src/doctor.ts` | 同上，且无法绕过 |
| 3 | 检测只看"访问有没有失败" | `packages/subagents/src/runner.ts` + `browser.ts` | **页面返回 200 但内部在报错（JS 崩溃 / 资源 404 / 接口 5xx / 白屏）一条都测不出来** |

第 3 条是最要命的：它不是"少测了一类"，而是**最常见的一类错误完全测不到**。

### what

| # | 条款 | v1.3 | v1.4 |
|---|---|---|---|
| 1 | 红线 | 6 条 | **7 条**：新增「没有 LLM、没有网络也必须能检测；确定性检测能力不得依赖模型可用性」 |
| 2 | 新增章节 | — | **「离线模式（无 LLM、无网络也能检测）」**：触发方式、允许/禁止、结论口径、巡检规则表 |
| 3 | Self-Check 门禁 | 失败分两类 | 失败分**三类**：LLM 不可用（缺配置/配置非法/探不通）→ 不阻塞，整轮转离线 |
| 4 | Evidence 诚实性规则 | 7 条 | **9 条**：新增「结论来源必须可区分（`origin` = rule / llm）」与「巡检规则的确定性事实可标 confirmed，但必须带现场证据」 |
| 5 | 事件目录 | 24 个 | **25 个**：新增 `page.visited`（runner → inspector） |
| 6 | 核心类型 | — | `BugFinding` 新增可选字段 `origin?: 'rule' \| 'llm'`；`EventType` 新增 `page.visited` |

代码侧实现（本次同步落地）：

- **巡检器**（`packages/subagents/src/inspector.ts`，新）：10 条确定性规则，
  覆盖未捕获异常 / 控制台 error / 5xx / 4xx / 连接失败 / 空白页 / 慢响应 / 缺 lang / 缺 viewport / 缺标题 / 混合内容。
- **browser MCP 新增 `inspect` 工具**（`packages/providers/src/mcp/built-in/browser.ts`）：
  轻量页面快照（不含截图/DOM/a11y），并补上以前根本没采的 **`pageerror`（未捕获异常）**。
- **runner**：每次 `visit` 成功后发 `page.visited`，让巡检器看这次访问的现场。
- **离线模式**（`packages/cli/src/run.ts`）：`--offline` 开关 + 自动降级
  （无 LLM 配置 → 离线；LLM 探测失败 → **整轮**转离线，避免 4 个子代理各等 180s 超时）。
- **离线 LLM 桩**（`packages/providers/src/llm/offline.ts`）：调用即抛错，
  不返回任何内容 —— 杜绝"静默假装成功"。
- **verifier**：确定性规则判定（`origin='rule'`）不再强制要求代码片段 ——
  否则"白屏""混合内容"这类真故障会被误杀；模型推断仍必须同时给出代码证据与运行时证据。
- **报告与状态**：报告写明 `运行模式：离线`，第 6 字段标注「确定性规则判定」；
  `run-status.json` 写 `llmMode`。

### impact

| 影响面 | 变化 |
|---|---|
| 代码 | 新增 3 个文件（inspector / offline LLM 桩 / 巡检单测），改 8 个文件 |
| 规范条款 | 红线 6 → 7；Evidence 规则 7 → 9；事件 24 → 25；新增"离线模式"章节 |
| 守卫 | `lint:spec` 仍通过（新增事件已登记）；建议后续加守卫：离线模式不得发起外网请求 |
| 未退化验证 | 真实 run 验证（见下） |

**真实 run 验证（2026-10-26，注入缺陷项目）**

在 Next.js 示例项目的副本里注入 5 处已知缺陷，用 `sandbox-exec` 断网跑：

| 注入的缺陷 | 是否测出 | 报告里的形态 |
|---|---|---|
| D1 首页控制台 error | ✅ | P1 页面 / 控制台报错（confirmed，1 条 console 证据） |
| D2 图片 404 | ✅ | P2 请求 /definitely-missing-image.png 返回 404（confirmed，network 证据） |
| D3 客户端未捕获异常 | ✅ | P1 页面 /posts 抛出未捕获异常（confirmed，console 证据） |
| D4 `<html>` 缺 lang | ✅ | P3 缺少 lang 属性（hypothesis，2 条合并） |
| D5 接口 500 | ✅ | P1 API GET /api/posts returned 500（hypothesis，analyst 路径） |

断网沙箱（`deny network-outbound`）下：LLM 探测失败 → 自动转离线 →
`llmRequests: 0`、`knowledgeRequests: 0`、5 条发现全部产出。

**过程中发现并修掉的三个真问题**（都是"报告说能做、实际没做"的形态）：

1. **巡检时机太早** —— `networkidle` 在图片请求发出前就满足，404 漏报。
   改成 `load` → `networkidle` → 400ms 静默，三步都要。
2. **工作区包解析到 `dist/`** —— 改完 `browser.ts` 没重新构建就实跑，
   跑的是旧代码。**以后改完 provider 层的代码必须 `bun run typecheck` 再实跑。**
3. **离线模式下的措辞仍在说"LLM"** —— 离线时压根没有模型，
   但 tier 判定理由写着"LLM 原判 Tier 1"、补丁缺失理由写着"LLM 未产出"、
   报告第 11 字段标着"[LLM 原判 Tier 1，硬规则已降级]"。
   离线模式下这三处都是**假话**。现在按模式切换措辞：
   在线说"LLM"，离线说"方案模板"；补丁缺失原因离线写"离线模式没有模型生成补丁"。

---

## v1.2 → v1.3（2026-10-26）

### why

宪法 v1.2 的「一句话定义」是全仓库唯一的对外定义入口，但它把 5 个内部模块名当句子主语写
（功能地图 / 多源 Evidence / critic / 成本模型 / 分级权限）。
第一次接触这个项目的人读不懂它到底在说什么 —— 结果是「这项目到底是干什么的」这个最基本的问题，
无法从官方文档直接得到答案，只能靠口头转述。

这不是措辞偏好问题：文档入口的第一句话决定了外部读者能不能建立正确心智模型。

### what

| # | 条款 | v1.2 | v1.3 |
|---|---|---|---|
| 1 | 一句话定义 | 只有技术定义 | **保留技术定义原文不动**，在其下新增「白话说」小节：一句话讲清它是什么 + 黑话↔人话对照表 + 明确列出它不做什么 |
| 2 | 版本号 | v1.2 | v1.3 |

同批改动（属说明性文字，不涉及宪法条款）：

- `README.md` 顶部重写：先给人话开场（它是什么 / 跟"把报错贴给 AI 问一句"的区别 / 能做与不能做 / 术语对照表），英文技术描述下沉保留
- `docs/INDEX.md` 增加小白入口段，版本号同步
- `QUICK-START.md` 增加「它到底做了什么」说明

### impact

| 影响面 | 变化 |
|---|---|
| 代码 | 无 |
| 规范条款 | **无变化** —— 6 条红线、服务范围、11 字段、入口纪律、预算护栏等全部原文保留，未删改一条 |
| 文档 | `docs/CONSTITUTION.md` 升 v1.3；`docs/INDEX.md` / `README.md` / `QUICK-START.md` 同步 |
| 守卫 | 本次不新增任何声明型条款，只增加解释性文字；`bun run lint:spec` 必须仍通过 |
| 未退化验证 | 不涉及代码行为变更，无需重跑 benchmark；`bun run lint:spec` + `bun run test` 全绿即为验证 |

---

## v1.1 → v1.2

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
