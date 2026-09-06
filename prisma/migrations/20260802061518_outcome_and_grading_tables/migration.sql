-- CreateEnum
CREATE TYPE "OutcomeResult" AS ENUM ('yes', 'no', 'voided');

-- CreateEnum
CREATE TYPE "ProjectionGradeStatus" AS ENUM ('graded', 'missing_official_result', 'game_never_completed', 'unsupported_stat_type');

-- CreateEnum
CREATE TYPE "ThresholdSource" AS ENUM ('policy', 'market');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PipelineJobCategory" ADD VALUE 'outcome_ingest';
ALTER TYPE "PipelineJobCategory" ADD VALUE 'grading';

-- CreateTable
CREATE TABLE "outcomes" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "result" "OutcomeResult" NOT NULL,
    "settled_at" TIMESTAMP(3),
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "raw_result" TEXT NOT NULL,
    "superseded_count" INTEGER NOT NULL DEFAULT 0,
    "previous_result" "OutcomeResult",
    "previous_recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projection_grades" (
    "id" TEXT NOT NULL,
    "projection_id" TEXT NOT NULL,
    "status" "ProjectionGradeStatus" NOT NULL,
    "official_value" DECIMAL(8,3),
    "graded_stat_version" INTEGER,
    "abs_error_mean" DECIMAL(8,3),
    "abs_error_median" DECIMAL(8,3),
    "season_avg_abs_error" DECIMAL(8,3),
    "trailing_five_abs_error" DECIMAL(8,3),
    "contract_like" BOOLEAN NOT NULL,
    "graded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projection_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threshold_grades" (
    "id" TEXT NOT NULL,
    "projection_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "threshold_source" "ThresholdSource" NOT NULL,
    "threshold" DECIMAL(6,1) NOT NULL,
    "stated_probability" DECIMAL(6,5) NOT NULL,
    "outcome" BOOLEAN NOT NULL,
    "contract_like" BOOLEAN NOT NULL,
    "graded_stat_version" INTEGER NOT NULL,
    "graded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threshold_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outcomes_contract_id_key" ON "outcomes"("contract_id");

-- CreateIndex
CREATE INDEX "outcomes_recorded_at_idx" ON "outcomes"("recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "projection_grades_projection_id_key" ON "projection_grades"("projection_id");

-- CreateIndex
CREATE INDEX "projection_grades_status_idx" ON "projection_grades"("status");

-- CreateIndex
CREATE INDEX "projection_grades_contract_like_idx" ON "projection_grades"("contract_like");

-- CreateIndex
CREATE INDEX "threshold_grades_contract_id_idx" ON "threshold_grades"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "threshold_grades_projection_id_threshold_source_threshold_key" ON "threshold_grades"("projection_id", "threshold_source", "threshold");

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projection_grades" ADD CONSTRAINT "projection_grades_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "projections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_grades" ADD CONSTRAINT "threshold_grades_projection_id_fkey" FOREIGN KEY ("projection_id") REFERENCES "projections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threshold_grades" ADD CONSTRAINT "threshold_grades_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Raw SQL (Prisma does not model CHECK constraints) — spec §8, appended per
-- repo convention with the reason each guard exists.

-- A settled outcome is immutable except through supersession: enforce that a
-- superseded row retains its provenance. A superseded_count above zero with no
-- previous_result would be a changed settlement whose history was dropped.
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_supersession_provenance"
  CHECK ("superseded_count" = 0 OR "previous_result" IS NOT NULL);

-- Threshold grades derived from a market threshold must name their contract.
-- A 'market' row without a contract_id would be an untraceable observation —
-- the market-linked population could no longer be reconstructed.
ALTER TABLE "threshold_grades" ADD CONSTRAINT "threshold_grades_market_has_contract"
  CHECK ("threshold_source" <> 'market' OR "contract_id" IS NOT NULL);

-- A graded grade carries its values; an unresolvable one carries none. This is
-- what keeps the unresolvable taxonomy honest: a status row can never smuggle
-- in a value, and a graded row can never be missing its provenance.
ALTER TABLE "projection_grades" ADD CONSTRAINT "projection_grades_status_values"
  CHECK (
    ("status" = 'graded' AND "official_value" IS NOT NULL AND "graded_stat_version" IS NOT NULL)
    OR ("status" <> 'graded' AND "official_value" IS NULL)
  );
