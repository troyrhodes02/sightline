-- CreateEnum
CREATE TYPE "ProjectionProvenance" AS ENUM ('base', 'adjustment_shadow');

-- CreateEnum
CREATE TYPE "SourceEventStatus" AS ENUM ('active', 'superseded', 'conflicting', 'post_kickoff');

-- CreateEnum
CREATE TYPE "SourceClaimOutcome" AS ENUM ('correct', 'incorrect', 'unverifiable');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'accepted', 'declined', 'insufficient_evidence', 'superseded');

-- AlterEnum
ALTER TYPE "BindingConstraint" ADD VALUE 'pending_suggestion';

-- DropIndex
DROP INDEX "projections_player_id_game_id_stat_type_model_version_infor_key";

-- AlterTable
ALTER TABLE "paper_positions" ADD COLUMN     "projection_changed_after_entry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projection_changed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "projections" ADD COLUMN     "adjustment_suggestion_id" TEXT,
ADD COLUMN     "provenance" "ProjectionProvenance" NOT NULL DEFAULT 'base';

-- CreateTable
CREATE TABLE "adjustment_source_events" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "subject_player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "claim_type" TEXT NOT NULL,
    "claim_value" TEXT NOT NULL,
    "evidence_text" TEXT NOT NULL,
    "status" "SourceEventStatus" NOT NULL DEFAULT 'active',
    "superseded_by_id" TEXT,
    "source_outcome" "SourceClaimOutcome",
    "graded_stat_version" INTEGER,
    "source_graded_at" TIMESTAMP(3),
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "raised_at" TIMESTAMP(3) NOT NULL,
    "last_confirmed_at" TIMESTAMP(3) NOT NULL,
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_source_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_suggestions" (
    "id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "target_player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "stat_type" "StatType" NOT NULL,
    "base_projection_id" TEXT NOT NULL,
    "shadow_projection_id" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "materiality_kind" TEXT NOT NULL,
    "material_threshold_pp" DECIMAL(6,2),
    "material_relative_pct" DECIMAL(6,2),
    "reason_text" TEXT NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adjustment_source_events_source_subject_player_id_claim_typ_idx" ON "adjustment_source_events"("source", "subject_player_id", "claim_type", "status");

-- CreateIndex
CREATE INDEX "adjustment_source_events_game_id_status_idx" ON "adjustment_source_events"("game_id", "status");

-- CreateIndex
CREATE INDEX "adjustment_source_events_known_at_idx" ON "adjustment_source_events"("known_at");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_suggestions_shadow_projection_id_key" ON "adjustment_suggestions"("shadow_projection_id");

-- CreateIndex
CREATE INDEX "adjustment_suggestions_game_id_status_idx" ON "adjustment_suggestions"("game_id", "status");

-- CreateIndex
CREATE INDEX "adjustment_suggestions_target_player_id_game_id_stat_type_s_idx" ON "adjustment_suggestions"("target_player_id", "game_id", "stat_type", "status");

-- CreateIndex
CREATE INDEX "adjustment_suggestions_source_event_id_idx" ON "adjustment_suggestions"("source_event_id");

-- CreateIndex
CREATE INDEX "projections_game_id_stat_type_provenance_computed_at_idx" ON "projections"("game_id", "stat_type", "provenance", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "projections_player_id_game_id_stat_type_model_version_infor_key" ON "projections"("player_id", "game_id", "stat_type", "model_version", "information_cutoff", "provenance");

-- AddForeignKey
ALTER TABLE "adjustment_source_events" ADD CONSTRAINT "adjustment_source_events_subject_player_id_fkey" FOREIGN KEY ("subject_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_source_events" ADD CONSTRAINT "adjustment_source_events_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_source_events" ADD CONSTRAINT "adjustment_source_events_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "adjustment_source_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "adjustment_source_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_target_player_id_fkey" FOREIGN KEY ("target_player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_base_projection_id_fkey" FOREIGN KEY ("base_projection_id") REFERENCES "projections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_shadow_projection_id_fkey" FOREIGN KEY ("shadow_projection_id") REFERENCES "projections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_suggestions" ADD CONSTRAINT "adjustment_suggestions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Constructs Prisma cannot express (spec §7 "Raw SQL constructs").

-- At most one NON-superseded source event per dedup identity. superseded events
-- are historical (a reversal chain) and excluded; active/conflicting/post_kickoff
-- are "live" and must be unique so a re-publish upserts rather than duplicates.
CREATE UNIQUE INDEX "adjustment_source_events_one_live_per_identity"
  ON "adjustment_source_events" ("source", "subject_player_id", "claim_type")
  WHERE "status" <> 'superseded';

-- Human-readable evidence and reason are the whole point of the feature; empty
-- strings would defeat it silently.
ALTER TABLE "adjustment_source_events"
  ADD CONSTRAINT "source_event_evidence_nonempty" CHECK (length("evidence_text") > 0);
ALTER TABLE "adjustment_suggestions"
  ADD CONSTRAINT "suggestion_reason_nonempty" CHECK (length("reason_text") > 0);

-- A shadow suggestion must reference a shadow projection distinct from its base.
ALTER TABLE "adjustment_suggestions"
  ADD CONSTRAINT "suggestion_base_shadow_distinct"
  CHECK ("shadow_projection_id" IS NULL OR "shadow_projection_id" <> "base_projection_id");

-- adjustment_source_events is a bitemporal fact table: known_at (ingest) is
-- never before valid_at (the source's effective time). Same guarantee every
-- other fact table carries; game_weather is the only sanctioned exception.
ALTER TABLE "adjustment_source_events"
  ADD CONSTRAINT "adjustment_source_events_known_after_valid"
  CHECK ("known_at" >= "valid_at");
