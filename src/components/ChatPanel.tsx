import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Sparkles, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Msg = { role: "user" | "assistant"; content: string };

const SUGESTOES = [
  "Quem são os 3 melhores capitães da rodada?",
  "Mitos baratos (até C$8) com bom potencial?",
  "Vale a pena escalar atacante de time visitante?",
];

export function ChatPanel({ extraContext, title = "Cartola IA" }: { extraContext?: string; title?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const enviar = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Msg = { role: "user", content: text.trim() };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setLoading(true);

    let assistantText = "";
    const upsert = (chunk: string) => {
      assistantText += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantText } : m));
        }
        return [...prev, { role: "assistant", content: assistantText }];
      });
    };

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, userMsg], extraContext }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const j = await resp.json().catch(() => ({ error: "Erro desconhecido" }));
        toast.error(j.error ?? `Erro ${resp.status}`);
        setMessages((p) => p.slice(0, -1));
        return;
      }
      if (!resp.body) throw new Error("Sem body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const c = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (c) upsert(c);
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error(e);
        toast.error("Falha ao conversar com a IA");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const limpar = () => {
    abortRef.current?.abort();
    setMessages([]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-secondary" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={limpar} className="h-7 gap-1 text-xs">
            <RotateCcw className="h-3 w-3" />
            Limpar
          </Button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pergunte qualquer coisa sobre o mercado atual. Eu tenho acesso aos preços, médias, status e
              próximos confrontos.
            </p>
            <div className="space-y-2">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[90%] rounded-2xl rounded-tr-sm bg-primary/15 px-3 py-2 text-sm"
                : "max-w-[95%] rounded-2xl rounded-tl-sm bg-muted/50 px-3 py-2 text-sm"
            }
          >
            {m.role === "assistant" ? (
              <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2 prose-table:my-2 prose-th:px-2 prose-td:px-2 prose-li:my-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
              </div>
            ) : (
              <span className="whitespace-pre-wrap">{m.content}</span>
            )}
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            pensando…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(input);
        }}
        className="border-t border-border/60 p-3"
      >
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(input);
              }
            }}
            placeholder="Pergunte sobre jogadores, capitão, mando…"
            rows={2}
            className="min-h-[44px] resize-none"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()} size="icon" className="h-auto">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}