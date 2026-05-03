import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Loader2, Sparkles } from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { gerarEscalacao, type EscalacaoIA } from "@/lib/ai/escalacao.functions";
import { CampoEscalacao } from "@/components/CampoEscalacao";

export const Route = createFileRoute("/escalacao")({
  head: () => ({
    meta: [
      { title: "Escalação ótima por IA — Cartola IA" },
      {
        name: "description",
        content:
          "Informe seu saldo de cartoletas e o esquema; a IA monta a escalação ótima respeitando orçamento, mando e status.",
      },
    ],
  }),
  component: EscalacaoPage,
});

const ESQUEMAS = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-3-2", "5-4-1"];

function EscalacaoPage() {
  const [cartoletas, setCartoletas] = useState(120);
  const [esquema, setEsquema] = useState("4-3-3");
  const [objetivo, setObjetivo] = useState<"pontos" | "equilibrado" | "lucro">("pontos");
  const [evitarDuvidas, setEvitarDuvidas] = useState(true);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<EscalacaoIA | null>(null);
  const gerar = useServerFn(gerarEscalacao);

  const handleGerar = async () => {
    setLoading(true);
    setResultado(null);
    try {
      const r = await gerar({ data: { cartoletas, esquema, objetivo, evitarDuvidas } });
      if ("error" in r) {
        toast.error(r.error);
      } else {
        setResultado(r);
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao gerar escalação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escalação ótima por IA</h1>
          <p className="text-sm text-muted-foreground">
            Informe seu orçamento e esquema. A IA escolhe os 11 + capitão respeitando mando, status e
            scouts.
          </p>
        </div>

        <section className="grid gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)] sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cart">Cartoletas disponíveis (C$)</Label>
            <Input
              id="cart"
              type="number"
              min={40}
              max={500}
              step={0.5}
              value={cartoletas}
              onChange={(e) => setCartoletas(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Esquema tático</Label>
            <Select value={esquema} onValueChange={setEsquema}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ESQUEMAS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Objetivo da escalação</Label>
            <Select value={objetivo} onValueChange={(v) => setObjetivo(v as typeof objetivo)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pontos">Mais pontos</SelectItem>
                <SelectItem value="equilibrado">Equilibrado (custo-benefício)</SelectItem>
                <SelectItem value="lucro">Valorizar (lucro)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 p-3">
            <div>
              <div className="text-sm font-medium">Evitar dúvidas</div>
              <div className="text-xs text-muted-foreground">Só jogadores prováveis</div>
            </div>
            <Switch checked={evitarDuvidas} onCheckedChange={setEvitarDuvidas} />
          </label>

          <div className="sm:col-span-2">
            <Button
              onClick={handleGerar}
              disabled={loading}
              className="w-full bg-[image:var(--gradient-cta)] text-primary-foreground shadow-[var(--shadow-glow)]"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  IA escalando seu time…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Gerar escalação ótima
                </>
              )}
            </Button>
          </div>
        </section>

        {resultado && <ResultadoEscalacao r={resultado} />}
      </main>
    </div>
  );
}

function ResultadoEscalacao({ r }: { r: EscalacaoIA }) {
  const ordemPos: Record<string, number> = { Goleiro: 0, Lateral: 1, Zagueiro: 2, Meia: 3, Atacante: 4 };
  const titulares = [...r.titulares].sort(
    (a, b) => (ordemPos[a.posicao] ?? 9) - (ordemPos[b.posicao] ?? 9),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-card p-4 shadow-[var(--shadow-glow)]">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Escalação sugerida
          </div>
          <div className="text-xl font-bold">{r.esquema}</div>
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Custo</div>
            <div className="font-mono font-bold">C$ {r.custo_total.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Saldo</div>
            <div className="font-mono font-bold text-secondary">C$ {r.saldo_restante.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Titulares
        </h2>
        <div className="mb-4">
          <CampoEscalacao titulares={r.titulares} capitao={r.capitao} />
        </div>
        <div className="space-y-2">
          {titulares.map((t) => {
            const isCap = t.atleta_id === r.capitao;
            return (
              <div
                key={t.atleta_id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  isCap
                    ? "border-secondary/60 bg-secondary/10"
                    : "border-border/40 bg-muted/20"
                }`}
              >
                <Badge variant="outline" className="font-mono text-[10px]">
                  {t.posicao.slice(0, 3).toUpperCase()}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t.apelido}</span>
                    <span className="text-xs text-muted-foreground">{t.clube}</span>
                    {isCap && (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-secondary">
                        <Crown className="h-3.5 w-3.5" />
                        Capitão
                      </span>
                    )}
                  </div>
                  {t.motivo && (
                    <p className="mt-1 text-xs text-muted-foreground">{t.motivo}</p>
                  )}
                </div>
                <div className="font-mono text-sm">C${t.preco.toFixed(1)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {r.reservaLuxo && (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reserva de Luxo
          </h2>
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 p-2 text-sm">
            <Badge variant="outline" className="font-mono text-[10px]">
              {r.reservaLuxo.posicao.slice(0, 3).toUpperCase()}
            </Badge>
            <span className="font-medium">{r.reservaLuxo.apelido}</span>
            <span className="text-xs text-muted-foreground">{r.reservaLuxo.clube}</span>
            <span className="ml-auto font-mono text-xs">C${r.reservaLuxo.preco.toFixed(1)}</span>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Estratégia
        </h2>
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{r.resumo_estrategia}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}