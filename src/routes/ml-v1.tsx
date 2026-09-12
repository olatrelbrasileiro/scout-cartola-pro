// src/routes/ml-v1.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv1Evaluation } from "@/lib/cartola/api.functions";
import type { MLv1Result } from "@/lib/ml/model.types";

type LoaderData =
  | { ok: true; result: MLv1Result }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v1")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv1Evaluation({
        data: {
          firstRound: 5,
          lastRound: 26,
          participationWindow: 12,
          lambda: 1.0,
        },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: MLv1Page,
});

function fmt(v: number | null, digits = 4): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

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

function MLv1Page() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-6xl py-8">
        <h1 className="mb-2 text-2xl font-bold">ML v1 (temporário)</h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { result } = data;
  const { config, overall, byRound } = result;

  return (
    <div className="container mx-auto max-w-6xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">ML v1 — Ridge Regression</h1>
        <p className="text-sm text-muted-foreground">
          Validação temporal expanding window. Para cada rodada R, treino =
          rodadas &lt; R, teste = R (mesmo universo do baseline). R
          {config.firstRound}–R{config.lastRound}, janela ={" "}
          {config.participationWindow}, λ = {config.lambda}.
        </p>
      </header>

      {/* Configuração */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Configuração do modelo</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card label="modelo" value="Ridge Regression (L2)" />
          <Card label="lambda" value={config.lambda} />
          <Card
            label="features"
            value={config.featureNames.length}
          />
          <Card label="validação" value="expanding window" />
        </div>
        <details className="mt-3 rounded border">
          <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
            featureNames ({config.featureNames.length})
          </summary>
          <div className="flex flex-wrap gap-2 p-3">
            {config.featureNames.map((f) => (
              <span
                key={f}
                className="rounded border bg-muted px-2 py-1 font-mono text-xs"
              >
                {f}
              </span>
            ))}
          </div>
        </details>
        <p className="mt-2 text-xs text-muted-foreground">
          Nota: <code>clubId</code> e <code>position</code> são features
          UNKNOWN na auditoria de proveniência (vêm de payload pós-rodada).
          Mantidas por decisão explícita do projeto.
        </p>
      </section>

      {/* Métricas gerais */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Métricas gerais</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">Modelo</th>
                <th className="border-b px-3 py-2 text-right">predictions</th>
                <th className="border-b px-3 py-2 text-right">MAE</th>
                <th className="border-b px-3 py-2 text-right">RMSE</th>
                <th className="border-b px-3 py-2 text-right">Pearson</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">ML v1</td>
                <td className="border-b px-3 py-2 text-right">
                  {overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.ml.pearson)}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">
                  Baseline
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card
            label="Melhoria MAE"
            value={
              overall.maeImprovementPct !== null
                ? `${overall.maeImprovementPct.toFixed(2)}%`
                : "—"
            }
            tone={
              overall.maeImprovementPct !== null &&
              overall.maeImprovementPct > 0
                ? "good"
                : overall.maeImprovementPct !== null
                  ? "bad"
                  : "default"
            }
          />
          <Card
            label="Melhoria RMSE"
            value={
              overall.rmseImprovementPct !== null
                ? `${overall.rmseImprovementPct.toFixed(2)}%`
                : "—"
            }
            tone={
              overall.rmseImprovementPct !== null &&
              overall.rmseImprovementPct > 0
                ? "good"
                : overall.rmseImprovementPct !== null
                  ? "bad"
                  : "default"
            }
          />
        </div>
      </section>

      {/* Por rodada */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Métricas por rodada</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">n</th>
                <th className="border-b px-2 py-2 text-right">ML MAE</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">ML RMSE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
                <th className="border-b px-2 py-2 text-right">ML r</th>
                <th className="border-b px-2 py-2 text-right">BL r</th>
              </tr>
            </thead>
            <tbody>
              {byRound.map((r) => (
                <tr key={r.round}>
                  <td className="border-b px-2 py-1">R{r.round}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.ml.count}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.ml.mae, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.baseline.mae, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.ml.rmse, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.baseline.rmse, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.ml.pearson, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(r.baseline.pearson, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. Não referenciada por menu nem por outras páginas.
      </footer>
    </div>
  );
}
