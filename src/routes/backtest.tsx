// src/routes/backtest.tsx

import { createFileRoute } from "@tanstack/react-router";
import { BacktestPanel } from "@/components/backtest/BacktestPanel";
import { MatchupBacktestPanel } from "@/components/backtest/MatchupBacktestPanel";

export const Route = createFileRoute("/backtest")({
  component: BacktestPage,
});

function BacktestPage() {
  return (
    <div className="container mx-auto max-w-3xl space-y-10 py-8">
      <div>
        <h1 className="mb-2 text-2xl font-bold">Backtest histórico</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Avalia o baseline de média das últimas N participações usando apenas
          rodadas anteriores à rodada prevista (sem data leakage).
        </p>
        <BacktestPanel />
      </div>

      <div className="border-t pt-8">
        <MatchupBacktestPanel />
      </div>
    </div>
  );
}
