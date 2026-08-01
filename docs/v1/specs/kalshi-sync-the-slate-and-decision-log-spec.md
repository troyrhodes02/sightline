---
version: 1.0.0
status: approved
author: Claude (autonomous pipeline run), for William Rhodes
last_updated: 2026-08-01
pitch_reference: docs/v1/pitches/kalshi-sync-the-slate-and-decision-log.md
design_reference: docs/v1/design-docs/kalshi-sync-the-slate-and-decision-log-design-doc.md
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: (milestone and issues created by the pipeline run; see docs/v1/runs/kalshi-sync-the-slate-and-decision-log-progress.md)
---

# Kalshi Sync, The Slate & Decision Log — Technical Spec

## Summary

This pitch joins two independently-clocked systems at read time and starts accumulating the data that can never be rebuilt. The core abstraction is **edge is a view, not a record**: projections are precomputed by the Python runtime and stored with their provenance; Kalshi prices are observed by the TypeScript runtime on view and on an interval; and the disagreement between them — edge, confidence-adjusted edge, recommendation state — is computed when someone looks, never stored as current state. What persists is history: `PriceObservation` (both sides, timestamped), `RecommendationSnapshot` (what Sightline recommended, frozen at meaningful transitions), and `Decision` (what the admin did, append-only, with a server-read snapshot per row).

Three PRD features ship as one vertical slice: **Kalshi Market Sync** (discovery and live pricing only — settlement is Pitch 6), **Edge Calculation and Recommendation**, and **Decision Log**. The slate and contract detail surfaces present them; the take/fade/skip control captures the admin's response.

Working means: opening the slate is a database read that never waits on a model run; every displayed number carries its own timestamp; a Kalshi outage degrades the slate instead of breaking it; unresolved contracts are retained and visible; viewers can never see or infer a decision; and refreshing prices never alters any previously captured snapshot.

## Problem

- The app cannot yet answer the product's core question — is this price wrong? — because it has no market side: no contract discovery, no price observations, no resolution from Kalshi's naming to Sightline players.
- The app cannot yet distinguish a contract with no edge from a contract Sightline failed to price, because neither concept exists in the schema.
- The Pitch 2 baseline computes projections but persists them only into local Parquet backtest artefacts. Nothing writes a projection row the application can read.
- Nothing records what Sightline recommended at any moment, so Pitch 6 would have nothing to grade.
- Nothing records the admin's decisions, so the override-value question (PRD → Journey: Pre-Kickoff Slate Review, steps 7–9) is unanswerable, and every week that passes without capture is data lost permanently.

## Resolved Decisions

Recorded per the Autonomous Pipeline Policy. Each resolves an open question from the pitch (Q1–Q10) or an implementation question the approved docs leave open, with authority order: planning docs → CLAUDE.md/skills → codebase patterns → judgment.

