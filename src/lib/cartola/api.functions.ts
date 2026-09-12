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
import {
  buildTrainingDatasetFromHistories,
} from "@/lib/ml/features.functions";
import type { TrainingDataset } from "@/lib/ml/features.types";
import { predictByRecentAverage } from "@/lib/backtest/baseline";
import type {
  CartolaPosition
} from "@/lib/data/historical.types";
import { runTemporalEvaluation } from "@/lib/ml/evaluation.functions";
import type { MLv1Result } from "@/lib/ml/model.types";

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

// Sem filtro global de elegibilidade: cada (jogador, rodada) é avaliado
// individualmente. `predictByRecentAverage` já retorna null quando não
// há nenhuma participação anterior àquela rodada, então o backtest
// simplesmente pula essas linhas — sem precisar excluir o jogador
// inteiro. Isso corrige a subcontagem sistemática de previsões para
// jogadores que estrearam a partir de `firstRound`.
return runBacktestMulti(histories, {
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

// Sem filtro global de elegibilidade: cada (jogador, rodada) é
// avaliado individualmente. `predictByRecentAverage` retorna null
// quando não há participação anterior àquela rodada, então o
// backtest simplesmente pula a linha — sem excluir o jogador
// inteiro. Assim baseline e variantes de matchup operam sobre
// exatamente o mesmo universo.
const baseline = runBacktestMulti(filteredHistories, {
  firstRound: data.firstRound,
  lastRound: data.lastRound,
  participationWindow: data.participationWindow,
});

const byWindow = data.matchupWindows.map((w) => ({
  window: w,
  summary: runBacktestWithMatchup(filteredHistories, stats, fixturesByRound, {
    firstRound: data.firstRound,
    lastRound: data.lastRound,
    participationWindow: data.participationWindow,
    matchupWindow: w,
  }),
}));

const playersWithMatchupData = new Set<number>();
for (const h of filteredHistories) {
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

/* ------------------------------------------------------------------ *
 * Dataset de treino para ML
 * ------------------------------------------------------------------ */

const BuildTrainingDatasetInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
});

/**
 * Constrói o dataset de treino para o intervalo [firstRound, lastRound].
 *
 * Reaproveita:
 * - cache `pontuados:{r}` (já usado pelo dashboard e backtest);
 * - cache `partidas:{r}` (novo, 30 min);
 * - `buildHistoriesFromRawRounds` para normalizar histórico;
 * - `buildTrainingDatasetFromHistories` para extrair features (puro).
 *
 * Nenhuma rodada alvo entra nas features — apenas rodadas < alvo.
 */
export const buildTrainingDataset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BuildTrainingDatasetInput.parse(input))
  .handler(async ({ data }): Promise<TrainingDataset> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

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

    return buildTrainingDatasetFromHistories({
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      histories,
      fixturesByRound,
    });
  });

/* ------------------------------------------------------------------ *
 * AUDITORIA TEMPORÁRIA: dataset vs baseline
 * Objetivo: explicar a diferença entre participationsOnlyRowCount e o
 * número de predictions do backtest oficial. Não altera nenhuma lógica.
 * Pode ser removida depois que a Etapa 1 for validada.
 * ------------------------------------------------------------------ */

const AuditInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
  participationWindow: z.number().int().min(1).max(30).default(12),
});

export interface AuditExcludedSample {
  playerId: number;
  reason: string;
  historyRoundsCount: number;
  priorRoundsCount: number;
  priorParticipatedCount: number;
  hasAnyParticipationBefore: boolean;
}

export interface AuditRoundSummary {
  round: number;
  datasetParticipations: number;
  baselinePredictions: number;
  difference: number;
  exclusionReasons: {
    noPriorParticipation: number;
    other: number;
  };
  priorParticipatedCountDistribution: Record<string, number>;
  excludedSample: AuditExcludedSample[];
}

