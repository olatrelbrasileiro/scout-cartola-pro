// src/components/backtest/BacktestPanel.tsx

import { useState } from "react";
import { runHistoricalBacktest } from "@/lib/cartola/api.functions";
import type { MultiPlayerBacktestSummary } from "@/lib/backtest/backtest";

function formatNumber(v: number | null, digits = 3): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function BacktestPanel() {
  const [firstRound, setFirstRound] = useState(10);
  const [lastRound, setLastRound] = useState(20);
  const [participationWindow, setParticipationWindow] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MultiPlayerBacktestSummary | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const result = await runHistoricalBacktest({
        data: { firstRound, lastRound, participationWindow },
      });
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span>Primeira rodada</span>
          <input
            type="number"
            min={1}
            value={firstRound}
            onChange={(e) => setFirstRound(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Última rodada</span>
          <input
            type="number"
            min={1}
            value={lastRound}
            onChange={(e) => setLastRound(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Janela (participações)</span>
          <input
            type="number"
            min={1}
            max={20}
            value={participationWindow}
            onChange={(e) => setParticipationWindow(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleRun}
            disabled={loading}
            className="w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? "Rodando…" : "Executar backtest"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Período analisado"
              value={
                summary.firstTargetRound !== null && summary.lastTargetRound !== null
                  ? `R${summary.firstTargetRound} – R${summary.lastTargetRound}`
                  : "—"
              }
            />
            <MetricCard
              label="Jogadores avaliados"
              value={String(summary.playersEvaluated)}
            />
            <MetricCard
              label="Previsões"
              value={String(summary.predictions)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="MAE" value={formatNumber(summary.mae)} />
            <MetricCard label="RMSE" value={formatNumber(summary.rmse)} />
            <MetricCard
              label="Pearson"
              value={formatNumber(summary.pearson)}
            />
          </div>

          {summary.predictions === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma previsão pôde ser gerada no intervalo escolhido. Tente
              aumentar o período ou reduzir a janela de participações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
