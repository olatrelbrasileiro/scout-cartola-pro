// src/lib/football/api.functions.ts

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cached } from "./cache.functions";
import type {
  ApiFootballFixturesResponse,
  NormalizedFixture,
} from "./types";

const BASE = "https://v3.football.api-sports.io";

/**
 * ID da Série A do Brasileirão na API-Football v3.
 * Referência: https://dashboard.api-football.com/soccer/ids
 */
export const BRASILEIRAO_SERIE_A_LEAGUE_ID = 71;

/**
 * Temporada padrão desta integração.
 * 2026 é o ano do Brasileirão que queremos buscar.
 */
export const DEFAULT_SEASON = 2026;

/**
 * Lê a API key do ambiente do servidor.
 * Nunca é exposta ao cliente — só é usada dentro de handlers
 * `createServerFn`, que rodam no servidor.
 */
function getApiKey(): string {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error(
      "API_FOOTBALL_KEY não configurada no ambiente do servidor.",
    );
  }
  return key;
}

/**
 * Fetch genérico para a API-Football v3.
 * A autenticação é feita via header `x-apisports-key`.
 */
async function getFootballJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "x-apisports-key": getApiKey(),
    },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${path} respondeu ${res.status}`);
  }

  return (await res.json()) as T;
}

/**
 * Converte um fixture bruto da API-Football em NormalizedFixture.
 * Somente os campos relevantes para o projeto são mantidos.
 */
function normalizeFixture(
  raw: ApiFootballFixturesResponse["response"][number],
): NormalizedFixture {
  return {
    fixtureId: raw.fixture.id,
    leagueId: raw.league.id,
    season: raw.league.season,
    round: raw.league.round,
    date: raw.fixture.date,
    timestamp: raw.fixture.timestamp,
    statusShort: raw.fixture.status.short,
    statusLong: raw.fixture.status.long,
    homeTeamId: raw.teams.home.id,
    homeTeamName: raw.teams.home.name,
    awayTeamId: raw.teams.away.id,
    awayTeamName: raw.teams.away.name,
    goalsHome: raw.goals.home,
    goalsAway: raw.goals.away,
    venueName: raw.fixture.venue.name,
    venueCity: raw.fixture.venue.city,
  };
}

/**
 * Input padrão das funções de fixtures.
 * `season` e `leagueId` têm defaults, mas podem ser sobrescritos.
 */
const FixturesInput = z.object({
  season: z.number().int().min(2000).max(2100).default(DEFAULT_SEASON),
  leagueId: z.number().int().min(1).default(BRASILEIRAO_SERIE_A_LEAGUE_ID),
});

/**
 * Busca os fixtures do Brasileirão Série A para a temporada informada.
 *
 * - Usa `process.env.API_FOOTBALL_KEY` (server-side apenas).
 * - Cacheia por 30 minutos para respeitar o rate limit da API.
 * - Retorna somente os campos normalizados de NormalizedFixture.
 */
export const getBrasileiraoFixtures = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => FixturesInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<NormalizedFixture[]> => {
    const { season, leagueId } = data;
    const cacheKey = `football:fixtures:${leagueId}:${season}`;

    const response = await cached(cacheKey, 30 * 60_000, () =>
      getFootballJson<ApiFootballFixturesResponse>(
        `/fixtures?league=${leagueId}&season=${season}`,
      ),
    );

    return response.response.map(normalizeFixture);
  });

/**
 * Atalho explícito para o Brasileirão 2026.
 * Útil quando o frontend não precisa parametrizar nada.
 */
export const getBrasileirao2026Fixtures = createServerFn({ method: "GET" })
  .inputValidator(() => ({}))
  .handler(async (): Promise<NormalizedFixture[]> => {
    const cacheKey = `football:fixtures:${BRASILEIRAO_SERIE_A_LEAGUE_ID}:${DEFAULT_SEASON}`;

    const response = await cached(cacheKey, 30 * 60_000, () =>
      getFootballJson<ApiFootballFixturesResponse>(
        `/fixtures?league=${BRASILEIRAO_SERIE_A_LEAGUE_ID}&season=${DEFAULT_SEASON}`,
      ),
    );

    return response.response.map(normalizeFixture);
  });
