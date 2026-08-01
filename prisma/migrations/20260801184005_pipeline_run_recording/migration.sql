-- CreateEnum
CREATE TYPE "PipelineJobCategory" AS ENUM ('ingest', 'recompute', 'keepalive');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'incomplete');

-- CreateEnum
CREATE TYPE "PipelineGameStatus" AS ENUM ('succeeded', 'failed', 'skipped');

-- AlterEnum
ALTER TYPE "SnapshotTrigger" ADD VALUE 'final_pre_kickoff';

-- AlterTable
ALTER TABLE "ingest_runs" ADD COLUMN     "pipeline_run_id" TEXT;

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "category" "PipelineJobCategory" NOT NULL,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'running',
    "invocation_id" TEXT NOT NULL,
    "scope" TEXT,
    "code_version" TEXT NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_run_games" (
    "id" TEXT NOT NULL,
    "pipeline_run_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "status" "PipelineGameStatus" NOT NULL,
    "projected_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_run_games_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_runs_category_status_finished_at_idx" ON "pipeline_runs"("category", "status", "finished_at" DESC);

-- CreateIndex
CREATE INDEX "pipeline_runs_category_started_at_idx" ON "pipeline_runs"("category", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_runs_category_invocation_id_key" ON "pipeline_runs"("category", "invocation_id");

-- CreateIndex
CREATE INDEX "pipeline_run_games_game_id_idx" ON "pipeline_run_games"("game_id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_run_games_pipeline_run_id_game_id_key" ON "pipeline_run_games"("pipeline_run_id", "game_id");

-- CreateIndex
CREATE INDEX "ingest_runs_pipeline_run_id_idx" ON "ingest_runs"("pipeline_run_id");

-- AddForeignKey
ALTER TABLE "ingest_runs" ADD CONSTRAINT "ingest_runs_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_run_games" ADD CONSTRAINT "pipeline_run_games_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_run_games" ADD CONSTRAINT "pipeline_run_games_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Raw SQL (Prisma does not model partial indexes): at most one final
-- pre-kickoff snapshot per contract (spec RD-19 idempotence). The scheduled
-- price path may be invoked repeatedly inside the final window; this index is
-- what makes the capture pass idempotent rather than politely hopeful.
CREATE UNIQUE INDEX "recommendation_snapshots_final_one_per_contract"
  ON "recommendation_snapshots" ("contract_id")
  WHERE "trigger" = 'final_pre_kickoff';
