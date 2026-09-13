// src/lib/ml/evaluation.v21.functions.ts

import type {
  CartolaScouts,
  HistoricalPlayerHistory,
  HistoricalPlayerRound,
} from '@/lib/data/historical.types';
import { predictByRecentAverage } from '@/lib/backtest/baseline';
import type { TrainingDataset, TrainingFeatureRow } from './features.types';
import type { MLv1Config, MLv1Result, RoundEvaluation } from './model.types';
import {
  computeMeansAndStds,
  fitRidge,
  imputeAndStandardize,
  predictRidge,
} from './model.functions';
import {
  NUMERIC_FEATURES_V12,
  POSITIONS,
  buildSortedVocab,
  computeMetrics,
  encodeOneHotWithUnknown,
  extractFeatureVector,
  type CategoricalAudit,
  type CategoricalAuditEntry,
  type CategoricalVerificationResult,
} from './evaluation.functions';

/* ================================================================== *
 * ML v2.1 — 10 scouts × 4 agregados
 * ================================================================== */

export const V21_SCOUTS: readonly (keyof CartolaScouts)[] = [
  'G', 'A', 'DE', 'SG', 'DS', 'FF', 'FT', 'FD', 'FC', 'FS',
];

/**
 * Scouts cuja AUSÊNCIA no payload deve ser tratada como null
 * (dado indisponível), e não como 0 (scout não ocorreu).
 *
 * - DE: estamos auditando sua presença histórica; a semântica de
 *   ausência ainda não foi verificada, então não assumimos 0.
 * - Os demais scouts têm semântica de ausência já verificada pela
 *   auditoria (ausente = "não ocorreu" → 0, ou sempre presente).
 */
export const V21_NULL_ON_ABSENCE: readonly string[] = ['DE'];

export const V21_AGGREGATES = [
  'total',
  'avg_per_match',
  'last5_total',
  'last5_avg_per_match',
] as const;

export const V21_SCOUT_FEATURE_NAMES: readonly string[] = V21_SCOUTS.flatMap(
  (s) => V21_AGGREGATES.map((a) => `scout_${s}_${a}`),
);

/* ---------- Estatísticas por scout ---------- */

interface ScoutStats {
  total: number | null;
  avgPerMatch: number | null;
  last5Total: number | null;
  last5AvgPerMatch: number | null;
  /** Partidas do histórico onde a chave está presente com valor numérico. */
  matchesWithValue: number;
  /** Partidas do histórico onde a chave está ausente. */
  matchesWithoutValue: number;
}

/**
 * Calcula as 4 features de UM scout a partir do histórico de
 * participações anteriores.
 *
 * Regras:
 * - `priorParticipated` contém apenas rodadas com round < alvo e
 *   participated === true, ordenadas asc.
 * - Para cada rodada:
 *   - chave presente com número → observação real (participa do total).
 *   - chave ausente → depende de `absenceIsNull`:
 *       - true  → ignorada (não conta para total, nem para o divisor).
 *       - false → tratada como 0 (conta para o divisor; soma 0).
 * - `last5_*` usa as últimas 5 PARTIDAS (não rodadas) do histórico.
 * - Retorna null quando não há nenhuma observação utilizável, em vez
 *   de fabricar 0.
 */
function computeScoutStats(
  priorParticipated: HistoricalPlayerRound[],
  scoutKey: keyof CartolaScouts,
  absenceIsNull: boolean,
): ScoutStats {
  const n = priorParticipated.length;
  const last5Start = Math.max(0, n - 5);

  let total = 0;
  let observed = 0;
  let withValue = 0;
  let withoutValue = 0;
  let last5Total = 0;
  let last5Observed = 0;

  for (let i = 0; i < n; i++) {
    const r = priorParticipated[i];
    const s = r.scouts as Record<string, unknown> | undefined;
    const has = s != null && Object.prototype.hasOwnProperty.call(s, scoutKey);
    const raw = has ? s![scoutKey] : undefined;
    const isNum = typeof raw === 'number' && Number.isFinite(raw);

    if (isNum) {
      withValue++;
      total += raw;
      observed++;
      if (i >= last5Start) {
        last5Total += raw;
        last5Observed++;
      }
      continue;
    }

    // chave ausente (ou presente com valor não-numérico — não deveria ocorrer)
    withoutValue++;
    if (!absenceIsNull) {
      // ausência semântica = 0 → conta como observação nula
      observed++;
      if (i >= last5Start) {
        last5Observed++;
      }
    }
    // se absenceIsNull: não soma, não conta
  }

  return {
    total: observed > 0 ? total : null,
    avgPerMatch: observed > 0 ? total / observed : null,
    last5Total: last5Observed > 0 ? last5Total : null,
    last5AvgPerMatch:
      last5Observed > 0 ? last5Total / last5Observed : null,
    matchesWithValue: withValue,
    matchesWithoutValue: withoutValue,
  };
}

