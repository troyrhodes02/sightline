-- Temporal-integrity review fixes (PR #1 review).
--
-- 1) game_weather: a forecast is by nature known BEFORE the window it
--    describes, so the generic known_at >= valid_at CHECK cannot hold for
--    forecast facts. Previously ingest falsified valid_at (= known_at =
--    kickoff - 24h) to satisfy the constraint; valid_at now genuinely stores
--    the kickoff window, and known_at the conservative availability bound.
--    game_weather is deliberately the ONE fact table without this CHECK.
ALTER TABLE "game_weather" DROP CONSTRAINT "weather_known_after_valid";

-- 2) games: neutral-site flag (London/Munich/São Paulo, Super Bowls). Weather
--    ingest degrades these explicitly to 'unavailable' instead of recording
--    the home team's city as a genuine 'observed' reading.
ALTER TABLE "games" ADD COLUMN "is_neutral_site" BOOLEAN NOT NULL DEFAULT false;

-- 3) player_external_ids: external_id participates in the
--    (source, external_id, external_name) dedup unique key, and Postgres
--    treats NULLs as distinct in unique indexes — a NULL id would silently
--    disable upsert dedup and duplicate on every re-run. Every writer supplies
--    a real id (name-only sources use the name itself as the id).
ALTER TABLE "player_external_ids" ALTER COLUMN "external_id" SET NOT NULL;
