// src/lib/ml/search.functions.ts

import type {
  HistoricalPlayerHistory,
  HistoricalPlayerRound,
} from '@/lib/data/historical.types';
import { predictByRecentAverage } from '@/lib/backtest/baseline';
import type { TrainingDataset, TrainingFeatureRow } from './features.types';
import type { EvaluationMetrics, RoundEvaluation } from './model.types';
import {
  computeMeansAndStds,
  imputeAndStandardize,
  solveLinearSystem,
} from './model.functions';
import {
  POSITIONS,
  buildSortedVocab,
  computeMetrics,
  encodeOneHotWithUnknown,
} from './evaluation.functions';
import {
  V21_SCOUTS,
  V21_AGGREGATES,
  V21_SCOUT_FEATURE_NAMES,
  extractV21ScoutFeatures,
} from './evaluation.v21.functions';

/* ================================================================== *
 * Catálogo
 * ================================================================== */

export type FeatureGroup =
  | 'player_points'
  | 'player_scouts'
  | 'context'
  | 'position'
  | 'club';

export interface FeatureCatalogEntry {
  id: string;
  name: string;
  group: FeatureGroup;
  description: string;
}

const NUMERIC_IDS: readonly string[] = [
  'isHome',
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
];

const NUMERIC_LABELS: Record<string, string> = {
  isHome: 'Mandante',
  games_last_3_rounds: 'Partidas nas últimas 3 rodadas',
  games_last_5_rounds: 'Partidas nas últimas 5 rodadas',
  games_last_12_rounds: 'Partidas nas últimas 12 rodadas',
  points_avg_3: 'Média de pontos (últimas 3 participações)',
  points_avg_5: 'Média de pontos (últimas 5 participações)',
  points_avg_12: 'Média de pontos (últimas 12 participações)',
  points_std_5: 'Desvio padrão (últimas 5 participações)',
  points_std_12: 'Desvio padrão (últimas 12 participações)',
  points_min_5: 'Mínimo (últimas 5 participações)',
  points_max_5: 'Máximo (últimas 5 participações)',
  points_avg_3_minus_avg_12: 'Δ média 3 − média 12',
  home_points_avg: 'Média de pontos em casa',
  away_points_avg: 'Média de pontos fora',
  rounds_since_last_game: 'Rodadas desde a última participação',
};

export const FEATURE_CATALOG: FeatureCatalogEntry[] = [
  ...NUMERIC_IDS.map<FeatureCatalogEntry>((id) => ({
    id,
    name: id,
    group: id === 'isHome' ? 'context' : 'player_points',
    description: NUMERIC_LABELS[id] ?? id,
  })),
  {
    id: 'clubId',
    name: 'clubId',
    group: 'club',
    description: 'One-hot de clube (vocab train-only, drop-one, UNKNOWN explícito)',
  },
  {
    id: 'opponentClubId',
    name: 'opponentClubId',
    group: 'club',
    description: 'One-hot do clube adversário (vocab train-only, drop-one, UNKNOWN explícito)',
  },
  {
    id: 'position',
    name: 'position',
    group: 'position',
    description: 'One-hot de posição (drop-TEC)',
  },
  ...V21_SCOUTS.flatMap<FeatureCatalogEntry>((s) =>
    V21_AGGREGATES.map((a) => ({
      id: `scout_${s}_${a}`,
      name: `scout_${s}_${a}`,
      group: 'player_scouts',
      description: `Scout ${s as string} — agregado ${a} (round < alvo, partidas em que participou)`,
    })),
  ),
];

export const FEATURE_CATALOG_IDS: readonly string[] = FEATURE_CATALOG.map(
  (e) => e.id,
);

export const V12A_FEATURE_IDS: readonly string[] = [
  'isHome',
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
  'home_points_avg',
  'away_points_avg',
  'rounds_since_last_game',
  'clubId',
  'opponentClubId',
  'position',
];

