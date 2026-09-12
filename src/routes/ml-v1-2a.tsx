// src/routes/ml-v1-2a.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv1_2aComparison } from "@/lib/cartola/api.functions";
import type { MLv12aComparisonResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: MLv12aComparisonResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v1-2a")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv1_2aComparison({
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
  component: MLv12aPage,
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

function MLv12aPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.2a — UNKNOWN explícito
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { v1_2, v1_2a } = data.result;

  const deltaMae =
    v1_2a.overall.ml.mae !== null && v1_2.overall.ml.mae !== null
      ? v1_2a.overall.ml.mae - v1_2.overall.ml.mae
      : null;
  const deltaRmse =
    v1_2a.overall.ml.rmse !== null && v1_2.overall.ml.rmse !== null
      ? v1_2a.overall.ml.rmse - v1_2.overall.ml.rmse
      : null;
  const deltaPearson =
    v1_2a.overall.ml.pearson !== null && v1_2.overall.ml.pearson !== null
      ? v1_2a.overall.ml.pearson - v1_2.overall.ml.pearson
      : null;

  const byRoundV12 = new Map(v1_2.byRound.map((r) => [r.round, r]));
  const byRoundV12a = new Map(v1_2a.byRound.map((r) => [r.round, r]));
  const allRounds = Array.from(
    new Set([...byRoundV12.keys(), ...byRoundV12a.keys()]),
  ).sort((a, b) => a - b);

  const v = v1_2a.verification;
  const checks: Array<[string, boolean]> = [
    ["featureCountEqualsV12Plus2", v.featureCountEqualsV12Plus2],
    ["unknownClubActivatesUnknown", v.unknownClubActivatesUnknown],
    ["unknownClubNeverActivatesKnown", v.unknownClubNeverActivatesKnown],
    ["knownReferenceNeverActivatesUnknown", v.knownReferenceNeverActivatesUnknown],
    ["knownNonRefNeverActivatesUnknown", v.knownNonRefNeverActivatesUnknown],
    ["unknownOppActivatesUnknown", v.unknownOppActivatesUnknown],
    ["unknownOppNeverActivatesKnown", v.unknownOppNeverActivatesKnown],
    [
      "knownOppReferenceNeverActivatesUnknown",
      v.knownOppReferenceNeverActivatesUnknown,
    ],
    [
      "knownOppNonRefNeverActivatesUnknown",
      v.knownOppNonRefNeverActivatesUnknown,
    ],
  ];

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML v1.2a — UNKNOWN explícito para clubId / opponentClubId
        </h1>
        <p className="text-sm text-muted-foreground">
          Única mudança em relação ao ML v1.2: UNKNOWN/null em{" "}
          <code>clubId</code> e <code>opponentClubId</code> deixa de virar
          all-zero (que coincide com a referência) e passa a ativar uma
          coluna <code>UNKNOWN</code> dedicada. Ridge, λ=1, padronização,
          imputação, expanding window, universo, features numéricas e one-hot
          de posição inalterados. R5–R26, janela=12.
        </p>
      </header>

      {/* Verificação estrutural */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Verificação estrutural</h2>
        <div
          className={`mb-3 rounded border p-3 ${
            v.ok
              ? "border-green-300 bg-green-50"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="font-semibold">
            {v.ok ? "Todas as checagens passaram" : "Falha em checagem"}
          </div>
          <div className="mt-1 text-xs">
            rows verificadas: {v.totalRowsChecked}
            {v.failures.length > 0 && ` · failures: ${v.failures.length}`}
          </div>
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">check</th>
                <th className="border-b px-3 py-2 text-right">resultado</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(([name, ok]) => (
                <tr key={name}>
                  <td className="border-b px-3 py-2 font-mono">{name}</td>
                  <td
                    className={`border-b px-3 py-2 text-right font-semibold ${
                      ok ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {ok ? "OK" : "FAIL"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.failures.length > 0 && (
          <details className="mt-2 rounded border">
            <summary className="cursor-pointer bg-muted px-3 py-2 text-xs">
              failures ({v.failures.length})
            </summary>
            <pre className="max-h-64 overflow-auto p-3 text-xs">
              {v.failures.join("\n")}
            </pre>
          </details>
        )}
      </section>

      {/* Auditoria de categorias */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Auditoria por rodada (v1.2a)
        </h2>
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          <Card
            label="features min"
            value={v1_2a.audit.summary.minFinalFeatureCount}
          />
          <Card
            label="features max"
            value={v1_2a.audit.summary.maxFinalFeatureCount}
          />
          <Card
            label="total UNKNOWN club"
            value={v1_2a.audit.summary.totalUnknownClub}
          />
          <Card
            label="total UNKNOWN opp"
            value={v1_2a.audit.summary.totalUnknownOpponent}
          />
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">
                  # cat club (treino)
                </th>
                <th className="border-b px-2 py-2 text-right">
                  # cat opp (treino)
                </th>
                <th className="border-b px-2 py-2 text-right">unk club</th>
                <th className="border-b px-2 py-2 text-right">unk opp</th>
                <th className="border-b px-2 py-2 text-right">
                  v1.2 features
                </th>
                <th className="border-b px-2 py-2 text-right">
                  v1.2a features
                </th>
                <th className="border-b px-2 py-2 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {v1_2a.audit.byRound.map((a, i) => {
                const b = v1_2.audit.byRound[i];
                const d =
                  b !== undefined ? a.finalFeatureCount - b.finalFeatureCount : null;
                return (
                  <tr key={a.round} className={a.round === 6 ? "bg-amber-50" : ""}>
                    <td className="border-b px-2 py-1">R{a.round}</td>
                    <td className="border-b px-2 py-1 text-right">
                      {a.trainClubCategories}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {a.trainOpponentCategories}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {a.unknownClubInTest}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {a.unknownOpponentInTest}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {b?.finalFeatureCount ?? "—"}
                    </td>
                    <td className="border-b px-2 py-1 text-right font-semibold">
                      {a.finalFeatureCount}
                    </td>
                    <td
                      className={`border-b px-2 py-1 text-right font-semibold ${
                        d === null ? "" : d === 2 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {d === null ? "—" : d >= 0 ? `+${d}` : d}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
              <tr className="bg-green-50">
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
              <tr>
                <td className="border-b px-3 py-2 font-semibold">Baseline</td>
                <td className="border-b px-3 py-2 text-right">
                  {v1_2a.overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v1_2a.overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="Δ MAE (v1.2a − v1.2)"
            value={deltaMae === null ? "—" : deltaMae.toFixed(4)}
            tone={deltaMae === null ? "default" : deltaMae < 0 ? "good" : "bad"}
          />
          <Card
            label="Δ RMSE (v1.2a − v1.2)"
            value={deltaRmse === null ? "—" : deltaRmse.toFixed(4)}
            tone={deltaRmse === null ? "default" : deltaRmse < 0 ? "good" : "bad"}
          />
          <Card
            label="Δ Pearson (v1.2a − v1.2)"
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
            label="Melhoria MAE (v1.2a vs baseline)"
            value={pct(v1_2a.overall.maeImprovementPct)}
            tone={
              v1_2a.overall.maeImprovementPct !== null &&
              v1_2a.overall.maeImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria RMSE (v1.2a vs baseline)"
            value={pct(v1_2a.overall.rmseImprovementPct)}
            tone={
              v1_2a.overall.rmseImprovementPct !== null &&
              v1_2a.overall.rmseImprovementPct > 0
                ? "good"
                : "bad"
            }
          />
          <Card
            label="Melhoria MAE (v1.2 vs baseline)"
            value={pct(v1_2.overall.maeImprovementPct)}
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
                <th className="border-b px-2 py-2 text-right">v1.2 MAE</th>
                <th className="border-b px-2 py-2 text-right">v1.2a MAE</th>
                <th className="border-b px-2 py-2 text-right">Δ MAE</th>
                <th className="border-b px-2 py-2 text-right">v1.2 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v1.2a RMSE</th>
                <th className="border-b px-2 py-2 text-right">Δ RMSE</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
              </tr>
            </thead>
            <tbody>
              {allRounds
                .filter((r) => r >= 6)
                .map((R) => {
                  const a = byRoundV12.get(R);
                  const b = byRoundV12a.get(R);
                  const n = b?.ml.count ?? a?.ml.count ?? 0;
                  const dMae =
                    b?.ml.mae != null && a?.ml.mae != null
                      ? b.ml.mae - a.ml.mae
                      : null;
                  const dRmse =
                    b?.ml.rmse != null && a?.ml.rmse != null
                      ? b.ml.rmse - a.ml.rmse
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
          R6 destacada em âmbar. Verde = v1.2a melhor; vermelho = pior.
        </p>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota de experimento. /ml-v1, /ml-v1-1, /ml-v1-2 e /ml-r6-audit
        permanecem intocados.
      </footer>
    </div>
  );
}
