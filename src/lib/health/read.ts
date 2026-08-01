import "server-only";

import { prisma } from "@/lib/prisma";
import { formatAge } from "@/lib/slate/staleness";
import type {
  HealthDto,
  HealthGameDetailDto,
  HealthSignalDto,
  HealthSourceDetailDto,
} from "@/lib/dto/health";
import {
  GAMEDAY_PRICE_WINDOW_HOURS,
  INGEST_LATE_AFTER_HOURS,
  KEEPALIVE_INTERVAL_DAYS,
  KEEPALIVE_SAFETY_MARGIN_DAYS,
  OFFSEASON_DORMANT_COPY,
  PRICE_GAMEDAY_CADENCE_MINUTES,
  PRICE_IN_WEEK_CADENCE_MINUTES,
  PRICE_LATE_CADENCE_MULTIPLIER,
  RECOMPUTE_LATE_AFTER_HOURS,
  REQUIRED_INGEST_SOURCES,
  RUN_TIMEOUT_MINUTES,
  SEASON_LOOKAHEAD_DAYS,
} from "./config";
import {
  deriveKeepaliveReadiness,
  deriveSignalState,
  hasUpcomingKickoff,
  isGamedayPriceWindow,
  type AttemptRecord,
} from "./derive";
import { formatEtStamp } from "./format";

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

/**
 * Derives the three health signals from completed-run records at request time
 * (RD-21, RD-25). Nothing is persisted; a reload re-derives.
 *
 * **Sources of truth, and what deliberately does not count:**
 *
 * - Ingest and recompute derive from `PipelineRun` rows, which only the cycle
 *   runners write. Standalone `IngestRun` rows — Pitch 1's manual backfills,
 *   one-off dataset re-runs — have `pipelineRunId = null` and never move a
 *   signal: a hand-run backfill is not evidence that the *scheduled* pipeline
 *   works, which is the false green this surface has refused since SIG-37.
 * - Price refresh derives from `MarketSyncRun`, where every successful sync
 *   is price maintenance whether view-driven, poll-driven, or scheduled
 *   (RD-21). `complete` and `empty` are successes (an empty Kalshi listing is
 *   a valid answer); `partial` is not — some books were missed, and a partial
 *   success presented as green is exactly the aggregation RD-P7 forbids.
 */
