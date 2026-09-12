// src/lib/data/historical.types.ts

/**
 * Posições possíveis no Cartola FC.
 */
export type CartolaPosition = 'GOL' | 'LAT' | 'ZAG' | 'MEI' | 'ATA' | 'TEC';

/**
 * Scouts efetivamente retornados pelo histórico do Cartola
 * (alinhados com os usados em scoring.ts).
 *
 * Observações:
 * - `FD` = defesa do goleiro.
 * - `DS` = desarme.
 * - `I`  = interceptações.
 * - `DE` (defesa difícil) e `DD` foram removidos do Cartola em 2021
 *   e por isso NÃO estão aqui.
 * - Todos opcionais: a API só envia as chaves que ocorreram na rodada.
 */
export interface CartolaScouts {
  G?: number;   // gols
  A?: number;   // assistências
  FT?: number;  // finalizações na trave
  FD?: number;  // defesa do goleiro
  FF?: number;  // finalizações para fora
  FS?: number;  // faltas sofridas
  PP?: number;  // pênaltis perdidos
  PS?: number;  // pênaltis sofridos
  DS?: number;  // desarmes
  DP?: number;  // defesas de pênalti
  SG?: number;  // saldo de gols (jogo sem sofrer gol)
  GS?: number;  // gols sofridos
  FC?: number;  // faltas cometidas
  GC?: number;  // gols contra
  CA?: number;  // cartões amarelos
  CV?: number;  // cartões vermelhos
  PC?: number;  // pênaltis cometidos
  I?: number;   // interceptações
}

/**
 * Atuação histórica de um jogador em uma rodada específica.
 *
 * Regra importante:
 * - participated = false  -> não entrou em campo (points deve ser 0)
 * - participated = true   -> entrou em campo, mesmo que points = 0
 */
export interface HistoricalPlayerRound {
  playerId: number;
  round: number;
  points: number;
  participated: boolean;

  // Campos que podem faltar em bases históricas incompletas
  price?: number;
  priceVariation?: number;
  clubId?: number;
  position?: CartolaPosition;
  scouts?: CartolaScouts;
}

/**
 * Histórico completo de um jogador ao longo das rodadas.
 */
export interface HistoricalPlayerHistory {
  playerId: number;
  rounds: HistoricalPlayerRound[];
}
