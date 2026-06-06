import { describe, it, expect } from 'vitest';
import {
  computeScore,
  totalCost,
  stageFit,
  PRESETS,
  DEFAULT_WEIGHTS,
} from '../src/cost-model.js';

describe('cost-model', () => {
  it('computeScore: 高置信度+低成本 → 高分', () => {
    const high = computeScore(
      { confidence: 0.9, impact: 0.8, stageFit: 1.0, effort: 'low', risk: 'low' },
      DEFAULT_WEIGHTS,
    );
    const low = computeScore(
      { confidence: 0.3, impact: 0.2, stageFit: 0.3, effort: 'high', risk: 'high' },
      DEFAULT_WEIGHTS,
    );
    expect(high).toBeGreaterThan(low);
  });

  it('PRESETS: MVP 比 Scale 更偏低 effort', () => {
    const sameOption = {
      confidence: 0.7,
      impact: 0.7,
      stageFit: 0.7,
      effort: 'low' as const,
      risk: 'low' as const,
    };
    const mvpScore = computeScore(sameOption, PRESETS.mvp);
    const scaleScore = computeScore(sameOption, PRESETS.scale);
    // MVP 更偏好 low effort，所以 mvp 应给 low effort 选项更高分
    expect(mvpScore).toBeGreaterThan(scaleScore);
  });

  it('stageFit: 同阶段 = 1.0', () => {
    expect(stageFit('MVP', 'MVP')).toBe(1.0);
    expect(stageFit('MVP', 'Launch')).toBeCloseTo(0.6);
    expect(stageFit('MVP', 'Scale')).toBeCloseTo(0.3);
  });

  it('totalCost: 5 维累加', () => {
    const cheap = totalCost({
      effort: 'low',
      risk: 'low',
      runtimeCost: 'none',
      regressionRisk: 'low',
      maintenanceCost: 'none',
    });
    const expensive = totalCost({
      effort: 'high',
      risk: 'high',
      runtimeCost: 'high',
      regressionRisk: 'high',
      maintenanceCost: 'high',
    });
    expect(expensive).toBeGreaterThan(cheap);
  });

  it('weights 总和: 默认权重保持公式合理', () => {
    const w = DEFAULT_WEIGHTS;
    expect(w.confidence + w.impact + w.stageFit).toBeCloseTo(0.8);
    expect(w.effort + w.risk).toBeCloseTo(-0.2);
  });
});
