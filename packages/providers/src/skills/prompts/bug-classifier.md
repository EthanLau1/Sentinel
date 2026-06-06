---
name: bug-classifier
authority: core
version: 1.0.0
trigger: when analyst is generating BugFinding from Evidence
---

# Bug Classifier 内置 skill

analyst / critic 在分类失败时遵循。

## 1. Source 判定（按 Evidence kind）

| 主导 Evidence | source |
|---|---|
| network 失败 (5xx) | api |
| network 失败 (4xx auth) | auth |
| network 失败 (404) | api |
| console.error 含 `TypeError` / `undefined` | ui |
| screenshot + 无 network | ui (rendering) |
| db Evidence 与 UI 不一致 | data |
| OTP / Redis 相关 | env |
| 加载慢 (LCP > 4s) | perf |
| build / 部署相关 | deploy |

## 2. Severity 评分

- **P0**: 用户完全无法完成核心流程（登录失败 / 发布丢失数据 / 主页 500）
- **P1**: 关键功能受损但有 workaround（按钮失效 / 部分页面错误）
- **P2**: 体验问题 / 边缘场景（小弹窗错位 / 个别字段未保存）
- **P3**: 性能 / 可改进项（图片未优化 / 多余请求）

## 3. Confidence 上限

- 单一 Evidence 类型 → max 0.6
- 2 类 Evidence → max 0.8
- 3+ 类 Evidence + 反证排除 → max 0.95
- LLM 没有定位到具体代码位置 → max 0.5

## 4. 不允许的事

- 没有 Evidence 写出 confirmed
- 同一 bug 出多份 BugFinding
- rootCause 写"可能是 X"——必须明确（即使 confidence 低）
