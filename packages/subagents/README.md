# @sentinel/subagents

> 智能在这里。每个子代理只做一件事，互不知道彼此，全部通过 bus 通信。

## 8 个子代理

| 子代理 | 输入事件 | 输出事件 | 职责 |
|---|---|---|---|
| **mapper** | `project.scanned` | `map.ready` | 扫栈/路由/API/数据/flows，产出 FeatureMap |
| **sensor** | `map.ready`, `flow.failed` | `evidence.ready` | 编排 MCP 收 Evidence |
| **runner** | `evidence.ready` | `flow.passed/failed` | 跑 user flows |
| **analyst** | `flow.failed` | `bug.draft` | 出 hypothesis（不出 confirmed） |
| **critic** | `bug.draft` | `bug.confirmed/rejected` | 反向验证 |
| **planner** | `bug.confirmed` | `fix.proposed` | 出 3 个 FixOption + 推荐 |
| **enhancer** | `fix.proposed` | `fix.enhanced` | 按需多源知识增强（M6） |
| **executor** | `fix.enhanced` | `report.ready` | 按 Tier 决定动作（M7） |

## 通信纪律

```
子代理 A 直接调用 子代理 B            ❌ 拒绝
子代理 A 通过 bus 发事件，B 订阅      ✅
```

## 升级纪律

每个子代理可以独立升级：换 prompt、换模型、换 skill。
但**不能改 core**。如果要改 core，先升宪法版本号。

## 完成阶段

| 子代理 | 完成于 |
|---|---|
| mapper | M3 |
| sensor | M2 |
| runner | M3.5 |
| analyst | M4 |
| critic | M4 |
| planner | M5 |
| enhancer | M6 |
| executor | M7 |
