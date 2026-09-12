// src/routes/ml-r6-audit.tsx

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Partida } from "@/lib/cartola/types";
import {
  buildHistoriesFromRawRounds,
  type RawPontuadosRound,
} from "@/lib/data/historical.functions";
import { buildTrainingDatasetFromHistories } from "@/lib/ml/features.functions";
import type { TrainingFeatureRow } from "@/lib/ml/features.types";
import { predictByRecentAverage } from "@/lib/backtest/baseline";
import { mae, rmse } from "@/lib/backtest/metrics";
import {
  computeMeansAndStds,
  fitRidge,
  imputeAndStandardize,
  predictRidge,
} from "@/lib/ml/model.functions";

/* ------------------------------------------------------------------ *
 * Fetch + cache inline (mesma política do api.functions.ts, mas em
 * cache separado para não interferir em /ml-v1).
 * ------------------------------------------------------------------ */

const BASE = "https://api.cartola.globo.com";
const cache = new Map<string, { value: unknown; expiresAt: number }>();

async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CartolaIA/audit/1.0",
    },
  });
  if (!res.ok) throw new Error(`Cartola API ${path} respondeu ${res.status}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ *
 * Feature extraction — cópia idêntica à usada em evaluation.functions.ts
 * ------------------------------------------------------------------ */

const NUMERIC_FEATURES = [
  "clubId",
  "isHome",
  "opponentClubId",
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
] as const;

const POSITIONS = ["GOL", "LAT", "ZAG", "MEI", "ATA", "TEC"] as const;

const FEATURE_NAMES_ALL: string[] = [
  ...NUMERIC_FEATURES,
  ...POSITIONS.slice(0, -1).map((p) => `position_${p}`),
];

function extractFeatureVector(row: TrainingFeatureRow): (number | null)[] {
  const out: (number | null)[] = [];
  const rec = row as unknown as Record<string, unknown>;
  for (const f of NUMERIC_FEATURES) {
    const v = rec[f];
    if (typeof v === "number") out.push(v);
    else if (typeof v === "boolean") out.push(v ? 1 : 0);
    else out.push(null);
  }
  const pos = row.position;
  for (let i = 0; i < POSITIONS.length - 1; i++) {
    out.push(pos === POSITIONS[i] ? 1 : pos === null ? null : 0);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

interface TopError {
  playerId: number;
  apelido: string | null;
  actual: number;
  mlPredicted: number;
  mlAbsError: number;
  baselinePredicted: number;
  baselineAbsError: number;
}

interface FeatureDetail {
  playerId: number;
  apelido: string | null;
  actual: number;
  mlPredicted: number;
  priorRoundsAvailable: number[];
  priorParticipations: number[];
  nullFeatureNames: string[];
  featureValues: {
    name: string;
    value: number | null;
    standardized: number | null;
  }[];
}

interface ImputationRow {
  featureName: string;
  trainMean: number;
  trainStd: number;
  suspiciousSmallStd: boolean;
}

interface ExtremeStd {
  playerId: number;
  featureName: string;
  rawValue: number | null;
  standardizedValue: number;
}

interface DistStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
}

interface ErrorStats {
  mae: number | null;
  rmse: number | null;
  maxAbsError: number;
  errorsGT5: number;
  errorsGT10: number;
  errorsGT15: number;
  errorsGT20: number;
  negativePredictionCount: number;
  predictionAbove20Count: number;
}

interface ColdStartBucket {
  priorRoundsCount: number;
  playerCount: number;
  mlMae: number | null;
  mlRmse: number | null;
  baselineMae: number | null;
  baselineRmse: number | null;
}

interface R6AuditResult {
  round: number;
  testSize: number;
  trainSize: number;
  top20Errors: TopError[];
  top20FeatureDetails: FeatureDetail[];
  imputation: ImputationRow[];
  extremeStandardized: ExtremeStd[];
  mlStats: DistStats;
  baselineStats: DistStats;
  actualStats: DistStats;
  errorStats: ErrorStats;
  coldStartBuckets: ColdStartBucket[];
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function describe(arr: number[]): DistStats {
  if (arr.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      p25: 0,
      p75: 0,
    };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median,
    p25: sorted[Math.floor(0.25 * (sorted.length - 1))],
    p75: sorted[Math.floor(0.75 * (sorted.length - 1))],
  };
}

/* ------------------------------------------------------------------ *
 * Server function
 * ------------------------------------------------------------------ */

const R6AuditInput = z.object({
  targetRound: z.number().int().min(2).default(6),
  participationWindow: z.number().int().min(1).default(12),
  lambda: z.number().min(0).default(1.0),
});

export const auditR6 = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => R6AuditInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<R6AuditResult> => {
    const R = data.targetRound;
    const roundsToFetch: number[] = [];
    for (let r = 1; r <= R; r++) roundsToFetch.push(r);

    const [rawRounds, fixturesRaw] = await Promise.all([
      Promise.all(
        roundsToFetch.map((r) =>
          cached(`audit:pontuados:${r}`, 30 * 60_000, () =>
            getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(
              () => ({ rodada: r, atletas: {} }),
            ),
          ),
        ),
      ),
      Promise.all(
        roundsToFetch.map((r) =>
          cached(`audit:partidas:${r}`, 30 * 60_000, () =>
            getJson<{ partidas: Partida[] }>(`/partidas/${r}`).catch(() => ({
              partidas: [],
            })),
          ),
        ),
      ),
    ]);

    const fixturesByRound = new Map<number, Partida[]>();
    roundsToFetch.forEach((r, i) => {
      fixturesByRound.set(r, fixturesRaw[i].partidas ?? []);
    });

    const histories = buildHistoriesFromRawRounds(rawRounds);
    const historyByPlayer = new Map<number, (typeof histories)[number]>();
    for (const h of histories) historyByPlayer.set(h.playerId, h);

    const dataset = buildTrainingDatasetFromHistories({
      firstRound: 1,
      lastRound: R,
      histories,
      fixturesByRound,
    });

    // -------- Treino: rodadas < R (apenas participações) --------
    const trainRows = dataset.rows.filter(
      (x) => x.round < R && x.target_participated,
    );

    // -------- Teste: rodada === R, mesma filtragem do baseline --------
    const testCandidates = dataset.rows.filter(
      (x) => x.round === R && x.target_participated,
    );

    const testRows: TrainingFeatureRow[] = [];
    const baselinePreds: number[] = [];
    for (const row of testCandidates) {
      const h = historyByPlayer.get(row.playerId);
      if (!h) continue;
      const pred = predictByRecentAverage(h, R, data.participationWindow);
      if (pred === null) continue;
      testRows.push(row);
      baselinePreds.push(pred);
    }

    // -------- Pipeline idêntico ao ML v1 --------
    const XtrainRaw = trainRows.map(extractFeatureVector);
    const yTrain = trainRows.map((x) => x.target_points);
    const XtestRaw = testRows.map(extractFeatureVector);

    const { means, stds } = computeMeansAndStds(XtrainRaw);
    const Xtrain = imputeAndStandardize(XtrainRaw, means, stds);
    const Xtest = imputeAndStandardize(XtestRaw, means, stds);

    const { weights, intercept } = fitRidge(Xtrain, yTrain, data.lambda);
    const mlPreds = predictRidge({ weights, intercept }, Xtest);

    const actuals = testRows.map((x) => x.target_points);

    // -------- Apelidos --------
    const targetRaw = rawRounds.find((r) => r.rodada === R);
    const apelidoByPlayer = new Map<number, string>();
    if (targetRaw) {
      for (const [idStr, atleta] of Object.entries(targetRaw.atletas)) {
        const id = Number(idStr);
        if (atleta.apelido) apelidoByPlayer.set(id, atleta.apelido);
      }
    }

    // -------- Top 20 erros absolutos --------
    const indexed = testRows.map((row, i) => ({
      row,
      ml: mlPreds[i],
      baseline: baselinePreds[i],
      actual: actuals[i],
    }));
    indexed.sort(
      (a, b) =>
        Math.abs(b.ml - b.actual) - Math.abs(a.ml - a.actual),
    );
    const top20 = indexed.slice(0, 20);

    const top20Errors: TopError[] = top20.map((x) => ({
      playerId: x.row.playerId,
      apelido: apelidoByPlayer.get(x.row.playerId) ?? null,
      actual: x.actual,
      mlPredicted: x.ml,
      mlAbsError: Math.abs(x.ml - x.actual),
      baselinePredicted: x.baseline,
      baselineAbsError: Math.abs(x.baseline - x.actual),
    }));

    // -------- Feature details para o top 20 --------
    const top20FeatureDetails: FeatureDetail[] = top20.map((x) => {
      const idx = testRows.indexOf(x.row);
      const rawVec = XtestRaw[idx];
      const stdVec = Xtest[idx];
      const h = historyByPlayer.get(x.row.playerId);
      const priorRounds = h
        ? h.rounds.filter((r) => r.round < R).map((r) => r.round).sort((a, b) => a - b)
        : [];
      const priorPart = h
        ? h.rounds
            .filter((r) => r.round < R && r.participated)
            .map((r) => r.round)
            .sort((a, b) => a - b)
        : [];
      const nullFeatureNames: string[] = [];
      const featureValues = FEATURE_NAMES_ALL.map((name, i) => {
        const v = rawVec[i];
        const s = stdVec[i];
        if (v === null) nullFeatureNames.push(name);
        return { name, value: v, standardized: s };
      });
      return {
        playerId: x.row.playerId,
        apelido: apelidoByPlayer.get(x.row.playerId) ?? null,
        actual: x.actual,
        mlPredicted: x.ml,
        priorRoundsAvailable: priorRounds,
        priorParticipations: priorPart,
        nullFeatureNames,
        featureValues,
      };
    });

    // -------- Imputation info --------
    const imputation: ImputationRow[] = FEATURE_NAMES_ALL.map((name, i) => ({
      featureName: name,
      trainMean: means[i],
      trainStd: stds[i],
      suspiciousSmallStd: stds[i] < 0.01,
    }));

    // -------- Extreme standardized --------
    const extremeCandidates: ExtremeStd[] = [];
    for (let i = 0; i < Xtest.length; i++) {
      const playerId = testRows[i].playerId;
      for (let j = 0; j < Xtest[i].length; j++) {
        const s = Xtest[i][j];
        if (Math.abs(s) > 5) {
          extremeCandidates.push({
            playerId,
            featureName: FEATURE_NAMES_ALL[j],
            rawValue: XtestRaw[i][j],
            standardizedValue: s,
          });
        }
      }
    }
    extremeCandidates.sort(
      (a, b) =>
        Math.abs(b.standardizedValue) - Math.abs(a.standardizedValue),
    );
    const extremeStandardized = extremeCandidates.slice(0, 20);

    // -------- Distribuições --------
    const mlStats = describe(mlPreds);
    const baselineStats = describe(baselinePreds);
    const actualStats = describe(actuals);

    // -------- Erros --------
    const absErrors = mlPreds.map((p, i) => Math.abs(p - actuals[i]));
    const errorStats: ErrorStats = {
      mae: mae(mlPreds, actuals),
      rmse: rmse(mlPreds, actuals),
      maxAbsError: absErrors.length > 0 ? Math.max(...absErrors) : 0,
      errorsGT5: absErrors.filter((e) => e > 5).length,
      errorsGT10: absErrors.filter((e) => e > 10).length,
      errorsGT15: absErrors.filter((e) => e > 15).length,
      errorsGT20: absErrors.filter((e) => e > 20).length,
      negativePredictionCount: mlPreds.filter((p) => p < 0).length,
      predictionAbove20Count: mlPreds.filter((p) => p > 20).length,
    };

    // -------- Cold start buckets --------
    const bucketMap = new Map<number, typeof indexed>();
    for (const item of indexed) {
      const h = historyByPlayer.get(item.row.playerId);
      const nPrior = h
        ? h.rounds.filter((r) => r.round < R).length
        : 0;
      const key = Math.min(5, nPrior);
      const arr = bucketMap.get(key) ?? [];
      arr.push(item);
      bucketMap.set(key, arr);
    }
    const coldStartBuckets: ColdStartBucket[] = [];
    for (let k = 0; k <= 5; k++) {
      const bucket = bucketMap.get(k) ?? [];
      if (bucket.length === 0) {
        coldStartBuckets.push({
          priorRoundsCount: k,
          playerCount: 0,
          mlMae: null,
          mlRmse: null,
          baselineMae: null,
          baselineRmse: null,
        });
        continue;
      }
      const mlB = bucket.map((x) => x.ml);
      const blB = bucket.map((x) => x.baseline);
      const acB = bucket.map((x) => x.actual);
      coldStartBuckets.push({
        priorRoundsCount: k,
        playerCount: bucket.length,
        mlMae: mae(mlB, acB),
        mlRmse: rmse(mlB, acB),
        baselineMae: mae(blB, acB),
        baselineRmse: rmse(blB, acB),
      });
    }

    return {
      round: R,
      testSize: testRows.length,
      trainSize: trainRows.length,
      top20Errors,
      top20FeatureDetails,
      imputation,
      extremeStandardized,
      mlStats,
      baselineStats,
      actualStats,
      errorStats,
      coldStartBuckets,
    };
  });

/* ------------------------------------------------------------------ *
 * Route + UI
 * ------------------------------------------------------------------ */

type LoaderData =
  | { ok: true; result: R6AuditResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/ml-r6-audit")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await auditR6({
        data: { targetRound: 6, participationWindow: 12, lambda: 1.0 },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: R6AuditPage,
});

function fmt(v: number | null, d = 3): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
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

function R6AuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">Auditoria R6 (temporário)</h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const r = data.result;

  return (
    <div className="container mx-auto max-w-7xl space-y-8 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          Auditoria R{r.round} (temporário)
        </h1>
        <p className="text-sm text-muted-foreground">
          Reproduz o pipeline do ML v1 para a R{r.round}, expondo internals:
          treino com {r.trainSize} linhas, teste com {r.testSize} linhas.
        </p>
      </header>

      {/* 1. Top 20 erros */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          1. Top 20 maiores erros absolutos (Ridge)
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">playerId</th>
                <th className="border-b px-2 py-2 text-left">apelido</th>
                <th className="border-b px-2 py-2 text-right">real</th>
                <th className="border-b px-2 py-2 text-right">Ridge</th>
                <th className="border-b px-2 py-2 text-right">|erro|</th>
                <th className="border-b px-2 py-2 text-right">baseline</th>
                <th className="border-b px-2 py-2 text-right">|erro| BL</th>
              </tr>
            </thead>
            <tbody>
              {r.top20Errors.map((e) => (
                <tr key={e.playerId}>
                  <td className="border-b px-2 py-1 font-mono">{e.playerId}</td>
                  <td className="border-b px-2 py-1">{e.apelido ?? "—"}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(e.actual, 2)}</td>
                  <td className="border-b px-2 py-1 text-right font-semibold text-red-700">
                    {fmt(e.mlPredicted, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right font-semibold">
                    {fmt(e.mlAbsError, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(e.baselinePredicted, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmt(e.baselineAbsError, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Detalhes de features dos top 20 */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          2. Detalhes de features dos top 20
        </h2>
        <div className="space-y-3">
          {r.top20FeatureDetails.map((d) => (
            <details key={d.playerId} className="rounded border">
              <summary className="cursor-pointer bg-muted px-3 py-2 text-sm">
                {d.apelido ?? "?"} ({d.playerId}) — real {fmt(d.actual, 2)} · Ridge{" "}
                {fmt(d.mlPredicted, 2)}
              </summary>
              <div className="space-y-2 p-3 text-xs">
                <div>
                  <div className="font-semibold">Rodadas anteriores no histórico:</div>
                  <div className="font-mono">
                    {d.priorRoundsAvailable.length === 0
                      ? "(nenhuma)"
                      : d.priorRoundsAvailable.join(", ")}
                  </div>
                </div>
                <div>
                  <div className="font-semibold">Participações anteriores:</div>
                  <div className="font-mono">
                    {d.priorParticipations.length === 0
                      ? "(nenhuma)"
                      : d.priorParticipations.join(", ")}
                  </div>
                </div>
                <div>
                  <div className="font-semibold">Features null:</div>
                  <div className="font-mono">
                    {d.nullFeatureNames.length === 0
                      ? "(nenhuma)"
                      : d.nullFeatureNames.join(", ")}
                  </div>
                </div>
                <div>
                  <div className="font-semibold">
                    Valores por feature (raw / standardized):
                  </div>
                  <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                    {d.featureValues.map((fv) => (
                      <div key={fv.name} className="font-mono">
                        {fv.name}: {fv.value === null ? "null" : fv.value.toFixed(3)}{" "}
                        /{" "}
                        <span
                          className={
                            fv.standardized !== null &&
                            Math.abs(fv.standardized) > 5
                              ? "text-red-700 font-semibold"
                              : ""
                          }
                        >
                          {fv.standardized === null
                            ? "—"
                            : fv.standardized.toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* 3. Imputation / standardization info */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          3. Média / desvio usados na imputação e padronização
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">feature</th>
                <th className="border-b px-2 py-2 text-right">trainMean</th>
                <th className="border-b px-2 py-2 text-right">trainStd</th>
                <th className="border-b px-2 py-2 text-left">flag</th>
              </tr>
            </thead>
            <tbody>
              {r.imputation.map((x) => (
                <tr key={x.featureName}>
                  <td className="border-b px-2 py-1 font-mono">{x.featureName}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.trainMean, 4)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.trainStd, 6)}</td>
                  <td className="border-b px-2 py-1">
                    {x.suspiciousSmallStd && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                        STD MUITO PEQUENO
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3b. Extreme standardized */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          3b. Valores padronizados extremos (|z| &gt; 5)
        </h2>
        {r.extremeStandardized.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum valor com |z| &gt; 5 no teste.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="border-b px-2 py-2 text-left">playerId</th>
                  <th className="border-b px-2 py-2 text-left">feature</th>
                  <th className="border-b px-2 py-2 text-right">raw</th>
                  <th className="border-b px-2 py-2 text-right">z</th>
                </tr>
              </thead>
              <tbody>
                {r.extremeStandardized.map((x, i) => (
                  <tr key={`${x.playerId}-${x.featureName}-${i}`}>
                    <td className="border-b px-2 py-1 font-mono">{x.playerId}</td>
                    <td className="border-b px-2 py-1 font-mono">{x.featureName}</td>
                    <td className="border-b px-2 py-1 text-right">
                      {x.rawValue === null ? "null" : x.rawValue.toFixed(3)}
                    </td>
                    <td className="border-b px-2 py-1 text-right font-semibold text-red-700">
                      {x.standardizedValue.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Stats de previsão */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          4. Distribuição das previsões do Ridge na R{r.round}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card label="mlPreds count" value={r.mlStats.count} />
          <Card label="mlPreds min" value={fmt(r.mlStats.min, 3)} tone={r.mlStats.min < -5 ? "bad" : "default"} />
          <Card label="mlPreds max" value={fmt(r.mlStats.max, 3)} tone={r.mlStats.max > 30 ? "bad" : "default"} />
          <Card label="mlPreds mean" value={fmt(r.mlStats.mean, 3)} />
          <Card label="mlPreds median" value={fmt(r.mlStats.median, 3)} />
          <Card label="mlPreds p25 / p75" value={`${fmt(r.mlStats.p25, 2)} / ${fmt(r.mlStats.p75, 2)}`} />
        </div>
      </section>

      {/* 5. Comparação de distribuições */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          5. Comparação de distribuições
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">série</th>
                <th className="border-b px-2 py-2 text-right">min</th>
                <th className="border-b px-2 py-2 text-right">p25</th>
                <th className="border-b px-2 py-2 text-right">median</th>
                <th className="border-b px-2 py-2 text-right">mean</th>
                <th className="border-b px-2 py-2 text-right">p75</th>
                <th className="border-b px-2 py-2 text-right">max</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Ridge", s: r.mlStats },
                { name: "Baseline", s: r.baselineStats },
                { name: "Real", s: r.actualStats },
              ].map((x) => (
                <tr key={x.name}>
                  <td className="border-b px-2 py-1 font-semibold">{x.name}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.min, 2)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.p25, 2)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.median, 2)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.mean, 2)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.p75, 2)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(x.s.max, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. Error stats */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">6. Estatísticas de erro</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card label="MAE" value={fmt(r.errorStats.mae, 4)} />
          <Card label="RMSE" value={fmt(r.errorStats.rmse, 4)} />
          <Card label="max |erro|" value={fmt(r.errorStats.maxAbsError, 2)} tone={r.errorStats.maxAbsError > 15 ? "bad" : "default"} />
          <Card label="|erro| > 5" value={r.errorStats.errorsGT5} />
          <Card label="|erro| > 10" value={r.errorStats.errorsGT10} tone={r.errorStats.errorsGT10 > 0 ? "warn" : "default"} />
          <Card label="|erro| > 15" value={r.errorStats.errorsGT15} tone={r.errorStats.errorsGT15 > 0 ? "warn" : "default"} />
          <Card label="|erro| > 20" value={r.errorStats.errorsGT20} tone={r.errorStats.errorsGT20 > 0 ? "bad" : "default"} />
          <Card label="pred < 0" value={r.errorStats.negativePredictionCount} tone={r.errorStats.negativePredictionCount > 0 ? "bad" : "default"} />
        </div>
      </section>

      {/* 7. Cold start */}
      <section>
        <h2 className="mb-2 text-lg font-semibold">
          7. Cold start — agrupamento por nº de rodadas anteriores disponíveis
        </h2>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">priorRounds</th>
                <th className="border-b px-2 py-2 text-right">n players</th>
                <th className="border-b px-2 py-2 text-right">ML MAE</th>
                <th className="border-b px-2 py-2 text-right">BL MAE</th>
                <th className="border-b px-2 py-2 text-right">ML RMSE</th>
                <th className="border-b px-2 py-2 text-right">BL RMSE</th>
              </tr>
            </thead>
            <tbody>
              {r.coldStartBuckets.map((b) => (
                <tr key={b.priorRoundsCount}>
                  <td className="border-b px-2 py-1">{b.priorRoundsCount}</td>
                  <td className="border-b px-2 py-1 text-right">{b.playerCount}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(b.mlMae, 3)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(b.baselineMae, 3)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(b.mlRmse, 3)}</td>
                  <td className="border-b px-2 py-1 text-right">{fmt(b.baselineRmse, 3)}</td>
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
