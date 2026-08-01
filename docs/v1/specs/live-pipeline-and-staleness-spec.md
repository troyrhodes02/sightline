---
version: 1.0.0
status: approved
author: Claude (autonomous pipeline run), for William Rhodes
last_updated: 2026-08-01
pitch_reference: docs/v1/pitches/live-pipeline-and-staleness.md
design_reference: docs/v1/design-docs/live-pipeline-and-staleness-design-doc.md
ui_preview_reference: docs/v1/ui/live-pipeline-and-staleness-ui-preview.html
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: (milestone and issues created by the pipeline run; see docs/v1/runs/live-pipeline-and-staleness-progress.md)
---

# Live Pipeline & Staleness — Technical Spec

## Summary

This pitch makes Sightline maintain its own serving data on a football-week cadence, and makes the currency of every displayed projection explicit. The core abstraction is **currency is a property of the projection, not of the scheduler**: scheduled jobs move data, but what the interface discloses is derived at read time from the projection's own `computedAt` and `informationCutoff` against the facts and kickoff of its game. A green job tile never upgrades a projection's displayed currency, and a failed job never erases the last completed projection.

Three mechanisms ship together. **Scheduled maintenance**: GitHub Actions cron entries run the existing Python ingest and projection paths nightly in-week plus per-kickoff-window on game days, invoke the existing TypeScript Kalshi integration for scheduled price maintenance through an authenticated pipeline route, and keep the schedules alive across the offseason with a keepalive workflow. **Staleness Disclosure**: every slate row and contract detail exposes projection age and information cutoff, plus two distinct read-time staleness states — `stale` (clearable: ingested game-scoped facts postdate the displayed projection's cutoff) and `predates inactives` (a permanent disclosure this version: the game has passed its inactives-publication point and Sightline has no inactives source). **Pipeline health**: an admin-only surface derives six honest states per job category from completed-run records, with per-source and per-game detail, and an offseason-readiness block that keeps the keepalive observable.

Working means: the slate keeps rendering the latest completed stored state while jobs run or fail; re-running any scheduled job over an overlapping window writes no duplicates; a silently skipped GitHub Actions job is visible in the product as `late` rather than as stale-but-green numbers; and no staleness or health value is ever persisted — there is no `isStale` column, no stored edge, and no background job maintaining either.

## Problem

- Projections exist only when William runs `sightline-model project` by hand; nothing maintains them across an NFL week, so the slate silently decays toward the most dangerous state in the product — a current price beside an old projection.
- `SlateRowDto` already carries `informationCutoff`, but nothing renders it, computes an age from it, or evaluates it against what the corpus has since learned. The app cannot yet tell whether a stored projection was computed before or after the facts it should have seen.
- The health surface honestly reports `not_yet_implemented` for all three signals (SIG-37's static registry); a scheduled pipeline cannot ship without replacing that with completed-run truth, or the surface would report green with no work behind it.
- Nothing captures a final pre-kickoff state, so Outcome Scoring & Accuracy Surface would have no second comparison point for timing cost.
- GitHub Actions schedules die after sixty days of repository inactivity; without a keepalive, the February–September offseason kills the pipeline and the failure surfaces in September.

## Resolved Decisions

Recorded per the Autonomous Pipeline Policy. RD-P1–RD-P8 were pre-resolved by the run instruction with approved-doc authority; RD-Q4/Q5/Q11/Q12 resolve the pitch's remaining open questions; RD-19 onward are implementation decisions made here (numbering continues from the Pitch 4 spec's RD-18).

| # | Decision | Rationale |
| - | -------- | --------- |
| RD-P1 (Q1+Q6) | **Staleness splits into two distinct states.** `stale` (clearable): ingestable game-scoped information exists whose `knownAt` postdates the displayed projection's `informationCutoff`; clears only when a recomputed projection's cutoff demonstrates incorporation — ingest alone never clears it. `predates inactives` (not clearable this pitch): a game past its inactives-publication point permanently discloses that projections predate inactives; it is a disclosure, not a failure. Never collapsed, visually or semantically. Forward dependency: **Adjustment Suggestions** converts *predates inactives* into a clearable state. | Run instruction, approved-doc authority. The roadmap defers the inactives feed; inventing a source to make the PRD criterion clearable would be dishonest. |
| RD-P2 (Q2) | **SIG-25's ingest idempotence is a satisfied hard prerequisite, verified not assumed.** Re-running an overlapping window produces zero writes, zero corrections, no error. Verified 2026-08-01: 31 ingest-suite tests pass, including the idempotent re-run tests. | Run instruction, approved-doc authority; the scheduled pipeline reprocesses overlapping windows by design. |
| RD-P3 (Q10) | **This pitch captures the final pre-kickoff snapshot as pipeline infrastructure.** Capture only — no grading, scoring, or timing-cost calculation, which belong to **Outcome Scoring & Accuracy Surface**. | Run instruction, approved-doc authority; this pitch owns the only game-relative schedule positioned to capture it. |
| RD-P4 (Q3) | **Scheduled price jobs invoke an authenticated route in the TypeScript application**, reusing the existing Kalshi integration. No second Kalshi client; no Kalshi credentials in the Python runtime. | Run instruction, approved-doc authority; one place owns rate-limit budget and credential handling. |
| RD-P5 (Q8) | **Currency disclosure is shared; operational diagnostics are admin-only.** Projection age, cutoff, and both staleness states go to every authenticated user; last-success signals, delay and failure states are admin-only at `/health`. | Run instruction, approved-doc authority; a viewer needs currency to weigh a recommendation, and has no use for pipeline internals. |
| RD-P6 (Q7) | **Health is three global per-job-category signals plus per-game currency via staleness.** No per-game health monitoring beyond recompute-cycle completeness detail. | Run instruction, approved-doc authority; the two mechanisms answer different questions. |
| RD-P7 (Q9) | **Partial success is honest.** Ingest records success per source; the aggregate is green only when every required source succeeded, and a degraded optional source is distinct from a failed required one. Recomputation records success per game. No single timestamp represents the multi-stage pipeline. | Run instruction, approved-doc authority. |
| RD-P8 (Q13) | **Recovery is command-line only**, documented in the runbook. The health surface reports; it does not operate. | Run instruction, approved-doc authority. |
| RD-Q4 | **"News-driven" means news-cadence-aligned, not event-triggered.** The schedule is fixed: nightly in-week ingest + recompute, plus game-day recompute per kickoff window. No event-triggered recomputation exists in this pitch. | Roadmap's Definition of Done specifies nightly + morning-of mechanics; the pitch excludes real-time reaction. |
| RD-Q5 | **Expected operating windows are configuration with stated defaults** (§ Configuration): ingest/recompute `late` past 26h since last success (24h cadence + 2h scheduler allowance); price refresh effective cadence hourly in-week, 15 min on game days (first kickoff −6h through last kickoff), `late` past 2× active cadence. Game-day recompute lateness surfaces per game through staleness and completeness, not the global signal. Empty-data success is success. `not expected` derives from the stored schedule, never hardcoded dates. | Health cannot judge lateness without approved bounds; bounds as config in one module keeps them product-visible and adjustable without code archaeology. |
| RD-Q11 | **Keepalive: monthly marker commit + self-report.** A scheduled workflow commits a trivial marker file to the default branch with minimum `contents: write` permission, then reports through the authenticated pipeline route so the app renders last-acted and next-required-by (last action + 60 days). Amber only when overdue. Pre-Week-1 readiness verification is a runbook step (`gh workflow list` — schedules still enabled), not product UI. | Only commits reset the 60-day timer; self-reporting keeps offseason readiness observable in-product without a repository dashboard. |
| RD-Q12 | **Kickoff changes are discovered by the nightly schedule re-ingest, and every schedule-relative evaluation reads the currently stored kickoff at evaluation time.** The game-day dispatcher selects in-window games per invocation from the database; no job plan is precomputed or cached. A flexed or postponed game follows its updated kickoff within one ingest cycle. | The schedule source already ingests revisions bitemporally; evaluation-time reads make stale job plans structurally impossible. |
| RD-19 | **Final pre-kickoff snapshots are captured by the TypeScript scheduled price path**, not Python. On each scheduled price refresh, contracts whose game kicks off within `FINAL_SNAPSHOT_WINDOW_MINUTES` and have no final snapshot get one `RecommendationSnapshot` with new trigger `final_pre_kickoff`, from the freshest stored projection and price. Idempotent via a partial unique index. | `RecommendationSnapshot` is price-derived and TypeScript-owned; Python must never read it (second invariant). The last scheduled cycle before kickoff is the natural capture point. |
| RD-20 | **Scheduler authentication is a dedicated bearer token on a `/api/pipeline/*` namespace.** `Authorization: Bearer $PIPELINE_SCHEDULER_TOKEN`, constant-time compare, `401 unauthorized` on mismatch, `503` if unset. User-session routes stay separate; the pipeline routes reuse the same internals (`runMarketSync`). | A machine caller is not a user session; mixing auth modes on one route invites regressions. The token authorizes reporting and refresh only — it can neither read data nor place orders. |
| RD-21 | **Job recording is `PipelineRun` (cycle-level) + `PipelineRunGame` (per-game recompute detail) + a nullable `pipelineRunId` on `IngestRun` (per-source detail).** The price-refresh health signal derives from the existing `MarketSyncRun`; no duplicate recording. A run row is created `running` at start and marked terminal at completion; success exists only as a completed state — an interrupted run can never read as success. | Reuses existing per-source (`IngestRun`) and per-sync (`MarketSyncRun`) records rather than duplicating them; cycle rows give health clean aggregate semantics under overlap. |
| RD-22 | **Stale triggers are game-scoped fact groups**: `PlayerGameContext` (injury designations, practice/participation status), `GameScheduleRevision`, `GameWeather`, and `PlayerGameStat`/`PlayByPlay` rows of either team's completed games this season — each compared as `knownAt > informationCutoff` of the displayed projection. League-wide drift (e.g., another team's game completing) is the nightly recompute's job, not a per-game stale trigger. | Keeps `stale` meaningful (recompute lagging ingest for *this* game) instead of marking the whole slate stale after every game night. |
| RD-23 | **The predates-inactives boundary is `kickoffAt − INACTIVES_LEAD_MINUTES` (default 90), and the state is time-based and permanent for the game once crossed** — a recompute after the boundary does not clear it, because no inactives source exists to have been incorporated. The detail sentence states the expected time and the missing source. | NFL inactives publish ~90 minutes before kickoff (the corpus already encodes `kickoff_minus_90m/v1` as its cutoff policy). Clearing on recompute timestamp alone would be exactly the false currency this pitch exists to prevent. |
| RD-24 | **The game-day dispatcher records a `PipelineRun` only when it selects at least one game.** An invocation that finds nothing in window exits without writing. The nightly cycle carries the global recompute signal. | A 30-minute polling no-op is not a pipeline event; recording it would bury real cycles in noise and inflate "last success" with empty ticks that moved no data. |
| RD-25 | **Six health states with derivation precedence** `not_expected` → `running` → `failed` → `late` → `never_run` → `ok`, where a `running` row older than `RUN_TIMEOUT_MINUTES` (default 120) is treated as `failed` (incomplete). `not_yet_implemented` retires with this pitch. | A crashed runner cannot mark its own row; a timeout is the only honest way an abandoned `running` row becomes visible as a failure. |
| RD-26 | **Required vs optional ingest sources are a code-level registry**: required = `schedule`, `pbp`, `stats`, `context`; optional = `weather` (degraded/unavailable is a designed fallback). The cycle aggregate is green only when all required succeeded. | Weather already has documented degraded modes (`WeatherStatus`); the other four feed identity, priors, and staleness directly. |
| RD-27 | **The keepalive commit is made with the workflow's `GITHUB_TOKEN`**, which cannot trigger other workflows, and touches only a dedicated marker file (`.github/keepalive`). | GitHub-documented behavior prevents keepalive feedback loops by construction; the marker file can never alter application behavior. |
| RD-28 | **Server-computed display state; the client does no clock math.** Ages (`2d 4h`) and both staleness booleans are computed at serialization time server-side and refreshed by the existing slate poll (`router.refresh()`); no per-second ticking, no client-side staleness derivation. The health page computes state at request time and refreshes on reload only. | Design-doc decision; one derivation site means the slate and detail can never disagree. |
| RD-29 | **Design-doc rendering decisions honored as specified**: staleness renders as row chips (never banners; the banner region stays owned by Kalshi refresh outcomes); projection age appends to the timestamps line, compressing to ages-only at `xs`; `running` renders the in-flight attempt under last-success; overdue keepalive renders an `overdue` chip plus inline caution; Kalshi-degraded rows keep the price age of the last successful fetch. Projection age and price age never merge. | Design doc + UI preview are the settled visual contract for this pitch. |