export interface AuditResult {
  firstRound: number;
  lastRound: number;
  participationWindow: number;
  totals: {
    rowCount: number;
    datasetParticipations: number;
    baselinePredictions: number;
    difference: number;
  };
  perRound: AuditRoundSummary[];
}

export const auditBaselineVsDataset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AuditInput.parse(input))
  .handler(async ({ data }): Promise<AuditResult> => {
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
    const byPlayer = new Map<number, HistoricalPlayerHistory>();
    for (const h of histories) byPlayer.set(h.playerId, h);

    const dataset = buildTrainingDatasetFromHistories({
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      histories,
      fixturesByRound: new Map(), // não precisamos de fixtures para esta auditoria
    });

    const perRound: AuditRoundSummary[] = [];

    for (let R = data.firstRound; R <= data.lastRound; R++) {
      const datasetRows = dataset.rows.filter(
        (row) => row.round === R && row.target_participated,
      );

      let baselinePredictions = 0;
      let noPriorCount = 0;
      let otherCount = 0;
      const distribution: Record<string, number> = {};
      const excludedSample: AuditExcludedSample[] = [];

      for (const row of datasetRows) {
        const history = byPlayer.get(row.playerId);
        if (!history) {
          otherCount++;
          continue;
        }

        const prior = history.rounds.filter((r) => r.round < R);
        const priorParticipated = prior.filter((r) => r.participated);
        const bucket = String(priorParticipated.length);
        distribution[bucket] = (distribution[bucket] ?? 0) + 1;

        const predicted = predictByRecentAverage(
          history,
          R,
          data.participationWindow,
        );

        if (predicted === null) {
          const reason =
            priorParticipated.length === 0
              ? "no_prior_participation"
              : "other";
          if (reason === "no_prior_participation") noPriorCount++;
          else otherCount++;

          if (excludedSample.length < 8) {
            excludedSample.push({
              playerId: row.playerId,
              reason,
              historyRoundsCount: history.rounds.length,
              priorRoundsCount: prior.length,
              priorParticipatedCount: priorParticipated.length,
              hasAnyParticipationBefore: priorParticipated.length > 0,
            });
          }
        } else {
          baselinePredictions++;
        }
      }

      perRound.push({
        round: R,
        datasetParticipations: datasetRows.length,
        baselinePredictions,
        difference: datasetRows.length - baselinePredictions,
        exclusionReasons: {
          noPriorParticipation: noPriorCount,
          other: otherCount,
        },
        priorParticipatedCountDistribution: distribution,
        excludedSample,
      });
    }

    const totalDatasetParticipations = perRound.reduce(
      (s, r) => s + r.datasetParticipations,
      0,
    );
    const totalBaselinePredictions = perRound.reduce(
      (s, r) => s + r.baselinePredictions,
      0,
    );

    return {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      participationWindow: data.participationWindow,
      totals: {
        rowCount: dataset.metadata.rowCount,
        datasetParticipations: totalDatasetParticipations,
        baselinePredictions: totalBaselinePredictions,
        difference: totalDatasetParticipations - totalBaselinePredictions,
      },
      perRound,
    };
  });

/* ------------------------------------------------------------------ *
 * AUDITORIA TEMPORÁRIA: perfil dos jogadores sem participação prévia
 * Objetivo: entender quem são as linhas "sem prior participation" e se
 * havia sinal pré-rodada indicando candidatura. Não altera nada.
 * ------------------------------------------------------------------ */

const AuditNoPriorInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
});

export interface NoPriorPlayerProfile {
  playerId: number;
  apelido: string | null;
  round: number;
  clubId: number | null;
  position: CartolaPosition | null;
  priorAppearancesInPontuados: number;
  priorRoundsWithEntrouFalse: number;
  lastSeenRound: number | null;
  roundsSinceLastSeen: number | null;
  firstEverAppearanceRound: number | null;
  isFirstAppearanceEver: boolean;
  profileType:
    | "brand_new_in_dataset"
    | "benched_recently"
    | "benched_long_ago"
    | "in_payload_no_bench_flag";
  currentMarketStatusId: number | null;
  currentMarketPrice: number | null;
  currentMarketMedia: number | null;
  currentMarketJogos: number | null;
}

