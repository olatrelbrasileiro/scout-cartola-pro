// src/lib/ml/features.functions.ts

import type { HistoricalPlayerRound } from '@/lib/data/historical.types';
import type {
  BuildTrainingDatasetFromHistoriesInput,
  LeakageValidationResult,
  LeakageViolation,
  TrainingDataset,
  TrainingFeatureRow,
} from './features.types';

/**
 * Lista ordenada dos nomes das features (não inclui target nem auditoria).
 * Estável para ser usada como header em CSV ou como ordem de colunas X.
 */
export const TRAINING_FEATURE_NAMES = [
  'playerId',
  'round',
  'clubId',
  'position',
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

/* ------------------------------------------------------------------ *
 * Helpers puros
 * ------------------------------------------------------------------ */

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Desvio populacional. Retorna null se houver < 2 amostras. */
function std(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m === null) return null;
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / values.length);
}

function minOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] < m) m = values[i];
  return m;
}

function maxOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

/**
 * Últimas N rodadas (por número de rodada) da lista já filtrada para
 * estritamente anterior à rodada alvo. Retorna em ordem crescente.
 */
function lastNRounds(
  rounds: HistoricalPlayerRound[],
  n: number,
): HistoricalPlayerRound[] {
  const sorted = [...rounds].sort((a, b) => a.round - b.round);
  return sorted.slice(-n);
}

/**
 * Pontos das últimas N participações dentro da lista `prior`.
 * Mesma lógica do baseline `predictByRecentAverage`: filtra participações,
 * ordena por round e corta os últimos N.
 */
function pointsOfLastNParticipations(
  prior: HistoricalPlayerRound[],
  n: number,
): number[] {
  const participated = prior.filter((r) => r.participated);
  participated.sort((a, b) => a.round - b.round);
  return participated.slice(-n).map((r) => r.points);
}

interface FixtureInfo {
  isHome: boolean;
  opponentClubId: number;
}

