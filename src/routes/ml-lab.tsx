// src/routes/ml-lab.tsx

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  runMLLabEvaluation,
  runMLLabFeatureSearch,
  runMLLabPositionFeatureSearch,
} from "@/lib/cartola/api.functions";
import type { LabRunResult } from "@/lib/ml/lab.functions";
import {
  FEATURE_CATALOG,
  type FeatureSearchResult,
  type PositionFeatureSearchResult,
  type PositionRankings,
  type SearchMetric,
  type SearchStrategy,
} from "@/lib/ml/search.functions";

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

/* ---------------- Componentes auxiliares ---------------- */

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

/* ---------------- Página principal ---------------- */

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
    (includeClub ? 21 : 0) +
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
    for (const f of ALL_SCOUT_FEATURES)
      sm[f] = rec.config.scoutFeatures.includes(f);
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
              onChange={(e) => setParticipationWindow(Number(e.target.value))}
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
            <button
              onClick={noScouts}
              className="rounded border bg-muted px-2 py-1"
            >
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
                      <td key={a} className="border-b px-2 py-1 text-center">
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
        {error && <span className="text-sm text-red-700">Erro: {error}</span>}
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

          {/* Por posição */}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Por posição</h2>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="border-b px-2 py-2 text-left">Posição</th>
                    <th className="border-b px-2 py-2 text-right">
                      Previsões
                    </th>
                    <th className="border-b px-2 py-2 text-right">MAE</th>
                    <th className="border-b px-2 py-2 text-right">RMSE</th>
                    <th className="border-b px-2 py-2 text-right">Pearson</th>
                  </tr>
                </thead>
                <tbody>
                  {["GOL", "LAT", "ZAG", "MEI", "ATA", "TEC", "__UNKNOWN__"]
                    .filter((p) => result.user.byPosition[p] !== undefined)
                    .map((p) => {
                      const m = result.user.byPosition[p];
                      return (
                        <tr key={p}>
                          <td className="border-b px-2 py-1 font-mono">
                            {p === "__UNKNOWN__" ? "— (sem posição)" : p}
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {m.count}
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {fmt(m.mae, 3)}
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {fmt(m.rmse, 3)}
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {fmt(m.pearson, 3)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {result.user.byPosition["__UNKNOWN__"]?.count > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                ⚠️ {result.user.byPosition["__UNKNOWN__"].count} previsões sem
                posição definida no registro de teste.
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              Diagnóstico apenas. O ranking do Feature Search e as métricas
              gerais não usam estas informações.
            </p>
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
                value={
                  result.user.audit.trainTestFeatureCountMatch ? "OK" : "FAIL"
                }
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
                      {h.dMaeVsV12a === null ? "—" : h.dMaeVsV12a.toFixed(4)}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {h.dRmseVsV12a === null ? "—" : h.dRmseVsV12a.toFixed(4)}
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

      {/* ============== FEATURE SEARCH GLOBAL ============== */}
      <FeatureSearchSection />

      {/* ============== FEATURE SEARCH POR POSIÇÃO ============== */}
      <FeatureSearchByPositionSection />

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Laboratório experimental. Nenhuma versão anterior (v1, v1.1, v1.2,
        v1.2a, v2, v2.1, baseline, audit) foi alterada. O histórico é
        armazenado somente na sessão do navegador.
      </footer>
    </div>
  );
}

/* ---------------- Feature Search (global) ---------------- */

function FeatureSearchSection() {
  const [strategy, setStrategy] = useState<SearchStrategy>("beam");
  const [metric, setMetric] = useState<SearchMetric>("mae");
  const [beamWidth, setBeamWidth] = useState(10);
  const [maxFeatures, setMaxFeatures] = useState(20);
  const [minFeatures, setMinFeatures] = useState(1);
  const [maxExperiments, setMaxExperiments] = useState(5000);
  const [minRoundsBetter, setMinRoundsBetter] = useState(0);
  const [maxWorsening, setMaxWorsening] = useState(1.0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeatureSearchResult | null>(null);
  const [candidateState, setCandidateState] = useState<Record<string, boolean>>(
    () => {
      const m: Record<string, boolean> = {};
      for (const e of FEATURE_CATALOG) m[e.id] = true;
      return m;
    },
  );

  const candidateIds = FEATURE_CATALOG.filter((e) => candidateState[e.id]).map(
    (e) => e.id,
  );

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await runMLLabFeatureSearch({
        data: {
          strategy,
          metric,
          beamWidth,
          maxFeatures,
          minFeatures,
          maxExperiments,
          minRoundsBetterThanBaseline: minRoundsBetter,
          maxSingleRoundMAEWorsening: maxWorsening,
          lambda: 1.0,
          firstRound: 5,
          lastRound: 26,
          participationWindow: 12,
          candidateIds,
        },
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function toggleGroup(group: string, value: boolean) {
    setCandidateState((s) => {
      const next = { ...s };
      for (const e of FEATURE_CATALOG) {
        if (e.group === group) next[e.id] = value;
      }
      return next;
    });
  }

  function exportJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feature-search-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const groups = Array.from(new Set(FEATURE_CATALOG.map((e) => e.group)));

  return (
    <section className="space-y-4 rounded border-2 border-blue-200 p-4">
      <header>
        <h2 className="text-xl font-bold">Feature Search (global)</h2>
        <p className="text-sm text-muted-foreground">
          Busca automática de combinações. Resultados desta busca são
          exploratórios e podem sofrer overfitting ao período histórico
          utilizado.
        </p>
      </header>

      {/* Parâmetros */}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col text-sm">
          <span>Estratégia</span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SearchStrategy)}
            className="rounded border px-2 py-1"
          >
            <option value="exhaustive">Exhaustive</option>
            <option value="forward">Forward Selection</option>
            <option value="beam">Beam Search</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span>Métrica</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as SearchMetric)}
            className="rounded border px-2 py-1"
          >
            <option value="mae">MAE</option>
            <option value="rmse">RMSE</option>
            <option value="pearson">Pearson</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span>Beam width</span>
          <input
            type="number"
            value={beamWidth}
            onChange={(e) => setBeamWidth(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Max features</span>
          <input
            type="number"
            value={maxFeatures}
            onChange={(e) => setMaxFeatures(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Min features</span>
          <input
            type="number"
            value={minFeatures}
            onChange={(e) => setMinFeatures(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Max experiments</span>
          <input
            type="number"
            value={maxExperiments}
            onChange={(e) => setMaxExperiments(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Min rodadas melhores que BL</span>
          <input
            type="number"
            value={minRoundsBetter}
            onChange={(e) => setMinRoundsBetter(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Pior deterioração (fração)</span>
          <input
            type="number"
            step="0.05"
            value={maxWorsening}
            onChange={(e) => setMaxWorsening(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>

      {/* Candidatos */}
      <details className="rounded border">
        <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
          Candidatos ({candidateIds.length} / {FEATURE_CATALOG.length})
        </summary>
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <div key={g} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{g}</span>
                <button
                  onClick={() => toggleGroup(g, true)}
                  className="rounded border bg-muted px-1.5 py-0.5"
                >
                  +
                </button>
                <button
                  onClick={() => toggleGroup(g, false)}
                  className="rounded border bg-muted px-1.5 py-0.5"
                >
                  −
                </button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {FEATURE_CATALOG.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={candidateState[e.id] ?? false}
                  onChange={(ev) =>
                    setCandidateState((s) => ({
                      ...s,
                      [e.id]: ev.target.checked,
                    }))
                  }
                />
                <span className="font-mono">{e.id}</span>
              </label>
            ))}
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleRun}
          disabled={running || candidateIds.length === 0}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {running ? "Executando…" : "Executar Feature Search"}
        </button>
        {result && (
          <button
            onClick={exportJson}
            className="rounded border bg-muted px-3 py-1.5 text-sm"
          >
            Exportar JSON
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Card label="Experimentos" value={result.experimentCount} />
            <Card
              label="Cache (hit/miss)"
              value={`${result.cacheHits} / ${result.cacheMisses}`}
            />
            <Card
              label="Truncado por limite"
              value={result.truncatedToLimit ? "SIM" : "não"}
              tone={result.truncatedToLimit ? "warn" : "default"}
            />
            <Card
              label="Melhor MAE (top1)"
              value={result.best?.mae?.toFixed(4) ?? "—"}
            />
          </div>

          {/* Benchmarks */}
          <div>
            <h3 className="mb-2 font-semibold">Benchmarks</h3>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="border-b px-2 py-2 text-left">Fonte</th>
                    <th className="border-b px-2 py-2 text-right">Pred</th>
                    <th className="border-b px-2 py-2 text-right">MAE</th>
                    <th className="border-b px-2 py-2 text-right">RMSE</th>
                    <th className="border-b px-2 py-2 text-right">Pearson</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-b px-2 py-1">Baseline</td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.baseline.predictions}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.baseline.mae?.toFixed(4) ?? "—"}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.baseline.rmse?.toFixed(4) ?? "—"}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.baseline.pearson?.toFixed(4) ?? "—"}
                    </td>
                  </tr>
                  <tr>
                    <td className="border-b px-2 py-1">v1.2a</td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.v12a.predictions}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.v12a.mae?.toFixed(4) ?? "—"}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.v12a.rmse?.toFixed(4) ?? "—"}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {result.benchmarks.v12a.pearson?.toFixed(4) ?? "—"}
                    </td>
                  </tr>
                  {result.best && (
                    <tr className="bg-green-50">
                      <td className="border-b px-2 py-1 font-semibold">
                        Melhor combinação encontrada
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {result.best.predictions}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {result.best.mae?.toFixed(4) ?? "—"}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {result.best.rmse?.toFixed(4) ?? "—"}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {result.best.pearson?.toFixed(4) ?? "—"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* TOP 10 */}
          <div>
            <h3 className="mb-2 font-semibold">TOP 10</h3>
            <div className="space-y-1">
              {result.top.map((e, i) => (
                <div
                  key={e.featureIds.join("|")}
                  className="rounded border p-2 text-xs"
                >
                  <div className="font-semibold">
                    #{i + 1} — MAE {e.mae?.toFixed(4)} · RMSE{" "}
                    {e.rmse?.toFixed(4)} · Pearson {e.pearson?.toFixed(4)} ·{" "}
                    {e.featureCount} feats{" "}
                    {e.robust ? "🟢 ROBUSTA" : "🟠 INSTÁVEL"}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {e.featureIds.join(" | ")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* BOTTOM 10 */}
          <div>
            <h3 className="mb-2 font-semibold">BOTTOM 10</h3>
            <div className="space-y-1">
              {result.bottom.map((e, i) => (
                <div
                  key={e.featureIds.join("|")}
                  className="rounded border p-2 text-xs"
                >
                  <div className="font-semibold">
                    #{i + 1} — MAE {e.mae?.toFixed(4)} · RMSE{" "}
                    {e.rmse?.toFixed(4)} · Pearson {e.pearson?.toFixed(4)} ·{" "}
                    {e.featureCount} feats
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {e.featureIds.join(" | ")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Frequência */}
          <div>
            <h3 className="mb-2 font-semibold">
              Frequência nos TOP 10 / BOTTOM 10
            </h3>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="border-b px-2 py-2 text-left">feature</th>
                    <th className="border-b px-2 py-2 text-right">Top 10</th>
                    <th className="border-b px-2 py-2 text-right">% Top</th>
                    <th className="border-b px-2 py-2 text-right">Bottom 10</th>
                    <th className="border-b px-2 py-2 text-right">% Bottom</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frequency.slice(0, 30).map((f) => (
                    <tr key={f.featureId}>
                      <td className="border-b px-2 py-1 font-mono">
                        {f.featureId}
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {f.countTop}/10
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {(f.pctTop * 100).toFixed(0)}%
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {f.countBottom}/10
                      </td>
                      <td className="border-b px-2 py-1 text-right">
                        {(f.pctBottom * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Estágios */}
          <details className="rounded border">
            <summary className="cursor-pointer bg-muted px-3 py-2 text-xs">
              Progresso por estágio ({result.stages.length})
            </summary>
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-2 py-2 text-left">estágio</th>
                  <th className="border-b px-2 py-2 text-right">experimentos</th>
                  <th className="border-b px-2 py-2 text-right">melhor MAE</th>
                </tr>
              </thead>
              <tbody>
                {result.stages.map((s, i) => (
                  <tr key={i}>
                    <td className="border-b px-2 py-1">{s.stage}</td>
                    <td className="border-b px-2 py-1 text-right">
                      {s.experimentsRun}
                    </td>
                    <td className="border-b px-2 py-1 text-right">
                      {s.bestMAE?.toFixed(4) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="text-[10px] text-muted-foreground">
            Assinatura do contexto: <code>{result.signature}</code>
          </p>

          {/* ===== Rankings por posição (da busca global) ===== */}
          {result.positionRankings.length > 0 && (
            <PositionRankingsSection rankings={result.positionRankings} />
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- Feature Search por posição ---------------- */

function FeatureSearchByPositionSection() {
  const [strategy, setStrategy] = useState<SearchStrategy>("beam");
  const [metric, setMetric] = useState<SearchMetric>("mae");
  const [beamWidth, setBeamWidth] = useState(10);
  const [maxFeatures, setMaxFeatures] = useState(20);
  const [minFeatures, setMinFeatures] = useState(1);
  const [maxExperiments, setMaxExperiments] = useState(5000);
  const [minRoundsBetter, setMinRoundsBetter] = useState(0);
  const [maxWorsening, setMaxWorsening] = useState(1.0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PositionFeatureSearchResult[] | null>(
    null,
  );
  const [candidateState, setCandidateState] = useState<Record<string, boolean>>(
    () => {
      const m: Record<string, boolean> = {};
      for (const e of FEATURE_CATALOG) m[e.id] = true;
      // position é excluída das buscas por posição — não tem variância
      m.position = false;
      return m;
    },
  );

  const candidateIds = FEATURE_CATALOG.filter((e) => candidateState[e.id]).map(
    (e) => e.id,
  );

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await runMLLabPositionFeatureSearch({
        data: {
          strategy,
          metric,
          beamWidth,
          maxFeatures,
          minFeatures,
          maxExperiments,
          minRoundsBetterThanBaseline: minRoundsBetter,
          maxSingleRoundMAEWorsening: maxWorsening,
          lambda: 1.0,
          firstRound: 5,
          lastRound: 26,
          participationWindow: 12,
          candidateIds,
          positions: ["GOL", "LAT", "ZAG", "MEI", "ATA"],
        },
      });
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function toggleGroup(group: string, value: boolean) {
    setCandidateState((s) => {
      const next = { ...s };
      for (const e of FEATURE_CATALOG) {
        if (e.group === group) next[e.id] = value;
      }
      // position continua excluída neste modo
      next.position = false;
      return next;
    });
  }

  const groups = Array.from(new Set(FEATURE_CATALOG.map((e) => e.group)));
  const positionCandidates = candidateIds.filter((id) => id !== "position");

  return (
    <section className="space-y-4 rounded border-2 border-purple-200 p-4">
      <header>
        <h2 className="text-xl font-bold">Feature Search por posição</h2>
        <p className="text-sm text-muted-foreground">
          Executa uma busca independente para cada posição (GOL, LAT, ZAG,
          MEI, ATA). Diferente do ranking por posição do painel global —
          que apenas filtra as previsões já feitas — aqui o <strong>Ridge é
          treinado separadamente por posição</strong>: o treino usa somente
          jogadores daquela posição, o vocabulário categórico é reconstruído
          apenas com o treino daquela posição, e as métricas comparam apenas
          contra o baseline daquela posição. A feature <code>position</code>{" "}
          é automaticamente removida dos candidatos (variância zero dentro
          de uma única posição). Resultados são exploratórios e podem sofrer
          overfitting ao período histórico utilizado.
        </p>
      </header>

      {/* Parâmetros */}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col text-sm">
          <span>Estratégia</span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as SearchStrategy)}
            className="rounded border px-2 py-1"
          >
            <option value="exhaustive">Exhaustive</option>
            <option value="forward">Forward Selection</option>
            <option value="beam">Beam Search</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span>Métrica</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as SearchMetric)}
            className="rounded border px-2 py-1"
          >
            <option value="mae">MAE</option>
            <option value="rmse">RMSE</option>
            <option value="pearson">Pearson</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span>Beam width</span>
          <input
            type="number"
            value={beamWidth}
            onChange={(e) => setBeamWidth(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Max features</span>
          <input
            type="number"
            value={maxFeatures}
            onChange={(e) => setMaxFeatures(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Min features</span>
          <input
            type="number"
            value={minFeatures}
            onChange={(e) => setMinFeatures(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Max experiments (por posição)</span>
          <input
            type="number"
            value={maxExperiments}
            onChange={(e) => setMaxExperiments(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Min rodadas melhores que BL</span>
          <input
            type="number"
            value={minRoundsBetter}
            onChange={(e) => setMinRoundsBetter(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span>Pior deterioração (fração)</span>
          <input
            type="number"
            step="0.05"
            value={maxWorsening}
            onChange={(e) => setMaxWorsening(Number(e.target.value))}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>

      {/* Candidatos */}
      <details className="rounded border">
        <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
          Candidatos ({positionCandidates.length} / {FEATURE_CATALOG.length - 1}) — position é sempre excluída neste modo
        </summary>
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <div key={g} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{g}</span>
                <button
                  onClick={() => toggleGroup(g, true)}
                  className="rounded border bg-muted px-1.5 py-0.5"
                >
                  +
                </button>
                <button
                  onClick={() => toggleGroup(g, false)}
                  className="rounded border bg-muted px-1.5 py-0.5"
                >
                  −
                </button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {FEATURE_CATALOG.map((e) => {
              const disabled = e.id === "position";
              return (
                <label
                  key={e.id}
                  className={`flex items-center gap-2 text-xs ${
                    disabled ? "opacity-50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!disabled && (candidateState[e.id] ?? false)}
                    disabled={disabled}
                    onChange={(ev) =>
                      setCandidateState((s) => ({
                        ...s,
                        [e.id]: ev.target.checked,
                      }))
                    }
                  />
                  <span className="font-mono">{e.id}</span>
                </label>
              );
            })}
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleRun}
          disabled={running || positionCandidates.length === 0}
          className="rounded bg-purple-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {running
            ? "Executando por posição…"
            : "Executar Feature Search por posição"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {results && (
        <div className="space-y-4">
          {/* Resumo */}
          <div>
            <h3 className="mb-2 font-semibold">Resumo por posição</h3>
            <div className="overflow-x-auto rounded border">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="border-b px-2 py-2 text-left">Posição</th>
                    <th className="border-b px-2 py-2 text-right">
                      Experimentos
                    </th>
                    <th className="border-b px-2 py-2 text-right">
                      Treino (linhas)
                    </th>
                    <th className="border-b px-2 py-2 text-right">
                      Teste (linhas)
                    </th>
                    <th className="border-b px-2 py-2 text-right">Melhor MAE</th>
                    <th className="border-b px-2 py-2 text-right">
                      Melhor RMSE
                    </th>
                    <th className="border-b px-2 py-2 text-right">
                      Melhor Pearson
                    </th>
                    <th className="border-b px-2 py-2 text-right">
                      Baseline MAE
                    </th>
                    <th className="border-b px-2 py-2 text-right">
                      v1.2a MAE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const s = r.search;
                    const trainRows = s
                      ? Object.values(s.trainRowsByPosition).reduce(
                          (a, b) => a + b,
                          0,
                        )
                      : 0;
                    const testRows = s
                      ? Object.values(s.testRowsByPosition).reduce(
                          (a, b) => a + b,
                          0,
                        )
                      : 0;
                    return (
                      <tr key={r.position}>
                        <td className="border-b px-2 py-1 font-mono font-semibold">
                          {r.position}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s ? s.experimentCount : "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s ? trainRows : "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s ? testRows : "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s?.best?.mae?.toFixed(4) ?? "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s?.best?.rmse?.toFixed(4) ?? "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s?.best?.pearson?.toFixed(4) ?? "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s?.benchmarks.baseline.mae?.toFixed(4) ?? "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right">
                          {s?.benchmarks.v12a.mae?.toFixed(4) ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Treino/Teste = soma das linhas através dos folds (uma linha
              pode aparecer como treino em várias rodadas posteriores).
            </p>
          </div>

          {/* Por posição em detalhes */}
          {results.map((r) => {
            const s = r.search;
            return (
              <details key={r.position} className="rounded border">
                <summary className="cursor-pointer bg-muted px-3 py-2 text-sm font-semibold">
                  {r.position}
                  {s?.best
                    ? ` — Melhor MAE ${s.best.mae?.toFixed(4) ?? "—"}`
                    : ""}
                  {r.error ? ` — ERRO: ${r.error}` : ""}
                </summary>

                {r.error && !s && (
                  <div className="p-3 text-xs text-red-800">
                    Esta posição não pôde ser avaliada: {r.error}
                  </div>
                )}

                {s && (
                  <div className="space-y-3 p-3">
                    {/* Estatísticas do universo */}
                    <div className="grid gap-2 sm:grid-cols-4">
                      <Card label="Experimentos" value={s.experimentCount} />
                      <Card
                        label="Teste (linhas)"
                        value={Object.values(s.testRowsByPosition).reduce(
                          (a, b) => a + b,
                          0,
                        )}
                      />
                      <Card
                        label="Cache hit/miss"
                        value={`${s.cacheHits}/${s.cacheMisses}`}
                      />
                      <Card
                        label="Truncado"
                        value={s.truncatedToLimit ? "SIM" : "não"}
                        tone={s.truncatedToLimit ? "warn" : "default"}
                      />
                    </div>

                    {/* Benchmarks */}
                    <div>
                      <h4 className="mb-1 text-xs font-semibold">
                        Benchmarks ({r.position})
                      </h4>
                      <div className="overflow-x-auto rounded border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-muted">
                            <tr>
                              <th className="border-b px-2 py-1 text-left">
                                Fonte
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                Pred
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                MAE
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                RMSE
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                Pearson
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="border-b px-2 py-1">
                                Baseline ({r.position})
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.baseline.predictions}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.baseline.mae?.toFixed(4) ?? "—"}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.baseline.rmse?.toFixed(4) ?? "—"}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.baseline.pearson?.toFixed(4) ??
                                  "—"}
                              </td>
                            </tr>
                            <tr>
                              <td className="border-b px-2 py-1">
                                v1.2a ({r.position})
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.v12a.predictions}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.v12a.mae?.toFixed(4) ?? "—"}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.v12a.rmse?.toFixed(4) ?? "—"}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {s.benchmarks.v12a.pearson?.toFixed(4) ?? "—"}
                              </td>
                            </tr>
                            {s.best && (
                              <tr className="bg-green-50">
                                <td className="border-b px-2 py-1 font-semibold">
                                  Melhor {r.position}
                                </td>
                                <td className="border-b px-2 py-1 text-right">
                                  {s.best.predictions}
                                </td>
                                <td className="border-b px-2 py-1 text-right">
                                  {s.best.mae?.toFixed(4) ?? "—"}
                                </td>
                                <td className="border-b px-2 py-1 text-right">
                                  {s.best.rmse?.toFixed(4) ?? "—"}
                                </td>
                                <td className="border-b px-2 py-1 text-right">
                                  {s.best.pearson?.toFixed(4) ?? "—"}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* TOP 10 */}
                    <div>
                      <h4 className="mb-1 text-xs font-semibold">
                        TOP 10 — {r.position}
                      </h4>
                      <div className="space-y-1">
                        {s.top.map((e, i) => (
                          <div
                            key={e.featureIds.join("|")}
                            className="rounded border p-2 text-xs"
                          >
                            <div className="font-semibold">
                              #{i + 1} — MAE {e.mae?.toFixed(4) ?? "—"} · RMSE{" "}
                              {e.rmse?.toFixed(4) ?? "—"} · Pearson{" "}
                              {e.pearson?.toFixed(4) ?? "—"} ·{" "}
                              {e.featureCount} feats{" "}
                              {e.robust ? "🟢 ROBUSTA" : "🟠 INSTÁVEL"}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {e.featureIds.join(" | ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Frequência */}
                    <div>
                      <h4 className="mb-1 text-xs font-semibold">
                        Frequência no TOP 10 — {r.position}
                      </h4>
                      <div className="overflow-x-auto rounded border">
                        <table className="min-w-full text-xs">
                          <thead className="bg-muted">
                            <tr>
                              <th className="border-b px-2 py-1 text-left">
                                feature
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                count
                              </th>
                              <th className="border-b px-2 py-1 text-right">
                                %
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.frequency
                              .filter((f) => f.countTop > 0)
                              .slice(0, 20)
                              .map((f) => (
                                <tr key={f.featureId}>
                                  <td className="border-b px-2 py-1 font-mono">
                                    {f.featureId}
                                  </td>
                                  <td className="border-b px-2 py-1 text-right">
                                    {f.countTop}/10
                                  </td>
                                  <td className="border-b px-2 py-1 text-right">
                                    {(f.pctTop * 100).toFixed(0)}%
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Estágios */}
                    <details className="rounded border">
                      <summary className="cursor-pointer bg-muted px-2 py-1 text-xs">
                        Estágios ({s.stages.length})
                      </summary>
                      <table className="min-w-full text-xs">
                        <thead className="bg-muted">
                          <tr>
                            <th className="border-b px-2 py-1 text-left">
                              estágio
                            </th>
                            <th className="border-b px-2 py-1 text-right">
                              experimentos
                            </th>
                            <th className="border-b px-2 py-1 text-right">
                              melhor MAE
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.stages.map((st, i) => (
                            <tr key={i}>
                              <td className="border-b px-2 py-1">{st.stage}</td>
                              <td className="border-b px-2 py-1 text-right">
                                {st.experimentsRun}
                              </td>
                              <td className="border-b px-2 py-1 text-right">
                                {st.bestMAE?.toFixed(4) ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>

                    <p className="text-[10px] text-muted-foreground">
                      Assinatura: <code>{s.signature}</code>
                    </p>
                  </div>
                )}
              </details>
            );
          })}

          {/* Auditoria */}
          <details className="rounded border border-amber-200 bg-amber-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-900">
              Auditoria — Feature Search por posição
            </summary>
            <div className="space-y-1 p-3 text-xs text-amber-900">
              {results.map((r) => {
                const s = r.search;
                if (!s) {
                  return (
                    <div key={r.position}>
                      <strong>{r.position}</strong> — sem resultado ({r.error})
                    </div>
                  );
                }
                const positionsInTest = Object.keys(s.testRowsByPosition);
                const foreignPositions = positionsInTest.filter(
                  (p) => p !== r.position && p !== "__UNKNOWN__",
                );
                const noLeak =
                  s.positionFilter === r.position &&
                  Object.keys(s.trainRowsByPosition).every(
                    (p) => p === r.position || p === "__UNKNOWN__",
                  );
                return (
                  <div key={r.position}>
                    <strong>{r.position}</strong> — filtro={s.positionFilter} ·
                    treino positions=[{Object.keys(s.trainRowsByPosition).join(",")}] ·
                    teste positions=[{positionsInTest.join(",")}] ·
                    posições estranhas={foreignPositions.length === 0 ? "OK" : foreignPositions.join(",")} ·
                    sem leakage={noLeak ? "OK" : "FAIL"}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

/* ---------------- Rankings por posição (busca global) ---------------- */

function PositionRankingsSection({
  rankings,
}: {
  rankings: PositionRankings[];
}) {
  const POSITION_ICON: Record<string, string> = {
    GOL: "🧤",
    LAT: "🏃",
    ZAG: "🧱",
    MEI: "🎯",
    ATA: "⚡",
    TEC: "🧑‍🏫",
    __UNKNOWN__: "❓",
  };

  function label(pos: string): string {
    return pos === "__UNKNOWN__" ? "— (sem posição)" : pos;
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="mb-1 text-lg font-bold">
          Melhores combinações por posição (a partir da busca global)
        </h3>
        <p className="text-xs text-muted-foreground">
          Rankings derivados dos mesmos experimentos da busca global. Aqui o
          Ridge NÃO é reexecutado por posição — a divisão acontece sobre as
          previsões já calculadas. Para treinar o modelo separadamente por
          posição, use a seção "Feature Search por posição" abaixo.
        </p>
      </header>

      {/* Resumo */}
      <div>
        <h4 className="mb-2 font-semibold">Resumo</h4>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">Posição</th>
                <th className="border-b px-2 py-2 text-right">Predições</th>
                <th className="border-b px-2 py-2 text-right">Melhor MAE</th>
                <th className="border-b px-2 py-2 text-right">Melhor RMSE</th>
                <th className="border-b px-2 py-2 text-right">
                  Melhor Pearson
                </th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((r) => (
                <tr key={r.position}>
                  <td className="border-b px-2 py-1 font-mono">
                    {POSITION_ICON[r.position] ?? ""} {label(r.position)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.predictions}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.bestMae?.toFixed(4) ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.bestRmse?.toFixed(4) ?? "—"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {r.bestPearson?.toFixed(4) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* TOP 10 + Frequência por posição */}
      {rankings.map((r) => (
        <details key={r.position} className="rounded border">
          <summary className="cursor-pointer bg-muted px-3 py-2 text-sm font-semibold">
            {POSITION_ICON[r.position] ?? ""} {label(r.position)} — TOP 10
          </summary>
          <div className="space-y-3 p-3">
            <div className="space-y-1">
              {r.top.map((e) => (
                <div
                  key={e.featureIds.join("|")}
                  className="rounded border p-2 text-xs"
                >
                  <div className="font-semibold">
                    #{e.rank} — MAE {e.mae?.toFixed(4) ?? "—"} · RMSE{" "}
                    {e.rmse?.toFixed(4) ?? "—"} · Pearson{" "}
                    {e.pearson?.toFixed(4) ?? "—"} · {e.featureCount} feats ·{" "}
                    {e.predictions} preds{" "}
                    {e.robust ? "🟢 ROBUSTA" : "🟠 INSTÁVEL"}
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {e.featureIds.join(" | ")}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h5 className="mb-1 text-xs font-semibold">
                Frequência no TOP 10 — {label(r.position)}
              </h5>
              <div className="overflow-x-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="border-b px-2 py-1 text-left">feature</th>
                      <th className="border-b px-2 py-1 text-right">count</th>
                      <th className="border-b px-2 py-1 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.frequency
                      .filter((f) => f.countTop > 0)
                      .slice(0, 20)
                      .map((f) => (
                        <tr key={f.featureId}>
                          <td className="border-b px-2 py-1 font-mono">
                            {f.featureId}
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {f.countTop}/10
                          </td>
                          <td className="border-b px-2 py-1 text-right">
                            {(f.pctTop * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </details>
      ))}

      {/* Auditoria simples */}
      <details className="rounded border border-amber-200 bg-amber-50">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-900">
          Auditoria — rankings por posição
        </summary>
        <div className="space-y-1 p-3 text-xs text-amber-900">
          {rankings.map((r) => {
            const badMetrics =
              (r.bestMae !== null && !Number.isFinite(r.bestMae)) ||
              (r.bestRmse !== null && !Number.isFinite(r.bestRmse)) ||
              (r.bestPearson !== null && !Number.isFinite(r.bestPearson));
            const badPred = !Number.isInteger(r.predictions) || r.predictions < 0;
            return (
              <div key={r.position}>
                <strong>{label(r.position)}</strong> — preds={" "}
                {r.predictions} ({badPred ? "❌" : "OK"}) · métricas={" "}
                {badMetrics ? "❌ NaN/Inf" : "OK"} · experimentos elegíveis={" "}
                {r.top.length > 0 ? ">0" : "0"}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
