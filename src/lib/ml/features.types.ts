// src/lib/ml/features.types.ts

import type {
  CartolaPosition,
  HistoricalPlayerHistory,
} from '@/lib/data/historical.types';
import type { Partida } from '@/lib/cartola/types';

/**
 * Uma linha do dataset de treino.
 *
 * REGRA DE OURO:
 * - Todas as features são calculadas SOMENTE com informações de rodadas
 *   estritamente anteriores a `round`.
 * - O único dado que vem da rodada `round` é `target_points` (e o flag
 *   auxiliar `target_participated`), que não podem ser usados como
 *   features por nenhum modelo.
 *
 * `null` significa "informação indisponível" — nunca é usado como 0.
 */
export interface TrainingFeatureRow {
  // ---- Identificação / contexto --------------------------------
  playerId: number;
  round: number;
  clubId: number | null;
  position: CartolaPosition | null;
  isHome: boolean | null;
  opponentClubId: number | null;

  // ---- Histórico de participação -------------------------------
  // Contagem de participações nas últimas N RODADAS do calendário
  // (não confundir com "últimas N participações").
  games_last_3_rounds: number | null;
  games_last_5_rounds: number | null;
  games_last_12_rounds: number | null;

  // ---- Médias de pontos ----------------------------------------
  // Médias das últimas N PARTICIPAÇÕES (mesma lógica do baseline).
  points_avg_3: number | null;
  points_avg_5: number | null;
  points_avg_12: number | null;

  // ---- Consistência --------------------------------------------
  points_std_5: number | null;
  points_std_12: number | null;
  points_min_5: number | null;
  points_max_5: number | null;

  // ---- Tendência -----------------------------------------------
  points_avg_3_minus_avg_12: number | null;

  // ---- Desempenho casa / fora (participações anteriores) -------
  home_points_avg: number | null;
  away_points_avg: number | null;

  // ---- Recência -------------------------------------------------
  /** Diferença `round - lastParticipatedRound`, sempre > 0 quando definido. */
  rounds_since_last_game: number | null;

  // ---- Auditoria (NÃO é feature; use só para validação) --------
  /**
   * Maior `round` de qualquer amostra usada no cálculo das features.
   * Por construção, sempre estritamente menor que `round` quando não nulo.
   */
  maxRoundUsedByFeatures: number | null;

  // ---- Target (única parte que usa a rodada alvo) --------------
  target_points: number;
  target_participated: boolean;
}

export interface TrainingDatasetMetadata {
  firstRound: number;
  lastRound: number;
  rowCount: number;
  /** Quantas linhas correspondem a participações reais (universo do baseline). */
  participationsOnlyRowCount: number;
  featureNames: readonly string[];
  generatedAt: string;
}

export interface TrainingDataset {
  rows: TrainingFeatureRow[];
  metadata: TrainingDatasetMetadata;
}

export interface BuildTrainingDatasetOptions {
  firstRound: number;
  lastRound: number;
}

export interface BuildTrainingDatasetFromHistoriesInput
  extends BuildTrainingDatasetOptions {
  histories: HistoricalPlayerHistory[];
  fixturesByRound: Map<number, Partida[]>;
}

export interface LeakageViolation {
  playerId: number;
  round: number;
  reason: string;
  detail: string;
}

export interface LeakageValidationResult {
  ok: boolean;
  violations: LeakageViolation[];
}