/* ================================================================== *
 * Tipos do resultado
 * ================================================================== */

export type SearchStrategy = 'exhaustive' | 'forward' | 'beam';
export type SearchMetric = 'mae' | 'rmse' | 'pearson';

export interface SearchParams {
  strategy: SearchStrategy;
  metric: SearchMetric;
  beamWidth: number;
  maxFeatures: number;
  minFeatures: number;
  maxExperiments: number;
  minRoundsBetterThanBaseline: number;
  /** Fração: 0.2 = 20%. Use 1.0 para "sem limite". */
  maxSingleRoundMAEWorsening: number;
  lambda: number;
  firstRound: number;
  lastRound: number;
  participationWindow: number;
}

export interface ExperimentSummary {
  featureIds: string[];
  featureCount: number;
  columnCount: number;
  predictions: number;
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
  dMaeVsBaseline: number | null;
  dRmseVsBaseline: number | null;
  dPearsonVsBaseline: number | null;
  dMaeVsV12a: number | null;
  dRmseVsV12a: number | null;
  dPearsonVsV12a: number | null;
  roundsBetterThanBaseline: number;
  roundsWorseThanBaseline: number;
  bestRoundMAE: number | null;
  worstRoundMAE: number | null;
  maxSingleRoundMAEWorseningPct: number;
  robust: boolean;
  byRound: RoundEvaluation[];
  /**
   * Métricas por posição derivadas das mesmas previsões do experimento
   * (sem refit por posição). Chaves: 'GOL' | 'LAT' | 'ZAG' | 'MEI' |
   * 'ATA' | 'TEC' | '__UNKNOWN__'.
   */
  byPosition: Record<string, EvaluationMetrics>;
}

export interface FeatureFrequencyEntry {
  featureId: string;
  countTop: number;
  countBottom: number;
  pctTop: number;
  pctBottom: number;
}

export interface PositionRankingEntry {
  rank: number;
  featureIds: string[];
  featureCount: number;
  predictions: number;
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
  robust: boolean;
}

export interface PositionRankings {
  position: string;
  /** Nº de previsões naquela posição (constante entre experimentos). */
  predictions: number;
  bestMae: number | null;
  bestRmse: number | null;
  bestPearson: number | null;
  top: PositionRankingEntry[];
  frequency: FeatureFrequencyEntry[];
}

export interface SearchStageProgress {
  stage: string;
  experimentsRun: number;
  bestMAE: number | null;
}

export interface FeatureSearchResult {
  signature: string;
  timestamp: string;
  params: SearchParams;
  candidateIds: string[];
  estimatedExperiments: number;
  experimentCount: number;
  truncatedToLimit: boolean;
  best: ExperimentSummary | null;
  top: ExperimentSummary[];
  bottom: ExperimentSummary[];
  frequency: FeatureFrequencyEntry[];
  benchmarks: {
    baseline: {
      predictions: number;
      mae: number | null;
      rmse: number | null;
      pearson: number | null;
    };
    v12a: ExperimentSummary;
  };
  stages: SearchStageProgress[];
  cacheHits: number;
  cacheMisses: number;
  positionRankings: PositionRankings[];
}

/* ================================================================== *
 * Pré-computação por fold
 * ================================================================== */

interface PrecomputedFold {
  round: number;
  columnNames: string[];
  featureColumns: Map<string, number[]>;
  trainStdMatrix: number[][];
  testStdMatrix: number[][];
  fullXtX: number[][];
  fullXty: number[];
  yTrain: number[];
  actuals: number[];
  baselinePreds: number[];
  /** Posição de cada linha de teste (null → '__UNKNOWN__'). */
  testPositions: (string | null)[];
}

