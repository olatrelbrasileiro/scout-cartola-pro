// src/lib/cartola/matchup.ts

import type {
  CartolaPosition,
  HistoricalPlayerHistory,
} from '@/lib/data/historical.types';
import type { Partida } from './types';
import { predictByRecentAverage } from '@/lib/backtest/baseline';

/**
 * Peso do prior no shrinkage.
 *
 * Escolha documentada: priorWeight = 5 significa que misturamos 5
 * "observações virtuais" da média global (do mando correto) em cima da
 * amostra real.
 *
 * Consequências:
 * - amostra de 2 rodadas  -> (sum + 5*G) / 7   -> muito puxado para G
 * - amostra de 5 rodadas  -> (sum + 5*G) / 10  -> meio a meio
 * - amostra de 12 rodadas -> (sum + 5*G) / 17  -> dominado pela amostra
 */
export const DEFAULT_PRIOR_WEIGHT = 5;

/** Peso da produção do time vs. concessão do adversário. */
export const MATCHUP_ALPHA = 0.5;

/** Clamp interno por sinal (teamRatio, opponentRatio). */
export const MIN_RATIO = 0.5;
export const MAX_RATIO = 2.0;

/** Clamp externo do fator final. */
export const MIN_MATCHUP_FACTOR = 0.5;
export const MAX_MATCHUP_FACTOR = 2.0;

/** Posições consideradas nos cálculos de matchup. */
export const MATCHUP_POSITIONS: readonly CartolaPosition[] = [
  'GOL', 'LAT', 'ZAG', 'MEI', 'ATA', 'TEC',
];

/**
 * Amostra por (rodada, time, mando, posição).
 *
 * - `production`  = média de pontos POR JOGADOR daquela posição, naquele
 *   time, naquela rodada e naquele mando.
 * - `concession`  = média de pontos POR JOGADOR daquela posição, do
 *   adversário daquele time, na mesma rodada. É o que o time "cedeu" à
 *   posição.
 */
export interface TeamRoundPositionStat {
  round: number;
  teamId: number;
  isHome: boolean;
  position: CartolaPosition;
  production: number;
  concession: number;
}

export interface MatchupInput {
  teamId: number;
  opponentId: number;
  isHome: boolean;
  position: CartolaPosition;
  beforeRound: number;
  windowSize: number;
  priorWeight?: number;
}

export interface PositionMatchup {
  position: CartolaPosition;
  /** Produção do time na posição, no mando, com shrinkage. */
  teamProduction: number;
  /** Concessão do adversário na posição, no mando oposto, com shrinkage. */
  opponentConcession: number;
  /**
   * teamProduction / G_venue, clampado em [MIN_RATIO, MAX_RATIO].
   * É o valor efetivamente usado no cálculo do fator.
   */
  teamRatio: number;
  /**
   * opponentConcession / G_venue, clampado em [MIN_RATIO, MAX_RATIO].
   * É o valor efetivamente usado no cálculo do fator.
   */
  opponentRatio: number;
  /** Média geométrica ponderada por alpha, clampada em [0.5, 2.0]. */
  matchupFactor: number;
  teamSampleSize: number;
  opponentSampleSize: number;
}

/** Referências globais por posição e por mando. */
export interface GlobalMeansByPosition {
  home: number;
  away: number;
}

/**
 * Constrói as amostras (rodada, time, mando, posição) a partir dos
 * históricos normalizados + fixtures por rodada.
 *
 * Regra de fairness: só adicionamos amostra quando AMBOS os times
 * escalaram jogadores naquela posição na rodada.
 *
 * Time mandante -> isHome: true
 * Time visitante -> isHome: false
 *
 * A "concession" registrada é sempre a produção do outro lado.
 */
export function buildPositionSamples(
  histories: HistoricalPlayerHistory[],
  fixturesByRound: Map<number, Partida[]>,
): TeamRoundPositionStat[] {
  const index = new Map<string, number[]>();
  const keyOf = (round: number, clubId: number, position: CartolaPosition): string =>
    `${round}|${clubId}|${position}`;

  for (const h of histories) {
    for (const r of h.rounds) {
      if (!r.participated) continue;
      if (typeof r.clubId !== 'number' || !r.position) continue;
      const key = keyOf(r.round, r.clubId, r.position);
      const arr = index.get(key);
      if (arr) arr.push(r.points);
      else index.set(key, [r.points]);
    }
  }

  const meanOf = (
    round: number,
    clubId: number,
    position: CartolaPosition,
  ): number | null => {
    const arr = index.get(keyOf(round, clubId, position));
    if (!arr || arr.length === 0) return null;
    let s = 0;
    for (const v of arr) s += v;
    return s / arr.length;
  };

  const out: TeamRoundPositionStat[] = [];

  for (const [round, fixtures] of fixturesByRound.entries()) {
    for (const f of fixtures) {
      if (!f.valida) continue;
      const home = f.clube_casa_id;
      const away = f.clube_visitante_id;

      for (const position of MATCHUP_POSITIONS) {
        const homeProd = meanOf(round, home, position);
        const awayProd = meanOf(round, away, position);
        if (homeProd === null || awayProd === null) continue;

        out.push({
          round,
          teamId: home,
          isHome: true,
          position,
          production: homeProd,
          concession: awayProd,
        });
        out.push({
          round,
          teamId: away,
          isHome: false,
          position,
          production: awayProd,
          concession: homeProd,
        });
      }
    }
  }

  return out;
}