| # | Decision | Rationale |
| - | -------- | --------- |
| RD-1 (Q1) | **The executable ask of the better side drives edge, ranking, and recommendation.** For each contract, edge is computed for both sides (`yes`: `modelProbability×100 − yesAskCents`; `no`: `(1−modelProbability)×100 − noAskCents`); the displayed/ranked edge is the greater, with its side recorded. Midpoint is displayed on detail as labelled context only. | Buying costs the ask; a midpoint edge that vanishes at the ask is not tradeable. Consistent with Pitch 7's later "executable price net of fees". Both sides are stored, so the rule is revisable without re-ingest. |
| RD-2 (Q2) | **One flat ranked list, one row shape, no pagination on the slate.** The full upcoming set returns in one response. | Slate depth is unverified (6–60); a slate-sized pull is small either way, and the design doc's row works at both densities. |
| RD-3 (Q3) | **Baseline drivers ship.** `sightline_model/projection.py` already emits deterministic ordered driver sentences; the persistence path stores them in `ProjectionDriver` and the detail view renders them verbatim. | Verified in code; no Pitch 2 correction ticket needed, no unavailable-state fallback needed. |
| RD-4 (Q4) | **RecommendationSnapshot triggers:** (a) a contract first becomes recommended; (b) its recommendation state changes — recommended↔not, or the better side flips; (c) a decision is recorded (snapshot linked to the decision). Routine refreshes that change no state persist nothing. Final pre-kickoff capture is Pitch 6. | Transitions are what grading needs; per-refresh snapshots are the "snapshot explosion" rabbit hole named in the pitch. |
| RD-5 (Q5) | **Decisions are append-only.** Each take/fade/skip creates a new `Decision` row with its own server-read snapshot; the current disposition is the latest row; the acted-on state for later grading is the latest row before kickoff. A prior row's snapshot is never modified. There is no un-mark: unmarked means "never decided". | Satisfies both the pitch ("a change captures decision-time state") and the API conventions ("never re-take the original snapshot") — the original row is immutable, the change is a new row. |
| RD-6 (Q6) | **Scheduled kickoff is the actionability boundary.** The upcoming slate is games with `status = scheduled` and `kickoffAt > now` (per `Game.kickoffAt`, the current best-known kickoff). Decision writes at/after kickoff are rejected server-side with `invalid_state_transition`. Kalshi's market close can remove a price earlier; it never extends actionability later. | Pitch Definition of Done requires the server-enforced boundary; postponed games (status ≠ scheduled) drop out without a calendar-day filter. Note: this deliberately **blocks** post-kickoff decisions, diverging from the api-conventions reference's "warn" list — the pitch outranks the reference. |
| RD-7 (Q7) | **Unresolved contracts are visible to both roles; diagnostics and the resolve control are admin-only.** Viewers get title, ticker, price; admins additionally get the failure reason and a single-mapping correction control. | Pitch requires surfacing; the access model separates transparency from integration diagnostics. |
| RD-8 (Q8) | **Refresh completeness is a recorded fact.** Every sync writes a `MarketSyncRun` with status `complete | partial | failed | empty` and counts. The slate banner and (later, Pitch 5) health read derive from the latest run. | "Silent partial failure" is a named rabbit hole; a partial render must be distinguishable from a complete one. |
| RD-9 (Q9) | **Mapping corrections apply to future reads only.** Resolving a contract writes a `manual_override` row through the existing `PlayerExternalId` mechanism (source `kalshi`) and re-resolves the contract; previously recorded observations, snapshots, and decisions are untouched. | Reuses the Pitch 1 identity mechanism; history reflects what was observed when it was observed. |
| RD-10 (Q10) | **No accuracy cues on detail in this pitch.** The provenance block is the reserved future home of calibration context (Pitch 6). | Keeps the surface honest until graded data exists; avoids pulling the accuracy surface forward. |
| RD-11 | **Recommendation threshold and confidence weights are server environment configuration**, read at request time: `RECOMMENDATION_THRESHOLD_POINTS` (default `5`), confidence weights fixed in code as `high 1.0 / medium 0.7 / low 0.4` with the constant exported from one module. `confidenceAdjustedEdge = edgePoints × weight(confidence)`. | "Configuration, not a constant" (pitch DoD). Env var over a settings table: no settings UI is in scope, and config-by-env matches the existing runbook pattern. |
| RD-12 | **Slate polling is a bare `setInterval` in one client island**, calling `POST /api/prices/refresh` then `router.refresh()`; interval `SLATE_REFRESH_INTERVAL_SECONDS` (default 60), paused when the tab is hidden. No data-fetching library is added. | CLAUDE.md leaves the polling mechanism open and instructs recording the choice; a dependency for one poll loop violates the no-new-infrastructure posture. |
| RD-13 | **Refreshes are coalesced server-side.** If a sync completed within `KALSHI_SYNC_MIN_INTERVAL_SECONDS` (default 30), the refresh route returns that run's outcome without calling Kalshi. | Centralised rate-limit discipline (pitch: "refresh storms"); several open tabs cannot multiply Kalshi traffic. |
| RD-14 | **Price observations are written on change, with a heartbeat.** A new `PriceObservation` is inserted when the book differs from the contract's latest observation, or when `PRICE_HEARTBEAT_MINUTES` (default 15) has elapsed since the last one. | Captures every change with bounded growth; a slate left open all Sunday does not write thousands of identical rows. |
| RD-15 | **Python projects contract-listed players only**, reading `contracts` (identity columns only — never `price_observations`, never `recommendation_snapshots`) to find distinct (player, game, stat type) triples for upcoming games. A new `sightline-model project` CLI computes projections through the as-of layer with an explicit cutoff and upserts `Projection` + `ProjectionDriver` idempotently. | Architecture: "Scoping production inference to Kalshi-listed players is a product decision." Contract identity is scoping, not a model input; price columns remain structurally unreachable and the import-graph test is extended to prove it. |
| RD-16 | **RLS is not enabled in this pitch.** Server-side role checks are the sole enforcement, per CLAUDE.md ("server-side role checks are [the primary mechanism]"). | Prisma connects with a privileged role that RLS would not bind, making it inert ceremony here; the upstream open question stays open rather than being silently resolved the other way. |
| RD-17 | **Contract identity is the Kalshi market ticker.** `kalshiTicker` is unique; a relisting at a new threshold is a new ticker and therefore a new contract row. Disappeared markets are marked `delisted`, never deleted. | Pitch rabbit hole: history must stay attached to the original contract identity. |
| RD-18 | **The Kalshi client supports optional request signing but this pitch never places an order.** `KALSHI_API_BASE_URL`, and optionally `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PEM`, live server-side; market-data reads use them only if configured. No order, portfolio, or balance endpoint is called or wrapped. | Read access is in scope (run instruction); order paths are Pitch 11 and a stop-condition boundary. |

## Scope and non-scope

**In scope**

- Kalshi NFL player-prop market discovery, parsing, and contract upsert with explicit resolution status.
- Contract-to-player/game/stat/threshold resolution through `PlayerExternalId`, with admin manual correction.
- Price observation capture (both sides, integer cents, observed-at), sync-run accounting, coalesced refresh route.
- Projection persistence from the Pitch 2 baseline: schema tables plus a manual Python CLI writing through the as-of layer.
- Read-time edge, confidence-adjusted edge, ranking, and recommendation state; `RecommendationSnapshot` persistence at the RD-4 triggers.
- The slate page, contract detail (resolved, no-projection, no-price, unresolved variants), and all designed empty/degraded states from the design doc.
- Append-only decision capture with server-read snapshots; admin-only visibility end to end.

**Out of scope** (deferred; do not preclude)