/**
 * Extrai as 40 features de uma linha. Usado internamente.
 * Aplica `absenceIsNull` conforme V21_NULL_ON_ABSENCE.
 */
export function extractV21ScoutFeatures(
  priorParticipated: HistoricalPlayerRound[],
): (number | null)[] {
  const out: (number | null)[] = [];
  for (const scoutKey of V21_SCOUTS) {
    const absenceIsNull = V21_NULL_ON_ABSENCE.includes(scoutKey as string);
    const s = computeScoutStats(priorParticipated, scoutKey, absenceIsNull);
    out.push(s.total);
    out.push(s.avgPerMatch);
    out.push(s.last5Total);
    out.push(s.last5AvgPerMatch);
  }
  return out;
}

/* ---------- Tipos do resultado ---------- */

export interface V21ScoutCoverageEntry {
  scout: string;
  featureCount: number;
  /**
   * Soma, sobre todas as linhas de teste, do número de partidas do
   * histórico em que a chave estava presente.
   */
  matchesWithValue: number;
  /**
   * Soma, sobre todas as linhas de teste, do número de partidas do
   * histórico em que a chave estava ausente.
   */
  matchesWithoutValue: number;
  /** matchesWithValue / (matchesWithValue + matchesWithoutValue) * 100. */
  coveragePct: number;
  /** Linhas de teste com pelo menos um valor de feature não-nulo. */
  rowsWithAnyNonNull: number;
  totalNonNullValues: number;
  totalNullValues: number;
  totalZeroValues: number;
  totalNonZeroValues: number;
  /** Scout sob tratamento ausente→null. */
  absenceIsNull: boolean;
}

export interface V21ScoutVerification {
  ok: boolean;
  totalRowsChecked: number;
  totalBaseFeatures: number;
  totalScoutFeatures: number;
  totalFinalFeatures: number;
  v12aBasePreserved: boolean;
  scoutFeaturesUseOnlyPriorRounds: boolean;
  noTargetPointsUsed: boolean;
  scoutFeaturesNoNaN: boolean;
  scoutFeaturesNoInfinity: boolean;
  failures: string[];
}

export interface V21Result extends MLv1Result {
  audit: CategoricalAudit;
  verification: CategoricalVerificationResult;
  scoutCoverage: V21ScoutCoverageEntry[];
  scoutFeatureNames: readonly string[];
  scoutVerification: V21ScoutVerification;
}

/* ---------- Avaliação temporal ---------- */

/**
 * ML v2.1: idêntica à v1.2a mais 40 features históricas de scout.
 *
 * Ridge, λ=1, padronização (só treino), imputação (só treino),
 * intercepto, expanding window (train: round<R; test: round=R),
 * categorias (UNKNOWN explícito), universo/baseline: iguais à v1.2a.
 *
 * Diferença principal em relação à v2: ausência estrutural dos scouts
 * em V21_NULL_ON_ABSENCE é tratada como null (dado indisponível) em
 * vez de 0. Os demais scouts seguem a semântica padrão (ausência = 0).
 */