/**
 * Referências globais por posição e mando, usando SOMENTE amostras
 * anteriores a `beforeRound`.
 *
 * - `home` = média de produção de times jogando em casa naquela posição.
 * - `away` = média de produção de times jogando fora naquela posição.
 *
 * Por simetria, `home` também serve de referência para "quanto um time
 * cederia jogando em casa" (é a produção do visitante), e vice-versa.
 */
export function computeGlobalMeansByPosition(
  stats: TeamRoundPositionStat[],
  beforeRound: number,
): Map<CartolaPosition, GlobalMeansByPosition> {
  const acc = new Map<
    CartolaPosition,
    { homeSum: number; homeN: number; awaySum: number; awayN: number }
  >();

  for (const s of stats) {
    if (s.round >= beforeRound) continue;
    const cur =
      acc.get(s.position) ?? { homeSum: 0, homeN: 0, awaySum: 0, awayN: 0 };
    if (s.isHome) {
      cur.homeSum += s.production;
      cur.homeN += 1;
    } else {
      cur.awaySum += s.production;
      cur.awayN += 1;
    }
    acc.set(s.position, cur);
  }

  const out = new Map<CartolaPosition, GlobalMeansByPosition>();
  for (const [pos, { homeSum, homeN, awaySum, awayN }] of acc.entries()) {
    out.set(pos, {
      home: homeN > 0 ? homeSum / homeN : 0,
      away: awayN > 0 ? awaySum / awayN : 0,
    });
  }
  return out;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function shrinkMean(
  samples: number[],
  reference: number,
  priorWeight: number,
): number {
  if (samples.length === 0) return reference;
  let sum = 0;
  for (const v of samples) sum += v;
  return (sum + reference * priorWeight) / (samples.length + priorWeight);
}

/**
 * Calcula o matchup para uma (time, adversário, mando, posição) antes
 * da rodada alvo.
 *
 * Fórmula:
 *   G_venue = (isHome ? G_home : G_away)(position)
 *
 *   teamProduction     = shrink(team samples,  G_venue, priorWeight)
 *   opponentConcession = shrink(opp samples,    G_venue, priorWeight)
 *
 *   teamRatio     = clamp(teamProduction     / G_venue, MIN_RATIO, MAX_RATIO)
 *   opponentRatio = clamp(opponentConcession / G_venue, MIN_RATIO, MAX_RATIO)
 *
 *   matchupFactor = clamp(
 *     teamRatio^alpha * opponentRatio^(1 - alpha),
 *     MIN_MATCHUP_FACTOR, MAX_MATCHUP_FACTOR
 *   )
 *
 * Data leakage: TODA amostra considerada tem `round < beforeRound`,
 * inclusive as que compõem as referências globais.
 */
export function calculatePositionMatchup(
  stats: TeamRoundPositionStat[],
  globalMeans: Map<CartolaPosition, GlobalMeansByPosition>,
  input: MatchupInput,
): PositionMatchup {
  const {
    teamId,
    opponentId,
    isHome,
    position,
    beforeRound,
    windowSize,
    priorWeight = DEFAULT_PRIOR_WEIGHT,
  } = input;

  const gm = globalMeans.get(position);
  const G_venue = gm ? (isHome ? gm.home : gm.away) : 0;

  const teamSamples = stats
    .filter(
      (s) =>
        s.teamId === teamId &&
        s.isHome === isHome &&
        s.position === position &&
        s.round < beforeRound,
    )
    .sort((a, b) => b.round - a.round)
    .slice(0, windowSize);

  // Se estamos em casa, o adversário está fora -> olhamos os jogos dele fora.
  const opponentSamples = stats
    .filter(
      (s) =>
        s.teamId === opponentId &&
        s.isHome !== isHome &&
        s.position === position &&
        s.round < beforeRound,
    )
    .sort((a, b) => b.round - a.round)
    .slice(0, windowSize);

  const teamProduction = shrinkMean(
    teamSamples.map((s) => s.production),
    G_venue,
    priorWeight,
  );
  const opponentConcession = shrinkMean(
    opponentSamples.map((s) => s.concession),
    G_venue,
    priorWeight,
  );

  const rawTeamRatio = G_venue > 0 ? teamProduction / G_venue : 1;
  const rawOpponentRatio = G_venue > 0 ? opponentConcession / G_venue : 1;

  const teamRatio = clamp(rawTeamRatio, MIN_RATIO, MAX_RATIO);
  const opponentRatio = clamp(rawOpponentRatio, MIN_RATIO, MAX_RATIO);

  const rawFactor =
    Math.pow(teamRatio, MATCHUP_ALPHA) *
    Math.pow(opponentRatio, 1 - MATCHUP_ALPHA);

  const matchupFactor = clamp(
    rawFactor,
    MIN_MATCHUP_FACTOR,
    MAX_MATCHUP_FACTOR,
  );

  return {
    position,
    teamProduction,
    opponentConcession,
    teamRatio,
    opponentRatio,
    matchupFactor,
    teamSampleSize: teamSamples.length,
    opponentSampleSize: opponentSamples.length,
  };
}

/**
 * Aplica o matchup em cima da previsão de média recente.
 * - Se não houver baseline, devolve null.
 * - Se não houver matchup, devolve a previsão base.
 *
 * Multiplicativo (neutro = 1.0). Limitação conhecida: quando a média
 * base do jogador é negativa (raro no Cartola), o efeito do matchup
 * fica invertido. Aceitável para esta primeira validação.
 */
export function predictWithMatchup(
  history: HistoricalPlayerHistory,
  targetRound: number,
  participationWindow: number,
  matchup: PositionMatchup | null,
): number | null {
  const base = predictByRecentAverage(
    history,
    targetRound,
    participationWindow,
  );
  if (base === null) return null;
  if (matchup === null) return base;
  return base * matchup.matchupFactor;
}
