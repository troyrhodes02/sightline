-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'closed', 'delisted');

-- CreateEnum
CREATE TYPE "MarketSyncStatus" AS ENUM ('complete', 'partial', 'failed', 'empty');

-- CreateEnum
CREATE TYPE "MarketSide" AS ENUM ('yes', 'no');

-- CreateEnum
CREATE TYPE "SnapshotTrigger" AS ENUM ('appeared', 'state_changed', 'decision');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('took', 'faded', 'skipped');

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "kalshi_ticker" TEXT NOT NULL,
    "kalshi_event_ticker" TEXT,
    "kalshi_series_ticker" TEXT,
    "title" TEXT NOT NULL,
    "kalshi_player_name" TEXT,
    "player_id" TEXT,
    "game_id" TEXT,
    "stat_type" "StatType",
    "threshold" DECIMAL(6,1),
    "resolution_status" "IdentityResolutionStatus" NOT NULL DEFAULT 'unresolved',
    "resolution_note" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'active',
    "close_time" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_sync_runs" (
    "id" TEXT NOT NULL,
    "status" "MarketSyncStatus" NOT NULL,
    "markets_discovered" INTEGER NOT NULL DEFAULT 0,
    "contracts_upserted" INTEGER NOT NULL DEFAULT 0,
    "observations_written" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_observations" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "sync_run_id" TEXT NOT NULL,
    "yes_bid_cents" INTEGER,
    "yes_ask_cents" INTEGER,
    "no_bid_cents" INTEGER,
    "no_ask_cents" INTEGER,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projections" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "stat_type" "StatType" NOT NULL,
    "model_version" TEXT NOT NULL,
    "distribution_kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "quantiles" JSONB NOT NULL,
    "pmf" JSONB,
    "projected_value" DECIMAL(8,3) NOT NULL,
    "projected_median" DECIMAL(8,3) NOT NULL,
    "interval_low" DECIMAL(8,3) NOT NULL,
    "interval_high" DECIMAL(8,3) NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "n_eff" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "information_cutoff" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_drivers" (
    "id" TEXT NOT NULL,
    "projection_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "projection_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_snapshots" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "projection_id" TEXT,
    "price_observation_id" TEXT,
    "side" "MarketSide",
    "model_probability" DECIMAL(6,5),
    "ask_cents" INTEGER,
    "edge_points" DECIMAL(6,2),
    "confidence_adjusted_edge" DECIMAL(6,2),
    "confidence" "Confidence",
    "is_recommended" BOOLEAN NOT NULL,
    "threshold_points" DECIMAL(5,2) NOT NULL,
    "trigger" "SnapshotTrigger" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "disposition" "Disposition" NOT NULL,
    "supersedes_decision_id" TEXT,
    "snapshot_projection_id" TEXT,
    "snapshot_price_observation_id" TEXT,
    "snapshot_model_probability" DECIMAL(6,5),
    "snapshot_side" "MarketSide",
    "snapshot_ask_cents" INTEGER,
    "snapshot_edge_points" DECIMAL(6,2),
    "snapshot_confidence" "Confidence",
    "snapshot_is_recommended" BOOLEAN,
    "snapshot_projection_computed_at" TIMESTAMP(3),
    "snapshot_information_cutoff" TIMESTAMP(3),
    "snapshot_price_observed_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_kalshi_ticker_key" ON "contracts"("kalshi_ticker");

-- CreateIndex
CREATE INDEX "contracts_status_resolution_status_idx" ON "contracts"("status", "resolution_status");

-- CreateIndex
CREATE INDEX "contracts_game_id_idx" ON "contracts"("game_id");

-- CreateIndex
CREATE INDEX "contracts_player_id_game_id_stat_type_idx" ON "contracts"("player_id", "game_id", "stat_type");

-- CreateIndex
CREATE INDEX "market_sync_runs_started_at_idx" ON "market_sync_runs"("started_at" DESC);

-- CreateIndex
CREATE INDEX "price_observations_contract_id_observed_at_idx" ON "price_observations"("contract_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "projections_game_id_stat_type_computed_at_idx" ON "projections"("game_id", "stat_type", "computed_at" DESC);

-- CreateIndex
CREATE INDEX "projections_player_id_game_id_stat_type_computed_at_idx" ON "projections"("player_id", "game_id", "stat_type", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "projections_player_id_game_id_stat_type_model_version_infor_key" ON "projections"("player_id", "game_id", "stat_type", "model_version", "information_cutoff");

-- CreateIndex
CREATE UNIQUE INDEX "projection_drivers_projection_id_rank_key" ON "projection_drivers"("projection_id", "rank");

-- CreateIndex
CREATE INDEX "recommendation_snapshots_contract_id_created_at_idx" ON "recommendation_snapshots"("contract_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "decisions_supersedes_decision_id_key" ON "decisions"("supersedes_decision_id");

-- CreateIndex
CREATE INDEX "decisions_contract_id_decided_at_idx" ON "decisions"("contract_id", "decided_at" DESC);

-- CreateIndex
CREATE INDEX "decisions_user_id_decided_at_idx" ON "decisions"("user_id", "decided_at" DESC);

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "market_sync_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projections" ADD CONSTRAINT "projections_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projections" ADD CONSTRAINT "projections_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_drivers" ADD CONSTRAINT "projection_drivers_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "projections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "projections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_snapshots" ADD CONSTRAINT "recommendation_snapshots_price_observation_id_fkey" FOREIGN KEY ("price_observation_id") REFERENCES "price_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_snapshot_projection_id_fkey" FOREIGN KEY ("snapshot_projection_id") REFERENCES "projections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_snapshot_price_observation_id_fkey" FOREIGN KEY ("snapshot_price_observation_id") REFERENCES "price_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_decision_id_fkey" FOREIGN KEY ("supersedes_decision_id") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
