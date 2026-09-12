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

/* ================================================================== *
 * Listas-base de features
 * ================================================================== */

/**
 * Features numéricas usadas no modelo (lista base).
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

/**
 * Features numéricas usadas no v1.2 e v1.2a: as mesmas do v1.1 SEM
 * clubId, SEM opponentClubId e SEM points_avg_3_minus_avg_12.
 */
const NUMERIC_FEATURES_V12 = NUMERIC_FEATURES.filter(
  (f) =>
    f !== 'clubId' &&
    f !== 'opponentClubId' &&
    f !== 'points_avg_3_minus_avg_12',
);

/* ================================================================== *
 * Helpers compartilhados
 * ================================================================== */

function extractFeatureVector(
  row: TrainingFeatureRow,
  numericFeatures: readonly string[],
): (number | null)[] {
  const out: (number | null)[] = [];
  const rec = row as unknown as Record<string, unknown>;
  for (const f of numericFeatures) {
    const v = rec[f];
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

/**
 * Vocabulário ordenado deterministicamente. A categoria de referência
 * (drop-one) é o MENOR id presente no treino daquela rodada — escolha
 * determinística e independente do target.
 */
function buildSortedVocab(values: (number | null)[]): number[] {
  const set = new Set<number>();
  for (const v of values) if (v !== null) set.add(v);
  return [...set].sort((a, b) => a - b);
}

/* ================================================================== *
 * ML v1 / v1.1
 * ================================================================== */

export function runTemporalEvaluation(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
  excludeFeatures: readonly string[] = [],
): MLv1Result {
  const numericFeatures = NUMERIC_FEATURES.filter(
    (f) => !excludeFeatures.includes(f),
  );

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

    const XtrainRaw = trainRows.map((r) =>
      extractFeatureVector(r, numericFeatures),
    );
    const yTrain = trainRows.map((r) => r.target_points);
    const XtestRaw = testRows.map((r) =>
      extractFeatureVector(r, numericFeatures),
    );

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
    mlOverall.mae !== null &&
    baselineOverall.mae !== null &&
    baselineOverall.mae > 0
      ? ((baselineOverall.mae - mlOverall.mae) / baselineOverall.mae) * 100
      : null;

  const rmseImprovementPct =
    mlOverall.rmse !== null &&
    baselineOverall.rmse !== null &&
    baselineOverall.rmse > 0
      ? ((baselineOverall.rmse - mlOverall.rmse) / baselineOverall.rmse) * 100
      : null;

  const featureNames = [
    ...numericFeatures,
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

/* ================================================================== *
 * ML v1.2 — one-hot encoding temporal para clubId / opponentClubId
 * (UNKNOWN → all-zero, se confunde com a referência)
 * ================================================================== */

export interface CategoricalAuditEntry {
  round: number;
  trainClubCategories: number;
  trainOpponentCategories: number;
  unknownClubInTest: number;
  unknownOpponentInTest: number;
  finalFeatureCount: number;
}

export interface CategoricalAudit {
  byRound: CategoricalAuditEntry[];
  summary: {
    minFinalFeatureCount: number;
    maxFinalFeatureCount: number;
    totalUnknownClub: number;
    totalUnknownOpponent: number;
  };
}

export interface MLv1_2_Result extends MLv1Result {
  audit: CategoricalAudit;
}

/**
 * One-hot com drop-one (v1.2):
 * - vocab[0] é a categoria de referência → vetor all-zero.
 * - vocab[i>0] gera coluna i-1.
 * - valor null ou categoria desconhecida → vetor all-zero.
 *   (Equivale à referência; comportamento que a v1.2a corrige.)
 */
function encodeOneHot(value: number | null, vocab: number[]): number[] {
  const len = Math.max(0, vocab.length - 1);
  const out = new Array<number>(len).fill(0);
  if (value === null) return out;
  const idx = vocab.indexOf(value);
  if (idx <= 0) return out;
  out[idx - 1] = 1;
  return out;
}

export function runTemporalEvaluationWithCategorical(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): MLv1_2_Result {
  const historyByPlayer = new Map<number, HistoricalPlayerHistory>();
  for (const h of histories) historyByPlayer.set(h.playerId, h);

  const allMlPreds: number[] = [];
  const allBaselinePreds: number[] = [];
  const allActuals: number[] = [];

  const byRound: RoundEvaluation[] = [];
  const auditByRound: CategoricalAuditEntry[] = [];

  let lastFeatureNames: string[] = [];
  let minFinal = Number.POSITIVE_INFINITY;
  let maxFinal = 0;
  let totalUnknownClub = 0;
  let totalUnknownOpponent = 0;

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

    let unknownClubInTest = 0;
    let unknownOpponentInTest = 0;
    for (const r of testRows) {
      if (r.clubId !== null && !clubVocab.includes(r.clubId)) {
        unknownClubInTest++;
      }
      if (r.opponentClubId !== null && !oppVocab.includes(r.opponentClubId)) {
        unknownOpponentInTest++;
      }
    }
    totalUnknownClub += unknownClubInTest;
    totalUnknownOpponent += unknownOpponentInTest;

    const buildVec = (row: TrainingFeatureRow): (number | null)[] => {
      const base = extractFeatureVector(row, NUMERIC_FEATURES_V12);
      const clubOh = encodeOneHot(row.clubId, clubVocab);
      const oppOh = encodeOneHot(row.opponentClubId, oppVocab);
      return [...base, ...clubOh, ...oppOh];
    };

    const XtrainRaw = trainRows.map(buildVec);
    const XtestRaw = testRows.map(buildVec);
    const yTrain = trainRows.map((r) => r.target_points);

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

    const roundFeatureNames = [
      ...NUMERIC_FEATURES_V12,
      ...POSITIONS.slice(0, -1).map((p) => `position_${p}`),
      ...clubVocab.slice(1).map((c) => `clubId_${c}`),
      ...oppVocab.slice(1).map((c) => `opponentClubId_${c}`),
    ];
    lastFeatureNames = roundFeatureNames;

    const finalFeatureCount = roundFeatureNames.length;
    if (finalFeatureCount < minFinal) minFinal = finalFeatureCount;
    if (finalFeatureCount > maxFinal) maxFinal = finalFeatureCount;

    auditByRound.push({
      round: R,
      trainClubCategories: clubVocab.length,
      trainOpponentCategories: oppVocab.length,
      unknownClubInTest,
      unknownOpponentInTest,
      finalFeatureCount,
    });
  }

  if (!Number.isFinite(minFinal)) minFinal = 0;

  const mlOverall = computeMetrics(allMlPreds, allActuals);
  const baselineOverall = computeMetrics(allBaselinePreds, allActuals);

  const maeImprovementPct =
    mlOverall.mae !== null &&
    baselineOverall.mae !== null &&
    baselineOverall.mae > 0
      ? ((baselineOverall.mae - mlOverall.mae) / baselineOverall.mae) * 100
      : null;

  const rmseImprovementPct =
    mlOverall.rmse !== null &&
    baselineOverall.rmse !== null &&
    baselineOverall.rmse > 0
      ? ((baselineOverall.rmse - mlOverall.rmse) / baselineOverall.rmse) * 100
      : null;

  const config: MLv1Config = {
    firstRound,
    lastRound,
    participationWindow,
    lambda,
    featureNames: lastFeatureNames,
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
    audit: {
      byRound: auditByRound,
      summary: {
        minFinalFeatureCount: minFinal,
        maxFinalFeatureCount: maxFinal,
        totalUnknownClub,
        totalUnknownOpponent,
      },
    },
  };
}

/* ================================================================== *
 * ML v1.2a — UNKNOWN explícito em clubId / opponentClubId
 * (UNKNOWN → coluna dedicada)
 * ================================================================== */

export interface CategoricalVerificationResult {
  ok: boolean;
  totalRowsChecked: number;
  featureCountEqualsV12Plus2: boolean;
  unknownClubActivatesUnknown: boolean;
  unknownClubNeverActivatesKnown: boolean;
  knownReferenceNeverActivatesUnknown: boolean;
  knownNonRefNeverActivatesUnknown: boolean;
  unknownOppActivatesUnknown: boolean;
  unknownOppNeverActivatesKnown: boolean;
  knownOppReferenceNeverActivatesUnknown: boolean;
  knownOppNonRefNeverActivatesUnknown: boolean;
  failures: string[];
}

export interface MLv1_2a_Result extends MLv1Result {
  audit: CategoricalAudit;
  verification: CategoricalVerificationResult;
}

/**
 * One-hot com coluna UNKNOWN explícita (v1.2a).
 *
 * Estrutura das colunas (ordem):
 *   [ known_2, known_3, ..., known_K, UNKNOWN ]
 *
 * Regras:
 * - vocab[0] é a referência → vetor all-zero.
 * - vocab[i>0] ativa coluna i-1.
 * - valor null OU valor fora do vocab → ativa UNKNOWN (última coluna).
 * - UNKNOWN nunca participa do vocab e nunca é referência.
 */
function encodeOneHotWithUnknown(
  value: number | null,
  vocab: number[],
): number[] {
  const knownCols = Math.max(0, vocab.length - 1);
  const len = knownCols + 1; // +1 para UNKNOWN
  const out = new Array<number>(len).fill(0);
  const unknownIdx = len - 1;
  if (value === null) {
    out[unknownIdx] = 1;
    return out;
  }
  const idx = vocab.indexOf(value);
  if (idx < 0) {
    out[unknownIdx] = 1;
    return out;
  }
  if (idx === 0) return out; // referência
  out[idx - 1] = 1;
  return out;
}

export function runTemporalEvaluationWithCategoricalV12a(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): MLv1_2a_Result {
  const historyByPlayer = new Map<number, HistoricalPlayerHistory>();
  for (const h of histories) historyByPlayer.set(h.playerId, h);

  const allMlPreds: number[] = [];
  const allBaselinePreds: number[] = [];
  const allActuals: number[] = [];

  const byRound: RoundEvaluation[] = [];
  const auditByRound: CategoricalAuditEntry[] = [];

  let lastFeatureNames: string[] = [];
  let minFinal = Number.POSITIVE_INFINITY;
  let maxFinal = 0;
  let totalUnknownClub = 0;
  let totalUnknownOpponent = 0;

  // Verificação estrutural
  let totalRowsChecked = 0;
  let featureCountEqualsV12Plus2 = true;
  let unknownClubActivatesUnknown = true;
  let unknownClubNeverActivatesKnown = true;
  let knownReferenceNeverActivatesUnknown = true;
  let knownNonRefNeverActivatesUnknown = true;
  let unknownOppActivatesUnknown = true;
  let unknownOppNeverActivatesKnown = true;
  let knownOppReferenceNeverActivatesUnknown = true;
  let knownOppNonRefNeverActivatesUnknown = true;
  const failures: string[] = [];

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

    // Vocabulário ajustado APENAS no treino desta rodada.
    const clubVocab = buildSortedVocab(trainRows.map((r) => r.clubId));
    const oppVocab = buildSortedVocab(trainRows.map((r) => r.opponentClubId));

    // Auditoria: quantos UNKNOWN no teste (mesma semântica da v1.2).
    let unknownClubInTest = 0;
    let unknownOpponentInTest = 0;
    for (const r of testRows) {
      if (r.clubId !== null && !clubVocab.includes(r.clubId)) {
        unknownClubInTest++;
      }
      if (r.opponentClubId !== null && !oppVocab.includes(r.opponentClubId)) {
        unknownOpponentInTest++;
      }
    }
    totalUnknownClub += unknownClubInTest;
    totalUnknownOpponent += unknownOpponentInTest;

    const buildVec = (row: TrainingFeatureRow): (number | null)[] => {
      const base = extractFeatureVector(row, NUMERIC_FEATURES_V12);
      const clubOh = encodeOneHotWithUnknown(row.clubId, clubVocab);
      const oppOh = encodeOneHotWithUnknown(row.opponentClubId, oppVocab);
      return [...base, ...clubOh, ...oppOh];
    };

    const XtrainRaw = trainRows.map(buildVec);
    const XtestRaw = testRows.map(buildVec);
    const yTrain = trainRows.map((r) => r.target_points);

    // ---------- Verificação estrutural ----------
    totalRowsChecked += testRows.length;
    for (const r of testRows) {
      const clubOh = encodeOneHotWithUnknown(r.clubId, clubVocab);
      const oppOh = encodeOneHotWithUnknown(r.opponentClubId, oppVocab);
      const clubUnknownIdx = clubOh.length - 1;
      const oppUnknownIdx = oppOh.length - 1;

      const clubKnown =
        r.clubId !== null && clubVocab.includes(r.clubId as number);
      const oppKnown =
        r.opponentClubId !== null &&
        oppVocab.includes(r.opponentClubId as number);

      const isClubRef = clubKnown && r.clubId === clubVocab[0];
      const isOppRef = oppKnown && r.opponentClubId === oppVocab[0];

      // --- club checks
      if (!clubKnown) {
        if (clubOh[clubUnknownIdx] !== 1) {
          unknownClubActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN club não ativou UNKNOWN`);
        }
        const sumKnown = clubOh
          .slice(0, clubUnknownIdx)
          .reduce((a, b) => a + b, 0);
        if (sumKnown !== 0) {
          unknownClubNeverActivatesKnown = false;
          failures.push(
            `R${R} p=${r.playerId}: UNKNOWN club ativou coluna conhecida`,
          );
        }
      } else if (isClubRef) {
        if (clubOh[clubUnknownIdx] !== 0) {
          knownReferenceNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: REF club ativou UNKNOWN`);
        }
      } else {
        if (clubOh[clubUnknownIdx] !== 0) {
          knownNonRefNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: KNOWN club ativou UNKNOWN`);
        }
      }

      // --- opp checks
      if (!oppKnown) {
        if (oppOh[oppUnknownIdx] !== 1) {
          unknownOppActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN opp não ativou UNKNOWN`);
        }
        const sumKnown = oppOh
          .slice(0, oppUnknownIdx)
          .reduce((a, b) => a + b, 0);
        if (sumKnown !== 0) {
          unknownOppNeverActivatesKnown = false;
          failures.push(
            `R${R} p=${r.playerId}: UNKNOWN opp ativou coluna conhecida`,
          );
        }
      } else if (isOppRef) {
        if (oppOh[oppUnknownIdx] !== 0) {
          knownOppReferenceNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: REF opp ativou UNKNOWN`);
        }
      } else {
        if (oppOh[oppUnknownIdx] !== 0) {
          knownOppNonRefNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: KNOWN opp ativou UNKNOWN`);
        }
      }
    }

    // ---------- Invariante de contagem: v1.2a = v1.2 + 2 ----------
    const v12FeatureCount =
      NUMERIC_FEATURES_V12.length +
      (POSITIONS.length - 1) +
      Math.max(0, clubVocab.length - 1) +
      Math.max(0, oppVocab.length - 1);
    const v12aFeatureCount =
      NUMERIC_FEATURES_V12.length +
      (POSITIONS.length - 1) +
      Math.max(0, clubVocab.length - 1) +
      1 +
      Math.max(0, oppVocab.length - 1) +
      1;
    if (v12aFeatureCount !== v12FeatureCount + 2) {
      featureCountEqualsV12Plus2 = false;
      failures.push(
        `R${R}: v1.2a count ${v12aFeatureCount} != v1.2 count ${v12FeatureCount} + 2`,
      );
    }

    // ---------- Treino / predição ----------
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

    const roundFeatureNames = [
      ...NUMERIC_FEATURES_V12,
      ...POSITIONS.slice(0, -1).map((p) => `position_${p}`),
      ...clubVocab.slice(1).map((c) => `clubId_${c}`),
      `clubId_UNKNOWN`,
      ...oppVocab.slice(1).map((c) => `opponentClubId_${c}`),
      `opponentClubId_UNKNOWN`,
    ];
    lastFeatureNames = roundFeatureNames;

    const finalFeatureCount = roundFeatureNames.length;
    if (finalFeatureCount < minFinal) minFinal = finalFeatureCount;
    if (finalFeatureCount > maxFinal) maxFinal = finalFeatureCount;

    auditByRound.push({
      round: R,
      trainClubCategories: clubVocab.length,
      trainOpponentCategories: oppVocab.length,
      unknownClubInTest,
      unknownOpponentInTest,
      finalFeatureCount,
    });
  }

  if (!Number.isFinite(minFinal)) minFinal = 0;

  const mlOverall = computeMetrics(allMlPreds, allActuals);
  const baselineOverall = computeMetrics(allBaselinePreds, allActuals);

  const maeImprovementPct =
    mlOverall.mae !== null &&
    baselineOverall.mae !== null &&
    baselineOverall.mae > 0
      ? ((baselineOverall.mae - mlOverall.mae) / baselineOverall.mae) * 100
      : null;

  const rmseImprovementPct =
    mlOverall.rmse !== null &&
    baselineOverall.rmse !== null &&
    baselineOverall.rmse > 0
      ? ((baselineOverall.rmse - mlOverall.rmse) / baselineOverall.rmse) * 100
      : null;

  const config: MLv1Config = {
    firstRound,
    lastRound,
    participationWindow,
    lambda,
    featureNames: lastFeatureNames,
  };

  const verificationOk =
    featureCountEqualsV12Plus2 &&
    unknownClubActivatesUnknown &&
    unknownClubNeverActivatesKnown &&
    knownReferenceNeverActivatesUnknown &&
    knownNonRefNeverActivatesUnknown &&
    unknownOppActivatesUnknown &&
    unknownOppNeverActivatesKnown &&
    knownOppReferenceNeverActivatesUnknown &&
    knownOppNonRefNeverActivatesUnknown &&
    failures.length === 0;

  return {
    config,
    overall: {
      ml: mlOverall,
      baseline: baselineOverall,
      maeImprovementPct,
      rmseImprovementPct,
    },
    byRound,
    audit: {
      byRound: auditByRound,
      summary: {
        minFinalFeatureCount: minFinal,
        maxFinalFeatureCount: maxFinal,
        totalUnknownClub,
        totalUnknownOpponent,
      },
    },
    verification: {
      ok: verificationOk,
      totalRowsChecked,
      featureCountEqualsV12Plus2,
      unknownClubActivatesUnknown,
      unknownClubNeverActivatesKnown,
      knownReferenceNeverActivatesUnknown,
      knownNonRefNeverActivatesUnknown,
      unknownOppActivatesUnknown,
      unknownOppNeverActivatesKnown,
      knownOppReferenceNeverActivatesUnknown,
      knownOppNonRefNeverActivatesUnknown,
      failures,
    },
  };
}
