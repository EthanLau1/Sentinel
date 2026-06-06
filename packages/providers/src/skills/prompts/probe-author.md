---
name: probe-author
authority: core
version: 1.0.0
trigger: when generating user flows or probes
---

# Probe Author 内置 skill

当 Sentinel 的 mapper 或 runner 需要生成 user flow / probe 时，遵循以下规则。

## 1. Flow 定义原则

- 一个 flow 只测一个用户意图（"用户能登录" 不要混 "用户能改资料"）
- 步骤数 ≤ 8，超过应拆分
- 每个 flow 必须有 1 个明确的 assert（最后一步）

## 2. 步骤选择优先级

1. `visit` → 必须从已知路由开始
2. `fill` → 用 testid 而不是 class
3. `click` → 优先用 role-based selector（button[name="submit"]）
4. `assert` → URL / DB 状态优于 text 比对

## 3. 共享状态

- `ctx.state.token` — 登录后的 session token
- `ctx.state.runId` — 当前 run 的标识
- `ctx.state.email` — 测试账号

## 4. 不要做的事

- ❌ 不要在 flow 里 sleep（用 assert 等到状态）
- ❌ 不要测视觉细节（颜色、间距）
- ❌ 不要 hardcode 时间戳

## 5. 失败时

返回 `{ status: 'fail', error, hint }` 而非抛错。`hint` 给出 actionable 建议。
