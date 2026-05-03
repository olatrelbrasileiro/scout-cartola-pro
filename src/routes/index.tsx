import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import { Header } from "@/components/Header";
import { MercadoStatusBar } from "@/components/MercadoStatusBar";
import { MercadoTable } from "@/components/MercadoTable";
import { Button } from "@/components/ui/button";
import { getDashboardEnriquecido } from "@/lib/cartola/api.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cartola IA — Mercado ao vivo + chat com IA" },
      {
        name: "description",
        content:
          "Dashboard com todos os jogadores do Cartola FC, filtros, status e chat com IA pra tirar dúvidas sobre escalação.",
      },
    ],
  }),
  loader: () => getDashboardEnriquecido(),
  staleTime: 60_000,
  pendingComponent: PendingPage,
  errorComponent: ErrorPage,
  component: Dashboard,
});

function PendingPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Buscando dados do Cartola…
      </div>
    </div>
  );
}

function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto mt-12 max-w-md rounded-xl border border-destructive/40 bg-card p-6 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <h2 className="font-semibold">Não consegui buscar o Cartola</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        <Button onClick={reset} className="mt-4">Tentar de novo</Button>
      </div>
    </div>
  );
}

function Dashboard() {
  const data = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Mercado da rodada</h1>
            <p className="text-sm text-muted-foreground">
              Dados ao vivo da API pública do Cartola FC. Atualizados a cada minuto.
            </p>
          </div>
          <Link to="/escalacao">
            <Button className="bg-[image:var(--gradient-cta)] text-primary-foreground shadow-[var(--shadow-glow)]">
              Gerar escalação ótima →
            </Button>
          </Link>
        </div>

        <MercadoStatusBar status={data.mercado} />

        <MercadoTable data={data} />
      </main>
    </div>
  );
}
