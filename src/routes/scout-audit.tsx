// src/routes/scout-audit.tsx

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildHistoriesFromRawRounds,
  type RawPontuadosRound,
} from "@/lib/data/historical.functions";
import type { HistoricalPlayerRound } from "@/lib/data/historical.types";
import { predictByRecentAverage } from "@/lib/backtest/baseline";
import { SCOUT_VALUES } from "@/lib/cartola/scoring";

/* ------------------------------------------------------------------ *
 * Fetch + cache isolado (não toca o cache dos modelos)
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
      "User-Agent": "CartolaIA/scout-audit/1.0",
    },
  });
  if (!res.ok) throw new Error(`Cartola API ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ *
 * Configuração da auditoria
 * ------------------------------------------------------------------ */

const AUDIT_SCOUTS = [
  "G", "A", "FT", "FD", "FF", "FS", "PS", "DS", "SG", "DP", "DE",
  "GC", "CV", "CA", "GS", "PP", "PC", "FC", "I",
] as const;
type AuditScout = (typeof AUDIT_SCOUTS)[number];

/**
 * Scouts presentes no tipo CartolaScouts atual (18 chaves).
 * DE fica de fora — a auditoria mostrará se ele aparece nos dados.
 * RB fica de fora — não é scout do Cartola.
 */
const SCOUTS_IN_TYPE = new Set<string>([
  "G", "A", "FT", "FD", "FF", "FS", "PP", "PS", "DS", "DP", "SG", "GS",
  "FC", "GC", "CA", "CV", "PC", "I",
]);

const POSITIONS = [
  "GOL", "LAT", "ZAG", "MEI", "ATA", "TEC", "UNKNOWN",
] as const;
type PositionKey = (typeof POSITIONS)[number];

/* ------------------------------------------------------------------ *
 * Tipos do resultado
 * ------------------------------------------------------------------ */

export interface ScoutExistence {
  scout: string;
  existsInType: boolean;
  existsInHistory: boolean;
  occurrenceCount: number;
  nonNullCount: number;
  zeroCount: number;
  nonZeroCount: number;
  coveragePct: number;
}

export interface ZeroVsAbsence {
  scout: string;
  zero: number;
  explicitNull: number;
  absent: number;
  other: number;
  totalRecords: number;
}

export interface PositionCell {
  position: string;
  records: number;
  nonZero: number;
  nonZeroPct: number;
}

export interface PositionCoverage {
  scout: string;
  byPosition: PositionCell[];
}

export interface RoundCoverage {
  scout: string;
  byRound: { round: number; nonZero: number; records: number }[];
  totalRecords: number;
  totalNonZero: number;
  roundsPresent: number;
  firstRound: number | null;
  lastRound: number | null;
}

export interface UniverseCoverage {
  scout: string;
  rows: number;
  zero: number;
  nullOrAbsent: number;
  nonZero: number;
  nonZeroPct: number;
}

export interface ValueStats {
  scout: string;
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  std: number | null;
  p25: number | null;
  p75: number | null;
}

export interface ValueDistribution {
  scout: string;
  topValues: { value: number; count: number }[];
}

export interface ParticipationBreakdown {
  scout: string;
  participatedZero: number;
  participatedNonZero: number;
  participatedAbsent: number;
  notParticipatedPresent: number;
  notParticipatedAbsent: number;
}

export interface ConsistencyCheck {
  sampleSize: number;
  unknownScoutKeys: string[];
  recordsWithUnknownKey: number;
}

export interface AnomaliesResult {
  scoutsInHistoryNotInType: string[];
  scoutsInTypeNotInHistory: string[];
  scoutsInHistoryNotInNineteen: string[];
  negativeValuesInScouts: number;
  nanValues: number;
  infinityValues: number;
  nonNumericValues: number;
}

export interface ScoutAuditSummary {
  confirmed: string[];
  absent: string[];
  lowCoverage: string[];
  positionSpecific: { scout: string; positions: string[] }[];
  representationIssues: string[];
  anomalyList: string[];
}

