// src/lib/data/normalizers.ts

import { POSICAO_ABREV, type AtletaPontuado } from '@/lib/cartola/types';
import type {
  CartolaPosition,
  CartolaScouts,
  HistoricalPlayerRound,
} from './historical.types';

/**
 * Mapeia posicao_id numérico para CartolaPosition de forma segura.
 * Retorna undefined quando o id não é conhecido.
 */
function mapPosition(posicaoId: number): CartolaPosition | undefined {
  const abrev = POSICAO_ABREV[posicaoId];
  if (
    abrev === 'GOL' ||
    abrev === 'LAT' ||
    abrev === 'ZAG' ||
    abrev === 'MEI' ||
    abrev === 'ATA' ||
    abrev === 'TEC'
  ) {
    return abrev;
  }
  return undefined;
}

/**
 * Chaves de scout reconhecidas, alinhadas com o histórico atual do Cartola.
 * Mantemos a lista explícita para preservar tipagem estrita em CartolaScouts.
 */
const KNOWN_SCOUT_KEYS: readonly (keyof CartolaScouts)[] = [
  'G', 'A', 'FT', 'FD', 'FF', 'FS', 'PP', 'PS',
  'DS', 'DP', 'SG', 'GS', 'FC', 'GC', 'CA', 'CV', 'PC',
  'I',
];

/**
 * Converte Record<string, number> em CartolaScouts sem usar `any`.
 * Chaves desconhecidas são ignoradas, mantendo o tipo estrito.
 */
function mapScouts(scout: Record<string, number>): CartolaScouts {
  const result: CartolaScouts = {};
  for (const key of KNOWN_SCOUT_KEYS) {
    const value = scout[key];
    if (typeof value === 'number') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Converte uma atuação pontuada do mercado em uma atuação histórica.
 *
 * Regras:
 * - entrou_em_campo === true  -> participated: true
 * - entrou_em_campo === false -> participated: false
 * - pontuacao === 0 com participação é preservada como points: 0
 * - price e priceVariation NÃO são preenchidos (AtletaPontuado não os possui)
 */
export function toHistoricalPlayerRound(
  atleta: AtletaPontuado,
  playerId: number,
  round: number,
): HistoricalPlayerRound {
  const participated = atleta.entrou_em_campo === true;

  return {
    playerId,
    round,
    points: participated ? atleta.pontuacao : 0,
    participated,
    position: mapPosition(atleta.posicao_id),
    clubId: atleta.clube_id,
    scouts: mapScouts(atleta.scout),
  };
}
