# Sentinel — 文档索引

> 进项目先读这一份。所有文档都从这里跳转。

---

## 🏛 宪法 + 架构（永久版本）

| 文档 | 用途 | 改动需要 |
|---|---|---|
| [CONSTITUTION.md](./CONSTITUTION.md) | 宪法 v1.1 — 红线、机制、原则 | 升宪法版本号 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构 — 分层、事件流、5 类型 5 接口 | 同步升宪法 |
| [ROADMAP.md](./ROADMAP.md) | 13 周路线 — 每周产出和指标 | PR 即可 |

---

## 📋 实施规范（M0 前必读）

| 文档 | 用途 |
|---|---|
| [NEXT-STEPS.md](./NEXT-STEPS.md) | M0 第 1 周精确清单 — 每个文件每个测试 |
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
1. [README.md](../README.md) — 5 分钟知道这是什么
2. [CONSTITUTION.md](./CONSTITUTION.md) — 30 分钟知道边界在哪
3. [ARCHITECTURE.md](./ARCHITECTURE.md) — 1 小时知道怎么搭

**要写代码的人**:
1. 上面 3 份
2. [ROADMAP.md](./ROADMAP.md) — 知道现在该做哪一周
3. [NEXT-STEPS.md](./NEXT-STEPS.md) — 知道下一行代码写哪里
4. [EVENT-CATALOG.md](./EVENT-CATALOG.md) — 知道事件名怎么定

**要改宪法的人**:
1. [CONSTITUTION.md](./CONSTITUTION.md) 末尾的"宪法升级流程"
2. 升级版本号 (v1.1 → v1.2 / v2.0)
3. 同步更新 ARCHITECTURE / ROADMAP

---

## ⚙️ 状态

```
✅ Constitution v1.1     已锁定
✅ Architecture          已设计
✅ 13-week Roadmap       已规划
✅ Event Catalog         已枚举
✅ Config Spec           已定义
✅ Stage Presets         已校准
🚧 M0 实施              待启动 (W1)
```

---

## 🚀 立即开始

M0 W1 第一行代码是 `packages/core/src/types.ts`。
精确步骤见 [NEXT-STEPS.md](./NEXT-STEPS.md)。
