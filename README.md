# Sentinel

> **一个帮你给网站项目做自动体检的工具**
> **A local debug agent that health-checks your web app for you.**

`v0.2.0` · 8 workspaces · MIT

> Local debug agent for web apps. It discovers safe read-only routes, runs browser flows, records evidence and coverage gaps, and proposes reviewable fixes when a root cause is supported.

> **Work in progress** — This project is not feature-complete. Feel free to fork, modify, and build on top of it.
> **项目进行中** —— 尚未功能完备，欢迎 fork、修改、或在它之上继续构建。

---

## 📖 双语说明 / How to read this README

**中文 / Chinese**

本文档每一节都是**中英对照**，有两种排法，全文统一：

- **段落**：中文段落在前，紧接着是对应的英文段落（用 **中文** / **English** 小标题标出）
- **表格、列表、目录树、命令**：**逐行对照** —— 同一格里中文在前、英文在后，用 ` / ` 分隔
  （内容与语言无关，重复写两份反而容易写歪，所以只写一份）

第一遍看只读中文即可；需要英文原话时，往下翻半屏就是对应段落。

**English**

Every section of this README is **bilingual**, in exactly two layouts, used consistently throughout:

- **Prose**: the Chinese passage comes first, immediately followed by its English counterpart
  (marked with the **中文** / **English** labels)
- **Tables, lists, directory trees, commands**: **paired line by line** — Chinese first, English
  after it in the same cell, separated by ` / `. The content is language-neutral, so writing it
  twice would only let the two copies drift apart.

Read the Chinese if you prefer; if you need the English wording, it is always half a screen below.

### 章节对照表 / Section map

