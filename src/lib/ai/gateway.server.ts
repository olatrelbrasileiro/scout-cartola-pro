/**
 * Cliente Lovable AI Gateway (OpenAI-compatible).
 * Usa LOVABLE_API_KEY (server-only, fornecida pela plataforma).
 */

const URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export type ChatMsg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
};

export type GatewayTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GatewayRequest = {
  model: string;
  messages: ChatMsg[];
  tools?: GatewayTool[];
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  stream?: boolean;
};

export type GatewayResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason?: string;
  }[];
  error?: { message: string };
};

function getKey(): string {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY ausente");
  return k;
}

export async function gatewayChat(body: GatewayRequest): Promise<GatewayResponse> {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GatewayResponse;
  if (!res.ok) {
    console.error("Gateway erro", res.status, json);
    throw new Error(json.error?.message ?? `Gateway ${res.status}`);
  }
  return json;
}

export const MODEL_FAST = "google/gemini-2.5-flash";
export const MODEL_PRO = "google/gemini-2.5-pro";