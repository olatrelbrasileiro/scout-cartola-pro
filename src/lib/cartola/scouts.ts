// src/lib/cartola/scouts.ts

import type { CartolaScouts } from "@/lib/data/historical.types";

export type CartolaScoutKey = Extract<keyof CartolaScouts, string>;

/**
 * Chaves de scouts reconhecidas pelo histórico do Cartola.
 *
 * Esta é a única lista canônica usada na normalização de payloads. A
 * presença da chave no payload continua opcional porque a API normalmente
 * omite scouts sem ocorrência na rodada.
 */
export const CARTOLA_SCOUT_KEYS: readonly CartolaScoutKey[] = [
  "G",
  "A",
  "FT",
  "FD",
  "FF",
  "FS",
  "PP",
  "PS",
  "DS",
  "DP",
  "SG",
  "GS",
  "FC",
  "DE",
  "GC",
  "CA",
  "CV",
  "PC",
  "I",
] as const;

/** Rótulos do contrato histórico, para documentação e interfaces futuras. */
export const CARTOLA_SCOUT_LABELS: Readonly<Record<CartolaScoutKey, string>> = {
  G: "gols",
  A: "assistências",
  FT: "finalizações na trave",
  FD: "defesas do goleiro",
  FF: "finalizações para fora",
  FS: "faltas sofridas",
  PP: "pênaltis perdidos",
  PS: "pênaltis sofridos",
  DS: "desarmes",
  DP: "defesas de pênalti",
  SG: "saldo de gols",
  GS: "gols sofridos",
  FC: "faltas cometidas",
  DE: "defesa",
  GC: "gols contra",
  CA: "cartões amarelos",
  CV: "cartões vermelhos",
  PC: "pênaltis cometidos",
  I: "interceptações",
};