- Scheduled jobs of any kind — projection recompute, price cron, keepalive (Pitch 5). This pitch's refresh is view-triggered plus the in-page interval only.
- Staleness computation, `isStale`, inactives boundaries (Pitch 5). The slate DTO carries timestamps, not staleness verdicts.
- Settlement ingest, outcomes, grading, accuracy surfaces, decision-log listing page, timing cost, final pre-kickoff snapshots (Pitch 6).
- Recalibration, bankroll, sizing, paper trading (Pitch 7+); order placement and any Kalshi write (Pitch 11).
- Adjustment suggestions (Pitch 10).
- A settings UI for the recommendation threshold; a mapping-management page beyond the single in-place correction.

**Standing temptations, refused:** no background job denormalising edge or staleness; no `isStale`/`edge` column; no WebSocket; no generic exchange abstraction.

## Core concepts

| Concept | Description |
| ------- | ----------- |
| `Contract` | One Kalshi market: `kalshiTicker` unique, verbatim `title`, parsed `kalshiPlayerName`, and — when resolved — `playerId`, `gameId`, `statType`, `threshold`. `resolutionStatus` reuses `IdentityResolutionStatus`. Never deleted; `delisted` when it disappears. |
| `PriceObservation` | A timestamped reading of a contract's book: all four of `yesBidCents`, `yesAskCents`, `noBidCents`, `noAskCents` (nullable per side when Kalshi omits one), `observedAt`, and the `MarketSyncRun` that produced it. Append-only. |
| `MarketSyncRun` | One discovery+price sync execution with `status` (`complete`/`partial`/`failed`/`empty`) and counts. The completeness fact behind the slate banner. |
| `Projection` | One player, one stat type, one game, one model version, one information cutoff. Stores the compact distribution (`distributionKind`, `params`, `quantiles`, `pmf`), headline values, `confidence`, `computedAt`, `informationCutoff`. Written only by the Python runtime. |
| `ProjectionDriver` | Ordered human-readable sentences behind a projection, stored at persist time, rendered verbatim. |
| `RecommendationSnapshot` | A frozen recommendation state at an RD-4 trigger: inputs (projection, price observation), derived values, `isRecommended`, `side`, the threshold in force, and the trigger. Grading input, never a cache. |
| `Decision` | Append-only admin disposition (`took`/`faded`/`skipped`) against a contract, with a server-read snapshot of the freshest projection and price at decision time. Current disposition = latest row; unmarked = no rows. |
| Edge (derived) | `max(modelP×100 − yesAskCents, (100 − modelP×100) − noAskCents)`, computed on read from the freshest projection and freshest observation. Null when either input is missing. Never stored outside snapshots. |
| `confidenceAdjustedEdge` (derived) | `edgePoints × {high:1.0, medium:0.7, low:0.4}[confidence]`. The slate sort key. |
| Freshest | For projections: greatest `computedAt` for the (player, game, statType), any model version. For prices: greatest `observedAt` for the contract. |

Distinctions preserved (CLAUDE.md): `computedAt` ≠ `informationCutoff`; edge derived vs snapshot stored; three dispositions + absence; decisions carry `userId` from the session; contracts/projections/prices are shared reference data with no per-user partition.

## States and lifecycle

```prisma
enum Confidence {
  high
  medium
  low
}

enum ContractStatus {
  active // listed on the last sync
  closed // Kalshi reports the market closed for trading
  delisted // no longer returned by discovery; retained with history
}

enum MarketSyncStatus {
  complete // discovery and prices both succeeded
  partial // some markets or books could not be fetched
  failed // the sync could not complete at all
  empty // completed; Kalshi listed no matching markets (valid state)
}

enum MarketSide {
  yes
  no
}

enum SnapshotTrigger {
  appeared // first crossed into recommended
  state_changed // recommended <-> not, or better side flipped
  decision // captured because a decision was recorded
}

enum Disposition {
  took
  faded
  skipped
}
```

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| (no contract) | `active` unresolved/resolved | sync | Contract created from discovery; resolution attempted via `PlayerExternalId` |
| `active` | `closed` / `delisted` | sync | History retained; row leaves the upcoming slate read; nothing deleted |
| `unresolved`/`ambiguous` | `manual_override` | admin action | `PlayerExternalId` upsert + contract re-resolution; future reads only (RD-9) |
| not recommended | recommended | read-time | `RecommendationSnapshot(trigger: appeared)` persisted |
| recommended | not recommended, or side flip | read-time | `RecommendationSnapshot(trigger: state_changed)` |
| no `Decision` rows | `took`/`faded`/`skipped` | admin, pre-kickoff | Row created with server-read snapshot + `RecommendationSnapshot(trigger: decision)` |
| any disposition | different disposition | admin, pre-kickoff | New row appended; prior rows immutable; response carries `existing_decision` warning |
| any disposition | unmarked | **never** | No un-mark operation exists (RD-5) |
| any decision write | at/after kickoff | **rejected** | `invalid_state_transition` (RD-6) |

Terminal-ish states: a `delisted` or `closed` contract keeps its observations, snapshots, and decisions readable on detail via deep link; it simply stops appearing in the upcoming slate. Voided-market semantics arrive with settlement in Pitch 6; nothing here erases history (pitch DoD).

## UI integration

Screens, per the design doc (which owns all visual detail):

| Screen | Data needed | Actions |
| ------ | ----------- | ------- |
| Slate `/slate` | `SlateDto`: ranked rows (resolved), unranked rows (no projection / no price), unresolved list, last-sync status + timestamps, admin-only current dispositions | Open detail; refresh prices (also on interval); nothing else |
| Contract detail `/slate/[contractId]` | `ContractDetailDto`: contract, freshest projection (+ drivers, distribution), freshest observation (both books + mid), derived comparison, provenance; admin adds current disposition + its history times and (if unresolved) diagnostics | Admin: take/fade/skip; admin on unresolved: resolve mapping |

