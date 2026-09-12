// src/lib/ml/evaluation.functions.ts

import type { HistoricalPlayerHistory } from '@/lib/data/historical.types';
import { predictByRecentAverage } from '@/lib/backtest/baseline';
import { mae, rmse, pearson } from '@/lib/backtest/metrics';
import type { TrainingDataset, TrainingFeatureRow } from './features.types';
import type {
  EvaluationMetrics,
  MLv1Config,
  MLv1Result,
  RoundEvaluation,
} from './model.types';
import {
  computeMeansAndStds,
  fitRidge,
  imputeAndStandardize,
  predictRidge,
} from './model.functions';

/**
 * Features numéricas usadas no modelo.
 *
 * IMPORTANTE: `clubId` e `position` são marcados como UNKNOWN na
 * auditoria de proveniência histórica — vêm do payload pós-rodada de
 * /atletas/pontuados. Mantidos aqui por decisão explícita do projeto.
 */
const NUMERIC_FEATURES = [
  'clubId',
  'isHome',
  'opponentClubId',
  'games_last_3_rounds',
  'games_last_5_rounds',
  'games_last_12_rounds',
  'points_avg_3',
  'points_avg_5',
  'points_avg_12',
  'points_std_5',
  'points_std_12',
  'points_min_5',
  'points_max_5',
  'points_avg_3_minus_avg_12',
  'home_points_avg',
  'away_points_avg',
  'rounds_since_last_game',
] as const;

const POSITIONS = ['GOL', 'LAT', 'ZAG', 'MEI', 'ATA', 'TEC'] as const;
// one-hot: 5 dummies (TEC é a categoria de referência)

function extractFeatureVector(row: TrainingFeatureRow): (number | null)[] {
  const out: (number | null)[] = [];
  for (const f of NUMERIC_FEATURES) {
    const v = (row as unknown as Record<string, unknown>)[f];
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else out.push(null);
  }
  // one-hot position (drop TEC)
  const pos = row.position;
  for (let i = 0; i < POSITIONS.length - 1; i++) {
    out.push(pos === POSITIONS[i] ? 1 : pos === null ? null : 0);
  }
  return out;
}

function computeMetrics(
  predictions: number[],
  actuals: number[],
): EvaluationMetrics {
  if (predictions.length === 0) {
    return { count: 0, mae: null, rmse: null, pearson: null };
  }
  return {
    count: predictions.length,
    mae: mae(predictions, actuals),
    rmse: rmse(predictions, actuals),
    pearson: pearson(predictions, actuals),
  };
}

export function runTemporalEvaluation(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): MLv1Result {
  const historyByPlayer = new Map<number, HistoricalPlayerHistory>();
  for (const h of histories) historyByPlayer.set(h.playerId, h);

  const allMlPreds: number[] = [];
  const allBaselinePreds: number[] = [];
  const allActuals: number[] = [];

  const byRound: RoundEvaluation[] = [];

  for (let R = firstRound; R <= lastRound; R++) {
    const trainRows = dataset.rows.filter(
      (r) => r.round < R && r.target_participated,
    );
    const testCandidates = dataset.rows.filter(
      (r) => r.round === R && r.target_participated,
    );

    if (trainRows.length === 0 || testCandidates.length === 0) continue;

    // Filtra teste para linhas onde o baseline prevê (comparação justa)
    const testRows: TrainingFeatureRow[] = [];
    const baselinePreds: number[] = [];
    for (const row of testCandidates) {
      const h = historyByPlayer.get(row.playerId);
      if (!h) continue;
      const pred = predictByRecentAverage(h, R, participationWindow);
      if (pred === null) continue;
      testRows.push(row);
      baselinePreds.push(pred);
    }

    if (testRows.length === 0) continue;

    const XtrainRaw = trainRows.map(extractFeatureVector);
    const yTrain = trainRows.map((r) => r.target_points);
    const XtestRaw = testRows.map(extractFeatureVector);

    const { means, stds } = computeMeansAndStds(XtrainRaw);
    const Xtrain = imputeAndStandardize(XtrainRaw, means, stds);
    const Xtest = imputeAndStandardize(XtestRaw, means, stds);

    const { weights, intercept } = fitRidge(Xtrain, yTrain, lambda);
    const mlPreds = predictRidge({ weights, intercept }, Xtest);

    const actuals = testRows.map((r) => r.target_points);

    allMlPreds.push(...mlPreds);
    allBaselinePreds.push(...baselinePreds);
    allActuals.push(...actuals);

    byRound.push({
      round: R,
      ml: computeMetrics(mlPreds, actuals),
      baseline: computeMetrics(baselinePreds, actuals),
    });
  }

  const mlOverall = computeMetrics(allMlPreds, allActuals);
  const baselineOverall = computeMetrics(allBaselinePreds, allActuals);

  const maeImprovementPct =
    mlOverall.mae !== null && baselineOverall.mae !== null && baselineOverall.mae > 0
      ? ((baselineOverall.mae - mlOverall.mae) / baselineOverall.mae) * 100
      : null;

  const rmseImprovementPct =
    mlOverall.rmse !== null && baselineOverall.rmse !== null && baselineOverall.rmse > 0
      ? ((baselineOverall.rmse - mlOverall.rmse) / baselineOverall.rmse) * 100
      : null;

  const featureNames = [
    ...NUMERIC_FEATURES,
    ...POSITIONS.slice(0, -1).map((p) => `position_${p}`),
  ];

  const config: MLv1Config = {
    firstRound,
    lastRound,
    participationWindow,
    lambda,
    featureNames,
  };

  return {
    config,
    overall: {
      ml: mlOverall,
      baseline: baselineOverall,
      maeImprovementPct,
      rmseImprovementPct,
    },
    byRound,
  };
}
