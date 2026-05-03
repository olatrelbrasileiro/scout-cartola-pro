import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, X } from "lucide-react";
import { Header } from "@/components/Header";
import { JogadoresTable } from "@/components/JogadoresTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDashboardSnapshot } from "@/lib/cartola/api.functions";
import type { Atleta } from "@/lib/cartola/types";
import { POSICAO_NOME, STATUS_MAP } from "@/lib/cartola/types";
import { adversarioMap } from "@/lib/ai/prompts";

export const Route = createFileRoute("/comparar")({
  head: () => ({
    meta: [
      { title: "Comparar jogadores — Cartola IA" },
      {
        name: "description",
        content: "Compare lado a lado preço, média, status e adversário de até 4 jogadores do Cartola FC.",
      },
    ],
  }),
  loader: () => getDashboardSnapshot(),
  staleTime: 60_000,
  pendingComponent: () => (
    <div>
      <Header />
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando…
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div>
      <Header />
      <div className="mx-auto mt-12 max-w-md text-center text-sm text-destructive">{error.message}</div>
    </div>
  ),
  component: Comparar,
});

function Comparar() {
  const snapshot = Route.useLoaderData();
  const [selecionados, setSelecionados] = useState<Atleta[]>([]);
  const adv = adversarioMap(snapshot);

  const toggle = (a: Atleta) => {
    setSelecionados((prev) => {
      if (prev.some((x) => x.atleta_id === a.atleta_id)) {
        return prev.filter((x) => x.atleta_id !== a.atleta_id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, a];
    });
  };

  const remover = (id: number) => setSelecionados((p) => p.filter((x) => x.atleta_id !== id));

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comparador de jogadores</h1>
          <p className="text-sm text-muted-foreground">
            Selecione até 4 jogadores na tabela e veja lado a lado. Depois peça uma análise da IA.
          </p>
        </div>

        {selecionados.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {selecionados.map((a) => {
                const clube = snapshot.data.clubes[String(a.clube_id)];
                const ad = adv[a.clube_id];
                return (
                  <div key={a.atleta_id} className="relative rounded-lg border border-border/60 bg-muted/30 p-3">
                    <button
                      onClick={() => remover(a.atleta_id)}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <div className="font-semibold">{a.apelido}</div>
                    <div className="text-xs text-muted-foreground">
                      {POSICAO_NOME[a.posicao_id]} · {clube?.abreviacao}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Preço</dt>
                      <dd className="text-right font-mono">C$ {a.preco_num.toFixed(2)}</dd>
                      <dt className="text-muted-foreground">Média</dt>
                      <dd className="text-right font-mono text-secondary">{a.media_num.toFixed(2)}</dd>
                      <dt className="text-muted-foreground">Última</dt>
                      <dd className="text-right font-mono">{a.pontos_num.toFixed(2)}</dd>
                      <dt className="text-muted-foreground">Jogos</dt>
                      <dd className="text-right font-mono">{a.jogos_num}</dd>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="text-right">
                        <Badge variant="outline" className="text-[10px]">
                          {STATUS_MAP[a.status_id]?.label ?? "—"}
                        </Badge>
                      </dd>
                      <dt className="text-muted-foreground">Próximo</dt>
                      <dd className="text-right text-xs">
                        {ad ? `${ad.mando === "casa" ? "vs" : "@"} ${ad.adv}` : "—"}
                      </dd>
                    </dl>
                  </div>
                );
              })}
            </div>
            {selecionados.length < 2 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Selecione pelo menos 2 jogadores para a IA comparar.
              </p>
            )}
            {selecionados.length > 0 && (
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setSelecionados([])}>
                  Limpar seleção
                </Button>
              </div>
            )}
          </div>
        )}

        <JogadoresTable
          snapshot={snapshot}
          selectable
          selected={selecionados.map((s) => s.atleta_id)}
          onToggleSelect={toggle}
        />
      </main>
    </div>
  );
}