Components consume DTOs only — no raw Prisma rows cross into client components. The decision control, poller, and resolve control are the only client islands; each calls a route handler and then `router.refresh()`. The distribution summary receives the quantile grid + threshold and renders through the themed Recharts wrapper.

Forms: the decision write has one field (`disposition`); the resolve form has one field (`playerId` from an autocomplete over `Player` search). Both validate server-side regardless of UI state.

## Data model

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `Contract` | many→one (nullable) | `Player`, `Game` | Set when resolved; null while unresolved |
| `PriceObservation` | many→one | `Contract`, `MarketSyncRun` | Append-only book readings |
| `Projection` | many→one | `Player`, `Game` | Written by Python only |
| `ProjectionDriver` | many→one | `Projection` | Ordered sentences |
| `RecommendationSnapshot` | many→one | `Contract`; nullable → `Projection`, `PriceObservation` | Frozen state + provenance links |
| `Decision` | many→one | `Contract`, `User`; nullable → `Projection`, `PriceObservation`, self (`supersedes`) | Append-only, user-scoped |
| Contract resolution | uses | `PlayerExternalId` | Kalshi naming → `Player`, including `manual_override` |

### New models

```prisma
model Contract {
  id                 String                   @id @default(uuid())
  kalshiTicker       String                   @unique @map("kalshi_ticker")
  kalshiEventTicker  String?                  @map("kalshi_event_ticker")
  kalshiSeriesTicker String?                  @map("kalshi_series_ticker")
  title              String // verbatim Kalshi market title; evidence, never rewritten
  kalshiPlayerName   String?                  @map("kalshi_player_name") // parsed from title/ticker
  playerId           String?                  @map("player_id")
  gameId             String?                  @map("game_id")
  statType           StatType?                @map("stat_type")
  threshold          Decimal?                 @db.Decimal(6, 1)
  resolutionStatus   IdentityResolutionStatus @default(unresolved) @map("resolution_status")
  resolutionNote     String?                  @map("resolution_note") // admin-only diagnostic
  status             ContractStatus           @default(active)
  closeTime          DateTime?                @map("close_time") // Kalshi's stated close, when provided
  firstSeenAt        DateTime                 @map("first_seen_at")
  lastSeenAt         DateTime                 @map("last_seen_at")
  createdAt          DateTime                 @default(now()) @map("created_at")
  updatedAt          DateTime                 @updatedAt @map("updated_at")

  player            Player?                  @relation(fields: [playerId], references: [id])
  game              Game?                    @relation(fields: [gameId], references: [id])
  priceObservations PriceObservation[]
  snapshots         RecommendationSnapshot[]
  decisions         Decision[]

  @@index([status, resolutionStatus])
  @@index([gameId])
  @@index([playerId, gameId, statType])
  @@map("contracts")
}

model MarketSyncRun {
  id                  String           @id @default(uuid())
  status              MarketSyncStatus
  marketsDiscovered   Int              @default(0) @map("markets_discovered")
  contractsUpserted   Int              @default(0) @map("contracts_upserted")
  observationsWritten Int              @default(0) @map("observations_written")
  errorMessage        String?          @map("error_message") // sanitized; never a credential or URL with auth
  startedAt           DateTime         @map("started_at")
  finishedAt          DateTime?        @map("finished_at")
  createdAt           DateTime         @default(now()) @map("created_at")

  priceObservations PriceObservation[]

  @@index([startedAt(sort: Desc)])
  @@map("market_sync_runs")
}

model PriceObservation {
  id          String   @id @default(uuid())
  contractId  String   @map("contract_id")
  syncRunId   String   @map("sync_run_id")
  yesBidCents Int?     @map("yes_bid_cents")
  yesAskCents Int?     @map("yes_ask_cents")
  noBidCents  Int?     @map("no_bid_cents")
  noAskCents  Int?     @map("no_ask_cents")
  observedAt  DateTime @map("observed_at")
  createdAt   DateTime @default(now()) @map("created_at")

  contract Contract      @relation(fields: [contractId], references: [id])
  syncRun  MarketSyncRun @relation(fields: [syncRunId], references: [id])

  snapshots RecommendationSnapshot[]
  decisions Decision[]

  @@index([contractId, observedAt(sort: Desc)])
  @@map("price_observations")
}

model Projection {
  id                String     @id @default(uuid())
  playerId          String     @map("player_id")
  gameId            String     @map("game_id")
  statType          StatType   @map("stat_type")
  modelVersion      String     @map("model_version")
  distributionKind  String     @map("distribution_kind") // open set; validated by the writer
  params            Json // distribution parameters, sufficient to rehydrate
  quantiles         Json // quantile grid for continuous families
  pmf               Json? // explicit PMF for count families
  projectedValue    Decimal    @map("projected_value") @db.Decimal(8, 3)
  projectedMedian   Decimal    @map("projected_median") @db.Decimal(8, 3)
  intervalLow       Decimal    @map("interval_low") @db.Decimal(8, 3)
  intervalHigh      Decimal    @map("interval_high") @db.Decimal(8, 3)
  confidence        Confidence
  nEff              Int        @map("n_eff")
  computedAt        DateTime   @map("computed_at")
  informationCutoff DateTime   @map("information_cutoff")
  createdAt         DateTime   @default(now()) @map("created_at")

  player  Player             @relation(fields: [playerId], references: [id])
  game    Game               @relation(fields: [gameId], references: [id])
  drivers ProjectionDriver[]

  snapshots RecommendationSnapshot[]
  decisions Decision[]

  // Idempotent persist: same inputs, same row. A new cutoff is a new row;
  // the freshest (max computedAt) is what the slate reads.
  @@unique([playerId, gameId, statType, modelVersion, informationCutoff])
  @@index([gameId, statType, computedAt(sort: Desc)])
  @@index([playerId, gameId, statType, computedAt(sort: Desc)])
  @@map("projections")
}

model ProjectionDriver {
  id           String @id @default(uuid())
  projectionId String @map("projection_id")
  rank         Int // 0-based display order, by contribution
  text         String

  projection Projection @relation(fields: [projectionId], references: [id], onDelete: Cascade)

  @@unique([projectionId, rank])
  @@map("projection_drivers")
}

model RecommendationSnapshot {
  id                     String          @id @default(uuid())
  contractId             String          @map("contract_id")
  projectionId           String?         @map("projection_id")
  priceObservationId     String?         @map("price_observation_id")
  side                   MarketSide?
  modelProbability       Decimal?        @map("model_probability") @db.Decimal(6, 5)
  askCents               Int?            @map("ask_cents")
  edgePoints             Decimal?        @map("edge_points") @db.Decimal(6, 2)
  confidenceAdjustedEdge Decimal?        @map("confidence_adjusted_edge") @db.Decimal(6, 2)
  confidence             Confidence?
  isRecommended          Boolean         @map("is_recommended")
  thresholdPoints        Decimal         @map("threshold_points") @db.Decimal(5, 2) // config value in force
  trigger                SnapshotTrigger
  createdAt              DateTime        @default(now()) @map("created_at")

  contract         Contract          @relation(fields: [contractId], references: [id])
  projection       Projection?       @relation(fields: [projectionId], references: [id])
  priceObservation PriceObservation? @relation(fields: [priceObservationId], references: [id])

  @@index([contractId, createdAt(sort: Desc)])
  @@map("recommendation_snapshots")
}

model Decision {
  id                         String      @id @default(uuid())
  contractId                 String      @map("contract_id")
  userId                     String      @map("user_id") // always from the session, never the body
  disposition                Disposition
  supersedesDecisionId       String?     @unique @map("supersedes_decision_id")
  // Server-read snapshot of the freshest state at decision time. Nullable
  // because a decision is valid on a contract with no projection or no price.
  snapshotProjectionId       String?     @map("snapshot_projection_id")
  snapshotPriceObservationId String?     @map("snapshot_price_observation_id")
  snapshotModelProbability   Decimal?    @map("snapshot_model_probability") @db.Decimal(6, 5)
  snapshotSide               MarketSide? @map("snapshot_side")
  snapshotAskCents           Int?        @map("snapshot_ask_cents")
  snapshotEdgePoints         Decimal?    @map("snapshot_edge_points") @db.Decimal(6, 2)
  snapshotConfidence         Confidence? @map("snapshot_confidence")
  snapshotIsRecommended      Boolean?    @map("snapshot_is_recommended")
  snapshotProjectionComputedAt DateTime? @map("snapshot_projection_computed_at")
  snapshotInformationCutoff  DateTime?   @map("snapshot_information_cutoff")
  snapshotPriceObservedAt    DateTime?   @map("snapshot_price_observed_at")
  decidedAt                  DateTime    @default(now()) @map("decided_at")

  contract         Contract          @relation(fields: [contractId], references: [id])
  user             User              @relation(fields: [userId], references: [id])
  projection       Projection?       @relation(fields: [snapshotProjectionId], references: [id])
  priceObservation PriceObservation? @relation(fields: [snapshotPriceObservationId], references: [id])
  supersedes       Decision?         @relation("DecisionSupersedes", fields: [supersedesDecisionId], references: [id])
  supersededBy     Decision?         @relation("DecisionSupersedes")

  @@index([contractId, decidedAt(sort: Desc)])
  @@index([userId, decidedAt(sort: Desc)])
  @@map("decisions")
}
```