function buildColumnLayout(
  clubVocab: number[],
  oppVocab: number[],
): { names: string[]; featureColumns: Map<string, number[]> } {
  const names: string[] = [];
  const featureColumns = new Map<string, number[]>();

  // 1) Numeric
  for (const id of NUMERIC_IDS) {
    featureColumns.set(id, [names.length]);
    names.push(id);
  }

  // 2) Position one-hot
  const posStart = names.length;
  for (let i = 0; i < POSITIONS.length - 1; i++) {
    names.push(`position_${POSITIONS[i]}`);
  }
  featureColumns.set(
    'position',
    Array.from({ length: POSITIONS.length - 1 }, (_, i) => posStart + i),
  );

  // 3) Club one-hot + UNKNOWN
  const clubStart = names.length;
  for (const c of clubVocab.slice(1)) names.push(`clubId_${c}`);
  names.push(`clubId_UNKNOWN`);
  const clubCols: number[] = [];
  for (let i = clubStart; i < names.length; i++) clubCols.push(i);
  featureColumns.set('clubId', clubCols);

  // 4) Opponent one-hot + UNKNOWN
  const oppStart = names.length;
  for (const c of oppVocab.slice(1)) names.push(`opponentClubId_${c}`);
  names.push(`opponentClubId_UNKNOWN`);
  const oppCols: number[] = [];
  for (let i = oppStart; i < names.length; i++) oppCols.push(i);
  featureColumns.set('opponentClubId', oppCols);

  // 5) Scout features
  for (const f of V21_SCOUT_FEATURE_NAMES) {
    featureColumns.set(f, [names.length]);
    names.push(f);
  }

  return { names, featureColumns };
}

function buildRowVector(
  row: TrainingFeatureRow,
  priorPart: HistoricalPlayerRound[],
  clubVocab: number[],
  oppVocab: number[],
): (number | null)[] {
  const out: (number | null)[] = [];
  const rec = row as unknown as Record<string, unknown>;

  for (const id of NUMERIC_IDS) {
    const v = rec[id];
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else out.push(null);
  }

  for (let i = 0; i < POSITIONS.length - 1; i++) {
    out.push(
      row.position === POSITIONS[i] ? 1 : row.position === null ? null : 0,
    );
  }

  out.push(...encodeOneHotWithUnknown(row.clubId, clubVocab));
  out.push(...encodeOneHotWithUnknown(row.opponentClubId, oppVocab));
  out.push(...extractV21ScoutFeatures(priorPart));

  return out;
}

function precomputeFold(
  round: number,
  trainRows: TrainingFeatureRow[],
  testRows: TrainingFeatureRow[],
  yTrain: number[],
  actuals: number[],
  baselinePreds: number[],
  clubVocab: number[],
  oppVocab: number[],
  priorOf: (row: TrainingFeatureRow) => HistoricalPlayerRound[],
): PrecomputedFold {
  const { names, featureColumns } = buildColumnLayout(clubVocab, oppVocab);
  const P = names.length;

  const trainRaw = trainRows.map((r) =>
    buildRowVector(r, priorOf(r), clubVocab, oppVocab),
  );
  const testRaw = testRows.map((r) =>
    buildRowVector(r, priorOf(r), clubVocab, oppVocab),
  );

  const { means, stds } = computeMeansAndStds(trainRaw);
  const trainStd = imputeAndStandardize(trainRaw, means, stds);
  const testStd = imputeAndStandardize(testRaw, means, stds);

  const dim = P + 1;
  const n = trainStd.length;
  const fullXtX: number[][] = Array.from({ length: dim }, () =>
    new Array(dim).fill(0),
  );
  const fullXty = new Array(dim).fill(0);

  for (let a = 0; a < dim; a++) {
    for (let b = a; b < dim; b++) {
      let s = 0;
      if (a === 0 && b === 0) {
        s = n;
      } else if (a === 0) {
        for (let i = 0; i < n; i++) s += trainStd[i][b - 1];
      } else {
        for (let i = 0; i < n; i++) s += trainStd[i][a - 1] * trainStd[i][b - 1];
      }
      fullXtX[a][b] = s;
      fullXtX[b][a] = s;
    }
  }
  for (let a = 0; a < dim; a++) {
    let s = 0;
    if (a === 0) {
      for (let i = 0; i < n; i++) s += yTrain[i];
    } else {
      for (let i = 0; i < n; i++) s += trainStd[i][a - 1] * yTrain[i];
    }
    fullXty[a] = s;
  }

  const testPositions = testRows.map((r) => r.position ?? null);

  return {
    round,
    columnNames: names,
    featureColumns,
    trainStdMatrix: trainStd,
    testStdMatrix: testStd,
    fullXtX,
    fullXty,
    yTrain,
    actuals,
    baselinePreds,
    testPositions,
  };
}

