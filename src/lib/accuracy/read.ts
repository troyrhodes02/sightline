import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";
import type { MarketSide, StatType } from "../../../generated/prisma/enums";
import type {
  AccuracyDto,
  AccuracyScope,
  CalibrationSeriesDto,
  ErrorPanelDto,
  MarketComparisonDto,
} from "@/lib/dto/accuracy";
import {
  fixedBuckets,
  marketComparison,
  type MarketObservationInput,
} from "./compute";
import { GRADING_LATE_AFTER_HOURS } from "@/lib/health/config";
import type { AccuracyScopeRequest } from "./scope";

/**
 * The accuracy read: stored grades in, one DTO out.
 *
 * Everything is an aggregate over durable rows — grade tables, calibration
 * bins, snapshots, outcomes — computed when someone looks. Nothing here
 * triggers grading, a backtest, recomputation, or a settlement refresh, and
 * nothing is written back: there is no stored accuracy summary to go stale.
 *
 * Role split is structural, following `readSlate`: the viewer payload is
 * built by code that never queries decisions, so a decision-derived key
 * cannot leak into it. `overridesEntry` exists only on the admin branch.
 */

export type AccuracyRole = "admin" | "viewer";

type ScopeFilters = {
  /** Null means "all" on that axis — the always-present SQL params below. */
  stat: string | null;
  season: number | null;
  version: string | null;
};

export async function readAccuracy(
  request: AccuracyScopeRequest,
  role: AccuracyRole,
): Promise<AccuracyDto> {
  const now = new Date();

  const [availableVersions, availableSeasons] = await Promise.all([
    versionsWithGradedData(),
    seasonsWithGradedData(),
  ]);
  const scope = resolveScope(request, availableVersions, availableSeasons);
  const filters: ScopeFilters = {
    stat: scope.statType === "all" ? null : scope.statType,
    season: scope.season === "all" ? null : scope.season,
    version: scope.modelVersion === "all" ? null : scope.modelVersion,
  };

  const [live, backtest, errorPanel, market, freshness, exclusions] =
    await Promise.all([
      scope.record === "backtest" ? null : liveSeries(scope, filters),
      scope.record === "live" ? null : backtestSeries(scope),
      readErrorPanel(scope, filters),
      readMarketComparison(filters),
      readFreshness(now),
      readExclusions(filters),
    ]);

  const calibration: CalibrationSeriesDto[] = [];
  if (live) calibration.push(live);
  if (backtest) calibration.push(backtest);

  const dto: AccuracyDto = {
    scope,
    gradedThroughWeek: freshness.gradedThroughWeek,
    lastGradingCycleAt: freshness.lastGradingCycleAt,
    gradingDelayed: freshness.gradingDelayed,
    calibration,
    errorPanel,
    market,
    exclusions,
    availableVersions,
    availableSeasons,
  };

  // The overrides entry is attached by a code path the viewer branch never
  // enters — the ONLY decision query in this module sits behind this gate.
  if (role === "admin") {
    const decided = await prisma.decision.findMany({
      distinct: ["contractId"],
      select: { contractId: true },
    });
    dto.overridesEntry = { decisionCount: decided.length };
  }

  return dto;
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Finishes the parsed request against the database: the version default is
 * "latest deployed with graded data", and season/version values outside the
 * graded lists fall back to their control's default (spec §11) rather than
 * erroring.
 */
function resolveScope(
  request: AccuracyScopeRequest,
  availableVersions: string[],
  availableSeasons: number[],
): AccuracyScope {
  const modelVersion =
    request.modelVersion === "all"
      ? "all"
      : request.modelVersion !== null &&
          availableVersions.includes(request.modelVersion)
        ? request.modelVersion
        : (availableVersions[0] ?? "all");
  const season =
    request.season !== "all" && availableSeasons.includes(request.season)
      ? request.season
      : "all";
  return {
    record: request.record,
    population: request.population,
    statType: request.statType,
    season,
    modelVersion,
  };
}

/** Versions with graded data, latest-deployed first (most recent projection). */
async function versionsWithGradedData(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ model_version: string }>>`
    SELECT p.model_version AS model_version, max(p.computed_at) AS latest
    FROM projections p
    JOIN projection_grades pg ON pg.projection_id = p.id
    WHERE pg.status::text = 'graded'
    GROUP BY p.model_version
    ORDER BY latest DESC`;
  return rows.map((row) => row.model_version);
}