## Scope and non-scope

**In scope**

- Two read-time staleness states on the slate and contract detail, per game, from stored kickoff and fact `knownAt`s; projection age and information cutoff visible on rows and detail (Staleness Disclosure).
- `PipelineRun` recording; scheduled nightly in-week ingest + recompute (Python, direct connection); game-day dispatcher recomputing games per kickoff window; per-game recompute scoping in `sightline-model project`.
- Scheduled price maintenance through `/api/pipeline/price-refresh` (reusing `runMarketSync`), including final pre-kickoff `RecommendationSnapshot` capture (capture only).
- The `/health` surface replacing SIG-37's static registry: six states, per-source and per-game detail, offseason readiness, admin-only.
- Keepalive workflow + self-report; runbook for secrets, permissions, and manual re-runs.

**Out of scope** (deferred; do not preclude)

- An inactives source and the clearing of *predates inactives* (**Adjustment Suggestions**). Grading, timing cost, accuracy surfaces, and any interpretation of the captured final snapshot (**Outcome Scoring & Accuracy Surface**). Simulation-model changes (**Simulation Engine**). Order placement and autonomous execution (**Kalshi Trading** and later).
- Outbound notifications, retry/run-now controls, per-game health monitoring, workflow consoles, log surfaces.

**Standing temptations, refused:** no `isStale` column; no stored edge; no background job denormalising either; no message queue, worker service, or second Kalshi client; no Python migration; no event-triggered recompute dressed up as "news-driven".

