import type { Atleta, AtletaComScore, DashboardSnapshot, Partida } from "./types";

/**
 * Pontuações padrão dos scouts (Cartola FC 2024+).
 * Defensivos / ofensivos sem G/A para o cálculo de "média básica".
 */
export const SCOUT_VALUES: Record<string, number> = {
  // Ofensivos
  G: 8,
  A: 5,
  FT: 3,
  FD: 1.2,
  FF: 0.8,
  FS: 0.5,
  PE: -0.3,
  PS: 1, // pênalti sofrido
  // Defensivos
  DS: 1.2,
  DE: 1, // defesa difícil (goleiro)
  DP: 7, // defesa de pênalti
  SG: 5, // jogo sem sofrer gol (gol/zag/lat)
  // Negativos
  GS: -2,
  FC: -0.5,
  GC: -3,
  CA: -1,
  CV: -3,
  PC: -1, // pênalti cometido
  PI: -0.1,
  I: 0,
  RB: 1.5,
};

/** Calcula pontos de um conjunto de scouts excluindo G e A (média "básica"). */
export function calcMediaBasicaPontos(scout: Record<string, number> | undefined): number {
  if (!scout) return 0;
  let total = 0;
  for (const [k, v] of Object.entries(scout)) {
    if (k === "G" || k === "A") continue;
    const peso = SCOUT_VALUES[k];
    if (peso === undefined) continue;
    total += peso * v;
  }
  return total;
}

export type RodadaPontuada = {
  rodada: number;
  atletas: Record<
    string,
    { apelido: string; pontuacao: number; scout: Record<string, number>; entrou_em_campo?: boolean }
  >;
};

export type HistoricoPorAtleta = Map<
  number,
  {
    rodadas: { rodada: number; pontuacao: number; scout: Record<string, number>; basica: number; jogou: boolean }[];
    media_total: number;
    media_basica: number;
    media_recente_3: number;
    consistencia: number; // 0-1 (1 = muito consistente)
    rodadas_atuou: number[];
    atuou_ultima: boolean;
  }
>;

/** Agrega histórico de várias rodadas em uma estrutura por atleta. */
export function buildHistoricoPorAtleta(rodadas: RodadaPontuada[]): HistoricoPorAtleta {
  const map: HistoricoPorAtleta = new Map();
  const sorted = [...rodadas].sort((a, b) => a.rodada - b.rodada);
  const ultimaRodada = sorted.at(-1)?.rodada;

  for (const r of sorted) {
    for (const [idStr, info] of Object.entries(r.atletas)) {
      const id = Number(idStr);
      const jogou = (info.entrou_em_campo ?? true) && info.pontuacao !== 0;
      const basica = calcMediaBasicaPontos(info.scout);
      const cur = map.get(id) ?? {
        rodadas: [],
        media_total: 0,
        media_basica: 0,
        media_recente_3: 0,
        consistencia: 0,
        rodadas_atuou: [],
        atuou_ultima: false,
      };
      cur.rodadas.push({ rodada: r.rodada, pontuacao: info.pontuacao, scout: info.scout, basica, jogou });
      if (jogou) cur.rodadas_atuou.push(r.rodada);
      map.set(id, cur);
    }
  }

  for (const [id, h] of map.entries()) {
    const jogadas = h.rodadas.filter((x) => x.jogou);
    if (jogadas.length === 0) continue;
    const total = jogadas.reduce((s, x) => s + x.pontuacao, 0);
    h.media_total = total / jogadas.length;
    h.media_basica = jogadas.reduce((s, x) => s + x.basica, 0) / jogadas.length;
    const recentes = jogadas.slice(-3);
    h.media_recente_3 = recentes.reduce((s, x) => s + x.pontuacao, 0) / recentes.length;
    // consistência: 1 - (desvio padrão normalizado)
    const m = h.media_total;
    const variancia = jogadas.reduce((s, x) => s + Math.pow(x.pontuacao - m, 2), 0) / jogadas.length;
    const dp = Math.sqrt(variancia);
    h.consistencia = Math.max(0, Math.min(1, 1 - dp / 8));
    h.atuou_ultima = ultimaRodada !== undefined && h.rodadas_atuou.includes(ultimaRodada);
    map.set(id, h);
  }

  return map;
}

/**
 * Calcula a forma do TIME do atleta nas últimas N rodadas a partir do histórico.
 * Soma pontos médios por atleta de cada clube nas últimas rodadas.
 */
export function buildFormaPorClube(rodadas: RodadaPontuada[], atletas: Atleta[]): Map<number, number> {
  const clubeAtletas = new Map<number, number[]>();
  for (const a of atletas) {
    const arr = clubeAtletas.get(a.clube_id) ?? [];
    arr.push(a.atleta_id);
    clubeAtletas.set(a.clube_id, arr);
  }
  const ultimas = [...rodadas].sort((a, b) => a.rodada - b.rodada).slice(-3);
  const out = new Map<number, number>();
  for (const [clubeId, ids] of clubeAtletas.entries()) {
    let total = 0;
    let n = 0;
    for (const r of ultimas) {
      for (const aid of ids) {
        const info = r.atletas[String(aid)];
        if (info && info.pontuacao !== 0) {
          total += info.pontuacao;
          n++;
        }
      }
    }
    out.set(clubeId, n > 0 ? total / n : 0);
  }
  return out;
}

