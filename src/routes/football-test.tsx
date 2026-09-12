// src/routes/football-test.tsx

import { createFileRoute } from "@tanstack/react-router";
import { getBrasileirao2026Fixtures } from "@/lib/football/api.functions";
import type { NormalizedFixture } from "@/lib/football/types";

type LoaderData =
  | { ok: true; fixtures: NormalizedFixture[] }
  | { ok: false; error: string };

export const Route = createFileRoute("/football-test")({
  // Roda no servidor durante o SSR (e no cliente em navegação).
  // A API key nunca sai do handler server-side de getBrasileirao2026Fixtures.
  loader: async (): Promise<LoaderData> => {
    try {
      const fixtures = await getBrasileirao2026Fixtures({ data: {} });
      return { ok: true, fixtures };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
  component: FootballTestPage,
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function FootballTestPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <h1 className="mb-2 text-2xl font-bold">Football API Test</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Fixtures do Brasileirão via API-Football (server-side).
        </p>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro ao buscar fixtures</div>
          <div className="mt-1 text-sm">{data.error}</div>
          <div className="mt-2 text-xs">
            Verifique se <code>API_FOOTBALL_KEY</code> está configurada no
            ambiente do servidor (Vercel → Production/Development) e se a
            cota diária da API-Football não foi excedida.
          </div>
        </div>
      </div>
    );
  }

  const { fixtures } = data;

  return (
    <div className="container mx-auto max-w-5xl py-8">
      <h1 className="mb-2 text-2xl font-bold">Football API Test</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Fixtures do Brasileirão via API-Football (server-side).
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Fixtures retornados"
          value={String(fixtures.length)}
        />
        <MetricCard label="Temporada" value="2026" />
        <MetricCard label="Liga" value="71 — Brasileirão Série A" />
      </div>

      {fixtures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum fixture retornado para essa temporada.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">Rodada</th>
                <th className="border-b px-3 py-2 text-left">Data</th>
                <th className="border-b px-3 py-2 text-left">Mandante</th>
                <th className="border-b px-3 py-2 text-left">Visitante</th>
                <th className="border-b px-3 py-2 text-left">Placar</th>
                <th className="border-b px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {fixtures.map((f) => (
                <tr key={f.fixtureId} className="odd:bg-background even:bg-muted/30">
                  <td className="border-b px-3 py-2">{f.round}</td>
                  <td className="border-b px-3 py-2">{formatDate(f.date)}</td>
                  <td className="border-b px-3 py-2">{f.homeTeamName}</td>
                  <td className="border-b px-3 py-2">{f.awayTeamName}</td>
                  <td className="border-b px-3 py-2">
                    {f.goalsHome ?? "–"} × {f.goalsAway ?? "–"}
                  </td>
                  <td className="border-b px-3 py-2" title={f.statusLong}>
                    {f.statusShort}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
