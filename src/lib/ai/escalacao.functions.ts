import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDashboardEnriquecido } from "@/lib/cartola/api.functions";
import { POSICAO_NOME, type AtletaComScore } from "@/lib/cartola/types";
import { geminiGenerate, GEMINI_MODEL_PRO } from "./gemini.server";
import { adversarioMap } from "@/lib/cartola/scoring";

const ESQUEMAS: Record<string, { gol: number; lat: number; zag: number; mei: number; ata: number }> = {
  "3-4-3": { gol: 1, lat: 0, zag: 3, mei: 4, ata: 3 },
  "3-5-2": { gol: 1, lat: 0, zag: 3, mei: 5, ata: 2 },
  "4-3-3": { gol: 1, lat: 2, zag: 2, mei: 3, ata: 3 },
  "4-4-2": { gol: 1, lat: 2, zag: 2, mei: 4, ata: 2 },
  "4-5-1": { gol: 1, lat: 2, zag: 2, mei: 5, ata: 1 },
  "5-3-2": { gol: 1, lat: 2, zag: 3, mei: 3, ata: 2 },
  "5-4-1": { gol: 1, lat: 2, zag: 3, mei: 4, ata: 1 },
};

const Input = z.object({
  cartoletas: z.number().min(40).max(500),
  esquema: z.enum(Object.keys(ESQUEMAS) as [string, ...string[]]),
  objetivo: z.enum(["pontos", "equilibrado", "lucro"]).default("pontos"),
  evitarDuvidas: z.boolean().default(true),
});

export type EscalacaoIA = {
  esquema: string;
  capitao: number;
  titulares: { atleta_id: number; apelido: string; posicao: string; clube: string; preco: number; score: number; motivo: string }[];
  reservaLuxo: { atleta_id: number; apelido: string; posicao: string; clube: string; preco: number; score: number } | null;
  custo_total: number;
  saldo_restante: number;
  resumo_estrategia: string;
  fontes_web: { uri: string; title: string }[];
};

function topoPorPosicao(atletas: AtletaComScore[], posicao: number, n: number, objetivo: string) {
  const filtrados = atletas.filter((a) => a.posicao_id === posicao);
  const sorted = [...filtrados].sort((a, b) => {
    if (objetivo === "lucro") {
      // valoriza variacao + score
      return (b.variacao_num + b.score_ia / 10) - (a.variacao_num + a.score_ia / 10);
    }
    if (objetivo === "equilibrado") {
      // score / preço (custo-benefício)
      const ra = a.score_ia / Math.max(1, a.preco_num);
      const rb = b.score_ia / Math.max(1, b.preco_num);
      return rb - ra;
    }
    return b.score_ia - a.score_ia;
  });
  return sorted.slice(0, n);
}

