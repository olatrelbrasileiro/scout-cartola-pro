// src/routes/ml-dataset-no-prior.tsx

import { createFileRoute } from "@tanstack/react-router";
import { auditNoPriorParticipation } from "@/lib/cartola/api.functions";
import type { NoPriorAuditResult } from "@/lib/cartola/api.functions";

type LoaderData =
  | { ok: true; result: NoPriorAuditResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-dataset-no-prior")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await auditNoPriorParticipation({
        data: { firstRound: 5, lastRound: 26 },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: NoPriorAuditPage,
});

function Card({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
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

function NoPriorAuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-6xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          Perfil dos jogadores sem participação prévia (temporário)
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
    <div className="container mx-auto max-w-6xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          Perfil dos jogadores sem participação prévia (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          Linhas do dataset em que o jogador participou na rodada alvo mas não
          tinha nenhuma participação anterior. R{r.firstRound}–R{r.lastRound}.
          Todos os indicadores "pré-rodada" usam apenas dados de rodadas
          estritamente anteriores à alvo.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card label="total de linhas" value={r.total} tone="warn" />
        <Card label="jogadores únicos" value={r.uniquePlayers} />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por perfil</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">profileType</th>
                <th className="border-b px-3 py-2 text-right">count</th>
              </tr>
            </thead>
            <tbody>
              {r.byProfileType.map((p) => (
                <tr key={p.type}>
                  <td className="border-b px-3 py-2 font-mono">{p.type}</td>
                  <td className="border-b px-3 py-2 text-right">{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por rodada</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">R</th>
                <th className="border-b px-3 py-2 text-right">count</th>
              </tr>
            </thead>
            <tbody>
              {r.byRound.map((x) => (
                <tr key={x.round}>
                  <td className="border-b px-3 py-2">R{x.round}</td>
                  <td className="border-b px-3 py-2 text-right">{x.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por posição</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">position</th>
                <th className="border-b px-3 py-2 text-right">count</th>
              </tr>
            </thead>
            <tbody>
              {r.byPosition.map((x) => (
                <tr key={x.position}>
                  <td className="border-b px-3 py-2">{x.position}</td>
                  <td className="border-b px-3 py-2 text-right">{x.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Por clube</h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">clubId</th>
                <th className="border-b px-3 py-2 text-right">count</th>
              </tr>
            </thead>
            <tbody>
              {r.byClub.map((x, i) => (
                <tr key={`${x.clubId}-${i}`}>
                  <td className="border-b px-3 py-2 font-mono">
                    {x.clubId ?? "UNKNOWN"}
                  </td>
                  <td className="border-b px-3 py-2 text-right">{x.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Lista completa ({r.all.length})
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">R</th>
                <th className="border-b px-2 py-2 text-left">playerId</th>
                <th className="border-b px-2 py-2 text-left">apelido</th>
                <th className="border-b px-2 py-2 text-left">clubId</th>
                <th className="border-b px-2 py-2 text-left">pos</th>
                <th className="border-b px-2 py-2 text-right">#pres</th>
                <th className="border-b px-2 py-2 text-right">#bench</th>
                <th className="border-b px-2 py-2 text-right">lastSeen</th>
                <th className="border-b px-2 py-2 text-right">ΔR</th>
                <th className="border-b px-2 py-2 text-left">profile</th>
                <th className="border-b px-2 py-2 text-right">status</th>
                <th className="border-b px-2 py-2 text-right">preço</th>
                <th className="border-b px-2 py-2 text-right">média</th>
                <th className="border-b px-2 py-2 text-right">jogos</th>
              </tr>
            </thead>
            <tbody>
              {r.all.map((t, i) => (
                <tr key={`${t.playerId}-${t.round}-${i}`}>
                  <td className="border-b px-2 py-1">R{t.round}</td>
                  <td className="border-b px-2 py-1 font-mono">
                    {t.playerId}
                  </td>
                  <td className="border-b px-2 py-1">
                    {t.apelido ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 font-mono">
                    {t.clubId ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1">{t.position ?? "—"}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.priorAppearancesInPontuados}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.priorRoundsWithEntrouFalse}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.lastSeenRound ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.roundsSinceLastSeen ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 font-mono text-[10px]">
                    {t.profileType}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.currentMarketStatusId ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.currentMarketPrice?.toFixed(2) ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.currentMarketMedia?.toFixed(2) ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {t.currentMarketJogos ?? "—"}
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
