// src/lib/football/types.ts

/**
 * Status de um fixture conforme retornado pela API-Football v3.
 */
export type ApiFootballFixtureStatus = {
  long: string;
  short: string;
  elapsed: number | null;
};

/**
 * Estrutura bruta de um fixture retornado por
 * GET /fixtures?league=71&season=2026.
 */
export type ApiFootballFixture = {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    periods: { first: number | null; second: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
    status: ApiFootballFixtureStatus;
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    flag: string | null;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string; logo: string; winner: boolean | null };
    away: { id: number; name: string; logo: string; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
};

/**
 * Resposta completa do endpoint /fixtures da API-Football v3.
 */
export type ApiFootballFixturesResponse = {
  get: string;
  parameters: Record<string, string>;
  errors: unknown[] | Record<string, string>;
  results: number;
  paging: { current: number; total: number };
  response: ApiFootballFixture[];
};

/**
 * Fixture normalizado para uso interno do projeto.
 * Contém somente os campos relevantes para análise de Cartola FC.
 */
export type NormalizedFixture = {
  fixtureId: number;
  leagueId: number;
  season: number;
  round: string;
  date: string;
  timestamp: number;
  statusShort: string;
  statusLong: string;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  goalsHome: number | null;
  goalsAway: number | null;
  venueName: string | null;
  venueCity: string | null;
};
