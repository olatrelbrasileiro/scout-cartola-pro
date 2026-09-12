// src/lib/backtest/backtest.ts

import type { HistoricalPlayerHistory } from '@/lib/data/historical.types';
import { predictByRecentAverage } from './baseline';
import { mae, rmse, pearson } from './metrics';

/**
 * Resultado individual de uma rodada prevista no backtest.
 */
export interface BacktestRoundResult {
  targetRound: number;
  predicted: number;
  actual: number;
  participated: boolean;
}

/**
 * Resultado agregado do backtest.
 * `mae`, `rmse` e `pearson` podem ser `null` quando não há amostra
 * suficiente ou quando a variância é nula (no caso de Pearson).
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
 * histórico de um jogador.
 *
 * Regras:
 * - Para prever a rodada alvo R, SOMENTE rodadas < R entram no cálculo.
 *   A própria rodada alvo só é usada como `actual`, evitando data leakage.
 * - Apenas rodadas em que o jogador efetivamente participou entram no
 *   backtest, pois o objetivo é avaliar a previsão quando ele joga.
 * - Rodadas sem previsão disponível (baseline retornou `null`) são puladas.
 * - Rodadas fora de [firstRound, lastRound] são ignoradas.
 * - A função é pura: não muta o histórico, não acessa rede nem estado global.
 */
export function runBacktest(
  history: HistoricalPlayerHistory,
  options: BacktestOptions,
): BacktestResult {
  const { firstRound, lastRound, participationWindow } = options;

  const results: BacktestRoundResult[] = [];

  for (const round of history.rounds) {
    // Fora da janela de teste.
    if (round.round < firstRound || round.round > lastRound) continue;

    // Só avaliamos rodadas em que o jogador realmente participou.
    if (!round.participated) continue;

    // A previsão usa apenas rodadas ANTERIORES à alvo (sem leakage).
    const predicted = predictByRecentAverage(
      history,
      round.round,
      participationWindow,
    );

    // Sem histórico suficiente para prever -> pula a rodada.
    if (predicted === null) continue;

    results.push({
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
