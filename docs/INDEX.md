# Sentinel — 文档索引

> 进项目先读这一份。所有文档都从这里跳转。

## 先说清楚：这是什么（不用懂代码也能看）

**Sentinel 是一个帮你给网站项目做自动体检的工具。**
你把项目文件夹交给它，它自己把项目跑起来、用浏览器逐页点开、把接口逐个调一遍，
然后写出一份报告：哪里坏了、为什么会坏、怎么修。

它跟"把报错贴给 AI 问一句"的区别：它自己去复现并留下证据，
结论要么有证据支撑，要么明说"证据不足"；还有个反方环节专门挑刺，防止它一本正经地胡说。

- 只想知道这东西能干什么 → 读 [README.md](../README.md) 开头那一段就够了
- 想用起来 → 读 [QUICK-START.md](../QUICK-START.md)
- 想改代码 / 加功能 → 从下面的表往下看

---

## 🏛 宪法 + 架构（永久版本）

| 文档 | 用途 | 改动需要 |
|---|---|---|
| [CONSTITUTION.md](./CONSTITUTION.md) | 宪法 v1.4 — 红线、机制、原则（开头有白话版） | 升宪法版本号 |
| [CONSTITUTION-CHANGES.md](./CONSTITUTION-CHANGES.md) | 宪法 v1.1 → v1.4 的逐条处置记录 | 升宪法版本号 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构 — 分层、事件流、5 类型 5 接口 | 同步升宪法 |
| [ROADMAP.md](./ROADMAP.md) | 13 周路线 — 每周产出和指标 | PR 即可 |

---

## 📋 实施规范（M0 前必读）

| 文档 | 用途 |
|---|---|
| [NEXT-STEPS.md](./NEXT-STEPS.md) | M0 第 1 周精确清单 — **历史文档**，当前进度看下面那份补齐方案 |
| [REMEDIATION-PLAN-v1.md](./REMEDIATION-PLAN-v1.md) | **补齐方案 v1** — 34 项缺漏的 4 个根因、6 个执行批次、每批可跑的验收判据 |
| [EVENT-CATALOG.md](./EVENT-CATALOG.md) | 所有 Event 类型的固定枚举（防止乱发事件） |
| [CONFIG-SPEC.md](./CONFIG-SPEC.md) | `.sentinel/*.yml` 配置文件规范 |
| [STAGE-PRESETS.md](./STAGE-PRESETS.md) | Idea/MVP/Launch/Scale 三套 weights 预设 |

---

## 📦 各 package 说明

| Package | 完成于 | 文档 |
|---|---|---|
| `core/` | M0 (W1) | [README](../packages/core/README.md) |
| `providers/` | M1+M6 (W2, W11-12) | [README](../packages/providers/README.md) |
| `sensors/` | M2 (W2) | [README](../packages/sensors/README.md) |
| `adapters/` | M3 (W3) | [README](../packages/adapters/README.md) |
| `subagents/` | M3.5-M7 (W3-9) | [README](../packages/subagents/README.md) |
| `skills prompts` | M4-M5 | [providers skill prompts](../packages/providers/src/skills/prompts) |
| `cli/` | M8 (W10) | [README](../packages/cli/README.md) |
| `reporters/` | M7 (W9) | [README](../packages/reporters/README.md) |

---

## 📚 资料

| 文档 | 用途 |
|---|---|
| [examples/README.md](../examples/README.md) | demo 项目计划 |
| [benchmarks/README.md](../benchmarks/README.md) | 真实案例库规范 |

---

## 🚦 阅读顺序建议

**第一次看的人**:
1. [README.md](../README.md) — 5 分钟知道这是什么（开头就是白话版）
2. [QUICK-START.md](../QUICK-START.md) — 5 分钟跑起来看效果
3. [CONSTITUTION.md](./CONSTITUTION.md) — 30 分钟知道边界在哪（第一小节是白话版，后面是正式条款）
3. [ARCHITECTURE.md](./ARCHITECTURE.md) — 1 小时知道怎么搭

**要写代码的人**:
1. 上面 3 份
2. [REMEDIATION-PLAN-v1.md](./REMEDIATION-PLAN-v1.md) — **当前实际进度与待办**（比 NEXT-STEPS 更靠前）
3. [ROADMAP.md](./ROADMAP.md) — 知道整个项目处在哪一周
4. [NEXT-STEPS.md](./NEXT-STEPS.md) — M0 第 1 周的历史清单（仅存档参考）
5. [EVENT-CATALOG.md](./EVENT-CATALOG.md) — 知道事件名怎么定

**要改宪法的人**:
1. [CONSTITUTION.md](./CONSTITUTION.md) 末尾的"宪法升级流程"
2. 升级版本号 (v1.4 → v2.0)
3. 在 [CONSTITUTION-CHANGES.md](./CONSTITUTION-CHANGES.md) 写明 why / what / impact
4. 同步更新 ARCHITECTURE / ROADMAP
5. 跑 `bun run lint:spec`（宪法里的机检条款由守卫守住）

---

## ⚙️ 状态

```
✅ Constitution v1.4     已锁定（v1.1→v1.4 处置见 CONSTITUTION-CHANGES.md）
✅ Architecture          已设计
✅ 13-week Roadmap       已规划
✅ Event Catalog         已枚举
✅ Config Spec           已定义
✅ Stage Presets         已校准
✅ lint:spec 守卫       已接入（scripts/check-spec-sync.mjs + baseline）
🚧 补齐方案批3/批5      L3 闭环验证 + benchmark 真实案例
```

---

## 🚀 立即开始

M0 W1 第一行代码是 `packages/core/src/types.ts`。
精确步骤见 [NEXT-STEPS.md](./NEXT-STEPS.md)。
