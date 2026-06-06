/**
 * 5 维成本模型 + 推荐公式。
 *
 * score = confidence × w_conf
 *       + impact     × w_impact
 *       + stageFit   × w_stage
 *       − effort     × w_effort
 *       − risk       × w_risk
 */

import type { Cost, Effort, FixOption, Risk, Stage } from '@sentinel/core';

export interface CostWeights {
  confidence: number;
  impact: number;
  stageFit: number;
  effort: number; // 负向因子，传入应为负值（如 -0.10）
  risk: number; // 同上
}

export const DEFAULT_WEIGHTS: CostWeights = {
  confidence: 0.35,
  impact: 0.25,
  stageFit: 0.2,
  effort: -0.1,
  risk: -0.1,
};

export const PRESETS: Record<Lowercase<Stage>, CostWeights> = {
  idea: {
    confidence: 0.3,
    impact: 0.2,
    stageFit: 0.3,
    effort: -0.15,
    risk: -0.05,
  },
  mvp: {
    confidence: 0.3,
    impact: 0.2,
    stageFit: 0.3,
    effort: -0.15,
    risk: -0.05,
  },
  launch: {
    confidence: 0.4,
    impact: 0.25,
    stageFit: 0.15,
    effort: -0.1,
    risk: -0.1,
  },
  scale: {
    confidence: 0.35,
    impact: 0.3,
    stageFit: 0.1,
    effort: -0.05,
    risk: -0.2,
  },
};

const EFFORT_MAP: Record<Effort, number> = { low: 0.2, medium: 0.5, high: 1.0 };
const RISK_MAP: Record<Risk, number> = { low: 0.2, medium: 0.5, high: 1.0 };
const COST_MAP: Record<Cost, number> = { none: 0, low: 0.25, medium: 0.5, high: 1.0 };

export interface ScoreInput {
  confidence: number; // 0-1
  impact: number; // 0-1, 默认 0.5
  stageFit: number; // 0-1, 默认 0.5
  effort: Effort;
  risk: Risk;
}

export function computeScore(input: ScoreInput, weights: CostWeights): number {
  const e = EFFORT_MAP[input.effort];
  const r = RISK_MAP[input.risk];
  return (
    input.confidence * weights.confidence +
    input.impact * weights.impact +
    input.stageFit * weights.stageFit +
    e * weights.effort + // weights.effort 是负数
    r * weights.risk
  );
}

export function totalCost(option: Pick<FixOption, 'effort' | 'risk' | 'runtimeCost' | 'regressionRisk' | 'maintenanceCost'>): number {
  return (
    EFFORT_MAP[option.effort] +
    RISK_MAP[option.risk] +
    COST_MAP[option.runtimeCost] +
    RISK_MAP[option.regressionRisk] +
    COST_MAP[option.maintenanceCost]
  );
}

export function stageFit(stage: Stage, optionStage: Stage): number {
  if (stage === optionStage) return 1.0;
  // 相邻阶段（MVP <-> Launch, Launch <-> Scale）容忍度高
  const order: Stage[] = ['Idea', 'MVP', 'Launch', 'Scale'];
  const dist = Math.abs(order.indexOf(stage) - order.indexOf(optionStage));
  if (dist === 1) return 0.6;
  if (dist === 2) return 0.3;
  return 0.1;
}
