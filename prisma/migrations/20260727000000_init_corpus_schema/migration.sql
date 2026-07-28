-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('nflverse', 'espn', 'kalshi', 'open_meteo', 'manual');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('success', 'partial', 'degraded', 'failed');

-- CreateEnum
CREATE TYPE "IdentityResolutionStatus" AS ENUM ('resolved', 'unresolved', 'ambiguous', 'manual_override');

-- CreateEnum
CREATE TYPE "WeatherEra" AS ENUM ('archived_forecast', 'reanalysis');

-- CreateEnum
CREATE TYPE "WeatherStatus" AS ENUM ('observed', 'dome', 'unavailable', 'request_failed');

-- CreateEnum
CREATE TYPE "ContextType" AS ENUM ('snap_count_offense', 'snap_pct_offense', 'snap_count_defense', 'snap_pct_defense', 'snap_pct_st', 'participation_status', 'practice_status', 'injury_designation', 'rest_days', 'travel_km');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('scheduled', 'completed', 'postponed', 'relocated', 'cancelled');

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "nflverse_abbr" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "conference" TEXT,
    "division" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT,
    "birth_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_external_ids" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "external_id" TEXT,
    "external_name" TEXT NOT NULL,
    "player_id" TEXT,
    "status" "IdentityResolutionStatus" NOT NULL DEFAULT 'unresolved',
    "candidate_ids" JSONB,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_external_ids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "week" INTEGER NOT NULL,
    "season_type" TEXT NOT NULL,
    "home_team_id" TEXT NOT NULL,
    "away_team_id" TEXT NOT NULL,
    "venue" TEXT,
    "is_dome" BOOLEAN NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'scheduled',
    "kickoff_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_schedule_revisions" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "kickoff_at" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "status" "GameStatus" NOT NULL,
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "source" "DataSource" NOT NULL,
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_schedule_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "play_by_play" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "play_id" INTEGER NOT NULL,
    "quarter" INTEGER,
    "game_seconds_remaining" INTEGER,
    "posteam_abbr" TEXT,
    "play_data" JSONB NOT NULL,
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT true,
    "source" "DataSource" NOT NULL DEFAULT 'nflverse',
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "play_by_play_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_game_stats" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "team_abbr_at_game" TEXT NOT NULL,
    "passing_yards" DECIMAL(6,1),
    "passing_tds" INTEGER,
    "passing_attempts" INTEGER,
    "completions" INTEGER,
    "interceptions" INTEGER,
    "rushing_yards" DECIMAL(6,1),
    "rushing_tds" INTEGER,
    "carries" INTEGER,
    "receiving_yards" DECIMAL(6,1),
    "receiving_tds" INTEGER,
    "receptions" INTEGER,
    "targets" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT true,
    "source" "DataSource" NOT NULL DEFAULT 'nflverse',
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_game_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_game_stat_corrections" (
    "id" TEXT NOT NULL,
    "player_game_stat_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "prior_values" JSONB NOT NULL,
    "corrected_values" JSONB NOT NULL,
    "correction_known_at" TIMESTAMP(3) NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'nflverse',
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_game_stat_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_game_context" (
    "id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "team_abbr_at_game" TEXT NOT NULL,
    "context_type" "ContextType" NOT NULL,
    "numeric_value" DECIMAL(10,3),
    "text_value" TEXT,
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT true,
    "source" "DataSource" NOT NULL,
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_game_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_weather" (
    "id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "temperature_c" DECIMAL(4,1),
    "wind_kph" DECIMAL(5,1),
    "precipitation_mm" DECIMAL(5,1),
    "era" "WeatherEra" NOT NULL,
    "status" "WeatherStatus" NOT NULL,
    "weather_source" TEXT NOT NULL,
    "valid_at" TIMESTAMP(3) NOT NULL,
    "known_at" TIMESTAMP(3) NOT NULL,
    "known_at_reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "source" "DataSource" NOT NULL DEFAULT 'open_meteo',
    "ingest_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_weather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_runs" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "dataset" TEXT NOT NULL,
    "season_from" INTEGER,
    "season_to" INTEGER,
    "status" "IngestStatus" NOT NULL,
    "rows_written" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "code_version" TEXT NOT NULL,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_coverage" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "dataset" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "coverage" TEXT NOT NULL,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_nflverse_abbr_key" ON "teams"("nflverse_abbr");

-- CreateIndex
CREATE INDEX "players_full_name_idx" ON "players"("full_name");

-- CreateIndex
CREATE INDEX "player_external_ids_player_id_idx" ON "player_external_ids"("player_id");

-- CreateIndex
CREATE INDEX "player_external_ids_status_idx" ON "player_external_ids"("status");

-- CreateIndex
CREATE UNIQUE INDEX "player_external_ids_source_external_id_external_name_key" ON "player_external_ids"("source", "external_id", "external_name");

-- CreateIndex
CREATE INDEX "games_season_week_idx" ON "games"("season", "week");

-- CreateIndex
CREATE INDEX "games_kickoff_at_idx" ON "games"("kickoff_at");

-- CreateIndex
CREATE UNIQUE INDEX "games_season_week_season_type_home_team_id_away_team_id_key" ON "games"("season", "week", "season_type", "home_team_id", "away_team_id");