## Core concepts

| Concept | Description |
| ------- | ----------- |
| `PipelineRun` | One logical scheduled (or manual CLI) cycle of a job category: `ingest`, `recompute`, or `keepalive`. Created `running` at start; terminal status (`succeeded`/`failed`/`incomplete`) written only at completion. The health read's source of truth for those categories. |
| `PipelineRunGame` | Per-game outcome rows for a recompute cycle: which games were in scope, which succeeded, which failed. Feeds the health surface's completeness detail (`12 of 14 games current`). |
| `IngestRun.pipelineRunId` | Links each per-dataset ingest execution to the cycle that ran it, giving the health surface per-source detail without duplicating the record. Null for standalone/manual dataset runs. |
| Price-refresh health | Derived from the existing `MarketSyncRun` — every successful sync is price maintenance, whether view-driven, poll-driven, or scheduled. No new recording. |
| `stale` (derived) | Per contract row, from the displayed projection: any RD-22 fact group for the game carries `knownAt > informationCutoff`. Clears only when a recompute raises the cutoff past those facts. Never persisted. |
| `predates inactives` (derived) | Per game: `now ≥ kickoffAt − INACTIVES_LEAD_MINUTES`. Permanent for the game once crossed (RD-23). Never persisted. A disclosure, not a failure. |
| Final pre-kickoff snapshot | A `RecommendationSnapshot` with trigger `final_pre_kickoff`, at most one per contract, captured by the scheduled price path inside the final window. The comparison point Outcome Scoring & Accuracy Surface will grade against. Capture only. |
| Health signal (derived) | Per category: exactly one of `ok`/`running`/`late`/`failed`/`never_run`/`not_expected`, derived at read time per RD-25 from run records, the stored schedule, and configured bounds. Never persisted. |
| Expected window | Configuration (§ Configuration), not cron syntax: how old a last success may be before the signal is `late`, and when a category is `not_expected` (no scheduled game within the lookahead). |
| Keepalive | A monthly marker commit that resets GitHub's 60-day scheduled-workflow inactivity timer, self-reported as a `PipelineRun` so offseason readiness is observable in-product. |