async function seasonsWithGradedData(): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ season: number }>>`
    SELECT DISTINCT g.season::int AS season
    FROM games g
    JOIN projections p ON p.game_id = g.id
    JOIN projection_grades pg ON pg.projection_id = p.id
    WHERE pg.status::text = 'graded'
    ORDER BY season DESC`;
  return rows.map((row) => row.season);
}

// ---------------------------------------------------------------------------
// Live calibration
// ---------------------------------------------------------------------------

/**
 * Ten fixed buckets over `threshold_grades`, both denominators per bucket,
 * grouped in the database so the read moves ten rows, not ten thousand. The
 * top bucket is closed ([0.9, 1.0]) via `least(_, 9)`, matching the harness's
 * binning exactly — Compare must be a like-for-like overlay.
 */
async function liveSeries(
  scope: AccuracyScope,
  filters: ScopeFilters,
): Promise<CalibrationSeriesDto> {
  const buckets = await prisma.$queryRaw<
    Array<{
      bin_index: number;
      threshold_observations: number;
      projection_count: number;
      predicted_mean: number | null;
      observed_rate: number | null;
    }>
  >`
    SELECT
      least(floor(tg.stated_probability * 10), 9)::int AS bin_index,
      count(*)::int AS threshold_observations,
      count(DISTINCT tg.projection_id)::int AS projection_count,
      avg(tg.stated_probability)::float8 AS predicted_mean,
      avg(CASE WHEN tg.outcome THEN 1.0 ELSE 0.0 END)::float8 AS observed_rate
    FROM threshold_grades tg
    JOIN projections p ON p.id = tg.projection_id
    JOIN games g ON g.id = p.game_id
    WHERE (${scope.population}::text <> 'contract_like' OR tg.contract_like)
      AND (${scope.population}::text <> 'market_linked' OR tg.contract_id IS NOT NULL)
      AND (${filters.stat}::text IS NULL OR p.stat_type::text = ${filters.stat}::text)
      AND (${filters.season}::int IS NULL OR g.season = ${filters.season}::int)
      AND (${filters.version}::text IS NULL OR p.model_version = ${filters.version}::text)
    GROUP BY 1
    ORDER BY 1`;

  // Brier and the distinct-projection denominator are whole-population
  // quantities — neither is recoverable from bucket-level aggregates.
  const headline = await prisma.$queryRaw<
    Array<{ observations: number; projections: number; brier: number | null }>
  >`
    SELECT
      count(*)::int AS observations,
      count(DISTINCT tg.projection_id)::int AS projections,
      avg(power(tg.stated_probability - (CASE WHEN tg.outcome THEN 1 ELSE 0 END), 2))::float8 AS brier
    FROM threshold_grades tg
    JOIN projections p ON p.id = tg.projection_id
    JOIN games g ON g.id = p.game_id
    WHERE (${scope.population}::text <> 'contract_like' OR tg.contract_like)
      AND (${scope.population}::text <> 'market_linked' OR tg.contract_id IS NOT NULL)
      AND (${filters.stat}::text IS NULL OR p.stat_type::text = ${filters.stat}::text)
      AND (${filters.season}::int IS NULL OR g.season = ${filters.season}::int)
      AND (${filters.version}::text IS NULL OR p.model_version = ${filters.version}::text)`;

  const observations = headline[0]?.observations ?? 0;
  const projections = headline[0]?.projections ?? 0;

  return {
    kind: "live",
    label: `Live · ${formatCount(observations)} obs · ${formatCount(projections)} projections`,
    brier: headline[0]?.brier ?? null,
    thresholdObservations: observations,
    projectionCount: projections,
    buckets: fixedBuckets(
      buckets.map((row) => ({
        binIndex: row.bin_index,
        thresholdObservations: row.threshold_observations,
        projectionCount: row.projection_count,
        predictedMean: row.predicted_mean,
        observedRate: row.observed_rate,
      })),
    ),
    eraDisclosure: null,
  };
}

// ---------------------------------------------------------------------------
// Backtest record
// ---------------------------------------------------------------------------

/**
 * The backtest record: the most recent completed `BacktestRun`, rendered from
 * its stored `CalibrationBin` rows and `aggregates` — read-only here, and
 * named in the label so "which run" is never implicit. The run is the record
 * regardless of the live version selector; its own model version travels in
 * the label.
 *
 * The harness stores headline denominators (Brier, distinct projections) for
 * the pooled segments only — `all` and `contract_like` across every stat and
 * season. A narrower scope has no stored effective sample, and a curve
 * without both denominators would violate the two-denominator rule, so the
 * series is omitted and the screen says which scope the record needs
 * (design principle 2) rather than showing a number it cannot qualify.
 */