export interface ScoutAuditResult {
  meta: {
    firstRound: number;
    lastRound: number;
    totalHistoricalRecords: number;
    totalTestRows: number;
  };
  existence: ScoutExistence[];
  zeroVsAbsence: ZeroVsAbsence[];
  positionCoverage: PositionCoverage[];
  roundCoverage: RoundCoverage[];
  universeCoverage: UniverseCoverage[];
  valueStats: ValueStats[];
  distributions: ValueDistribution[];
  participation: ParticipationBreakdown[];
  consistency: ConsistencyCheck;
  anomalies: AnomaliesResult;
  summary: ScoutAuditSummary;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function inc(m: Map<string, number>, key: string, n = 1) {
  m.set(key, (m.get(key) ?? 0) + n);
}

function meanOf(v: number[]): number | null {
  if (v.length === 0) return null;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

function stdOf(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = meanOf(v);
  if (m === null) return null;
  let s = 0;
  for (const x of v) s += (x - m) ** 2;
  return Math.sqrt(s / v.length);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ------------------------------------------------------------------ *
 * Server function
 * ------------------------------------------------------------------ */

const AuditInput = z.object({
  firstRound: z.number().int().min(1).default(5),
  lastRound: z.number().int().min(1).default(26),
  participationWindow: z.number().int().min(1).default(12),
});

export const runScoutAudit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AuditInput.parse(input ?? {}))
  .handler(async ({ data }): Promise<ScoutAuditResult> => {
    const roundsToFetch: number[] = [];
    for (let r = 1; r <= data.lastRound; r++) roundsToFetch.push(r);

    const rawRounds: RawPontuadosRound[] = await Promise.all(
      roundsToFetch.map((r) =>
        cached(`audit:pontuados:${r}`, 30 * 60_000, () =>
          getJson<RawPontuadosRound>(`/atletas/pontuados/${r}`).catch(() => ({
            rodada: r,
            atletas: {},
          })),
        ),
      ),
    );

    const histories = buildHistoriesFromRawRounds(rawRounds);

    /* --------------------------------------------------------------
     * Passada única por todos os registros históricos
     * -------------------------------------------------------------- */

    let totalHistoricalRecords = 0;

    const occurrenceCount = new Map<string, number>();
    const nonNullCount = new Map<string, number>();
    const zeroCount = new Map<string, number>();
    const nonZeroCount = new Map<string, number>();
    const explicitNullCount = new Map<string, number>();
    const absentCount = new Map<string, number>();
    const otherCount = new Map<string, number>();

    const posRecords = new Map<string, Map<string, number>>();
    const posNonZero = new Map<string, Map<string, number>>();
    const roundRecords = new Map<string, Map<string, number>>();
    const roundNonZero = new Map<string, Map<string, number>>();
    const valuesByScout = new Map<string, number[]>();
    const partZero = new Map<string, number>();
    const partNonZero = new Map<string, number>();
    const partAbsent = new Map<string, number>();
    const notPartPresent = new Map<string, number>();
    const notPartAbsent = new Map<string, number>();

    for (const s of AUDIT_SCOUTS) {
      posRecords.set(s, new Map());
      posNonZero.set(s, new Map());
      roundRecords.set(s, new Map());
      roundNonZero.set(s, new Map());
      valuesByScout.set(s, []);
    }

    const extraScoutKeys = new Set<string>();
    let negativeValues = 0;
    let nanValues = 0;
    let infinityValues = 0;
    let nonNumericValues = 0;

    for (const h of histories) {
      for (const r of h.rounds) {
        totalHistoricalRecords++;
        const scoutsObj = r.scouts as Record<string, unknown> | undefined;
        const posKey: PositionKey = (r.position as PositionKey) ?? "UNKNOWN";
        const roundNum = r.round;
        const participated = r.participated;

        if (scoutsObj) {
          for (const k of Object.keys(scoutsObj)) {
            if (!(AUDIT_SCOUTS as readonly string[]).includes(k)) {
              extraScoutKeys.add(k);
            }
          }
        }

        for (const scout of AUDIT_SCOUTS) {
          let hasKey = false;
          let numVal: number | null = null;
          let isExplicitNull = false;
          let isOther = false;

          if (scoutsObj && Object.prototype.hasOwnProperty.call(scoutsObj, scout)) {
            hasKey = true;
            const raw = scoutsObj[scout];
            if (raw === null) {
              isExplicitNull = true;
            } else if (typeof raw === "number") {
              if (Number.isNaN(raw)) nanValues++;
              else if (!Number.isFinite(raw)) infinityValues++;
              else numVal = raw;
            } else {
              nonNumericValues++;
              isOther = true;
            }
          }

          if (hasKey) inc(occurrenceCount, scout);
          if (hasKey && numVal !== null) inc(nonNullCount, scout);

          if (numVal !== null) {
            if (numVal === 0) inc(zeroCount, scout);
            else inc(nonZeroCount, scout);
            if (numVal < 0) negativeValues++;

            const pm = posRecords.get(scout)!;
            const pnz = posNonZero.get(scout)!;
            inc(pm, posKey);
            if (numVal !== 0) inc(pnz, posKey);

            const rm = roundRecords.get(scout)!;
            const rnz = roundNonZero.get(scout)!;
            inc(rm, String(roundNum));
            if (numVal !== 0) inc(rnz, String(roundNum));

            valuesByScout.get(scout)!.push(numVal);
          } else if (isExplicitNull) {
            inc(explicitNullCount, scout);
          } else if (isOther) {
            inc(otherCount, scout);
          } else {
            inc(absentCount, scout);
          }

          if (participated) {
            if (!hasKey) inc(partAbsent, scout);
            else if (numVal === 0) inc(partZero, scout);
            else if (numVal !== null) inc(partNonZero, scout);
          } else {
            if (hasKey) inc(notPartPresent, scout);
            else inc(notPartAbsent, scout);
          }
        }
      }
    }

    /* --------------------------------------------------------------
     * Universo do ML (6541 rows): mesma filtragem da v1.2a/v2
     * -------------------------------------------------------------- */

    const testRows: HistoricalPlayerRound[] = [];
    for (let R = data.firstRound; R <= data.lastRound; R++) {
      for (const h of histories) {
        const row = h.rounds.find((x) => x.round === R && x.participated);
        if (!row) continue;
        const pred = predictByRecentAverage(h, R, data.participationWindow);
        if (pred === null) continue;
        testRows.push(row);
      }
    }

    const universeZero = new Map<string, number>();
    const universeAbsent = new Map<string, number>();
    const universeNonZero = new Map<string, number>();

    for (const row of testRows) {
      const scoutsObj = row.scouts as Record<string, unknown> | undefined;
      for (const scout of AUDIT_SCOUTS) {
        if (!scoutsObj || !Object.prototype.hasOwnProperty.call(scoutsObj, scout)) {
          inc(universeAbsent, scout);
          continue;
        }
        const v = scoutsObj[scout];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          inc(universeAbsent, scout);
        } else if (v === 0) {
          inc(universeZero, scout);
        } else {
          inc(universeNonZero, scout);
        }
      }
    }

    /* --------------------------------------------------------------
     * Consistência com SCOUT_VALUES
     * -------------------------------------------------------------- */

    const unknownScoutKeysInScoring = new Set<string>();
    let recordsWithUnknownKey = 0;
    const sampleLimit = 1000;
    let sampled = 0;
    for (const h of histories) {
      if (sampled >= sampleLimit) break;
      for (const r of h.rounds) {
        if (sampled >= sampleLimit) break;
        sampled++;
        const scoutsObj = r.scouts as Record<string, unknown> | undefined;
        if (!scoutsObj) continue;
        for (const k of Object.keys(scoutsObj)) {
          if (!(k in SCOUT_VALUES)) {
            unknownScoutKeysInScoring.add(k);
            recordsWithUnknownKey++;
          }
        }
      }
    }

    /* --------------------------------------------------------------
     * Montar resultado
     * -------------------------------------------------------------- */

    const existence: ScoutExistence[] = AUDIT_SCOUTS.map((scout) => {
      const occ = occurrenceCount.get(scout) ?? 0;
      const nn = nonNullCount.get(scout) ?? 0;
      return {
        scout,
        existsInType: SCOUTS_IN_TYPE.has(scout),
        existsInHistory: occ > 0,
        occurrenceCount: occ,
        nonNullCount: nn,
        zeroCount: zeroCount.get(scout) ?? 0,
        nonZeroCount: nonZeroCount.get(scout) ?? 0,
        coveragePct:
          totalHistoricalRecords > 0 ? (nn / totalHistoricalRecords) * 100 : 0,
      };
    });

    const zeroVsAbsence: ZeroVsAbsence[] = AUDIT_SCOUTS.map((scout) => ({
      scout,
      zero: zeroCount.get(scout) ?? 0,
      explicitNull: explicitNullCount.get(scout) ?? 0,
      absent: absentCount.get(scout) ?? 0,
      other: otherCount.get(scout) ?? 0,
      totalRecords: totalHistoricalRecords,
    }));

    const positionCoverage: PositionCoverage[] = AUDIT_SCOUTS.map((scout) => {
      const rm = posRecords.get(scout)!;
      const rnz = posNonZero.get(scout)!;
      return {
        scout,
        byPosition: POSITIONS.map((p) => {
          const rec = rm.get(p) ?? 0;
          const nz = rnz.get(p) ?? 0;
          return {
            position: p,
            records: rec,
            nonZero: nz,
            nonZeroPct: rec > 0 ? (nz / rec) * 100 : 0,
          };
        }),
      };
    });

    const roundCoverage: RoundCoverage[] = AUDIT_SCOUTS.map((scout) => {
      const rm = roundRecords.get(scout)!;
      const rnz = roundNonZero.get(scout)!;
      const byRound: { round: number; nonZero: number; records: number }[] = [];
      let totalRecords = 0;
      let totalNonZero = 0;
      const presentRounds: number[] = [];
      for (let R = data.firstRound; R <= data.lastRound; R++) {
        const rec = rm.get(String(R)) ?? 0;
        const nz = rnz.get(String(R)) ?? 0;
        totalRecords += rec;
        totalNonZero += nz;
        if (nz > 0) presentRounds.push(R);
        byRound.push({ round: R, nonZero: nz, records: rec });
      }
      return {
        scout,
        byRound,
        totalRecords,
        totalNonZero,
        roundsPresent: presentRounds.length,
        firstRound: presentRounds[0] ?? null,
        lastRound: presentRounds[presentRounds.length - 1] ?? null,
      };
    });

    const universeCoverage: UniverseCoverage[] = AUDIT_SCOUTS.map((scout) => {
      const z = universeZero.get(scout) ?? 0;
      const a = universeAbsent.get(scout) ?? 0;
      const nz = universeNonZero.get(scout) ?? 0;
      const rows = testRows.length;
      return {
        scout,
        rows,
        zero: z,
        nullOrAbsent: a,
        nonZero: nz,
        nonZeroPct: rows > 0 ? (nz / rows) * 100 : 0,
      };
    });

    const valueStats: ValueStats[] = AUDIT_SCOUTS.map((scout) => {
      const vals = valuesByScout.get(scout)!;
      const sorted = [...vals].sort((a, b) => a - b);
      return {
        scout,
        count: vals.length,
        min: sorted.length > 0 ? sorted[0] : null,
        max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
        mean: meanOf(vals),
        median: percentile(sorted, 0.5),
        std: stdOf(vals),
        p25: percentile(sorted, 0.25),
        p75: percentile(sorted, 0.75),
      };
    });

    const distributions: ValueDistribution[] = AUDIT_SCOUTS.map((scout) => {
      const vals = valuesByScout.get(scout)!;
      const freq = new Map<number, number>();
      for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
      const top = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({ value, count }));
      return { scout, topValues: top };
    });

    const participation: ParticipationBreakdown[] = AUDIT_SCOUTS.map(
      (scout) => ({
        scout,
        participatedZero: partZero.get(scout) ?? 0,
        participatedNonZero: partNonZero.get(scout) ?? 0,
        participatedAbsent: partAbsent.get(scout) ?? 0,
        notParticipatedPresent: notPartPresent.get(scout) ?? 0,
        notParticipatedAbsent: notPartAbsent.get(scout) ?? 0,
      }),
    );

    const scoutsInHistory = new Set<string>();
    for (const h of histories) {
      for (const r of h.rounds) {
        const scoutsObj = r.scouts as Record<string, unknown> | undefined;
        if (!scoutsObj) continue;
        for (const k of Object.keys(scoutsObj)) scoutsInHistory.add(k);
      }
    }
    const scoutsInHistoryNotInType = [...scoutsInHistory].filter(
      (k) => !SCOUTS_IN_TYPE.has(k),
    );
    const scoutsInTypeNotInHistory = [...SCOUTS_IN_TYPE].filter(
      (k) => !scoutsInHistory.has(k),
    );
    const scoutsInHistoryNotInNineteen = [...scoutsInHistory].filter(
      (k) => !(AUDIT_SCOUTS as readonly string[]).includes(k),
    );

    const anomalies: AnomaliesResult = {
      scoutsInHistoryNotInType,
      scoutsInTypeNotInHistory,
      scoutsInHistoryNotInNineteen,
      negativeValuesInScouts: negativeValues,
      nanValues,
      infinityValues,
      nonNumericValues,
    };

    const consistency: ConsistencyCheck = {
      sampleSize: sampled,
      unknownScoutKeys: [...unknownScoutKeysInScoring],
      recordsWithUnknownKey,
    };

    /* --------------------------------------------------------------
     * Resumo
     * -------------------------------------------------------------- */

    const confirmed: string[] = [];
    const absent: string[] = [];
    const lowCoverage: string[] = [];
    const positionSpecific: { scout: string; positions: string[] }[] = [];

    for (const e of existence) {
      if (!e.existsInHistory) {
        absent.push(e.scout);
        continue;
      }
      confirmed.push(e.scout);
      if (e.coveragePct < 1) lowCoverage.push(e.scout);
    }

    for (const pc of positionCoverage) {
      const withAny = pc.byPosition.filter((c) => c.records > 0);
      if (withAny.length === 1 && withAny[0].nonZero > 0) {
        positionSpecific.push({
          scout: pc.scout,
          positions: [withAny[0].position],
        });
      }
    }

    const representationIssues: string[] = [];
    for (const z of zeroVsAbsence) {
      if (z.other > 0) {
        representationIssues.push(
          `${z.scout}: ${z.other} valores não-numéricos`,
        );
      }
    }

    const anomalyList: string[] = [];
    if (negativeValues > 0) anomalyList.push(`${negativeValues} valores negativos`);
    if (nanValues > 0) anomalyList.push(`${nanValues} NaN`);
    if (infinityValues > 0) anomalyList.push(`${infinityValues} Infinity`);
    if (nonNumericValues > 0)
      anomalyList.push(`${nonNumericValues} valores não-numéricos`);
    if (scoutsInHistoryNotInNineteen.length > 0)
      anomalyList.push(
        `scouts fora dos 19: ${scoutsInHistoryNotInNineteen.join(", ")}`,
      );
    if (scoutsInHistoryNotInType.length > 0)
      anomalyList.push(
        `scouts no histórico ausentes do tipo: ${scoutsInHistoryNotInType.join(", ")}`,
      );

    return {
      meta: {
        firstRound: data.firstRound,
        lastRound: data.lastRound,
        totalHistoricalRecords,
        totalTestRows: testRows.length,
      },
      existence,
      zeroVsAbsence,
      positionCoverage,
      roundCoverage,
      universeCoverage,
      valueStats,
      distributions,
      participation,
      consistency,
      anomalies,
      summary: {
        confirmed,
        absent,
        lowCoverage,
        positionSpecific,
        representationIssues,
        anomalyList,
      },
    };
  });

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

