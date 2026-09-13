// src/routes/ml-lab.tsx

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { runMLLabEvaluation } from "@/lib/cartola/api.functions";
import type { LabRunResult } from "@/lib/ml/lab.functions";

/* ---------------- Constantes de features ---------------- */

const NUMERIC_FEATURES_ALL: string[] = [
  "isHome",
  "games_last_3_rounds",
  "games_last_5_rounds",
  "games_last_12_rounds",
  "points_avg_3",
  "points_avg_5",
  "points_avg_12",
  "points_std_5",
  "points_std_12",
  "points_min_5",
  "points_max_5",
  "points_avg_3_minus_avg_12",
  "home_points_avg",
  "away_points_avg",
  "rounds_since_last_game",
];

const V12A_NUMERIC: string[] = [
  "isHome",
  "games_last_3_rounds",
  "games_last_5_rounds",
  "games_last_12_rounds",
  "points_avg_3",
  "points_avg_5",
  "points_avg_12",
  "points_std_5",
  "points_std_12",
  "points_min_5",
  "points_max_5",
  "home_points_avg",
  "away_points_avg",
  "rounds_since_last_game",
];

const SCOUT_KEYS = [
  "G", "A", "DE", "SG", "DS", "FF", "FT", "FD", "FC", "FS",
] as const;

const SCOUT_AGGREGATES = [
  "total",
  "avg_per_match",
  "last5_total",
  "last5_avg_per_match",
] as const;

const ALL_SCOUT_FEATURES: string[] = SCOUT_KEYS.flatMap((s) =>
  SCOUT_AGGREGATES.map((a) => `scout_${s}_${a}`),
);

/* ---------------- State helpers ---------------- */

interface Params {
  lambda: number;
  firstRound: number;
  lastRound: number;
  participationWindow: number;
}

interface ExperimentRecord {
  id: string;
  timestamp: string;
  config: {
    numericFeatures: string[];
    includePosition: boolean;
    includeClub: boolean;
    includeOpponent: boolean;
    scoutFeatures: string[];
  };
  params: Params;
  totalFeatures: number;
  predictions: number;
  mae: number | null;
  rmse: number | null;
  pearson: number | null;
  dMaeVsV12a: number | null;
  dRmseVsV12a: number | null;
  dPearsonVsV12a: number | null;
}

function fmt(v: number | null, d = 4): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

function delta(v: number | null, inverse = true): string {
  if (v === null || Number.isNaN(v)) return "—";
  const good = inverse ? v < 0 : v > 0;
  const icon = Math.abs(v) < 0.002 ? "⚪" : good ? "🟢" : "🔴";
  return `${icon} ${v >= 0 ? "+" : ""}${v.toFixed(4)}`;
}

/* ---------------- Loader ---------------- */

type LoaderData = { ok: true } | { ok: false; error: string };

