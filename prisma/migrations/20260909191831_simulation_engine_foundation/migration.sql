-- CreateEnum
CREATE TYPE "ProjectionDeclineReason" AS ENUM ('insufficient_evidence');

-- CreateEnum
CREATE TYPE "CorrelationMethod" AS ENUM ('spearman');

-- CreateTable
CREATE TABLE "projection_declines" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "stat_type" "StatType" NOT NULL,
    "model_version" TEXT NOT NULL,
    "reason" "ProjectionDeclineReason" NOT NULL,
    "information_cutoff" TIMESTAMP(3) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projection_declines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_simulations" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "information_cutoff" TIMESTAMP(3) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "seed" BIGINT NOT NULL,
    "draw_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_outcome_correlations" (
    "id" TEXT NOT NULL,
    "game_simulation_id" TEXT NOT NULL,
    "player_a_id" TEXT NOT NULL,
    "stat_a" "StatType" NOT NULL,
    "player_b_id" TEXT NOT NULL,
    "stat_b" "StatType" NOT NULL,
    "method" "CorrelationMethod" NOT NULL DEFAULT 'spearman',
    "correlation" DECIMAL(6,5) NOT NULL,

    CONSTRAINT "player_outcome_correlations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_selections" (
    "stat_type" "StatType" NOT NULL,
    "model_version" TEXT NOT NULL,
    "backtest_run_id" TEXT,
    "brier_delta" DECIMAL(6,4),
    "sample_size" INTEGER,
    "note" TEXT,
    "promoted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_selections_pkey" PRIMARY KEY ("stat_type")
);

-- CreateIndex
CREATE INDEX "projection_declines_game_id_stat_type_idx" ON "projection_declines"("game_id", "stat_type");

-- CreateIndex
CREATE UNIQUE INDEX "projection_declines_player_id_game_id_stat_type_model_versi_key" ON "projection_declines"("player_id", "game_id", "stat_type", "model_version", "information_cutoff");

-- CreateIndex
CREATE INDEX "game_simulations_game_id_idx" ON "game_simulations"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "game_simulations_game_id_model_version_information_cutoff_key" ON "game_simulations"("game_id", "model_version", "information_cutoff");

-- CreateIndex
CREATE INDEX "player_outcome_correlations_game_simulation_id_idx" ON "player_outcome_correlations"("game_simulation_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_outcome_correlations_game_simulation_id_player_a_id__key" ON "player_outcome_correlations"("game_simulation_id", "player_a_id", "stat_a", "player_b_id", "stat_b");

-- CreateIndex
CREATE INDEX "model_selections_model_version_idx" ON "model_selections"("model_version");

-- CreateIndex
CREATE INDEX "projections_game_id_stat_type_model_version_computed_at_idx" ON "projections"("game_id", "stat_type", "model_version", "computed_at" DESC);

-- AddForeignKey
ALTER TABLE "projection_declines" ADD CONSTRAINT "projection_declines_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_declines" ADD CONSTRAINT "projection_declines_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_simulations" ADD CONSTRAINT "game_simulations_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_outcome_correlations" ADD CONSTRAINT "player_outcome_correlations_game_simulation_id_fkey" FOREIGN KEY ("game_simulation_id") REFERENCES "game_simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_selections" ADD CONSTRAINT "model_selections_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Check constraints (hand-written; Prisma does not manage CHECK)
ALTER TABLE "player_outcome_correlations"
  ADD CONSTRAINT "player_outcome_correlations_bounds" CHECK ("correlation" >= -1 AND "correlation" <= 1);

ALTER TABLE "game_simulations"
  ADD CONSTRAINT "game_simulations_draw_count_positive" CHECK ("draw_count" > 0);

ALTER TABLE "game_simulations"
  ADD CONSTRAINT "game_simulations_seed_nonnegative" CHECK ("seed" >= 0);

-- Seed ModelSelection: every stat type on the permanent Pitch 2 baseline.
-- No stat type ships promoted; promotion is a reviewed change after the
-- human-run multi-season validation backtest clears the RD-1 bar.
INSERT INTO "model_selections" ("stat_type", "model_version", "promoted_at", "updated_at")
VALUES
  ('passing_yards',   'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rushing_yards',   'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('receiving_yards', 'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('receptions',      'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rushing_tds',     'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('receiving_tds',   'baseline-zil-0.1.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("stat_type") DO NOTHING;
