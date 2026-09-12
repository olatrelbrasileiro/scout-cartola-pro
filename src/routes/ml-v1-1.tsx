// src/routes/ml-v1-1.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv1_1Comparison } from "@/lib/cartola/api.functions";
import type { MLv1ComparisonResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: MLv1ComparisonResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v1-1")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv1_1Comparison({
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
  component: MLv11Page,
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

function MLv11Page() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.1 (temporário) — sem points_avg_3_minus_avg_12
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { v1, v1_1, excludedFeature } = data.result;

  const cfg = v1_1.config;

  // Diferenças entre v1 e v1.1
  const deltaMae =
    v1.overall.ml.mae !== null && v1_1.overall.ml.mae !== null
      ? v1_1.overall.ml.mae - v1.overall.ml.mae
      : null;
  const deltaRmse =
    v1.overall.ml.rmse !== null && v1_1.overall.ml.rmse !== null
      ? v1_1.overall.ml.rmse - v1.overall.ml.rmse
      : null;
  const deltaPearson =
    v1.overall.ml.pearson !== null && v1_1.overall.ml.pearson !== null
      ? v1_1.overall.ml.pearson - v1.overall.ml.pearson
      : null;

  // Melhoria de v1.1 sobre o baseline
  const mlMae = v1_1.overall.ml.mae;
  const blMae = v1_1.overall.baseline.mae;
  const mlRmse = v1_1.overall.ml.rmse;
  const blRmse = v1_1.overall.baseline.rmse;

  const maeImprovementPct =
    mlMae !== null && blMae !== null && blMae > 0
      ? ((blMae - mlMae) / blMae) * 100
      : null;
  const rmseImprovementPct =
    mlRmse !== null && blRmse !== null && blRmse > 0
      ? ((blRmse - mlRmse) / blRmse) * 100
      : null;

  // Mapa de rodadas para pareamento por R
  const v1ByRound = new Map(v1.byRound.map((r) => [r.round, r]));
  const v11ByRound = new Map(v1_1.byRound.map((r) => [r.round, r]));
  const allRounds = Array.from(
    new Set([...v1ByRound.keys(), ...v11ByRound.keys()]),
  ).sort((a, b) => a - b);

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.1 — experimento controlado
        </h1>
        <p className="text-sm text-muted-foreground">
          Idêntico ao ML v1 <strong>exceto</strong> pela remoção da feature{" "}
          <code>{excludedFeature}</code>. Ridge, λ, padronização, imputação,
          expanding window, universo de teste e baseline inalterados. R
          {cfg.firstRound}–R{cfg.lastRound}, janela ={" "}
          {cfg.participationWindow}, λ = {cfg.lambda}.
        </p>
      </header>

      {/* Feature count + lista */}
      <section>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="features (v1)"
            value={v1.config.featureNames.length}
          />
          <Card
            label="features (v1.1)"
            value={v1_1.config.featureNames.length}
            tone="good"
          />
          <Card
            label="feature removida"
            value={excludedFeature}
          />
        </div>
        <details className="rounded border">
          <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
            featureNames do v1.1 ({v1_1.config.featureNames.length})
          </summary>
          <div className="flex flex-wrap gap-2 p-3">
            {v1_1.config.featureNames.map((f) => (
              <span
                key={f}
                className="rounded border bg-muted px-2 py-1 font-mono text-xs"
              >
                {f}
              </span>
            ))}
          </div>
        </details>
      </section>

      {/* Métricas gerais: v1 vs v1.1 vs baseline */}
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
                  {v1.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1.overall.ml.pearson)}
                </td>
              </tr>
              <tr className="bg-green-50">
                <td className="border-b px-3 py-2 font-semibold">
                  ML v1.1 (sem {excludedFeature})
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_1.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.ml.pearson)}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">
                  Baseline
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_1.overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_1.overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="Δ MAE (v1.1 − v1)"
            value={deltaMae === null ? "—" : deltaMae.toFixed(4)}
            tone={deltaMae === null ? "default" : deltaMae < 0 ? "good" : "bad"}
          />
          <Card
            label="Δ RMSE (v1.1 − v1)"
            value={deltaRmse === null ? "—" : deltaRmse.toFixed(4)}
            tone={
              deltaRmse === null ? "default" : deltaRmse < 0 ? "good" : "bad"
            }
          />
          <Card
            label="Δ Pearson (v1.1 − v1)"
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
            label="Melhoria v1.1 MAE vs baseline"
            value={pct(maeImprovementPct)}
            tone={
              maeImprovementPct !== null && maeImprovementPct > 0
                ? "good"
                : maeImprovementPct !== null
                  ? "bad"
                  : "default"
            }
          />
          <Card
            label="Melhoria v1.1 RMSE vs baseline"
            value={pct(rmseImprovementPct)}
            tone={
              rmseImprovementPct !== null && rmseImprovementPct > 0
                ? "good"
                : rmseImprovementPct !== null
                  ? "bad"
                  : "default"
            }
          />
          <Card
            label="Melhoria v1 MAE vs baseline"
            value={pct(v1.overall.maeImprovementPct)}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Δ negativo em MAE/RMSE = v1.1 melhor que v1. Δ positivo em Pearson =
          v1.1 melhor que v1. Negrito/verde marca melhora; vermelho marca
          piora.
        </p>
      </section>

      {/* Por rodada R6–R26 */}
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
                <th className="border-b px-2 py-2 text-right">v1 MAE</th>
                <th className="border-b px-2 py-2 text-right">v1.1 MAE</th>
                <th className="border-b px-2 py-2 text-right">Δ MAE</th>
                <th className="border-b px-2 py-2 text-right">v1 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v1.1 RMSE</th>
                <th className="border-b px-2 py-2 text-right">Δ RMSE</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
              </tr>
            </thead>
            <tbody>
              {allRounds
                .filter((r) => r >= 6)
                .map((R) => {
                  const a = v1ByRound.get(R);
                  const b = v11ByRound.get(R);
                  const n = b?.ml.count ?? a?.ml.count ?? 0;
                  const dMae =
                    a?.ml.mae !== null &&
                    a?.ml.mae !== undefined &&
                    b?.ml.mae !== null &&
                    b?.ml.mae !== undefined
                      ? b.ml.mae - a.ml.mae
                      : null;
                  const dRmse =
                    a?.ml.rmse !== null &&
                    a?.ml.rmse !== undefined &&
                    b?.ml.rmse !== null &&
                    b?.ml.rmse !== undefined
                      ? b.ml.rmse - a.ml.rmse
                      : null;
                  return (
                    <tr key={R}>
                      <td className="border-b px-2 py-1">R{R}</td>
                      <td className="border-b px-2 py-1 text-right">{n}</td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(a?.ml.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.mae ?? null, 3)}
                      </td>
                      <td
                        className={`border-b px-2 py-1 text-right font-semibold ${
                          dMae !== null
                            ? dMae < 0
                              ? "text-green-700"
                              : dMae > 0
                                ? "text-red-700"
                                : ""
                            : ""
                        }`}
                      >
                        {dMae === null ? "—" : dMae.toFixed(3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(a?.ml.rmse ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.rmse ?? null, 3)}
                      </td>
                      <td
                        className={`border-b px-2 py-1 text-right font-semibold ${
                          dRmse !== null
                            ? dRmse < 0
                              ? "text-green-700"
                              : dRmse > 0
                                ? "text-red-700"
                                : ""
                            : ""
                        }`}
                      >
                        {dRmse === null ? "—" : dRmse.toFixed(3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.baseline.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.baseline.rmse ?? null, 3)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Verde = v1.1 melhor que v1 naquela rodada; vermelho = pior. R6
          destacada por ser o caso onde o v1 teve comportamento anômalo.
        </p>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária de experimento. Não referenciada por menu nem por
        outras páginas. /ml-v1 e /ml-r6-audit permanecem intocados.
      </footer>
    </div>
  );
}