export async function readHealth(): Promise<HealthDto> {
  const now = new Date();
  const lookaheadMs = SEASON_LOOKAHEAD_DAYS * 24 * HOUR_MS;

  const [
    upcomingGames,
    ingestAttempt,
    ingestSuccess,
    recomputeAttempt,
    recomputeSuccess,
    priceAttempt,
    priceSuccess,
    keepaliveSuccess,
  ] = await Promise.all([
    prisma.game.findMany({
      where: {
        status: "scheduled",
        kickoffAt: { gte: now, lte: new Date(now.getTime() + lookaheadMs) },
      },
      select: { kickoffAt: true },
    }),
    prisma.pipelineRun.findFirst({
      where: { category: "ingest" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.pipelineRun.findFirst({
      where: { category: "ingest", status: "succeeded" },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.pipelineRun.findFirst({
      where: { category: "recompute" },
      orderBy: { startedAt: "desc" },
    }),
    prisma.pipelineRun.findFirst({
      where: { category: "recompute", status: "succeeded" },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.marketSyncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.marketSyncRun.findFirst({
      where: { status: { in: ["complete", "empty"] } },
      orderBy: { finishedAt: "desc" },
    }),
    prisma.pipelineRun.findFirst({
      where: { category: "keepalive", status: "succeeded" },
      orderBy: { finishedAt: "desc" },
    }),
  ]);

  const kickoffs = upcomingGames.map((g) => g.kickoffAt);
  const expected = hasUpcomingKickoff(kickoffs, now, lookaheadMs);
  const gameday = isGamedayPriceWindow(
    kickoffs,
    now,
    GAMEDAY_PRICE_WINDOW_HOURS * HOUR_MS,
  );
  const priceCadenceMinutes = gameday
    ? PRICE_GAMEDAY_CADENCE_MINUTES
    : PRICE_IN_WEEK_CADENCE_MINUTES;
  const runTimeoutMs = RUN_TIMEOUT_MINUTES * MINUTE_MS;

  const ingestState = deriveSignalState({
    expected,
    latestAttempt: toAttempt(ingestAttempt),
    lastSuccessAt: ingestSuccess?.finishedAt ?? null,
    lateAfterMs: INGEST_LATE_AFTER_HOURS * HOUR_MS,
    runTimeoutMs,
    now,
  });
  const recomputeState = deriveSignalState({
    expected,
    latestAttempt: toAttempt(recomputeAttempt),
    lastSuccessAt: recomputeSuccess?.finishedAt ?? null,
    lateAfterMs: RECOMPUTE_LATE_AFTER_HOURS * HOUR_MS,
    runTimeoutMs,
    now,
  });
  const priceState = deriveSignalState({
    expected,
    latestAttempt: toSyncAttempt(priceAttempt),
    lastSuccessAt: priceSuccess?.finishedAt ?? null,
    lateAfterMs:
      priceCadenceMinutes * PRICE_LATE_CADENCE_MULTIPLIER * MINUTE_MS,
    runTimeoutMs,
    now,
  });

  const signals: HealthSignalDto[] = [
    {
      key: "ingest",
      label: "Ingest",
      state: ingestState,
      ...successFields(ingestSuccess?.finishedAt ?? null, now),
      expectedWithin:
        ingestState === "not_expected"
          ? null
          : `${INGEST_LATE_AFTER_HOURS}h of the last success`,
      ...attemptFields(toAttempt(ingestAttempt), now),
      ...(await ingestSourceDetail(
        pickDetailCycleId(ingestAttempt, now, runTimeoutMs),
        now,
      )),
    },
    {
      key: "recompute",
      label: "Projection recomputation",
      state: recomputeState,
      ...successFields(recomputeSuccess?.finishedAt ?? null, now),
      expectedWithin:
        recomputeState === "not_expected"
          ? null
          : `${RECOMPUTE_LATE_AFTER_HOURS}h of the last success`,
      ...attemptFields(toAttempt(recomputeAttempt), now),
      ...(await recomputeGameDetail(
        pickDetailCycleId(recomputeAttempt, now, runTimeoutMs),
        now,
      )),
    },
    {
      key: "price_refresh",
      label: "Price refresh",
      state: priceState,
      ...successFields(priceSuccess?.finishedAt ?? null, now),
      expectedWithin:
        priceState === "not_expected"
          ? null
          : gameday
            ? `${PRICE_GAMEDAY_CADENCE_MINUTES}m while kickoffs are upcoming`
            : `${PRICE_IN_WEEK_CADENCE_MINUTES}m during the game week`,
      ...attemptFields(toSyncAttempt(priceAttempt), now),
    },
  ];

  const offseason = signals.every((s) => s.state === "not_expected")
    ? {
        dormantCopy: OFFSEASON_DORMANT_COPY,
        keepalive: keepaliveDto(keepaliveSuccess?.finishedAt ?? null, now),
      }
    : null;

  return { signals, offseason };
}

type PipelineRunRow = {
  id: string;
  status: "running" | "succeeded" | "failed" | "incomplete";
  startedAt: Date;
  finishedAt: Date | null;
} | null;

type MarketSyncRunRow = {
  status: "complete" | "partial" | "failed" | "empty";
  startedAt: Date;
  finishedAt: Date | null;
} | null;

function toAttempt(run: PipelineRunRow): AttemptRecord | null {
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/**
 * `MarketSyncRun` normalized: a row with no `finishedAt` is in flight;
 * `complete`/`empty` succeeded; `partial` and `failed` both failed (RD-P7 —
 * a sync that missed books is not a success with a footnote).
 */
function toSyncAttempt(run: MarketSyncRunRow): AttemptRecord | null {
  if (!run) return null;
  if (run.finishedAt === null) {
    return { status: "running", startedAt: run.startedAt, finishedAt: null };
  }
  return {
    status:
      run.status === "complete" || run.status === "empty"
        ? "succeeded"
        : "failed",
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function successFields(lastSuccessAt: Date | null, now: Date) {
  return {
    lastSuccessAt: lastSuccessAt ? formatEtStamp(lastSuccessAt, now) : null,
    lastSuccessAge: lastSuccessAt
      ? formatAge(lastSuccessAt.toISOString(), now)
      : null,
  };
}

function attemptFields(attempt: AttemptRecord | null, now: Date) {
  if (!attempt) return { lastAttemptAt: null, lastAttemptOutcome: null };
  return {
    lastAttemptAt: formatEtStamp(attempt.finishedAt ?? attempt.startedAt, now),
    lastAttemptOutcome: attempt.status,
  };
}

/**
 * The cycle whose per-game detail is worth showing: the latest attempt unless
 * it is still legitimately running (mid-flight rows would read as lagging
 * games when they are merely not-yet-reached).
 */
function pickDetailCycleId(
  run: PipelineRunRow,
  now: Date,
  runTimeoutMs: number,
): string | null {
  if (!run) return null;
  if (
    run.status === "running" &&
    now.getTime() - run.startedAt.getTime() <= runTimeoutMs
  ) {
    return null;
  }
  return run.id;
}

/**
 * Per-source detail of the latest ingest cycle (RD-P7). Present only when a
 * source is non-ok — a fully green cycle collapses to the summary lines.
 * Reads only cycle-linked `IngestRun` rows; standalone runs are invisible.
 */
async function ingestSourceDetail(
  cycleId: string | null,
  now: Date,
): Promise<{ sources?: HealthSourceDetailDto[] }> {
  if (!cycleId) return {};

  const runs = await prisma.ingestRun.findMany({
    where: { pipelineRunId: cycleId },
    orderBy: { startedAt: "asc" },
    select: { dataset: true, status: true, finishedAt: true },
  });
  if (runs.length === 0) return {};

  const sources: HealthSourceDetailDto[] = runs.map((run) => ({
    name: run.dataset,
    required: REQUIRED_INGEST_SOURCES.includes(run.dataset),
    state:
      run.status === "success"
        ? "ok"
        : run.status === "failed"
          ? "failed"
          : "degraded",
    finishedAt: run.finishedAt ? formatEtStamp(run.finishedAt, now) : null,
  }));

  return sources.some((s) => s.state !== "ok") ? { sources } : {};
}

/**
 * Per-game completeness of the latest recompute cycle. Present only when the
 * cycle left games behind; names games, never players — per-contract currency
 * lives on the slate (RD-P6).
 */
async function recomputeGameDetail(
  cycleId: string | null,
  now: Date,
): Promise<{ games?: HealthGameDetailDto }> {
  if (!cycleId) return {};

  const rows = await prisma.pipelineRunGame.findMany({
    where: { pipelineRunId: cycleId },
    orderBy: { createdAt: "asc" },
    select: {
      status: true,
      game: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { nflverseAbbr: true } },
          awayTeam: { select: { nflverseAbbr: true } },
        },
      },
    },
  });
  if (rows.length === 0) return {};

  const lagging = rows
    .filter((row) => row.status !== "succeeded")
    .map((row) => ({
      label: `${row.game.awayTeam.nflverseAbbr} @ ${row.game.homeTeam.nflverseAbbr}`,
      kickoffAt: formatEtStamp(row.game.kickoffAt, now),
      reason:
        row.status === "failed"
          ? "failed this cycle"
          : "not recomputed this cycle",
    }));
  if (lagging.length === 0) return {};

  return {
    games: {
      currentCount: rows.length - lagging.length,
      totalCount: rows.length,
      lagging,
    },
  };
}

function keepaliveDto(lastActedAt: Date | null, now: Date) {
  const readiness = deriveKeepaliveReadiness({
    lastActedAt,
    intervalDays: KEEPALIVE_INTERVAL_DAYS,
    safetyMarginDays: KEEPALIVE_SAFETY_MARGIN_DAYS,
    now,
  });
  return {
    lastActedAt: lastActedAt ? formatEtStamp(lastActedAt, now) : null,
    lastActedAge: lastActedAt
      ? formatAge(lastActedAt.toISOString(), now)
      : null,
    nextRequiredBy: readiness.nextRequiredBy
      ? formatEtStamp(readiness.nextRequiredBy, now)
      : null,
    overdue: readiness.overdue,
  };
}
