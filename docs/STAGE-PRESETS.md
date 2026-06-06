# Stage Presets

> 四套权重预设（idea / mvp / launch / scale），对应项目不同生命阶段。
> 其中 idea 与 mvp 当前权重完全相同。同一个 bug，不同阶段推荐不同方案。

---

## 公式回顾

```
score = confidence × w_conf
      + impact     × w_impact
      + stageFit   × w_stage
      − effort     × w_effort
      − risk       × w_risk
```

正向因子加分，反向因子（effort、risk）减分。

---

## 默认权重（中性）

```yaml
weights:
  confidence: 0.35
  impact:     0.25
  stageFit:   0.20
  effort:    -0.10
  risk:      -0.10
```

---

## Preset 1: Idea / MVP — "快"

**项目特征**：
- 1-3 人小团队
- 还没有付费用户 / 用户量 < 1000
- 每周迭代多次
- 接受技术债

**优先级**：能跑 > 完美

```yaml
preset: mvp

weights:
  confidence: 0.30          # 适度
  impact:     0.20          # 影响范围权重低（用户少）
  stageFit:   0.30          # ★ 阶段适配权重高
  effort:    -0.15          # ★ effort 惩罚加重
  risk:      -0.05          # 风险容忍度高（可以发坏的）
```

**典型推荐**：
- ✅ Tier 1 自动修
- ✅ 临时绕过 / 加 try-catch
- ⚠️ 不推荐"重构 + 测试 + 文档"
- ❌ 不推荐"大改架构"

---

## Preset 2: Launch — "稳"

**项目特征**：
- 3-10 人团队
- 付费用户 / 用户量 1k-50k
- 双周迭代
- 不能再随便挂

**优先级**：稳 > 快

```yaml
preset: launch

weights:
  confidence: 0.40          # ★ 置信度权重高（不能赌）
  impact:     0.25
  stageFit:   0.15
  effort:    -0.10
  risk:      -0.10          # 风险拉到中位
```

**典型推荐**：
- ✅ 高 confidence + 中等 effort 的方案
- ✅ Tier 2 PR + 强制审核
- ⚠️ 慎选"快速绕过"
- ❌ 拒绝 "可能是 X，先试试" 类方案

---

## Preset 3: Scale — "长"

**项目特征**：
- 10+ 人团队
- 用户量 50k+
- 月度 release
- 维护成本是大头

**优先级**：长期可维护 > 短期速度

```yaml
preset: scale

weights:
  confidence: 0.35
  impact:     0.30          # 影响范围权重最高（用户多）
  stageFit:   0.10
  effort:    -0.05          # effort 惩罚降低（值得花时间）
  risk:      -0.20          # ★ 风险惩罚最重
```

**典型推荐**：
- ✅ 重构 + 测试 + 文档 + 可观测性
- ✅ Tier 2 PR + 多人审核
- ✅ 加监控、加 alert
- ⚠️ 慎选"补丁式修复"
- ❌ 拒绝"可能引入新问题"的方案

---

## 同一 bug，不同 preset 推荐对比

**示例**：评论按钮 onClick 缺失

| Preset | 推荐方案 | 理由 |
|---|---|---|
| MVP | ★ 加 onClick (Tier 1, 5min, 0 风险) | effort 最低 |
| Launch | ★ 加 onClick + 加单测 (Tier 2, 30min, 低风险) | confidence 高 + 防回归 |
| Scale | ★ 重构成 Server Action + 测试 + 监控 (Tier 2 PR, 2h, 低风险) | 可维护性优先 |

---

## 自定义 preset

用户可在 `.sentinel/budget.yml` 完全覆盖：

```yaml
stage: custom

# 覆盖任意权重
weights:
  confidence: 0.50          # 极保守的团队，要求高置信度
  impact:     0.25
  stageFit:   0.10
  effort:    -0.05
  risk:      -0.10
```

---

## 验证规则

`sentinel doctor` 必须检查：

- [ ] weights 中 5 个 key 都存在
- [ ] confidence + impact + stageFit ∈ (0, 1]（正向项总和不超 1）
- [ ] effort + risk ∈ [-0.5, 0)（反向项是负数）
- [ ] preset 名称在 `[idea, mvp, launch, scale, custom]` 中

不合法 → `sentinel run` 拒绝启动。

---

## 长期演化

v1.1 锁定这 4 套 preset（idea / mvp / launch / scale）。
v2 可能加：
- `enterprise`（合规优先）
- `agency`（交付优先）
- `oss`（社区贡献友好）

但 v1 时间窗内不做。
