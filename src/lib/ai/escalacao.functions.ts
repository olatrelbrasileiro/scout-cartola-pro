import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDashboardSnapshot } from "@/lib/cartola/api.functions";
import { adversarioMap, atletaToLine } from "./prompts";
import { POSICAO_NOME } from "@/lib/cartola/types";

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
  priorizarMando: z.boolean().default(true),
  evitarDuvidas: z.boolean().default(true),
});

export type EscalacaoIA = {
  esquema: string;
  capitao: number;
  titulares: { atleta_id: number; apelido: string; posicao: string; clube: string; preco: number; motivo: string }[];
  reservas: { atleta_id: number; apelido: string; posicao: string; clube: string; preco: number }[];
  custo_total: number;
  saldo_restante: number;
  resumo_estrategia: string;
};

export const gerarEscalacao = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<EscalacaoIA | { error: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { error: "LOVABLE_API_KEY ausente" };

    const snapshot = await getDashboardSnapshot();
    const adv = adversarioMap(snapshot);
    const reqEsquema = ESQUEMAS[data.esquema];

    // Pré-filtra candidatos: prováveis sempre; dúvidas só se evitarDuvidas=false
    const statusOk = data.evitarDuvidas ? [7] : [2, 7];
    const candidatos = snapshot.data.atletas
      .filter((a) => statusOk.includes(a.status_id) && a.preco_num > 0 && a.preco_num <= data.cartoletas)
      .sort((a, b) => b.media_num - a.media_num);

    // Limita por posição para não estourar contexto
    const porPos: Record<number, typeof candidatos> = {};
    for (const a of candidatos) {
      (porPos[a.posicao_id] ||= []).push(a);
    }
    const limitados: typeof candidatos = [];
    for (const pos of [1, 2, 3, 4, 5]) {
      limitados.push(...(porPos[pos] ?? []).slice(0, 25));
    }

    const linhas = limitados.map((a) => {
      const clube = snapshot.data.clubes[String(a.clube_id)]?.abreviacao ?? "?";
      const ad = adv[a.clube_id];
      return atletaToLine(a, clube, ad?.adv, ad?.mando);
    });

    const sys = `Você é um especialista em Cartola FC. Receba o orçamento, esquema e candidatos e devolva a escalação ÓTIMA respeitando RIGOROSAMENTE:
- Esquema ${data.esquema} (GOL:${reqEsquema.gol}, LAT:${reqEsquema.lat}, ZAG:${reqEsquema.zag}, MEI:${reqEsquema.mei}, ATA:${reqEsquema.ata})
- Custo total dos 11 titulares <= ${data.cartoletas} cartoletas
- ${data.priorizarMando ? "PRIORIZE jogadores jogando em casa contra adversários fracos." : "Mando não é prioridade."}
- ${data.evitarDuvidas ? "Use apenas jogadores prováveis." : "Pode incluir dúvidas se o upside for alto."}
- Capitão = jogador com maior expectativa de pontos (geralmente atacante/meia em casa).
- Reservas: 1 por linha (gol, zag/lat, mei, ata) — mais baratos.
- Devolva SOMENTE via tool call.

Use o atleta_id exato dos candidatos abaixo. Não invente jogadores.`;

    const userMsg = `Orçamento: C$${data.cartoletas.toFixed(2)}\nEsquema: ${data.esquema}\n\nCandidatos:\n${linhas.join("\n")}`;

    const tools = [
      {
        type: "function",
        function: {
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
                    motivo: { type: "string", description: "Por que este jogador (1 frase)" },
                  },
                  required: ["atleta_id", "motivo"],
                  additionalProperties: false,
                },
              },
              reservas: {
                type: "array",
                items: {
                  type: "object",
                  properties: { atleta_id: { type: "number" } },
                  required: ["atleta_id"],
                  additionalProperties: false,
                },
              },
              resumo_estrategia: { type: "string" },
            },
            required: ["esquema", "capitao", "titulares", "reservas", "resumo_estrategia"],
            additionalProperties: false,
          },
        },
      },
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "montar_escalacao" } },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("AI escalacao erro", res.status, txt);
      if (res.status === 429) return { error: "Muitas requisições. Tente novamente em alguns segundos." };
      if (res.status === 402) return { error: "Créditos da IA esgotados." };
      return { error: "Falha ao gerar escalação." };
    }

    const json = (await res.json()) as {
      choices: { message: { tool_calls?: { function: { arguments: string } }[] } }[];
    };
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { error: "IA não devolveu escalação estruturada." };

    let parsed: {
      esquema: string;
      capitao: number;
      titulares: { atleta_id: number; motivo: string }[];
      reservas: { atleta_id: number }[];
      resumo_estrategia: string;
    };
    try {
      parsed = JSON.parse(args);
    } catch {
      return { error: "Resposta da IA inválida." };
    }

    const byId = new Map(snapshot.data.atletas.map((a) => [a.atleta_id, a]));
    const decorate = (id: number, motivo?: string) => {
      const a = byId.get(id);
      if (!a) return null;
      return {
        atleta_id: a.atleta_id,
        apelido: a.apelido,
        posicao: POSICAO_NOME[a.posicao_id] ?? "?",
        clube: snapshot.data.clubes[String(a.clube_id)]?.abreviacao ?? "?",
        preco: a.preco_num,
        motivo: motivo ?? "",
      };
    };

    const titulares = parsed.titulares
      .map((t) => decorate(t.atleta_id, t.motivo))
      .filter((x): x is NonNullable<ReturnType<typeof decorate>> => x !== null);
    const reservas = parsed.reservas
      .map((r) => {
        const d = decorate(r.atleta_id);
        if (!d) return null;
        const { motivo: _ignored, ...rest } = d;
        return rest;
      })
      .filter((x): x is NonNullable<ReturnType<typeof decorate>> => x !== null);

    const custo = titulares.reduce((s, t) => s + t.preco, 0);
    return {
      esquema: parsed.esquema,
      capitao: parsed.capitao,
      titulares,
      reservas,
      custo_total: Number(custo.toFixed(2)),
      saldo_restante: Number((data.cartoletas - custo).toFixed(2)),
      resumo_estrategia: parsed.resumo_estrategia,
    };
  });