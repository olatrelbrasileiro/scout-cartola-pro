// src/lib/data/historical.functions.ts

import type {
  HistoricalPlayerHistory,
  HistoricalPlayerRound,
} from './historical.types';
import { mapPosition, pickScouts } from './normalizers';

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

/* ------------------------------------------------------------------ *
 * Adaptação do payload bruto de /atletas/pontuados/{rodada}
 * para HistoricalPlayerHistory[].
 *
 * O endpoint de pontuados NÃO devolve preço, variação, mídia nem,
 * em alguns casos, `posicao_id`/`clube_id`. Esses campos ficam
 * `undefined` no HistoricalPlayerRound em vez de serem inventados
 * a partir do mercado atual (o que geraria data leakage).
 *
 * A lógica de scouts e posição vem de normalizers.ts (mapPosition,
 * pickScouts) — não há duplicação aqui.
 * ------------------------------------------------------------------ */

/**
 * Formato bruto (parcial) de um atleta em /atletas/pontuados/{rodada}.
 * Alguns campos podem estar ausentes dependendo da rodada / payload.
 */
export interface RawPontuadosAtleta {
  apelido?: string;
  pontuacao: number;
  scout?: Record<string, number>;
  posicao_id?: number;
  clube_id?: number;
  entrou_em_campo?: boolean;
}

/**
 * Formato bruto de uma rodada de pontuados.
 */
export interface RawPontuadosRound {
  rodada: number;
  atletas: Record<string, RawPontuadosAtleta>;
}

/**
 * Normaliza uma linha bruta de pontuados em um HistoricalPlayerRound.
 *
 * Regras:
 * - `participated = raw.entrou_em_campo ?? true` (nunca usa pontuacao !== 0).
 * - `points` preserva `0` quando o jogador participou.
 * - `price`, `priceVariation` ficam `undefined` (API não fornece).
 * - `position`/`clubId` ficam `undefined` quando a API não envia.
 * - Scouts e posição são resolvidos por helpers centralizados
 *   em normalizers.ts.
 */
export function normalizeRawPontuadosAtleta(
  raw: RawPontuadosAtleta,
  playerId: number,
  round: number,
): HistoricalPlayerRound {
  const participated = raw.entrou_em_campo ?? true;

  return {
    playerId,
    round,
    points: participated ? raw.pontuacao : 0,
    participated,
    position: mapPosition(raw.posicao_id),
    clubId: typeof raw.clube_id === 'number' ? raw.clube_id : undefined,
    scouts: pickScouts(raw.scout),
    // price / priceVariation: endpoint não fornece -> undefined
  };
}

/**
 * Converte várias rodadas brutas de /atletas/pontuados em históricos
 * por jogador, reaproveitando normalizeRawPontuadosAtleta e
 * buildPlayerHistory.
 */
export function buildHistoriesFromRawRounds(
  rounds: RawPontuadosRound[],
): HistoricalPlayerHistory[] {
  const byPlayer = new Map<number, HistoricalPlayerRound[]>();

  for (const round of rounds) {
    for (const [idStr, atleta] of Object.entries(round.atletas)) {
      const playerId = Number(idStr);
      if (!Number.isFinite(playerId)) continue;

      const entry = normalizeRawPontuadosAtleta(atleta, playerId, round.rodada);

      const list = byPlayer.get(playerId);
      if (list) list.push(entry);
      else byPlayer.set(playerId, [entry]);
    }
  }

  const histories: HistoricalPlayerHistory[] = [];
  for (const [playerId, playerRounds] of byPlayer.entries()) {
    histories.push(buildPlayerHistory(playerId, playerRounds));
  }
  return histories;
}
