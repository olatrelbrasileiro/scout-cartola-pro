// src/lib/ml/lab.functions.ts

import type {
  HistoricalPlayerHistory,
  HistoricalPlayerRound,
} from '@/lib/data/historical.types';
import { predictByRecentAverage } from '@/lib/backtest/baseline';
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
import {
  POSITIONS,
  buildSortedVocab,
  computeMetrics,
  encodeOneHotWithUnknown,
  type CategoricalVerificationResult,
} from './evaluation.functions';
import {
  V21_SCOUT_FEATURE_NAMES,
  extractV21ScoutFeatures,
} from './evaluation.v21.functions';

/* ================================================================== *
 * Configuração do laboratório
 * ================================================================== */

export interface LabFeatureConfig {
  /** Nomes de campos numéricos de TrainingFeatureRow selecionados. */
  numericFeatures: string[];
  /** Se true, inclui one-hot de position (drop-TEC). */
  includePosition: boolean;
  /** Se true, inclui one-hot de clubId com UNKNOWN explícito. */
  includeClub: boolean;
  /** Se true, inclui one-hot de opponentClubId com UNKNOWN explícito. */
  includeOpponent: boolean;
  /** Nomes de scout features selecionadas (subconjunto de V21_SCOUT_FEATURE_NAMES). */
  scoutFeatures: string[];
}

export interface LabAudit {
  totalRowsChecked: number;
  baseNumericFeatures: number;
  positionFeatures: number;
  clubFeaturesLastRound: number;
  opponentFeaturesLastRound: number;
  scoutFeatures: number;
  noNaN: boolean;
  noInfinity: boolean;
  trainTestFeatureCountMatch: boolean;
  categoricalVerification: CategoricalVerificationResult;
  failures: string[];
}

export interface LabResult extends MLv1Result {
  totalFeatures: number;
  audit: LabAudit;
  /**
   * Métricas diagnósticas por posição. Chaves: 'GOL' | 'LAT' | 'ZAG' |
   * 'MEI' | 'ATA' | 'TEC' | '__UNKNOWN__'.
   *
   * NÃO altera `overall` nem participa do ranking do Feature Search.
   * A posição considerada é a posição real da linha de TESTE daquela
   * participação.
   */
  byPosition: Record<string, EvaluationMetrics>;
}

export interface LabRunResult {
  user: LabResult;
  /** Resumo da v1.2a executada no MESMO request, com os mesmos parâmetros. */
  v12aSummary: {
    predictions: number;
    mae: number | null;
    rmse: number | null;
    pearson: number | null;
  };
  /** Config efetivamente usada na execução. */
  config: LabFeatureConfig;
}

/* ================================================================== *
 * Extrator configurável
 * ================================================================== */

function buildLabFeatureVector(
  row: TrainingFeatureRow,
  config: LabFeatureConfig,
  clubVocab: number[],
  oppVocab: number[],
  priorPart: HistoricalPlayerRound[],
): (number | null)[] {
  const out: (number | null)[] = [];
  const rec = row as unknown as Record<string, unknown>;

  // 1) Numéricas
  for (const f of config.numericFeatures) {
    const v = rec[f];
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else out.push(null);
  }

  // 2) Position one-hot (drop TEC)
  if (config.includePosition) {
    const pos = row.position;
    for (let i = 0; i < POSITIONS.length - 1; i++) {
      out.push(pos === POSITIONS[i] ? 1 : pos === null ? null : 0);
    }
  }

  // 3) Club one-hot com UNKNOWN
  if (config.includeClub) {
    out.push(...encodeOneHotWithUnknown(row.clubId, clubVocab));
  }

  // 4) Opponent one-hot com UNKNOWN
  if (config.includeOpponent) {
    out.push(...encodeOneHotWithUnknown(row.opponentClubId, oppVocab));
  }

  // 5) Scout features (na ordem canônica de V21_SCOUT_FEATURE_NAMES)
  if (config.scoutFeatures.length > 0) {
    const prior = priorPart;
    const allScouts = extractV21ScoutFeatures(prior);
    const set = new Set(config.scoutFeatures);
    for (let i = 0; i < V21_SCOUT_FEATURE_NAMES.length; i++) {
      if (set.has(V21_SCOUT_FEATURE_NAMES[i])) out.push(allScouts[i]);
    }
  }

  return out;
}

/* ================================================================== *
 * Motor de avaliação temporal configurável
 * ================================================================== */

