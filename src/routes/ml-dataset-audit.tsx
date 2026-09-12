// src/routes/ml-dataset-audit.tsx

import { createFileRoute } from "@tanstack/react-router";
import { auditBaselineVsDataset } from "@/lib/cartola/api.functions";
import type { AuditResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: AuditResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-dataset-audit")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await auditBaselineVsDataset({
        data: { firstRound: 5, lastRound: 26, participationWindow: 12 },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: MlDatasetAuditPage,
});

function MlDatasetAuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-6xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML Dataset Audit (temporário)
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { result } = data;
  const t = result.totals;

  return (
    <div className="container mx-auto max-w-6xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML Dataset Audit (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          Compara, por rodada, o universo do dataset (R{result.firstRound}–R
          {result.lastRound}) com o universo efetivamente previsto pelo
          baseline (janela = {result.participationWindow} participações). Página
          de diagnóstico — não integrada ao app.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Metric label="rowCount" value={t.rowCount} />
        <Metric label="datasetParticipations" value={t.datasetParticipations} />
        <Metric label="baselinePredictions" value={t.baselinePredictions} />
        <Metric
          label="diferença"
          value={t.difference}
          tone={t.difference === 0 ? "good" : "warn"}
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por rodada</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">dataset</th>
                <th className="border-b px-2 py-2 text-right">baseline</th>
                <th className="border-b px-2 py-2 text-right">diff</th>
                <th className="border-b px-2 py-2 text-right">
                  sem prior part.
                </th>
                <th className="border-b px-2 py-2 text-right">outros</th>
                <th className="border-b px-2 py-2 text-left">
                  distribuição de priorParticipated
                </th>
              </tr>
            </thead>
            <tbody>
              {result.perRound.map((r) => (
                <tr key={r.round}>
                  <td className="border-b px-2 py-1">R{r.round}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.datasetParticipations}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.baselinePredictions}
                  </td>
                  <td
                    className={`border-b px-2 py-1 text-right ${
                      r.difference > 0 ? "text-amber-700 font-semibold" : ""
                    }`}
                  >
                    {r.difference}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.exclusionReasons.noPriorParticipation}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.exclusionReasons.other}
                  </td>
                  <td className="border-b px-2 py-1 font-mono">
                    {Object.entries(r.priorParticipatedCountDistribution)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          "sem prior part." = linhas em que o jogador participou na rodada
          alvo, mas não tem NENHUMA participação anterior no histórico. É a
          única razão prevista pela lógica do baseline para retornar null.
          "outros" = caso residual (não deveria ocorrer).
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Amostra de jogadores excluídos (por rodada)
        </h2>
        <div className="space-y-4">
          {result.perRound
            .filter((r) => r.excludedSample.length > 0)
            .map((r) => (
              <details key={r.round} className="rounded border">
                <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
                  R{r.round} — {r.difference} exclusões ({r.excludedSample.length}{" "}
                  amostradas)
                </summary>
                <pre className="max-h-64 overflow-auto p-3 text-xs">
                  {JSON.stringify(r.excludedSample, null, 2)}
                </pre>
              </details>
            ))}
        </div>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. Não referenciada por menu nem por outras páginas.
      </footer>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "border-green-300 bg-green-50"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : "";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
