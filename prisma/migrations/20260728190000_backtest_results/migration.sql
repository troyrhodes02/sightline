-- Backtest results (Pitch 2, SIG-13).
--
-- The durable half of a backtest: aggregate results and the reliability curve.
-- Raw per-prediction output stays in local Parquet and never enters this
-- database. Neither table is a bitemporal fact table — a backtest result is a
-- measurement of the model, not a fact about the world — so neither carries
-- valid_at/known_at or an ingest_run_id.

-- CreateEnum
CREATE TYPE "StatType" AS ENUM ('passing_yards', 'rushing_yards', 'receiving_yards', 'receptions', 'rushing_tds', 'receiving_tds');

-- CreateEnum
CREATE TYPE "BacktestStatus" AS ENUM ('running', 'completed', 'failed', 'interrupted');

-- CreateEnum
CREATE TYPE "EvaluationWindow" AS ENUM ('development', 'validation', 'holdout');

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "status" "BacktestStatus" NOT NULL DEFAULT 'running',
    "season_from" INTEGER NOT NULL,
    "season_to" INTEGER NOT NULL,
    "season_types" TEXT[],
    "stat_types" "StatType"[],
    "evaluation_window" "EvaluationWindow" NOT NULL,
    "cutoff_policy" TEXT NOT NULL,
    "threshold_policy_version" TEXT NOT NULL,
    "grading_target" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "code_version" TEXT NOT NULL,
    "code_dirty" BOOLEAN NOT NULL DEFAULT false,
    "seed" INTEGER NOT NULL,
    "rng_draws" INTEGER NOT NULL DEFAULT 0,
    "engine_config" JSONB NOT NULL,
    "engine_config_digest" TEXT NOT NULL,
    "corpus_digest" TEXT NOT NULL,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "projected_count" INTEGER NOT NULL DEFAULT 0,
    "unprojectable_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_count" INTEGER NOT NULL DEFAULT 0,
    "comparison_count" INTEGER NOT NULL DEFAULT 0,
    "threshold_obs_count" INTEGER NOT NULL DEFAULT 0,
    "aggregates" JSONB,
    "aggregates_version" INTEGER NOT NULL DEFAULT 1,
    "predictions_digest" TEXT,
    "aggregate_digest" TEXT,
    "calibration_digest" TEXT,
    "artifact_path" TEXT NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibration_bins" (
    "id" TEXT NOT NULL,
    "backtest_run_id" TEXT NOT NULL,
    "stat_type" "StatType",
    "season" INTEGER,
    "era" "WeatherEra",
    "bin_index" INTEGER NOT NULL,
    "bin_low" DECIMAL(4,3) NOT NULL,
    "bin_high" DECIMAL(4,3) NOT NULL,
    "predicted_mean" DECIMAL(6,5) NOT NULL,
    "observed_rate" DECIMAL(6,5) NOT NULL,
    "threshold_observations" INTEGER NOT NULL,
    "projection_count" INTEGER NOT NULL,
    "below_floor" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calibration_bins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backtest_runs_status_started_at_idx" ON "backtest_runs"("status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_runs_model_version_started_at_idx" ON "backtest_runs"("model_version", "started_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_runs_evaluation_window_idx" ON "backtest_runs"("evaluation_window");

-- CreateIndex
CREATE INDEX "calibration_bins_backtest_run_id_idx" ON "calibration_bins"("backtest_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_bins_backtest_run_id_stat_type_season_era_bin_i_key" ON "calibration_bins"("backtest_run_id", "stat_type", "season", "era", "bin_index");

-- AddForeignKey
ALTER TABLE "calibration_bins" ADD CONSTRAINT "calibration_bins_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Raw-SQL constructs Prisma does not model.
--
-- There are still NO user-scoped tables, so there are NO RLS policies. That is
-- a decision, not an omission: backtest_runs and calibration_bins are shared
-- reference data with no per-user partition (Architecture Doc -> "this is not
-- multi-tenancy"). Row-level isolation of a calibration curve identical for
-- every user would be pure ceremony.
-- ---------------------------------------------------------------------------

-- Persisted segments are SINGLE-AXIS: the run emits one bin set for "all",
-- one per stat type, one per season, and one per weather era. Cross-axis
-- slices (a stat type within an era, say) are derived from the Parquet
-- artefacts on demand, never persisted — which is what keeps the durable bin
-- count proportional to the axes rather than to their product.
ALTER TABLE "calibration_bins"
  ADD CONSTRAINT "calibration_bins_single_axis" CHECK (
    (CASE WHEN "stat_type" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "season" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "era" IS NULL THEN 0 ELSE 1 END) <= 1
  );

-- Segment uniqueness. NULL on a segment column means "all" on that axis, and
-- Postgres treats NULLs as DISTINCT in a unique index — so the generated
-- unique index above does NOT stop a second "all" row for the same bin.
--
-- The obvious fix, a unique index over COALESCE(stat_type::text, '*'), is
-- rejected by Postgres: enum output is STABLE, not IMMUTABLE, because enum
-- labels can be renamed. Partial unique indexes need no cast at all, and
-- together with the single-axis CHECK above they cover every legal row exactly
-- once.
CREATE UNIQUE INDEX "calibration_bins_all_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "bin_index")
  WHERE "stat_type" IS NULL AND "season" IS NULL AND "era" IS NULL;

CREATE UNIQUE INDEX "calibration_bins_stat_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "stat_type", "bin_index")
  WHERE "stat_type" IS NOT NULL;

CREATE UNIQUE INDEX "calibration_bins_season_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "season", "bin_index")
  WHERE "season" IS NOT NULL;

CREATE UNIQUE INDEX "calibration_bins_era_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "era", "bin_index")
  WHERE "era" IS NOT NULL;

-- A bin is a probability bucket. Cheap, and it catches the unit error
-- (percent vs proportion) that is otherwise invisible in a chart. The last
-- clause encodes that threshold observations and their underlying projections
-- are two different sample sizes and never the same one.
ALTER TABLE "calibration_bins"
  ADD CONSTRAINT "calibration_bins_bounds" CHECK (
    "bin_low" >= 0 AND "bin_high" <= 1 AND "bin_low" < "bin_high"
    AND "predicted_mean" >= 0 AND "predicted_mean" <= 1
    AND "observed_rate" >= 0 AND "observed_rate" <= 1
    AND "threshold_observations" >= 0
    AND "projection_count" >= 0
    AND "projection_count" <= "threshold_observations"
  );

-- Population accounting must reconcile on a completed run. A run that cannot
-- account for its own candidates is not a result, and an aggregate computed
-- over an unaccounted population is exactly the silent-and-flattering failure
-- this pitch exists to prevent.
ALTER TABLE "backtest_runs"
  ADD CONSTRAINT "backtest_runs_population_reconciles" CHECK (
    "status" <> 'completed'
    OR ("projected_count" + "unprojectable_count" + "excluded_count" = "candidate_count"
        AND "comparison_count" <= "projected_count")
  );

-- A completed run must carry its reproducibility evidence. The reproducibility
-- claim in this pitch IS these three digests; a run that finished without them
-- cannot support it and must not be storable as completed.
ALTER TABLE "backtest_runs"
  ADD CONSTRAINT "backtest_runs_completed_has_digests" CHECK (
    "status" <> 'completed'
    OR ("predictions_digest" IS NOT NULL
        AND "aggregate_digest" IS NOT NULL
        AND "calibration_digest" IS NOT NULL
        AND "finished_at" IS NOT NULL)
  );