-- CreateIndex
CREATE INDEX "game_schedule_revisions_game_id_known_at_idx" ON "game_schedule_revisions"("game_id", "known_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "game_schedule_revisions_game_id_known_at_source_key" ON "game_schedule_revisions"("game_id", "known_at", "source");

-- CreateIndex
CREATE INDEX "play_by_play_game_id_idx" ON "play_by_play"("game_id");

-- CreateIndex
CREATE INDEX "play_by_play_known_at_idx" ON "play_by_play"("known_at");

-- CreateIndex
CREATE UNIQUE INDEX "play_by_play_game_id_play_id_key" ON "play_by_play"("game_id", "play_id");

-- CreateIndex
CREATE INDEX "player_game_stats_game_id_idx" ON "player_game_stats"("game_id");

-- CreateIndex
CREATE INDEX "player_game_stats_known_at_idx" ON "player_game_stats"("known_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_game_stats_player_id_game_id_key" ON "player_game_stats"("player_id", "game_id");

-- CreateIndex
CREATE INDEX "player_game_stat_corrections_correction_known_at_idx" ON "player_game_stat_corrections"("correction_known_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_game_stat_corrections_player_game_stat_id_version_key" ON "player_game_stat_corrections"("player_game_stat_id", "version");

-- CreateIndex
CREATE INDEX "player_game_context_game_id_context_type_known_at_idx" ON "player_game_context"("game_id", "context_type", "known_at" DESC);

-- CreateIndex
CREATE INDEX "player_game_context_player_id_game_id_context_type_idx" ON "player_game_context"("player_id", "game_id", "context_type");

-- CreateIndex
CREATE INDEX "player_game_context_known_at_idx" ON "player_game_context"("known_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_game_context_player_id_game_id_context_type_known_at_key" ON "player_game_context"("player_id", "game_id", "context_type", "known_at", "source");

-- CreateIndex
CREATE UNIQUE INDEX "game_weather_game_id_key" ON "game_weather"("game_id");

-- CreateIndex
CREATE INDEX "game_weather_era_idx" ON "game_weather"("era");

-- CreateIndex
CREATE INDEX "ingest_runs_source_dataset_started_at_idx" ON "ingest_runs"("source", "dataset", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ingest_runs_status_idx" ON "ingest_runs"("status");

-- CreateIndex
CREATE INDEX "source_coverage_source_dataset_idx" ON "source_coverage"("source", "dataset");

-- CreateIndex
CREATE UNIQUE INDEX "source_coverage_source_dataset_season_key" ON "source_coverage"("source", "dataset", "season");

-- AddForeignKey
ALTER TABLE "player_external_ids" ADD CONSTRAINT "player_external_ids_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_schedule_revisions" ADD CONSTRAINT "game_schedule_revisions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "play_by_play" ADD CONSTRAINT "play_by_play_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_stat_corrections" ADD CONSTRAINT "player_game_stat_corrections_player_game_stat_id_fkey" FOREIGN KEY ("player_game_stat_id") REFERENCES "player_game_stats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_context" ADD CONSTRAINT "player_game_context_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_context" ADD CONSTRAINT "player_game_context_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_weather" ADD CONSTRAINT "game_weather_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Raw-SQL constructs Prisma does not model (temporal-integrity check
-- constraints, identity-resolution consistency, weather-dome consistency).
-- These are defence in depth BEHIND the as-of query layer, not a substitute
-- for it. There are NO user-scoped tables in this pitch, so NO RLS policies.
-- ---------------------------------------------------------------------------

-- Defence in depth for the temporal invariant: a fact can never become known
-- before it was true of the world. (known_at >= valid_at on every fact table.)
ALTER TABLE "play_by_play"
  ADD CONSTRAINT "pbp_known_after_valid" CHECK ("known_at" >= "valid_at");
ALTER TABLE "player_game_stats"
  ADD CONSTRAINT "pgs_known_after_valid" CHECK ("known_at" >= "valid_at");
ALTER TABLE "player_game_context"
  ADD CONSTRAINT "pgc_known_after_valid" CHECK ("known_at" >= "valid_at");
ALTER TABLE "game_weather"
  ADD CONSTRAINT "weather_known_after_valid" CHECK ("known_at" >= "valid_at");
ALTER TABLE "game_schedule_revisions"
  ADD CONSTRAINT "gsr_known_after_valid" CHECK ("known_at" >= "valid_at");

-- A resolved external id must point at a Player; an unresolved/ambiguous one
-- must not masquerade as resolved.
ALTER TABLE "player_external_ids"
  ADD CONSTRAINT "external_id_resolution_consistent" CHECK (
    ("status" IN ('resolved', 'manual_override') AND "player_id" IS NOT NULL)
    OR ("status" IN ('unresolved', 'ambiguous') AND "player_id" IS NULL)
  );

-- Weather status vs. values: a "dome" game carries no measurements.
ALTER TABLE "game_weather"
  ADD CONSTRAINT "weather_dome_has_no_values" CHECK (
    "status" <> 'dome'
    OR ("temperature_c" IS NULL AND "wind_kph" IS NULL AND "precipitation_mm" IS NULL)
  );