`User` gains `decisions Decision[]`; `Player` and `Game` gain the back-relations. No existing column changes.

**Not fact tables.** None of these carry `validAt`/`knownAt`/`ingest_run_id`: contracts and prices are market metadata the model never reads (second invariant), projections are model *output*, snapshots and decisions are product history. The schema-invariant guard's self-extension keys on `ingest_run_id`, which none of them carry; the guard is additionally extended to assert `price_observations` and `recommendation_snapshots` stay off any model-facing read path (see Testing).

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Edge, side, confidence-adjusted edge | no | freshest `Projection` × freshest `PriceObservation` × config | Read time only. No column, no job. `RecommendationSnapshot`/`Decision` freeze copies at events; those are history, not caches. |
| `modelProbability` at a threshold | no | `Projection.params`/`quantiles`/`pmf` + `Contract.threshold` | Derived by rehydrating the stored distribution (TypeScript port of the Python `prob_at_least` arithmetic — closed-form from stored parameters, no simulation). |
| Recommendation state | no | edge vs `RECOMMENDATION_THRESHOLD_POINTS` | Recomputed per read; transitions persist snapshots. |
| Midpoint | no | `(bid + ask) / 2` per side | Display context on detail only. |
| Ranking order | no | `confidenceAdjustedEdge` desc, tie-break `edgePoints` desc → `kickoffAt` asc → `kalshiTicker` asc | Deterministic; the slate never reshuffles between identical reads. |

