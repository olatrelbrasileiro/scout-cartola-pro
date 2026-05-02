/**
 * Cliente Gemini direto. Usa GEMINI_API_KEY (server-only).
 * Suporta:
 *  - generateContent simples
 *  - generateContent com tool calling (function declarations)
 *  - generateContent com grounding google_search (busca web nativa)
 *  - streaming SSE
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiPart = { text: string } | { functionCall: { name: string; args: unknown } };

export type GeminiContent = {
  role?: "user" | "model";
  parts: GeminiPart[];
};

export type GeminiTool =
  | { google_search: Record<string, never> }
  | {
      function_declarations: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      }[];
    };

export type GeminiRequest = {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: GeminiTool[];
  toolConfig?: { functionCallingConfig: { mode: "AUTO" | "ANY" | "NONE"; allowedFunctionNames?: string[] } };
  generationConfig?: { temperature?: number; maxOutputTokens?: number; responseMimeType?: string };
};

export type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[]; role?: string };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: { web?: { uri: string; title: string } }[];
    };
    finishReason?: string;
  }[];
  error?: { code: number; message: string };
};

function getApiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY ausente");
  return k;
}

export async function geminiGenerate(
  model: string,
  body: GeminiRequest,
): Promise<GeminiResponse> {
  const key = getApiKey();
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    console.error("Gemini error", res.status, json);
    throw new Error(json.error?.message ?? `Gemini ${res.status}`);
  }
  return json;
}

/** Streaming SSE compatível com OpenAI-like chunks. Retorna o ReadableStream. */
export async function geminiStream(model: string, body: GeminiRequest): Promise<ReadableStream<Uint8Array>> {
  const key = getApiKey();
  const res = await fetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse&key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini stream ${res.status}: ${text}`);
  }

  // Converte stream Gemini SSE para formato OpenAI-compatível para reusar parser do client.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as GeminiResponse;
          const parts = parsed.candidates?.[0]?.content?.parts ?? [];
          let text = "";
          for (const p of parts) {
            if ("text" in p && p.text) text += p.text;
          }
          if (text) {
            // Repackage como chunk OpenAI-like
            const chunk = {
              choices: [{ delta: { content: text } }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        } catch {
          // ignore partial
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });
}

export const GEMINI_MODEL_FAST = "gemini-2.5-flash";
export const GEMINI_MODEL_PRO = "gemini-2.5-pro";