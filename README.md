# Sentinel

## 它到底是什么（先读这一段就够了）

**Sentinel 是一个帮你给网站项目做自动体检的工具。**

你把正在开发的项目文件夹交给它，它自己把项目跑起来、用浏览器把页面一个个点开、把接口一个个调一遍，最后写出一份报告：**哪里坏了、为什么会坏、怎么修**。

它跟你平时用的"把报错贴给 AI 问一句"最大的区别是：

| | 贴报错给 AI | Sentinel |
|---|---|---|
| 复现 | 你得自己描述怎么坏的 | 它自己去跑一遍，把现场抓下来 |
| 结论 | AI 猜一个原因 | 有证据才敢下结论，没证据就写"证据不足" |
| 有人把关 | 没有 | 有个"反方"专门挑刺，防止它一本正经地胡说 |
| 改代码 | 你自己动手 | 小改动它可以自动改（改完不行会自己还原） |

**它替你做的四件事：**

1. **看懂你的项目** —— 扫出你有哪些页面、哪些接口、用什么框架搭的
2. **跑一遍，看哪里真的坏了** —— 自动开浏览器点页面、发请求，把报错现场都记下来
3. **找到真正的原因** —— 报错只是症状，它去找坏掉的那行代码
4. **给出能落地的修法** —— 一次给 3 个方案，按"改动小 / 风险低 / 见效快"排序告诉你推荐哪个

**它能做什么、不能做什么：**

| ✅ 它能干 | ❌ 它不干 |
|---|---|
| 找 bug，定位到具体代码位置 | 不判断业务对错（"这个按钮该不该出现"它不知道） |
| 小改动自动改，改完不行会自己还原 | 大改动只给建议，绝不自己动你的代码 |
| 告诉你哪些地方根本没测到 | 不替你决定产品该做什么 |
| 每个结论都附带能核对的证据 | 证据不够时宁可说"不知道"，也不编一个根因 |

**术语对照表**（文档里的黑话 ↔ 人话，第一次看只需要这一张）：

| 文档里写的 | 人话 | 属于哪一步 |
|---|---|---|
| FeatureMap（功能地图） | 你的项目长什么样：有哪些页面、哪些接口 | 1 看懂项目 |
| Evidence（证据） | 真跑起来抓到的现场：500 报错、控制台红字 | 2 跑一遍 |
| root cause（根因） | 真正坏掉的那行代码，不是表面那个报错 | 3 找原因 |
| hypothesis（假设） | 还不够证据，只能叫"猜测" | 3 找原因 |
| critic / verifier（反方 / 复核） | 专门挑刺的复核环节，防止 AI 胡说 | 3 找原因 |
| cost model（成本模型） | 比较 3 个修法的"改动小 / 风险低 / 见效快" | 4 给修法 |
| Tier（自动修复等级） | 分 4 档：只报告 → 自动改 → 写补丁待你确认 → 只给建议 | 4 给修法 |

---

> 下面这段是英文的技术描述，给开发者看；上面那段是给第一次接触它的人看的。
> Local debug agent for web apps. It discovers safe read-only routes, runs browser flows, records evidence and coverage gaps, and proposes reviewable fixes when a root cause is supported.

`v0.2.0` · 8 workspaces · MIT

> **Work in progress** — This project is not feature-complete. Feel free to fork, modify, and build on top of it.

---

## 30 秒看看它长什么样（不需要任何 API Key）

```bash
git clone https://github.com/EthanLau1/Sentinel.git
cd Sentinel
bun install
bun packages/cli/src/index.ts run --demo
```

> ⚠️ **`--demo` 输出的是 3 个硬编码的示例报告，不是真的在找 bug。**
> 它只用来让你预览报告长什么样。真正的检测必须配 LLM。

## 5 分钟上手（Web 控制台，推荐第一次用这个）

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

### 建议自己定义要测的流程

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

## 对真实项目调试（命令行完整流程）

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

---

## CLI 命令

| 命令 | 说明 |
|---|---|
| `sentinel run` | 跑完整调试流程（主入口） |
| `sentinel doctor` | 自检：环境、配置、LLM 是否可用、预算护栏是否可执行 |
| `sentinel map` | 只生成 FeatureMap（功能地图），不做诊断 |
| `sentinel hello` | 只测 LLM 能不能连通 |
| `sentinel init` | 在目标项目里生成 `.sentinel/` |
| `sentinel ui` | 启动本地 Web 控制台（默认 http://127.0.0.1:4317） |
| `sentinel update` | 自更新 —— **目前是占位（M8.5 stub），还没真实现** |

### `run` 的全部选项

