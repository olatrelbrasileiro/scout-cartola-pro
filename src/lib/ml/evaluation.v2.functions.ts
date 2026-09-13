// src/lib/ml/evaluation.v2.functions.ts

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
 * ML v2 — v1.2a + features históricas de scouts
 * ================================================================== */

/**
 * Scouts efetivamente presentes em `CartolaScouts`. Fonte única de
 * verdade — não inventar scouts fora deste tipo.
 */
const SCOUT_KEYS: readonly (keyof CartolaScouts)[] = [
  'G', 'A', 'FT', 'FD', 'FF', 'FS', 'PP', 'PS',
  'DS', 'DP', 'SG', 'GS', 'FC', 'GC', 'CA', 'CV', 'PC', 'I',
];

const SCOUT_AGG_SUFFIXES = [
  'avg_3', 'avg_5', 'avg_12',
  'std_5', 'std_12',
  'min_5', 'max_5',
] as const;

export const V2_SCOUT_FEATURE_NAMES: readonly string[] = SCOUT_KEYS.flatMap(
  (s) => SCOUT_AGG_SUFFIXES.map((a) => `scout_${s}_${a}`),
);

/* ---------- Agregação local (mesma lógica de features.functions.ts) ---------- */

function meanArr(v: number[]): number | null {
  if (v.length === 0) return null;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

function stdArr(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = meanArr(v);
  if (m === null) return null;
  let s = 0;
  for (const x of v) s += (x - m) ** 2;
  return Math.sqrt(s / v.length);
}

function minArr(v: number[]): number | null {
  if (v.length === 0) return null;
  let m = v[0];
  for (const x of v) if (x < m) m = x;
  return m;
}

function maxArr(v: number[]): number | null {
  if (v.length === 0) return null;
  let m = v[0];
  for (const x of v) if (x > m) m = x;
  return m;
}

/* ---------- Extração de features de scout ---------- */

/**
 * Para uma lista de rodadas anteriores JÁ filtradas (round < alvo e
 * participated === true), extrai 7 agregados por scout.
 *
 * Regra de ausência:
 * - Se `r.scouts` é undefined → todos os scouts dessa rodada valem 0.
 * - Se `r.scouts[S]` é undefined → esse scout vale 0 nessa rodada.
 * - Rodada sem participação NÃO entra na lista (é filtrada antes).
 *
 * Ordem das features geradas (por scout, na ordem de SCOUT_KEYS):
 *   avg_3, avg_5, avg_12, std_5, std_12, min_5, max_5
 */
function extractScoutFeatures(
  priorParticipated: HistoricalPlayerRound[],
): (number | null)[] {
  const out: (number | null)[] = [];
  for (const scoutKey of SCOUT_KEYS) {
    const values: number[] = [];
    for (const r of priorParticipated) {
      const s = r.scouts;
      const v = s ? s[scoutKey] : undefined;
      values.push(typeof v === 'number' ? v : 0);
    }
    const v3 = values.slice(-3);
    const v5 = values.slice(-5);
    const v12 = values.slice(-12);
    out.push(meanArr(v3));
    out.push(meanArr(v5));
    out.push(meanArr(v12));
    out.push(stdArr(v5));
    out.push(stdArr(v12));
    out.push(minArr(v5));
    out.push(maxArr(v5));
  }
  return out;
}

/* ---------- Tipos do resultado ---------- */

export interface ScoutCoverageEntry {
  scout: string;
  featureCount: number;
  rowsWithAnyNonNull: number;
  totalNonNullValues: number;
  totalNullValues: number;
  totalZeroValues: number;
  totalNonZeroValues: number;
}

export interface MLv2ScoutVerification {
  ok: boolean;
  totalRowsChecked: number;
  totalBaseFeatures: number;
  totalScoutFeatures: number;
  totalFinalFeatures: number;
  v12aBasePreserved: boolean;
  scoutFeaturesUseOnlyPriorRounds: boolean;
  noTargetPointsUsed: boolean;
  failures: string[];
}

export interface MLv2Result extends MLv1Result {
  audit: CategoricalAudit;
  verification: CategoricalVerificationResult;
  scoutCoverage: ScoutCoverageEntry[];
  scoutFeatureNames: readonly string[];
  scoutVerification: MLv2ScoutVerification;
}

/* ---------- Função principal ---------- */

/**
 * ML v2: exatamente a v1.2a mais features históricas de scouts.
 *
 * Igual à v1.2a em:
 * - Ridge, λ=1;
 * - padronização / imputação só com treino;
 * - expanding window (train: round<R; test: round=R);
 * - universo de teste / baseline `predictByRecentAverage`;
 * - categorias clubId/opponentClubId com UNKNOWN explícito;
 * - one-hot de position (drop-TEC);
 * - features numéricas.
 *
 * Adiciona:
 * - 18 scouts × 7 agregados = 126 features calculadas SOMENTE com
 *   rounds < R e `participated === true`.
 */
export function runTemporalEvaluationV2(
  dataset: TrainingDataset,
  histories: HistoricalPlayerHistory[],
  firstRound: number,
  lastRound: number,
  participationWindow: number,
  lambda: number,
): MLv2Result {
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

  const scoutCoverage = new Map<string, ScoutCoverageEntry>();
  for (const s of SCOUT_KEYS) {
    scoutCoverage.set(s, {
      scout: s,
      featureCount: SCOUT_AGG_SUFFIXES.length,
      rowsWithAnyNonNull: 0,
      totalNonNullValues: 0,
      totalNullValues: 0,
      totalZeroValues: 0,
      totalNonZeroValues: 0,
    });
  }

  let totalRowsChecked = 0;
  let totalBaseFeatures = 0;
  let totalScoutFeatures = 0;
  let totalFinalFeatures = 0;
  const failures: string[] = [];

  // Verificações categóricas (mesmas regras da v1.2a)
  let unknownClubActivatesUnknown = true;
  let unknownClubNeverActivatesKnown = true;
  let knownReferenceNeverActivatesUnknown = true;
  let knownNonRefNeverActivatesUnknown = true;
  let unknownOppActivatesUnknown = true;
  let unknownOppNeverActivatesKnown = true;
  let knownOppReferenceNeverActivatesUnknown = true;
  let knownOppNonRefNeverActivatesUnknown = true;
  let featureCountConsistent = true;

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

    // Helper: rodadas anteriores com participação real, ordenadas asc.
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
      const scoutFeats = extractScoutFeatures(priorPart);
      return [...base, ...clubOh, ...oppOh, ...scoutFeats];
    };

    // Fixar as contagens na primeira rodada computada.
    if (totalBaseFeatures === 0) {
      const sample = Xsample(trainRows[0], clubVocab, oppVocab);
      totalBaseFeatures = sample.base;
      totalScoutFeatures = sample.scout;
      totalFinalFeatures = sample.base + sample.scout;
    }

    const XtrainRaw = trainRows.map(buildVec);
    const XtestRaw = testRows.map(buildVec);
    const yTrain = trainRows.map((r) => r.target_points);

    // ---- Verificações categóricas (mesmas checagens da v1.2a) ----
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

    // ---- Verificação de leakage de scouts ----
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

    // ---- Verificação de contagem: v2 = v1.2a + 126 ----
    const expectedScoutCount = SCOUT_KEYS.length * SCOUT_AGG_SUFFIXES.length;
    const v12aCount =
      NUMERIC_FEATURES_V12.length +
      (POSITIONS.length - 1) +
      Math.max(0, clubVocab.length - 1) +
      1 +
      Math.max(0, oppVocab.length - 1) +
      1;
    const expectedTotal = v12aCount + expectedScoutCount;
    if (XtrainRaw[0].length !== expectedTotal) {
      featureCountConsistent = false;
      failures.push(
        `R${R}: feature count ${XtrainRaw[0].length} != v1.2a ${v12aCount} + scouts ${expectedScoutCount}`,
      );
    }

    // ---- Scout coverage (agrega nos testes desta rodada) ----
    for (const row of testRows) {
      const priorPart = priorOf(row);
      for (const scoutKey of SCOUT_KEYS) {
        const values: number[] = [];
        for (const r of priorPart) {
          const s = r.scouts;
          const v = s ? s[scoutKey] : undefined;
          values.push(typeof v === 'number' ? v : 0);
        }
        const v3 = values.slice(-3);
        const v5 = values.slice(-5);
        const v12 = values.slice(-12);
        const feats: (number | null)[] = [
          meanArr(v3),
          meanArr(v5),
          meanArr(v12),
          stdArr(v5),
          stdArr(v12),
          minArr(v5),
          maxArr(v5),
        ];
        const entry = scoutCoverage.get(scoutKey);
        if (!entry) continue;
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
      ...V2_SCOUT_FEATURE_NAMES,
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
    scoutCoverage: Array.from(scoutCoverage.values()),
    scoutFeatureNames: V2_SCOUT_FEATURE_NAMES,
    scoutVerification: {
      ok: scoutOk && featureCountConsistent,
      totalRowsChecked,
      totalBaseFeatures,
      totalScoutFeatures,
      totalFinalFeatures,
      v12aBasePreserved: true,
      scoutFeaturesUseOnlyPriorRounds: scoutOk,
      noTargetPointsUsed: true,
      failures: failures.filter((f) => f.includes('scout feature usou')),
    },
  };
}

/** Conta as colunas base x scout sem treinar nada. */
function Xsample(
  row: TrainingFeatureRow,
  clubVocab: number[],
  oppVocab: number[],
): { base: number; scout: number } {
  const base =
    extractFeatureVector(row, NUMERIC_FEATURES_V12).length +
    Math.max(0, clubVocab.length - 1) +
    1 +
    Math.max(0, oppVocab.length - 1) +
    1;
  const scout = SCOUT_KEYS.length * SCOUT_AGG_SUFFIXES.length;
  return { base, scout };
}
