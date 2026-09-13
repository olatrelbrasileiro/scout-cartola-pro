// src/routes/ml-v2.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv2Comparison } from "@/lib/cartola/api.functions";
import type { MLv2ComparisonResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: MLv2ComparisonResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v2")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv2Comparison({
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
  component: MLv2Page,
});

function fmt(v: number | null, d = 4): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

function pct(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
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

function MLv2Page() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML v2 — v1.2a + histórico de scouts
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { v1_2a, v2 } = data.result;

  const deltaMae =
    v2.overall.ml.mae !== null && v1_2a.overall.ml.mae !== null
      ? v2.overall.ml.mae - v1_2a.overall.ml.mae
      : null;
  const deltaRmse =
    v2.overall.ml.rmse !== null && v1_2a.overall.ml.rmse !== null
      ? v2.overall.ml.rmse - v1_2a.overall.ml.rmse
      : null;
  const deltaPearson =
    v2.overall.ml.pearson !== null && v1_2a.overall.ml.pearson !== null
      ? v2.overall.ml.pearson - v1_2a.overall.ml.pearson
      : null;

  // Conclusão automática
  let conclusion = "PRATICAMENTE IGUAL";
  let conclusionTone: "good" | "warn" | "bad" = "warn";
  if (deltaMae !== null) {
    if (deltaMae <= -0.01) {
      conclusion = "MELHOROU";
      conclusionTone = "good";
    } else if (deltaMae >= 0.01) {
      conclusion = "PIOROU";
      conclusionTone = "bad";
    }
  }

  const byRoundV12a = new Map(v1_2a.byRound.map((r) => [r.round, r]));
  const byRoundV2 = new Map(v2.byRound.map((r) => [r.round, r]));
  const allRounds = Array.from(
    new Set([...byRoundV12a.keys(), ...byRoundV2.keys()]),
  ).sort((a, b) => a - b);

  const sv = v2.scoutVerification;
  const cv = v2.verification;

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML v2 — v1.2a + features históricas de scouts
        </h1>
        <p className="text-sm text-muted-foreground">
          Idêntico à v1.2a em Ridge, λ=1, padronização, imputação, expanding
          window, universo, baseline e categorias (UNKNOWN explícito).
          Adiciona {v2.scoutFeatureNames.length} features de scout (18 scouts
          × 7 agregados: avg_3, avg_5, avg_12, std_5, std_12, min_5, max_5),
          calculadas só com rounds &lt; R e participação real.
        </p>
      </header>

      {/* Conclusão */}
      <section
        className={`rounded border p-4 ${
          conclusionTone === "good"
            ? "border-green-300 bg-green-50"
            : conclusionTone === "bad"
              ? "border-red-300 bg-red-50"
              : "border-amber-300 bg-amber-50"
        }`}
      >
        <div className="text-xs uppercase text-muted-foreground">
          Conclusão automática
        </div>
        <div className="text-2xl font-bold">{conclusion}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Δ MAE (v2 − v1.2a) = {deltaMae === null ? "—" : deltaMae.toFixed(4)} ·
          threshold ±0.01
        </div>
      </section>

      {/* Contagens de features */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Card
          label="v1.2a features (base)"
          value={sv.totalBaseFeatures}
        />
        <Card label="v2 features (scouts)" value={sv.totalScoutFeatures} />
        <Card
          label="v2 features final"
          value={sv.totalFinalFeatures}
          tone="good"
        />
        <Card label="scouts usados" value={v2.scoutCoverage.length} />
      </section>

      {/* Verificação */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Verificação estrutural</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card
            label="Categorias (v1.2a checks)"
            value={cv.ok ? "OK" : "FAIL"}
            tone={cv.ok ? "good" : "bad"}
          />
          <Card
            label="Scouts só usam round < R"
            value={sv.scoutFeaturesUseOnlyPriorRounds ? "OK" : "FAIL"}
            tone={sv.scoutFeaturesUseOnlyPriorRounds ? "good" : "bad"}
          />
          <Card
            label="Base v1.2a preservada"
            value={sv.v12aBasePreserved ? "OK" : "FAIL"}
            tone={sv.v12aBasePreserved ? "good" : "bad"}
          />
          <Card label="rows verificadas" value={sv.totalRowsChecked} />
          <Card
            label="noTargetPointsUsed"
            value={sv.noTargetPointsUsed ? "OK" : "FAIL"}
            tone={sv.noTargetPointsUsed ? "good" : "bad"}
          />
          <Card
            label="failures"
            value={sv.failures.length + cv.failures.length}
            tone={
              sv.failures.length + cv.failures.length === 0 ? "good" : "bad"
            }
          />
        </div>
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
                <td className="border-b px-3 py-2 font-semibold">ML v1.2a</td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_2a.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.ml.pearson)}
                </td>
              </tr>
              <tr className="bg-green-50">
                <td className="border-b px-3 py-2 font-semibold">ML v2</td>
                <td className="border-b px-3 py-2 text-right">
                  {v2.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.ml.pearson)}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">Baseline</td>
                <td className="border-b px-3 py-2 text-right">
                  {v2.overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2.overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="Δ MAE (v2 − v1.2a)"
            value={deltaMae === null ? "—" : deltaMae.toFixed(4)}
            tone={deltaMae === null ? "default" : deltaMae < 0 ? "good" : "bad"}
          />
          <Card
            label="Δ RMSE (v2 − v1.2a)"
            value={deltaRmse === null ? "—" : deltaRmse.toFixed(4)}
            tone={deltaRmse === null ? "default" : deltaRmse < 0 ? "good" : "bad"}
          />
          <Card
            label="Δ Pearson (v2 − v1.2a)"
            value={deltaPearson === null ? "—" : deltaPearson.toFixed(4)}
            tone={
              deltaPearson === null
                ? "default"
                : deltaPearson > 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Melhoria MAE (v2 vs baseline)"
            value={pct(v2.overall.maeImprovementPct)}
            tone={
              v2.overall.maeImprovementPct !== null &&
              v2.overall.maeImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria RMSE (v2 vs baseline)"
            value={pct(v2.overall.rmseImprovementPct)}
            tone={
              v2.overall.rmseImprovementPct !== null &&
              v2.overall.rmseImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria MAE (v1.2a vs baseline)"
            value={pct(v1_2a.overall.maeImprovementPct)}
          />
        </div>
      </section>

      {/* Métricas por rodada */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Métricas por rodada (R6–R26)
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">n</th>
                <th className="border-b px-2 py-2 text-right">v2 MAE</th>
                <th className="border-b px-2 py-2 text-right">v2 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v2 r</th>
                <th className="border-b px-2 py-2 text-right">v1.2a MAE</th>
                <th className="border-b px-2 py-2 text-right">v1.2a RMSE</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
                <th className="border-b px-2 py-2 text-right">ΔMAE</th>
              </tr>
            </thead>
            <tbody>
              {allRounds
                .filter((r) => r >= 6)
                .map((R) => {
                  const a = byRoundV12a.get(R);
                  const b = byRoundV2.get(R);
                  const d =
                    b?.ml.mae != null && a?.ml.mae != null
                      ? b.ml.mae - a.ml.mae
                      : null;
                  return (
                    <tr key={R} className={R === 6 ? "bg-amber-50" : ""}>
                      <td className="border-b px-2 py-1 font-semibold">R{R}</td>
                      <td className="border-b px-2 py-1 text-right">
                        {b?.ml.count ?? a?.ml.count ?? 0}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.rmse ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.pearson ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(a?.ml.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(a?.ml.rmse ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.baseline.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.baseline.rmse ?? null, 3)}
                      </td>
                      <td
                        className={`border-b px-2 py-1 text-right font-semibold ${
                          d === null
                            ? ""
                            : d < 0
                              ? "text-green-700"
                              : d > 0
                                ? "text-red-700"
                                : ""
                        }`}
                      >
                        {d === null ? "—" : d.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cobertura por scout */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Cobertura por scout (universo de teste)
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">#feats</th>
                <th className="border-b px-2 py-2 text-right">
                  rows c/ algum valor
                </th>
                <th className="border-b px-2 py-2 text-right">não-null</th>
                <th className="border-b px-2 py-2 text-right">null</th>
                <th className="border-b px-2 py-2 text-right">zero</th>
                <th className="border-b px-2 py-2 text-right">não-zero</th>
              </tr>
            </thead>
            <tbody>
              {v2.scoutCoverage.map((s) => (
                <tr key={s.scout}>
                  <td className="border-b px-2 py-1 font-mono">{s.scout}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.featureCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.rowsWithAnyNonNull}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.totalNonNullValues}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.totalNullValues}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.totalZeroValues}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.totalNonZeroValues}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lista completa de features de scout */}
      <section>
        <details className="rounded border">
          <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
            Lista completa de scout features ({v2.scoutFeatureNames.length})
          </summary>
          <div className="flex flex-wrap gap-1 p-3">
            {v2.scoutFeatureNames.map((f) => (
              <span
                key={f}
                className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
              >
                {f}
              </span>
            ))}
          </div>
        </details>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. /ml-v1, /ml-v1-1, /ml-v1-2, /ml-v1-2a e /ml-r6-audit
        permanecem intocados.
      </footer>
    </div>
  );
}
