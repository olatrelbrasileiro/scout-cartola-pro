// src/lib/data/historical.types.ts

/**
 * Posições possíveis no Cartola FC.
 */
export type CartolaPosition = 'GOL' | 'LAT' | 'ZAG' | 'MEI' | 'ATA' | 'TEC';

/**
 * Scouts brutos retornados pela API do Cartola em uma rodada.
 * Todos opcionais, pois a API só envia as chaves que ocorreram
 * (ou pode omitir o bloco inteiro em alguns casos).
 */
export interface CartolaScouts {
  G?: number;   // gols
  A?: number;   // assistências
  FT?: number;  // finalizações na trave
  FD?: number;  // finalizações defendidas
  FF?: number;  // finalizações para fora
  FS?: number;  // faltas sofridas
  FC?: number;  // faltas cometidas
  I?: number;   // impedimentos
  PP?: number;  // pênaltis perdidos
  PS?: number;  // pênaltis sofridos
  PC?: number;  // pênaltis cometidos
  CA?: number;  // cartões amarelos
  CV?: number;  // cartões vermelhos
  SG?: number;  // saldo de gols
  DD?: number;  // defesas difíceis
  DP?: number;  // defesas de pênalti
  GS?: number;  // gols sofridos
  V?: number;   // vitórias
  E?: number;   // empates
  GC?: number;  // gols contra
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