| 选项 | 说明 |
|---|---|
| `--project <path>` | 目标项目根目录（默认当前目录） |
| `--demo` | 无 key 的演示流程，输出硬编码示例报告 |
| `--detailed` | 把敏感证据（cookie / storage 等）也写进报告 |
| `--no-enhance` | 跳过外部知识检索（跳过不影响出报告） |
| `--tier <0\|1\|2\|3>` | 最高处理到哪一档（默认 3） |
| `--auto-fix` | 允许 Tier 1 真正修改你的源代码（**默认关**） |
| `--create-pr` | 为 Tier 2 修复建分支、提交、推送并开 PR（需要 `gh` CLI，**默认关**） |
| `--report <markdown\|json\|both>` | 报告格式，默认两种都出 |

> **默认它不会改你的代码。** 即使不加 `--auto-fix`，Tier 1 也只是把补丁写到 `.sentinel/auto-patches/` 里等你审阅。
> `--auto-fix` 打开后，改完会**重新验证一次**，验证不过自动还原。
> `--create-pr` 是**外部动作**（真的推分支、开 PR），只在显式加这个开关时才会发生。

---

## 支持的技术栈

范围以 `packages/adapters/src/` 里**真实存在的 13 个 adapter** 为准 —— 没有 adapter 的栈不在服务范围内。

| 层 | 已支持 |
|---|---|
| 前端 | Next.js · React · Vue · Svelte |
| 后端 | Express · Hono · NestJS · tRPC |
| 数据 | Prisma · Drizzle · Supabase |
| LLM 应用 | Vercel AI SDK · LangChain |

**不服务**：iOS / Android 原生、嵌入式与硬件、桌面应用（Electron 仅基本支持）、游戏引擎、操作系统与驱动。

## 完整工作流程

```
Mapper → Runner + Browser/HTTP → Analyst → Critic → Verifier → Planner → Enhancer → Executor
```

对着人话看这 9 步（每一步只干一件事）：

| 步骤 | 人话 |
|---|---|
| Mapper | 先把你的项目读一遍：有哪些页面、哪些接口、用什么框架搭的 |
| Runner | 真的去点页面、发请求，把出错的现场抓下来当证据 |
| Analyst | 看证据，猜一个"可能是这里坏了" |
| Critic | 反方：证据真的支持这个猜测吗？ |
| Verifier | 复核：证据够不够下结论？不够就退回"假设" |
| Planner | 给 3 个修法，按"改动小 / 风险低 / 见效快"排序 |
| Enhancer | 必要时去查官方文档补充外部知识（`--no-enhance` 可关掉） |
| Executor | 写补丁文件供你审阅（**只写补丁，不直接改你的代码**） |

## 它会往你项目里写什么

```
your-app/
├── .sentinel/                       ← 项目自己的配置与中间产物
│   ├── llm.yml                      ← LLM 配置（可覆盖全局设置）
│   ├── budget.yml                   ← 预算与护栏上限
│   ├── app.map.ts                   ← 你手写的项目映射（可选）
│   ├── app.map.generated.json       ← 自动生成的 FeatureMap
│   ├── auto-patches/                ← Tier 1 补丁（.diff）
│   └── cache/                       ← 证据缓存
├── reports/
│   ├── sentinel-latest.md           ← Markdown 报告
│   ├── sentinel-latest.json         ← JSON 报告
│   ├── patches/                     ← Tier 2 补丁（.patch）
│   └── suggestions/                 ← Tier 3 建议（.md）
└── .sentinel/runs/webui.json        ← Web 控制台的运行历史
```

全局配置（项目列表 + 默认 LLM 连接）在 `~/.sentinel/` 下，**不会被复制进你的项目**。

## 自动修复的 4 个 Tier

| Tier | 含义 | 实际行为 | 落盘位置 |
|---|---|---|---|
| 0 | 只观察 | 只记录，不生成补丁 | — |
| 1 | 自动修 | 改代码**需要** `--auto-fix`；否则只写补丁等你审阅 | `.sentinel/auto-patches/<id>.diff` |
| 2 | 待你确认 | 写补丁；加 `--create-pr` 会真的建 PR | `reports/patches/<id>.patch` |
| 3 | 仅建议 | 只出建议文档，绝不动代码 | `reports/suggestions/<id>.md` |

手动应用 Tier 1 补丁：

```bash
cd /path/to/your-app
git apply .sentinel/auto-patches/<fixId>.diff
```

哪一档由**硬规则**决定，不靠模型自己说。

## 报告的 11 个字段

