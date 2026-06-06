# M0 完成报告

> 日期：2026-05-22
> 阶段：W1 · M0 Core 宪法

---

## ✅ 验收（全部通过）

### 宪法红线

| 红线 | 要求 | 实际 | 状态 |
|---|---|---|---|
| 1. core 不依赖具体平台 | `grep` 关键字白名单为空 | 6 文件 0 违规 | ✅ |
| 2. core ≤ 500 行 | 总行数（除空行和注释） | 482 / 500 | ✅ |
| 3. 子代理升级不改 core | M0 阶段无子代理 | n/a | ✅ |
| 4. 任何结论必须绑 Evidence | M0 阶段无诊断 | n/a | ✅ |
| 5. 自动修复必须分 Tier | M0 阶段无 executor | n/a | ✅ |
| 6. 真实案例进 benchmark | M3.5 起开始 | 待 M3.5 | 🟡 |

### 工程指标

| 项 | 要求 | 实际 |
|---|---|---|
| core 外部依赖 | 0 | `dependencies: {}` |
| TypeScript 严格模式 | strict | ✅ + noUncheckedIndexedAccess + exactOptionalPropertyTypes |
| 单元测试通过 | 全部 | 27 / 27 |
| 测试覆盖率 | 100%（运行时代码） | 100% lines / branches / functions / statements |
| Typecheck | 通过 | ✅ |

---

## 📂 产出文件清单（19 个）

### 工程基础（7 个）

```
package.json                   workspaces 配置
tsconfig.json                  根 strict mode + project refs
vitest.config.ts               测试 + 100% coverage 阈值
.prettierrc
.editorconfig
.gitignore                     (已存在于 Sentinel/)
README.md                      (已存在于 Sentinel/)
```

### 红线守卫（2 个）

```
scripts/check-core-purity.mjs  机器执行红线 1
scripts/check-core-lines.mjs   机器执行红线 2
```

### Core 源码（6 个，482 行）

```
packages/core/package.json
packages/core/tsconfig.json
packages/core/src/types.ts     160 行 — 5 个核心类型
packages/core/src/ports.ts      88 行 — 5 个 Provider 接口
packages/core/src/bus.ts        72 行 — Event Bus
packages/core/src/kernel.ts     99 行 — Agent loop
packages/core/src/budget.ts     46 行 — 预算护栏
packages/core/src/index.ts      17 行 — 公共 API
```

### Core 测试（3 个，27 用例）

```
packages/core/test/bus.test.ts        11 用例
packages/core/test/kernel.test.ts      9 用例
packages/core/test/budget.test.ts      7 用例
```

---

## 🐛 M0 期间发现并修掉的 2 个真实 bug

### Bug #1 — Bus.stopRecording 不清 buffer

**症状**：第二次 startRecording → publish → stopRecording 会拿到上次的事件

**根因**：`stopRecording()` 只 `recording = false`，没清空 `recorded[]`

**修复**：返回 copy 后清空 `this.recorded = []`

**进 benchmark**：M3.5 起将归档到 `benchmarks/cases/` 作为第一条工具自反 case

### Bug #2 — Kernel 不识别 AggregateError 内的 BudgetExceededError

**症状**：handler 内部抛 BudgetExceededError → Bus 包成 AggregateError → Kernel 走 `kernel.error` 而不是 `kernel.budget_warning`

**根因**：`err instanceof BudgetExceededError` 直接判断对 AggregateError 不生效

**修复**：抽 `findBudgetError()` 私有方法，识别裸抛和 AggregateError 包装两种情况

---

## 🎯 W1 自查（5 问 5 答）

> 来自 NEXT-STEPS.md M0 验收会议

1. **core 总行数？≤500？**
   ✅ 482 行（含 17 行 index 桶文件）
2. **core 有 import 任何外部库吗？**
   ✅ 0 dependencies。`grep import` 只见相对路径。
3. **core 有写死任何具体框架/平台名字吗？**
   ✅ 0 命中。check-core-purity.mjs 通过。
4. **5 个核心类型定义清楚了吗？**
   ✅ FeatureMap / Evidence (sum type 12 种) / BugFinding / FixOption / Event<T>
5. **5 个 Provider 接口契约写清楚了吗？**
   ✅ LLM / Memory / Skills / MCP / Knowledge，含 ProviderSet 容器

**5 个全 yes → 进 W2 ✅**

---

## 📍 下周（W2）准备清单

### M1 LLM 通路

- [ ] 你的 LLM API key（OpenAI 兼容端点）
- [ ] 期望使用的模型名（gpt-4o / claude-sonnet / deepseek-chat / qwen3:30b ...）
- [ ] 决定本地是否启 Ollama（混合模式用）

### M2 最小感知

- [ ] Playwright 安装（W2 启动时一次）
- [ ] 第一个被测项目（建议先用你自己的真实项目）

### 配置文件第一版

W2 会落地这两个文件：

```
.sentinel/llm.yml      LLM provider 配置（已有 spec，只填值）
.sentinel/budget.yml   预算上限（已有 spec，只填值）
```

参考 `CONFIG-SPEC.md` 已锁定的 schema。

---

## 🚀 W2 第一行代码

```
packages/providers/llm/openai-compatible.ts
```

精确步骤待 W2 W2-NEXT-STEPS.md 出。M0 收工。
