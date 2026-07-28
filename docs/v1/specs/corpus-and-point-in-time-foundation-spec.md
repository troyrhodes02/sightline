---
version: 1.0.0
status: draft
author: Sightline
last_updated: 2026-07-27
pitch_reference: docs/v1/pitches/corpus-and-point-in-time-foundation.md
design_reference: n/a — no user-facing surface (interface-less foundational pitch)
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: [SIGHT-### — Corpus & Point-in-Time Foundation]
---

# Corpus & Point-in-Time Foundation (Historical Data Ingest)

## Summary

Historical Data Ingest builds a queryable historical NFL corpus that can reconstruct exactly what was knowable before any past game, and it hands every downstream consumer a read path that **cannot** see the future by construction. The core technical abstraction is that **the corpus is bitemporal and the as-of cutoff is a boundary, not a filter**: every fact carries `validAt` (when it was true of the world) and `knownAt` (when it became available), and all model-facing reads go through an as-of query layer that takes an explicit `informationCutoff` and makes any row with `knownAt > cutoff` *structurally unreachable* — absent from the result set, not filtered out after the fact. There is no sanctioned function that reads a fact table without threading a cutoff through.

Nothing user-facing ships. This pitch is entirely on the Python side of the two-runtime split (`nflreadpy` + Polars ingest writing to Postgres over the direct connection), plus the Prisma schema that owns those tables. The abstraction that makes it worth its Large appetite is that temporal correctness is established *alongside* the data it governs rather than retrofitted — a leak discovered in month six invalidates every stored projection, calibration bin, and claim ever made, and it cannot be un-leaked.

"Working" means four things, in priority order: (1) a leakage suite proves the eligible inputs for a past game are identical whether queried then or now, and that an adversarially-inserted late fact is unreachable at a prior cutoff; (2) re-running ingest over a processed period produces zero duplicates and zero changes, while a genuine stat correction is captured as an explicit versioned update; (3) player identities resolve across nflverse, ESPN, and Kalshi naming, with unresolved cases retained and surfaced rather than guessed; and (4) every named source's unavailability produces an explicit ingest failure, never a silent gap that reads as complete.

---

## Problem

Sightline's core job is to tell William which Kalshi contracts are mispriced and how much to trust that judgment. That judgment is only worth anything if it can be *evaluated honestly*, and today the system cannot answer the questions honesty requires:

- It cannot tell whether a value used to predict a past game was actually available before that game, because facts carry no record of when they became public.
- It cannot distinguish "this contextual fact was genuinely missing at prediction time" from "we later back-filled it from post-game information."
- It cannot reconstruct the Wednesday-vs-Friday injury picture: a player listed Questionable on Wednesday and ruled Out on Friday is two observations of one fact, and a naive store keeps only the last one.
- It cannot prove a backtest was produced without look-ahead — only assert it. A leaking backtest produces *better* numbers, which is exactly the signal a developer is least inclined to question.
- It cannot map "J. Chase," "Ja'Marr Chase," a Kalshi ticker, and an nflverse GSIS id to one stable identity without fragile name matching at query time.

This is the first technical requirement behind everything else. Historical Data Ingest **blocks the Projection Engine, which blocks everything that displays or grades a projection** (PRD → Dependencies). The Backtesting Harness (Pitch 2) depends specifically on the point-in-time discipline established here; it can run before markets are wired up, but not before the corpus is leakage-safe. Pitch 1 is the first dependency in the roadmap and nothing downstream is meaningful without it.

---

## Scope and Non-Scope

### In Scope

- **Historical Data Ingest** — pull and maintain the full-player-universe historical corpus: play-by-play, final player stat lines, rosters, depth charts, snap counts, participation, injury designations, schedules, weather, and rest/travel context, for the covered history.
- **Bitemporal schema** — `validAt` + `knownAt` (both non-nullable) on every fact table, plus `knownAtReconstructed` where availability was inferred rather than observed.
- **The as-of query layer** — the single sanctioned Python read path for model-facing history. Takes an explicit `informationCutoff`; rows with `knownAt > cutoff` are structurally unreachable.
- **Per-source `knownAt` reconstruction rules** — conservative, documented, and flagged as reconstructed.
- **Cross-source player identity resolution** — nflverse / ESPN / Kalshi naming and identifiers mapped to one stable `Player`, with unresolved/ambiguous cases retained, surfaced, and a manual-override path.
- **Provenance and explicit missingness** — source, ingest run, and coverage recorded; a source failure or coverage gap stays visible instead of being converted into an apparently complete record.
- **Historical weather era policy** — archived forecasts for 2021-forward, reanalysis for earlier seasons, era and source recorded per record so calibration can be reported split.
- **Idempotence and stat corrections** — re-run changes nothing; a genuine correction is an explicit versioned update that preserves earlier published values for point-in-time grading.
- **Schedule-change handling** — postponed/relocated/cancelled games tracked so a changed kickoff does not corrupt what was knowable relative to the original schedule.

### Out of Scope

- **Projection Engine, feature engineering, baselines, model training** — deferred to Pitch 2. This spec stores and retrieves facts; it computes no player distributions, projected values, confidence, or drivers. **No exploratory model "to validate the data."**
- **Backtesting Harness** — deferred to Pitch 2. This spec makes leakage-safe access *possible*; it runs and reports no backtests.
- **Kalshi Market Sync** — deferred to Pitch 4. Player-identity *compatibility* with Kalshi naming is in scope; market discovery, price fetch, order books, settlement ingest, and edge are not. **No `PriceObservation` reads or writes exist in this pitch, and no Python module may import one.**
- **Brand & Responsive Interface, Authentication & Invite** — deferred to Pitch 3. No corpus browser, admin dashboard, identity-resolution screen, or any Next.js route handler ships here.
- **Staleness Disclosure, scheduled in-season recompute** — deferred to Pitch 5. This spec records availability and provenance; it does not operate the live pipeline. (The `IngestRun` records it writes will *later* feed the Health read, but no Health surface ships now.)
- **Outcome Ingest and Scoring** — deferred to Pitch 6. Final stat lines and corrections belong in the corpus; grading projections, recommendations, and decisions does not.
- **Simulation Engine** — deferred to Pitch 7.
- **General NFL data browser** — permanent non-goal. The corpus exists to support projections, backtesting, and grading.

### Named creep temptations (explicitly excluded)

- Do **not** add a background job to denormalise or pre-aggregate season stats. Season-complete aggregates joined to mid-season games are the single most common leak; chronological aggregation must be a cutoff-threaded read, never a stored convenience column.
- Do **not** build any part of Kalshi Market Sync to obtain identities. Establish the mapping *structure* from representative naming samples; defer empirical Kalshi validation to Pitch 4.
- Do **not** introduce a second schema-migration authority. Prisma owns schema; Python reads and writes but never migrates.

---

## Core Concepts

| Concept | Description |
| ------- | ----------- |
| `validAt` | When a fact was true of the world. E.g. an injury designation is valid *of* the Week 12 game; a stat line is valid of the game it summarises. |
| `knownAt` | When a fact became available to a person making a prediction. Non-nullable on every fact table. This is the column the entire temporal invariant depends on. |
| `knownAtReconstructed` | Boolean. `true` when `knownAt` was inferred from a per-source rule rather than directly observed. Makes weaker temporal confidence visible in backtest analysis instead of invisible in an aggregate. |
| `informationCutoff` | The as-of timestamp a *read* is performed against. The as-of query layer guarantees no returned row has `knownAt > informationCutoff`. |
| As-of query layer | The sole sanctioned Python read path for model-facing history. A caller supplies a cutoff; late rows are unreachable, not post-filtered. A feature function that receives a raw DataFrame it did not obtain through this layer is a leak waiting to happen. |
| `Player` | Stable cross-season, cross-team identity (a Sightline UUID). Carries **no current team** — team affiliation is per-game context that follows the game, never the player. |
| `PlayerExternalId` | The explicit mapping from an external source's identifier/name to a `Player`, with a resolution status and manual-override audit. Replaces name-matching at query time. |
| `Game` | Holds the *current* kickoff, venue, dome flag, participants, and schedule metadata. Kickoff is the anchor for every later staleness/recompute boundary. |
| `GameScheduleRevision` | Append-only bitemporal record of schedule changes (kickoff moved, relocated, postponed, cancelled), so an as-of read knows the kickoff that was *known* at cutoff T. |
| `PlayByPlay` | Historical play rows. Fact table; `knownAt` reconstructs to the day after the game. |
| `PlayerGameStat` | Final player box-score actuals — the grading target. Mutable in exactly one way: a stat correction produces a new version. Versioned so "what was published as of T" is answerable. |
| `PlayerGameStatCorrection` | Append-only version history of a `PlayerGameStat`, preserving each prior published value and the `knownAt` of the correction. |
| `PlayerGameContext` | Per-game situational facts as an **append-only observation stream** — one row per (player, game, contextType, observation). This is where most leakage risk lives, and the multi-observation shape is required because injury designations progress over a week. |
| `GameWeather` | Per-game weather as a bitemporal fact, with weather *era* (archived-forecast vs. reanalysis), source, and an explicit status distinguishing dome / request-failed / era-unavailable. |
| `DataSource` | The upstream origin of a fact (nflverse, ESPN, Kalshi naming, Open-Meteo, manual). Recorded for provenance. |
| `IngestRun` | One execution of one ingest for one scope, with status (success / partial / degraded / failed), row counts, code version, and error. Provenance and the raw material for the later Health read. |
| `SourceCoverage` | The explicit-missingness ledger: per source + dataset + season, whether coverage is full, partial, or absent. Distinguishes "known gap" from "we failed to look." |

### Distinctions to preserve

- **`validAt` vs. `knownAt`.** When a fact was true vs. when it was available. Collapsing them is the leak. A stat line is valid of Sunday but known Monday; an injury designation is valid of the Week-12 game but known the Friday before.
- **`knownAt` observed vs. reconstructed.** A reconstructed publication time is a *guess* and must never be treated as equally reliable to an observed one. Hence the flag, and hence: when in doubt, resolve *later*, never earlier, and never to the game date itself.
- **A fact being missing vs. being zero.** Missing participation is not zero participation. Absence is represented as the absence of a row (plus a `SourceCoverage` entry), never as a back-filled or zero value.
- **Weather: dome vs. request-failed vs. era-unavailable.** Three distinct states, not one null. Dome bypasses weather by design; a failed Open-Meteo request is a gap to retry; a pre-archived-forecast season legitimately has no forecast and falls to reanalysis with the leak acknowledged.
- **Re-run idempotence vs. stat correction.** "Re-running changes nothing" and "a correction updates the stored result" are intentionally different cases. The design must distinguish a legitimate upstream correction (new version, new `knownAt`) from nondeterministic ingestion (a bug).
- **History follows the player; context follows the game.** A mid-season trade keeps one stable `Player` identity while team context reflects the team the player was on *in that game*.
- **Corrected actuals are for grading, not features.** A stat correction may update `PlayerGameStat` and cascade to grading (later pitches). It must **never** re-enter feature computation for the game it corrects.

### Ownership

Every entity in this spec is **shared reference/corpus data with no per-user partition.** There are no user-scoped tables here — `Decision` and `Position` (the only user-scoped entities) arrive in later pitches. Consequently there is no RLS story for this pitch's tables and no `userId` on anything. The Python runtime writes all of it with a service-role credential over the direct (non-pooled) connection.

---

## States and Lifecycle

### Enums

```prisma
enum DataSource {
  nflverse
  espn
  kalshi
  open_meteo
  manual
}

enum IngestStatus {
  success   // completed, coverage as expected
  partial   // completed, but a documented coverage gap applies
  degraded  // completed on a fallback (e.g. climatology for weather)
  failed    // did not complete; explicit failure, never a silent gap
}

enum IdentityResolutionStatus {
  resolved         // mapped to exactly one Player
  unresolved       // no confident match; retained and surfaced
  ambiguous        // matches more than one Player; retained and surfaced
  manual_override  // resolved by an explicit human override, not name matching
}

enum WeatherEra {
  archived_forecast // 2021-forward: what could have been known pre-kickoff
  reanalysis        // pre-2021: what the weather actually was (accepted leak, reported)
}

enum WeatherStatus {
  observed      // a real weather record exists for this game
  dome          // indoor venue; weather bypassed by design (not a gap)
  unavailable   // no source covers this game's era (fell back / degraded)
  request_failed // source was expected but the fetch failed; a gap to retry
}

enum ContextType {
  snap_count_offense
  snap_pct_offense
  snap_count_defense
  snap_pct_defense
  snap_pct_st
  participation_status
  practice_status
  injury_designation
  rest_days      // derived-on-read in the as-of layer; see Derived Fields
  travel_km      // derived-on-read in the as-of layer; see Derived Fields
}

enum GameStatus {
  scheduled
  completed
  postponed
  relocated
  cancelled
}
```

> `StatType` (the closed set the UI maps to visual treatments) is introduced by the Projection Engine / Kalshi pitches, not here. `PlayerGameStat` stores the actual box score as explicit typed columns; it does not need a `StatType` enum.

### Identity resolution lifecycle

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| (new external id) | `resolved` | yes, when a confident 1:1 match exists | `PlayerExternalId.playerId` set; row usable by joins |
| (new external id) | `unresolved` | yes, default when no confident match | Retained and surfaced; **never dropped or guessed** |
| (new external id) | `ambiguous` | yes, when >1 candidate | Retained and surfaced with candidate set |
| `unresolved` / `ambiguous` | `manual_override` | yes, human action | `playerId` set; `resolvedBy` + `resolvedAt` recorded; supersedes name matching |
| `resolved` | `manual_override` | yes | A human correction of an automatic match; prior mapping preserved in audit |

**Unresolved is a terminal-until-acted state, not a failure to ingest.** The fact rows that reference an unresolved external id are still retained; they are simply not yet joinable to a canonical `Player`.

### PlayerGameStat correction lifecycle

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| (no stat) | version 1 | yes | `PlayerGameStat` current row written; `knownAt` = day after game (reconstructed) |
| version N | version N+1 | yes, only on a genuine upstream correction | New `PlayerGameStatCorrection` row with prior value + `correctionKnownAt`; current row updated; **re-grading cascade is a later pitch's concern** |
| version N | version N (re-run) | yes | Idempotent no-op — identical inputs produce no new version and no change |

**Terminal / exceptional states:**

- **Cancelled game** (`GameStatus.cancelled`) — no player stats; contextual facts that were known pre-cancellation are retained with their original `knownAt`. Never overwritten to look as though the game never appeared.
- **Postponed / relocated game** — `Game` current fields update *and* a `GameScheduleRevision` row records the change with its own `knownAt`, so an as-of read before the change still sees the original kickoff/venue.
- **Unresolved external identity** — retained indefinitely, surfaced to the operational override path; downstream reads that require a canonical player simply exclude it (and can report it as excluded), never silently coalesce it into a wrong player.

---

## Data Model

> Prisma is the single source of schema truth (Architecture Doc → Tech Stack). Every field maps explicitly to `snake_case` via `@map` because the Python runtime reads these tables by column name. Model names are PascalCase singular; tables are `snake_case` plural via `@@map`. **Every fact table carries `validAt` and `knownAt`, both non-nullable, plus `knownAtReconstructed`.**

### Relationship to existing schema

The repository currently has **no Prisma schema** (fresh Vite/React scaffold). This pitch introduces the first schema. All models below are new.

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `Player` | 1 → many | `PlayerExternalId` | External identifiers/names mapped to one canonical player |
| `Player` | 1 → many | `PlayerGameStat` | A player's per-game actual box scores |
| `Player` | 1 → many | `PlayerGameContext` | A player's per-game situational observations |
| `Team` | 1 → many | `Game` (home/away) | Participants |
| `Game` | 1 → many | `PlayByPlay` | Plays in the game |
| `Game` | 1 → many | `PlayerGameStat` | Player actuals for the game |
| `Game` | 1 → many | `PlayerGameContext` | Situational observations for the game |
| `Game` | 1 → 1 | `GameWeather` | The game's weather record (per game, not per player) |
| `Game` | 1 → many | `GameScheduleRevision` | Bitemporal schedule-change history |
| `PlayerGameStat` | 1 → many | `PlayerGameStatCorrection` | Version history of corrected actuals |
| `IngestRun` | 1 → many | (all fact rows) | Provenance: which run wrote a row (`ingestRunId` FK on fact tables) |
| `DataSource` (enum) | — | (all fact rows) | Provenance: which upstream source a fact came from |

### Reference entities

```prisma
model Team {
  id           String   @id @default(uuid())
  nflverseAbbr String   @unique @map("nflverse_abbr") // e.g. "CIN"
  fullName     String   @map("full_name")
  conference   String?
  division     String?
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  homeGames    Game[]   @relation("HomeTeam")
  awayGames    Game[]   @relation("AwayTeam")

  @@map("teams")
}

model Player {
  id           String   @id @default(uuid())
  fullName     String   @map("full_name")
  position     String?  // roster position; NOT a current-team field
  birthDate    DateTime? @map("birth_date")
  // Deliberately NO current_team_id. Team affiliation is per-game context.
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  externalIds  PlayerExternalId[]
  gameStats    PlayerGameStat[]
  contexts     PlayerGameContext[]

  @@index([fullName])
  @@map("players")
}

model PlayerExternalId {
  id             String                   @id @default(uuid())
  source         DataSource
  externalId     String?                  @map("external_id")   // e.g. GSIS id, ESPN id, Kalshi identifier
  externalName   String                   @map("external_name") // as rendered by the source
  playerId       String?                  @map("player_id")     // null while unresolved/ambiguous
  status         IdentityResolutionStatus @default(unresolved)
  candidateIds   Json?                    @map("candidate_ids") // for ambiguous: the competing Player ids
  resolvedBy     String?                  @map("resolved_by")   // operator identifier for manual overrides
  resolvedAt     DateTime?                @map("resolved_at")
  createdAt      DateTime                 @default(now()) @map("created_at")
  updatedAt      DateTime                 @updatedAt @map("updated_at")

  player         Player?                  @relation(fields: [playerId], references: [id])

  // One canonical mapping per (source, external identity). Re-ingest upserts, never duplicates.
  @@unique([source, externalId, externalName])
  @@index([playerId])
  @@index([status])
  @@map("player_external_ids")
}
```

### Game and schedule

```prisma
model Game {
  id           String     @id @default(uuid())
  season       Int
  week         Int
  seasonType   String     @map("season_type") // REG / POST / PRE
  homeTeamId   String     @map("home_team_id")
  awayTeamId   String     @map("away_team_id")
  venue        String?
  isDome       Boolean    @map("is_dome")
  status       GameStatus @default(scheduled)

  // Current best-known kickoff. Schedule changes are also recorded bitemporally
  // in GameScheduleRevision so as-of reads can see the kickoff known at a cutoff.
  kickoffAt    DateTime   @map("kickoff_at")

  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt @map("updated_at")

  homeTeam     Team       @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeam     Team       @relation("AwayTeam", fields: [awayTeamId], references: [id])
  plays        PlayByPlay[]
  playerStats  PlayerGameStat[]
  contexts     PlayerGameContext[]
  weather      GameWeather?
  revisions    GameScheduleRevision[]

  @@unique([season, week, seasonType, homeTeamId, awayTeamId])
  @@index([season, week])
  @@index([kickoffAt])
  @@map("games")
}

model GameScheduleRevision {
  id                   String     @id @default(uuid())
  gameId               String     @map("game_id")
  kickoffAt            DateTime   @map("kickoff_at")       // kickoff as of this revision
  venue                String?
  status               GameStatus

  validAt              DateTime   @map("valid_at")         // when this schedule state was true
  knownAt              DateTime   @map("known_at")         // when this schedule state was published
  knownAtReconstructed Boolean    @default(false) @map("known_at_reconstructed")

  source               DataSource
  ingestRunId          String     @map("ingest_run_id")
  createdAt            DateTime   @default(now()) @map("created_at")

  game                 Game       @relation(fields: [gameId], references: [id])

  @@unique([gameId, knownAt, source])
  @@index([gameId, knownAt(sort: Desc)])
  @@map("game_schedule_revisions")
}
```

### Fact tables

```prisma
model PlayByPlay {
  id                   String   @id @default(uuid())
  gameId               String   @map("game_id")
  playId               Int      @map("play_id")     // nflverse play id within the game
  quarter              Int?
  gameSecondsRemaining Int?     @map("game_seconds_remaining")
  posteamAbbr          String?  @map("posteam_abbr") // team context at time of play
  playData             Json     @map("play_data")    // compact per-play payload from nflverse

  validAt              DateTime @map("valid_at")     // play time (game clock → wall clock)
  knownAt              DateTime @map("known_at")     // day after the game (reconstructed)
  knownAtReconstructed Boolean  @default(true) @map("known_at_reconstructed")

  source               DataSource @default(nflverse)
  ingestRunId          String   @map("ingest_run_id")
  createdAt            DateTime @default(now()) @map("created_at")

  game                 Game     @relation(fields: [gameId], references: [id])

  @@unique([gameId, playId])
  @@index([gameId])
  @@index([knownAt])
  @@map("play_by_play")
}

model PlayerGameStat {
  id                   String   @id @default(uuid())
  playerId             String   @map("player_id")
  gameId               String   @map("game_id")
  teamAbbrAtGame       String   @map("team_abbr_at_game") // team the player was on THIS game

  // Explicit typed actuals (the grading target). Decimal, never Float.
  passingYards         Decimal? @map("passing_yards")     @db.Decimal(6, 1)
  passingTds           Int?     @map("passing_tds")
  passingAttempts      Int?     @map("passing_attempts")
  completions          Int?
  interceptions        Int?
  rushingYards         Decimal? @map("rushing_yards")     @db.Decimal(6, 1)
  rushingTds           Int?     @map("rushing_tds")
  carries              Int?
  receivingYards       Decimal? @map("receiving_yards")   @db.Decimal(6, 1)
  receivingTds         Int?     @map("receiving_tds")
  receptions           Int?
  targets              Int?

  version              Int      @default(1) // bumped on a correction
  validAt              DateTime @map("valid_at")  // the game (final of the game)
  knownAt              DateTime @map("known_at")  // day after the game, or correction knownAt
  knownAtReconstructed Boolean  @default(true) @map("known_at_reconstructed")

  source               DataSource @default(nflverse)
  ingestRunId          String   @map("ingest_run_id")
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  player               Player   @relation(fields: [playerId], references: [id])
  game                 Game     @relation(fields: [gameId], references: [id])
  corrections          PlayerGameStatCorrection[]

  @@unique([playerId, gameId]) // one current row per player-game; corrections version it
  @@index([gameId])
  @@index([knownAt])
  @@map("player_game_stats")
}

model PlayerGameStatCorrection {
  id                   String   @id @default(uuid())
  playerGameStatId     String   @map("player_game_stat_id")
  version              Int      // the version this correction produced
  priorValues          Json     @map("prior_values")   // full snapshot of the superseded stat line
  correctedValues      Json     @map("corrected_values")
  correctionKnownAt    DateTime @map("correction_known_at") // when the correction became available

  source               DataSource @default(nflverse)
  ingestRunId          String   @map("ingest_run_id")
  createdAt            DateTime @default(now()) @map("created_at")

  playerGameStat       PlayerGameStat @relation(fields: [playerGameStatId], references: [id])

  @@unique([playerGameStatId, version])
  @@index([correctionKnownAt])
  @@map("player_game_stat_corrections")
}

model PlayerGameContext {
  id                   String      @id @default(uuid())
  playerId             String      @map("player_id")
  gameId               String      @map("game_id")
  teamAbbrAtGame       String      @map("team_abbr_at_game")
  contextType          ContextType @map("context_type")

  // One of these carries the value depending on contextType.
  numericValue         Decimal?    @map("numeric_value") @db.Decimal(10, 3)
  textValue            String?     @map("text_value")    // e.g. "Questionable", "Out", "DNP"

  validAt              DateTime    @map("valid_at")  // the game / practice day the fact is true of
  knownAt              DateTime    @map("known_at")  // publication time (often reconstructed)
  knownAtReconstructed Boolean     @default(true) @map("known_at_reconstructed")

  source               DataSource
  ingestRunId          String      @map("ingest_run_id")
  createdAt            DateTime    @default(now()) @map("created_at")

  player               Player      @relation(fields: [playerId], references: [id])
  game                 Game        @relation(fields: [gameId], references: [id])

  // Append-only observation stream: the SAME (player, game, contextType) may have
  // several rows over a week (Questionable Wed → Out Fri). The natural key includes
  // knownAt + source so re-ingesting the same snapshot upserts rather than duplicates.
  @@unique([playerId, gameId, contextType, knownAt, source])
  @@index([gameId, contextType, knownAt(sort: Desc)])
  @@index([playerId, gameId, contextType])
  @@index([knownAt])
  @@map("player_game_context")
}

model GameWeather {
  id                   String        @id @default(uuid())
  gameId               String        @unique @map("game_id")

  temperatureC         Decimal?      @map("temperature_c") @db.Decimal(4, 1)
  windKph              Decimal?      @map("wind_kph")       @db.Decimal(5, 1)
  precipitationMm      Decimal?      @map("precipitation_mm") @db.Decimal(5, 1)

  era                  WeatherEra
  status               WeatherStatus
  weatherSource        String        @map("weather_source") // specific Open-Meteo dataset id

  validAt              DateTime      @map("valid_at")  // kickoff window the weather describes
  knownAt              DateTime      @map("known_at")  // forecast issue time (archived) / reconstructed
  knownAtReconstructed Boolean       @default(false) @map("known_at_reconstructed")

  source               DataSource    @default(open_meteo)
  ingestRunId          String        @map("ingest_run_id")
  createdAt            DateTime      @default(now()) @map("created_at")

  game                 Game          @relation(fields: [gameId], references: [id])

  @@index([era])
  @@map("game_weather")
}
```

> **Design note (resolved divergence from the Architecture Doc's entity list).** The Architecture Doc folds weather into `PlayerGameContext`. Weather is a property of the *game environment*, not of a player, so storing it per-player would duplicate one forecast across every player in the game at the wrong grain. This spec relocates weather to a per-game `GameWeather` fact table while preserving the same bitemporal columns and era policy. This is a normalization decision, not a weakening of any invariant, and is the accepted resolution (see Resolved Decisions #5).

### Provenance and coverage

```prisma
model IngestRun {
  id             String       @id @default(uuid())
  source         DataSource
  dataset        String       // e.g. "player_stats", "injuries", "snap_counts", "pbp", "weather"
  seasonFrom     Int?         @map("season_from")
  seasonTo       Int?         @map("season_to")
  status         IngestStatus
  rowsWritten    Int          @default(0) @map("rows_written")
  rowsUpdated    Int          @default(0) @map("rows_updated")
  codeVersion    String       @map("code_version") // git sha of the ingest code
  errorMessage   String?      @map("error_message") // never contains credentials
  startedAt      DateTime     @map("started_at")
  finishedAt     DateTime?    @map("finished_at")
  createdAt      DateTime     @default(now()) @map("created_at")

  @@index([source, dataset, startedAt(sort: Desc)])
  @@index([status])
  @@map("ingest_runs")
}

model SourceCoverage {
  id             String   @id @default(uuid())
  source         DataSource
  dataset        String
  season         Int
  coverage       String   // "full" | "partial" | "none" — the explicit-missingness ledger
  note           String?  // why partial/none (e.g. "participation gap, weeks 1-4 absent upstream")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([source, dataset, season])
  @@index([source, dataset])
  @@map("source_coverage")
}
```

### Raw SQL constructs

> RLS policies, partial/expression indexes, and check constraints only. This pitch has **no user-scoped tables**, so **no RLS policies apply** (deferred to the pitches that introduce `Decision`/`Position`). The constraints below enforce the temporal invariant at the database layer as defence in depth behind the as-of query layer.

```sql
-- Defence in depth for the temporal invariant: a fact can never become known
-- before it was true of the world. (knownAt >= validAt on every fact table.)
alter table play_by_play
  add constraint pbp_known_after_valid check (known_at >= valid_at);
alter table player_game_stats
  add constraint pgs_known_after_valid check (known_at >= valid_at);
alter table player_game_context
  add constraint pgc_known_after_valid check (known_at >= valid_at);
alter table game_weather
  add constraint weather_known_after_valid check (known_at >= valid_at);
alter table game_schedule_revisions
  add constraint gsr_known_after_valid check (known_at >= valid_at);

-- A resolved external id must point at a Player; an unresolved/ambiguous one must not
-- masquerade as resolved.
alter table player_external_ids
  add constraint external_id_resolution_consistent check (
    (status in ('resolved','manual_override') and player_id is not null)
    or (status in ('unresolved','ambiguous') and player_id is null)
  );

-- Weather status vs. values: a "dome" game carries no measurements; an "observed"
-- record must name a real source dataset.
alter table game_weather
  add constraint weather_dome_has_no_values check (
    status <> 'dome' or (temperature_c is null and wind_kph is null and precipitation_mm is null)
  );
```

### Derived fields

> Sightline's default posture is compute-on-read. Nothing derived is stored without a stated reason.

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| `rest_days` | no | `Game.kickoffAt` (as-of) − prior game's kickoff for the same player/team | Computed in the as-of layer; `knownAt` inherits the *later* of the two schedule facts' `knownAt`. A stored season-relative rest column would be a leak vector. |
| `travel_km` | no | venue of prior game → venue of this game | Same as rest; computed in the as-of layer from schedule facts known at the cutoff. |
| "Season-to-date" / trailing aggregates | no | chronological aggregation of `PlayerGameStat` **through the as-of layer** | **Never a stored column and never a season-complete view.** Season aggregates joined to a mid-season game are the most common accidental leak. Any aggregation is a cutoff-threaded read. |
| "Current team" for a player | no | `PlayerGameStat.teamAbbrAtGame` for the specific game | There is deliberately no current-team field on `Player`; joining current roster to a historical game leaks future trades. |
| Latest injury designation at cutoff T | no | `PlayerGameContext` where `contextType = injury_designation`, `knownAt <= T`, ordered by `knownAt desc`, take 1 | The as-of read returns the *most recently known* designation as of T, honouring the Wed→Fri progression. |

---

## Authorization and Access Control

This pitch ships **no route handlers and serves no user requests.** All access is the Python batch runtime.

- The Python runtime connects with a **service-role credential over the direct (non-pooled) connection** and **bypasses RLS by design** (Architecture Doc → Authorization). Its isolation guarantee is that it never sits in a request path. No route handler exists in this pitch that could reach that credential, and none may be added here.
- There are **no user-scoped tables** in this pitch, so there is no per-user authorization surface. All corpus tables are shared reference data.
- The one access rule that *is* load-bearing here is the **second invariant, enforced structurally**: no Python module in the ingest/feature/as-of path may import or query `PriceObservation` or `RecommendationSnapshot`. Those tables do not exist yet, and this pitch must not create a path toward them. An import-graph assertion over the corpus package is a required test (below), established now so it is in place before any modelling code exists.

| Resource | Read | Create / Update | Delete |
| -------- | ---- | --------------- | ------ |
| All corpus tables | Python service-role only (batch); the **as-of layer** is the only sanctioned model-facing read | Python ingest only (upsert); Prisma owns schema | Facts are system-maintained and superseded (versioned), **never deleted** by ingest |

---

## Operation Surface (Python)

> This replaces the "Route Handlers and API Surface" section. There is **no HTTP surface** in this pitch — the Next.js app and its route handlers are deferred to Pitch 3. The operation surface is the Python ingest entry points and, critically, the **as-of query layer contract** that every downstream consumer will depend on.

### Ingest entry points

Invoked from local development and later from GitHub Actions (scheduling is Pitch 5; the callable ingest is here). Each is idempotent, writes an `IngestRun`, and fails explicitly.

```text
uv run sightline-ingest players     --seasons 1999-2025
uv run sightline-ingest schedule    --seasons 1999-2025
uv run sightline-ingest pbp         --seasons 1999-2025
uv run sightline-ingest stats       --seasons 1999-2025
uv run sightline-ingest context     --seasons 1999-2025   # snaps, participation, injuries
uv run sightline-ingest weather     --seasons 2021-2025   # archived forecasts; earlier → reanalysis
uv run sightline-ingest identities  --source kalshi --from-samples path/to/samples.json
```

Each command:

- **Is idempotent.** Re-running over a processed scope produces no duplicate rows and no changes (upsert on the natural key).
- **Records provenance.** Writes an `IngestRun` with source, dataset, scope, status, row counts, and code version.
- **Fails explicitly.** A named source that is unavailable or has changed incompatibly writes `IngestStatus.failed` with a message and raises — it never writes a partial dataset that reads as complete. A *technically successful request returning structurally incomplete data* (schema drift) is treated as failure, not success.
- **Reconstructs `knownAt` conservatively** per the documented per-source rules (below) and sets `knownAtReconstructed = true` accordingly.

### Per-source `knownAt` reconstruction rules (documented policy)

| Source / dataset | `validAt` | `knownAt` (reconstructed) | Reconstructed? |
| ---------------- | --------- | ------------------------- | -------------- |
| Play-by-play | play wall-clock time | **day after the game**, 00:00 local | yes |
| Player stats (final) | game final | **day after the game**, 00:00 local | yes |
| Snap counts | game | **day after the game** | yes |
| Participation (practice) | practice day | **the scheduled practice-report publication window** for that day, resolved *later* if uncertain | yes |
| Injury designation | the game week | **scheduled injury-report publication window** (Wed/Thu/Fri final report), never the game date | yes |
| Schedule / kickoff | when the schedule state was true | publication time of the schedule release/revision | yes (bulk) |
| Weather (archived forecast, 2021+) | kickoff window | **forecast issue time** from the archived-forecast dataset | no (observed) |
| Weather (reanalysis, pre-2021) | kickoff window | conservatively set; era flagged `reanalysis`; **leak accepted and reported** | yes |
| Stat correction | original game | the correction's own availability (`correctionKnownAt`) | source-dependent |

**Rule of the pitch:** when in doubt, resolve **later**, not earlier, and **never to the game date itself.** Never rely on a source's file ordering or layout as a proxy for availability.

### The as-of query layer contract

The single sanctioned model-facing read path. Illustrative signatures (Polars-returning):

```python
from datetime import datetime
import polars as pl

class AsOfCorpus:
    """The only sanctioned model-facing read path over the corpus.

    Every method takes an explicit information cutoff. Rows with known_at > cutoff
    are structurally unreachable — excluded in the query itself, never returned and
    filtered afterward. There is deliberately no method that reads a fact table
    without a cutoff.
    """

    def __init__(self, cutoff: datetime) -> None:
        self._cutoff = cutoff  # bound once; every read is constrained by it

    def player_game_stats(self, *, player_id: str, through_game_id: str) -> pl.DataFrame: ...
    def player_context(self, *, player_id: str, game_id: str, context_type: str) -> pl.DataFrame:
        """Returns observations with known_at <= cutoff, latest-per-type resolvable by the caller."""
    def latest_injury_designation(self, *, player_id: str, game_id: str) -> str | None:
        """The most recently KNOWN designation as of the cutoff (honours Wed→Fri progression)."""
    def game_weather(self, *, game_id: str) -> pl.DataFrame: ...
    def schedule_as_known(self, *, game_id: str) -> pl.DataFrame:
        """The kickoff/venue/status that was known as of the cutoff."""
    def rest_and_travel(self, *, player_id: str, game_id: str) -> dict:
        """Derived on read from schedule facts known at the cutoff."""
```

Design guarantees the layer must uphold:

- **No cutoff-free read.** There is no public method, and no reachable private helper, that returns fact rows without applying the bound cutoff. A feature function that accepts a raw DataFrame it did not obtain here is a review-blocking finding.
- **Corrected actuals are walled off from features.** A separate grading-oriented read (used only by later grading pitches) may return corrected values; it is not part of `AsOfCorpus` and must never be reachable from feature computation for the game it corrects.
- **Reconstructed rows are distinguishable.** The layer surfaces `knownAtReconstructed` so downstream analysis can report temporal confidence rather than blend it away.

### Error / failure format (ingest)

| Condition | Behaviour |
| --------- | --------- |
| Source unreachable | `IngestRun.status = failed`, explicit raise, no partial data committed |
| Schema drift (structurally incomplete despite HTTP 200) | Treated as `failed`; never committed as `success` |
| Documented coverage gap (e.g. participation weeks missing upstream) | `IngestRun.status = partial`, `SourceCoverage` row written; absence preserved, never zero-filled |
| Weather era unavailable (pre-2021) | `status = degraded` where climatology fallback used; `WeatherEra.reanalysis`; leak recorded |
| Credentials / secrets | Never written to `errorMessage`, logs, or any row |

---

## Validation Rules

Server/ingest-side validation. **Warn** where the PRD treats an unusual state as legitimate; **block** where an invariant or money is involved (no money here — the invariant is temporal integrity).

| Field / condition | Validation | Warn or Block | Error / outcome |
| ----------------- | ---------- | ------------- | --------------- |
| `knownAt` on any fact | must be present, non-null, and `>= validAt` | **Block** | reject the row; ingest fails loudly |
| `knownAt` set to the game date for a reconstructed source | forbidden — must resolve to the documented publication window (later) | **Block** | reject; this is the classic generous-reconstruction leak |
| `knownAtReconstructed` | must be `true` whenever the value came from a reconstruction rule | **Block** | reject if a reconstructed value is flagged observed |
| Missing participation for a game | must remain absent + `SourceCoverage` note | **Warn** (partial) | never zero-fill, never back-fill from post-game data |
| Weather for a dome game | `status = dome`, no measurements | **Block** on values present | reject dome row carrying measurements |
| Duplicate ingest of an identical snapshot | natural-key upsert | **Warn/no-op** | idempotent; no new row, no change |
| Genuine stat correction | new version + `PlayerGameStatCorrection` | allowed | must preserve prior published value + `correctionKnownAt` |
| External identity with no confident match | retain as `unresolved`/`ambiguous` | **Warn** | **never drop, never guess** |
| Resolved external id without a `playerId` | schema check constraint | **Block** | reject |
| Any modelling/feature import of `PriceObservation`/`RecommendationSnapshot` | forbidden | **Block** (CI import-graph test) | build fails |

- Do not leak Prisma error text, connection strings, or any credential in an `errorMessage`.
- Invalid enum values are rejected at the schema layer.

---

## Testing Strategy

> Priority order is fixed by `CLAUDE.md` → Testing. Temporal leakage is adversarial and first. Frameworks: **pytest** (Python ingest + as-of layer), plus schema-introspection assertions. There is no TypeScript surface in this pitch, so Jest/Playwright are not exercised here.

### 1. Temporal leakage (adversarial — first, and gating)

```text
TEST: asof_late_fact_is_structurally_unreachable
GIVEN: A PlayerGameContext injury_designation row with known_at = Friday 18:00
WHEN: AsOfCorpus(cutoff = Friday 09:00).latest_injury_designation(player, game)
THEN:
  - The Friday-18:00 row is absent from the query result (not returned then filtered)
  - The Wednesday designation known before 09:00 is what's returned
  - No code path exposes the raw table to the feature function

TEST: asof_recompute_is_time_invariant
GIVEN: A completed past game and its corpus as it stood at cutoff T
WHEN: The eligible-input set is queried at cutoff T today, and again later
THEN:
  - The two result sets are identical, subject only to explicitly represented
    corrections with recorded availability

TEST: asof_season_aggregate_cannot_include_future_games
GIVEN: A player with games in weeks 1..17
WHEN: A trailing aggregate is requested through AsOfCorpus at a week-8 cutoff
THEN:
  - Only games with known_at <= the week-8 cutoff contribute
  - No season-complete view or stored aggregate is reachable

TEST: asof_current_team_never_joins_to_history
GIVEN: A player traded mid-season (team A weeks 1-8, team B weeks 9+)
WHEN: A week-5 read resolves the player's team context
THEN:
  - Team A is used (team_abbr_at_game), never team B
  - There is no current-team field on Player to leak from
```

### 2. Prices never feed projections (structural)

```text
TEST: corpus_package_has_no_price_import_path
GIVEN: The Python corpus/ingest/as-of package
WHEN: An import-graph assertion runs over the package
THEN:
  - No module imports or references PriceObservation or RecommendationSnapshot
  - Established now, before any modelling code exists, so the guard predates the risk
```

### 3. Grading, idempotence, and corrections

```text
TEST: reingest_is_idempotent
GIVEN: A season already ingested (stats, context, pbp, weather)
WHEN: The same ingest is re-run over the same scope
THEN:
  - Zero duplicate rows (natural-key upsert)
  - Zero field changes
  - A new IngestRun is recorded (provenance), but no data mutation

TEST: stat_correction_versions_not_duplicates
GIVEN: A PlayerGameStat version 1 with receiving_yards = 84
WHEN: An upstream correction to 88 arrives three days post-game
THEN:
  - Current row updated to 88, version = 2
  - A PlayerGameStatCorrection row preserves prior 84 + correction_known_at
  - "As published on game day" remains answerable as 84
  - Re-running the same correction is an idempotent no-op

TEST: correction_does_not_reenter_features
GIVEN: A corrected actual with correction_known_at after kickoff
WHEN: AsOfCorpus is queried at a pre-kickoff cutoff for feature inputs
THEN:
  - The corrected value is unreachable via the feature path
  - Only the grading-oriented read (later pitches) can see it
```

### 4. Contract-to-player / identity resolution

```text
TEST: ambiguous_name_is_retained_not_guessed
GIVEN: Two active players sharing a rendered name, and an external id matching both
WHEN: Identity resolution runs
THEN:
  - The external id is status = ambiguous with both candidate ids retained
  - player_id is null; nothing is silently coalesced
  - The case is surfaced for manual override

TEST: manual_override_supersedes_name_matching
GIVEN: An unresolved external id
WHEN: A manual override maps it to a Player
THEN:
  - status = manual_override, player_id set, resolved_by/resolved_at recorded
  - Later automatic passes do not overwrite the override

TEST: suffix_and_punctuation_variants_resolve_to_one_player
GIVEN: "Ja'Marr Chase", "JaMarr Chase", "J. Chase" across nflverse/ESPN/Kalshi
WHEN: Resolution runs
THEN:
  - All map to a single canonical Player, or unresolved — never to different players
```

### 5. Ingest robustness / edge cases (adversarial)

```text
TEST: source_outage_is_explicit_failure
GIVEN: nflverse unreachable mid-ingest
WHEN: The ingest runs
THEN:
  - IngestRun.status = failed with a message (no credentials)
  - No partial dataset is committed that would read as complete

TEST: schema_drift_is_failure_not_success
GIVEN: An upstream file that renamed a required column
WHEN: The ingest parses it
THEN:
  - Treated as failed (structurally incomplete), not a successful partial load

TEST: participation_gap_preserved_as_missing
GIVEN: A season with a known upstream participation hole
WHEN: Context ingest runs
THEN:
  - The gap is absent rows + a SourceCoverage 'partial' note
  - No zero-filled or back-filled participation values exist

TEST: weather_three_states_distinct
GIVEN: A dome game, a failed forecast fetch, and a pre-2021 game
WHEN: Weather ingest runs
THEN:
  - dome → status=dome, no measurements
  - failed fetch → status=request_failed (retryable), not null-collapsed
  - pre-2021 → era=reanalysis, leak recorded, reported separately

TEST: postponed_game_preserves_original_schedule_knowledge
GIVEN: A game whose kickoff moves two days later
WHEN: The schedule revision is ingested
THEN:
  - A GameScheduleRevision records the new kickoff with its own known_at
  - An as-of read before the change still sees the original kickoff
```

### Invariant tests

```text
TEST: known_at_present_on_every_fact_table
GIVEN: Any migration state
THEN: Every fact table has non-nullable valid_at and known_at (+ known_at_reconstructed)
QUERY: Introspect schema for fact tables lacking either column
EXPECT: Empty result

TEST: known_at_never_precedes_valid_at
GIVEN: Any fact row
THEN: known_at >= valid_at (enforced by check constraint)
QUERY: Scan each fact table for known_at < valid_at
EXPECT: Empty result

TEST: no_reconstructed_known_at_equals_game_date
GIVEN: Any reconstructed fact
THEN: known_at resolves to the documented publication window, never the game date
QUERY: Reconstructed rows where known_at::date = game date
EXPECT: Empty result
```

### Integration scenario

```text
TEST: corpus_supports_point_in_time_reconstruction_end_to_end
SCENARIO: The foundation's whole reason to exist

STEP 1: Ingest players, schedule, pbp, stats, context, weather for a past season
VERIFY:
  - Every fact carries valid_at, known_at, known_at_reconstructed
  - Reconstructed known_at is flagged; observed (archived-forecast weather) is not
  - IngestRun + SourceCoverage recorded per source/dataset/season

STEP 2: Resolve identities across nflverse/ESPN/Kalshi samples
VERIFY:
  - Confident matches resolved; collisions retained as ambiguous; overrides applied

STEP 3: Query AsOfCorpus at a pre-kickoff cutoff for a mid-season game
VERIFY:
  - Only facts known before the cutoff are returned
  - Latest-known injury designation honours the week's progression
  - rest/travel derived from schedule-as-known; no current-team leakage

STEP 4: Apply a post-settlement stat correction
VERIFY:
  - Versioned, prior value preserved, correction_known_at recorded
  - Feature path at the pre-kickoff cutoff still cannot see the correction

STEP 5: Re-run every ingest over the same scope
VERIFY:
  - No duplicates, no changes; new IngestRun rows only
```

### Test data factories

```python
def create_test_player_game_context(**overrides) -> dict:
    base = {
        "player_id": str(uuid4()),
        "game_id": str(uuid4()),
        "team_abbr_at_game": "CIN",
        "context_type": "injury_designation",
        "numeric_value": None,
        "text_value": "Questionable",
        "valid_at": datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc),  # the game week
        "known_at": datetime(2026, 11, 20, 21, 0, tzinfo=timezone.utc),  # Friday report window
        "known_at_reconstructed": True,
        "source": "nflverse",
    }
    return {**base, **overrides}
```

```python
def create_test_game_weather(**overrides) -> dict:
    base = {
        "game_id": str(uuid4()),
        "temperature_c": Decimal("7.0"),
        "wind_kph": Decimal("18.0"),
        "precipitation_mm": Decimal("0.0"),
        "era": "archived_forecast",         # 2021-forward
        "status": "observed",
        "weather_source": "openmeteo_archive_forecast_v1",
        "valid_at": datetime(2026, 11, 22, 18, 0, tzinfo=timezone.utc),
        "known_at": datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc),  # forecast issue time
        "known_at_reconstructed": False,     # observed forecast, not reconstructed
        "source": "open_meteo",
    }
    return {**base, **overrides}
```

> **Never default `knownAt` to `now()` in a factory** — a factory that does makes leakage tests pass while the production path leaks.

---

## Acceptance Criteria

1. **Corpus completeness (per PRD → Historical Data Ingest)**
   - [ ] Every completed game in the covered history has play-by-play, participation, and final player stat lines retrievable at the player-game level.
   - [ ] Rosters, depth charts, snap counts, schedules, injury designations, weather, and rest/travel are retrievable for the periods their named sources cover.
   - [ ] Coverage gaps are represented as explicit missingness (`SourceCoverage` + absent rows), never as zero or back-fill.

2. **Bitemporal integrity**
   - [ ] Every fact carries `validAt`, `knownAt` (non-null), and `knownAtReconstructed`.
   - [ ] Reconstructed availability times are flagged; observed ones are not.
   - [ ] `knownAt >= validAt` holds on every fact (check constraint).
   - [ ] No reconstructed `knownAt` resolves to the game date.

3. **As-of query layer**
   - [ ] Reads accept an explicit `informationCutoff` and cannot return a row with `knownAt > cutoff`.
   - [ ] Late rows are structurally unreachable (absent), not post-filtered.
   - [ ] The restriction is structural — downstream code needs no ad hoc date filters.
   - [ ] There is no sanctioned cutoff-free read of a fact table.

4. **Leakage suite**
   - [ ] Eligible inputs for a past game are identical whether queried then or now (corrections excepted, with recorded availability).
   - [ ] An adversarially late-inserted fact is unreachable at a prior cutoff.
   - [ ] Season aggregates cannot include future games; current team cannot join to history.

5. **Weather era policy**
   - [ ] Archived forecasts for 2021-forward, reanalysis earlier; era + source recorded per record.
   - [ ] The two eras are distinguishable so calibration can be reported split, never blended.
   - [ ] Dome / request-failed / era-unavailable are three distinct states.

6. **Idempotence and corrections**
   - [ ] Re-running ingest over a processed period yields no duplicates and no changes.
   - [ ] A genuine correction is a versioned update preserving earlier published values and `correctionKnownAt`.
   - [ ] Corrected actuals cannot re-enter feature computation for the game they correct.

7. **Provenance and failure**
   - [ ] Every fact records its source and `IngestRun`.
   - [ ] A named source going unavailable or drifting produces an explicit ingest failure, never a silent complete-looking gap.

8. **Identity resolution**
   - [ ] Identities resolve across nflverse, ESPN, and Kalshi naming/identifiers.
   - [ ] Ambiguous/unresolved identities are retained and surfaced, never dropped or guessed.
   - [ ] A manual-override path exists and supersedes automatic matching.
   - [ ] A mid-season team change keeps one stable `Player` while team context stays tied to the game.

9. **Consumability**
   - [ ] The corpus is queryable by later modelling/backtesting without joining current roster state or other present-day reference data.

10. **Second invariant (structural, established early)**
   - [ ] No corpus/ingest/as-of module imports `PriceObservation` or `RecommendationSnapshot`; an import-graph test enforces it.

---

## Explicit Non-Goals

**Permanent (from the Product Brief):**

- ❌ Sportsbook / DFS integration; Kalshi is the venue.
- ❌ Public or commercial access; general NFL data browser.
- ❌ Film/tape-derived inputs — structured data only.
- ❌ Live in-game data or trading.

**Deferred (do not build, do not preclude):**

- ❌ Projection Engine, feature engineering, baselines, model training (Pitch 2).
- ❌ Backtesting Harness execution/reporting (Pitch 2).
- ❌ Kalshi Market Sync — market discovery, prices, order books, settlement, edge (Pitch 4). Identity *compatibility* only, here.
- ❌ Any Next.js surface, auth, or admin UI (Pitch 3).
- ❌ Live in-season scheduled pipeline and staleness (Pitch 5).
- ❌ Outcome grading of projections/recommendations/decisions (Pitch 6).
- ❌ Simulation Engine (Pitch 7).
- ❌ NBA/WNBA ingest or multi-sport warehousing — entity model stays sport-agnostic but this pitch delivers NFL only.
- ❌ Message queues, streaming, specialised time-series stores, distributed processing.

---

## Resolved Decisions

The pitch's open questions are resolved here as follows. These are the design's committed positions; they are recorded rather than left open, and any reversal is a design-review change rather than an implementation choice.

1. **Per-source completeness — RESOLVED.** Completeness is defined **per source and per season**, not as a single all-fields-present standard. Each dataset declares its covered seasons in `SourceCoverage`; absence outside a declared window is expected and represented as explicit missingness (a `partial`/`none` coverage row plus absent fact rows), never as a failure or a zero-fill. An ingest is judged complete relative to its declared coverage, not to an imagined universe.
2. **Start of covered history — RESOLVED.** The corpus is **one broad game corpus from 1999 forward with source-specific availability windows**, not a single common start season gated to the latest-starting source. Play-by-play and stats run 1999+; archived-forecast weather runs 2021+ (reanalysis before); participation/injury coverage begins where its source begins. Every window is recorded in `SourceCoverage` so backtest configuration reads coverage from data rather than from lore.
3. **Kalshi naming material before Pitch 4 — RESOLVED.** The identity-mapping **structure** is built now and validated against a **static Kalshi naming sample file** (`sightline-ingest identities --source kalshi --from-samples ...`). No market discovery, price, or settlement code is written. Empirical validation against live Kalshi naming is explicitly deferred to Pitch 4, which reuses this mapping and its manual-override path.
4. **Stat-correction representation — RESOLVED.** Corrections use the **versioned-current-row plus append-only correction-log** model (`PlayerGameStat.version` + `PlayerGameStatCorrection`). The current row always holds the best-known actual for grading; the log preserves each superseded value with its `correctionKnownAt`, so "as published at cutoff T" is answerable. This satisfies both eventual correctness and point-in-time honesty without maintaining separate validity-interval rows on the hot table.
5. **Weather grain — RESOLVED.** Weather is stored **per game in `GameWeather`**, not per player inside `PlayerGameContext`, because weather is a game-environment property and per-player storage is the wrong grain. The bitemporal columns and era policy are preserved unchanged. Recorded as an accepted normalization of the Architecture Doc's entity list, not a weakening of any invariant.

### Inherited, deliberately not resolved here

- **Grading truth — Kalshi settlement vs. the official stat line.** This belongs to Outcome Ingest & Scoring (Pitch 6), where grading exists. This pitch stores the official stat line (and its corrections) and takes no position on settlement, which is not ingested until Pitch 4. Noted so nothing silently assumes one answer while both are stored later.

---

## Future Considerations

- **Projection Engine (Pitch 2)** consumes `AsOfCorpus` directly; because the cutoff boundary is structural, the engine inherits leakage-safety without adding its own date filters.
- **Backtesting Harness (Pitch 2)** relies on `asof_recompute_is_time_invariant` and the era-split weather flags to report calibration honestly, including split across the archived-forecast and reanalysis eras.
- **Kalshi Market Sync (Pitch 4)** resolves live contracts against `PlayerExternalId`, reusing the manual-override path built here for the contract-to-player resolution risk.
- **Live pipeline & Staleness (Pitch 5)** reads the `IngestRun` last-success timestamps this pitch already writes, turning them into the Health surface and staleness disclosure.
- **Outcome Ingest & Scoring (Pitch 6)** uses the grading-oriented corrected-actuals read (walled off from features here) and the `PlayerGameStatCorrection` log to re-grade idempotently after late corrections.