## Authorization and access control

| Resource | Read | Create | Update | Delete |
| -------- | ---- | ------ | ------ | ------ |
| Slate, contract detail (shared portions) | any `active` session | — | — | — |
| `Contract` diagnostics (`resolutionNote`) + resolve action | admin | — | admin (`resolve`) | never |
| `PriceObservation`, `MarketSyncRun` | any `active` session (aggregated into DTOs) | system (sync) | never | never |
| `Projection`, `ProjectionDriver` | any `active` session | Python runtime only | never | never |
| `RecommendationSnapshot` | not exposed this pitch (grading data) | system (read-path triggers) | never | never |
| `Decision` | admin only | admin only | never (append-only) | never |

- Every route re-verifies session and `status = active` per request (Pitch 3 pattern in `src/lib/access`).
- Viewer slate/detail DTOs are **constructed without decision fields** — the serializer for viewers has no decision code path, so absence is structural (design doc privacy requirement).
- `userId` on `Decision` comes from the session. A body carrying snapshot values or a user id is a `validation_error`.
- RLS: not enabled (RD-16). The Python runtime's service-role credential remains unreachable from any route handler; the TypeScript app keeps using its pooled Prisma URL.

## Route handlers and API surface

Reads render in server components via Prisma. Routes exist only for mutations and the sanctioned refresh poll.

### `GET /api/slate` — shared read (also consumed after client refresh)

Output `SlateDto` (see UI data contracts). No params in this pitch (`window=upcoming` implied). Side effects: **persists `RecommendationSnapshot` rows for any RD-4 transitions detected during the read**, inside one transaction with the read's consistent view. Snapshot writes are keyed to the (contract, freshest projection, freshest observation, threshold) tuple so concurrent reads cannot double-write a transition (unique-tuple check inside the transaction).

### `POST /api/prices/refresh` — shared action, coalesced

Input: `{}` (no body fields honoured this pitch). Behavior: if the latest `MarketSyncRun` finished within `KALSHI_SYNC_MIN_INTERVAL_SECONDS`, return it; otherwise run discovery + book fetch, upsert contracts, attempt resolution for new/unresolved ones, write observations per RD-14, and record the run.

```json
{
  "syncRunId": "…",
  "status": "complete",
  "observedAt": "2026-11-08T16:42:09Z",
  "marketsDiscovered": 38,
  "observationsWritten": 12,
  "coalesced": false,
  "degraded": false
}
```

Kalshi unreachable → `200` with `"status": "failed", "degraded": true` (designed mode, not an error). Kalshi rate-limit responses are respected with backoff inside the sync; the route itself never fans out per browser (RD-13).

### `POST /api/decisions` — admin only

Input `{ "contractId": string, "disposition": "took" | "faded" | "skipped" }`. The handler, in one `$transaction` (CLAUDE.md pattern — `recordDecision(input, tx?)`):

1. Loads the contract with freshest projection and freshest observation (server-side; never from the body).
2. Rejects if the game's `kickoffAt <= now` or game status ≠ `scheduled` → `invalid_state_transition` (RD-6). A contract with no game (unresolved) is decidable — the boundary falls back to the contract's `closeTime` when known, else allowed.
3. Creates the `Decision` row with the derived snapshot values and `supersedesDecisionId` = prior latest decision id, if any.
4. Persists `RecommendationSnapshot(trigger: decision)`.

Returns `201` with `DecisionDto`; if a prior decision existed, includes `warnings: [{ code: "existing_decision", … }]` (conventions). Same-disposition repeat is a no-op `200` returning the existing current row.

### `POST /api/contracts/:id/resolve` — admin only

