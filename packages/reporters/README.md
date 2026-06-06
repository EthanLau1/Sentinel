# @sentinel/reporters

> 输出格式。所有格式必须包含 11 字段。

## 格式

| reporter | 用途 | 优先级 |
|---|---|---|
| `markdown.ts` | v1 主力，PR 友好 | ★ |
| `json.ts` | 机器可读 / CI | ★ |
| `cli.ts` | 终端彩色 | ★ |
| `html.ts` | dashboard | 后置 |

## 11 个必备字段

```
1.  Bug ID
2.  严重级别 (P0/P1/P2/P3)
3.  影响功能
4.  复现步骤
5.  Evidence (引用 hash)
6.  根因判断 (hypothesis or confirmed)
7.  推荐方案 ★
8.  备选方案 × 2
9.  风险评估
10. 验证命令
11. 是否可自动修 (Tier 0/1/2/3)
```

任何格式输出缺字段 = 拒绝合并。