/* ================================================================== *
 * Avaliação de uma combinação
 * ================================================================== */

function evaluateCombo(
  folds: PrecomputedFold[],
  featureIds: string[],
  lambda: number,
): ExperimentSummary {
  const allPreds: number[] = [];
  const allActuals: number[] = [];
  const allBaseline: number[] = [];
  const byRound: RoundEvaluation[] = [];
  const posAcc = new Map<string, { preds: number[]; actuals: number[] }>();
  let columnCount = 0;

  for (const fold of folds) {
    const selectedCols: number[] = [];
    for (const id of featureIds) {
      const cols = fold.featureColumns.get(id);
      if (cols) selectedCols.push(...cols);
    }
    if (selectedCols.length === 0) continue;
    columnCount = selectedCols.length;

    const idx = [0, ...selectedCols.map((c) => c + 1)];
    const subXtX = idx.map((i) => idx.map((j) => fold.fullXtX[i][j]));
    const subXty = idx.map((i) => fold.fullXty[i]);
    for (let i = 1; i < subXtX.length; i++) subXtX[i][i] += lambda;

    const beta = solveLinearSystem(subXtX, subXty);

    const preds = fold.testStdMatrix.map((row) => {
      let s = beta[0];
      for (let k = 0; k < selectedCols.length; k++) {
        s += beta[k + 1] * row[selectedCols[k]];
      }
      return s;
    });

    allPreds.push(...preds);
    allActuals.push(...fold.actuals);
    allBaseline.push(...fold.baselinePreds);

    // Agregação por posição: sem novo Ridge, apenas separa o que já existe
    for (let i = 0; i < fold.testPositions.length; i++) {
      const key = fold.testPositions[i] ?? '__UNKNOWN__';
      let acc = posAcc.get(key);
      if (!acc) {
        acc = { preds: [], actuals: [] };
        posAcc.set(key, acc);
      }
      acc.preds.push(preds[i]);
      acc.actuals.push(fold.actuals[i]);
    }

    byRound.push({
      round: fold.round,
      ml: computeMetrics(preds, fold.actuals),
      baseline: computeMetrics(fold.baselinePreds, fold.actuals),
    });
  }

  const ml = computeMetrics(allPreds, allActuals);
  const bl = computeMetrics(allBaseline, allActuals);

  let roundsBetter = 0;
  let roundsWorse = 0;
  let bestRoundMAE: number | null = null;
  let worstRoundMAE: number | null = null;
  let maxWorseningPct = 0;
  for (const r of byRound) {
    if (r.ml.mae !== null && r.baseline.mae !== null) {
      if (r.ml.mae < r.baseline.mae) roundsBetter++;
      else if (r.ml.mae > r.baseline.mae) roundsWorse++;
      if (bestRoundMAE === null || r.ml.mae < bestRoundMAE) bestRoundMAE = r.ml.mae;
      if (worstRoundMAE === null || r.ml.mae > worstRoundMAE) worstRoundMAE = r.ml.mae;
      if (r.baseline.mae > 0) {
        const w = (r.ml.mae - r.baseline.mae) / r.baseline.mae;
        if (w > maxWorseningPct) maxWorseningPct = w;
      }
    }
  }

  const byPosition: Record<string, EvaluationMetrics> = {};
  for (const [pos, acc] of posAcc) {
    byPosition[pos] = computeMetrics(acc.preds, acc.actuals);
  }

  return {
    featureIds: [...featureIds].sort(),
    featureCount: featureIds.length,
    columnCount,
    predictions: ml.count,
    mae: ml.mae,
    rmse: ml.rmse,
    pearson: ml.pearson,
    dMaeVsBaseline:
      ml.mae !== null && bl.mae !== null ? ml.mae - bl.mae : null,
    dRmseVsBaseline:
      ml.rmse !== null && bl.rmse !== null ? ml.rmse - bl.rmse : null,
    dPearsonVsBaseline:
      ml.pearson !== null && bl.pearson !== null ? ml.pearson - bl.pearson : null,
    dMaeVsV12a: null,
    dRmseVsV12a: null,
    dPearsonVsV12a: null,
    roundsBetterThanBaseline: roundsBetter,
    roundsWorseThanBaseline: roundsWorse,
    bestRoundMAE,
    worstRoundMAE,
    maxSingleRoundMAEWorseningPct: maxWorseningPct,
    robust: false,
    byRound,
    byPosition,
  };
}