/** Localiza o confronto do clube em uma rodada. Retorna null se não achar. */
function findFixtureInfo(
  fixtures: Partida[] | undefined,
  clubId: number,
): FixtureInfo | null {
  if (!fixtures) return null;
  for (const f of fixtures) {
    if (!f.valida) continue;
    if (f.clube_casa_id === clubId) {
      return { isHome: true, opponentClubId: f.clube_visitante_id };
    }
    if (f.clube_visitante_id === clubId) {
      return { isHome: false, opponentClubId: f.clube_casa_id };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Construção do dataset
 * ------------------------------------------------------------------ */

/**
 * Constrói o dataset de treino a partir de históricos já normalizados e
 * fixtures por rodada. Função pura — sem rede, sem cache, sem I/O.
 *
 * Para cada (playerId, round) em que o jogador aparece no histórico
 * dentro de [firstRound, lastRound], gera UMA linha.
 *
 * Todas as features usam apenas rodadas < round.
 * `target_points` usa o `points` da própria rodada.
 */
export function buildTrainingDatasetFromHistories(
  input: BuildTrainingDatasetFromHistoriesInput,
): TrainingDataset {
  const { histories, fixturesByRound, firstRound, lastRound } = input;

  if (firstRound > lastRound) {
    throw new Error(
      `buildTrainingDatasetFromHistories: firstRound (${firstRound}) > lastRound (${lastRound})`,
    );
  }

  const rows: TrainingFeatureRow[] = [];

  for (const history of histories) {
    // Ordena uma vez por jogador; `prior` é derivado por filtro.
    const roundsAsc = [...history.rounds].sort((a, b) => a.round - b.round);

    for (const target of roundsAsc) {
      if (target.round < firstRound || target.round > lastRound) continue;

      // INVARIANTE DE LEAKAGE: `prior` contém somente rodadas estritamente
      // anteriores à alvo. Todas as features derivam exclusivamente daqui.
      const prior = roundsAsc.filter((r) => r.round < target.round);

      // --- Contexto da rodada alvo (não é target; vem do fixture) ----
      const clubId = target.clubId ?? null;
      const position = target.position ?? null;

      let isHome: boolean | null = null;
      let opponentClubId: number | null = null;
      if (clubId !== null) {
        const info = findFixtureInfo(fixturesByRound.get(target.round), clubId);
        if (info) {
          isHome = info.isHome;
          opponentClubId = info.opponentClubId;
        }
      }

      // --- Histórico de participação (contagem em rodadas recentes) --
      const hasAnyPrior = prior.length > 0;
      const last3 = lastNRounds(prior, 3);
      const last5 = lastNRounds(prior, 5);
      const last12 = lastNRounds(prior, 12);

      const games_last_3_rounds = hasAnyPrior
        ? last3.filter((r) => r.participated).length
        : null;
      const games_last_5_rounds = hasAnyPrior
        ? last5.filter((r) => r.participated).length
        : null;
      const games_last_12_rounds = hasAnyPrior
        ? last12.filter((r) => r.participated).length
        : null;

      // --- Médias de pontos (últimas N participações) ----------------
      const points_avg_3 = mean(pointsOfLastNParticipations(prior, 3));
      const points_avg_5 = mean(pointsOfLastNParticipations(prior, 5));
      const points_avg_12 = mean(pointsOfLastNParticipations(prior, 12));

      // --- Consistência ----------------------------------------------
      const pts5 = pointsOfLastNParticipations(prior, 5);
      const pts12 = pointsOfLastNParticipations(prior, 12);
      const points_std_5 = std(pts5);
      const points_std_12 = std(pts12);
      const points_min_5 = minOrNull(pts5);
      const points_max_5 = maxOrNull(pts5);

      // --- Tendência -------------------------------------------------
      const points_avg_3_minus_avg_12 =
        points_avg_3 !== null && points_avg_12 !== null
          ? points_avg_3 - points_avg_12
          : null;

      // --- Desempenho casa / fora -----------------------------------
      const homePoints: number[] = [];
      const awayPoints: number[] = [];
      for (const r of prior) {
        if (!r.participated) continue;
        if (typeof r.clubId !== 'number') continue;
        const info = findFixtureInfo(fixturesByRound.get(r.round), r.clubId);
        if (!info) continue;
        if (info.isHome) homePoints.push(r.points);
        else awayPoints.push(r.points);
      }
      const home_points_avg = mean(homePoints);
      const away_points_avg = mean(awayPoints);

      // --- Recência --------------------------------------------------
      let rounds_since_last_game: number | null = null;
      let maxRoundUsedByFeatures: number | null = null;

      if (hasAnyPrior) {
        maxRoundUsedByFeatures = prior[prior.length - 1].round; // último da lista ordenada
        const participatedPrior = prior.filter((r) => r.participated);
        if (participatedPrior.length > 0) {
          const lastGameRound =
            participatedPrior[participatedPrior.length - 1].round;
          rounds_since_last_game = target.round - lastGameRound;
        }
      }

      rows.push({
        playerId: history.playerId,
        round: target.round,
        clubId,
        position,
        isHome,
        opponentClubId,

        games_last_3_rounds,
        games_last_5_rounds,
        games_last_12_rounds,

        points_avg_3,
        points_avg_5,
        points_avg_12,

        points_std_5,
        points_std_12,
        points_min_5,
        points_max_5,

        points_avg_3_minus_avg_12,

        home_points_avg,
        away_points_avg,

        rounds_since_last_game,

        maxRoundUsedByFeatures,

        // TARGET — único campo que usa a rodada alvo.
        target_points: target.points,
        target_participated: target.participated,
      });
    }
  }

  // Ordenação determinística: round, depois playerId.
  rows.sort((a, b) => a.round - b.round || a.playerId - b.playerId);

  const participationsOnlyRowCount = rows.filter(
    (r) => r.target_participated,
  ).length;

  return {
    rows,
    metadata: {
      firstRound,
      lastRound,
      rowCount: rows.length,
      participationsOnlyRowCount,
      featureNames: TRAINING_FEATURE_NAMES,
      generatedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Auditoria de leakage
 * ------------------------------------------------------------------ */

/**
 * Verifica invariantes estruturais do dataset:
 *
 * 1. `maxRoundUsedByFeatures < round` em toda linha em que for não nulo.
 * 2. Se `rounds_since_last_game = k`, então `round - k` deve ser
 *    estritamente menor que `round` (trivial, mas checado).
 * 3. Se `target_participated === false`, `target_points` deve ser 0.
 *
 * A checagem (1) é a garantia principal contra data leakage — ela depende
 * do fato de que o builder registra `maxRoundUsedByFeatures` como o maior
 * round efetivamente consultado por qualquer feature.
 *
 * Este validador é intencionalmente conservador e barato: ele NÃO
 * recalcula as features (o que duplicaria a lógica do builder), apenas
 * confere o invariante estrutural.
 */
export function validateNoLeakage(
  dataset: TrainingDataset,
): LeakageValidationResult {
  const violations: LeakageViolation[] = [];

  for (const row of dataset.rows) {
    if (
      row.maxRoundUsedByFeatures !== null &&
      row.maxRoundUsedByFeatures >= row.round
    ) {
      violations.push({
        playerId: row.playerId,
        round: row.round,
        reason: 'feature_uses_future_round',
        detail: `maxRoundUsedByFeatures=${row.maxRoundUsedByFeatures} >= round=${row.round}`,
      });
    }

    if (row.rounds_since_last_game !== null) {
      const lastGameRound = row.round - row.rounds_since_last_game;
      if (lastGameRound >= row.round) {
        violations.push({
          playerId: row.playerId,
          round: row.round,
          reason: 'rounds_since_last_game_inconsistent',
          detail: `lastGameRound=${lastGameRound} >= round=${row.round}`,
        });
      }
    }

    if (!row.target_participated && row.target_points !== 0) {
      violations.push({
        playerId: row.playerId,
        round: row.round,
        reason: 'target_points_nonzero_when_not_participated',
        detail: `target_points=${row.target_points}`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