export interface NoPriorAuditResult {
  firstRound: number;
  lastRound: number;
  total: number;
  uniquePlayers: number;
  byRound: Array<{ round: number; count: number }>;
  byPosition: Array<{ position: string; count: number }>;
  byClub: Array<{ clubId: number | null; count: number }>;
  byProfileType: Array<{ type: string; count: number }>;
  all: NoPriorPlayerProfile[];
}

export const auditNoPriorParticipation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AuditNoPriorInput.parse(input))
  .handler(async ({ data }): Promise<NoPriorAuditResult> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

    const [rawRounds, marketData] = await Promise.all([
      Promise.all(
        roundsToFetch.map((r) =>
          cached(`pontuados:${r}`, 30 * 60_000, () =>
            getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(
              () => ({ rodada: r, atletas: {} }),
            ),
          ),
        ),
      ),
      cached("atletas", 60_000, () => getJson<MercadoData>("/atletas/mercado")),
    ]);

    // Índices O(1) para lookup por rodada e por jogador.
    const presentByRound = new Map<number, Set<number>>();
    const benchByRound = new Map<number, Set<number>>();
    const apelidoById = new Map<number, string>();
    const rawByRound = new Map<number, RawPontuadosRound>();

    for (const rr of rawRounds) {
      rawByRound.set(rr.rodada, rr);
      const present = new Set<number>();
      const bench = new Set<number>();
      for (const [idStr, atleta] of Object.entries(rr.atletas)) {
        const id = Number(idStr);
        if (!Number.isFinite(id)) continue;
        present.add(id);
        if (atleta.entrou_em_campo === false) bench.add(id);
        if (atleta.apelido && !apelidoById.has(id)) {
          apelidoById.set(id, atleta.apelido);
        }
      }
      presentByRound.set(rr.rodada, present);
      benchByRound.set(rr.rodada, bench);
    }

    const marketById = new Map<number, Atleta>();
    for (const a of marketData.atletas) marketById.set(a.atleta_id, a);

    const histories = buildHistoriesFromRawRounds(rawRounds);

    const all: NoPriorPlayerProfile[] = [];

    for (const h of histories) {
      for (const r of h.rounds) {
        if (r.round < data.firstRound || r.round > data.lastRound) continue;
        if (!r.participated) continue;

        const prior = h.rounds.filter((x) => x.round < r.round);
        const priorParticipated = prior.filter((x) => x.participated);
        if (priorParticipated.length > 0) continue; // tem prior, pula

        const R = r.round;
        const playerId = r.playerId;

        // Presenças pré-R no payload de pontuados
        let priorAppearancesInPontuados = 0;
        let priorRoundsWithEntrouFalse = 0;
        let lastSeenRound: number | null = null;
        for (let rr = R - 1; rr >= 1; rr--) {
          const present = presentByRound.get(rr);
          if (!present || !present.has(playerId)) continue;
          priorAppearancesInPontuados++;
          if (lastSeenRound === null) lastSeenRound = rr;
          const bench = benchByRound.get(rr);
          if (bench && bench.has(playerId)) priorRoundsWithEntrouFalse++;
        }

        // Primeira aparição em toda a série
        let firstEverAppearanceRound: number | null = null;
        for (let rr = 1; rr <= data.lastRound; rr++) {
          const present = presentByRound.get(rr);
          if (present && present.has(playerId)) {
            firstEverAppearanceRound = rr;
            break;
          }
        }

        const roundsSinceLastSeen =
          lastSeenRound === null ? null : R - lastSeenRound;
        const isFirstAppearanceEver = firstEverAppearanceRound === R;

        let profileType: NoPriorPlayerProfile["profileType"];
        if (priorAppearancesInPontuados === 0) {
          profileType = "brand_new_in_dataset";
        } else if (priorRoundsWithEntrouFalse === 0) {
          profileType = "in_payload_no_bench_flag";
        } else if (
          roundsSinceLastSeen !== null &&
          roundsSinceLastSeen <= 2
        ) {
          profileType = "benched_recently";
        } else {
          profileType = "benched_long_ago";
        }

        const m = marketById.get(playerId);

        all.push({
          playerId,
          apelido: apelidoById.get(playerId) ?? m?.apelido ?? null,
          round: R,
          clubId: r.clubId ?? null,
          position: r.position ?? null,
          priorAppearancesInPontuados,
          priorRoundsWithEntrouFalse,
          lastSeenRound,
          roundsSinceLastSeen,
          firstEverAppearanceRound,
          isFirstAppearanceEver,
          profileType,
          currentMarketStatusId: m?.status_id ?? null,
          currentMarketPrice: m?.preco_num ?? null,
          currentMarketMedia: m?.media_num ?? null,
          currentMarketJogos: m?.jogos_num ?? null,
        });
      }
    }

    // Agregações
    const byRoundMap = new Map<number, number>();
    const byPosMap = new Map<string, number>();
    const byClubMap = new Map<string, number>();
    const byTypeMap = new Map<string, number>();

    for (const t of all) {
      byRoundMap.set(t.round, (byRoundMap.get(t.round) ?? 0) + 1);
      const pos = t.position ?? "UNKNOWN";
      byPosMap.set(pos, (byPosMap.get(pos) ?? 0) + 1);
      const club = t.clubId === null ? "UNKNOWN" : String(t.clubId);
      byClubMap.set(club, (byClubMap.get(club) ?? 0) + 1);
      byTypeMap.set(t.profileType, (byTypeMap.get(t.profileType) ?? 0) + 1);
    }

    const byRound = Array.from(byRoundMap.entries())
      .map(([round, count]) => ({ round, count }))
      .sort((a, b) => a.round - b.round);
    const byPosition = Array.from(byPosMap.entries())
      .map(([position, count]) => ({ position, count }))
      .sort((a, b) => b.count - a.count);
    const byClub = Array.from(byClubMap.entries())
      .map(([club, count]) => ({
        clubId: club === "UNKNOWN" ? null : Number(club),
        count,
      }))
      .sort((a, b) => b.count - a.count);
    const byProfileType = Array.from(byTypeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    return {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      total: all.length,
      uniquePlayers: new Set(all.map((x) => x.playerId)).size,
      byRound,
      byPosition,
      byClub,
      byProfileType,
      all: all.sort((a, b) => a.round - b.round || a.playerId - b.playerId),
    };
  });

