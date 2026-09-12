// src/lib/backtest/baseline.ts

import type { HistoricalPlayerHistory } from '@/lib/data/historical.types';
import { getLastRoundsBefore } from '@/lib/data/historical.functions';

/**
 * Baseline simples: prevê a pontuação da próxima rodada como a média
 * das últimas `participationWindow` PARTICIPAÇÕES anteriores a `targetRound`.
 *
 * Regras:
 * - A rodada alvo nunca entra no cálculo.
 * - Rodadas com `participated === false` são descartadas.
 * - Rodadas com `participated === true` entram mesmo se `points === 0`.
 * - `participationWindow` é quantidade de participações, não de rodadas.
 * - Se houver menos participações que a janela, usa todas as disponíveis.
 * - Sem nenhuma participação anterior, retorna null.
 * - Não arredonda e não altera o histórico.
 */
export function predictByRecentAverage(
  history: HistoricalPlayerHistory,
  targetRound: number,
  participationWindow: number,
): number | null {
  if (participationWindow <= 0) return null;

  // 1) Pega uma janela ampla de rodadas anteriores.
  //    Como não sabemos quantas rodadas serão necessárias para obter
  //    `participationWindow` participações, pegamos todas as anteriores
  //    e filtramos em seguida.
  const previousRounds = getLastRoundsBefore(
    history,
    targetRound,
    history.rounds.length,
  );

  // 2) Filtra somente participações reais.
  const participations = previousRounds.filter((r) => r.participated);

  if (participations.length === 0) return null;

  // 3) Pega as últimas N participações (em ordem crescente já garantida).
  const window = participations.slice(-participationWindow);

  if (window.length === 0) return null;

  let sum = 0;
  for (const r of window) {
    sum += r.points;
  }

  return sum / window.length;
}