async function backtestSeries(
  scope: AccuracyScope,
): Promise<CalibrationSeriesDto | null> {
  if (
    scope.statType !== "all" ||
    scope.season !== "all" ||
    scope.population === "market_linked"
  ) {
    return null;
  }

  const run = await prisma.backtestRun.findFirst({
    where: { status: "completed" },
    orderBy: { finishedAt: "desc" },
    select: {
      id: true,
      label: true,
      modelVersion: true,
      seasonFrom: true,
      seasonTo: true,
      aggregates: true,
    },
  });
  if (!run) return null;

  const aggregates = asRecord(run.aggregates);
  const thresholds = asRecord(
    scope.population === "contract_like"
      ? path(aggregates, ["contractLike", "thresholds"])
      : path(aggregates, ["overall", "thresholds"]),
  );
  const brier = asNumber(thresholds?.brier);
  const observations = asNumber(thresholds?.observations);
  const projections = asNumber(thresholds?.projections);
  // No stored headline denominators for this population → no honest series.
  if (observations === null || projections === null) return null;

  const bins = await prisma.calibrationBin.findMany({
    where: {
      backtestRunId: run.id,
      statType: null,
      season: null,
      era: null,
      population: scope.population === "contract_like" ? "contract_like" : null,
    },
    orderBy: { binIndex: "asc" },
    select: {
      binIndex: true,
      predictedMean: true,
      observedRate: true,
      thresholdObservations: true,
      projectionCount: true,
      belowFloor: true,
    },
  });

  const runName = run.label ?? run.modelVersion;
  return {
    kind: "backtest",
    label: `Backtest ${runName} ${run.seasonFrom}–${run.seasonTo} · ${formatCount(observations)} obs · ${formatCount(projections)} projections`,
    brier,
    thresholdObservations: observations,
    projectionCount: projections,
    buckets: fixedBuckets(
      bins.map((bin) => ({
        binIndex: bin.binIndex,
        thresholdObservations: bin.thresholdObservations,
        projectionCount: bin.projectionCount,
        predictedMean: Number(bin.predictedMean),
        observedRate: Number(bin.observedRate),
        belowFloor: bin.belowFloor,
      })),
    ),
    eraDisclosure: eraDisclosure(aggregates),
  };
}

/**
 * The accepted pre-2021 weather leak, disclosed whenever the backtest record
 * renders — never averaged away. The era breakout stores point-estimate
 * error, so the figure quoted is the reanalysis-era model MAE.
 */
function eraDisclosure(
  aggregates: Record<string, unknown> | null,
): string | null {
  const era = asRecord(path(aggregates, ["byEra", "reanalysis"]));
  if (!era) return null;
  const mae =
    asNumber(path(era, ["comparison", "model", "mae"])) ??
    asNumber(path(era, ["modelOnly", "model", "mae"]));
  const figure = mae === null ? "" : `: model MAE ${mae.toFixed(1)}`;
  return `Reanalysis era (pre-2021) reported separately${figure} — accepted look-ahead leak, see Backtesting Harness.`;
}

// ---------------------------------------------------------------------------
// Error panel
// ---------------------------------------------------------------------------

/**
 * MAE/RMSE for the model against both stored baselines, over exactly the rows
 * where all three produced a value — mirroring the harness's comparison
 * population. The grade tables store absolute errors; RMSE is
 * `sqrt(avg(power(abs_error, 2)))`, which is exactly RMSE for per-row errors.
 * The median-based MAE is disclosed, never raced against the mean baselines.
 */
