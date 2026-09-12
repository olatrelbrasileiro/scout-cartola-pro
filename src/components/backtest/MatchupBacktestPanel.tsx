// src/components/backtest/MatchupBacktestPanel.tsx

import { useState } from "react";
import {
  runMatchupBacktestComparison,
  type MatchupBacktestComparison,
} from "@/lib/cartola/api.functions";

function fmt(v: number | null, digits = 3): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

export function MatchupBacktestPanel() {
  const [firstRound, setFirstRound] = useState(10);
  const [lastRound, setLastRound] = useState(20);
  const [participationWindow, setParticipationWindow] = useState(5);
  const [windowsInput, setWindowsInput] = useState("3,5,8,12");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MatchupBacktestComparison | null>(null);

  async function handleRun() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const parsed = windowsInput
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      const windows = parsed.length > 0 ? parsed : [3, 5, 8, 12];

      const res = await runMatchupBacktestComparison({
        data: {
          firstRound,
          lastRound,
          participationWindow,
          matchupWindows: windows,
        },
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Matchup por posição</h2>
        <p className="text-sm text-muted-foreground">
          Compara baseline de média recente vs baseline + fator de matchup,
          para diferentes janelas. Cálculo usa somente rodadas anteriores à
          rodada prevista.
        </p>
      </div>

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
          <span>Janela de participações (baseline)</span>
          <input
            type="number"
            min={1}
            max={20}
            value={participationWindow}
            onChange={(e) => setParticipationWindow(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Janelas do matchup (vírgula)</span>
          <input
            type="text"
            value={windowsInput}
            onChange={(e) => setWindowsInput(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleRun}
        disabled={loading}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "Rodando…" : "Rodar comparação"}
      </button>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Amostras de (rodada, time, mando, posição): {result.totalSamples} ·
            Jogadores com dados de matchup: {result.playersWithMatchupData}
          </div>

          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-3 py-2 text-left">Modelo</th>
                  <th className="border-b px-3 py-2 text-right">Previsões</th>
                  <th className="border-b px-3 py-2 text-right">Jogadores</th>
                  <th className="border-b px-3 py-2 text-right">MAE</th>
                  <th className="border-b px-3 py-2 text-right">RMSE</th>
                  <th className="border-b px-3 py-2 text-right">Pearson</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-semibold">
                  <td className="border-b px-3 py-2">
                    A) Recent Average
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    {result.baseline.predictions}
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    {result.baseline.playersEvaluated}
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    {fmt(result.baseline.mae)}
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    {fmt(result.baseline.rmse)}
                  </td>
                  <td className="border-b px-3 py-2 text-right">
                    {fmt(result.baseline.pearson)}
                  </td>
                </tr>
                {result.byWindow.map(({ window, summary }) => (
                  <tr key={window}>
                    <td className="border-b px-3 py-2">
                      B) Recent Avg + Matchup ({window})
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {summary.predictions}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {summary.playersEvaluated}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {fmt(summary.mae)}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {fmt(summary.rmse)}
                    </td>
                    <td className="border-b px-3 py-2 text-right">
                      {fmt(summary.pearson)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.baseline.predictions === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma previsão no intervalo escolhido. Aumente o período ou
              reduza a janela de participações.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
