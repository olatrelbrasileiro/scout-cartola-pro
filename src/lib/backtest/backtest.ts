// src/lib/backtest/backtest.ts

import type { HistoricalPlayerHistory } from '@/lib/data/historical.types';
import { predictByRecentAverage } from './baseline';
import { mae, rmse, pearson } from './metrics';

/**
 * Resultado individual de uma rodada prevista no backtest.
 */
export interface BacktestRoundResult {
  playerId: number;
  targetRound: number;
  predicted: number;
  actual: number;
  participated: boolean;
}

/**
 * Resultado agregado do backtest (por jogador).
 */
export interface BacktestResult {
  results: BacktestRoundResult[];
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
}

/**
 * Opções do backtest.
 */
export interface BacktestOptions {
  firstRound: number;
  lastRound: number;
  participationWindow: number;
}

/**
 * Executa um backtest do baseline `predictByRecentAverage` sobre o
 * histórico de UM jogador.
 *
 * Regras:
 * - Para prever a rodada alvo R, SOMENTE rodadas < R entram no cálculo
 *   (sem data leakage).
 * - Apenas rodadas em que o jogador efetivamente participou entram no
 *   backtest.
 * - Rodadas sem previsão (baseline retornou null) são puladas.
 * - Função pura: não muta o histórico, não acessa rede nem estado global.
 */
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

/**
 * Resumo agregado de um backtest sobre vários jogadores.
 */
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

/**
 * Executa o backtest sobre um conjunto de históricos e agrega.
 * Reaproveita `runBacktest` por jogador, sem tocar nos históricos.
 */
export function runBacktestMulti(
  histories: HistoricalPlayerHistory[],
  options: BacktestOptions,
): MultiPlayerBacktestSummary {
  const all: BacktestRoundResult[] = [];
  let playersEvaluated = 0;

  for (const history of histories) {
    const single = runBacktest(history, options);
    if (single.results.length === 0) continue;
    playersEvaluated += 1;
    for (const r of single.results) all.push(r);
  }

  const predicted = all.map((r) => r.predicted);
  const actual = all.map((r) => r.actual);

  let firstTargetRound: number | null = null;
  let lastTargetRound: number | null = null;
  for (const r of all) {
    if (firstTargetRound === null || r.targetRound < firstTargetRound) {
      firstTargetRound = r.targetRound;
    }
    if (lastTargetRound === null || r.targetRound > lastTargetRound) {
      lastTargetRound = r.targetRound;
    }
  }

  return {
    results: all,
    mae: mae(predicted, actual),
    rmse: rmse(predicted, actual),
    pearson: pearson(predicted, actual),
    predictions: all.length,
    playersEvaluated,
    firstTargetRound,
    lastTargetRound,
  };
}
