// src/lib/ml/model.types.ts

export type MLFeatureValue = number | null;

export interface MLFeatureRow {
  playerId: number;
  round: number;
  features: Record<string, MLFeatureValue>;
  target: number;
}

export interface RidgeModel {
  featureNames: string[];
  weights: number[];
  intercept: number;
  featureMeans: number[];
  featureStds: number[];
}

export interface EvaluationMetrics {
  count: number;
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
}

export interface RoundEvaluation {
  round: number;
  ml: EvaluationMetrics;
  baseline: EvaluationMetrics;
}

export interface MLv1Config {
  firstRound: number;
  lastRound: number;
  participationWindow: number;
  lambda: number;
  featureNames: string[];
}

export interface MLv1Result {
  config: MLv1Config;
  overall: {
    ml: EvaluationMetrics;
    baseline: EvaluationMetrics;
    maeImprovementPct: number | null;
    rmseImprovementPct: number | null;
  };
  byRound: RoundEvaluation[];
}
