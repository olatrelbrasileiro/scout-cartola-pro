// src/lib/data/normalizers.ts

import { POSICAO_ABREV } from "@/lib/cartola/types";
import { CARTOLA_SCOUT_KEYS } from "@/lib/cartola/scouts";
import type { CartolaPosition, CartolaScouts } from "./historical.types";

/**
 * Mapeia posicao_id numérico para CartolaPosition de forma segura.
 * Aceita undefined (endpoints históricos podem não enviar posição).
 * Retorna undefined quando o id não é conhecido.
 */
export function mapPosition(posicaoId: number | undefined): CartolaPosition | undefined {
  if (typeof posicaoId !== "number") return undefined;
  const abrev = POSICAO_ABREV[posicaoId];
  if (
    abrev === "GOL" ||
    abrev === "LAT" ||
    abrev === "ZAG" ||
    abrev === "MEI" ||
    abrev === "ATA" ||
    abrev === "TEC"
  ) {
    return abrev;
  }
  return undefined;
}

/**
 * Converte um `Record<string, number>` em `CartolaScouts` sem usar `any`.
 * - Chaves desconhecidas são ignoradas.
 * - Retorna `undefined` quando a entrada é `undefined` (info indisponível),
 *   preservando a diferença semântica entre "sem scouts" e "não informado".
 */
export function pickScouts(scout: Record<string, number> | undefined): CartolaScouts | undefined {
  if (!scout) return undefined;
  const result: CartolaScouts = {};
  for (const key of CARTOLA_SCOUT_KEYS) {
    const value = scout[key];
    if (typeof value === "number") {
      result[key] = value;
    }
  }
  return result;
}
