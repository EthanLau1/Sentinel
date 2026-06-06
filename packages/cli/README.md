# @sentinel/cli

> 用户主入口。

## 命令

| 命令 | 用途 | 用户类型 |
|---|---|---|
| `sentinel run` | 跑全流程 | 主入口 ★ |
| `sentinel doctor` | Self-Check | 调试 |
| `sentinel map` | 只生成 FeatureMap | 调试 |
| `sentinel sense` | 只收 Evidence | 调试 |
| `sentinel report` | 重新生成报告 | 调试 |
| `sentinel update` | 自更新 skills/adapters/cache | 维护 |

## 参数风格

```
--stage MVP|Launch|Scale     当前阶段（影响推荐 weights）
--detailed                   详细 Evidence 模式
--budget-usd 0.50            单次预算上限
--no-enhance                 跳过 M6 知识增强
--tier 1                     允许的最高 Tier
--dry-run                    不写文件
--verbose                    详细日志
```

## 纪律

不允许新增第 6 个调试入口，除非升级宪法版本。