/* ------------------------------------------------------------------ *
 * AUDITORIA TEMPORÁRIA: por que runBacktestMulti produz menos
 * previsões que a auditoria do baseline?
 * Objetivo: provar por contagem que a diferença vem do filtro de
 * elegibilidade em runHistoricalBacktest. Não altera nada.
 * ------------------------------------------------------------------ */

const AuditBacktestDiffInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
  participationWindow: z.number().int().min(1).max(30).default(12),
});

export interface BacktestDiffSampleExclusion {
  playerId: number;
  round: number;
  reasons: string[];
  firstParticipationRound: number | null;
  priorParticipatedBeforeTarget: number;
  priorParticipatedBeforeFirstRound: number;
}

export interface BacktestDiffResult {
  firstRound: number;
  lastRound: number;
  participationWindow: number;
  datasetParticipations: number;
  baselinePredictions: number;
  officialBacktestPredictions: number;
  difference: number;
  exclusionsByReason: Array<{ reason: string; count: number }>;
  exclusionsByRound: Array<{ round: number; count: number }>;
  sampleExclusions: BacktestDiffSampleExclusion[];
}

export const auditBacktestUniverseDifference = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AuditBacktestDiffInput.parse(input))
  .handler(async ({ data }): Promise<BacktestDiffResult> => {
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
    const byPlayer = new Map<number, HistoricalPlayerHistory>();
    for (const h of histories) byPlayer.set(h.playerId, h);

    // ---- Universo da AUDITORIA (auditBaselineVsDataset) ------------
    let datasetParticipations = 0;
    let baselinePredictions = 0;
    const auditUniverse = new Set<string>();

    for (const h of histories) {
      for (const r of h.rounds) {
        if (r.round < data.firstRound || r.round > data.lastRound) continue;
        if (!r.participated) continue;
        datasetParticipations++;

        const predicted = predictByRecentAverage(
          h,
          r.round,
          data.participationWindow,
        );
        if (predicted !== null) {
          baselinePredictions++;
          auditUniverse.add(`${h.playerId}:${r.round}`);
        }
      }
    }

    // ---- Universo do BACKTEST OFICIAL (runHistoricalBacktest) -------
    // Replicamos exatamente o filtro + loop do backtest de produção

    let officialBacktestPredictions = 0;
    const officialUniverse = new Set<string>();

    for (const h of histories) {
      for (const r of h.rounds) {
        if (r.round < data.firstRound || r.round > data.lastRound) continue;
        if (!r.participated) continue;

        const predicted = predictByRecentAverage(
          h,
          r.round,
          data.participationWindow,
        );
        if (predicted === null) continue;

        officialBacktestPredictions++;
        officialUniverse.add(`${h.playerId}:${r.round}`);
      }
    }

    // ---- Exclusões: em audit mas não em official -------------------
    const exclusions = new Set<string>();
    for (const key of auditUniverse) {
      if (!officialUniverse.has(key)) exclusions.add(key);
    }

    // Pré-inicializa todas as categorias para aparecerem com 0 se não
    // ocorrerem. `missing_fixture` é listado por completude da taxonomia,
    // mas runBacktest não consulta fixtures — nunca será motivo real.
    const reasonCounts = new Map<string, number>([
      ["missing_clubId", 0],
      ["missing_position", 0],
      ["missing_fixture", 0],
      ["not_participated", 0],
      ["no_prior_participation", 0],
      ["invalid_target", 0],
      ["player_filtered_by_eligible", 0],
      ["other", 0],
    ]);

    const roundCounts = new Map<number, number>();
    const sampleExclusions: BacktestDiffSampleExclusion[] = [];

    for (const key of exclusions) {
      const [pStr, rStr] = key.split(":");
      const playerId = Number(pStr);
      const roundNum = Number(rStr);
      const h = byPlayer.get(playerId);
      if (!h) continue;

      const roundEntry = h.rounds.find((x) => x.round === roundNum);
      const reasons: string[] = [];

      if (!roundEntry || !roundEntry.participated) {
        reasons.push("not_participated");
      }
      if (roundNum < data.firstRound || roundNum > data.lastRound) {
        reasons.push("invalid_target");
      }
      if (roundEntry && roundEntry.clubId === undefined) {
        reasons.push("missing_clubId");
      }
      if (roundEntry && roundEntry.position === undefined) {
        reasons.push("missing_position");
      }
      // missing_fixture: não é checado aqui de propósito — runBacktest
      // não usa fixtures. Fica sempre 0.

      const priorPart = h.rounds.filter(
        (x) => x.participated && x.round < roundNum,
      );
      if (priorPart.length === 0) {
        reasons.push("no_prior_participation");
      }

      const hasPriorBeforeFirstRound = h.rounds.some(
        (x) => x.participated && x.round < data.firstRound,
      );
      if (!hasPriorBeforeFirstRound) {
        reasons.push("player_filtered_by_eligible");
      }

      if (reasons.length === 0) {
        reasons.push("other");
      }

      for (const reason of reasons) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      roundCounts.set(roundNum, (roundCounts.get(roundNum) ?? 0) + 1);

      if (sampleExclusions.length < 20) {
        const firstPart = h.rounds.find((x) => x.participated);
        sampleExclusions.push({
          playerId,
          round: roundNum,
          reasons,
          firstParticipationRound: firstPart?.round ?? null,
          priorParticipatedBeforeTarget: priorPart.length,
          priorParticipatedBeforeFirstRound: h.rounds.filter(
            (x) => x.participated && x.round < data.firstRound,
          ).length,
        });
      }
    }

    const exclusionsByReason = Array.from(reasonCounts.entries())
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const exclusionsByRound = Array.from(roundCounts.entries())
      .map(([round, count]) => ({ round, count }))
      .sort((a, b) => a.round - b.round);

    return {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      participationWindow: data.participationWindow,
      datasetParticipations,
      baselinePredictions,
      officialBacktestPredictions,
      difference: baselinePredictions - officialBacktestPredictions,
      exclusionsByReason,
      exclusionsByRound,
      sampleExclusions,
    };
  });