type LoaderData =
  | { ok: true; result: ScoutAuditResult }
  | { ok: false; error: string };

export const Route = createFileRoute("/scout-audit")({
  loader: async (): Promise<LoaderData> => {
    try {
      const result = await runScoutAudit({ data: {} });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  component: ScoutAuditPage,
});

function fmtNum(v: number | null, d = 3): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(d);
}

function fmtPct(v: number): string {
  return `${v.toFixed(2)}%`;
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

function SectionHeader({ n, title }: { n: number | string; title: string }) {
  return (
    <h2 className="mb-2 text-lg font-semibold">
      Parte {n} — {title}
    </h2>
  );
}

function ScoutAuditPage() {
  const data = Route.useLoaderData();

  if (!data.ok) {
    return (
      <div className="container mx-auto max-w-7xl py-8">
        <h1 className="mb-2 text-2xl font-bold">Scout Audit (temporário)</h1>
        <div className="rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <div className="font-semibold">Erro</div>
          <div className="mt-1 text-sm">{data.error}</div>
        </div>
      </div>
    );
  }

  const r = data.result;
  const meta = r.meta;

  return (
    <div className="container mx-auto max-w-7xl space-y-10 py-8">
      <header>
        <h1 className="mb-2 text-2xl font-bold">
          Scout Audit — auditoria dos 19 scouts do Cartola
        </h1>
        <p className="text-sm text-muted-foreground">
          Auditoria somente-leitura sobre o histórico real do projeto.
          Período R{meta.firstRound}–R{meta.lastRound}. Universo de teste
          reproduzido: {meta.totalTestRows} linhas (esperado 6541). Nenhum
          modelo é treinado; nenhuma feature é criada.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card label="Total de registros históricos" value={meta.totalHistoricalRecords} />
        <Card
          label="Total de linhas do universo ML"
          value={meta.totalTestRows}
          tone={meta.totalTestRows === 6541 ? "good" : "warn"}
        />
        <Card label="Scouts auditados" value={r.existence.length} />
      </section>

      {/* PARTE 1 — Existência */}
      <section>
        <SectionHeader n={1} title="Existência dos scouts" />
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-center">no tipo</th>
                <th className="border-b px-2 py-2 text-center">no histórico</th>
                <th className="border-b px-2 py-2 text-right">ocorrências</th>
                <th className="border-b px-2 py-2 text-right">não-nulos</th>
                <th className="border-b px-2 py-2 text-right">zeros</th>
                <th className="border-b px-2 py-2 text-right">não-zero</th>
                <th className="border-b px-2 py-2 text-right">cobertura %</th>
              </tr>
            </thead>
            <tbody>
              {r.existence.map((e) => (
                <tr key={e.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {e.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-center">
                    {e.existsInType ? "✓" : "✗"}
                  </td>
                  <td className="border-b px-2 py-1 text-center">
                    {e.existsInHistory ? "✓" : "✗"}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {e.occurrenceCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {e.nonNullCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {e.zeroCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {e.nonZeroCount}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtPct(e.coveragePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PARTE 2 — Zero vs ausência */}
      <section>
        <SectionHeader n={2} title="Zero vs ausência" />
        <p className="mb-2 text-xs text-muted-foreground">
          O normalizador atual (<code>pickScouts</code>) só escreve a chave
          quando o valor é <code>typeof number</code>. Portanto, na prática,
          &quot;ausente&quot; e &quot;null&quot; não deveriam ocorrer no
          histórico normalizado. A tabela mostra o que foi observado.
        </p>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">zero</th>
                <th className="border-b px-2 py-2 text-right">null explícito</th>
                <th className="border-b px-2 py-2 text-right">ausente (chave)</th>
                <th className="border-b px-2 py-2 text-right">outros</th>
                <th className="border-b px-2 py-2 text-right">total registros</th>
              </tr>
            </thead>
            <tbody>
              {r.zeroVsAbsence.map((z) => (
                <tr key={z.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {z.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-right">{z.zero}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {z.explicitNull}
                  </td>
                  <td className="border-b px-2 py-1 text-right">{z.absent}</td>
                  <td className="border-b px-2 py-1 text-right">{z.other}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {z.totalRecords}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PARTE 3 — Cobertura por posição */}
      <section>
        <SectionHeader n={3} title="Cobertura por posição" />
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                {["GOL", "LAT", "ZAG", "MEI", "ATA", "TEC", "UNKNOWN"].map(
                  (p) => (
                    <th key={p} className="border-b px-2 py-2 text-right">
                      {p}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {r.positionCoverage.map((pc) => (
                <tr key={pc.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {pc.scout}
                  </td>
                  {pc.byPosition.map((c) => (
                    <td
                      key={c.position}
                      className="border-b px-2 py-1 text-right"
                    >
                      {c.records > 0
                        ? `${c.nonZero}/${c.records} (${fmtPct(c.nonZeroPct)})`
                        : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada célula mostra <strong>não-zero / total (percentual)</strong>.
          &quot;—&quot; significa posição sem nenhum registro.
        </p>
      </section>

      {/* PARTE 4 — Cobertura por rodada */}
      <section>
        <SectionHeader n={4} title="Cobertura por rodada (R5–R26)" />
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-[10px]">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-1 py-2 text-left">scout</th>
                {r.roundCoverage[0].byRound.map((b) => (
                  <th key={b.round} className="border-b px-1 py-2 text-right">
                    R{b.round}
                  </th>
                ))}
                <th className="border-b px-1 py-2 text-right">total NZ</th>
                <th className="border-b px-1 py-2 text-right">1ª</th>
                <th className="border-b px-1 py-2 text-right">última</th>
              </tr>
            </thead>
            <tbody>
              {r.roundCoverage.map((rc) => (
                <tr key={rc.scout}>
                  <td className="border-b px-1 py-1 font-mono font-semibold">
                    {rc.scout}
                  </td>
                  {rc.byRound.map((b) => (
                    <td
                      key={b.round}
                      className={`border-b px-1 py-1 text-right ${
                        b.nonZero === 0 ? "text-gray-400" : ""
                      }`}
                    >
                      {b.nonZero}
                    </td>
                  ))}
                  <td className="border-b px-1 py-1 text-right font-semibold">
                    {rc.totalNonZero}
                  </td>
                  <td className="border-b px-1 py-1 text-right">
                    {rc.firstRound ?? "—"}
                  </td>
                  <td className="border-b px-1 py-1 text-right">
                    {rc.lastRound ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada célula = quantidade de registros com valor não-zero naquela
          rodada.
        </p>
      </section>

      {/* PARTE 5 — Universo ML */}
      <section>
        <SectionHeader
          n={5}
          title={`Universo ML (${meta.totalTestRows} linhas)`}
        />
        <p className="mb-2 text-xs text-muted-foreground">
          Estatística calculada sobre os scouts do <strong>próprio registro
          alvo</strong> em cada uma das {meta.totalTestRows} linhas do
          universo da v1.2a/v2 (R5–R26, janela 12, mesma filtragem via
          baseline).
        </p>
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">rows</th>
                <th className="border-b px-2 py-2 text-right">zero</th>
                <th className="border-b px-2 py-2 text-right">
                  null/ausente
                </th>
                <th className="border-b px-2 py-2 text-right">não-zero</th>
                <th className="border-b px-2 py-2 text-right">% não-zero</th>
              </tr>
            </thead>
            <tbody>
              {r.universeCoverage.map((u) => (
                <tr key={u.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {u.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-right">{u.rows}</td>
                  <td className="border-b px-2 py-1 text-right">{u.zero}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {u.nullOrAbsent}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {u.nonZero}
                  </td>
                  <td className="border-b px-2 py-1 text-right font-semibold">
                    {fmtPct(u.nonZeroPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PARTE 6 — Estatísticas */}
      <section>
        <SectionHeader n={6} title="Estatísticas dos valores" />
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">n</th>
                <th className="border-b px-2 py-2 text-right">min</th>
                <th className="border-b px-2 py-2 text-right">p25</th>
                <th className="border-b px-2 py-2 text-right">median</th>
                <th className="border-b px-2 py-2 text-right">mean</th>
                <th className="border-b px-2 py-2 text-right">p75</th>
                <th className="border-b px-2 py-2 text-right">max</th>
                <th className="border-b px-2 py-2 text-right">std</th>
              </tr>
            </thead>
            <tbody>
              {r.valueStats.map((s) => (
                <tr key={s.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {s.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-right">{s.count}</td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.min, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.p25, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.median, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.mean, 3)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.p75, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.max, 2)}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {fmtNum(s.std, 3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PARTE 7 — Distribuição */}
      <section>
        <SectionHeader n={7} title="Distribuição — top 10 valores" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {r.distributions.map((d) => (
            <div key={d.scout} className="rounded border p-2 text-xs">
              <div className="font-mono font-semibold">{d.scout}</div>
              {d.topValues.length === 0 ? (
                <div className="text-muted-foreground">(sem valores)</div>
              ) : (
                <div className="font-mono">
                  {d.topValues.map((v) => (
                    <div key={v.value} className="flex justify-between">
                      <span>{v.value}</span>
                      <span className="text-muted-foreground">
                        ×{v.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* PARTE 8 — Participação */}
      <section>
        <SectionHeader n={8} title="Participação real vs scout" />
        <div className="overflow-x-auto rounded border">
          <table className="min-w-full text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="border-b px-2 py-2 text-left">scout</th>
                <th className="border-b px-2 py-2 text-right">
                  part. + zero
                </th>
                <th className="border-b px-2 py-2 text-right">
                  part. + não-zero
                </th>
                <th className="border-b px-2 py-2 text-right">
                  part. + ausente
                </th>
                <th className="border-b px-2 py-2 text-right">
                  não-part. + presente
                </th>
                <th className="border-b px-2 py-2 text-right">
                  não-part. + ausente
                </th>
              </tr>
            </thead>
            <tbody>
              {r.participation.map((p) => (
                <tr key={p.scout}>
                  <td className="border-b px-2 py-1 font-mono font-semibold">
                    {p.scout}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {p.participatedZero}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {p.participatedNonZero}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {p.participatedAbsent}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {p.notParticipatedPresent}
                  </td>
                  <td className="border-b px-2 py-1 text-right">
                    {p.notParticipatedAbsent}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* PARTE 9 — Consistência */}
      <section>
        <SectionHeader n={9} title="Consistência com SCOUT_VALUES" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Card
            label="amostra inspecionada"
            value={r.consistency.sampleSize}
          />
          <Card
            label="chaves desconhecidas no scoring"
            value={r.consistency.unknownScoutKeys.length}
            tone={
              r.consistency.unknownScoutKeys.length > 0 ? "warn" : "default"
            }
          />
          <Card
            label="registros com chave desconhecida"
            value={r.consistency.recordsWithUnknownKey}
          />
        </div>
        {r.consistency.unknownScoutKeys.length > 0 && (
          <p className="mt-2 text-xs">
            Chaves encontradas que não existem em SCOUT_VALUES:{" "}
            <span className="font-mono">
              {r.consistency.unknownScoutKeys.join(", ")}
            </span>
          </p>
        )}
      </section>

      {/* PARTE 10 — Temporalidade */}
      <section>
        <SectionHeader n={10} title="Temporalidade" />
        <p className="text-xs text-muted-foreground">
          Cada <code>HistoricalPlayerRound</code> tem <code>round</code> como
          campo próprio, e a lista <code>rounds</code> de cada jogador é
          ordenável. Portanto, filtrar <code>round &lt; R</code> é trivial e
          não requer nenhuma alteração estrutural. O universo de{" "}
          {meta.totalTestRows} linhas foi reproduzido sem usar nenhum
          registro com <code>round &gt;= R</code>. Nenhum registro posterior
          ao alvo vaza para features.
        </p>
      </section>

      {/* PARTE 11 — Anomalias */}
      <section>
        <SectionHeader n={11} title="Anomalias" />
        <div className="grid gap-3 sm:grid-cols-4">
          <Card
            label="valores negativos"
            value={r.anomalies.negativeValuesInScouts}
            tone={
              r.anomalies.negativeValuesInScouts > 0 ? "warn" : "default"
            }
          />
          <Card
            label="NaN"
            value={r.anomalies.nanValues}
            tone={r.anomalies.nanValues > 0 ? "bad" : "default"}
          />
          <Card
            label="Infinity"
            value={r.anomalies.infinityValues}
            tone={r.anomalies.infinityValues > 0 ? "bad" : "default"}
          />
          <Card
            label="valores não-numéricos"
            value={r.anomalies.nonNumericValues}
            tone={r.anomalies.nonNumericValues > 0 ? "bad" : "default"}
          />
        </div>
        <div className="mt-3 space-y-2 text-xs">
          <div>
            <strong>scouts no histórico fora do tipo CartolaScouts:</strong>{" "}
            {r.anomalies.scoutsInHistoryNotInType.length === 0
              ? "(nenhum)"
              : r.anomalies.scoutsInHistoryNotInType.join(", ")}
          </div>
          <div>
            <strong>scouts no tipo mas ausentes do histórico:</strong>{" "}
            {r.anomalies.scoutsInTypeNotInHistory.length === 0
              ? "(nenhum)"
              : r.anomalies.scoutsInTypeNotInHistory.join(", ")}
          </div>
          <div>
            <strong>scouts no histórico fora da lista dos 19:</strong>{" "}
            {r.anomalies.scoutsInHistoryNotInNineteen.length === 0
              ? "(nenhum)"
              : r.anomalies.scoutsInHistoryNotInNineteen.join(", ")}
          </div>
        </div>
      </section>

      {/* PARTE 12 — Resumo */}
      <section>
        <SectionHeader n={12} title="Resumo final" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Card
            label="confirmados nos dados"
            value={r.summary.confirmed.length}
            tone="good"
          />
          <Card
            label="ausentes"
            value={r.summary.absent.length}
            tone={r.summary.absent.length > 0 ? "warn" : "default"}
          />
          <Card
            label="baixa cobertura (<1%)"
            value={r.summary.lowCoverage.length}
            tone={r.summary.lowCoverage.length > 0 ? "warn" : "default"}
          />
          <Card
            label="específicos de posição"
            value={r.summary.positionSpecific.length}
          />
        </div>

        <div className="mt-4 space-y-3 text-xs">
          <div>
            <strong>1. Confirmados:</strong>{" "}
            {r.summary.confirmed.join(", ") || "(nenhum)"}
          </div>
          <div>
            <strong>2. Ausentes:</strong>{" "}
            {r.summary.absent.join(", ") || "(nenhum)"}
          </div>
          <div>
            <strong>3. Baixa cobertura:</strong>{" "}
            {r.summary.lowCoverage.join(", ") || "(nenhum)"}
          </div>
          <div>
            <strong>4. Específicos de posição:</strong>{" "}
            {r.summary.positionSpecific.length === 0
              ? "(nenhum)"
              : r.summary.positionSpecific
                  .map((p) => `${p.scout} → ${p.positions.join("/")}`)
                  .join("; ")}
          </div>
          <div>
            <strong>5. Problemas de representação:</strong>{" "}
            {r.summary.representationIssues.join("; ") || "(nenhum)"}
          </div>
          <div>
            <strong>6. Anomalias:</strong>{" "}
            {r.summary.anomalyList.join("; ") || "(nenhuma)"}
          </div>
        </div>
      </section>

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Rota temporária. Nenhum modelo foi alterado, treinado ou retreinado.
        Baseline, universe, features e rotas existentes permanecem intocados.
      </footer>
    </div>
  );
}
