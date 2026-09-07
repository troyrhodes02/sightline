-- CreateEnum
CREATE TYPE "RiskMode" AS ENUM ('conservative', 'moderate', 'aggressive', 'custom');

-- CreateEnum
CREATE TYPE "BreachCondition" AS ENUM ('drawdown_warning', 'drawdown_halt', 'calibration', 'exposure', 'kill_switch');

-- CreateEnum
CREATE TYPE "BreachResolution" AS ENUM ('active', 'cleared', 'force_overridden');

-- CreateEnum
CREATE TYPE "PaperCycleOutcome" AS ENUM ('ok', 'partial_fill', 'no_candidate', 'halted', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "CandidateVerdict" AS ENUM ('filled', 'partial', 'no_stake', 'refused', 'blocked');

-- CreateEnum
CREATE TYPE "BindingConstraint" AS ENUM ('none', 'top_of_book_size', 'per_game_cap', 'per_slate_cap', 'available_bankroll', 'probability_ceiling', 'no_edge_after_fees', 'stale_projection', 'price_unavailable', 'pre_kickoff_cutoff', 'breaker', 'no_active_recalibration');

-- CreateEnum
CREATE TYPE "PaperPositionStatus" AS ENUM ('open', 'settled_won', 'settled_lost', 'voided');

-- CreateEnum
CREATE TYPE "PaperLedgerEntryKind" AS ENUM ('opening_balance', 'stake_debit', 'fee_debit', 'settlement_credit', 'void_refund', 'withdrawal');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PipelineJobCategory" ADD VALUE 'paper_cycle';
ALTER TYPE "PipelineJobCategory" ADD VALUE 'paper_settlement';
ALTER TYPE "PipelineJobCategory" ADD VALUE 'recalibration_fit';

-- CreateTable
CREATE TABLE "paper_campaigns" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "starting_bankroll_cents" INTEGER NOT NULL,
    "autonomy_enabled" BOOLEAN NOT NULL DEFAULT false,
    "kill_switch_engaged" BOOLEAN NOT NULL DEFAULT false,
    "high_water_mark_cents" INTEGER NOT NULL,
    "high_water_mark_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_risk_configs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "mode" "RiskMode" NOT NULL,
    "kelly_fraction" DECIMAL(4,3) NOT NULL,
    "per_game_cap_pct" INTEGER NOT NULL,
    "per_slate_cap_pct" INTEGER NOT NULL,
    "drawdown_warn_pct" INTEGER NOT NULL,
    "drawdown_halt_pct" INTEGER NOT NULL,
    "probability_ceiling" DECIMAL(4,3) NOT NULL,
    "withdrawal_ceiling_multiple" DECIMAL(4,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_risk_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_control_events" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "detail" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_control_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_ledger_entries" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "kind" "PaperLedgerEntryKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "position_id" TEXT,
    "cycle_id" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recalibration_fits" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "model_version" TEXT NOT NULL,
    "backtest_run_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "shrinkage_k" INTEGER NOT NULL,
    "live_observation_count" INTEGER NOT NULL,
    "live_window_from" TIMESTAMP(3),
    "live_window_to" TIMESTAMP(3),
    "knots" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "fitted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recalibration_fits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_cycles" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "risk_config_id" TEXT NOT NULL,
    "recalibration_id" TEXT,
    "game_id" TEXT NOT NULL,
    "pipeline_run_id" TEXT,
    "invocation_id" TEXT,
    "outcome" "PaperCycleOutcome" NOT NULL,
    "skip_reason" TEXT,
    "candidates_evaluated" INTEGER NOT NULL DEFAULT 0,
    "candidates_sized" INTEGER NOT NULL DEFAULT 0,
    "candidates_filled" INTEGER NOT NULL DEFAULT 0,
    "staked_cents" INTEGER NOT NULL DEFAULT 0,
    "bankroll_at_evaluation_cents" INTEGER NOT NULL,
    "settled_balance_cents" INTEGER NOT NULL,
    "open_exposure_cents" INTEGER NOT NULL,
    "slate_capacity_cents" INTEGER NOT NULL,
    "game_capacity_cents" INTEGER NOT NULL,
    "high_water_mark_cents" INTEGER NOT NULL,
    "drawdown_bps" INTEGER,
    "calibration_brier" DECIMAL(6,5),
    "calibration_market_brier" DECIMAL(6,5),
    "calibration_sample_size" INTEGER,
    "allocation_passes" INTEGER NOT NULL DEFAULT 0,
    "allocation_trace" JSONB NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_cycle_candidates" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "projection_id" TEXT,
    "price_observation_id" TEXT,
    "recalibration_id" TEXT,
    "rank" INTEGER NOT NULL,
    "raw_probability" DECIMAL(6,5),
    "corrected_probability" DECIMAL(6,5),
    "confidence" "Confidence",
    "side" "MarketSide",
    "ask_cents" INTEGER,
    "fee_cents" INTEGER,
    "net_price_cents" INTEGER,
    "top_of_book_size_contracts" INTEGER,
    "kelly_edge" DECIMAL(7,6),
    "kelly_fraction_applied" DECIMAL(5,4),
    "intended_stake_cents" INTEGER NOT NULL DEFAULT 0,
    "intended_contracts" INTEGER NOT NULL DEFAULT 0,
    "filled_contracts" INTEGER NOT NULL DEFAULT 0,
    "filled_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "filled_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "verdict" "CandidateVerdict" NOT NULL,
    "boundBy" "BindingConstraint" NOT NULL,
    "bound_by_detail" TEXT,
    "position_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_cycle_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_positions" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "risk_config_id" TEXT NOT NULL,
    "side" "MarketSide" NOT NULL,
    "contracts" INTEGER NOT NULL,
    "cost_basis_cents" INTEGER NOT NULL,
    "fees_paid_cents" INTEGER NOT NULL,
    "intended_stake_cents" INTEGER NOT NULL,
    "status" "PaperPositionStatus" NOT NULL DEFAULT 'open',
    "settlement_result" "OutcomeResult",
    "proceeds_cents" INTEGER,
    "realized_pnl_cents" INTEGER,
    "settled_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paper_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_fills" (
    "id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "contracts" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "filled_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_fills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_desired_exposures" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "game_window_key" TEXT NOT NULL,
    "decision_date" DATE NOT NULL,
    "desired_contracts" INTEGER NOT NULL,
    "desired_stake_cents" INTEGER NOT NULL,
    "last_cycle_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_desired_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_breaches" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "risk_config_id" TEXT NOT NULL,
    "condition" "BreachCondition" NOT NULL,
    "resolution" "BreachResolution" NOT NULL DEFAULT 'active',
    "measured_value" DECIMAL(12,5) NOT NULL,
    "measured_display" TEXT NOT NULL,
    "threshold_value" DECIMAL(12,5) NOT NULL,
    "threshold_display" TEXT NOT NULL,
    "detected_by_cycle_id" TEXT,
    "tripped_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_dry_runs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "risk_config_id" TEXT NOT NULL,
    "recalibration_id" TEXT,
    "game_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "would_execute" BOOLEAN NOT NULL,
    "blocked_by_breaches" JSONB,
    "plan" JSONB NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_dry_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_replays" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "period_kind" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "actual_mode" "RiskMode" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_replay_mode_results" (
    "id" TEXT NOT NULL,
    "replay_id" TEXT NOT NULL,
    "mode" "RiskMode" NOT NULL,
    "ending_active_cents" INTEGER NOT NULL,
    "net_pnl_cents" INTEGER NOT NULL,
    "withdrawn_cents" INTEGER NOT NULL,
    "max_drawdown_bps" INTEGER NOT NULL,
    "position_count" INTEGER NOT NULL,
    "breaker_trips" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_replay_mode_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paper_risk_configs_campaign_id_effective_from_idx" ON "paper_risk_configs"("campaign_id", "effective_from" DESC);

-- CreateIndex
CREATE INDEX "paper_control_events_campaign_id_occurred_at_idx" ON "paper_control_events"("campaign_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "paper_ledger_entries_campaign_id_occurred_at_id_idx" ON "paper_ledger_entries"("campaign_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "paper_ledger_entries_position_id_idx" ON "paper_ledger_entries"("position_id");

-- CreateIndex
CREATE UNIQUE INDEX "recalibration_fits_version_key" ON "recalibration_fits"("version");

-- CreateIndex
CREATE INDEX "recalibration_fits_model_version_fitted_at_idx" ON "recalibration_fits"("model_version", "fitted_at" DESC);

-- CreateIndex
CREATE INDEX "paper_cycles_campaign_id_started_at_idx" ON "paper_cycles"("campaign_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "paper_cycles_game_id_idx" ON "paper_cycles"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_cycles_campaign_id_game_id_invocation_id_key" ON "paper_cycles"("campaign_id", "game_id", "invocation_id");

-- CreateIndex
CREATE INDEX "paper_cycle_candidates_contract_id_idx" ON "paper_cycle_candidates"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_cycle_candidates_cycle_id_contract_id_key" ON "paper_cycle_candidates"("cycle_id", "contract_id");

-- CreateIndex
CREATE INDEX "paper_positions_campaign_id_status_idx" ON "paper_positions"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "paper_positions_campaign_id_contract_id_key" ON "paper_positions"("campaign_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_fills_candidate_id_key" ON "paper_fills"("candidate_id");

-- CreateIndex
CREATE INDEX "paper_fills_position_id_idx" ON "paper_fills"("position_id");

-- CreateIndex
CREATE INDEX "paper_fills_cycle_id_idx" ON "paper_fills"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_desired_exposures_campaign_id_contract_id_game_window_key" ON "paper_desired_exposures"("campaign_id", "contract_id", "game_window_key", "decision_date");

-- CreateIndex
CREATE INDEX "paper_breaches_campaign_id_tripped_at_idx" ON "paper_breaches"("campaign_id", "tripped_at" DESC);

-- CreateIndex
CREATE INDEX "paper_dry_runs_campaign_id_ran_at_idx" ON "paper_dry_runs"("campaign_id", "ran_at" DESC);

-- CreateIndex
CREATE INDEX "paper_replays_campaign_id_period_kind_period_key_idx" ON "paper_replays"("campaign_id", "period_kind", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "paper_replays_campaign_id_period_kind_period_key_ran_at_key" ON "paper_replays"("campaign_id", "period_kind", "period_key", "ran_at");

-- CreateIndex
CREATE UNIQUE INDEX "paper_replay_mode_results_replay_id_mode_key" ON "paper_replay_mode_results"("replay_id", "mode");

-- AddForeignKey
ALTER TABLE "paper_risk_configs" ADD CONSTRAINT "paper_risk_configs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_risk_configs" ADD CONSTRAINT "paper_risk_configs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_control_events" ADD CONSTRAINT "paper_control_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_control_events" ADD CONSTRAINT "paper_control_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_ledger_entries" ADD CONSTRAINT "paper_ledger_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_ledger_entries" ADD CONSTRAINT "paper_ledger_entries_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "paper_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_ledger_entries" ADD CONSTRAINT "paper_ledger_entries_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "paper_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recalibration_fits" ADD CONSTRAINT "recalibration_fits_backtest_run_id_fkey" FOREIGN KEY ("backtest_run_id") REFERENCES "backtest_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycles" ADD CONSTRAINT "paper_cycles_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycles" ADD CONSTRAINT "paper_cycles_risk_config_id_fkey" FOREIGN KEY ("risk_config_id") REFERENCES "paper_risk_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycles" ADD CONSTRAINT "paper_cycles_recalibration_id_fkey" FOREIGN KEY ("recalibration_id") REFERENCES "recalibration_fits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycles" ADD CONSTRAINT "paper_cycles_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycles" ADD CONSTRAINT "paper_cycles_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "paper_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "projections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_price_observation_id_fkey" FOREIGN KEY ("price_observation_id") REFERENCES "price_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_recalibration_id_fkey" FOREIGN KEY ("recalibration_id") REFERENCES "recalibration_fits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "paper_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_risk_config_id_fkey" FOREIGN KEY ("risk_config_id") REFERENCES "paper_risk_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_fills" ADD CONSTRAINT "paper_fills_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "paper_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_fills" ADD CONSTRAINT "paper_fills_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "paper_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_desired_exposures" ADD CONSTRAINT "paper_desired_exposures_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_desired_exposures" ADD CONSTRAINT "paper_desired_exposures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_breaches" ADD CONSTRAINT "paper_breaches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_breaches" ADD CONSTRAINT "paper_breaches_risk_config_id_fkey" FOREIGN KEY ("risk_config_id") REFERENCES "paper_risk_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_breaches" ADD CONSTRAINT "paper_breaches_detected_by_cycle_id_fkey" FOREIGN KEY ("detected_by_cycle_id") REFERENCES "paper_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_breaches" ADD CONSTRAINT "paper_breaches_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_dry_runs" ADD CONSTRAINT "paper_dry_runs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_dry_runs" ADD CONSTRAINT "paper_dry_runs_risk_config_id_fkey" FOREIGN KEY ("risk_config_id") REFERENCES "paper_risk_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_dry_runs" ADD CONSTRAINT "paper_dry_runs_recalibration_id_fkey" FOREIGN KEY ("recalibration_id") REFERENCES "recalibration_fits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_dry_runs" ADD CONSTRAINT "paper_dry_runs_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_dry_runs" ADD CONSTRAINT "paper_dry_runs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_replays" ADD CONSTRAINT "paper_replays_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "paper_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_replays" ADD CONSTRAINT "paper_replays_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_replay_mode_results" ADD CONSTRAINT "paper_replay_mode_results_replay_id_fkey" FOREIGN KEY ("replay_id") REFERENCES "paper_replays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (SIG-60). Prisma models none of these: partial
-- unique indexes and CHECK constraints are outside its schema language, and
-- every one of them guards a rule that application code alone would eventually
-- relax.
-- ---------------------------------------------------------------------------

-- One ACTIVE breach per condition per campaign. Without this a flapping
-- breaker opens a second row for a condition that is already breached, and the
-- override flow would then have a breach it never showed the operator.
CREATE UNIQUE INDEX "paper_breaches_one_active_per_condition"
  ON "paper_breaches" ("campaign_id", "condition")
  WHERE "resolution" = 'active';

-- Exactly one active recalibration fit per model version. Two active fits would
-- make "the corrected probability" ambiguous at the moment it matters most.
CREATE UNIQUE INDEX "recalibration_fits_one_active_per_model"
  ON "recalibration_fits" ("model_version")
  WHERE "is_active" = true;

-- A resolved breach must carry its resolver and time. A force override that
-- lost its actor is an audit trail that lost its point.
ALTER TABLE "paper_breaches" ADD CONSTRAINT "paper_breaches_resolution_provenance"
  CHECK (
    ("resolution" = 'active' AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL)
    OR ("resolution" <> 'active' AND "resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL)
  );

-- Percentage and fraction bounds, so an out-of-range configuration cannot be
-- persisted even if a route handler were bypassed. `drawdown_halt_pct >
-- drawdown_warn_pct` is what keeps the warning a warning.
ALTER TABLE "paper_risk_configs" ADD CONSTRAINT "paper_risk_configs_bounds"
  CHECK (
    "kelly_fraction" >= 0 AND "kelly_fraction" <= 1
    AND "per_game_cap_pct" BETWEEN 1 AND 50
    AND "per_slate_cap_pct" BETWEEN 1 AND 50
    AND "per_slate_cap_pct" >= "per_game_cap_pct"
    AND "drawdown_warn_pct" BETWEEN 1 AND 50
    AND "drawdown_halt_pct" BETWEEN 1 AND 50
    AND "drawdown_halt_pct" > "drawdown_warn_pct"
    AND "probability_ceiling" > 0 AND "probability_ceiling" <= 1
    AND "withdrawal_ceiling_multiple" >= 1
  );

-- THE FLATTERING-FILL GUARD, in the database.
--
-- A fill can never exceed the size that was actually displayed at the top of
-- the book, and can never exceed what was intended. Paper trading exists to
-- produce honest evidence about whether the system deserves real capital, and
-- the single most likely way that evidence gets corrupted is a well-meaning
-- optimisation in application code that walks the book or assumes unseen depth.
-- Expressing the rule here means such a change fails loudly at the write
-- instead of quietly inflating a year of simulated returns.
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_fill_within_book"
  CHECK (
    "top_of_book_size_contracts" IS NULL
    OR "filled_contracts" <= "top_of_book_size_contracts"
  );

ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_fill_within_intent"
  CHECK ("filled_contracts" <= "intended_contracts");

-- A candidate that filled nothing must not claim filled money, and one that
-- filled must not claim none.
ALTER TABLE "paper_cycle_candidates" ADD CONSTRAINT "paper_cycle_candidates_fill_coherence"
  CHECK (
    ("filled_contracts" = 0 AND "filled_cost_cents" = 0 AND "filled_fee_cents" = 0)
    OR ("filled_contracts" > 0 AND "filled_cost_cents" > 0)
  );

-- Quantities and money are non-negative; Kalshi prices are integer cents 1-99.
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_non_negative"
  CHECK (
    "contracts" >= 0
    AND "cost_basis_cents" >= 0
    AND "fees_paid_cents" >= 0
    AND "intended_stake_cents" >= 0
  );

ALTER TABLE "paper_fills" ADD CONSTRAINT "paper_fills_sane"
  CHECK (
    "contracts" > 0
    AND "price_cents" BETWEEN 1 AND 99
    AND "fee_cents" >= 0
    AND "cost_cents" = "contracts" * "price_cents"
  );

-- A settled position carries its result and its realised P&L together; an open
-- one carries neither. This is what keeps "P&L is null while open" a property
-- of the data rather than a convention in the read layer.
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_settlement_coherence"
  CHECK (
    ("status" = 'open' AND "settlement_result" IS NULL AND "realized_pnl_cents" IS NULL AND "settled_at" IS NULL)
    OR ("status" <> 'open' AND "settlement_result" IS NOT NULL AND "realized_pnl_cents" IS NOT NULL AND "settled_at" IS NOT NULL)
  );

-- Desired exposure is a total, never negative.
ALTER TABLE "paper_desired_exposures" ADD CONSTRAINT "paper_desired_exposures_non_negative"
  CHECK ("desired_contracts" >= 0 AND "desired_stake_cents" >= 0);

-- The starting bankroll defines the historical record and must be positive.
ALTER TABLE "paper_campaigns" ADD CONSTRAINT "paper_campaigns_starting_bankroll_positive"
  CHECK ("starting_bankroll_cents" > 0);
