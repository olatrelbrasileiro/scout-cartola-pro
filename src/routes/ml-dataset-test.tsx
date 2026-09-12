// src/routes/ml-dataset-test.tsx

import { createFileRoute } from "@tanstack/react-router";
import { buildTrainingDataset } from "@/lib/cartola/api.functions";
import { validateNoLeakage } from "@/lib/ml/features.functions";
import type { TrainingFeatureRow } from "@/lib/ml/features.types";

/**
 * Contagem de previsões do baseline R5–R26 (janela = 12 participações).
 * Valor de referência externo, usado apenas para comparação visual.
 */
const BASELINE_PREDICTIONS_R5_R26 = 5540;

type LoaderData =
  | {
      ok: true;
      metadata: {
        firstRound: number;
        lastRound: number;
        rowCount: number;
        participationsOnlyRowCount: number;
        featureNames: readonly string[];
        generatedAt: string;
      };
      firstRows: TrainingFeatureRow[];
      lastRows: TrainingFeatureRow[];
      validation: {
        ok: boolean;
        violationsCount: number;
        violationsSample: unknown[];
      };
    }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-dataset-test")({
  loader: async (): Promise<LoaderData> => {
    try {
      const dataset = await buildTrainingDataset({
        data: { firstRound: 5, lastRound: 26 },
      });
      const validation = validateNoLeakage(dataset);

      // Devolvemos só o necessário para a UI — o dataset completo
      // (milhares de linhas) não precisa trafegar até o cliente.
      return {
        ok: true,
        metadata: dataset.metadata,
        firstRows: dataset.rows.slice(0, 5),
        lastRows: dataset.rows.slice(-5),
        validation: {
          ok: validation.ok,
          violationsCount: validation.violations.length,
          violationsSample: validation.violations.slice(0, 5),
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
  component: MlDatasetTestPage,
});

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "border-green-300 bg-green-50"
      : tone === "bad"
        ? "border-red-300 bg-red-50"
        : "";
  return (
    <div className={`rounded border p-3 ${toneClass}`}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function RowBlock({
  title,
  rows,
}: {
  title: string;
  rows: TrainingFeatureRow[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem linhas.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div
              key={`${row.playerId}-${row.round}-${i}`}
              className="rounded border"
            >
              <div className="border-b bg-muted px-3 py-1 text-xs font-mono">
                playerId={row.playerId} · round={row.round}
              </div>
              <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed">
                {JSON.stringify(row, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MlDatasetTestPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-5xl py-8">
        <h1 className="mb-2 text-2xl font-bold">
          ML Dataset Test (temporário)
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Página de diagnóstico do dataset de treino R5–R26. Pode ser removida
          quando a Etapa 1 for validada.
        </p>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro ao construir o dataset</div>
          <div className="mt-1 text-sm">{data.error}</div>
          <div className="mt-2 text-xs">
            Verifique se a API do Cartola está acessível e se as rodadas 1..26
            possuem dados. Erros de rede em rodadas isoladas já são tratados
            com fallback vazio no backend.
          </div>
        </div>
      </div>
    );
  }

  const { metadata, firstRows, lastRows, validation } = data;

  const diffFromBaseline =
    metadata.participationsOnlyRowCount - BASELINE_PREDICTIONS_R5_R26;

  return (
    <div className="container mx-auto max-w-5xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML Dataset Test (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          Inspeção do dataset de treino construído por{" "}
          <code>buildTrainingDataset({"{"} firstRound: 5, lastRound: 26 {"}"})</code>{" "}
          e auditado por <code>validateNoLeakage()</code>. Página temporária —
          não integrada a nenhum fluxo do app.
        </p>
      </header>

      {/* ---------- Métricas principais ---------- */}
      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="rowCount" value={String(metadata.rowCount)} />
        <MetricCard
          label="participationsOnlyRowCount"
          value={String(metadata.participationsOnlyRowCount)}
        />
        <MetricCard
          label="Leakage"
          value={validation.ok ? "OK" : "VIOLADO"}
          tone={validation.ok ? "good" : "bad"}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Violations"
          value={String(validation.violationsCount)}
          tone={validation.violationsCount === 0 ? "good" : "bad"}
        />
        <MetricCard
          label="Intervalo"
          value={`R${metadata.firstRound} – R${metadata.lastRound}`}
        />
      </section>

      {/* ---------- Comparação com baseline ---------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          Baseline vs. dataset
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-3 py-2 text-left">Fonte</th>
                <th className="border-b px-3 py-2 text-right">
                  Previsões / linhas
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b px-3 py-2">
                  Baseline R5–R26 (janela = 12 participações)
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {BASELINE_PREDICTIONS_R5_R26}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2">
                  Dataset — participationsOnlyRowCount
                </td>
                <td className="border-b px-3 py-2 text-right">
                  {metadata.participationsOnlyRowCount}
                </td>
              </tr>
              <tr>
                <td className="border-b px-3 py-2 font-semibold">Diferença</td>
                <td className="border-b px-3 py-2 text-right font-semibold">
                  {diffFromBaseline >= 0 ? "+" : ""}
                  {diffFromBaseline}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Observação: o dataset inclui todas as linhas (participações e
          não-participações). Compare sempre{" "}
          <code>participationsOnlyRowCount</code> com o universo do baseline.
          Diferenças residuais podem vir de rodadas com poucas participações
          anteriores, filtros de dados faltantes ou divergência de janela.
        </p>
      </section>

      {/* ---------- Violações (se houver) ---------- */}
      {!validation.ok && (
        <section className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">
            {validation.violationsCount} violação(ões) de leakage detectada(s)
          </div>
          <pre className="mt-2 max-h-64 overflow-auto text-xs">
            {JSON.stringify(validation.violationsSample, null, 2)}
          </pre>
          <div className="mt-2 text-xs">
            (Mostrando no máximo 5 violações.)
          </div>
        </section>
      )}

      {/* ---------- Feature names ---------- */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">featureNames</h2>
        <div className="flex flex-wrap gap-2">
          {metadata.featureNames.map((name) => (
            <span
              key={name}
              className="rounded border bg-muted px-2 py-1 font-mono text-xs"
            >
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- Primeiras / últimas linhas ---------- */}
      <section className="space-y-6">
        <RowBlock title="Primeiras 5 linhas" rows={firstRows} />
        <RowBlock title="Últimas 5 linhas" rows={lastRows} />
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Gerado em {metadata.generatedAt}. Página temporária — não referenciada
        pelo menu nem por nenhuma outra rota.
      </footer>
    </div>
  );
}