export function runConfigurableMLEvaluation(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  config: LabFeatureConfig,
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): LabResult {
  const historyByPlayer = new Map<number, HistoricalPlayerHistory>();
  for (const h of histories) historyByPlayer.set(h.playerId, h);

  const allMlPreds: number[] = [];
  const allBaselinePreds: number[] = [];
  const allActuals: number[] = [];

  const byRound: RoundEvaluation[] = [];

  let lastFeatureNames: string[] = [];
  let totalRowsChecked = 0;
  let noNaN = true;
  let noInfinity = true;
  let trainTestFeatureCountMatch = true;
  const failures: string[] = [];

  // Categorical verification flags (idênticas à v1.2a)
  let uca = true;
  let ucnak = true;
  let krefnu = true;
  let knrefnu = true;
  let uoa = true;
  let uonak = true;
  let korefnu = true;
  let konrefnu = true;

  let lastClubVocabSize = 0;
  let lastOppVocabSize = 0;

  // Acumulador por posição. Alimentado em paralelo, sem tocar em
  // allMlPreds/allActuals.
  const posAcc = new Map<string, { preds: number[]; actuals: number[] }>();

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

    const clubVocab = config.includeClub
      ? buildSortedVocab(trainRows.map((r) => r.clubId))
      : [];
    const oppVocab = config.includeOpponent
      ? buildSortedVocab(trainRows.map((r) => r.opponentClubId))
      : [];
    lastClubVocabSize = clubVocab.length;
    lastOppVocabSize = oppVocab.length;

    const priorOf = (row: TrainingFeatureRow): HistoricalPlayerRound[] => {
      const h = historyByPlayer.get(row.playerId);
      if (!h) return [];
      return h.rounds
        .filter((x) => x.round < row.round && x.participated)
        .sort((a, b) => a.round - b.round);
    };

    const buildVec = (row: TrainingFeatureRow): (number | null)[] =>
      buildLabFeatureVector(row, config, clubVocab, oppVocab, priorOf(row));

    const XtrainRaw = trainRows.map(buildVec);
    const XtestRaw = testRows.map(buildVec);
    const yTrain = trainRows.map((r) => r.target_points);

    totalRowsChecked += testRows.length;

    // ---- Categorical verification ----
    if (config.includeClub) {
      for (const r of testRows) {
        const oh = encodeOneHotWithUnknown(r.clubId, clubVocab);
        const uIdx = oh.length - 1;
        const known =
          r.clubId !== null && clubVocab.includes(r.clubId as number);
        const isRef = known && r.clubId === clubVocab[0];
        if (!known) {
          if (oh[uIdx] !== 1) {
            uca = false;
            failures.push(`R${R} p=${r.playerId}: UNKNOWN club não ativou UNKNOWN`);
          }
          const s = oh.slice(0, uIdx).reduce((a, b) => a + b, 0);
          if (s !== 0) {
            ucnak = false;
            failures.push(`R${R} p=${r.playerId}: UNKNOWN club ativou conhecida`);
          }
        } else if (isRef) {
          if (oh[uIdx] !== 0) {
            krefnu = false;
            failures.push(`R${R} p=${r.playerId}: REF club ativou UNKNOWN`);
          }
        } else if (oh[uIdx] !== 0) {
          knrefnu = false;
          failures.push(`R${R} p=${r.playerId}: KNOWN club ativou UNKNOWN`);
        }
      }
    }
    if (config.includeOpponent) {
      for (const r of testRows) {
        const oh = encodeOneHotWithUnknown(r.opponentClubId, oppVocab);
        const uIdx = oh.length - 1;
        const known =
          r.opponentClubId !== null &&
          oppVocab.includes(r.opponentClubId as number);
        const isRef = known && r.opponentClubId === oppVocab[0];
        if (!known) {
          if (oh[uIdx] !== 1) {
            uoa = false;
            failures.push(`R${R} p=${r.playerId}: UNKNOWN opp não ativou UNKNOWN`);
          }
          const s = oh.slice(0, uIdx).reduce((a, b) => a + b, 0);
          if (s !== 0) {
            uonak = false;
            failures.push(`R${R} p=${r.playerId}: UNKNOWN opp ativou conhecida`);
          }
        } else if (isRef) {
          if (oh[uIdx] !== 0) {
            korefnu = false;
            failures.push(`R${R} p=${r.playerId}: REF opp ativou UNKNOWN`);
          }
        } else if (oh[uIdx] !== 0) {
          konrefnu = false;
          failures.push(`R${R} p=${r.playerId}: KNOWN opp ativou UNKNOWN`);
        }
      }
    }

    // ---- Leakage de scouts ----
    if (config.scoutFeatures.length > 0) {
      for (const r of testRows) {
        for (const p of priorOf(r)) {
          if (p.round >= r.round) {
            failures.push(
              `R${R} p=${r.playerId}: scout usou round ${p.round} >= ${r.round}`,
            );
          }
        }
      }
    }

    // ---- Consistência treino/teste ----
    if (
      XtrainRaw.length > 0 &&
      XtestRaw.length > 0 &&
      XtrainRaw[0].length !== XtestRaw[0].length
    ) {
      trainTestFeatureCountMatch = false;
      failures.push(
        `R${R}: train (${XtrainRaw[0].length}) vs test (${XtestRaw[0].length}) feature count mismatch`,
      );
    }

    // ---- NaN / Infinity ----
    for (const vec of XtestRaw) {
      for (const v of vec) {
        if (v !== null) {
          if (Number.isNaN(v)) noNaN = false;
          if (!Number.isFinite(v)) noInfinity = false;
        }
      }
    }

    // ---- Treino ----
    const { means, stds } = computeMeansAndStds(XtrainRaw);
    const Xtrain = imputeAndStandardize(XtrainRaw, means, stds);
    const Xtest = imputeAndStandardize(XtestRaw, means, stds);

    const { weights, intercept } = fitRidge(Xtrain, yTrain, lambda);
    const mlPreds = predictRidge({ weights, intercept }, Xtest);

    const actuals = testRows.map((r) => r.target_points);

    allMlPreds.push(...mlPreds);
    allBaselinePreds.push(...baselinePreds);
    allActuals.push(...actuals);

    // Espelho por posição (não altera overall)
    for (let i = 0; i < testRows.length; i++) {
      const key = testRows[i].position ?? '__UNKNOWN__';
      let acc = posAcc.get(key);
      if (!acc) {
        acc = { preds: [], actuals: [] };
        posAcc.set(key, acc);
      }
      acc.preds.push(mlPreds[i]);
      acc.actuals.push(actuals[i]);
    }

    byRound.push({
      round: R,
      ml: computeMetrics(mlPreds, actuals),
      baseline: computeMetrics(baselinePreds, actuals),
    });

    // ---- Feature names desta rodada ----
    const names: string[] = [...config.numericFeatures];
    if (config.includePosition) {
      for (let i = 0; i < POSITIONS.length - 1; i++) {
        names.push(`position_${POSITIONS[i]}`);
      }
    }
    if (config.includeClub) {
      for (const c of clubVocab.slice(1)) names.push(`clubId_${c}`);
      names.push(`clubId_UNKNOWN`);
    }
    if (config.includeOpponent) {
      for (const c of oppVocab.slice(1)) names.push(`opponentClubId_${c}`);
      names.push(`opponentClubId_UNKNOWN`);
    }
    if (config.scoutFeatures.length > 0) {
      const set = new Set(config.scoutFeatures);
      for (const name of V21_SCOUT_FEATURE_NAMES) {
        if (set.has(name)) names.push(name);
      }
    }
    lastFeatureNames = names;
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

  const configOut: MLv1Config = {
    firstRound,
    lastRound,
    participationWindow,
    lambda,
    featureNames: lastFeatureNames,
  };

  const categoricalOk =
    uca && ucnak && krefnu && knrefnu && uoa && uonak && korefnu && konrefnu;

  const byPosition: Record<string, EvaluationMetrics> = {};
  for (const [pos, acc] of posAcc) {
    byPosition[pos] = computeMetrics(acc.preds, acc.actuals);
  }

  return {
    config: configOut,
    overall: {
      ml: mlOverall,
      baseline: baselineOverall,
      maeImprovementPct,
      rmseImprovementPct,
    },
    byRound,
    totalFeatures: lastFeatureNames.length,
    audit: {
      totalRowsChecked,
      baseNumericFeatures: config.numericFeatures.length,
      positionFeatures: config.includePosition ? POSITIONS.length - 1 : 0,
      clubFeaturesLastRound: config.includeClub
        ? Math.max(0, lastClubVocabSize - 1) + 1
        : 0,
      opponentFeaturesLastRound: config.includeOpponent
        ? Math.max(0, lastOppVocabSize - 1) + 1
        : 0,
      scoutFeatures: config.scoutFeatures.length,
      noNaN,
      noInfinity,
      trainTestFeatureCountMatch,
      categoricalVerification: {
        ok: categoricalOk,
        totalRowsChecked,
        featureCountEqualsV12Plus2: trainTestFeatureCountMatch,
        unknownClubActivatesUnknown: uca,
        unknownClubNeverActivatesKnown: ucnak,
        knownReferenceNeverActivatesUnknown: krefnu,
        knownNonRefNeverActivatesUnknown: knrefnu,
        unknownOppActivatesUnknown: uoa,
        unknownOppNeverActivatesKnown: uonak,
        knownOppReferenceNeverActivatesUnknown: korefnu,
        knownOppNonRefNeverActivatesUnknown: konrefnu,
        failures: failures.filter((f) => !f.includes('scout usou')),
      },
      failures,
    },
    byPosition,
  };
}

/* ================================================================== *
 * Configurações de referência (v1.2a e v2.1)
 * ================================================================== */

export const V12A_NUMERIC_FEATURES: readonly string[] = [
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
];

export const V12A_LAB_CONFIG: LabFeatureConfig = {
  numericFeatures: [...V12A_NUMERIC_FEATURES],
  includePosition: true,
  includeClub: true,
  includeOpponent: true,
  scoutFeatures: [],
};

export const V21_LAB_CONFIG: LabFeatureConfig = {
  numericFeatures: [...V12A_NUMERIC_FEATURES],
  includePosition: true,
  includeClub: true,
  includeOpponent: true,
  scoutFeatures: [...V21_SCOUT_FEATURE_NAMES],
};
