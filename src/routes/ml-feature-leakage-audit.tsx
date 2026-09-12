// src/routes/ml-feature-leakage-audit.tsx

import { createFileRoute } from "@tanstack/react-router";
import { auditFeatureLeakageDetailed } from "@/lib/cartola/api.functions";
import type { FeatureLeakageAuditResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: FeatureLeakageAuditResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-feature-leakage-audit")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await auditFeatureLeakageDetailed({
        data: { firstRound: 5, lastRound: 26 },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: FeatureLeakageAuditPage,
});

function statusClass(s: string): string {
  switch (s) {
    case "SAFE":
      return "bg-green-100 text-green-800";
    case "UNKNOWN":
      return "bg-amber-100 text-amber-800";
    case "LEAKAGE":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function FeatureLeakageAuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-6xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML Feature Leakage Audit (temporário)
        </h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const r = data.result;
  const s = r.summary;

  return (
    <div className="container mx-auto max-w-6xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML Feature Leakage Audit (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          Auditoria por feature do dataset de ML. Distingue (A) leakage
          temporal explícito de (B) informação pós-rodada usada como estado
          do jogador. R{r.firstRound}–R{r.lastRound}.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Card label="SAFE" value={s.safe} tone="good" />
        <Card label="UNKNOWN" value={s.unknown} tone="warn" />
        <Card
          label="LEAKAGE"
          value={s.leakage}
          tone={s.leakage > 0 ? "bad" : "default"}
        />
        <Card label="NOT_APPLICABLE" value={s.notApplicable} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Tabela feature → source → status → explicação
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">feature</th>
                <th className="border-b px-3 py-2 text-left">source</th>
                <th className="border-b px-3 py-2 text-left">temporal</th>
                <th className="border-b px-3 py-2 text-left">status</th>
                <th className="border-b px-3 py-2 text-left">explicação</th>
              </tr>
            </thead>
            <tbody>
              {r.entries.map((e) => (
                <tr key={e.feature}>
                  <td className="border-b px-3 py-2 font-mono">
                    {e.feature}
                  </td>
                  <td className="border-b px-3 py-2 font-mono text-[10px]">
                    {e.source}
                  </td>
                  <td className="border-b px-3 py-2 font-mono text-[10px]">
                    {e.temporal}
                  </td>
                  <td className="border-b px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusClass(
                        e.status,
                      )}`}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="border-b px-3 py-2">{e.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {(s.leakage > 0 || s.unknown > 0) && (
        <section className="rounded border border-amber-300 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">
            Atenção: {s.leakage} feature(s) com LEAKAGE e {s.unknown}{" "}
            feature(s) com status UNKNOWN
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
            {r.entries
              .filter((e) => e.status !== "SAFE" && e.status !== "NOT_APPLICABLE")
              .map((e) => (
                <li key={e.feature}>
                  <span className="font-mono">{e.feature}</span> — {e.explanation}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Verificações dinâmicas (dataset R{r.firstRound}–R{r.lastRound})
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="totalRows" value={r.dynamicChecks.totalRows} />
          <Card
            label="rowsWithClubChange"
            value={r.dynamicChecks.rowsWithClubChange}
            tone={r.dynamicChecks.rowsWithClubChange > 0 ? "warn" : "default"}
          />
          <Card
            label="rowsWithPositionChange"
            value={r.dynamicChecks.rowsWithPositionChange}
            tone={
              r.dynamicChecks.rowsWithPositionChange > 0 ? "warn" : "default"
            }
          />
          <Card
            label="rowsWithClubIdMissing"
            value={r.dynamicChecks.rowsWithClubIdMissing}
          />
          <Card
            label="rowsWithPositionMissing"
            value={r.dynamicChecks.rowsWithPositionMissing}
          />
          <Card
            label="maxRoundAudit"
            value={r.dynamicChecks.maxRoundAudit.ok ? "OK" : "VIOLADO"}
            tone={r.dynamicChecks.maxRoundAudit.ok ? "good" : "bad"}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          "rowsWithClubChange" e "rowsWithPositionChange" comparam o valor da
          rodada alvo com o da última rodada anterior disponível no histórico
          do jogador. Não indicam leakage por si só — são uma medida de
          volatilidade que ajuda a dimensionar o risco residual do caso
          UNKNOWN.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Amostra de linhas afetadas (clubId/position mudou entre a última
          rodada anterior e a alvo)
        </h2>
        {r.dynamicChecks.affectedSample.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma mudança de clube ou posição entre a última rodada anterior
            e a rodada alvo.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-3 py-2 text-left">R</th>
                  <th className="border-b px-3 py-2 text-left">playerId</th>
                  <th className="border-b px-3 py-2 text-left">
                    clubId (prior → target)
                  </th>
                  <th className="border-b px-3 py-2 text-left">
                    position (prior → target)
                  </th>
                  <th className="border-b px-3 py-2 text-left">mudou?</th>
                </tr>
              </thead>
              <tbody>
                {r.dynamicChecks.affectedSample.map((x, i) => (
                  <tr key={`${x.playerId}-${x.round}-${i}`}>
                    <td className="border-b px-3 py-2">R{x.round}</td>
                    <td className="border-b px-3 py-2 font-mono">
                      {x.playerId}
                    </td>
                    <td className="border-b px-3 py-2 font-mono">
                      {x.clubIdInPriorRound ?? "—"} → {x.clubIdInTarget ?? "—"}
                    </td>
                    <td className="border-b px-3 py-2 font-mono">
                      {x.positionInPriorRound ?? "—"} →{" "}
                      {x.positionInTarget ?? "—"}
                    </td>
                    <td className="border-b px-3 py-2">
                      {x.clubChanged && (
                        <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          club
                        </span>
                      )}
                      {x.positionChanged && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                          position
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. Não referenciada por menu nem por outras páginas.
      </footer>
    </div>
  );
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
