// src/lib/cartola/api.functions.ts

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  Atleta,
  Clube,
  DashboardSnapshot,
  MercadoData,
  MercadoStatus,
  Partida,
  Posicao,
} from "./types";
import {
  enriquecerAtletas,
  type HistoricoPorAtleta,
  type RodadaPontuada,
} from "./scoring";
import type { HistoricalPlayerHistory } from "@/lib/data/historical.types";
import {
  buildHistoriesFromRawRounds,
  type RawPontuadosRound,
} from "@/lib/data/historical.functions";
import {
  runBacktestMulti,
  runBacktestWithMatchup,
  type MultiPlayerBacktestSummary,
} from "@/lib/backtest/backtest";
import { buildPositionSamples } from "./matchup";

const BASE = "https://api.cartola.globo.com";

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "CartolaIA/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Cartola API ${path} respondeu ${res.status}`);
  }
  return (await res.json()) as T;
}

export const getMercadoStatus = createServerFn({ method: "GET" }).handler(async () => {
  return cached("status", 60_000, () => getJson<MercadoStatus>("/mercado/status"));
});

export const getMercadoAtletas = createServerFn({ method: "GET" }).handler(async () => {
  return cached(
    "atletas",
    60_000,
    () =>
      getJson<{
        atletas: Atleta[];
        clubes: Record<string, Clube>;
        posicoes: Record<string, Posicao>;
        status: Record<string, { id: number; nome: string }>;
      }>("/atletas/mercado"),
  ) as Promise<MercadoData>;
});

export const getPartidas = createServerFn({ method: "GET" })
  .inputValidator((d: { rodada?: number }) => d)
  .handler(async ({ data }) => {
    const path = data.rodada ? `/partidas/${data.rodada}` : `/partidas`;
    return cached(`partidas:${data.rodada ?? "current"}`, 60_000, () =>
      getJson<{ partidas: Partida[] }>(path),
    );
  });

export const getPontuadosRodada = createServerFn({ method: "GET" })
  .inputValidator((d: { rodada: number }) => d)
  .handler(async ({ data }) => {
    return cached(`pontuados:${data.rodada}`, 5 * 60_000, () =>
      getJson<{
        rodada: number;
        atletas: Record<
          string,
          { apelido: string; pontuacao: number; scout: Record<string, number> }
        >;
      }>(`/atletas/pontuados/${data.rodada}`),
    );
  });

export const getDashboardSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardSnapshot> => {
    const [mercado, data, partidasRes] = await Promise.all([
      cached("status", 60_000, () => getJson<MercadoStatus>("/mercado/status")),
      cached("atletas", 60_000, () => getJson<MercadoData>("/atletas/mercado")),
      cached("partidas:current", 60_000, () =>
        getJson<{ partidas: Partida[] }>("/partidas").catch(() => ({ partidas: [] })),
      ),
    ]);
    return { mercado, data, partidas: partidasRes.partidas ?? [] };
  },
);

const HistoricoInput = z.object({ rodadas: z.array(z.number().int().min(1)).min(1).max(8) });

export const getHistoricoMultiplasRodadas = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => HistoricoInput.parse(input))
  .handler(async ({ data }) => {
    const results = await Promise.all(
      data.rodadas.map(async (r) =>
        cached(`pontuados:${r}`, 10 * 60_000, () =>
          getJson<{
            rodada: number;
            atletas: Record<
              string,
              { apelido: string; pontuacao: number; scout: Record<string, number> }
            >;
          }>(`/atletas/pontuados/${r}`).catch(() => ({ rodada: r, atletas: {} })),
        ),
      ),
    );
    return { rodadas: results };
  });

const HistoricoNormalizadoInput = z.object({
  rodadas: z.array(z.number().int().min(1)).min(1).max(40),
});

export const getHistoricalPlayerHistories = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => HistoricoNormalizadoInput.parse(input))
  .handler(async ({ data }): Promise<{ histories: HistoricalPlayerHistory[] }> => {
    const rounds: RawPontuadosRound[] = await Promise.all(
      data.rodadas.map((r) =>
        cached(`pontuados:${r}`, 30 * 60_000, () =>
          getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(
            () => ({ rodada: r, atletas: {} }),
          ),
        ),
      ),
    );
    return { histories: buildHistoriesFromRawRounds(rounds) };
  });

const BacktestInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
  participationWindow: z.number().int().min(1).max(20),
});

export const runHistoricalBacktest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BacktestInput.parse(input))
  .handler(async ({ data }): Promise<MultiPlayerBacktestSummary> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

    const rawRounds: RawPontuadosRound[] = await Promise.all(
      roundsToFetch.map((r) =>
        cached(`pontuados:${r}`, 30 * 60_000, () =>
          getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(
            () => ({ rodada: r, atletas: {} }),
          ),
        ),
      ),
    );

    const histories = buildHistoriesFromRawRounds(rawRounds);

    const eligible = histories.filter((h) =>
      h.rounds.some((r) => r.participated && r.round < data.firstRound),
    );

    return runBacktestMulti(eligible, {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      participationWindow: data.participationWindow,
    });
  });

/* ------------------------------------------------------------------ *
 * Comparação baseline vs baseline + matchup
 * ------------------------------------------------------------------ */

const MatchupBacktestInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
  participationWindow: z.number().int().min(1).max(20).default(5),
  matchupWindows: z
    .array(z.number().int().min(1).max(30))
    .min(1)
    .max(6)
    .default([3, 5, 8, 12]),
});

export interface MatchupBacktestComparison {
  baseline: MultiPlayerBacktestSummary;
  byWindow: Array<{ window: number; summary: MultiPlayerBacktestSummary }>;
  totalSamples: number;
  playersWithMatchupData: number;
}

export const runMatchupBacktestComparison = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => MatchupBacktestInput.parse(input))
  .handler(async ({ data }): Promise<MatchupBacktestComparison> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

    // Busca paralela (cacheada) de pontuados e partidas.
    const [rawRounds, fixturesRaw] = await Promise.all([
      Promise.all(
        roundsToFetch.map((r) =>
          cached(`pontuados:${r}`, 30 * 60_000, () =>
            getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(
              () => ({ rodada: r, atletas: {} }),
            ),
          ),
        ),
      ),
      Promise.all(
        roundsToFetch.map((r) =>
          cached(`partidas:${r}`, 30 * 60_000, () =>
            getJson<{ partidas: Partida[] }>(`/partidas/${r}`).catch(() => ({
              partidas: [],
            })),
          ),
        ),
      ),
    ]);

    const fixturesByRound = new Map<number, Partida[]>();
    roundsToFetch.forEach((r, i) => {
      fixturesByRound.set(r, fixturesRaw[i].partidas ?? []);
    });

    const histories = buildHistoriesFromRawRounds(rawRounds);
    const stats = buildPositionSamples(histories, fixturesByRound);

    // Para uma comparação justa, restringimos ambos os backtests às
    // rodadas que possuem clube e posição definidos — sem isso, o
    // baseline rodaria num conjunto maior de pares (player, rodada) do
    // que o matchup, o que enviesaria a comparação.
    const filteredHistories: HistoricalPlayerHistory[] = histories
      .map((h) => ({
        playerId: h.playerId,
        rounds: h.rounds.filter(
          (r) => typeof r.clubId === "number" && r.position !== undefined,
        ),
      }))
      .filter((h) => h.rounds.length > 0);

    const eligible = filteredHistories.filter((h) =>
      h.rounds.some((r) => r.participated && r.round < data.firstRound),
    );

    const baseline = runBacktestMulti(eligible, {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      participationWindow: data.participationWindow,
    });

    const byWindow = data.matchupWindows.map((w) => ({
      window: w,
      summary: runBacktestWithMatchup(eligible, stats, fixturesByRound, {
        firstRound: data.firstRound,
        lastRound: data.lastRound,
        participationWindow: data.participationWindow,
        matchupWindow: w,
      }),
    }));

    const playersWithMatchupData = new Set<number>();
    for (const h of eligible) {
      for (const r of h.rounds) {
        if (r.participated && r.clubId !== undefined && r.position) {
          playersWithMatchupData.add(h.playerId);
          break;
        }
      }
    }

    return {
      baseline,
      byWindow,
      totalSamples: stats.length,
      playersWithMatchupData: playersWithMatchupData.size,
    };
  });

export const getDashboardEnriquecido = createServerFn({ method: "GET" }).handler(async () => {
  const snapshot = await (async (): Promise<DashboardSnapshot> => {
    const [mercado, dataM, partidasRes] = await Promise.all([
      cached("status", 60_000, () => getJson<MercadoStatus>("/mercado/status")),
      cached("atletas", 60_000, () => getJson<MercadoData>("/atletas/mercado")),
      cached("partidas:current", 60_000, () =>
        getJson<{ partidas: Partida[] }>("/partidas").catch(() => ({ partidas: [] })),
      ),
    ]);
    return { mercado, data: dataM, partidas: partidasRes.partidas ?? [] };
  })();

  const rodadaAtual = snapshot.mercado.rodada_atual;
  const rodadasParaBuscar: number[] = [];
  const inicio = Math.max(1, rodadaAtual - 12);
  for (let r = inicio; r < rodadaAtual; r++) rodadasParaBuscar.push(r);

  const rodadas: RodadaPontuada[] = await Promise.all(
    rodadasParaBuscar.map((r) =>
      cached(`pontuados:${r}`, 30 * 60_000, () =>
        getJson<RodadaPontuada>(`/atletas/pontuados/${r}`).catch(() => ({ rodada: r, atletas: {} })),
      ),
    ),
  );

  const { atletas, historico, forma } = enriquecerAtletas(snapshot, rodadas);

  type HistEntry = ReturnType<HistoricoPorAtleta["get"]>;
  const histObj: Record<string, NonNullable<HistEntry>> = {};
  for (const [id, h] of historico.entries()) {
    histObj[String(id)] = h;
  }
  const formaObj: Record<string, number> = {};
  for (const [id, v] of forma.entries()) formaObj[String(id)] = v;

  return {
    mercado: snapshot.mercado,
    clubes: snapshot.data.clubes,
    posicoes: snapshot.data.posicoes,
    partidas: snapshot.partidas,
    atletas,
    historico: histObj,
    formaClube: formaObj,
    rodadasAnalisadas: rodadasParaBuscar,
  };
});
