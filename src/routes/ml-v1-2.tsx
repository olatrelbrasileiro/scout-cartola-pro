// src/routes/ml-v1-2.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv1_2Comparison } from "@/lib/cartola/api.functions";
import type { MLv12ComparisonResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: MLv12ComparisonResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v1-2")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv1_2Comparison({
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
  component: MLv12Page,
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

function MLv12Page() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.2 — one-hot para clubId / opponentClubId
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { v1, v1_1, v1_2 } = data.result;

  const deltaMaeV12VsV11 =
    v1_2.overall.ml.mae !== null && v1_1.overall.ml.mae !== null
      ? v1_2.overall.ml.mae - v1_1.overall.ml.mae
      : null;
  const deltaRmseV12VsV11 =
    v1_2.overall.ml.rmse !== null && v1_1.overall.ml.rmse !== null
      ? v1_2.overall.ml.rmse - v1_1.overall.ml.rmse
      : null;
  const deltaPearsonV12VsV11 =
    v1_2.overall.ml.pearson !== null && v1_1.overall.ml.pearson !== null
      ? v1_2.overall.ml.pearson - v1_1.overall.ml.pearson
      : null;

  const byRoundV1 = new Map(v1.byRound.map((r) => [r.round, r]));
  const byRoundV11 = new Map(v1_1.byRound.map((r) => [r.round, r]));
  const byRoundV12 = new Map(v1_2.byRound.map((r) => [r.round, r]));
  const allRounds = Array.from(
    new Set([...byRoundV1.keys(), ...byRoundV11.keys(), ...byRoundV12.keys()]),
  ).sort((a, b) => a - b);

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.2 — one-hot temporal de clubId / opponentClubId
        </h1>
        <p className="text-sm text-muted-foreground">
          Única mudança em relação ao ML v1.1: <code>clubId</code> e{" "}
          <code>opponentClubId</code> deixam de ser numéricos e viram one-hot
          ajustado por fold temporal (vocabulário definido apenas com o
          treino daquela rodada; categoria de referência = menor id no
          treino; categorias desconhecidas no teste caem em all-zero).
          Ridge, λ=1, padronização, imputação, expanding window, universo e
          baseline inalterados. R5–R26, janela=12.
        </p>
      </header>

      <section>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card label="features (v1)" value={v1.config.featureNames.length} />
          <Card
            label="features (v1.1)"
            value={v1_1.config.featureNames.length}
          />
          <Card
            label="features (v1.2, última rodada)"
            value={v1_2.config.featureNames.length}
            tone="good"
          />
          <Card
            label="feature removida vs v1"
            value="points_avg_3_minus_avg_12"
          />
        </div>
      </section>

      {/* Auditoria do encoding */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Auditoria do one-hot temporal
        </h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          <Card
            label="features min (v1.2)"
            value={v1_2.audit.summary.minFinalFeatureCount}
          />
          <Card
            label="features max (v1.2)"
            value={v1_2.audit.summary.maxFinalFeatureCount}
          />
          <Card
            label="unknowns clubId (teste)"
            value={v1_2.audit.summary.totalUnknownClub}
            tone={v1_2.audit.summary.totalUnknownClub > 0 ? "warn" : "default"}
          />
          <Card
            label="unknowns opponentClubId (teste)"
            value={v1_2.audit.summary.totalUnknownOpponent}
            tone={
              v1_2.audit.summary.totalUnknownOpponent > 0 ? "warn" : "default"
            }
          />
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">
                  # cats clubId (treino)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  # cats opp (treino)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  cols one-hot (club)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  cols one-hot (opp)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  unk club (teste)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  unk opp (teste)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  # features final
                </th>
              </tr>
            </thead>
            <tbody>
              {v1_2.audit.byRound.map((a) => (
                <tr key={a.round} className={a.round === 6 ? "bg-amber-50" : ""}>
                  <td className="border-b px-2 py-1">R{a.round}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {a.trainClubCategories}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {a.trainOpponentCategories}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {Math.max(0, a.trainClubCategories - 1)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {Math.max(0, a.trainOpponentCategories - 1)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {a.unknownClubInTest}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {a.unknownOpponentInTest}
                  </td>
                  <td className="border-b px-2 py-1 text-right font-semibold">
                    {a.finalFeatureCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          "cols one-hot" = categorias do treino menos 1 (drop-one). Categoria
          de referência = menor id presente no treino. Categorias do teste
          que não estão no treino caem em vetor all-zero (equivalente à
          referência).
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
              <tr>
                <td className="border-b px-3 py-2 font-semibold">ML v1.1</td>
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
              <tr className="bg-green-50">
                <td className="border-b px-3 py-2 font-semibold">ML v1.2</td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_2.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.ml.pearson)}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">Baseline</td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_2.overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2.overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="Δ MAE (v1.2 − v1.1)"
            value={deltaMaeV12VsV11 === null ? "—" : deltaMaeV12VsV11.toFixed(4)}
            tone={
              deltaMaeV12VsV11 === null
                ? "default"
                : deltaMaeV12VsV11 < 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Δ RMSE (v1.2 − v1.1)"
            value={
              deltaRmseV12VsV11 === null ? "—" : deltaRmseV12VsV11.toFixed(4)
            }
            tone={
              deltaRmseV12VsV11 === null
                ? "default"
                : deltaRmseV12VsV11 < 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Δ Pearson (v1.2 − v1.1)"
            value={
              deltaPearsonV12VsV11 === null
                ? "—"
                : deltaPearsonV12VsV11.toFixed(4)
            }
            tone={
              deltaPearsonV12VsV11 === null
                ? "default"
                : deltaPearsonV12VsV11 > 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Melhoria MAE (v1.2 vs baseline)"
            value={pct(v1_2.overall.maeImprovementPct)}
            tone={
              v1_2.overall.maeImprovementPct !== null &&
              v1_2.overall.maeImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria RMSE (v1.2 vs baseline)"
            value={pct(v1_2.overall.rmseImprovementPct)}
            tone={
              v1_2.overall.rmseImprovementPct !== null &&
              v1_2.overall.rmseImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria MAE (v1.1 vs baseline)"
            value={pct(v1_1.overall.maeImprovementPct)}
          />
        </div>
      </section>

      {/* Por rodada */}
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
                <th className="border-b px-2 py-2 text-right">v1.2 MAE</th>
                <th className="border-b px-2 py-2 text-right">Δ v1.2-v1.1</th>
                <th className="border-b px-2 py-2 text-right">v1 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v1.1 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v1.2 RMSE</th>
                <th className="border-b px-2 py-2 text-right">Δ v1.2-v1.1</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
              </tr>
            </thead>
            <tbody>
              {allRounds
                .filter((r) => r >= 6)
                .map((R) => {
                  const a = byRoundV1.get(R);
                  const b = byRoundV11.get(R);
                  const c = byRoundV12.get(R);
                  const n = c?.ml.count ?? b?.ml.count ?? a?.ml.count ?? 0;
                  const dMae =
                    c?.ml.mae != null && b?.ml.mae != null
                      ? c.ml.mae - b.ml.mae
                      : null;
                  const dRmse =
                    c?.ml.rmse != null && b?.ml.rmse != null
                      ? c.ml.rmse - b.ml.rmse
                      : null;
                  return (
                    <tr key={R} className={R === 6 ? "bg-amber-50" : ""}>
                      <td className="border-b px-2 py-1 font-semibold">R{R}</td>
                      <td className="border-b px-2 py-1 text-right">{n}</td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(a?.ml.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(b?.ml.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(c?.ml.mae ?? null, 3)}
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
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(c?.ml.rmse ?? null, 3)}
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
                        {fmt(c?.baseline.mae ?? null, 3)}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {fmt(c?.baseline.rmse ?? null, 3)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Linha R6 destacada em âmbar por ter sido o caso anômalo do ML v1.
          Sem correção específica — apenas observação.
        </p>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária de experimento. Não referenciada por menu nem por
        outras páginas. /ml-v1, /ml-v1-1 e /ml-r6-audit permanecem intocados.
      </footer>
    </div>
  );
}