async function readErrorPanel(
  scope: AccuracyScope,
  filters: ScopeFilters,
): Promise<ErrorPanelDto | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      projection_count: number;
      model_mae: number | null;
      model_rmse: number | null;
      season_mae: number | null;
      season_rmse: number | null;
      trailing_mae: number | null;
      trailing_rmse: number | null;
      median_mae: number | null;
    }>
  >`
    SELECT
      count(*)::int AS projection_count,
      avg(pg.abs_error_mean)::float8 AS model_mae,
      sqrt(avg(power(pg.abs_error_mean, 2)))::float8 AS model_rmse,
      avg(pg.season_avg_abs_error)::float8 AS season_mae,
      sqrt(avg(power(pg.season_avg_abs_error, 2)))::float8 AS season_rmse,
      avg(pg.trailing_five_abs_error)::float8 AS trailing_mae,
      sqrt(avg(power(pg.trailing_five_abs_error, 2)))::float8 AS trailing_rmse,
      avg(pg.abs_error_median)::float8 AS median_mae
    FROM projection_grades pg
    JOIN projections p ON p.id = pg.projection_id
    JOIN games g ON g.id = p.game_id
    WHERE pg.status::text = 'graded'
      AND pg.abs_error_mean IS NOT NULL
      AND pg.season_avg_abs_error IS NOT NULL
      AND pg.trailing_five_abs_error IS NOT NULL
      AND (${scope.population}::text <> 'contract_like' OR pg.contract_like)
      AND (${scope.population}::text <> 'market_linked' OR EXISTS (
            SELECT 1 FROM threshold_grades tg
            WHERE tg.projection_id = pg.projection_id
              AND tg.contract_id IS NOT NULL))
      AND (${filters.stat}::text IS NULL OR p.stat_type::text = ${filters.stat}::text)
      AND (${filters.season}::int IS NULL OR g.season = ${filters.season}::int)
      AND (${filters.version}::text IS NULL OR p.model_version = ${filters.version}::text)`;

  const row = rows[0];
  if (!row || row.projection_count === 0) return null;
  return {
    projectionCount: row.projection_count,
    model: pair(row.model_mae, row.model_rmse),
    seasonAverage: pair(row.season_mae, row.season_rmse),
    trailingFive: pair(row.trailing_mae, row.trailing_rmse),
    medianMae: row.median_mae,
  };
}

function pair(
  mae: number | null,
  rmse: number | null,
): { mae: number; rmse: number } | null {
  return mae === null || rmse === null ? null : { mae, rmse };
}

// ---------------------------------------------------------------------------
// Market comparison
// ---------------------------------------------------------------------------

/**
 * Pinned to the market-linked population regardless of the selector: the
 * graded unit is the `final_pre_kickoff` snapshot joined to a settled
 * (non-voided) outcome. Stat, season, and version scope still apply — every
 * denominator on screen answers to the same filters.
 */
async function readMarketComparison(
  filters: ScopeFilters,
): Promise<MarketComparisonDto> {
  const where: Prisma.RecommendationSnapshotWhereInput = {
    trigger: "final_pre_kickoff",
    side: { not: null },
    modelProbability: { not: null },
    askCents: { not: null },
    contract: {
      outcome: { result: { in: ["yes", "no"] } },
      ...(filters.stat !== null ? { statType: filters.stat as StatType } : {}),
      ...(filters.season !== null ? { game: { season: filters.season } } : {}),
    },
    ...(filters.version !== null
      ? { projection: { modelVersion: filters.version } }
      : {}),
  };

  const snapshots = await prisma.recommendationSnapshot.findMany({
    where,
    select: {
      side: true,
      modelProbability: true,
      askCents: true,
      projectionId: true,
      contract: { select: { outcome: { select: { result: true } } } },
      priceObservation: {
        select: {
          yesBidCents: true,
          yesAskCents: true,
          noBidCents: true,
          noAskCents: true,
        },
      },
    },
  });

  const observations: MarketObservationInput[] = snapshots.map((snapshot) => ({
    side: snapshot.side as MarketSide,
    modelProbability: Number(snapshot.modelProbability),
    askCents: snapshot.askCents as number,
    resultYes: snapshot.contract.outcome?.result === "yes",
    projectionId: snapshot.projectionId,
    yesBidCents: snapshot.priceObservation?.yesBidCents ?? null,
    yesAskCents: snapshot.priceObservation?.yesAskCents ?? null,
    noBidCents: snapshot.priceObservation?.noBidCents ?? null,
    noAskCents: snapshot.priceObservation?.noAskCents ?? null,
  }));

  return marketComparison(observations);
}

// ---------------------------------------------------------------------------
// Freshness and exclusions
// ---------------------------------------------------------------------------

type Freshness = {
  gradedThroughWeek: { season: number; week: number } | null;
  lastGradingCycleAt: string | null;
  gradingDelayed: boolean;
};

/**
 * Graded-through is the latest (season, week) holding a graded projection;
 * the cycle timestamp is the last SUCCESSFUL grading run. "Delayed" needs
 * both facts: completed games are still awaiting grades AND the last success
 * is outside the nightly window — a quiet offseason is not a delay.
 */