Distinctions preserved (CLAUDE.md): `computedAt` ≠ `informationCutoff` — a recompute at 11:40 against a Friday cutoff is real and the display must show both honestly; staleness and edge are computed on read with no column and no job; projection age and price age are two clocks that never merge; a job's start is not its success; ingest success is not projection currency.

## States and lifecycle

```prisma
enum PipelineJobCategory {
  ingest
  recompute
  keepalive
}

enum PipelineRunStatus {
  running // created at start; never readable as success
  succeeded // completed; for ingest: every required source succeeded
  failed // completed unsuccessfully, or a required source failed
  incomplete // interrupted / abandoned (RUN_TIMEOUT exceeded while running)
}

enum PipelineGameStatus {
  succeeded
  failed
  skipped // selected but not attempted (e.g. cycle aborted before reaching it)
}
```

| From | To | Trigger | Notes |
| ---- | -- | ------- | ----- |
| — | `running` | cycle start | Row created first, before any work; the health read shows `running` with last success still displayed |
| `running` | `succeeded` | completion, all required work done | The only transition that moves a last-success signal. A run that found no new data still succeeds (empty success is success) |
| `running` | `failed` | completion with failure | For ingest: any required source failed (a degraded optional source alone still succeeds, with detail visible) |
| `running` | `incomplete` | derived at read when `startedAt` exceeds `RUN_TIMEOUT_MINUTES`; written by the next cycle that observes it | An abandoned row never blocks or masquerades; the health read treats a timed-out `running` as failed even before it is rewritten |
| any terminal | — | — | Terminal rows are immutable; a retry is a new run |

`RecommendationSnapshot.trigger` gains `final_pre_kickoff`; snapshot rows remain append-only and immutable. Staleness states have no lifecycle — they are derived fresh on every read.

## UI integration

Reference the design doc for all visual detail. Implementation obligations:

**Slate (`/slate`)** — `SlateRowDto` gains a `staleness` object and server-formatted ages. Chips render from booleans only (RD-28); chip order fixed: recommendation, disposition (admin), `stale`, `predates inactives`, timestamps. Staleness arrives with the row payload — never popped in after render. Row height parity holds across all variants; chips are never dropped at `xs`.

**Contract detail (`/slate/[contractId]`)** — the Provenance block becomes the **Currency block**: computed-at + age, information cutoff, model version, and one explanatory sentence per active state. The predates-inactives sentence interpolates `staleness.inactivesExpectedAt`; all other copy is static. No-projection contracts render no Currency block and no staleness chips (they qualify a projection). Unresolved contracts keep their own treatment — resolution failure is not staleness.

**Health (`/health`, admin-only)** — replaces the SIG-37 placeholder registry with real derivation. Three fixed-order signal blocks (Ingest, Projection recomputation, Price refresh); `ok` renders no chip; per-source and per-game nested blocks render only when non-green; offseason layout swaps expected-window rows for dormant copy plus the Offseason readiness block. No mutations, no polling, no links to CI, no log excerpts, no credentials in any state including errors. The existing loading skeleton and error boundary stay.

## Data model

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `PipelineRunGame` | `pipelineRunId` n:1 | `PipelineRun` | Per-game outcomes of a recompute cycle |
| `PipelineRunGame` | `gameId` n:1 | `Game` | The game recomputed |
| `IngestRun` | `pipelineRunId` n:1 (nullable, new) | `PipelineRun` | Per-source detail of an ingest cycle; null for standalone runs |
| `RecommendationSnapshot` | (unchanged) | — | Gains trigger value `final_pre_kickoff` + partial unique index |

### New models

