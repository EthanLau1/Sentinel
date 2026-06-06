# Sentinel 配置规范

> `.sentinel/` 目录下所有配置文件的标准格式。
> 任何 adapter / subagent 都按这个 schema 读写。

---

## 目录结构（用户项目内）

```
.sentinel/
├─ llm.yml              LLM provider 配置 (M1 必须)
├─ budget.yml           stage + weights + 预算上限 (M5 必须)
├─ app.map.ts           FeatureMap 用户覆盖 (M3 可选)
├─ permissions.yml      Tier 边界自定义 (M7 可选)
├─ knowledge.yml        知识增强配置 (M6 可选)
├─ skills/              用户自定义 skill (markdown)
│  ├─ core/             工具自带，不要改
│  ├─ community/        从 GitHub 拉来的
│  └─ custom/           用户自己写
├─ adapters/            用户自定义 adapter
├─ cache/               知识缓存（自动生成，可删）
└─ benchmark/           本项目案例库
```

---

## llm.yml

```yaml
# 默认 provider
default: my-cloud-api

providers:
  my-cloud-api:
    type: openai-compatible
    baseUrl: https://your-api.com/v1
    apiKey: ${YOUR_API_KEY}        # 支持 env var 引用
    model: gpt-4o

  local-fast:
    type: ollama
    baseUrl: http://localhost:11434
    model: qwen3:7b

  local-coder:
    type: ollama-native
    model: deepseek-coder:6.7b

# 不同子代理用不同 provider（混合模式）
agents:
  mapper: local-fast              # 简单任务
  sensor: local-fast
  runner: local-fast
  analyst: my-cloud-api           # 关键诊断
  critic: my-cloud-api            # critic 必须强
  planner: my-cloud-api
  enhancer: my-cloud-api
  executor: my-cloud-api
```

---

## budget.yml

```yaml
stage: MVP                        # Idea | MVP | Launch | Scale

# 单次跑预算上限
limits:
  maxCostUsdPerRun: 0.50
  maxTokensPerRun: 100000
  maxDurationSecPerRun: 300

# 推荐公式权重（可覆盖默认）
weights:
  confidence: 0.35
  impact:     0.25
  stageFit:   0.20
  effort:    -0.10
  risk:      -0.10

# stage preset 可显式选用
preset: mvp                       # 见 STAGE-PRESETS.md
```

---

## app.map.ts（用户覆盖）

```typescript
// 用户在 mapper 输出基础上手动覆盖
import { FeatureMap } from '@sentinel/core';

const overrides: Partial<FeatureMap> = {
  auth: {
    type: 'otp',
    loginEndpoint: '/auth/send-code',
    sessionStorage: 'cookie',
    testCredentials: {
      email: 'sentinel@example.com',
    },
  },
  flows: [
    {
      id: 'critical.create-post',
      description: '用户能成功发布帖子',
      steps: [
        { action: 'visit', url: '/posts/new' },
        { action: 'fill', selector: 'textarea', value: 'test' },
        { action: 'click', selector: 'button[type=submit]' },
        { action: 'assert', kind: 'url', match: '/posts/' },
        { action: 'assert', kind: 'db', table: 'posts', countDelta: 1 },
      ],
    },
  ],
};

export default overrides;
```

---

## permissions.yml（Tier 边界自定义）

```yaml
# 哪些操作允许哪个 Tier
tiers:
  tier1_auto:
    - generate_app_map
    - format_code
    - update_skill
    - fix_typo

  tier2_pr:
    - patch_logic_bug
    - update_dependencies_minor

  tier3_advise_only:
    - architecture_change
    - database_migration
    - delete_files
    - update_dependencies_major
    - any_security_related

# 全局开关
auto_repair_enabled: true
max_tier_allowed: 2               # 永远不允许 tier 3 自动跑
require_human_approval_above_tier: 1

# 沙箱
sandbox:
  enabled: true
  paths_allowed:
    - .sentinel/
    - reports/
    - benchmarks/
  paths_denied:
    - .env*
    - '**/secrets/**'
    - '**/.git/**'
```

---

## knowledge.yml（M6 配置）

```yaml
enabled: true

sources:
  docs:                           # 优先级 1
    enabled: true

  github:                         # 优先级 2
    enabled: true
    recent_months: 6
    api_token: ${GITHUB_TOKEN}    # 可选，提高 rate limit

  stackoverflow:                  # 优先级 3
    enabled: true

  x:                              # 优先级 4，默认关闭
    enabled: false
    api_key: ${X_API_KEY}
    recent_days: 30

# 触发规则
trigger:
  always: false                   # 不是每个 bug 都搜
  rules:
    - condition: confidence < 0.7
      action: search
    - condition: involves_third_party_sdk
      action: search
    - condition: involves_recent_version_bump
      action: search
    - condition: involves_security
      action: search
    - condition: similar_in_local_benchmark
      action: skip

# 多源规则（v1.1 修正）
multi_source:
  default_min_sources: 1          # 官方文档单源即可
  controversial_min_sources: 1    # 1 权威 + 最多 2 佐证
  controversial_max_sources: 3
  triggers_for_multi_source:
    - controversial_topic
    - version_migration
    - third_party_sdk_behavior
    - deployment_platform_specific

# 缓存
cache:
  ttl_hours: 48
  max_size_mb: 100
```

---

## 环境变量约定

| Var | 用途 | 必须 |
|---|---|---|
| `SENTINEL_API_KEY` | 默认 LLM API key | M1 起 |
| `SENTINEL_BASE` | 默认 API base URL（被测项目） | M2 起 |
| `GITHUB_TOKEN` | GitHub API rate limit | M6（可选） |
| `X_API_KEY` | X.com API | M6.2（可选） |
| `OPENTELEMETRY_ENDPOINT` | trace 收集（可选） | M2（可选） |

---

## 配置验证

`sentinel doctor` 必须检查：

- [ ] `llm.yml` 存在且至少 1 个 provider
- [ ] `llm.yml` 中的 `${VAR}` 引用都已设置
- [ ] `budget.yml` 中 weights 总和符合公式（可正可负）
- [ ] `permissions.yml` 不允许 Tier 3 自动跑
- [ ] `app.map.ts` 字段类型正确
- [ ] `knowledge.yml` 至少启用 docs 源（M6 起）

任何一项失败 → `sentinel run` 拒绝启动。
