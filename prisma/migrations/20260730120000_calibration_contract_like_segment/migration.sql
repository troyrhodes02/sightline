-- SIG-26: the contract-like population as a fourth SINGLE-AXIS calibration
-- segment. Kalshi lists contracts only for meaningful-volume players, so the
-- calibration curve the recalibration layer (autonomous paper trading) is
-- fitted against must be segmented to that population and stored durably,
-- rather than recomputed ad hoc from Parquet.
--
-- Membership is a projected-value volume floor applied in the harness — a pure
-- function of pre-cutoff information, so it never leaks. Pooled across
-- stat/season/era exactly like the other single-axis segments; cross-axis
-- slices (contract-like within a stat) are derived from the artefacts on
-- demand, never stored.

ALTER TABLE "calibration_bins" ADD COLUMN "population" TEXT;

-- Only the sanctioned population value. A nullable TEXT + CHECK rather than an
-- enum keeps this extensible without a new type migration, and catches a typo
-- in the writer exactly as an enum would.
ALTER TABLE "calibration_bins"
  ADD CONSTRAINT "calibration_bins_population_values" CHECK (
    "population" IS NULL OR "population" = 'contract_like'
  );

-- Single-axis now counts four segment keys: at most one of stat_type, season,
-- era, population is non-null on any stored bin.
ALTER TABLE "calibration_bins" DROP CONSTRAINT "calibration_bins_single_axis";
ALTER TABLE "calibration_bins"
  ADD CONSTRAINT "calibration_bins_single_axis" CHECK (
    (CASE WHEN "stat_type" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "season" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "era" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "population" IS NULL THEN 0 ELSE 1 END) <= 1
  );

-- The "all" segment is now also null on population.
DROP INDEX "calibration_bins_all_segment_uniq";
CREATE UNIQUE INDEX "calibration_bins_all_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "bin_index")
  WHERE "stat_type" IS NULL AND "season" IS NULL AND "era" IS NULL
    AND "population" IS NULL;

-- One bin set per run for the contract-like population.
CREATE UNIQUE INDEX "calibration_bins_population_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "population", "bin_index")
  WHERE "population" IS NOT NULL;
