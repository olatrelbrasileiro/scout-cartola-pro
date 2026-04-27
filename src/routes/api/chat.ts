import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDashboardSnapshot } from "@/lib/cartola/api.functions";
import { buildContextoChat } from "@/lib/ai/prompts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  extraContext: z.string().max(8000).optional(),
});

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY ausente" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        let payload: z.infer<typeof Body>;
        try {
          payload = Body.parse(await request.json());
        } catch (e) {
          return new Response(JSON.stringify({ error: "Payload inválido" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        let systemPrompt = "Você é um analista do Cartola FC chamado Cartola IA.";
        try {
          const snapshot = await getDashboardSnapshot();
          systemPrompt = buildContextoChat(snapshot);
        } catch (e) {
          console.error("Falha ao buscar snapshot Cartola:", e);
        }
        if (payload.extraContext) {
          systemPrompt += `\n\nContexto adicional do usuário:\n${payload.extraContext}`;
        }

        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            stream: true,
            messages: [{ role: "system", content: systemPrompt }, ...payload.messages],
          }),
        });

        if (!aiRes.ok) {
          const status = aiRes.status;
          const text = await aiRes.text().catch(() => "");
          console.error("AI gateway erro", status, text);
          const msg =
            status === 429
              ? "Muitas requisições. Aguarde alguns segundos."
              : status === 402
                ? "Créditos da IA esgotados. Adicione créditos no workspace Lovable."
                : "Erro no gateway de IA";
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        return new Response(aiRes.body, {
          headers: { ...CORS, "Content-Type": "text/event-stream" },
        });
      },
    },
  },
});