/* ------------------------------------------------------------------ *
 * AUDITORIA TEMPORÁRIA: leakage feature a feature
 * Não altera nenhuma lógica. Diagnóstico estático + verificação
 * dinâmica sobre o dataset R5–R26.
 * ------------------------------------------------------------------ */

const FeatureLeakageAuditInput = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
});

export type FeatureLeakageStatus =
  | "SAFE"
  | "UNKNOWN"
  | "LEAKAGE"
  | "NOT_APPLICABLE";

export interface FeatureLeakageEntry {
  feature: string;
  source: string;
  temporal: string;
  status: FeatureLeakageStatus;
  explanation: string;
}

export interface AffectedRowSample {
  playerId: number;
  round: number;
  clubIdInTarget: number | null;
  clubIdInPriorRound: number | null;
  clubChanged: boolean;
  positionInTarget: string | null;
  positionInPriorRound: string | null;
  positionChanged: boolean;
}

export interface FeatureLeakageAuditResult {
  firstRound: number;
  lastRound: number;
  summary: {
    safe: number;
    unknown: number;
    leakage: number;
    notApplicable: number;
  };
  entries: FeatureLeakageEntry[];
  dynamicChecks: {
    totalRows: number;
    rowsWithClubChange: number;
    rowsWithPositionChange: number;
    rowsWithClubIdMissing: number;
    rowsWithPositionMissing: number;
    affectedSample: AffectedRowSample[];
    maxRoundAudit: { ok: boolean; violationsCount: number };
  };
}