/* ================================================================== *
 * Precompute global (dataset → folds)
 * ================================================================== */

export function precomputeFolds(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
): PrecomputedFold[] {
  const historyByPlayer = new Map<number, HistoricalPlayerHistory>();
  for (const h of histories) historyByPlayer.set(h.playerId, h);

  const folds: PrecomputedFold[] = [];

  for (let R = firstRound; R <= lastRound; R++) {
    const trainRows = dataset.rows.filter(
      (r) => r.round < R && r.target_participated,
    );
    const testCandidates = dataset.rows.filter(
      (r) => r.round === R && r.target_participated,
    );
    if (trainRows.length === 0 || testCandidates.length === 0) continue;

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

    const clubVocab = buildSortedVocab(trainRows.map((r) => r.clubId));
    const oppVocab = buildSortedVocab(trainRows.map((r) => r.opponentClubId));

    const priorOf = (row: TrainingFeatureRow): HistoricalPlayerRound[] => {
      const h = historyByPlayer.get(row.playerId);
      if (!h) return [];
      return h.rounds
        .filter((x) => x.round < row.round && x.participated)
        .sort((a, b) => a.round - b.round);
    };

    const yTrain = trainRows.map((r) => r.target_points);
    const actuals = testRows.map((r) => r.target_points);

    folds.push(
      precomputeFold(
        R,
        trainRows,
        testRows,
        yTrain,
        actuals,
        baselinePreds,
        clubVocab,
        oppVocab,
        priorOf,
      ),
    );
  }

  return folds;
}

/* ================================================================== *
 * Estimador combinatório
 * ================================================================== */

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let num = 1;
  let den = 1;
  for (let i = 0; i < k; i++) {
    num *= n - i;
    den *= i + 1;
    if (num / den > 1e12) return Infinity;
  }
  return num / den;
}

export function estimateExhaustive(
  n: number,
  minF: number,
  maxF: number,
): number {
  let total = 0;
  for (let k = minF; k <= maxF; k++) {
    total += choose(n, k);
    if (total > 1e9) return total;
  }
  return total;
}

function estimateBeam(
  n: number,
  minF: number,
  maxF: number,
  beamWidth: number,
): number {
  const stages = Math.max(0, maxF - Math.max(1, minF) + 1);
  return Math.min(1e9, stages * beamWidth * n);
}

/* ================================================================== *
 * Comparadores
 * ================================================================== */