export const Route = createFileRoute("/ml-lab")({
  loader: async (): Promise<LoaderData> => {
    try {
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: MLLabPage,
});

/* ---------------- Componentes ---------------- */

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

function MLLabPage() {
  // ---------- Parâmetros ----------
  const [lambda, setLambda] = useState<number>(1.0);
  const [firstRound, setFirstRound] = useState<number>(5);
  const [lastRound, setLastRound] = useState<number>(26);
  const [participationWindow, setParticipationWindow] = useState<number>(12);

  // ---------- Seleção de features ----------
  const [numericState, setNumericState] = useState<Record<string, boolean>>(
    () => {
      const m: Record<string, boolean> = {};
      for (const f of NUMERIC_FEATURES_ALL) m[f] = V12A_NUMERIC.includes(f);
      return m;
    },
  );
  const [includePosition, setIncludePosition] = useState(true);
  const [includeClub, setIncludeClub] = useState(true);
  const [includeOpponent, setIncludeOpponent] = useState(true);
  const [scoutState, setScoutState] = useState<Record<string, boolean>>(
    () => {
      const m: Record<string, boolean> = {};
      for (const f of ALL_SCOUT_FEATURES) m[f] = false;
      return m;
    },
  );

  // ---------- Execução ----------
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabRunResult | null>(null);

  // ---------- Histórico ----------
  const [history, setHistory] = useState<ExperimentRecord[]>([]);
  const [sortKey, setSortKey] = useState<"mae" | "rmse" | "pearson">("mae");

  const selectedNumeric = useMemo(
    () => NUMERIC_FEATURES_ALL.filter((f) => numericState[f]),
    [numericState],
  );
  const selectedScouts = useMemo(
    () => ALL_SCOUT_FEATURES.filter((f) => scoutState[f]),
    [scoutState],
  );

  const previewFeatureCount =
    selectedNumeric.length +
    (includePosition ? 5 : 0) +
    (includeClub ? 21 : 0) + // aproximação (vocab varia)
    (includeOpponent ? 21 : 0) +
    selectedScouts.length;

  // ---------- Ações ----------
  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      const res = await runMLLabEvaluation({
        data: {
          config: {
            numericFeatures: selectedNumeric,
            includePosition,
            includeClub,
            includeOpponent,
            scoutFeatures: selectedScouts,
          },
          lambda,
          firstRound,
          lastRound,
          participationWindow,
        },
      });
      setResult(res);
      // grava no histórico
      const record: ExperimentRecord = {
        id: `${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("pt-BR"),
        config: {
          numericFeatures: [...selectedNumeric],
          includePosition,
          includeClub,
          includeOpponent,
          scoutFeatures: [...selectedScouts],
        },
        params: { lambda, firstRound, lastRound, participationWindow },
        totalFeatures: res.user.totalFeatures,
        predictions: res.user.overall.ml.count,
        mae: res.user.overall.ml.mae,
        rmse: res.user.overall.ml.rmse,
        pearson: res.user.overall.ml.pearson,
        dMaeVsV12a:
          res.user.overall.ml.mae !== null && res.v12aSummary.mae !== null
            ? res.user.overall.ml.mae - res.v12aSummary.mae
            : null,
        dRmseVsV12a:
          res.user.overall.ml.rmse !== null && res.v12aSummary.rmse !== null
            ? res.user.overall.ml.rmse - res.v12aSummary.rmse
            : null,
        dPearsonVsV12a:
          res.user.overall.ml.pearson !== null &&
          res.v12aSummary.pearson !== null
            ? res.user.overall.ml.pearson - res.v12aSummary.pearson
            : null,
      };
      setHistory((h) => [record, ...h].slice(0, 50));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function resetNumeric(keep: string[]) {
    const m: Record<string, boolean> = {};
    for (const f of NUMERIC_FEATURES_ALL) m[f] = keep.includes(f);
    setNumericState(m);
  }
  function resetScouts(keep: string[]) {
    const m: Record<string, boolean> = {};
    for (const f of ALL_SCOUT_FEATURES) m[f] = keep.includes(f);
    setScoutState(m);
  }

  function restoreV12a() {
    resetNumeric(V12A_NUMERIC);
    resetScouts([]);
    setIncludePosition(true);
    setIncludeClub(true);
    setIncludeOpponent(true);
  }
  function restoreV21() {
    resetNumeric(V12A_NUMERIC);
    resetScouts([...ALL_SCOUT_FEATURES]);
    setIncludePosition(true);
    setIncludeClub(true);
    setIncludeOpponent(true);
  }
  function selectAllFeatures() {
    resetNumeric([...NUMERIC_FEATURES_ALL]);
    resetScouts([...ALL_SCOUT_FEATURES]);
    setIncludePosition(true);
    setIncludeClub(true);
    setIncludeOpponent(true);
  }
  function deselectAll() {
    resetNumeric([]);
    resetScouts([]);
    setIncludePosition(false);
    setIncludeClub(false);
    setIncludeOpponent(false);
  }
  function onlyScouts() {
    resetNumeric([]);
    resetScouts([...ALL_SCOUT_FEATURES]);
    setIncludePosition(false);
    setIncludeClub(false);
    setIncludeOpponent(false);
  }
  function noScouts() {
    resetScouts([]);
  }
  function toggleScoutGroup(scout: string, value: boolean) {
    setScoutState((s) => {
      const next = { ...s };
      for (const a of SCOUT_AGGREGATES) {
        next[`scout_${scout}_${a}`] = value;
      }
      return next;
    });
  }
  function toggleAggregate(agg: string, value: boolean) {
    setScoutState((s) => {
      const next = { ...s };
      for (const k of SCOUT_KEYS) {
        next[`scout_${k}_${agg}`] = value;
      }
      return next;
    });
  }
  function restoreFromHistory(rec: ExperimentRecord) {
    const m: Record<string, boolean> = {};
    for (const f of NUMERIC_FEATURES_ALL)
      m[f] = rec.config.numericFeatures.includes(f);
    setNumericState(m);
    const sm: Record<string, boolean> = {};
    for (const f of ALL_SCOUT_FEATURES) sm[f] = rec.config.scoutFeatures.includes(f);
    setScoutState(sm);
    setIncludePosition(rec.config.includePosition);
    setIncludeClub(rec.config.includeClub);
    setIncludeOpponent(rec.config.includeOpponent);
    setLambda(rec.params.lambda);
    setFirstRound(rec.params.firstRound);
    setLastRound(rec.params.lastRound);
    setParticipationWindow(rec.params.participationWindow);
  }

  const sortedHistory = useMemo(() => {
    const arr = [...history];
    arr.sort((a, b) => {
      if (sortKey === "pearson") {
        return (b.pearson ?? -Infinity) - (a.pearson ?? -Infinity);
      }
      return (a[sortKey] ?? Infinity) - (b[sortKey] ?? Infinity);
    });
    return arr;
  }, [history, sortKey]);

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          ML Lab — laboratório de features
        </h1>
        <p className="text-sm text-muted-foreground">
          Selecione features individualmente e execute o mesmo backtest
          temporal da v1.2a. Ridge, λ, padronização, imputação, expanding
          window, universo e baseline ficam idênticos. R5–R26, janela=12.
        </p>
      </header>

      {/* Parâmetros */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Parâmetros</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="flex flex-col text-sm">
            <span>λ Ridge</span>
            <input
              type="number"
              step="0.1"
              value={lambda}
              onChange={(e) => setLambda(Number(e.target.value))}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span>Primeira rodada</span>
            <input
              type="number"
              value={firstRound}
              onChange={(e) => setFirstRound(Number(e.target.value))}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span>Última rodada</span>
            <input
              type="number"
              value={lastRound}
              onChange={(e) => setLastRound(Number(e.target.value))}
              className="rounded border px-2 py-1"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span>Janela baseline</span>
            <input
              type="number"
              value={participationWindow}
              onChange={(e) =>
                setParticipationWindow(Number(e.target.value))
              }
              className="rounded border px-2 py-1"
            />
          </label>
        </div>
      </section>

      {/* Botões rápidos */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Seleção rápida</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={selectAllFeatures}
            className="rounded border bg-muted px-3 py-1.5 text-sm"
          >
            Selecionar tudo
          </button>
          <button
            onClick={deselectAll}
            className="rounded border bg-muted px-3 py-1.5 text-sm"
          >
            Desmarcar tudo
          </button>
          <button
            onClick={restoreV12a}
            className="rounded border bg-green-50 px-3 py-1.5 text-sm font-semibold"
          >
            Restaurar v1.2a
          </button>
          <button
            onClick={restoreV21}
            className="rounded border bg-amber-50 px-3 py-1.5 text-sm font-semibold"
          >
            Restaurar v2.1
          </button>
          <button
            onClick={onlyScouts}
            className="rounded border bg-muted px-3 py-1.5 text-sm"
          >
            Só scouts
          </button>
          <button
            onClick={noScouts}
            className="rounded border bg-muted px-3 py-1.5 text-sm"
          >
            Sem scouts
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Features selecionadas: {selectedNumeric.length} numéricas +{" "}
          {includePosition ? 5 : 0} posição + {includeClub ? "club" : "—"} +{" "}
          {includeOpponent ? "opp" : "—"} + {selectedScouts.length} scouts.{" "}
          Preview ≈ {previewFeatureCount} colunas.
        </p>
      </section>

      {/* Contexto */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Contexto</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeClub}
              onChange={(e) => setIncludeClub(e.target.checked)}
            />
            clubId (one-hot + UNKNOWN)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeOpponent}
              onChange={(e) => setIncludeOpponent(e.target.checked)}
            />
            opponentClubId (one-hot + UNKNOWN)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includePosition}
              onChange={(e) => setIncludePosition(e.target.checked)}
            />
            position (one-hot drop-TEC)
          </label>
        </div>
      </section>

      {/* Numéricas */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">Numéricas</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {NUMERIC_FEATURES_ALL.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={numericState[f] ?? false}
                onChange={(e) =>
                  setNumericState((s) => ({ ...s, [f]: e.target.checked }))
                }
              />
              <span className="font-mono text-xs">{f}</span>
            </label>
          ))}
        </div>
      </section>

      {/* Scouts */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Scouts (v2.1)</h2>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() =>
                setScoutState(() => {
                  const m: Record<string, boolean> = {};
                  for (const f of ALL_SCOUT_FEATURES) m[f] = true;
                  return m;
                })
              }
              className="rounded border bg-muted px-2 py-1"
            >
              tudo
            </button>
            <button onClick={noScouts} className="rounded border bg-muted px-2 py-1">
              nada
            </button>
            {SCOUT_AGGREGATES.map((a) => (
              <button
                key={a}
                onClick={() => toggleAggregate(a, true)}
                className="rounded border bg-muted px-2 py-1 font-mono"
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                {SCOUT_AGGREGATES.map((a) => (
                  <th key={a} className="border-b px-2 py-2 text-center">
                    {a}
                  </th>
                ))}
                <th className="border-b px-2 py-2 text-center">grupo</th>
              </tr>
            </thead>
            <tbody>
              {SCOUT_KEYS.map((s) => (
                <tr key={s}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {s}
                  </td>
                  {SCOUT_AGGREGATES.map((a) => {
                    const f = `scout_${s}_${a}`;
                    return (
                      <td
                        key={a}
                        className="border-b px-2 py-1 text-center"
                      >
                        <input
                          type="checkbox"
                          checked={scoutState[f] ?? false}
                          onChange={(e) =>
                            setScoutState((st) => ({
                              ...st,
                              [f]: e.target.checked,
                            }))
                          }
                        />
                      </td>
                    );
                  })}
                  <td className="border-b px-2 py-1 text-center">
                    <button
                      onClick={() => toggleScoutGroup(s, true)}
                      className="mr-1 rounded border bg-muted px-1.5 py-0.5 text-[10px]"
                    >
                      +todos
                    </button>
                    <button
                      onClick={() => toggleScoutGroup(s, false)}
                      className="rounded border bg-muted px-1.5 py-0.5 text-[10px]"
                    >
                      -todos
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Executar */}
      <section className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={running}
          className="rounded bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
        >
          {running ? "Executando…" : "Executar"}
        </button>
        {error && (
          <span className="text-sm text-red-700">Erro: {error}</span>
        )}
      </section>

      {/* Resultado */}
      {result && (
        <>
          <section>
            <h2 className="mb-2 text-lg font-semibold">Resultado</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card label="Features ativas" value={result.user.totalFeatures} />
              <Card
                label="Predictions"
                value={result.user.overall.ml.count}
                tone={
                  result.user.overall.ml.count ===
                  result.v12aSummary.predictions
                    ? "good"
                    : "bad"
                }
              />
              <Card label="MAE" value={fmt(result.user.overall.ml.mae)} />
              <Card label="RMSE" value={fmt(result.user.overall.ml.rmse)} />
              <Card
                label="Pearson"
                value={fmt(result.user.overall.ml.pearson)}
              />
              <Card
                label="Δ MAE vs v1.2a"
                value={delta(
                  result.user.overall.ml.mae !== null &&
                    result.v12aSummary.mae !== null
                    ? result.user.overall.ml.mae - result.v12aSummary.mae
                    : null,
                )}
              />
              <Card
                label="Δ RMSE vs v1.2a"
                value={delta(
                  result.user.overall.ml.rmse !== null &&
                    result.v12aSummary.rmse !== null
                    ? result.user.overall.ml.rmse - result.v12aSummary.rmse
                    : null,
                )}
              />
              <Card
                label="Δ Pearson vs v1.2a"
                value={delta(
                  result.user.overall.ml.pearson !== null &&
                    result.v12aSummary.pearson !== null
                    ? result.user.overall.ml.pearson -
                      result.v12aSummary.pearson
                    : null,
                  false,
                )}
              />
              <Card
                label="Δ MAE vs baseline"
                value={delta(
                  result.user.overall.ml.mae !== null &&
                    result.user.overall.baseline.mae !== null
                    ? result.user.overall.ml.mae -
                      result.user.overall.baseline.mae
                    : null,
                )}
              />
              <Card
                label="Δ RMSE vs baseline"
                value={delta(
                  result.user.overall.ml.rmse !== null &&
                    result.user.overall.baseline.rmse !== null
                    ? result.user.overall.ml.rmse -
                      result.user.overall.baseline.rmse
                    : null,
                )}
              />
              <Card
                label="Δ Pearson vs baseline"
                value={delta(
                  result.user.overall.ml.pearson !== null &&
                    result.user.overall.baseline.pearson !== null
                    ? result.user.overall.ml.pearson -
                      result.user.overall.baseline.pearson
                    : null,
                  false,
                )}
              />
            </div>
          </section>

          {/* Auditoria */}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Auditoria</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card
                label="categorical checks"
                value={
                  result.user.audit.categoricalVerification.ok ? "OK" : "FAIL"
                }
                tone={
                  result.user.audit.categoricalVerification.ok ? "good" : "bad"
                }
              />
              <Card
                label="sem NaN"
                value={result.user.audit.noNaN ? "OK" : "FAIL"}
                tone={result.user.audit.noNaN ? "good" : "bad"}
              />
              <Card
                label="sem Infinity"
                value={result.user.audit.noInfinity ? "OK" : "FAIL"}
                tone={result.user.audit.noInfinity ? "good" : "bad"}
              />
              <Card
                label="treino/teste mesmo shape"
                value={result.user.audit.trainTestFeatureCountMatch ? "OK" : "FAIL"}
                tone={
                  result.user.audit.trainTestFeatureCountMatch ? "good" : "bad"
                }
              />
              <Card
                label="numéricas"
                value={result.user.audit.baseNumericFeatures}
              />
              <Card
                label="scout features"
                value={result.user.audit.scoutFeatures}
              />
            </div>
            {result.user.audit.failures.length > 0 && (
              <details className="mt-2 rounded border">
                <summary className="cursor-pointer bg-muted px-3 py-2 text-xs">
                  failures ({result.user.audit.failures.length})
                </summary>
                <pre className="max-h-64 overflow-auto p-3 text-xs">
                  {result.user.audit.failures.join("\n")}
                </pre>
              </details>
            )}
          </section>

          {/* Por rodada */}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Por rodada</h2>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="border-b px-2 py-2 text-left">R</th>
                    <th className="border-b px-2 py-2 text-right">N</th>
                    <th className="border-b px-2 py-2 text-right">MAE</th>
                    <th className="border-b px-2 py-2 text-right">RMSE</th>
                    <th className="border-b px-2 py-2 text-right">Pearson</th>
                    <th className="border-b px-2 py-2 text-right">
                      Δ MAE vs v1.2a
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.user.byRound.map((r, i) => {
                    const v12a = result.user.byRound[i];
                    const d =
                      r.ml.mae !== null && v12a?.ml.mae !== null
                        ? r.ml.mae - (v12a.ml.mae as number)
                        : null;
                    return (
                      <tr key={r.round}>
                        <td className="border-b px-2 py-1 font-semibold">
                          R{r.round}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {r.ml.count}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {fmt(r.ml.mae, 3)}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {fmt(r.ml.rmse, 3)}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {fmt(r.ml.pearson, 3)}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {d === null ? "—" : d.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Histórico */}
      {history.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Histórico da sessão ({history.length})
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <span>Ordenar por:</span>
              <select
                value={sortKey}
                onChange={(e) =>
                  setSortKey(e.target.value as "mae" | "rmse" | "pearson")
                }
                className="rounded border px-2 py-1"
              >
                <option value="mae">melhor MAE</option>
                <option value="rmse">melhor RMSE</option>
                <option value="pearson">melhor Pearson</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-2 py-2 text-left">Hora</th>
                  <th className="border-b px-2 py-2 text-right">#feats</th>
                  <th className="border-b px-2 py-2 text-right">Pred</th>
                  <th className="border-b px-2 py-2 text-right">MAE</th>
                  <th className="border-b px-2 py-2 text-right">RMSE</th>
                  <th className="border-b px-2 py-2 text-right">Pearson</th>
                  <th className="border-b px-2 py-2 text-right">ΔMAE v1.2a</th>
                  <th className="border-b px-2 py-2 text-right">ΔRMSE v1.2a</th>
                  <th className="border-b px-2 py-2 text-right">Δr v1.2a</th>
                  <th className="border-b px-2 py-2 text-center">—</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="border-b px-2 py-1">{h.timestamp}</td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.totalFeatures}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.predictions}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {fmt(h.mae, 4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {fmt(h.rmse, 4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {fmt(h.pearson, 4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.dMaeVsV12a === null
                        ? "—"
                        : h.dMaeVsV12a.toFixed(4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.dRmseVsV12a === null
                        ? "—"
                        : h.dRmseVsV12a.toFixed(4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.dPearsonVsV12a === null
                        ? "—"
                        : h.dPearsonVsV12a.toFixed(4)}
                    </td>
                    <td className="border-b px-2 py-1 text-center">
                      <button
                        onClick={() => restoreFromHistory(h)}
                        className="rounded border bg-muted px-2 py-0.5 text-[10px]"
                      >
                        restaurar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Laboratório experimental. Nenhuma versão anterior (v1, v1.1, v1.2,
        v1.2a, v2, v2.1, baseline, audit) foi alterada. O histórico é
        armazenado somente na sessão do navegador.
      </footer>
    </div>
  );
}