```prisma
/// One logical cycle of a scheduled job category (or its manual CLI re-run).
/// Created `running` BEFORE any work; success is written only at completion,
/// so an interrupted cycle can never read as a success. Written by the Python
/// runtime (ingest, recompute) and by the pipeline routes (keepalive).
/// NOT a bitemporal fact table: a run record is operational history, not a
/// fact about the world — no validAt/knownAt, no ingest_run_id.
model PipelineRun {
  id           String              @id @default(uuid())
  category     PipelineJobCategory
  status       PipelineRunStatus   @default(running)
  /// Scheduler-supplied identifier (GitHub Actions run id) or "manual".
  /// Unique per category so a re-delivered scheduled invocation upserts
  /// rather than double-recording one logical cycle.
  invocationId String              @map("invocation_id")
  scope        String? // "in_week" | "gameday" | null (keepalive)
  codeVersion  String              @map("code_version")
  errorMessage String?             @map("error_message") // sanitized; never a credential or DSN
  startedAt    DateTime            @map("started_at")
  finishedAt   DateTime?           @map("finished_at")
  createdAt    DateTime            @default(now()) @map("created_at")

  games PipelineRunGame[]

  @@unique([category, invocationId])
  @@index([category, status, finishedAt(sort: Desc)])
  @@index([category, startedAt(sort: Desc)])
  @@map("pipeline_runs")
}

/// Per-game outcome rows for a recompute cycle — the honest completeness
/// record behind "12 of 14 games current".
model PipelineRunGame {
  id            String             @id @default(uuid())
  pipelineRunId String             @map("pipeline_run_id")
  gameId        String             @map("game_id")
  status        PipelineGameStatus
  projectedCount Int               @default(0) @map("projected_count")
  errorMessage  String?            @map("error_message")
  finishedAt    DateTime?          @map("finished_at")
  createdAt     DateTime           @default(now()) @map("created_at")

  pipelineRun PipelineRun @relation(fields: [pipelineRunId], references: [id], onDelete: Cascade)
  game        Game        @relation(fields: [gameId], references: [id])

  @@unique([pipelineRunId, gameId])
  @@index([gameId])
  @@map("pipeline_run_games")
}
```

### Updated models

```prisma
model IngestRun {
  // ... existing fields unchanged ...
  pipelineRunId String? @map("pipeline_run_id") // link to the owning cycle; null for standalone runs
  @@index([pipelineRunId])
}

model Game {
  // ... existing fields unchanged ...
  pipelineRunGames PipelineRunGame[]
}

enum SnapshotTrigger {
  appeared
  state_changed
  decision
  final_pre_kickoff // added: captured by the scheduled price path inside the final window
}
```

### Raw SQL constructs

```sql
-- At most one final pre-kickoff snapshot per contract (RD-19 idempotence).
create unique index recommendation_snapshots_final_one_per_contract
  on recommendation_snapshots (contract_id)
  where trigger = 'final_pre_kickoff';
```

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| `stale` | no | displayed projection's `informationCutoff` vs max `knownAt` of RD-22 fact groups for the game | One batched query per slate read; no N+1, no column, no job |
| `predates inactives` | no | `now` vs `kickoffAt − INACTIVES_LEAD_MINUTES` | Time-based and permanent per game (RD-23) |
| Projection / price age | no | `computedAt` / `observedAt` vs now at serialization | Server-formatted (`2d 4h`); client renders strings verbatim |
| Health signal state | no | run records + stored schedule + configured bounds | RD-25 precedence; derived per request |
| Edge, recommendation | no | (unchanged from Pitch 4) | Untouched by this pitch |

## Authorization and access control

- `GET /health` (page) and its read: `requireAdmin()` — existing gating, unchanged. Viewers get no nav item, no route, no payload fields; absence is structural.
- Slate and contract detail currency fields (ages, cutoff, both staleness states): every authenticated user — shared disclosure (RD-P5). No operational detail (job names, failure reasons) appears in shared payloads.
- `/api/pipeline/*`: scheduler bearer token (RD-20), not a user session. The token can trigger a price refresh, report a keepalive, and nothing else — it cannot read slate data, cannot write decisions, and has no role. Constant-time comparison; `401 unauthorized` on missing/mismatched token; `503` (`upstream_unavailable` shape) if the server has no token configured, so a misconfigured deploy is loud.
- The Python runtime keeps its service-role direct connection for ingest, recompute, and `PipelineRun` writes — sanctioned because it never serves a user request. It gains **no** Kalshi credential and **no** route access.
- No client-supplied job results anywhere: health derives from rows written by the Python runtime and the token-authenticated pipeline routes only.

## Route handlers and API surface

### `POST /api/pipeline/price-refresh` — scheduler token

Scheduled price maintenance. Reuses `runMarketSync()` (coalescing, rate-limit budget, degraded mode all unchanged), after a server-side cadence decision (RD-Q5): if no scheduled game exists within the lookahead → no-op `{ skipped: "not_expected" }` without calling Kalshi; if in-week (no game today) and the last sync is younger than the in-week cadence → no-op `{ skipped: "coalesced" }`. Then runs the final-snapshot capture pass (RD-19) for contracts whose games are inside `FINAL_SNAPSHOT_WINDOW_MINUTES`.

```typescript
export type PipelinePriceRefreshResult = {
  skipped?: "not_expected" | "coalesced";
  sync?: { status: MarketSyncStatus; observationsWritten: number; degraded: boolean };
  finalSnapshotsCaptured: number; // 0 outside the final window; idempotent under re-invocation
};
```