/**
 * Tabela estática de análise. Reflete exatamente o código atual de
 * features.functions.ts.
 */
const FEATURE_LEAKAGE_TABLE: FeatureLeakageEntry[] = [
  {
    feature: "clubId",
    source:
      "target.clubId ← HistoricalPlayerRound.clubId ← RawPontuadosAtleta.clube_id ← /atletas/pontuados/{round}",
    temporal: "source is post-round endpoint",
    status: "UNKNOWN",
    explanation:
      "Semanticamente representa o clube do jogador na rodada alvo e costuma ser conhecido antes dela. Porém a única fonte no projeto é o payload pós-rodada de pontuados. Não há snapshot histórico pré-rodada do mercado para reconstruir esse campo. Risco residual concentrado em transferências que mudam o clube exatamente na rodada alvo.",
  },
  {
    feature: "position",
    source:
      "target.position ← HistoricalPlayerRound.position ← RawPontuadosAtleta.posicao_id ← /atletas/pontuados/{round}",
    temporal: "source is post-round endpoint",
    status: "UNKNOWN",
    explanation:
      "Mesmo caso de clubId. Posição é normalmente estável e conhecida, mas a fonte disponível no projeto é pós-rodada.",
  },
  {
    feature: "isHome",
    source: "fixturesByRound.get(target.round) ← /partidas/{round}",
    temporal: "fixture scheduling, pre-round content",
    status: "SAFE",
    explanation:
      "O conteúdo (quem joga em casa contra quem) é informação de calendário, publicada com antecedência. O payload é buscado pós-rodada, mas a informação é pré-rodada. Assumimos que o mando não é reatribuído por decisão pós-jogo.",
  },
  {
    feature: "opponentClubId",
    source: "fixturesByRound.get(target.round) ← /partidas/{round}",
    temporal: "fixture scheduling, pre-round content",
    status: "SAFE",
    explanation: "Mesmo raciocínio de isHome.",
  },
  {
    feature: "games_last_3_rounds",
    source: "prior = roundsAsc.filter(r => r.round < target.round)",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation:
      "Contagem de participações em rodadas estritamente anteriores à alvo.",
  },
  {
    feature: "games_last_5_rounds",
    source: "prior = roundsAsc.filter(r => r.round < target.round)",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "games_last_12_rounds",
    source: "prior = roundsAsc.filter(r => r.round < target.round)",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_avg_3",
    source: "mean(pointsOfLastNParticipations(prior, 3))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Média sobre participações em rodadas anteriores à alvo.",
  },
  {
    feature: "points_avg_5",
    source: "mean(pointsOfLastNParticipations(prior, 5))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_avg_12",
    source: "mean(pointsOfLastNParticipations(prior, 12))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_std_5",
    source: "std(pointsOfLastNParticipations(prior, 5))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_std_12",
    source: "std(pointsOfLastNParticipations(prior, 12))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_min_5",
    source: "min(pointsOfLastNParticipations(prior, 5))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_max_5",
    source: "max(pointsOfLastNParticipations(prior, 5))",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "points_avg_3_minus_avg_12",
    source: "points_avg_3 - points_avg_12",
    temporal: "derived from pre-round features",
    status: "SAFE",
    explanation: "Derivada de duas features já seguras.",
  },
  {
    feature: "home_points_avg",
    source:
      "mean sobre participações em prior com fixture de mandante (fixturesByRound.get(r.round) para r < targetRound)",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation:
      "Todos os insumos são de rodadas anteriores à alvo. Não usa fixture nem clube da rodada alvo.",
  },
  {
    feature: "away_points_avg",
    source: "simétrico a home_points_avg",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation: "Idem.",
  },
  {
    feature: "rounds_since_last_game",
    source: "target.round - (última rodada participada em prior)",
    temporal: "only round < targetRound",
    status: "SAFE",
    explanation:
      "Usa target.round (número da rodada, trivial) menos uma rodada anterior. Sem dependência de dados pós-rodada.",
  },
];