async function readFreshness(now: Date): Promise<Freshness> {
  const [gradedThrough, lastCycle, awaiting] = await Promise.all([
    prisma.$queryRaw<Array<{ season: number; week: number }>>`
      SELECT g.season::int AS season, g.week::int AS week
      FROM games g
      WHERE EXISTS (
        SELECT 1 FROM projection_grades pg
        JOIN projections p ON p.id = pg.projection_id
        WHERE p.game_id = g.id AND pg.status::text = 'graded')
      ORDER BY g.season DESC, g.week DESC
      LIMIT 1`,
    prisma.pipelineRun.findFirst({
      where: { category: "grading", status: "succeeded" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.$queryRaw<Array<{ games: number }>>`
      SELECT count(*)::int AS games
      FROM games g
      WHERE g.status::text = 'completed'
        AND EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT ON (p.player_id, p.stat_type, p.model_version) p.id
            FROM projections p
            WHERE p.game_id = g.id AND p.information_cutoff <= g.kickoff_at
            ORDER BY p.player_id, p.stat_type, p.model_version,
              p.information_cutoff DESC, p.computed_at DESC
          ) eligible
          LEFT JOIN projection_grades pg ON pg.projection_id = eligible.id
          WHERE pg.id IS NULL)`,
  ]);

  const lastSuccessAt = lastCycle?.finishedAt ?? null;
  const awaitingGames = awaiting[0]?.games ?? 0;
  const stale =
    lastSuccessAt === null ||
    now.getTime() - lastSuccessAt.getTime() >
      GRADING_LATE_AFTER_HOURS * 60 * 60 * 1000;

  return {
    gradedThroughWeek: gradedThrough[0] ?? null,
    lastGradingCycleAt: lastSuccessAt?.toISOString() ?? null,
    gradingDelayed: awaitingGames > 0 && stale,
  };
}

/**
 * The exclusions line: counted by taxonomy reason, displayed beside the
 * population so nothing is silently dropped. Grade statuses answer to the
 * stat/season/version scope; settlement-side reasons (`unresolved_identity`,
 * `contract_voided`) are counted within scope where the contract carries the
 * attribute and always counted when it cannot — an unattributable exclusion
 * belongs to no narrower scope, and dropping it would hide it everywhere.
 */
async function readExclusions(
  filters: ScopeFilters,
): Promise<Array<{ reason: string; count: number }>> {
  const [statusRows, unresolvedIdentity, voided] = await Promise.all([
    prisma.$queryRaw<Array<{ reason: string; count: number }>>`
      SELECT pg.status::text AS reason, count(*)::int AS count
      FROM projection_grades pg
      JOIN projections p ON p.id = pg.projection_id
      JOIN games g ON g.id = p.game_id
      WHERE pg.status::text <> 'graded'
        AND (${filters.stat}::text IS NULL OR p.stat_type::text = ${filters.stat}::text)
        AND (${filters.season}::int IS NULL OR g.season = ${filters.season}::int)
        AND (${filters.version}::text IS NULL OR p.model_version = ${filters.version}::text)
      GROUP BY 1`,
    prisma.outcome.count({
      where: {
        contract: { resolutionStatus: { in: ["unresolved", "ambiguous"] } },
      },
    }),
    prisma.outcome.count({
      where: {
        result: "voided",
        contract: {
          AND: [
            filters.stat !== null
              ? {
                  OR: [
                    { statType: filters.stat as StatType },
                    { statType: null },
                  ],
                }
              : {},
            filters.season !== null
              ? { OR: [{ game: { season: filters.season } }, { gameId: null }] }
              : {},
          ],
        },
      },
    }),
  ]);

  const byReason = new Map(statusRows.map((row) => [row.reason, row.count]));
  const ordered: Array<{ reason: string; count: number }> = [
    {
      reason: "missing_official_result",
      count: byReason.get("missing_official_result") ?? 0,
    },
    {
      reason: "unsupported_stat_type",
      count: byReason.get("unsupported_stat_type") ?? 0,
    },
    {
      reason: "game_never_completed",
      count: byReason.get("game_never_completed") ?? 0,
    },
    { reason: "unresolved_identity", count: unresolvedIdentity },
    { reason: "contract_voided", count: voided },
  ];
  return ordered.filter((entry) => entry.count > 0);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function path(value: unknown, keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current ?? null;
}