function makeComparator(
  metric: SearchMetric,
  tieBreakOnFeatureCount: boolean,
): (a: ExperimentSummary, b: ExperimentSummary) => number {
  const primary = (x: ExperimentSummary): number => {
    const v = x[metric];
    if (v === null) return metric === 'pearson' ? -Infinity : Infinity;
    return v;
  };
  const asc = metric === 'mae' || metric === 'rmse';
  return (a, b) => {
    const va = primary(a);
    const vb = primary(b);
    if (va !== vb) return asc ? va - vb : vb - va;
    if (tieBreakOnFeatureCount && a.featureCount !== b.featureCount) {
      return a.featureCount - b.featureCount;
    }
    return a.featureIds.join('|').localeCompare(b.featureIds.join('|'));
  };
}

function makePositionComparator(
  position: string,
  metric: SearchMetric,
): (a: ExperimentSummary, b: ExperimentSummary) => number {
  const read = (x: ExperimentSummary): number => {
    const e = x.byPosition[position];
    if (!e) return metric === 'pearson' ? -Infinity : Infinity;
    const v = e[metric];
    if (v === null) return metric === 'pearson' ? -Infinity : Infinity;
    return v;
  };
  const asc = metric === 'mae' || metric === 'rmse';
  return (a, b) => {
    const va = read(a);
    const vb = read(b);
    if (va !== vb) return asc ? va - vb : vb - va;
    return a.featureIds.join('|').localeCompare(b.featureIds.join('|'));
  };
}

/* ================================================================== *
 * Busca
 * ================================================================== */

const POSITION_ORDER = ['GOL', 'LAT', 'ZAG', 'MEI', 'ATA', 'TEC'] as const;

