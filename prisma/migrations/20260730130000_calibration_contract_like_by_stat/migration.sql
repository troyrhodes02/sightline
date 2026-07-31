-- SIG-26 (segmentation axis): permit the contract-like × stat-type PAIR as a
-- stored calibration segment, in addition to the single-axis segments.
--
-- Miscalibration is not uniform across stat types — touchdowns over-project far
-- more than yardage — so a single global contract-like correction would under-
-- correct one and over-correct another, and that error feeds straight into
-- stake size. The recalibration layer therefore needs contract-like curves per
-- stat type, and they must be durable and verifiable rather than refitted ad
-- hoc from Parquet (the very thing SIG-26 exists to eliminate).
--
-- This is the ONLY permitted two-axis combination. Everything else stays
-- single-axis. The partial unique indexes are tightened so the new pair does
-- not collide with the pooled contract-like segment or the plain stat segment.

-- The plain per-stat segment is the one with NO population. Without this clause
-- a contract-like × stat row (stat_type NOT NULL) would collide with it.
DROP INDEX "calibration_bins_stat_segment_uniq";
CREATE UNIQUE INDEX "calibration_bins_stat_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "stat_type", "bin_index")
  WHERE "stat_type" IS NOT NULL AND "population" IS NULL;

-- The pooled contract-like segment is the one with NO stat type. Without this
-- clause a contract-like × stat row (population NOT NULL) would collide with it.
DROP INDEX "calibration_bins_population_segment_uniq";
CREATE UNIQUE INDEX "calibration_bins_population_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "population", "bin_index")
  WHERE "population" IS NOT NULL AND "stat_type" IS NULL;

-- The new pair: one bin set per (run, population, stat_type).
CREATE UNIQUE INDEX "calibration_bins_population_stat_segment_uniq"
  ON "calibration_bins" ("backtest_run_id", "population", "stat_type", "bin_index")
  WHERE "population" IS NOT NULL AND "stat_type" IS NOT NULL;

-- Axis rule: at most one segment key is set, EXCEPT the sanctioned
-- population × stat_type pair (season and era still null on it).
ALTER TABLE "calibration_bins" DROP CONSTRAINT "calibration_bins_single_axis";
ALTER TABLE "calibration_bins"
  ADD CONSTRAINT "calibration_bins_single_axis" CHECK (
    (CASE WHEN "stat_type" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "season" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "era" IS NULL THEN 0 ELSE 1 END
     + CASE WHEN "population" IS NULL THEN 0 ELSE 1 END) <= 1
    OR ("season" IS NULL AND "era" IS NULL
        AND "population" IS NOT NULL AND "stat_type" IS NOT NULL)
  );