/** Mapa clube_id → adversário e mando da próxima rodada. */
export function adversarioMap(partidas: Partida[]): Map<number, { adv_id: number; mando: "casa" | "fora" }> {
  const m = new Map<number, { adv_id: number; mando: "casa" | "fora" }>();
  for (const p of partidas) {
    m.set(p.clube_casa_id, { adv_id: p.clube_visitante_id, mando: "casa" });
    m.set(p.clube_visitante_id, { adv_id: p.clube_casa_id, mando: "fora" });
  }
  return m;
}

const norm = (v: number, max: number) => Math.max(0, Math.min(1, v / max));

/**
 * Score IA composto (0-100). Pesos:
 *  - histórico (consistência + média total): 25%
 *  - momento recente (últimas 3): 25%
 *  - média básica (defensivos/ofensivos sem G/A): 15%
 *  - forma do time (média do clube nas últimas): 10%
 *  - confronto (mando + força do adversário): 15%
 *  - status + atuou última: 10%
 */
export function calcularScore(
  atleta: Atleta,
  hist: HistoricoPorAtleta,
  forma: Map<number, number>,
  adv: Map<number, { adv_id: number; mando: "casa" | "fora" }>,
): { score: number; fatores: AtletaComScore["fatores"]; rodadas_atuou: number[] } {
  const h = hist.get(atleta.atleta_id);

  // 1. Histórico (consistência * 0.5 + média/12 * 0.5)
  const f_historico = h
    ? Math.round((h.consistencia * 50 + norm(h.media_total, 12) * 50))
    : Math.round(norm(atleta.media_num, 12) * 60);

  // 2. Momento recente
  const f_momento = h && h.rodadas.filter((x) => x.jogou).length > 0
    ? Math.round(norm(h.media_recente_3, 14) * 100)
    : Math.round(norm(atleta.pontos_num, 14) * 60);

  // 3. Média básica
  const f_basica = h
    ? Math.round(norm(h.media_basica, 8) * 100)
    : Math.round(norm(calcMediaBasicaPontos(atleta.scout), 8) * 60);

  // 4. Forma do time
  const formaClube = forma.get(atleta.clube_id) ?? 0;
  const f_time = Math.round(norm(formaClube, 8) * 100);

  // 5. Confronto: mando casa + adversário fraco
  const advInfo = adv.get(atleta.clube_id);
  let f_confronto = 50;
  if (advInfo) {
    const formaAdv = forma.get(advInfo.adv_id) ?? 5;
    const mandoBonus = advInfo.mando === "casa" ? 20 : -10;
    // adv fraco (forma baixa) = mais fácil
    const advBonus = Math.round((1 - norm(formaAdv, 8)) * 30);
    f_confronto = Math.max(0, Math.min(100, 50 + mandoBonus + advBonus));
  }

  // 6. Status + atuou
  const statusBonus =
    atleta.status_id === 7 ? 100 : atleta.status_id === 2 ? 60 : atleta.status_id === 5 || atleta.status_id === 3 ? 0 : 50;
  const atuouBonus = h?.atuou_ultima ? 100 : h && h.rodadas_atuou.length > 0 ? 70 : 50;
  const f_status = Math.round((statusBonus + atuouBonus) / 2);

  const score = Math.round(
    f_historico * 0.25 +
      f_momento * 0.25 +
      f_basica * 0.15 +
      f_time * 0.1 +
      f_confronto * 0.15 +
      f_status * 0.1,
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    fatores: {
      historico: f_historico,
      momento: f_momento,
      media_basica: f_basica,
      time: f_time,
      confronto: f_confronto,
      atuou_ultima: h?.atuou_ultima ?? false,
    },
    rodadas_atuou: h?.rodadas_atuou ?? [],
  };
}

export function enriquecerAtletas(
  snapshot: DashboardSnapshot,
  rodadas: RodadaPontuada[],
): { atletas: AtletaComScore[]; historico: HistoricoPorAtleta; forma: Map<number, number> } {
  const hist = buildHistoricoPorAtleta(rodadas);
  const forma = buildFormaPorClube(rodadas, snapshot.data.atletas);
  const adv = adversarioMap(snapshot.partidas);
  const atletas = snapshot.data.atletas.map((a) => {
    const { score, fatores, rodadas_atuou } = calcularScore(a, hist, forma, adv);
    return { ...a, score_ia: score, fatores, rodadas_atuou };
  });
  return { atletas, historico: hist, forma };
}