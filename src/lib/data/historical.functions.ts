// src/lib/data/historical.functions.ts

import type {
  HistoricalPlayerHistory,
  HistoricalPlayerRound,
} from './historical.types';

/**
 * Constrói o histórico completo de um jogador a partir de várias
 * atuações normalizadas.
 *
 * - Não altera os objetos originais (cria um novo array ordenado).
 * - Ordena por `round` em ordem crescente.
 * - Mantém rodadas com `participated === false` (não filtra).
 * - Não calcula médias nem agrega nada.
 */
export function buildPlayerHistory(
  playerId: number,
  rounds: HistoricalPlayerRound[],
): HistoricalPlayerHistory {
  const ordered = [...rounds].sort((a, b) => a.round - b.round);

  return {
    playerId,
    rounds: ordered,
  };
}

/**
 * Retorna as últimas N rodadas ESTRITAMENTE ANTERIORES a `beforeRound`.
 *
 * Importante:
 * - Isso é uma janela de RODADAS, não de participações.
 * - Rodadas com `participated === false` são mantidas.
 * - A rodada `beforeRound` em si é excluída.
 * - Se houver menos de N rodadas anteriores, retorna todas as disponíveis.
 */
export function getLastRoundsBefore(
  history: HistoricalPlayerHistory,
  beforeRound: number,
  n: number,
): HistoricalPlayerRound[] {
  if (n <= 0) return [];

  const previous = history.rounds.filter((r) => r.round < beforeRound);

  // history.rounds já está ordenado ascendentemente por construção,
  // mas garantimos aqui caso alguém passe um objeto montado à mão.
  const ordered = [...previous].sort((a, b) => a.round - b.round);

  return ordered.slice(-n);
}
