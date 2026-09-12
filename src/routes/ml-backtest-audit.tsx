// src/routes/ml-backtest-audit.tsx

import { createFileRoute } from "@tanstack/react-router";
import { auditBacktestUniverseDifference } from "@/lib/cartola/api.functions";
import type { BacktestDiffResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: BacktestDiffResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-backtest-audit")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await auditBacktestUniverseDifference({
        data: { firstRound: 5, lastRound: 26, participationWindow: 12 },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: MlBacktestAuditPage,
});

function Card({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const cls =
    tone === "good"
      ? "border-green-300 bg-green-50"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : tone === "bad"
          ? "border-red-300 bg-red-50"
          : "";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function MlBacktestAuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          Backtest Universe Audit (temporário)
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const r = data.result;

  return (
    <div className="container mx-auto max-w-5xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          Backtest Universe Audit (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          R{r.firstRound}–R{r.lastRound}, janela = {r.participationWindow}{" "}
          participações. Replica exatamente o universo de{" "}
          <code>runHistoricalBacktest</code> e compara com o universo de{" "}
          <code>auditBaselineVsDataset</code>.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="datasetParticipations" value={r.datasetParticipations} />
        <Card label="baselinePredictions" value={r.baselinePredictions} />
        <Card
          label="officialBacktestPredictions"
          value={r.officialBacktestPredictions}
          tone="good"
        />
        <Card
          label="diferença (baseline − official)"
          value={r.difference}
          tone={r.difference === 0 ? "good" : "bad"}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Exclusões por motivo</h2>
        {r.exclusionsByReason.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma exclusão — universos são idênticos.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-3 py-2 text-left">reason</th>
                  <th className="border-b px-3 py-2 text-right">count</th>
                </tr>
              </thead>
              <tbody>
                {r.exclusionsByReason.map((x) => (
                  <tr key={x.reason}>
                    <td className="border-b px-3 py-2 font-mono">
                      {x.reason}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {x.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Exclusões por rodada</h2>
        {r.exclusionsByRound.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma exclusão.</p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-3 py-2 text-left">R</th>
                  <th className="border-b px-3 py-2 text-right">count</th>
                </tr>
              </thead>
              <tbody>
                {r.exclusionsByRound.map((x) => (
                  <tr key={x.round}>
                    <td className="border-b px-3 py-2">R{x.round}</td>
                    <td className="border-b px-3 py-2 text-right">
                      {x.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="rounded border">
        <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
          Amostra de exclusões ({r.sampleExclusions.length})
        </summary>
        <pre className="max-h-96 overflow-auto p-3 text-xs">
          {JSON.stringify(r.sampleExclusions, null, 2)}
        </pre>
      </details>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. Não referenciada por menu nem por outras páginas.
      </footer>
    </div>
  );
}
