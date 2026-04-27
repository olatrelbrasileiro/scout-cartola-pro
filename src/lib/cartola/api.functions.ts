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

const BASE = "https://api.cartola.globo.com";

// Cache em memória do worker — TTL curto pois mercado muda durante a janela.
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
        atletas: Record<string, { apelido: string; pontuacao: number; scout: Record<string, number> }>;
      }>(`/atletas/pontuados/${data.rodada}`),
    );
  });

export const getDashboardSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardSnapshot> => {
    const [mercado, data, partidasRes] = await Promise.all([
      cached("status", 60_000, () => getJson<MercadoStatus>("/mercado/status")),
      cached("atletas", 60_000, () =>
        getJson<MercadoData>("/atletas/mercado"),
      ),
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