export const gerarEscalacao = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<EscalacaoIA | { error: string }> => {
    if (!process.env.GEMINI_API_KEY) return { error: "GEMINI_API_KEY ausente" };

    const enriched = await getDashboardEnriquecido();
    const reqEsquema = ESQUEMAS[data.esquema];
    const adv = adversarioMap(enriched.partidas);

    const statusOk = data.evitarDuvidas ? [7] : [2, 7];
    let candidatos = enriched.atletas
      .filter((a) => statusOk.includes(a.status_id) && a.preco_num > 0 && a.preco_num <= data.cartoletas);

    // Top por posição (15 por linha — mais que suficiente sem estourar contexto)
    const porPos: AtletaComScore[] = [];
    for (const pos of [1, 2, 3, 4, 5]) {
      porPos.push(...topoPorPosicao(candidatos, pos, 15, data.objetivo));
    }
    candidatos = porPos;

    const linhas = candidatos.map((a) => {
      const clube = enriched.clubes[String(a.clube_id)]?.abreviacao ?? "?";
      const ad = adv.get(a.clube_id);
      const advClube = ad ? enriched.clubes[String(ad.adv_id)]?.abreviacao ?? "?" : "?";
      const advTxt = ad ? ` vs ${advClube} (${ad.mando})` : "";
      return `#${a.atleta_id} ${a.apelido} (${POSICAO_NOME[a.posicao_id]}, ${clube}) C$${a.preco_num.toFixed(2)} | score:${a.score_ia} | méd:${a.media_num.toFixed(1)} | últ:${a.pontos_num.toFixed(1)} | var:${a.variacao_num.toFixed(2)} | atuou_ult:${a.fatores.atuou_ultima ? "sim" : "nao"}${advTxt}`;
    });

    const objetivoTxt =
      data.objetivo === "lucro"
        ? "MAXIMIZAR VALORIZAÇÃO (lucro). Prefira jogadores com variação positiva alta e bom mando."
        : data.objetivo === "equilibrado"
          ? "EQUILIBRADO entre pontos e custo-benefício."
          : "MAXIMIZAR PONTOS. Prefira jogadores com maior score_ia e melhor confronto.";

    const sys = `Você é um especialista em Cartola FC. Use seu conhecimento sobre os times brasileiros + busca web para confirmar últimas notícias (lesões, escalação provável, fase do time) antes de escalar.

REGRAS RÍGIDAS:
- Esquema ${data.esquema} (GOL:${reqEsquema.gol}, LAT:${reqEsquema.lat}, ZAG:${reqEsquema.zag}, MEI:${reqEsquema.mei}, ATA:${reqEsquema.ata})
- Custo dos 11 titulares <= ${data.cartoletas}
- Objetivo: ${objetivoTxt}
- ${data.evitarDuvidas ? "Use APENAS prováveis (status 7)." : "Pode usar dúvidas se upside justificar."}
- Capitão = jogador com MAIOR score combinado considerando confronto.
- Reserva de Luxo: 1 jogador caro fora do XI inicial que pode entrar.
- Use APENAS atleta_id da lista de candidatos. Não invente jogadores.

Devolva via tool call montar_escalacao.`;

    const userMsg = `Orçamento: C$${data.cartoletas.toFixed(2)}\nEsquema: ${data.esquema}\nObjetivo: ${data.objetivo}\n\nCandidatos:\n${linhas.join("\n")}`;

    const tool = {
      function_declarations: [
        {
          name: "montar_escalacao",
          description: "Devolve a escalação ótima respeitando esquema e orçamento.",
          parameters: {
            type: "object",
            properties: {
              esquema: { type: "string" },
              capitao: { type: "number", description: "atleta_id do capitão" },
              titulares: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    atleta_id: { type: "number" },
                    motivo: { type: "string" },
                  },
                  required: ["atleta_id", "motivo"],
                },
              },
              reserva_luxo: { type: "number", description: "atleta_id do reserva de luxo (opcional)" },
              resumo_estrategia: { type: "string" },
            },
            required: ["esquema", "capitao", "titulares", "resumo_estrategia"],
          },
        },
      ],
    };

    let json;
    try {
      json = await geminiGenerate(GEMINI_MODEL_PRO, {
        contents: [{ role: "user", parts: [{ text: userMsg }] }],
        systemInstruction: { parts: [{ text: sys }] },
        tools: [tool],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["montar_escalacao"] } },
        generationConfig: { temperature: 0.4 },
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Falha Gemini" };
    }

    const cand = json.candidates?.[0];
    const fnPart = cand?.content?.parts?.find((p) => "functionCall" in p) as
      | { functionCall: { name: string; args: Record<string, unknown> } }
      | undefined;
    if (!fnPart) return { error: "IA não devolveu escalação estruturada." };

    const args = fnPart.functionCall.args as {
      esquema: string;
      capitao: number;
      titulares: { atleta_id: number; motivo: string }[];
      reserva_luxo?: number;
      resumo_estrategia: string;
    };

    const byId = new Map(enriched.atletas.map((a) => [a.atleta_id, a]));
    const decorate = (id: number, motivo = "") => {
      const a = byId.get(id);
      if (!a) return null;
      return {
        atleta_id: a.atleta_id,
        apelido: a.apelido,
        posicao: POSICAO_NOME[a.posicao_id] ?? "?",
        clube: enriched.clubes[String(a.clube_id)]?.abreviacao ?? "?",
        preco: a.preco_num,
        score: a.score_ia,
        motivo,
      };
    };

    const titulares = args.titulares
      .map((t) => decorate(t.atleta_id, t.motivo))
      .filter((x): x is NonNullable<ReturnType<typeof decorate>> => x !== null);
    const reserva = args.reserva_luxo ? decorate(args.reserva_luxo) : null;
    const reservaLuxo = reserva
      ? { atleta_id: reserva.atleta_id, apelido: reserva.apelido, posicao: reserva.posicao, clube: reserva.clube, preco: reserva.preco, score: reserva.score }
      : null;
    const custo = titulares.reduce((s, t) => s + t.preco, 0);

    const fontes = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((g) => g.web)
      .filter((w): w is { uri: string; title: string } => Boolean(w?.uri));

    return {
      esquema: args.esquema,
      capitao: args.capitao,
      titulares,
      reservaLuxo,
      custo_total: Number(custo.toFixed(2)),
      saldo_restante: Number((data.cartoletas - custo).toFixed(2)),
      resumo_estrategia: args.resumo_estrategia,
      fontes_web: fontes.slice(0, 6),
    };
  });