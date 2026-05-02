import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDashboardSnapshot } from "@/lib/cartola/api.functions";
import { buildContextoChat } from "@/lib/ai/prompts";
import { geminiStream, GEMINI_MODEL_FAST } from "@/lib/ai/gemini.server";

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
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "GEMINI_API_KEY ausente" }), {
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

        try {
          const contents = payload.messages.map((m) => ({
            role: m.role === "assistant" ? ("model" as const) : ("user" as const),
            parts: [{ text: m.content }],
          }));
          const stream = await geminiStream(GEMINI_MODEL_FAST, {
            contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.7 },
          });
          return new Response(stream, {
            headers: { ...CORS, "Content-Type": "text/event-stream" },
          });
        } catch (e) {
          console.error("Gemini erro:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Erro Gemini" }),
            { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});