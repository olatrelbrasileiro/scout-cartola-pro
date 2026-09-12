// src/lib/backtest/backtest.ts

import type {
  CartolaPosition,
  HistoricalPlayerHistory,
} from '@/lib/data/historical.types';
import type { Partida } from '@/lib/cartola/types';
import { predictByRecentAverage } from './baseline';
import { mae, rmse, pearson } from './metrics';
import {
  calculatePositionMatchup,
  computeGlobalMeansByPosition,
  predictWithMatchup,
  type GlobalMeansByPosition,
  type TeamRoundPositionStat,
} from '@/lib/cartola/matchup';

export interface BacktestRoundResult {
  playerId: number;
  targetRound: number;
  predicted: number;
  actual: number;
  participated: boolean;
}

export interface BacktestResult {
  results: BacktestRoundResult[];
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
}

export interface BacktestOptions {
  firstRound: number;
  lastRound: number;
  participationWindow: number;
}

export interface MultiPlayerBacktestSummary {
  results: BacktestRoundResult[];
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
  predictions: number;
  playersEvaluated: number;
  firstTargetRound: number | null;
  lastTargetRound: number | null;
}

function summarize(results: BacktestRoundResult[]): MultiPlayerBacktestSummary {
  const predicted = results.map((r) => r.predicted);
  const actual = results.map((r) => r.actual);

  let firstTargetRound: number | null = null;
  let lastTargetRound: number | null = null;
  const players = new Set<number>();

  for (const r of results) {
    if (firstTargetRound === null || r.targetRound < firstTargetRound) {
      firstTargetRound = r.targetRound;
    }
    if (lastTargetRound === null || r.targetRound > lastTargetRound) {
      lastTargetRound = r.targetRound;
    }
    players.add(r.playerId);
  }

  return {
    results,
    mae: mae(predicted, actual),
    rmse: rmse(predicted, actual),
    pearson: pearson(predicted, actual),
    predictions: results.length,
    playersEvaluated: players.size,
    firstTargetRound,
    lastTargetRound,
  };
}

export function runBacktest(
  history: HistoricalPlayerHistory,
  options: BacktestOptions,
): BacktestResult {
  const { firstRound, lastRound, participationWindow } = options;
  const results: BacktestRoundResult[] = [];

  for (const round of history.rounds) {
    if (round.round < firstRound || round.round > lastRound) continue;
    if (!round.participated) continue;

    const predicted = predictByRecentAverage(
      history,
      round.round,
      participationWindow,
    );
    if (predicted === null) continue;

    results.push({
      playerId: history.playerId,
      targetRound: round.round,
      predicted,
      actual: round.points,
      participated: true,
    });
  }

  const predictedValues = results.map((r) => r.predicted);
  const actualValues = results.map((r) => r.actual);

  return {
    results,
    mae: mae(predictedValues, actualValues),
    rmse: rmse(predictedValues, actualValues),
    pearson: pearson(predictedValues, actualValues),
  };
}

export function runBacktestMulti(
  histories: HistoricalPlayerHistory[],
  options: BacktestOptions,
): MultiPlayerBacktestSummary {
  const all: BacktestRoundResult[] = [];
  for (const history of histories) {
    const single = runBacktest(history, options);
    for (const r of single.results) all.push(r);
  }
  return summarize(all);
}

/* ------------------------------------------------------------------ *
 * Backtest com matchup
 * ------------------------------------------------------------------ */

export interface MatchupBacktestOptions extends BacktestOptions {
  /** Quantas rodadas recentes usar para o matchup. */
  matchupWindow: number;
  /** Peso do prior no shrinkage (default em matchup.ts). */
  priorWeight?: number;
}

/**
 * Versão do backtest que multiplica a previsão de média recente pelo
 * matchupFactor calculado ANTES da rodada alvo.
 *
 * Regras de fairness / leakage:
 * - A rodada alvo só é lida como `actual`, nunca entra na previsão.
 * - Para cada jogador previsto, exigimos `clubId` e `position` no
 *   HistoricalPlayerRound. Caso contrário, ele é pulado (não dá para
 *   calcular matchup sem clube/posição).
 * - As referências globais (G_home, G_away) são recalculadas por rodada
 *   com `round < targetRound`.
 */
export function runBacktestWithMatchup(
  histories: HistoricalPlayerHistory[],
  stats: TeamRoundPositionStat[],
  fixturesByRound: Map<number, Partida[]>,
  options: MatchupBacktestOptions,
): MultiPlayerBacktestSummary {
  const {
    firstRound,
    lastRound,
    participationWindow,
    matchupWindow,
    priorWeight,
  } = options;

  const globalMeansCache = new Map<
    number,
    Map<CartolaPosition, GlobalMeansByPosition>
  >();
  const getGlobalMeans = (
    round: number,
  ): Map<CartolaPosition, GlobalMeansByPosition> => {
    const hit = globalMeansCache.get(round);
    if (hit) return hit;
    const computed = computeGlobalMeansByPosition(stats, round);
    globalMeansCache.set(round, computed);
    return computed;
  };

  const all: BacktestRoundResult[] = [];

  for (const history of histories) {
    for (const r of history.rounds) {
      if (r.round < firstRound || r.round > lastRound) continue;
      if (!r.participated) continue;
      if (typeof r.clubId !== 'number' || !r.position) continue;

      const fixtures = fixturesByRound.get(r.round);
      if (!fixtures) continue;

      let opponentId: number | null = null;
      let isHome = false;
      for (const f of fixtures) {
        if (!f.valida) continue;
        if (f.clube_casa_id === r.clubId) {
          opponentId = f.clube_visitante_id;
          isHome = true;
          break;
        }
        if (f.clube_visitante_id === r.clubId) {
          opponentId = f.clube_casa_id;
          isHome = false;
          break;
        }
      }
      if (opponentId === null) continue;

      const matchup = calculatePositionMatchup(
        stats,
        getGlobalMeans(r.round),
        {
          teamId: r.clubId,
          opponentId,
          isHome,
          position: r.position,
          beforeRound: r.round,
          windowSize: matchupWindow,
          priorWeight,
        },
      );

      const predicted = predictWithMatchup(
        history,
        r.round,
        participationWindow,
        matchup,
      );
      if (predicted === null) continue;

      all.push({
        playerId: history.playerId,
        targetRound: r.round,
        predicted,
        actual: r.points,
        participated: true,
      });
    }
  }

  return summarize(all);
}