Side effects: `MarketSyncRun` + `PriceObservation` rows (existing paths); `RecommendationSnapshot` rows with trigger `final_pre_kickoff`. A Kalshi outage is the existing degraded mode — recorded on the run, never a 5xx.

### `POST /api/pipeline/keepalive` — scheduler token

Records the keepalive action as a `PipelineRun` (category `keepalive`, immediately terminal).

```typescript
export type PipelineKeepaliveInput = { invocationId: string; commitSha: string; actedAt: string };
export type PipelineKeepaliveResult = { recorded: true; nextRequiredBy: string }; // actedAt + 60d
```

Duplicate `invocationId` upserts (one logical action, one row). The commit SHA is folded into the stored `invocationId` as `{workflowRunId}:{sha}` rather than given a dedicated column — the keepalive row exists for last-acted/next-required-by derivation, and the SHA is diagnostic detail, not queryable state.

### `GET /api/slate` and the detail read — shared (changed shape)

No new route; the existing slate/detail payloads gain the staleness object and ages (§ UI data contracts). The existing `POST /api/prices/refresh` (session-authed, view-driven) is unchanged.

### Health read — server component only

No `/api/health` route is added; the page reads through `readHealthSignals()` in the server component as today, now querying run records. (The api-conventions file names `GET /api/health` as an aggregate; no client consumer exists, so no route ships — adding one is a two-line change if a later pitch needs it.)

## Validation rules

| Surface | Rule | Error |
| ------- | ---- | ----- |
| `/api/pipeline/*` | Bearer token present and equal (constant-time) to `PIPELINE_SCHEDULER_TOKEN` | `401 unauthorized` |
| `/api/pipeline/*` | Token configured server-side | `503 upstream_unavailable` ("scheduler token not configured") |
| `/api/pipeline/keepalive` | `invocationId` non-empty string ≤ 128 chars; `commitSha` matches `^[0-9a-f]{7,40}$`; `actedAt` valid ISO 8601 not in the future (>5m skew) | `400 validation_error` |
| `/api/pipeline/keepalive` | Duplicate `invocationId` | `200` returning the existing row (idempotent, not an error) |
| Python cycle runner | A required source failing marks the cycle `failed`; the remaining sources still run (maximum information, honest aggregate) | recorded, exit ≠ 0 |
| Python cycle runner | Live-observed facts record `knownAt` = observation time, `knownAtReconstructed = false`; historical `knownAt` values are never overwritten by a re-run (existing upsert keys guarantee this; asserted by tests) | blocking test |
| Slate read | Staleness computation failure is a read failure — a row never renders with silently absent staleness | existing error boundary |

Never leak: DSNs, tokens, workflow names, stack traces — `PipelineRun.errorMessage` is sanitized through the existing `sanitize_error` path on the Python side and written as category-level text on the TS side.

## UI data contracts

```typescript
export type StalenessDto = {
  /** RD-22: ingested game-scoped facts postdate the displayed projection's cutoff. */
  isStale: boolean;
  /** RD-23: the game is past kickoff − INACTIVES_LEAD_MINUTES. Permanent per game this version. */
  predatesInactives: boolean;
  /** Absolute expected-inactives instant for the detail sentence. Null when not yet applicable. */
  inactivesExpectedAt: string | null;
};

// SlateRowDto additions (nullable exactly when the projection/price is absent):
//   staleness: StalenessDto | null;   // null iff no projection — staleness qualifies a projection
//   projectionAge: string | null;     // server-formatted: "38m", "6h", "2d 4h"
//   priceAge: string | null;
// ContractDetailDto inherits all of the above; its Currency block additionally
// renders informationCutoff + modelVersion (fields that already exist).

export type HealthSignalDto = {
  key: "ingest" | "recompute" | "price_refresh";
  label: string;
  state: "ok" | "running" | "late" | "failed" | "never_run" | "not_expected";
  lastSuccessAt: string | null; // absolute, with timezone; null when none exists
  lastSuccessAge: string | null;
  expectedWithin: string | null; // human sentence from config; null when not_expected
  lastAttemptAt: string | null; // shown when it differs from last success
  lastAttemptOutcome: "succeeded" | "failed" | "incomplete" | "running" | null;
  /** Ingest only; present when any source is non-ok. */
  sources?: Array<{ name: string; required: boolean; state: "ok" | "degraded" | "failed"; finishedAt: string | null }>;
  /** Recompute only; present when the latest cycle is incomplete. */
  games?: { currentCount: number; totalCount: number; lagging: Array<{ label: string; kickoffAt: string; reason: string }> };
};

export type HealthDto = {
  signals: HealthSignalDto[];
  offseason: null | {
    dormantCopy: string;
    keepalive: { lastActedAt: string | null; lastActedAge: string | null; nextRequiredBy: string | null; overdue: boolean };
  };
};
```

`staleness: null` (no projection) and `staleness.isStale: false` are different states, exactly as `modelProbability: null` vs a number. Field names are identical across slate and detail. Nothing in any DTO names a workflow, a token, or a connection.

## Python runtime changes

