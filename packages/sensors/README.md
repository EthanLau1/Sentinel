# @sentinel/sensors

> 编排 MCP 收集 Evidence。
> Sensor 不直接操作浏览器/HTTP，它通过 MCP provider 调用具体能力。

## 角色

```
subagents/sensor/  →  packages/sensors/  →  providers/mcp/built-in/
                          ↑                         ↑
                    协调多个 MCP                 具体能力
```

## 模式

### 标准模式（默认）

收 5 项 Evidence:
- ScreenshotEvidence
- DOMSnapshotEvidence
- AccessibilityEvidence
- ConsoleEvidence
- NetworkEvidence

### 详细模式（`--detailed`）

加收 3 项:
- StorageEvidence (localStorage / sessionStorage / cookie)
- 完整 response body
- TraceEvidence

## 隐私边界

- 默认不碰 cookie / token / PII
- 自动脱敏：响应体里的 token 替换为 `<REDACTED>`
- `--detailed` 才允许，且写入 Evidence 时 hash 之前先脱敏