export const auditFeatureLeakageDetailed = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => FeatureLeakageAuditInput.parse(input))
  .handler(async ({ data }): Promise<FeatureLeakageAuditResult> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

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
    const byPlayer = new Map<number, HistoricalPlayerHistory>();
    for (const h of histories) byPlayer.set(h.playerId, h);

    const dataset = buildTrainingDatasetFromHistories({
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      histories,
      fixturesByRound,
    });

    // ---- Verificação dinâmica ------------------------------------
    let rowsWithClubChange = 0;
    let rowsWithPositionChange = 0;
    let rowsWithClubIdMissing = 0;
    let rowsWithPositionMissing = 0;
    const affectedSample: AffectedRowSample[] = [];

    for (const row of dataset.rows) {
      const h = byPlayer.get(row.playerId);
      if (!h) continue;

      const priorRounds = h.rounds.filter((r) => r.round < row.round);
      if (priorRounds.length === 0) continue;
      const lastPrior = priorRounds[priorRounds.length - 1];

      if (row.clubId === null) rowsWithClubIdMissing++;
      if (row.position === null) rowsWithPositionMissing++;

      const clubChanged =
        lastPrior.clubId !== undefined &&
        row.clubId !== null &&
        lastPrior.clubId !== row.clubId;
      const positionChanged =
        lastPrior.position !== undefined &&
        row.position !== null &&
        lastPrior.position !== row.position;

      if (clubChanged) rowsWithClubChange++;
      if (positionChanged) rowsWithPositionChange++;

      if (
        (clubChanged || positionChanged) &&
        affectedSample.length < 20
      ) {
        affectedSample.push({
          playerId: row.playerId,
          round: row.round,
          clubIdInTarget: row.clubId,
          clubIdInPriorRound: lastPrior.clubId ?? null,
          clubChanged,
          positionInTarget: row.position ?? null,
          positionInPriorRound: lastPrior.position ?? null,
          positionChanged,
        });
      }
    }

    // Sanity check da auditoria estrutural já existente.
    let maxRoundViolations = 0;
    for (const row of dataset.rows) {
      if (
        row.maxRoundUsedByFeatures !== null &&
        row.maxRoundUsedByFeatures >= row.round
      ) {
        maxRoundViolations++;
      }
    }

    const summary = FEATURE_LEAKAGE_TABLE.reduce(
      (acc, e) => {
        if (e.status === "SAFE") acc.safe++;
        else if (e.status === "UNKNOWN") acc.unknown++;
        else if (e.status === "LEAKAGE") acc.leakage++;
        else acc.notApplicable++;
        return acc;
      },
      { safe: 0, unknown: 0, leakage: 0, notApplicable: 0 },
    );

    return {
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      summary,
      entries: FEATURE_LEAKAGE_TABLE,
      dynamicChecks: {
        totalRows: dataset.rows.length,
        rowsWithClubChange,
        rowsWithPositionChange,
        rowsWithClubIdMissing,
        rowsWithPositionMissing,
        affectedSample,
        maxRoundAudit: {
          ok: maxRoundViolations === 0,
          violationsCount: maxRoundViolations,
        },
      },
    };
  });