- **`sightline-ingest cycle --scope in-week --invocation-id <id>`** — new CLI: creates the `PipelineRun` (`running`), runs the registered live datasets in order (RD-26) for the current season window, each through the existing per-dataset path (writing `IngestRun` rows linked via `pipelineRunId`), then marks the cycle `succeeded`/`failed`. Re-running an overlapping window is a no-op by existing idempotence (RD-P2). Exit code mirrors the recorded status.
- **`sightline-model project`** gains `--games <ids…>` scoping and `--invocation-id`: the nightly run projects all upcoming contract-listed games; the game-day dispatcher selects games with `kickoffAt ∈ (now, now + GAMEDAY_RECOMPUTE_WINDOW_MINUTES]` at evaluation time (RD-Q12) and projects only those. Per-game outcomes are recorded as `PipelineRunGame` rows; one game failing fails that row, not the cycle's other games (`failed` cycle only if any game failed — partial is disclosed, not aggregated away, RD-P7).
- The recompute keeps its per-game transaction (a failed game rolls back only itself); the cutoff for a scheduled run is `now` at cycle start, giving each projection an honest `informationCutoff` ≥ every fact the cycle's ingest wrote.
- **Nothing new reads `price_observations` or `recommendation_snapshots`** — the import-graph test extends to the new modules. No Kalshi credential, no HTTP client, no migration appears anywhere in the Python runtime.

## Scheduled workflows

| Workflow | Cron (UTC) | Does | Auth |
| -------- | ---------- | ---- | ---- |
| `pipeline-nightly.yml` | `0 9 * * *` (≈4/5am ET) | `sightline-ingest cycle --scope in-week` then `sightline-model project --invocation-id $GITHUB_RUN_ID`; exits immediately (no run rows) when no game is inside the lookahead | `PIPELINE_DATABASE_URL` (direct, service-role) |
| `pipeline-gameday.yml` | `*/30 * * * *` | Dispatcher: game-scoped context/schedule/weather ingest + `sightline-model project --games …` for games entering their window; writes nothing when it selects nothing (RD-24) | same |
| `pipeline-prices.yml` | `*/15 * * * *` | `curl` `POST /api/pipeline/price-refresh`; the route decides not-expected / in-week / game-day cadence server-side | `PIPELINE_SCHEDULER_TOKEN` |
| `keepalive.yml` | `0 8 1 * *` (monthly) | Commits `.github/keepalive` (date stamp) with `GITHUB_TOKEN` (`contents: write`, no workflow-trigger loops, RD-27), then `curl` `POST /api/pipeline/keepalive` | `GITHUB_TOKEN` + `PIPELINE_SCHEDULER_TOKEN` |

All four carry `workflow_dispatch` for the runbook's manual re-runs, and `concurrency` groups (per workflow, `cancel-in-progress: false`) so a delayed run and its successor serialize rather than overlap. Duplicate delivery is additionally safe end-to-end: ingest is idempotent, projections upsert on their natural key, `PipelineRun` upserts on `(category, invocationId)`, and final snapshots are unique per contract.

## Testing strategy

Priorities follow CLAUDE.md → Testing. All named tests are required; GIVEN/WHEN/THEN in the test files.

