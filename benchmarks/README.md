# Sentinel Benchmarks

> 真实案例永久留档。从 M3.5 第一条闭环开始攒。

## 红线

宪法第 6 条：每个真实案例必须进入 `benchmarks/cases/` 永久留档。

## 案例 schema

```
{
  "id": "2026-05-21-001",
  "project": "sample-app",
  "feature": "auth.send-code",
  "stage": "MVP",
  "symptom": "OTP 邮件未发出",
  "real_root_cause": "REDIS_URL 未配置导致 OTP 写入失败",
  "sentinel_judgment": {
    "root_cause_status": "confirmed",
    "root_cause": "...",
    "confidence": 0.94,
    "evidence_count": 4
  },
  "hit": true,
  "recommended_fix": "Tier 1: 加 REDIS_URL 到 .env.local",
  "fix_adopted": true,
  "fix_passed_verification": true,
  "notes": "..."
}
```

## 用途

- M9 真实验证：跑全部 cases，统计命中率 / 采纳率
- 回归保证：宪法升级后必须全跑通过才能合并
- 长期 benchmark：跟 OpenHands / aider 对比

## 启动节点

M3.5 第一条端到端闭环跑通 = 第一条 case。
之后每跑出一个真实 bug，就归档一条。