| # | 中文 | English |
|---|---|---|
| 1 | [它到底是什么](#1-它到底是什么--what-it-is) | What It Is |
| 2 | [30 秒看看它长什么样](#2-30-秒看看它长什么样--30-second-preview-demo) | 30-Second Preview (Demo) |
| 3 | [5 分钟上手（Web 控制台）](#3-5-分钟上手web-控制台--5-minute-setup-web-console) | 5-Minute Setup (Web Console) |
| 4 | [自定义要测的流程](#4-自定义要测的流程--defining-your-own-flows) | Defining Your Own Flows |
| 5 | [对真实项目调试](#5-对真实项目调试--debugging-a-real-project) | Debugging a Real Project |
| 6 | [CLI 命令](#6-cli-命令--cli-commands) | CLI Commands |
| 7 | [`run` 的全部选项](#7-run-的全部选项--options-for-run) | Options for `run` |
| 8 | [支持的技术栈](#8-支持的技术栈--supported-stack) | Supported Stack |
| 9 | [完整工作流程](#9-完整工作流程--how-it-works) | How It Works |
| 10 | [它会往你项目里写什么](#10-它会往你项目里写什么--what-it-writes-to-your-project) | What It Writes to Your Project |
| 11 | [自动修复的 4 个 Tier](#11-自动修复的-4-个-tier--the-four-auto-fix-tiers) | The Four Auto-Fix Tiers |
| 12 | [报告的 11 个字段](#12-报告的-11-个字段--the-11-report-fields) | The 11 Report Fields |
| 13 | [当前状态（诚实版）](#13-当前状态诚实版--current-status-honest-version) | Current Status (Honest Version) |
| 14 | [离线模式（没有 LLM、没有网络也能用）](#14-离线模式没有-llm没有网络也能用--offline-mode) | Offline Mode |
| 15 | [常见报错](#15-常见报错--common-errors) | Common Errors |
| 16 | [开发者](#16-开发者--for-developers) | For Developers |
| 17 | [Requirements / License](#17-requirements--license) | Requirements / License |

---

## 1. 它到底是什么 / What It Is

**Sentinel 是一个帮你给网站项目做自动体检的工具。**
**Sentinel is a tool that health-checks your web app for you.**

你把正在开发的项目文件夹交给它，它自己把项目跑起来、用浏览器把页面一个个点开、把接口一个个调一遍，最后写出一份报告：**哪里坏了、为什么会坏、怎么修**。

You hand it the folder of the project you are working on. It runs the project itself, opens every page
in a real browser, calls every API endpoint, and writes a report: **what is broken, why it is broken,
and how to fix it**.

它跟你平时用的"把报错贴给 AI 问一句"最大的区别是：

The biggest difference from your usual "paste the error into an AI and ask" workflow:

| | 贴报错给 AI / Paste the error into an AI chat | Sentinel |
|---|---|---|
| 复现 / Reproduce | 你得自己描述怎么坏的 / You have to describe how it breaks | 它自己去跑一遍，把现场抓下来 / It runs the app and captures the scene itself |
| 结论 / Conclusion | AI 猜一个原因 / The AI guesses a cause | 有证据才敢下结论，没证据就写"证据不足" / It only concludes with evidence; otherwise it writes "insufficient evidence" |
| 有人把关 / Review | 没有 / None | 有个"反方"专门挑刺，防止它一本正经地胡说 / A built-in critic looks for holes in the conclusion |
| 改代码 / Changing code | 你自己动手 / You do it yourself | 小改动它可以自动改（改完不行会自己还原）/ Small fixes can be applied automatically, with auto-revert if the re-check fails |

**它替你做的四件事 / The four things it does for you**

1. **看懂你的项目** —— 扫出你有哪些页面、哪些接口、用什么框架搭的
   **Understand your project** — it maps out your pages, your API endpoints, and your framework.
2. **跑一遍，看哪里真的坏了** —— 自动开浏览器点页面、发请求，把报错现场都记下来
   **Run it and see what is actually broken** — it drives a real browser, issues real requests, and records every failure.
3. **找到真正的原因** —— 报错只是症状，它去找坏掉的那行代码
   **Find the real cause** — the error is only a symptom; it locates the line that is actually broken.
4. **给出能落地的修法** —— 一次给 3 个方案，按"改动小 / 风险低 / 见效快"排序告诉你推荐哪个
   **Propose a fix you can actually ship** — three options, ranked by "small change / low risk / fast to apply", with one recommendation.

**它能做什么、不能做什么 / What it does and does not do**

| ✅ 它能干 / It can | ❌ 它不干 / It does not |
|---|---|
| 找 bug，定位到具体代码位置 / Find bugs and point at the exact code | 不判断业务对错（"这个按钮该不该出现"它不知道）/ Judge business correctness — it does not know whether a button *should* be there |
| 小改动自动改，改完不行会自己还原 / Apply small fixes automatically, reverting if the re-check fails | 大改动只给建议，绝不自己动你的代码 / Touch large changes — it only suggests, it never edits them |
| 告诉你哪些地方根本没测到 / Tell you which parts were never exercised | 不替你决定产品该做什么 / Decide what your product should do |
| 每个结论都附带能核对的证据 / Attach checkable evidence to every conclusion | 证据不够时宁可说"不知道"，也不编一个根因 / Rather say "I don't know" than invent a root cause |
| **没有 LLM、没有网络也能测出确定性问题**（见第 14 节）/ **Detect deterministic problems with no LLM and no network** (section 14) | 离线模式下没有 AI 根因分析 / In offline mode there is no AI root-cause analysis |

**术语对照表 / Glossary**（第一次看只需要这一张 / this is the only table you need to read first）

| 文档里写的 / Term | 人话 / Plain meaning | 属于哪一步 / Step |
|---|---|---|
| FeatureMap（功能地图）/ Feature map | 你的项目长什么样：有哪些页面、哪些接口 / What your project looks like: which pages, which endpoints | 1 看懂项目 / Understand |
| Evidence（证据）/ Evidence | 真跑起来抓到的现场：500 报错、控制台红字 / The captured scene: a 500, a red console line | 2 跑一遍 / Run |
| root cause（根因）/ Root cause | 真正坏掉的那行代码，不是表面那个报错 / The line that is really broken, not the error you saw | 3 找原因 / Diagnose |
| hypothesis（假设）/ Hypothesis | 还不够证据，只能叫"猜测" / Not enough evidence yet — a guess, nothing more | 3 找原因 / Diagnose |
| critic / verifier（反方 / 复核）/ Critic, verifier | 专门挑刺的复核环节，防止 AI 胡说 / The step that tries to break the conclusion | 3 找原因 / Diagnose |
| cost model（成本模型）/ Cost model | 比较 3 个修法的"改动小 / 风险低 / 见效快" / Ranks the three options by effort, risk, and payoff | 4 给修法 / Fix |
| Tier（自动修复等级）/ Tier | 分 4 档：只报告 → 自动改 → 写补丁待你确认 → 只给建议 / Four levels: report only → auto-fix → patch for review → suggestion only | 4 给修法 / Fix |

---

## 2. 30 秒看看它长什么样 / 30-Second Preview (Demo)

**中文**

不需要任何 API Key：

```bash
git clone https://github.com/EthanLau1/Sentinel.git
cd Sentinel
bun install
bun packages/cli/src/index.ts run --demo
```

> ⚠️ **`--demo` 输出的是 3 个硬编码的示例报告，不是真的在找 bug。**
> 它只用来让你预览报告长什么样。真正的检测必须配 LLM。

**English**

No API key required:

```bash
git clone https://github.com/EthanLau1/Sentinel.git
cd Sentinel
bun install
bun packages/cli/src/index.ts run --demo
```

> ⚠️ **`--demo` prints 3 hardcoded sample reports — it does not detect anything real.**
> It exists so you can preview the report format. Real detection requires an LLM.

---

## 3. 5 分钟上手（Web 控制台）/ 5-Minute Setup (Web Console)

**中文**

**双击仓库根目录的 `start.command`** → 浏览器自动打开 http://127.0.0.1:4317

这个脚本会自动做这些事：首次运行装依赖 + 构建前端；把控制台放到后台跑（关掉终端不影响）；检测到已经在运行就直接打开浏览器，不会重复启动。**关闭：双击 `stop.command`。**

在 Web 控制台里：

1. **Settings** —— 填 LLM provider（API Key + 模型名），可以存成全局默认，所有项目共用
2. **Add Project** —— 选你的项目文件夹
3. **Run** —— 点一下，Sentinel 会：
   - 在你的项目里建 `.sentinel/` 目录，并**自动启动你的 dev server**（bun / pnpm / yarn / npm 都认）
   - 发现公开页面和安全的 GET 接口，跑浏览器 / API 断言
   - 把证据、发现、覆盖缺口、运行摘要写进你的项目
   - **只有证据支持根因时**才提修复建议
4. **看结果** —— bug 列表 → 点开看详情 → 看推荐修复和它的证据

**English**

**Double-click `start.command` in the repository root** → your browser opens http://127.0.0.1:4317

The script handles the rest: on first run it installs dependencies and builds the frontend; it runs the
console in the background (closing the terminal does not stop it); and if the console is already
running it just opens the browser instead of starting a second copy. **To stop it: double-click `stop.command`.**

In the web console:

1. **Settings** — set up your LLM provider (API key + model name). You can save it as the global default, shared by all projects.
2. **Add Project** — pick your project folder.
3. **Run** — one click, and Sentinel will:
   - create the `.sentinel/` directory in your project and **start your dev server for you** (bun, pnpm, yarn, and npm are all recognised)
   - discover public pages and safe GET endpoints, then run browser and API assertions
   - write evidence, findings, coverage gaps, and a run summary back into your project
   - **only propose a fix when the evidence supports a root cause**
4. **Read the result** — bug list → open a bug for details → see the recommended fix and the evidence behind it.

---

## 4. 自定义要测的流程 / Defining Your Own Flows

**中文**

自动发现的流程只覆盖公开页面。想测登录、发布、评论、设置这类真实业务，在你的项目里建 `.sentinel/app.map.ts`：

```ts
export default {
  flows: [
    {
      id: 'save-settings',
      description: 'A changed setting remains after reload',
      steps: [
        { action: 'visit', url: '/settings' },
        { action: 'fill', selector: '[name="displayName"]', value: 'Sentinel test' },
        { action: 'click', selector: 'button[type="submit"]' },
        { action: 'visit', url: '/settings' },
        { action: 'assert', kind: 'text', expected: 'Sentinel test' },
      ],
    },
  ],
};
```

显式写的 `flows` 会**替换**自动生成的基线流程；运行摘要里会写清楚哪些跑了、哪些没跑。
会改数据的流程请用**测试环境和一次性测试账号**。Sentinel 不会猜业务结果，也不会自动点"提交/删除"这类写操作。

**English**

Auto-discovered flows only cover public pages. To exercise real business flows — login, publishing,
comments, settings — create `.sentinel/app.map.ts` in your project:

```ts
export default {
  flows: [
    {
      id: 'save-settings',
      description: 'A changed setting remains after reload',
      steps: [
        { action: 'visit', url: '/settings' },
        { action: 'fill', selector: '[name="displayName"]', value: 'Sentinel test' },
        { action: 'click', selector: 'button[type="submit"]' },
        { action: 'visit', url: '/settings' },
        { action: 'assert', kind: 'text', expected: 'Sentinel test' },
      ],
    },
  ],
};
```

Explicit `flows` **replace** the generated baseline flows, and the run summary states exactly which
flows were executed and which were not. Use a **staging environment and a disposable test account**
for flows that change data. Sentinel does not guess business outcomes, and it never clicks
write actions such as "submit" or "delete" on its own.

---

## 5. 对真实项目调试 / Debugging a Real Project

**中文**

**跑之前，你的目标项目需要满足 3 个条件：**

1. 依赖已经装好（项目里有 `node_modules`）
2. `package.json` 里有 `dev` / `start` / `serve` / `dev:start` / `start:dev` 之类的脚本
   —— Sentinel 会自动用它把服务起起来；**如果服务已经在跑，它直接复用，并且不会杀你的进程**
3. 有 LLM API Key，或者本机装了 Ollama（免费）

```bash
# 1) 初始化（在目标项目里建 .sentinel/）
bun packages/cli/src/index.ts init --project=/path/to/your-app

# 2) 配置 LLM：编辑 /path/to/your-app/.sentinel/llm.yml
#    default: my-provider
#    providers:
#      my-provider:
#        type: openai-compatible
#        baseUrl: https://api.example.com/v1
#        apiKey: your-key-here
#        model: model-name

# 3) 自检：环境、配置、LLM 连通性、Playwright、预算护栏……
bun packages/cli/src/index.ts doctor --project=/path/to/your-app

# 4) 跑完整调试
bun packages/cli/src/index.ts run --project=/path/to/your-app

# 5) 看结果
cat /path/to/your-app/reports/sentinel-latest.md
```

**English**

**Before you run, your target project needs three things:**

1. Dependencies installed (the project has a `node_modules` directory)
2. A `dev` / `start` / `serve` / `dev:start` / `start:dev` script in `package.json`
   — Sentinel starts it for you; **and if the server is already running, it reuses it without killing your process**
3. An LLM API key, or a local Ollama install (free)

```bash
# 1) Initialize (creates .sentinel/ in the target project)
bun packages/cli/src/index.ts init --project=/path/to/your-app

# 2) Configure the LLM: edit /path/to/your-app/.sentinel/llm.yml
#    default: my-provider
#    providers:
#      my-provider:
#        type: openai-compatible
#        baseUrl: https://api.example.com/v1
#        apiKey: your-key-here
#        model: model-name

# 3) Self-check: environment, config, LLM connectivity, Playwright, budget guard…
bun packages/cli/src/index.ts doctor --project=/path/to/your-app

# 4) Run the full debug pipeline
bun packages/cli/src/index.ts run --project=/path/to/your-app

# 5) Read the result
cat /path/to/your-app/reports/sentinel-latest.md
```

---

## 6. CLI 命令 / CLI Commands

| 命令 / Command | 说明 / Description |
|---|---|
| `sentinel run` | 跑完整调试流程（主入口）/ Run the full debug pipeline (main entry point) |
| `sentinel doctor` | 自检：环境、配置、LLM 是否可用、预算护栏是否可执行 / Self-check: environment, config, LLM availability, whether the budget guard is executable |
| `sentinel map` | 只生成 FeatureMap（功能地图），不做诊断 / Generate the FeatureMap only, no diagnosis |
| `sentinel hello` | 只测 LLM 能不能连通 / Verify LLM connectivity only |
| `sentinel init` | 在目标项目里生成 `.sentinel/` / Create `.sentinel/` in the target project |
| `sentinel ui` | 启动本地 Web 控制台（默认 http://127.0.0.1:4317）/ Start the local web console (default http://127.0.0.1:4317) |
| `sentinel update` | 自更新 —— **目前是占位（M8.5 stub），还没真实现** / Self-update — **still a stub (M8.5), not implemented yet** |

---

## 7. `run` 的全部选项 / Options for `run`

| 选项 / Option | 说明 / Description |
|---|---|
| `--project <path>` | 目标项目根目录（默认当前目录）/ Target project root (defaults to the current directory) |
| `--demo` | 无 key 的演示流程，输出硬编码示例报告 / Keyless demo flow that prints hardcoded sample reports |
| `--detailed` | 把敏感证据（cookie / storage 等）也写进报告 / Include sensitive evidence (cookies, storage, …) in the report |
| `--no-enhance` | 跳过外部知识检索（跳过不影响出报告）/ Skip external knowledge search (reporting still works) |
| `--offline` | 强制离线：不调用 LLM、不联网（没配 LLM 时也会自动进入）/ Force offline: no LLM calls, no external network (auto-enabled when no LLM is configured) |
| `--tier <0\|1\|2\|3>` | 最高处理到哪一档（默认 3）/ Highest tier to process (default 3) |
| `--auto-fix` | 允许 Tier 1 真正修改你的源代码（**默认关**）/ Allow Tier 1 to actually modify your source code (**off by default**) |
| `--create-pr` | 为 Tier 2 修复建分支、提交、推送并开 PR（需要 `gh` CLI，**默认关**）/ Branch, commit, push, and open a PR for Tier 2 fixes (requires the `gh` CLI, **off by default**) |
| `--report <markdown\|json\|both>` | 报告格式，默认两种都出 / Report format; both by default |
| `--port <port>` | 显式指定 dev server 端口，跳过端口推断 / Explicit dev-server port; skips port inference |
| `--url <url>` | 显式指定被测地址，**完全跳过**自动启动 dev server / Explicit target URL; skips dev-server auto-start entirely |

> **默认它不会改你的代码。** 即使不加 `--auto-fix`，Tier 1 也只是把补丁写到 `.sentinel/auto-patches/` 里等你审阅。
> `--auto-fix` 打开后，改完会**重新验证一次**，验证不过自动还原。
> `--create-pr` 是**外部动作**（真的推分支、开 PR），只在显式加这个开关时才会发生。
>
> **By default it does not touch your code.** Even without `--auto-fix`, Tier 1 only writes a patch file
> to `.sentinel/auto-patches/` for you to review. With `--auto-fix`, the change is **re-verified
> afterwards** and automatically reverted if the re-check fails. `--create-pr` performs **real external
> actions** (pushing a branch, opening a PR) and only happens when you pass the flag explicitly.

### 退出码 / Exit codes

**中文**

| 退出码 / Code | 含义 / Meaning |
|---|---|
| `0` | 跑完了，没发现 P0/P1 问题 / Finished; no P0/P1 issue found |
| `1` | 跑完了，发现了 P0 或 P1 问题 / Finished; a P0 or P1 issue was found |
| `2` | **没跑完**：配置非法、dev server 起不来、浏览器 preflight 失败、有流程失败却没产出诊断，或**一个流程都没跑**（`plannedFlows = 0`）/ **Did not finish**: invalid config, dev server unreachable, browser preflight failed, a failed flow produced no diagnosis, or **not a single flow ran** (`plannedFlows = 0`) |

> `2` 说的是"这次的结果不可信"，不是"你的项目有 2 个问题"。
> `sentinel doctor` 也用这套语义：**阻塞项**失败 → `1`；只有**非阻塞项**（比如没配 LLM）→ `0`，
> 并且提示文案会写明"不阻塞 run"—— 提示和实际行为必须一致。
>
> **Code `2` means "this result is not trustworthy", not "your project has two problems".**
> `sentinel doctor` follows the same convention: a **blocking** failure exits `1`; only
> **non-blocking** items (e.g. no LLM configured) exit `0`, and the wording says so explicitly —
> the message must match what actually happens.

---

## 8. 支持的技术栈 / Supported Stack

**中文**

先说清楚一句：**Sentinel 只在 Next.js 上能自动找出"该点哪些页面"。**
其它框架它能**认出技术栈**，但不会自动列出页面和接口 —— 那种项目跑出来是
**0 个流程、0 个 bug**。这**不代表你的项目没问题**，只代表 Sentinel 这次**没有可测目标**。
报告里现在会直接把这件事写出来（见本节末尾「0 个 bug 到底意味着什么」）。

下面这张表是**逐栈的真实能力**，不是"我们支持这个框架"的客套话。

**English**

Up front: **Sentinel only auto-discovers which pages to visit on Next.js.**
For other frameworks it recognizes the stack, but it does not enumerate pages or APIs — those
projects produce **0 flows and 0 bugs**. That does **not** mean your project is fine; it means
Sentinel had **no measurable target** this time. The report now states this explicitly
(see "What '0 bugs' really means" at the end of this section).

The table below is the **per-stack reality**, not a list of frameworks we nod at.

| 技术栈 / Stack | 识别依赖 / Detects | 自动发现页面与接口 / Auto-discovers pages & APIs | 开箱即用 / Works out of the box |
|---|---|---|---|
| Next.js（pages / app router） | ✅ | ✅ | ✅ 唯一开箱即用 / the only one |
| React（CRA / Vite SPA） | ✅ | ❌ | ❌ 需手写 `app.map.ts` / needs `app.map.ts` |
| Vue / Nuxt | ✅ | ❌ | ❌ 需手写 `app.map.ts` / needs `app.map.ts` |
| Svelte / SvelteKit | ✅ | ❌ | ❌ 需手写 `app.map.ts` / needs `app.map.ts` |
| Express / Hono / NestJS | ✅ | ❌ | ❌ 需手写 `app.map.ts` / needs `app.map.ts` |
| tRPC | ✅ | ❌ | ❌ 需手写 `app.map.ts` / needs `app.map.ts` |
| Prisma | ✅ | 仅数据模型 / schema only | — |
| Drizzle / Supabase | ✅ | ❌ | — |
| Vercel AI SDK / LangChain | ✅ | ❌ | — |

**不服务 / Not covered**：iOS / Android 原生 / native apps、嵌入式与硬件 / embedded and hardware、桌面应用（Electron 仅基本支持）/ desktop apps (Electron only basic support)、游戏引擎 / game engines、操作系统与驱动 / operating systems and drivers。

### 非 Next.js 项目怎么测 / How to test a non-Next.js project

**中文**

在项目里建 `.sentinel/app.map.ts`，告诉 Sentinel 该测哪些页面。写坏了会**直接报错**
（以前是静默失败 → 你会拿到 0 个页面却不知道为什么）。

```ts
export default {
  pages: [
    { id: 'home', path: '/', title: '首页' },
    { id: 'pricing', path: '/pricing', title: '价格' },
  ],
  flows: [
    {
      id: 'pricing-visible',
      description: '价格页能打开且有内容',
      steps: [
        { action: 'visit', url: '/pricing' },
        { action: 'assert', kind: 'visible', selector: 'body' },
      ],
    },
  ],
};
```

**English**

Create `.sentinel/app.map.ts` in the project and tell Sentinel which pages to test. A broken
file now **fails loudly** (it used to fail silently, leaving you with 0 pages and no clue).

```ts
export default {
  pages: [
    { id: 'home', path: '/', title: 'Home' },
    { id: 'pricing', path: '/pricing', title: 'Pricing' },
  ],
  flows: [
    {
      id: 'pricing-visible',
      description: 'Pricing page opens and has content',
      steps: [
        { action: 'visit', url: '/pricing' },
        { action: 'assert', kind: 'visible', selector: 'body' },
      ],
    },
  ],
};
```

### 0 个 bug 到底意味着什么 / What '0 bugs' really means

**中文**

报告开头有一节「覆盖范围」，写明这次识别到几个页面、几个接口、跑了几个流程。
两种"0 个 bug"完全不同：

- `覆盖范围` 里 **planned flows > 0** → 这次真的测过了，没发现 P0/P1 问题
- `覆盖范围` 里 **planned flows = 0** → 这次**什么都没测**，报告顶部会挂一条橙色警告
  **0 个 bug 不代表项目健康**，请先让它找到可测目标（或手写 `app.map.ts`）

`reports/sentinel-run-status.json` 里的 `plannedFlows` 是同一个口径，CI 可以直接判它。

**English**

Every report opens with a "Coverage" section stating how many pages, APIs and flows were found.
The two kinds of "0 bugs" are not the same thing:

- **planned flows > 0** → Sentinel really tested something and found no P0/P1 issue
- **planned flows = 0** → Sentinel tested **nothing**; the report carries an orange warning that
  **0 bugs does not mean the project is healthy**. Give it a measurable target first
  (or write `app.map.ts` by hand)

`plannedFlows` in `reports/sentinel-run-status.json` is the same figure; CI can gate on it.

---

## 9. 完整工作流程 / How It Works

```
Mapper → Runner + Browser/HTTP → Inspector → Analyst → Critic → Verifier → Planner → Enhancer → Executor
```

对着人话看这 9 步（每一步只干一件事）/ The nine steps in plain language (each one does a single job):

| 步骤 / Step | 人话 / Plain meaning |
|---|---|
| Mapper | 先把你的项目读一遍：有哪些页面、哪些接口、用什么框架搭的 / Read your project first: which pages, which endpoints, which framework |
| Runner | 真的去点页面、发请求，把出错的现场抓下来当证据 / Really click the pages, send the requests, capture the failure as evidence |
| Inspector | 访问成功≠没毛病：每次打开页面都按 11 条规则巡一遍现场（控制台报错 / 未捕获异常 / 404 / 5xx / 白屏 / 缺 lang） / A successful load does not mean a healthy page: every visit is inspected against the eleven rules |
| Analyst | 看证据，猜一个"可能是这里坏了" / Look at the evidence, propose what may be broken |
| Critic | 反方：证据真的支持这个猜测吗？ / The adversary: does the evidence really support that guess? |
| Verifier | 复核：证据够不够下结论？不够就退回"假设" / The check: is the evidence enough to conclude? If not, it stays a hypothesis |
| Planner | 给 3 个修法，按"改动小 / 风险低 / 见效快"排序 / Propose three fixes, ranked by effort, risk, and payoff |
| Enhancer | 必要时去查官方文档补充外部知识（`--no-enhance` 可关掉）/ Optionally consult official docs for extra knowledge (`--no-enhance` turns it off) |
| Executor | 写补丁文件供你审阅（**只写补丁，不直接改你的代码**）/ Write the patch file for your review (**writes a patch, never edits your code directly**) |

---

## 10. 它会往你项目里写什么 / What It Writes to Your Project

```
your-app/
├── .sentinel/                       ← 项目自己的配置与中间产物 / this project's own config and intermediates
│   ├── llm.yml                      ← LLM 配置（可覆盖全局设置）/ LLM config (overrides the global one)
│   ├── budget.yml                   ← 预算与护栏上限 / budget and guard limits
│   ├── app.map.ts                   ← 你手写的项目映射（可选）/ your hand-written project map (optional)
│   ├── app.map.generated.json       ← 自动生成的 FeatureMap / the generated FeatureMap
│   ├── auto-patches/                ← Tier 1 补丁（.diff）/ Tier 1 patches (.diff)
│   └── cache/                       ← 证据缓存 / evidence cache
├── reports/
│   ├── sentinel-latest.md           ← Markdown 报告 / Markdown report
│   ├── sentinel-latest.json         ← JSON 报告 / JSON report
│   ├── patches/                     ← Tier 2 补丁（.patch）/ Tier 2 patches (.patch)
│   └── suggestions/                 ← Tier 3 建议（.md）/ Tier 3 suggestions (.md)
└── .sentinel/runs/webui.json        ← Web 控制台的运行历史 / web console run history
```

全局配置（项目列表 + 默认 LLM 连接）在 `~/.sentinel/` 下，**不会被复制进你的项目**。
The global config (project list and default LLM connection) lives under `~/.sentinel/` and is
**never copied into your project**.

---

## 11. 自动修复的 4 个 Tier / The Four Auto-Fix Tiers

| Tier | 含义 / Meaning | 实际行为 / Actual behaviour | 落盘位置 / Where it lands |
|---|---|---|---|
| 0 | 只观察 / Observe only | 只记录，不生成补丁 / Records only, generates no patch | — |
| 1 | 自动修 / Auto-fix | 改代码**需要** `--auto-fix`；否则只写补丁等你审阅 / Modifying code **requires** `--auto-fix`; otherwise it only writes a patch for review | `.sentinel/auto-patches/<id>.diff` |
| 2 | 待你确认 / Needs review | 写补丁；加 `--create-pr` 会真的建 PR / Writes a patch; with `--create-pr` it opens a real PR | `reports/patches/<id>.patch` |
| 3 | 仅建议 / Suggestion only | 只出建议文档，绝不动代码 / Writes a suggestion document, never touches code | `reports/suggestions/<id>.md` |

手动应用 Tier 1 补丁 / Apply a Tier 1 patch by hand：

```bash
cd /path/to/your-app
git apply .sentinel/auto-patches/<fixId>.diff
```

哪一档由**硬规则**决定，不靠模型自己说。
The tier is decided by **hard rules**, not by whatever the model claims.

---

## 12. 报告的 11 个字段 / The 11 Report Fields

每份 bug 报告固定包含 / Every bug report always contains these eleven fields:

Bug ID · 严重级别（P0–P3）/ Severity (P0–P3) · 影响功能 / Affected feature · 复现步骤 / Reproduction steps ·
证据引用 / Evidence references · 根因判断（假设 / 已确认）/ Root cause status (hypothesis / confirmed) ·
**推荐方案** / **Recommended fix** · 备选方案 ×2 / Two alternatives · 风险评估 / Risk assessment ·
验证命令 / Verification command · 是否可自动修（Tier）/ Whether it can be auto-fixed (tier).

字段内容为空时也会照样输出标题并写明"待产出"，不会整段跳过 —— 跳过会让"没产出"看起来像"不需要"。
When a field has no content, the heading is still printed with an explicit "not produced yet"
note rather than the whole section being dropped — dropping it would make "not produced" look
like "not needed".

---

## 13. 当前状态（诚实版）/ Current Status (Honest Version)

**已经能用 / Working today**

- 完整跑通"发现 → 取证 → 诊断 → 复核 → 给方案 → 出报告"这条链路
  The whole chain works: discover → capture evidence → diagnose → review → propose → report.
- Markdown + JSON 两种报告格式，11 个字段齐全
  Markdown and JSON reports, all eleven fields present.
- Tier 1 自动修复（需 `--auto-fix`，带验证与自动还原）
  Tier 1 auto-fix (requires `--auto-fix`, with verification and auto-revert).
- Tier 2 建 PR（需 `--create-pr` + `gh` CLI）
  Tier 2 pull request (requires `--create-pr` plus the `gh` CLI).
- Web 控制台：项目列表、设置、运行、报告查看
  Web console: project list, settings, run, report viewer.
- **报告里有「覆盖范围」区块**：识别到几个页面/接口、跑了几个流程、哪些没测到
  一眼能分清"测过了没问题"和"压根没测到东西"
  **The report carries a "Coverage" section**: pages/APIs discovered, flows executed, gaps left —
  so "tested and clean" and "never measured anything" are told apart at a glance.
- **真实 run 的 JSON 报告顶层有 `coverage` 字段**，CI 可以直接判 `plannedFlows == 0` 并让流水线失败
  （`--demo` 是硬编码假数据，没有真实覆盖，因此不带 `coverage`）
  **A real run's JSON report has a top-level `coverage` field**, so CI can gate on
  `plannedFlows == 0` and fail the pipeline instead of reading "0 bugs" as "all good"
  (`--demo` is hardcoded sample data with no real coverage, so it carries no `coverage`)
- 自检门禁：配置坏了直接拒绝启动；外部服务不通则降级但不阻塞
  Self-check gate: a broken configuration blocks the run outright; an unreachable external
  service degrades instead of blocking.
- **退出码有明确语义**：`0` 干净 / `1` 发现 P0·P1 / `2` 没跑完（结果不可信）
  **Exit codes are explicit**: `0` clean / `1` a P0·P1 was found / `2` did not finish (result untrustworthy)
- **浏览器依赖进安装流程**：`bun run setup` 装 Playwright Chromium；`doctor` 借用系统 Chrome 时判 warn 而不是 OK
  **The browser dependency is part of setup**: `bun run setup` installs Playwright Chromium;
  `doctor` reports "borrowing system Chrome" as a warn, not as OK
- **dev server 复用前三重校验**：HTTP 能不能访问、服务是不是本项目、子进程真实报错
  端口被别的项目占着时不会再"误判为已启动"
  **Dev-server reuse is triple-checked**: HTTP reachability, is-it-actually-this-project, and the
  child's real error output — a port held by another project is no longer mistaken for "already running"
- **离线模式**：没有 LLM、没有网络也能检测（见第 14 节）
  **Offline mode**: detects problems with no LLM and no network at all (see section 14).
- **离线模式有机器守卫**：断网实跑验证"一次外网请求都不发"（`bun run guard:offline`）
  **The offline mode has a machine guard**: a real disconnected run proves that not a single
  outbound request is made (`bun run guard:offline`).

**还没有 / 只是占位 / Not there yet**

- **HTML 报告未实现** —— 目前只有 Markdown 和 JSON，文档里不宣称"三格式已满足"
  **No HTML report** — only Markdown and JSON today; the docs do not claim three formats.
- **`sentinel update` 是占位** —— 自更新（skills / adapters / 缓存）还没真做
  **`sentinel update` is a stub** — skills / adapters / cache self-update is not implemented.
- **`--demo` 是硬编码假数据** —— 不做任何真实检测
  **`--demo` is hardcoded fake data** — it performs no real detection.
- 知识增强按方案平均置信度决定要不要查（低于 0.7 才查）
  Knowledge enhancement triggers a lookup when the average confidence of the fix options is below 0.7.
- **离线模式没有 AI 根因分析** —— 只有确定性规则判定，报告里会写明
  **Offline mode has no AI root-cause analysis** — only deterministic rules apply, and the
  report says so explicitly.
- **离线模式给不出针对性的修法，也落不了 patch** —— 修复方案只有通用模板
  （"快速修复（绕过/补丁）"这类），因为没有模型来写具体补丁；报告第 11 字段会写明原因
  **Offline mode offers no targeted fix and cannot land a patch** — the fix options are generic
  templates ("quick fix (workaround / patch)" and the like), because no model writes a concrete
  patch; field 11 of the report states the reason.
- **只有 Next.js 能自动发现页面和接口** —— 其余 12 个栈只识别依赖，
  需要你手写 `.sentinel/app.map.ts` 才有可测目标（见第 8 节的能力矩阵）
  **Only Next.js auto-discovers pages and APIs** — the other 12 stacks are recognized but
  produce no measurable target until you write `.sentinel/app.map.ts` by hand
  (see the capability matrix in section 8)
- **知识增强没有"每次 run 最多 30% 流程"的上限** —— 宪法要求 ≤30%，但当前实现只看
  方案平均置信度（低于 0.7 就查），**没有按流程比例限流**。
  文档不宣称这个上限已生效（已知未修项，记在 `scripts/spec-sync-baseline.json`）
  **Knowledge enhancement has no "at most 30% of flows per run" cap** — the constitution requires
  ≤30%, but the implementation only looks at the average confidence of the fix options
  (below 0.7 triggers a lookup); there is no per-run flow-ratio limit. The docs do not claim
  this cap is in effect (it is a known open item, tracked in `scripts/spec-sync-baseline.json`).

---

## 14. 离线模式（没有 LLM、没有网络也能用）/ Offline Mode (No LLM, No Network)

**中文**

**没有模型、没有外网，也能测出项目的问题。**

这是 Sentinel 的目标之一：巡检（inspection）是**确定性规则**，不依赖任何模型。
以前只检查"页面访问有没有失败"，所以"页面返回 200 但页面里在报错"这一整类问题**一条都测不出来** ——
而那恰恰是最常见的一类。

**怎么进入离线模式 / How offline mode is entered**

| 方式 / Way | 条件 / Condition |
|---|---|
| 显式 / Explicit | `sentinel run --offline`（忽略 llm.yml） |
| 自动 / Automatic | 没有配置任何 LLM（项目级与全局都没有） |
| 自动 / Automatic | LLM 探测失败（探不通 / key 失效 / 断网）→ **整轮**转离线 |

> 探测失败要**整轮**转离线：子代理的 LLM 超时是 180s，让 4 个子代理各降级一次 = 白等十几分钟。
> 一次探测（10s 超时）判死活，然后全轮走离线路径。

**离线模式下会做什么 / What still happens offline**

- ✅ 扫出你的页面和接口、起你的 dev server、用真浏览器逐页访问
- ✅ 巡检每一页的现场，按规则判定问题
- ✅ 出报告（11 个字段齐全），修复方案用通用模板给出
- ❌ 不调用任何模型（没有 AI 根因分析）
- ❌ 不做任何外部检索（`--no-enhance` 自动开启）
- ❌ **一次外网请求都不发**

**巡检规则（11 条）/ The eleven inspection rules**

| 规则 / Rule | 判定 / Detects | 级别 / Severity |
|---|---|---|
| `uncaught-exception` | 页面抛出未捕获异常（JS 崩了） | P1 |
| `console-error` | 控制台输出 error | P1 |
| `server-error` | 子资源 / 接口返回 5xx | P1 |
| `request-failed` | 请求连接失败（拒绝 / 超时） | P1 |
| `blank-page` | 页面有响应但什么都没渲染出来（白屏） | P1 |
| `client-error` | 子资源 / 接口返回 4xx（如图片 404） | P2 |
| `mixed-content` | https 页面里加载 http 资源 | P2 |
| `slow-response` | 响应超过 3000ms | P3 |
| `missing-lang` / `missing-viewport` / `missing-title` | 基础可访问性与 SEO 缺失 | P3 |

前 7 条是**运行时事实**（有现场证据，报告里标 confirmed）；后 3 类是**质量观察**（只作假设）。

**English**

**No model, no internet — and it still finds your project's problems.**

This is one of Sentinel's goals: inspection is **deterministic rules**, not model output.
The old pipeline only looked at "did the page load", so everything of the form *"the page returned
200 but the page itself is broken"* went **completely undetected** — and that is the most common
class of bug there is.

**How offline mode is entered**

| Way | Condition |
|---|---|
| Explicit | `sentinel run --offline` (ignores llm.yml) |
| Automatic | No LLM configured anywhere (project-level or global) |
| Automatic | The LLM probe fails (unreachable / bad key / no network) → **the whole run** goes offline |

> A failed probe must switch the **whole run** offline: the agent LLM timeout is 180s, so letting
> four agents each degrade on their own means waiting many minutes for nothing. One probe (10s
> timeout) decides, and then the entire run takes the offline path.

**What still happens offline**

- ✅ Scans your pages and endpoints, starts your dev server, visits every page in a real browser
- ✅ Inspects each page and judges it against the rules
- ✅ Produces a report with all eleven fields; fix options use generic templates
- ❌ No model is called (no AI root-cause analysis)
- ❌ No external lookups (`--no-enhance` is implied)
- ❌ **Not a single outbound request**

**The eleven inspection rules**

| Rule | Detects | Severity |
|---|---|---|
| `uncaught-exception` | An uncaught exception (JS crashed) | P1 |
| `console-error` | A console error | P1 |
| `server-error` | A sub-resource or endpoint returning 5xx | P1 |
| `request-failed` | A request that failed to connect (refused / timeout) | P1 |
| `blank-page` | The page responds but renders nothing | P1 |
| `client-error` | A sub-resource or endpoint returning 4xx (e.g. a missing image) | P2 |
| `mixed-content` | An http resource loaded by an https page | P2 |
| `slow-response` | A response slower than 3000ms | P3 |
| `missing-lang` / `missing-viewport` / `missing-title` | Missing basic accessibility and SEO | P3 |

The first seven are **runtime facts** (they carry scene evidence and are marked confirmed in the
report); the last three are **quality observations** (reported as hypotheses).

**怎么确认这次跑的是离线 / How to confirm a run was offline**

```bash
# 报告和状态文件里都会写明
grep 运行模式 reports/sentinel-latest.md
grep llmMode reports/sentinel-run-status.json
```

**"一次外网请求都不发"这句话有守卫吗？ / Is "not a single outbound request" actually enforced?**

**中文**：有。这条是宪法**红线 8**，并且有专门的守卫脚本证明它 ——
不是靠实现里的自觉。

```bash
bun run guard:offline
```

守卫做四件事，**每件都从被测进程外面取证，不信代码自报**：

| 步骤 | 做法 |
|---|---|
| 1. 准备 | 把零依赖夹具 `benchmarks/fixtures/offline-web-app/`（故意注入 5 个缺陷）复制到临时目录 |
| 2. 断网 | macOS 用 `sandbox-exec` 真断网（只放行本机回环）；其它平台退化为只靠探针，并会明确提示"缺少 OS 层断网" |
| 3. 取证 | 探针从**进程外**记录每一个出网请求（`fetch` / `http.request` / `https.request`） |
| 4. 对账 | 出网记录里不允许有非回环地址；`llmRequests=0`；`knowledgeRequests=0`；5 个注入缺陷必须全部检出 |

> 为什么不能只看 `llmRequests`？离线分支根本没挂这个计数器，读它永远是 0 ——
> 那是个**恒真判据**，看着在守卫，其实什么都没验。所以出网记录必须从外面取。

守卫自己也会失败：注入一个外网 `fetch` → 守卫报错；关掉一条检测规则 → 守卫报"漏检"。
一个永远通过的守卫等于没有守卫。

**English**：Yes. It is **red line 8** of the constitution, and a dedicated guard proves it —
it does not rely on the implementation remembering to behave.

```bash
bun run guard:offline
```

The guard takes every piece of evidence **from outside the process under test** — it never
trusts the code's own self-report:

| Step | What it does |
|---|---|
| 1. Prepare | Copies the zero-dependency fixture `benchmarks/fixtures/offline-web-app/` (5 deliberately injected bugs) to a temp directory |
| 2. Cut the network | On macOS, `sandbox-exec` really blocks outbound traffic (loopback only); elsewhere it falls back to the probe alone and says plainly that OS-level blocking is missing |
| 3. Observe | A probe records every outbound request (`fetch` / `http.request` / `https.request`) from **outside** the process |
| 4. Reconcile | No non-loopback address may appear; `llmRequests=0`; `knowledgeRequests=0`; all five injected bugs must be detected |

> Why not just read `llmRequests`? The offline branch never attaches that counter, so it always
> reads 0 — a **vacuously true check** that looks like a guard but verifies nothing. That is why
> the outbound traffic has to be observed from outside.

The guard can fail too: inject an outbound `fetch` and the guard fails; disable one detection
rule and the guard reports "not detected". A guard that can never fail is not a guard.

---

## 15. 常见报错 / Common Errors

**`No reachable project dev server`**
目标项目没有可识别的 `dev`/`start`/`serve` 脚本，或者依赖没装。装好依赖、加个 `dev` 脚本即可。
The target project has no recognisable `dev`/`start`/`serve` script, or its dependencies are not
installed. Install the dependencies and add a `dev` script.

**`browser MCP not registered`**
Playwright 没装 / Playwright is not installed:

```bash
bun run setup            # = bunx playwright install chromium
```

> 装浏览器现在是**安装流程的一部分**（`start.command` / `start.sh` 会自动跑）。
> 借用系统 Chrome 能跑，但版本不受控 —— `sentinel doctor` 会把它判成 warn。
> Installing the browser is now **part of setup** (`start.command` / `start.sh` run it for you).
> Borrowing system Chrome works, but the version is uncontrolled — `sentinel doctor` reports it as a warn.

**LLM 返回 404 / 连不上 / LLM returns 404 or refuses to connect**
`baseUrl` 填错了 / the `baseUrl` is wrong. 常见正确值 / Common correct values:

- MiniMax：`https://api.minimaxi.com/v1`
- OpenAI：`https://api.openai.com/v1`
- Ollama：`http://localhost:11434/v1`

注意末尾要有 `/v1` / Note the trailing `/v1`.

> 如果 `sentinel doctor` 报的是 **"缺少 apiKey"**，那不是地址写错 —— 是 key 没配。
> （以前这里会错误地去探 Ollama，然后把 404 解释成"baseUrl 漏了 /v1"，把人带偏。）
> 配置里写 `${SENTINEL_API_KEY}` 但没 export 时，doctor 会**点名**说是哪个变量没设置。
> If `sentinel doctor` says **"apiKey missing"**, the URL is not the problem — the key is not set.
> (It used to probe Ollama instead and then blame the baseUrl for a 404, which points you the wrong way.)
> When the config uses `${SENTINEL_API_KEY}` and the variable is not exported, doctor now **names**
> the missing variable.

**Budget exceeded**
默认每次 run 上限 $0.5 / The default cap is $0.50 per run. 调 `.sentinel/budget.yml` / edit `.sentinel/budget.yml`:

```yaml
limits:
  maxCostUsdPerRun: 2.0
  maxTokensPerRun: 50000
```

> 美元护栏只有在 provider 配了 `pricing`（USD / 每百万 token）时才真正可执行。
> 没配的话 `sentinel doctor` 会明确告诉你护栏没生效，而不是只打一句"警告"。
>
> The dollar guard is only executable once the provider defines `pricing` (USD per million tokens).
> Without it, `sentinel doctor` states plainly that the guard is inert, instead of printing a
> token "warning".

**doctor 报 fail，怎么处理 / doctor reports a failure — what now**
分两类：配置本身坏了（blocking）→ `run` 拒绝启动并打印修复命令；外部服务暂时不通（比如 LLM 挂了，非 blocking）→ 不阻塞，降级成启发式分析并在输出里说明降级了。
There are two kinds: a broken configuration (blocking) makes `run` refuse to start and prints the
fix command; a temporarily unreachable external service (non-blocking, e.g. the LLM is down) does
not block — the analysis degrades to heuristics and the output says so.

---

## 16. 开发者 / For Developers

### 项目结构 / Project structure

```
Sentinel/
├── start.command         ← 双击启动 Web 控制台（后台）/ double-click to start the web console (background)
├── stop.command          ← 双击停止 / double-click to stop
├── packages/
│   ├── core/             Microkernel（Bus / Budget / Kernel / types）
│   ├── subagents/        mapper, runner, analyst, critic, verifier, planner, enhancer, executor
│   ├── adapters/         13 个框架检测器 / 13 framework detectors
│   ├── providers/        LLM / Memory / Skills / MCP / Knowledge
│   ├── reporters/        Markdown + JSON 报告生成 + CLI 打印 / Markdown + JSON report generators + CLI printer
│   ├── sensors/          证据类型 + 去重 / evidence types + dedupe helpers
│   └── cli/              CLI 入口 / CLI entry point
├── sentinel-ui/          React 19 + Vite Web 控制台 / React 19 + Vite web console
├── benchmarks/           真实案例库（cases / replay）/ real case library (cases / replay)
├── examples/nextjs-blog  示例项目 / sample project
└── docs/                 宪法、架构、路线图、规范 / constitution, architecture, roadmap, specs
```

### 守卫与测试 / Guards and tests

```bash
bun run lint:core     # core/ 纯度：不许依赖具体框架/平台 / core purity: no framework or platform dependencies
bun run lint:lines    # core/ 行数 ≤ 500 / core line count ≤ 500
bun run lint:spec     # 规范 ↔ 实现 ↔ 运行时 三方对账 / three-way reconciliation of spec, implementation, runtime
bun run guard:offline # 断网实跑：离线模式不许发外网请求 + 离线检测能力不退化 / offline network guard (runs a real browser pass)
bun run test          # 全量单测 + 集成测试 / full unit and integration test suite
bun run test:replay   # 用录制的真实案例回放，验证没有退化 / replay recorded real cases to prove no regression
```

`guard:offline` 会跑一次真实浏览器流程（约 1-2 分钟），所以没放进 `lint:spec` ——
`lint:spec` 必须快。`lint:spec` 里另有**静态断言**检查离线的开关都还在
（少一个开关就报错），重的部分由 `guard:offline` 单独跑。

`guard:offline` takes about 1-2 minutes because it drives a real browser, so it is not part
of `lint:spec` (`lint:spec` has to stay fast). `lint:spec` still contains **static assertions**
that the offline switches are all still in place; the heavy check runs separately.

### 文档 / Documentation

- [QUICK-START.md](./QUICK-START.md) —— 最短路径跑起来 / shortest path to a running setup
- [docs/CONSTITUTION.md](./docs/CONSTITUTION.md) —— 宪法（开头有白话版）：红线、边界、原则 / the constitution (plain-language version first): red lines, boundaries, principles
- [docs/INDEX.md](./docs/INDEX.md) —— 全部文档索引 / index of every document
- [docs/REMEDIATION-PLAN-v1.md](./docs/REMEDIATION-PLAN-v1.md) —— 当前实际进度与待办 / current status and remaining work
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) —— 分层与事件流 / layering and event flow

---

## 17. Requirements / License

**中文**

- [bun](https://bun.sh)（安装：`curl -fsSL https://bun.sh/install | bash`）
- macOS / Linux
- 一个 LLM API Key，或本机装 Ollama（免费）
- 目标项目：依赖装好 + 有 dev/start 类脚本

**English**

- [bun](https://bun.sh) (install: `curl -fsSL https://bun.sh/install | bash`)
- macOS / Linux
- An LLM API key, or a local Ollama install (free)
- Your target project: dependencies installed, plus a `dev`/`start` style script

**License：MIT**
