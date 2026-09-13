// src/routes/ml-v2-1.tsx

import { createFileRoute } from "@tanstack/react-router";
import { runMLv2_1Comparison } from "@/lib/cartola/api.functions";
import type { MLv21ComparisonResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: MLv21ComparisonResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-v2-1")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runMLv2_1Comparison({
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
  component: MLv21Page,
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
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function MLv21Page() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">ML v2.1</h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const { v1_2a, v2_1, deInspection } = data.result;

  const dMaeV21V12a =
    v2_1.overall.ml.mae !== null && v1_2a.overall.ml.mae !== null
      ? v2_1.overall.ml.mae - v1_2a.overall.ml.mae
      : null;
  const dRmseV21V12a =
    v2_1.overall.ml.rmse !== null && v1_2a.overall.ml.rmse !== null
      ? v2_1.overall.ml.rmse - v1_2a.overall.ml.rmse
      : null;
  const dPearsonV21V12a =
    v2_1.overall.ml.pearson !== null && v1_2a.overall.ml.pearson !== null
      ? v2_1.overall.ml.pearson - v1_2a.overall.ml.pearson
      : null;

  const dMaeV21Bl =
    v2_1.overall.ml.mae !== null && v2_1.overall.baseline.mae !== null
      ? v2_1.overall.ml.mae - v2_1.overall.baseline.mae
      : null;
  const dRmseV21Bl =
    v2_1.overall.ml.rmse !== null && v2_1.overall.baseline.rmse !== null
      ? v2_1.overall.ml.rmse - v2_1.overall.baseline.rmse
      : null;
  const dPearsonV21Bl =
    v2_1.overall.ml.pearson !== null && v2_1.overall.baseline.pearson !== null
      ? v2_1.overall.ml.pearson - v2_1.overall.baseline.pearson
      : null;

  const byRoundV12a = new Map(v1_2a.byRound.map((r) => [r.round, r]));
  const byRoundV21 = new Map(v2_1.byRound.map((r) => [r.round, r]));
  const allRounds = Array.from(
    new Set([...byRoundV12a.keys(), ...byRoundV21.keys()]),
  ).sort((a, b) => a - b);

  const sv = v2_1.scoutVerification;
  const cv = v2_1.verification;

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML v2.1 — v1.2a + 10 scouts × 4 agregados
        </h1>
        <p className="text-sm text-muted-foreground">
          10 scouts (<code>G, A, DE, SG, DS, FF, FT, FD, FC, FS</code>) × 4
          agregados (<code>total, avg_per_match, last5_total,
          last5_avg_per_match</code>) = 40 features. Ridge, λ=1, padronização,
          imputação, expanding window, universo, baseline, categorias e
          UNKNOWN inalterados em relação à v1.2a. R5–R26, janela=12.
        </p>
      </header>

      {/* DE inspection */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Inspeção do DE</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card
            label="DE no payload bruto?"
            value={deInspection.presentInRaw ? "SIM" : "NÃO"}
            tone={deInspection.presentInRaw ? "good" : "warn"}
          />
          <Card
            label="registros brutos com DE"
            value={`${deInspection.rawRecordsWithDE} / ${deInspection.rawRecordsTotal}`}
          />
          <Card
            label="DE no histórico normalizado?"
            value={deInspection.presentInNormalized ? "SIM" : "NÃO"}
            tone={deInspection.presentInNormalized ? "good" : "warn"}
          />
          <Card
            label="registros normalizados com DE"
            value={`${deInspection.normalizedRecordsWithDE} / ${deInspection.normalizedRecordsTotal}`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Se &quot;DE no payload bruto&quot; = NÃO, a fonte histórica do
          Cartola realmente não devolve DE nessas rodadas, e as features DE
          da v2.1 ficam em 0 (semântica &quot;não ocorreu&quot;), imputadas
          pelo mecanismo do treino. Se = SIM mas normalizado = NÃO, houve
          bug de preservação.
        </p>
      </section>

      {/* Contagens */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Card label="base v1.2a features" value={sv.totalBaseFeatures} />
        <Card
          label="scout features (v2.1)"
          value={sv.totalScoutFeatures}
          tone={sv.totalScoutFeatures === 40 ? "good" : "bad"}
        />
        <Card
          label="features finais (última rodada)"
          value={sv.totalFinalFeatures}
          tone="good"
        />
        <Card
          label="scouts utilizados"
          value={v2_1.scoutCoverage.length}
          tone={v2_1.scoutCoverage.length === 10 ? "good" : "bad"}
        />
      </section>

      {/* Verificação */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Auditoria estrutural</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card
            label="categorias (v1.2a checks)"
            value={cv.ok ? "OK" : "FAIL"}
            tone={cv.ok ? "good" : "bad"}
          />
          <Card
            label="scouts só usam round < R"
            value={sv.scoutFeaturesUseOnlyPriorRounds ? "OK" : "FAIL"}
            tone={sv.scoutFeaturesUseOnlyPriorRounds ? "good" : "bad"}
          />
          <Card
            label="base v1.2a preservada"
            value={sv.v12aBasePreserved ? "OK" : "FAIL"}
            tone={sv.v12aBasePreserved ? "good" : "bad"}
          />
          <Card
            label="noTargetPointsUsed"
            value={sv.noTargetPointsUsed ? "OK" : "FAIL"}
            tone={sv.noTargetPointsUsed ? "good" : "bad"}
          />
          <Card
            label="scout features sem NaN"
            value={sv.scoutFeaturesNoNaN ? "OK" : "FAIL"}
            tone={sv.scoutFeaturesNoNaN ? "good" : "bad"}
          />
          <Card
            label="scout features sem Infinity"
            value={sv.scoutFeaturesNoInfinity ? "OK" : "FAIL"}
            tone={sv.scoutFeaturesNoInfinity ? "good" : "bad"}
          />
        </div>
        {sv.failures.length > 0 && (
          <details className="mt-2 rounded border">
            <summary className="cursor-pointer bg-muted px-3 py-2 text-xs">
              scout failures ({sv.failures.length})
            </summary>
            <pre className="max-h-64 overflow-auto p-3 text-xs">
              {sv.failures.join("\n")}
            </pre>
          </details>
        )}
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
                <td className="border-b px-3 py-2 font-semibold">ML v2.1</td>
                <td className="border-b px-3 py-2 text-right">
                  {v2_1.overall.ml.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.ml.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.ml.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.ml.pearson)}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">Baseline</td>
                <td className="border-b px-3 py-2 text-right">
                  {v2_1.overall.baseline.count}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.baseline.mae)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.baseline.rmse)}
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {fmt(v2_1.overall.baseline.pearson)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Card
            label="Δ MAE (v2.1 − v1.2a)"
            value={dMaeV21V12a === null ? "—" : dMaeV21V12a.toFixed(4)}
            tone={
              dMaeV21V12a === null ? "default" : dMaeV21V12a < 0 ? "good" : "bad"
            }
          />
          <Card
            label="Δ RMSE (v2.1 − v1.2a)"
            value={dRmseV21V12a === null ? "—" : dRmseV21V12a.toFixed(4)}
            tone={
              dRmseV21V12a === null
                ? "default"
                : dRmseV21V12a < 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Δ Pearson (v2.1 − v1.2a)"
            value={
              dPearsonV21V12a === null ? "—" : dPearsonV21V12a.toFixed(4)
            }
            tone={
              dPearsonV21V12a === null
                ? "default"
                : dPearsonV21V12a > 0
                  ? "good"
                  : "bad"
            }
          />
          <Card
            label="Δ MAE (v2.1 − baseline)"
            value={dMaeV21Bl === null ? "—" : dMaeV21Bl.toFixed(4)}
            tone={
              dMaeV21Bl === null ? "default" : dMaeV21Bl < 0 ? "good" : "bad"
            }
          />
          <Card
            label="Δ RMSE (v2.1 − baseline)"
            value={dRmseV21Bl === null ? "—" : dRmseV21Bl.toFixed(4)}
            tone={
              dRmseV21Bl === null ? "default" : dRmseV21Bl < 0 ? "good" : "bad"
            }
          />
          <Card
            label="Δ Pearson (v2.1 − baseline)"
            value={dPearsonV21Bl === null ? "—" : dPearsonV21Bl.toFixed(4)}
            tone={
              dPearsonV21Bl === null
                ? "default"
                : dPearsonV21Bl > 0
                  ? "good"
                  : "bad"
            }
          />
        </div>
      </section>

      {/* Métricas por rodada */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Métricas por rodada (R5–R26)
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-right">n</th>
                <th className="border-b px-2 py-2 text-right">v2.1 MAE</th>
                <th className="border-b px-2 py-2 text-right">v2.1 RMSE</th>
                <th className="border-b px-2 py-2 text-right">v2.1 r</th>
                <th className="border-b px-2 py-2 text-right">v1.2a MAE</th>
                <th className="border-b px-2 py-2 text-right">v1.2a RMSE</th>
                <th className="border-b px-2 py-2 text-right">v1.2a r</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
                <th className="border-b px-2 py-2 text-right">ΔMAE</th>
              </tr>
            </thead>
            <tbody>
              {allRounds.map((R) => {
                const a = byRoundV12a.get(R);
                const b = byRoundV21.get(R);
                const d =
                  b?.ml.mae != null && a?.ml.mae != null
                    ? b.ml.mae - a.ml.mae
                    : null;
                return (
                  <tr key={R} className={R === 6 ? "bg-amber-50" : ""}>
                    <td className="border-b px-2 py-1 font-semibold">R{R}</td>
                    <td className="border-b px-2 py-1 text-right">
                      {b?.ml.count ?? 0}
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
                      {fmt(a?.ml.pearson ?? null, 3)}
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

      {/* Cobertura por scout — presença no payload */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Cobertura por scout (histórico anterior das linhas de teste)
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">#feats</th>
                <th className="border-b px-2 py-2 text-right">
                  partidas c/ valor
                </th>
                <th className="border-b px-2 py-2 text-right">
                  partidas s/ valor
                </th>
                <th className="border-b px-2 py-2 text-right">cobertura %</th>
                <th className="border-b px-2 py-2 text-center">
                  ausência→null
                </th>
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
              {v2_1.scoutCoverage.map((s) => (
                <tr
                  key={s.scout}
                  className={s.scout === "DE" ? "bg-amber-50" : ""}
                >
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {s.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.featureCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.matchesWithValue}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {s.matchesWithoutValue}
                  </td>
                  <td className="border-b px-2 py-1 text-right font-semibold">
                    {s.coveragePct.toFixed(2)}%
                  </td>
                  <td className="border-b px-2 py-1 text-center">
                    {s.absenceIsNull ? "✓" : "—"}
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
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>Ausência→null</strong> = o scout foi extraído com a regra
          &quot;chave ausente = dado indisponível&quot; (não tratada como 0).
          Só DE usa essa regra nesta versão; os outros scouts seguem a
          semântica verificada de que ausência = 0.
        </p>
      </section>

      {/* Lista de features de scout */}
      <section>
        <details className="rounded border">
          <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
            Lista completa de scout features ({v2_1.scoutFeatureNames.length})
          </summary>
          <div className="flex flex-wrap gap-1 p-3">
            {v2_1.scoutFeatureNames.map((f) => (
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
        Rota de experimento. Nenhuma versão anterior foi alterada.
      </footer>
    </div>
  );
}