export function runFeatureSearch(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  params: SearchParams,
  candidateIds: string[],
): FeatureSearchResult {
  if (candidateIds.length === 0) {
    throw new Error('Nenhuma feature candidata selecionada.');
  }
  if (params.minFeatures > params.maxFeatures) {
    throw new Error('minFeatures > maxFeatures.');
  }

  const stages: SearchStageProgress[] = [];
  const cache = new Map<string, ExperimentSummary>();
  let cacheHits = 0;
  let cacheMisses = 0;

  const canonicalKey = (ids: string[]): string => [...ids].sort().join('|');

  const folds = precomputeFolds(
    dataset,
    histories,
    params.firstRound,
    params.lastRound,
    params.participationWindow,
  );
  if (folds.length === 0) {
    throw new Error('Nenhum fold válido foi construído para o intervalo dado.');
  }

  const evaluate = (ids: string[]): ExperimentSummary => {
    const key = canonicalKey(ids);
    const hit = cache.get(key);
    if (hit) {
      cacheHits++;
      return hit;
    }
    cacheMisses++;
    const res = evaluateCombo(folds, ids, params.lambda);
    cache.set(key, res);
    return res;
  };

  const v12a = evaluate(V12A_FEATURE_IDS);

  let baselinePredsAll: number[] = [];
  let baselineActualsAll: number[] = [];
  for (const f of folds) {
    baselinePredsAll = baselinePredsAll.concat(f.baselinePreds);
    baselineActualsAll = baselineActualsAll.concat(f.actuals);
  }
  const baselineMetrics = computeMetrics(baselinePredsAll, baselineActualsAll);

  const markRobust = (e: ExperimentSummary): ExperimentSummary => ({
    ...e,
    dMaeVsV12a:
      e.mae !== null && v12a.mae !== null ? e.mae - v12a.mae : null,
    dRmseVsV12a:
      e.rmse !== null && v12a.rmse !== null ? e.rmse - v12a.rmse : null,
    dPearsonVsV12a:
      e.pearson !== null && v12a.pearson !== null
        ? e.pearson - v12a.pearson
        : null,
    robust:
      e.roundsBetterThanBaseline >= params.minRoundsBetterThanBaseline &&
      e.maxSingleRoundMAEWorseningPct <= params.maxSingleRoundMAEWorsening,
  });

  const comparator = makeComparator(params.metric, false);

  const estimate =
    params.strategy === 'exhaustive'
      ? estimateExhaustive(
          candidateIds.length,
          params.minFeatures,
          params.maxFeatures,
        )
      : estimateBeam(
          candidateIds.length,
          params.minFeatures,
          params.maxFeatures,
          params.strategy === 'forward' ? 1 : params.beamWidth,
        );

  if (params.strategy === 'exhaustive' && estimate > params.maxExperiments) {
    throw new Error(
      `Estimativa exhaustive = ${estimate} > maxExperiments (${params.maxExperiments}). ` +
        `Use estratégia beam ou reduza maxFeatures.`,
    );
  }

  const allExperiments = new Map<string, ExperimentSummary>();
  let truncatedToLimit = false;

  if (params.strategy === 'exhaustive') {
    const n = candidateIds.length;
    const minF = Math.max(1, params.minFeatures);
    const maxF = Math.min(n, params.maxFeatures);

    const recurse = (start: number, current: string[]): void => {
      if (current.length >= minF) {
        const key = canonicalKey(current);
        if (!allExperiments.has(key)) {
          allExperiments.set(key, markRobust(evaluate([...current])));
        }
      }
      if (current.length === maxF) return;
      for (let i = start; i < n; i++) {
        current.push(candidateIds[i]);
        recurse(i + 1, current);
        current.pop();
        if (allExperiments.size >= params.maxExperiments) {
          truncatedToLimit = true;
          return;
        }
      }
    };
    recurse(0, []);

    let bestMae: number | null = null;
    for (const e of allExperiments.values()) {
      if (e.mae !== null && (bestMae === null || e.mae < bestMae)) bestMae = e.mae;
    }
    stages.push({
      stage: 'Exhaustive',
      experimentsRun: allExperiments.size,
      bestMAE: bestMae,
    });
  } else {
    const beamWidth =
      params.strategy === 'forward' ? 1 : Math.max(1, params.beamWidth);
    const n = candidateIds.length;
    const minF = Math.max(1, params.minFeatures);
    const maxF = Math.min(n, params.maxFeatures);

    let beam: string[][] = [];

    for (let k = minF; k <= maxF; k++) {
      const candidates: string[][] = [];

      if (beam.length === 0) {
        for (const id of candidateIds) candidates.push([id]);
      } else {
        for (const b of beam) {
          for (const id of candidateIds) {
            if (b.includes(id)) continue;
            candidates.push([...b, id]);
          }
        }
      }

      const scored: ExperimentSummary[] = [];
      for (const c of candidates) {
        const key = canonicalKey(c);
        if (allExperiments.has(key)) continue;
        const res = markRobust(evaluate([...c].sort()));
        allExperiments.set(key, res);
        scored.push(res);
        if (allExperiments.size >= params.maxExperiments) {
          truncatedToLimit = true;
          break;
        }
      }

      const rankedThisStage = [...scored].sort(comparator);
      beam = rankedThisStage
        .slice(0, beamWidth)
        .map((s) => [...s.featureIds]);

      let bestMae: number | null = null;
      for (const e of allExperiments.values()) {
        if (e.mae !== null && (bestMae === null || e.mae < bestMae)) bestMae = e.mae;
      }
      stages.push({
        stage: `Estágio k=${k} (${params.strategy})`,
        experimentsRun: allExperiments.size,
        bestMAE: bestMae,
      });

      if (truncatedToLimit) break;
    }
  }

  const allArr = Array.from(allExperiments.values());
  const sorted = [...allArr].sort(comparator);
  const top = sorted.slice(0, 10);
  const bottom = sorted.slice(-10).reverse();
  const best = sorted.length > 0 ? sorted[0] : null;

  const frequency: FeatureFrequencyEntry[] = candidateIds
    .map((id) => {
      const countTop = top.reduce(
        (acc, e) => acc + (e.featureIds.includes(id) ? 1 : 0),
        0,
      );
      const countBottom = bottom.reduce(
        (acc, e) => acc + (e.featureIds.includes(id) ? 1 : 0),
        0,
      );
      return {
        featureId: id,
        countTop,
        countBottom,
        pctTop: top.length > 0 ? countTop / top.length : 0,
        pctBottom: bottom.length > 0 ? countBottom / bottom.length : 0,
      };
    })
    .sort(
      (a, b) =>
        b.countTop - a.countTop || a.featureId.localeCompare(b.featureId),
    );

  // ---------- Rankings por posição (derivados, sem refit) ----------
  const positionRankings: PositionRankings[] = [];
  const positionsToRank: string[] = [...POSITION_ORDER, '__UNKNOWN__'];

  for (const pos of positionsToRank) {
    const eligible = allArr.filter((e) => (e.byPosition[pos]?.count ?? 0) > 0);
    if (eligible.length === 0) continue;

    const posSorted = [...eligible].sort(
      makePositionComparator(pos, params.metric),
    );
    const posTop = posSorted.slice(0, 10).map((e, i): PositionRankingEntry => {
      const m = e.byPosition[pos];
      return {
        rank: i + 1,
        featureIds: [...e.featureIds],
        featureCount: e.featureCount,
        predictions: m.count,
        mae: m.mae,
        rmse: m.rmse,
        pearson: m.pearson,
        robust: e.robust,
      };
    });

    let bestMae: number | null = null;
    let bestRmse: number | null = null;
    let bestPearson: number | null = null;
    for (const e of eligible) {
      const m = e.byPosition[pos];
      if (m.mae !== null && (bestMae === null || m.mae < bestMae)) bestMae = m.mae;
      if (m.rmse !== null && (bestRmse === null || m.rmse < bestRmse))
        bestRmse = m.rmse;
      if (m.pearson !== null && (bestPearson === null || m.pearson > bestPearson))
        bestPearson = m.pearson;
    }

    const freqMap = new Map<string, number>();
    for (const e of posTop) {
      for (const f of e.featureIds) {
        freqMap.set(f, (freqMap.get(f) ?? 0) + 1);
      }
    }
    const posFrequency: FeatureFrequencyEntry[] = candidateIds
      .map((id) => {
        const c = freqMap.get(id) ?? 0;
        return {
          featureId: id,
          countTop: c,
          countBottom: 0,
          pctTop: posTop.length > 0 ? c / posTop.length : 0,
          pctBottom: 0,
        };
      })
      .sort(
        (a, b) =>
          b.countTop - a.countTop || a.featureId.localeCompare(b.featureId),
      );

    positionRankings.push({
      position: pos,
      predictions: eligible[0].byPosition[pos].count,
      bestMae,
      bestRmse,
      bestPearson,
      top: posTop,
      frequency: posFrequency,
    });
  }

  const signature = [
    params.lambda,
    params.firstRound,
    params.lastRound,
    params.participationWindow,
    candidateIds.slice().sort().join(','),
  ].join('::');

  return {
    signature,
    timestamp: new Date().toISOString(),
    params,
    candidateIds: [...candidateIds].sort(),
    estimatedExperiments: estimate,
    experimentCount: allArr.length,
    truncatedToLimit,
    best,
    top,
    bottom,
    frequency,
    benchmarks: {
      baseline: {
        predictions: baselineMetrics.count,
        mae: baselineMetrics.mae,
        rmse: baselineMetrics.rmse,
        pearson: baselineMetrics.pearson,
      },
      v12a: markRobust(v12a),
    },
    stages,
    cacheHits,
    cacheMisses,
    positionRankings,
  };
}

/* ================================================================== *
 * Métricas derivadas
 * ================================================================== */

export function summarizeV12a(v12a: ExperimentSummary): {
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
} {
  return { mae: v12a.mae, rmse: v12a.rmse, pearson: v12a.pearson };
}

export { V21_SCOUTS, V21_AGGREGATES, V21_SCOUT_FEATURE_NAMES };

export type { CartolaScouts } from '@/lib/data/historical.types';
