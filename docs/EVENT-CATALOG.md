# Event Catalog

> Bus 上所有合法事件的固定枚举。
> 不在这个列表里的事件名一律拒绝（防止"乱发事件"）。

---

## 命名约定

```
<noun>.<verb>     例: map.ready / bug.confirmed / fix.proposed
```

- 名词在前（事件围绕什么对象）
- 动词在后，过去式（事件已发生）
- 全小写，点分隔

---

## 完整事件列表（24 个）

### 项目理解阶段（M3）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `project.scanned` | cli | mapper | `{ root: string }` |
| `map.ready` | mapper | sensor / runner | `FeatureMap` |
| `map.failed` | mapper | reporter | `{ error: string }` |

### 感知阶段（M2）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `evidence.requested` | sensor | mcp registry | `{ kind: EvidenceKind, target: string }` |
| `evidence.collected` | sensor | (内部) | `Evidence` |
| `evidence.ready` | sensor | runner / analyst | `Evidence[]` |
| `evidence.failed` | sensor | reporter | `{ error: string, kind: EvidenceKind }` |

### 流程执行阶段（M3.5）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `flow.started` | runner | (内部) | `{ flowId: string }` |
| `flow.passed` | runner | (内部) | `{ flowId: string, duration_ms: number }` |
| `flow.failed` | runner | analyst / sensor | `{ flowId: string, evidence: Evidence[] }` |

### 诊断阶段（M4）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `bug.draft` | analyst | critic | `BugFinding` (rootCauseStatus='hypothesis') |
| `bug.confirmed` | critic | planner | `BugFinding` (rootCauseStatus='confirmed') |
| `bug.rejected` | critic | analyst | `{ bugId: string, reason: string }` |
| `bug.insufficient_evidence` | analyst / critic | sensor | `{ bugId: string, needs: EvidenceKind[] }` |

### 方案阶段（M5）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `fix.proposed` | planner | enhancer / executor | `FixOption[]` |
| `fix.enhanced` | enhancer | executor | `FixOption[]` (with sources) |

### 知识增强阶段（M6）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `knowledge.requested` | enhancer | knowledge providers | `{ query: string, sources: string[] }` |
| `knowledge.received` | knowledge providers | enhancer | `SearchResult[]` |
| `knowledge.cached` | enhancer | (内部) | `{ key: string, ttl: number }` |

### 执行阶段（M7）

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `executor.tier_decided` | executor | (内部) | `{ fixId: string, tier: 0 \| 1 \| 2 \| 3 }` |
| `patch.applied` | executor | reporter | `{ fixId: string, files: string[] }` |
| `pr.created` | executor | reporter | `{ url: string }` |
| `report.ready` | reporter | cli | `{ path: string }` |

### 监控/调度

| 事件 | 发起者 | 订阅者 | payload |
|---|---|---|---|
| `budget.exceeded` | budget | kernel | `{ kind: 'tokens' \| 'usd', limit: number }` |

---

## 添加新事件的流程

1. 在本文件追加一行
2. 在 `core/src/types.ts` 加事件类型
3. 至少 1 个发起者 + 1 个订阅者
4. PR 必须更新本文件，否则拒绝合并

---

## 不允许的事件命名

| ❌ | ✅ |
|---|---|
| `mapHandled` | `map.ready` |
| `bug_found` | `bug.draft` |
| `BugConfirmed` | `bug.confirmed` |
| `RUN_DONE` | `report.ready` |

---

## 总数控制

v1.1 锁定 24 个事件。
新增需要充分理由（事件膨胀 = 设计失败）。
v2 之前不超过 30 个。