/* ------------------------------------------------------------------ *
 * ML v1 — avaliação temporal (temporário)
 * ------------------------------------------------------------------ */

import { runTemporalEvaluation } from "@/lib/ml/evaluation.functions";
import type { MLv1Result } from "@/lib/ml/model.types";

const MLv1Input = z.object({
  firstRound: z.number().int().min(1),
  lastRound: z.number().int().min(1),
  participationWindow: z.number().int().min(1).max(30).default(12),
  lambda: z.number().min(0).default(1.0),
});

export const runMLv1Evaluation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => MLv1Input.parse(input))
  .handler(async ({ data }): Promise<MLv1Result> => {
    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

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

/* ------------------------------------------------------------------ *
 * ML v1.1 — experimento controlado: mesma coisa que v1, mas sem a
 * feature `points_avg_3_minus_avg_12`.
 * ------------------------------------------------------------------ */

export interface MLv1ComparisonResult {
  v1: MLv1Result;
  v1_1: MLv1Result;
  excludedFeature: string;
}

export const runMLv1_1Comparison = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => MLv1Input.parse(input))
  .handler(async ({ data }): Promise<MLv1ComparisonResult> => {
    if (data.firstRound > data.lastRound) {
      throw new Error("firstRound deve ser menor ou igual a lastRound");
    }

    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

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
    const dataset = buildTrainingDatasetFromHistories({
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      histories,
      fixturesByRound,
    });

    const EXCLUDED_FEATURE = "points_avg_3_minus_avg_12";

    const v1 = runTemporalEvaluation(
      dataset,
      histories,
      data.firstRound,
      data.lastRound,
      data.participationWindow,
      data.lambda,
    );

    const v1_1 = runTemporalEvaluation(
      dataset,
      histories,
      data.firstRound,
      data.lastRound,
      data.participationWindow,
      data.lambda,
      [EXCLUDED_FEATURE],
    );

    return { v1, v1_1, excludedFeature: EXCLUDED_FEATURE };
  });

    const fixturesByRound = new Map<number, Partida[]>();
    roundsToFetch.forEach((r, i) => {
      fixturesByRound.set(r, fixturesRaw[i].partidas ?? []);
    });

    const histories = buildHistoriesFromRawRounds(rawRounds);
    const dataset = buildTrainingDatasetFromHistories({
      firstRound: data.firstRound,
      lastRound: data.lastRound,
      histories,
      fixturesByRound,
    });

    return runTemporalEvaluation(
      dataset,
      histories,
      data.firstRound,
      data.lastRound,
      data.participationWindow,
      data.lambda,
    );
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
