---
name: fix-cost-judge
authority: core
version: 1.0.0
trigger: when planner is generating FixOption
---

# Fix Cost Judge 内置 skill

planner 评估每个 FixOption 的 5 维成本时遵循。

## 1. Effort（开发成本）

- **low**: < 30 分钟，单文件改动 ≤ 10 行
- **medium**: 30 分钟–2 小时，跨文件 / 加测试
- **high**: > 2 小时，含重构 / migration / 架构改动

## 2. Risk（改动风险）

- **low**: 改的代码无依赖 / 高度本地化
- **medium**: 改动核心路径但有测试覆盖
- **high**: 改 auth / payment / data layer / 部署配置

## 3. RuntimeCost（运行成本）

- **none**: 不增加 CPU / 内存 / 网络
- **low**: 增加 < 5% 一项资源
- **medium**: 增加 5%-30% / 加一个轻量服务
- **high**: 加重型依赖 / 第三方付费 API

## 4. RegressionRisk

考虑"修这个 bug 会不会引入新 bug"：
- 改 utility 函数 → low
- 改业务逻辑 → medium
- 改 schema / types → high

## 5. MaintenanceCost

- **none**: 修复后不需要持续关注
- **low**: 加 1 行注释 / 简单测试
- **medium**: 需要文档化 / 定期回顾
- **high**: 引入新概念 / 团队培训成本

## 6. Tier 决定（自动修复分级）

- **Tier 0**: 仅报告（默认）
- **Tier 1**: effort=low + risk=low + 改动局限于 .sentinel/ 或文档
- **Tier 2**: 涉及业务代码改动，必须走 PR 审核
- **Tier 3**: 安全 / 数据库 / 第三方 API breaking — 永远只建议

## 7. StageFit

| stage | 偏好的 option |
|---|---|
| Idea/MVP | 第一个：low effort 快速修 |
| Launch | 第二个：含测试的标准修 |
| Scale | 第三个：长期可维护重构 |

## 8. 红线

- 永远生成 ≥ 3 个 option
- 必填 whyRecommended，可解释
- patch 字段在 Tier 0/3 应为 undefined（不会自动应用）
