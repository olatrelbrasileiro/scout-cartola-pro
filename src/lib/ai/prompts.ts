import type { Atleta, DashboardSnapshot } from "@/lib/cartola/types";
import { POSICAO_NOME } from "@/lib/cartola/types";

function statusLabel(id: number): string {
  return (
    { 2: "Dúvida", 3: "Suspenso", 5: "Contundido", 6: "Nulo", 7: "Provável" }[id] ??
    `status ${id}`
  );
}

/** Resumo enxuto de um atleta para caber no contexto da IA. */
export function atletaToLine(a: Atleta, clubeNome: string, adversario?: string, mando?: "casa" | "fora"): string {
  const scoutTop = a.scout
    ? Object.entries(a.scout)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")
    : "";
  const advStr = adversario ? ` vs ${adversario}${mando === "casa" ? " (casa)" : " (fora)"}` : "";
  return `#${a.atleta_id} ${a.apelido} (${POSICAO_NOME[a.posicao_id] ?? "?"}, ${clubeNome}) C$${a.preco_num.toFixed(2)} méd ${a.media_num.toFixed(1)} últ ${a.pontos_num.toFixed(1)} ${statusLabel(a.status_id)}${scoutTop ? ` [${scoutTop}]` : ""}${advStr}`;
}

export function adversarioMap(snapshot: DashboardSnapshot): Record<number, { adv: string; mando: "casa" | "fora" }> {
  const map: Record<number, { adv: string; mando: "casa" | "fora" }> = {};
  for (const p of snapshot.partidas) {
    const casa = snapshot.data.clubes[String(p.clube_casa_id)];
    const fora = snapshot.data.clubes[String(p.clube_visitante_id)];
    if (casa && fora) {
      map[p.clube_casa_id] = { adv: fora.abreviacao, mando: "casa" };
      map[p.clube_visitante_id] = { adv: casa.abreviacao, mando: "fora" };
    }
  }
  return map;
}

/** Constrói um snapshot textual para injetar no system prompt do chat. */
export function buildContextoChat(snapshot: DashboardSnapshot, maxAtletas = 80): string {
  const adv = adversarioMap(snapshot);
  // Top atletas por média entre prováveis/dúvidas com preço > 0
  const atletas = snapshot.data.atletas
    .filter((a) => [2, 7].includes(a.status_id) && a.preco_num > 0)
    .sort((a, b) => b.media_num - a.media_num)
    .slice(0, maxAtletas);

  const lines = atletas.map((a) => {
    const clube = snapshot.data.clubes[String(a.clube_id)]?.abreviacao ?? "?";
    const ad = adv[a.clube_id];
    return atletaToLine(a, clube, ad?.adv, ad?.mando);
  });

  const mercadoTxt = `Rodada ${snapshot.mercado.rodada_atual}, mercado ${
    snapshot.mercado.status_mercado === 1 ? "ABERTO" : "FECHADO"
  }.`;

  return `Você é um analista do Cartola FC chamado "Cartola IA". Use APENAS os dados abaixo para responder. Se algo não estiver nos dados, diga que não tem essa informação. Seja direto, técnico e use formatação markdown (tabelas e listas quando útil).

${mercadoTxt}

Top ${lines.length} atletas (apelido, posição, clube, preço, média, última pontuação, status, scouts, adversário):
${lines.join("\n")}

Glossário de scout: G=gol, A=assistência, FT=finalização na trave, FD=finalização defendida, FF=finalização para fora, FS=falta sofrida, PE=passe errado, PI=impedimento, I=interceptação, RB=roubo de bola, SG=jogo sem sofrer gol, DE=defesa, GS=gol sofrido, FC=falta cometida, GC=gol contra, CA=cartão amarelo, CV=cartão vermelho, DP=defesa de pênalti.`;
}