1. **Temporal integrity (adversarial, first).** Live cycle ingest records observed `knownAt` (not reconstructed) for newly observed facts; re-running a cycle over an already-ingested window changes no existing `knownAt` (construct the overwrite attempt; prove it is blocked by the upsert keys). A projection recomputed by the scheduled path for a past cutoff is byte-identical to the manual path's output.
2. **Prices never feed projections.** Import-graph test extended over `sightline_ingest.cycle` and the modified `project_live`: no module in the modelling/ingest path imports or queries `price_observations` / `recommendation_snapshots`. Final-snapshot capture lives in TS; assert the Python tree contains no reference to the snapshot table beyond the existing structural test.
3. **Grading and idempotence.** Duplicate scheduled invocation (same `invocationId`) → one `PipelineRun`, zero duplicate ingest rows, zero new projections. Interrupted cycle (kill between sources) → row stays `running`, health reads it `failed` after timeout, never `succeeded`; re-run completes and records a fresh run. Final-snapshot capture invoked twice in the window → one row per contract. Empty-data cycle → `succeeded`.
4. **Staleness derivation (unit, exhaustive).** Per-game scoping (a context row for game A never marks game B); each RD-22 fact group triggers; ingest alone does not clear (`knownAt` newer than cutoff stays stale until a recompute's cutoff passes it); predates-inactives boundary crossing at exactly T−90; recompute after the boundary does **not** clear predates-inactives (RD-23); kickoff change moves both boundaries at next evaluation (RD-Q12); no-projection rows carry `staleness: null`.
5. **Health derivation (unit, all six states).** Precedence per RD-25; failed-required vs degraded-optional source aggregation (RD-P7); `running` past timeout reads failed; offseason derivation from schedule (no hardcoded dates); keepalive overdue at exactly last-acted + 60d − safety margin; never-run renders no fabricated timestamp; price signal derives from `MarketSyncRun` including view-driven syncs.
6. **Role enforcement and scheduler auth.** Viewer GET `/health` → server-side reject (existing test extended); `/api/pipeline/*` without token, with wrong token, with token unset server-side → 401/401/503; token grants nothing else (cannot hit `/api/decisions`); shared slate payload for a viewer carries staleness but no operational fields.
7. **Integration.** Slate render with mixed staleness while a `running` recompute row exists (never waits, RD from pitch); Kalshi outage during scheduled refresh → degraded `MarketSyncRun`, projections still render, no snapshot captured with a missing price unless the projection side exists (snapshot columns stay nullable as shipped).

Playwright: slate shows both chips on a seeded stale + past-boundary game and neither on a later game; `/health` renders degraded, offseason, and never-run states from seeded rows; viewer sees no Health nav and is rejected on deep-link.

## Acceptance criteria

Traced to the pitch's Definition of Done and the roadmap's Pitch 5 row (by feature name).

**Staleness Disclosure**
- [ ] Every resolved row with a projection displays its age; cutoff reachable on the row payload and displayed on detail; both independent of price age.
- [ ] Past `kickoffAt − 90m`, a game's contracts display *predates inactives* until kickoff, distinct in tone and copy from *stale*, and never presented as a failure.
- [ ] A game with ingested facts newer than the displayed cutoff shows *stale* in the list view; the chip clears only when a recomputed projection's cutoff demonstrates incorporation — never on ingest alone, never on clock advance.
- [ ] Staleness is scoped per game in both directions (early-game facts/staleness never touch later games); stale contracts remain viewable and ranked normally.
- [ ] A postponed or flexed game follows its updated kickoff for both boundaries at the next evaluation.

**Scheduled pipeline (Historical Data Ingest / Projection Engine / Kalshi Market Sync reuse)**
- [ ] Nightly in-week ingest and recompute run unattended; at least one game-day recomputation per upcoming kickoff window, selected from stored kickoffs at evaluation time (Thursday, international morning, Saturday, Sunday night, Monday: one code path).
- [ ] Re-running any overlapping window creates zero duplicates and changes no facts outside documented correction behavior; duplicate scheduled invocation records one logical cycle.
- [ ] A required-source failure records a failed cycle (no silent gap); an interrupted run never presents as success; a no-new-data run presents as success.
- [ ] Scheduled price maintenance reuses the existing integration inside its rate-limit and degraded-mode boundaries; a Kalshi failure never blocks projection rendering; prices never enter any projection input path.
- [ ] The final pre-kickoff snapshot is captured once per contract inside the final window, and nothing grades or interprets it.

**Pipeline health + keepalive**
- [ ] `/health` (admin-only, server-enforced) shows last successful ingest, recomputation, and price refresh, each moved only by completed successful runs, each visibly warning when older than its configured expected window.
- [ ] All six states render per the design doc; partial ingest/recompute shows per-source / per-game detail, never a green aggregate over a red detail; never-run and offseason are distinct from late/broken.
- [ ] The keepalive commits before the 60-day boundary, cannot trigger other workflows, alters nothing but the marker file, and its last action + next-required-by are visible on `/health` with an overdue caution.
- [ ] The slate never waits on any pipeline work; a delayed or failed cycle leaves the last completed projection visible with honest age and staleness.

### PRD traceability gaps (recorded for the run report, per RD from run instruction)

The PRD directly covers Staleness Disclosure and underlying ingest/projection properties. These shipped behaviors are roadmap-backed only and need PRD acceptance criteria added afterward: recurring in-week ingest/recompute; game-day recomputation per kickoff window; per-game recompute scoping; non-blocking slate behavior; last-success health signals and out-of-bounds warnings; duplicate/interrupted run behavior; offseason schedule survival (keepalive); scheduled price-maintenance ownership; final pre-kickoff snapshot capture.

## Explicit non-goals

**Permanent:** public status page; outbound alerting; log/trace surfaces or CI administration in-product; user-configurable schedules; sportsbook/DFS; viewers trading or credentialed; live in-game updating; streaming/event-bus infrastructure.

**Deferred (do not preclude):** inactives ingest and predates-inactives clearing (**Adjustment Suggestions**); grading, accuracy, timing cost (**Outcome Scoring & Accuracy Surface**); simulation (**Simulation Engine**); recalibration; bankroll/sizing; order placement (**Kalshi Trading**); NBA/WNBA; friend pick sharing.

## Open questions

1. *(inherited, restated)* Edge vs ask-or-midpoint and grading-truth (settlement vs official line) remain resolved-for-now per the Pitch 4 spec (RD-1) and deliberately open respectively; nothing here changes either.
2. *(inherited, restated)* RLS on user-scoped tables remains not-enabled (Pitch 4 RD-16); `PipelineRun` is shared operational data and adds no RLS question.
3. **Non-blocking:** whether the game-day dispatcher should also refresh weather for in-window games every invocation or only when the nightly forecast is older than N hours. Default assumption shipped: every selection (cheap, idempotent, honest).

## Future considerations

- **Adjustment Suggestions** turns *predates inactives* clearable: the staleness module gains one more fact group (inactives ingest state per game) and the detail copy changes — the chip, DTO shape, and per-game scoping are already built for it.
- **Outcome Scoring & Accuracy Surface** grades the `final_pre_kickoff` snapshots this pitch captures; timing cost = decision-time snapshot vs final snapshot, both already stored.
- The `PipelineRun` model accommodates later scheduled categories (settlement ingest) as enum values, not new tables.