每份 bug 报告固定包含：Bug ID · 严重级别（P0–P3）· 影响功能 · 复现步骤 · 证据引用 ·
根因判断（假设 / 已确认）· **推荐方案** · 备选方案 ×2 · 风险评估 · 验证命令 · 是否可自动修（Tier）。

字段内容为空时也会照样输出标题并写明"待产出"，不会整段跳过 —— 跳过会让"没产出"看起来像"不需要"。

## 当前状态（诚实版）

**已经能用：**

- 完整跑通"发现 → 取证 → 诊断 → 复核 → 给方案 → 出报告"这条链路
- Markdown + JSON 两种报告格式，11 个字段齐全
- Tier 1 自动修复（需 `--auto-fix`，带验证与自动还原）
- Tier 2 建 PR（需 `--create-pr` + `gh` CLI）
- Web 控制台：项目列表、设置、运行、报告查看
- 自检门禁：配置坏了直接拒绝启动；外部服务不通则降级但不阻塞

**还没有 / 只是占位：**

- **HTML 报告未实现** —— 目前只有 Markdown 和 JSON，文档里不宣称"三格式已满足"
- **`sentinel update` 是占位** —— 自更新（skills / adapters / 缓存）还没真做
- **`--demo` 是硬编码假数据** —— 不做任何真实检测
- 知识增强每次 run 最多触发 30% 的流程（避免噪音淹没权威来源）

## 常见报错

**`No reachable project dev server`**
目标项目没有可识别的 `dev`/`start`/`serve` 脚本，或者依赖没装。装好依赖、加个 `dev` 脚本即可。

**`browser MCP not registered`**
Playwright 没装：

```bash
npx playwright install chromium
```

**LLM 返回 404 / 连不上**
`baseUrl` 填错了。常见正确值：

- MiniMax：`https://api.minimaxi.com/v1`
- OpenAI：`https://api.openai.com/v1`
- Ollama：`http://localhost:11434/v1`

注意末尾要有 `/v1`。

**Budget exceeded**
默认每次 run 上限 $0.5。调 `.sentinel/budget.yml`：

```yaml
limits:
  maxCostUsdPerRun: 2.0
  maxTokensPerRun: 50000
```

> 美元护栏只有在 provider 配了 `pricing`（USD / 每百万 token）时才真正可执行。
> 没配的话 `sentinel doctor` 会明确告诉你护栏没生效，而不是只打一句"警告"。

**doctor 报 fail，怎么处理**
分两类：配置本身坏了（blocking）→ `run` 拒绝启动并打印修复命令；外部服务暂时不通（比如 LLM 挂了，非 blocking）→ 不阻塞，降级成启发式分析并在输出里说明降级了。

## 开发者

### 项目结构

```
Sentinel/
├── start.command         ← 双击启动 Web 控制台（后台）
├── stop.command          ← 双击停止
├── packages/
│   ├── core/             Microkernel（Bus / Budget / Kernel / types）
│   ├── subagents/        mapper, runner, analyst, critic, verifier, planner, enhancer, executor
│   ├── adapters/         13 个框架检测器
│   ├── providers/        LLM / Memory / Skills / MCP / Knowledge
│   ├── reporters/        Markdown + JSON 报告生成 + CLI 打印
│   ├── sensors/          证据类型 + 去重
│   └── cli/              CLI 入口
├── sentinel-ui/          React 19 + Vite Web 控制台
├── benchmarks/           真实案例库（cases / replay）
├── examples/nextjs-blog  示例项目
└── docs/                 宪法、架构、路线图、规范
```

### 守卫与测试

```bash
bun run lint:core     # core/ 纯度：不许依赖具体框架/平台
bun run lint:lines    # core/ 行数 ≤ 500
bun run lint:spec     # 规范 ↔ 实现 ↔ 运行时 三方对账
bun run test          # 全量单测 + 集成测试
bun run test:replay   # 用录制的真实案例回放，验证没有退化
```

### 文档

- [QUICK-START.md](./QUICK-START.md) —— 最短路径跑起来
- [docs/CONSTITUTION.md](./docs/CONSTITUTION.md) —— 宪法（开头有白话版）：红线、边界、原则
- [docs/INDEX.md](./docs/INDEX.md) —— 全部文档索引
- [docs/REMEDIATION-PLAN-v1.md](./docs/REMEDIATION-PLAN-v1.md) —— 当前实际进度与待办
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) —— 分层与事件流

## Requirements

- [bun](https://bun.sh)（安装：`curl -fsSL https://bun.sh/install | bash`）
- macOS / Linux
- 一个 LLM API Key，或本机装 Ollama（免费）
- 目标项目：依赖装好 + 有 dev/start 类脚本

## License

MIT