Input `{ "playerId": string }`. In one transaction: upserts `PlayerExternalId` (`source: kalshi`, `externalId`/`externalName` = the contract's Kalshi player name, `status: manual_override`, `resolvedBy` = admin id, `resolvedAt: now`), re-runs resolution for this contract (sets `playerId`, `gameId`, `statType`, `threshold` if parseable, `resolutionStatus: manual_override`). Returns the updated contract DTO. Errors: `not_found` (contract or player), `invalid_state_transition` if already `resolved`. History untouched (RD-9).

Error shape and codes follow `references/api-conventions.md` exactly. No route accepts or returns anything derived from the Kalshi signing key; sync error messages are sanitized before storage.

## Validation rules

| Field / input | Validation | Error code |
| ------------- | ---------- | ---------- |
| `disposition` | one of `took`/`faded`/`skipped` | `validation_error` |
| `contractId`, `playerId` | UUID; exists | `validation_error` / `not_found` |
| Decision body extras | any snapshot-like or user-identifying field present → reject | `validation_error` |
| Decision timing | game kickoff passed or game not `scheduled` → reject | `invalid_state_transition` |
| Resolve target | contract must be `unresolved`/`ambiguous` | `invalid_state_transition` |
| Sync payload (internal) | prices clamped to 1–99 integer cents; a market missing a book side stores nulls for that side; malformed market skipped and counted (→ `partial`), never aborts the run | — |

Warn, not block (returned as `warnings`, HTTP 200/201): decision on a contract with no projection; decision on a non-recommended contract; superseding an existing decision. Displayable oddities — empty slate, nothing above threshold, unresolved contracts — are states, never errors.

## UI data contracts

```typescript
export type SlateDto = {
  generatedAt: string;
  slateDate: string | null; // date of the nearest upcoming kickoff window
  gameCount: number;
  rows: SlateRowDto[]; // ranked; includes below-threshold and no-edge rows
  unresolved: UnresolvedRowDto[];
  lastSync: {
    status: "complete" | "partial" | "failed" | "empty";
    finishedAt: string | null;
  } | null;
  degraded: boolean; // latest sync failed AND no observation exists for some rows
  nextKickoffAt: string | null; // for the empty state
};

export type SlateRowDto = {
  contractId: string;
  playerName: string;
  teamAbbreviation: string | null;
  opponentAbbreviation: string | null;
  statType: StatType;
  threshold: number;
  kickoffAt: string;

  // Model side — null means "no projection", which is distinct from zero.
  modelProbability: number | null;
  confidence: "high" | "medium" | "low" | null;
  projectionComputedAt: string | null;
  informationCutoff: string | null;

  // Market side — null means "no current price" (degraded or never observed).
  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
  priceObservedAt: string | null;

  // Derived at read time; null when either input is missing.
  side: "yes" | "no" | null;
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;

  // Admin only — the field is ABSENT from viewer payloads, not null.
  currentDisposition?: "took" | "faded" | "skipped";
  decidedAt?: string;
};

export type UnresolvedRowDto = {
  contractId: string;
  title: string; // verbatim Kalshi title
  kalshiTicker: string;
  yesAskCents: number | null;
  priceObservedAt: string | null;
  // Admin only — absent for viewers.
  resolutionNote?: string;
  kalshiPlayerName?: string;
};

export type ContractDetailDto = SlateRowDto & {
  gameLabel: string | null; // "CIN @ BAL"
  projectedValue: number | null;
  projectedMedian: number | null;
  intervalLow: number | null;
  intervalHigh: number | null;
  quantiles: Record<string, number> | null; // for the distribution summary
  drivers: string[]; // ordered, verbatim
  modelVersion: string | null;
  midCents: number | null; // context only
  status: "active" | "closed" | "delisted";
};

export type DecisionDto = {
  id: string;
  contractId: string;
  disposition: "took" | "faded" | "skipped";
  decidedAt: string;
  snapshotModelProbability: number | null;
  snapshotAskCents: number | null;
  snapshotEdgePoints: number | null;
  snapshotConfidence: "high" | "medium" | "low" | null;
  snapshotIsRecommended: boolean | null;
  snapshotProjectionComputedAt: string | null;
  snapshotInformationCutoff: string | null;
  snapshotPriceObservedAt: string | null;
};
```

Field names are identical on every surface that shows them. Viewer serializers never touch decision data — the optional fields exist only on the admin path.

## Python: projection persistence

New CLI in `sightline_model`:

```text
uv run sightline-model project [--cutoff ISO8601] [--season N --week N]
```

- Reads distinct (playerId, gameId, statType) triples from `contracts` where the game is upcoming (`status = scheduled`, `kickoffAt > now`) and resolution is `resolved`/`manual_override`. **Identity columns only; the module never selects from `price_observations` or `recommendation_snapshots`.**
- Computes each projection through the existing as-of layer with the explicit cutoff (default: now), the same `project_one` path the backtest uses.
- Upserts `projections` on the `(player, game, statType, modelVersion, informationCutoff)` key and replaces that projection's `projection_drivers` rows in the same transaction. Re-running with the same cutoff is a no-op (idempotence); a new cutoff writes new rows.
- Unprojectable players are logged with their reason and produce **no row** — the app renders "no projection" from absence.
- Uses the direct (non-pooled) connection via the existing `db.py` pattern. Never migrates.

## Testing strategy

Categories per `references/testing-patterns.md`; risk-ranked per CLAUDE.md.

**1. Temporal integrity (adversarial, first)**
- GIVEN a projection persisted with cutoff T, WHEN context rows with `known_at > T` exist for the same player, THEN `sightline-model project --cutoff T` produces byte-identical distribution parameters (extends `test_asof_leakage.py` to the persist path).
- GIVEN the same cutoff run twice, THEN zero new rows and zero changed rows (idempotence).

**2. Prices never feed projections (structural)**
- Extend `python/tests/test_import_graph.py`: no module in `sightline_model`/`sightline_ingest` references `price_observations` or `recommendation_snapshots` (table-name scan of SQL/model source, plus the existing import-graph assertion).
- The `project` CLI's SQL is asserted to select only identity columns from `contracts`.

**3. Grading-adjacent immutability and idempotence**
- GIVEN an existing decision with snapshot S, WHEN prices refresh and projections recompute, THEN S is unchanged (row-level assertion).
- GIVEN a superseding decision, THEN the prior row is intact and `supersedesDecisionId` links them; the current disposition is the latest row.
- GIVEN two identical sync payloads, THEN the second writes no duplicate contracts and no new observations before the heartbeat elapses (RD-14).

**4. Contract-to-player resolution**
- Fixture-driven parser tests: suffixes (`Jr`, `III`), punctuation (`Ja'Marr`, `Smith-Njigba`), initials, duplicate names (two active players, → `ambiguous`), unknown rookie (→ `unresolved`), multiple thresholds for one player-stat-game (distinct tickers → distinct contracts), relisting at a new threshold (new contract; old one `delisted` with history intact).
- GIVEN an unresolved contract and an admin `resolve`, THEN future syncs auto-resolve that name and prior observations are untouched.
- An unresolved contract appears in the slate DTO's `unresolved` list — never dropped.

**5. Kalshi integration (adversarial)**
- Outage → `MarketSyncRun(failed)`, slate renders projections with `degraded: true`; malformed single market → skipped, run `partial`, others written; empty market list → run `empty`, designed empty state; rate-limit response → backoff, no tight retry loop; coalescing → two concurrent refresh calls produce one sync.
- Book-side correctness: fixtures assert `yes`/`no` sides are never transposed and edge for the `no` side uses `noAskCents` (the inverted-edge rabbit hole).

**6. Role enforcement and privacy (route-level)**
- Viewer `POST /api/decisions` → 403; viewer `POST /api/contracts/:id/resolve` → 403; unauthenticated → 401.
- Viewer slate and detail payloads contain no decision keys at all (JSON key-set assertion, not value assertion) and no `resolutionNote`.
- Admin payloads for a contract the admin never marked contain no disposition field (absence = unmarked).
- e2e (Playwright): viewer sees identical shared surfaces with no decision UI; admin take→fade flow updates in place; deep-link to detail works for both roles.

**7. Edge computation and ranking (unit)**
- Threshold probability from stored params matches the Python `prob_at_least` output on shared fixtures (cross-runtime golden file, tolerance 1e-9).
- Edge side selection, confidence weights, deterministic tie-break ordering, null propagation (no projection / no price / both).
- Recommendation snapshots: appear/state-change/decision triggers fire once per transition; unchanged refreshes write nothing.

## Acceptance criteria

**Kalshi Market Sync**
- [ ] Upcoming NFL player-prop markets are discovered and upserted as contracts; refresh happens on view and on the in-page interval, within rate limits, coalesced server-side.
- [ ] Every discovered contract is resolved (player, stat, threshold, game) or explicitly `unresolved`/`ambiguous`, retained, and visible.
- [ ] Both book sides are stored with `observedAt`; observations are append-only and never mutated by later refreshes.
- [ ] A Kalshi outage yields a `failed` sync run and a projections-only slate with the degraded banner; a partial response yields `partial` and the partial banner.
- [ ] An admin can correct an unresolved contract's mapping in place; the correction affects future reads only.

**Edge Calculation and Recommendation**
- [ ] Edge is computed at read time from the freshest projection and freshest observation, against the executable ask of the better side; both timestamps are displayed.
- [ ] No edge or recommendation is shown where either input is missing; null and zero are distinguishable in the DTO.
- [ ] Ranking is by confidence-adjusted edge with deterministic tie-breaks; below-threshold rows remain, de-emphasised.
- [ ] The recommendation threshold is environment configuration.
- [ ] Recommendation snapshots persist at the RD-4 triggers and never change afterward.

**Decision Log**
- [ ] The admin can mark took/faded/skipped on any visible contract, recommended or not, resolved or not; viewers cannot by any route.
- [ ] Decisions are append-only; changes supersede without altering prior rows; unmarked is the absence of rows; no forced or clearable dispositions.
- [ ] Every decision row carries a server-read snapshot; a body with snapshot values is rejected.
- [ ] Decision writes at/after kickoff are rejected server-side.
- [ ] Viewer payloads contain no decision data, keys included.

**Surfaces**
- [ ] The slate renders from stored data without waiting on any model run or the refresh round-trip; empty, no-contracts, nothing-above-threshold, and all-unresolved states render as designed.
- [ ] Contract detail exposes projected value, median, interval, quantile summary, confidence, verbatim drivers, computed-at, information cutoff, model version, both books with mid, and (admin) the decision control.
- [ ] Games whose kickoff has passed leave the upcoming slate on the next read.

## Explicit non-goals

**Permanent:** sportsbook/DFS integration; public or commercial access; live in-game trading; film-derived inputs; viewer credentials or viewer trading; general market browsing.

**Deferred:** scheduled jobs, staleness, health recency (Pitch 5); settlement, outcomes, grading, accuracy, decision-log page, timing cost (Pitch 6); recalibration, bankroll, sizing, paper trading (Pitch 7–8); simulation drivers (Pitch 9); suggestions (Pitch 10); orders (Pitch 11); NBA/WNBA, pick sharing, additional stat types and sources.

## Open questions

None blocking. Inherited questions restated with this pitch's posture:

1. **Ask vs midpoint** — resolved for this pitch as RD-1 (ask drives, mid displayed); Pitch 7 revisits with fees.
2. **Grading truth (Kalshi settlement vs official line)** — untouched here; Pitch 6 decides. Nothing in this schema forecloses storing both (`Outcome` arrives in Pitch 6).
3. **Model-version treatment on the accuracy surface** — untouched; `Projection.modelVersion` is stored per row so any Pitch 6 policy is computable.
4. **RLS on user-scoped tables** — deferred (RD-16), still open upstream.

## Future considerations

- Pitch 5 adds staleness on top of the timestamps this pitch already threads through every DTO, and replaces the in-page interval with scheduled sync; `MarketSyncRun` is the health read's price-refresh source.
- Pitch 6 grades `RecommendationSnapshot` and `Decision` rows as stored here; the final pre-kickoff snapshot slots in as a new `SnapshotTrigger` value.
- Pitch 9's simulation engine replaces `distributionKind`/`params` contents without schema change (open-set string, JSON params).
- Pitch 11's order flow will link `Position` to the `Decision` rows this pitch accumulates.