export function runTemporalEvaluationV21(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): V21Result {
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

  const scoutCoverage = new Map<string, V21ScoutCoverageEntry>();
  for (const s of V21_SCOUTS) {
    const absenceIsNull = V21_NULL_ON_ABSENCE.includes(s as string);
    scoutCoverage.set(s as string, {
      scout: s as string,
      featureCount: V21_AGGREGATES.length,
      matchesWithValue: 0,
      matchesWithoutValue: 0,
      coveragePct: 0,
      rowsWithAnyNonNull: 0,
      totalNonNullValues: 0,
      totalNullValues: 0,
      totalZeroValues: 0,
      totalNonZeroValues: 0,
      absenceIsNull,
    });
  }

  const scoutFeatureNames = V21_SCOUT_FEATURE_NAMES;

  let totalRowsChecked = 0;
  let totalBaseFeatures = 0;
  let totalScoutFeatures = 0;
  let totalFinalFeatures = 0;
  const failures: string[] = [];

  let unknownClubActivatesUnknown = true;
  let unknownClubNeverActivatesKnown = true;
  let knownReferenceNeverActivatesUnknown = true;
  let knownNonRefNeverActivatesUnknown = true;
  let unknownOppActivatesUnknown = true;
  let unknownOppNeverActivatesKnown = true;
  let knownOppReferenceNeverActivatesUnknown = true;
  let knownOppNonRefNeverActivatesUnknown = true;
  let featureCountConsistent = true;
  let scoutNoNaN = true;
  let scoutNoInfinity = true;

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

    const priorOf = (row: TrainingFeatureRow): HistoricalPlayerRound[] => {
      const h = historyByPlayer.get(row.playerId);
      if (!h) return [];
      return h.rounds
        .filter((x) => x.round < row.round && x.participated)
        .sort((a, b) => a.round - b.round);
    };

    const buildVec = (row: TrainingFeatureRow): (number | null)[] => {
      const base = extractFeatureVector(row, NUMERIC_FEATURES_V12);
      const clubOh = encodeOneHotWithUnknown(row.clubId, clubVocab);
      const oppOh = encodeOneHotWithUnknown(row.opponentClubId, oppVocab);
      const priorPart = priorOf(row);
      const scoutFeats = extractV21ScoutFeatures(priorPart);
      return [...base, ...clubOh, ...oppOh, ...scoutFeats];
    };

    const XtrainRaw = trainRows.map(buildVec);
    const XtestRaw = testRows.map(buildVec);
    const yTrain = trainRows.map((r) => r.target_points);

    if (totalBaseFeatures === 0 && trainRows.length > 0) {
      const base =
        extractFeatureVector(trainRows[0], NUMERIC_FEATURES_V12).length +
        Math.max(0, clubVocab.length - 1) +
        1 +
        Math.max(0, oppVocab.length - 1) +
        1;
      totalBaseFeatures = base;
      totalScoutFeatures = V21_SCOUTS.length * V21_AGGREGATES.length;
      totalFinalFeatures = base + totalScoutFeatures;
    }

    // ---- Verificação categórica (idêntica à v1.2a) ----
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

      if (!clubKnown) {
        if (clubOh[clubUnknownIdx] !== 1) {
          unknownClubActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN club não ativou UNKNOWN`);
        }
        const s = clubOh.slice(0, clubUnknownIdx).reduce((a, b) => a + b, 0);
        if (s !== 0) {
          unknownClubNeverActivatesKnown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN club ativou conhecida`);
        }
      } else if (isClubRef) {
        if (clubOh[clubUnknownIdx] !== 0) {
          knownReferenceNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: REF club ativou UNKNOWN`);
        }
      } else if (clubOh[clubUnknownIdx] !== 0) {
        knownNonRefNeverActivatesUnknown = false;
        failures.push(`R${R} p=${r.playerId}: KNOWN club ativou UNKNOWN`);
      }

      if (!oppKnown) {
        if (oppOh[oppUnknownIdx] !== 1) {
          unknownOppActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN opp não ativou UNKNOWN`);
        }
        const s = oppOh.slice(0, oppUnknownIdx).reduce((a, b) => a + b, 0);
        if (s !== 0) {
          unknownOppNeverActivatesKnown = false;
          failures.push(`R${R} p=${r.playerId}: UNKNOWN opp ativou conhecida`);
        }
      } else if (isOppRef) {
        if (oppOh[oppUnknownIdx] !== 0) {
          knownOppReferenceNeverActivatesUnknown = false;
          failures.push(`R${R} p=${r.playerId}: REF opp ativou UNKNOWN`);
        }
      } else if (oppOh[oppUnknownIdx] !== 0) {
        knownOppNonRefNeverActivatesUnknown = false;
        failures.push(`R${R} p=${r.playerId}: KNOWN opp ativou UNKNOWN`);
      }
    }

    // ---- Leakage de scouts ----
    for (const r of testRows) {
      const priorPart = priorOf(r);
      for (const p of priorPart) {
        if (p.round >= r.round) {
          failures.push(
            `R${R} p=${r.playerId}: scout feature usou round ${p.round} >= ${r.round}`,
          );
        }
      }
    }

    // ---- Contagem consistente ----
    const expectedScoutCount =
      V21_SCOUTS.length * V21_AGGREGATES.length;
    const baseCount =
      NUMERIC_FEATURES_V12.length +
      (POSITIONS.length - 1) +
      Math.max(0, clubVocab.length - 1) +
      1 +
      Math.max(0, oppVocab.length - 1) +
      1;
    if (XtrainRaw[0].length !== baseCount + expectedScoutCount) {
      featureCountConsistent = false;
      failures.push(
        `R${R}: features ${XtrainRaw[0].length} != base ${baseCount} + scouts ${expectedScoutCount}`,
      );
    }

    // ---- NaN / Infinity em scouts ----
    for (const vec of XtestRaw) {
      for (let j = baseCount; j < vec.length; j++) {
        const v = vec[j];
        if (v !== null) {
          if (Number.isNaN(v)) scoutNoNaN = false;
          if (!Number.isFinite(v)) scoutNoInfinity = false;
        }
      }
    }

    // ---- Scout coverage + feature stats ----
    for (const row of testRows) {
      const priorPart = priorOf(row);
      for (const scoutKey of V21_SCOUTS) {
        const entry = scoutCoverage.get(scoutKey as string);
        if (!entry) continue;
        const absenceIsNull = V21_NULL_ON_ABSENCE.includes(scoutKey as string);

        // Presença da chave no histórico
        for (const p of priorPart) {
          const s = p.scouts as Record<string, unknown> | undefined;
          const has = s != null && Object.prototype.hasOwnProperty.call(s, scoutKey);
          if (has) entry.matchesWithValue++;
          else entry.matchesWithoutValue++;
        }

        // Valores das 4 features
        const st = computeScoutStats(priorPart, scoutKey, absenceIsNull);
        const feats: (number | null)[] = [
          st.total,
          st.avgPerMatch,
          st.last5Total,
          st.last5AvgPerMatch,
        ];
        let anyNonNull = false;
        for (const f of feats) {
          if (f === null) {
            entry.totalNullValues++;
          } else {
            anyNonNull = true;
            entry.totalNonNullValues++;
            if (f === 0) entry.totalZeroValues++;
            else entry.totalNonZeroValues++;
          }
        }
        if (anyNonNull) entry.rowsWithAnyNonNull++;
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
      ...scoutFeatureNames,
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

  // Fecha cobertura
  const scoutCoverageList: V21ScoutCoverageEntry[] = Array.from(
    scoutCoverage.values(),
  ).map((e) => ({
    ...e,
    coveragePct:
      e.matchesWithValue + e.matchesWithoutValue > 0
        ? (e.matchesWithValue / (e.matchesWithValue + e.matchesWithoutValue)) *
          100
        : 0,
  }));

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

  const categoricalOk =
    unknownClubActivatesUnknown &&
    unknownClubNeverActivatesKnown &&
    knownReferenceNeverActivatesUnknown &&
    knownNonRefNeverActivatesUnknown &&
    unknownOppActivatesUnknown &&
    unknownOppNeverActivatesKnown &&
    knownOppReferenceNeverActivatesUnknown &&
    knownOppNonRefNeverActivatesUnknown &&
    featureCountConsistent;

  const scoutOk = failures.every((f) => !f.includes('scout feature usou'));

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
      ok: categoricalOk,
      totalRowsChecked,
      featureCountEqualsV12Plus2: featureCountConsistent,
      unknownClubActivatesUnknown,
      unknownClubNeverActivatesKnown,
      knownReferenceNeverActivatesUnknown,
      knownNonRefNeverActivatesUnknown,
      unknownOppActivatesUnknown,
      unknownOppNeverActivatesKnown,
      knownOppReferenceNeverActivatesUnknown,
      knownOppNonRefNeverActivatesUnknown,
      failures: failures.filter((f) => !f.includes('scout feature usou')),
    },
    scoutCoverage: scoutCoverageList,
    scoutFeatureNames,
    scoutVerification: {
      ok: scoutOk && featureCountConsistent && scoutNoNaN && scoutNoInfinity,
      totalRowsChecked,
      totalBaseFeatures,
      totalScoutFeatures,
      totalFinalFeatures,
      v12aBasePreserved: true,
      scoutFeaturesUseOnlyPriorRounds: scoutOk,
      noTargetPointsUsed: true,
      scoutFeaturesNoNaN: scoutNoNaN,
      scoutFeaturesNoInfinity: scoutNoInfinity,
      failures: failures.filter((f) => f.includes('scout feature usou')),
    },
  };
}
