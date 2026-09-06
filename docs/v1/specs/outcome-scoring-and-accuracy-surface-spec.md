---
version: 1.0.0
status: approved
author: Claude (autonomous pipeline), for William Rhodes
last_updated: 2026-08-02
pitch_reference: docs/v1/pitches/outcome-scoring-and-accuracy-surface.md
design_reference: docs/v1/design-docs/outcome-scoring-and-accuracy-surface-design-doc.md
ui_preview_reference: docs/v1/ui/outcome-scoring-and-accuracy-surface-ui-preview.html
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: (milestone created at ticketing time; identifiers recorded in the run progress file)
---

# Outcome Scoring & Accuracy Surface — Technical Specification

Implements the PRD features **Outcome Ingest and Scoring** and **Accuracy and Calibration Surface**, plus the override-performance and timing-cost private layer assigned to this pitch by the roadmap.

## 2. Summary

This feature closes the measurement loop: after games complete, Sightline ingests the two outcome truths — Kalshi settlements and official player statistics — grades everything eligible, and renders the product's primary success measure inside the product.

The core abstraction is that **there are two truths and two graders, split along the existing runtime seam.** Official statistics grade the model, and that grading is a Python batch job writing durable grade rows (`ProjectionGrade`, `ThresholdGrade`) from the corrected official line via the existing `GradingCorpus`. Kalshi settlement grades everything contract-facing — recommendation correctness, decision outcomes, timing cost — and those grades are **computed on read** in TypeScript from three stored facts: the `Outcome` row (settlement), the `final_pre_kickoff` recommendation snapshot, and the decision's own stored snapshot. Nothing contract-facing needs a stored grade because the inputs are already durable and the derivation is trivial; nothing model-facing can be computed on read because it needs the official line, the threshold policy, and the distribution math, all of which are Python-owned. The Python runtime never touches settlement — the `outcomes` table joins `price_observations` and `recommendation_snapshots` on the Python import-graph blocklist.

Working means: a completed game's projections all reach `graded` or an explicit unresolvable status; re-running any ingest or grading step changes nothing; a stat correction regrades affected rows and every aggregate containing them; the accuracy surface renders every figure with its record, population, and both denominators from stored results without ever triggering work in the request path; and a viewer's payload structurally contains no trace of William's decisions.

## 3. Problem

- The app cannot yet say whether a settled contract resolved yes or no — `Contract` has no settlement column, the Kalshi client has no settlement read, and no `Outcome` model exists.
- The app cannot yet say whether any stored projection was right. `PlayerGameStat` holds the official line and `PlayerGameStatCorrection` records corrections, but nothing consumes them; there is no grade anywhere in the schema.
- The reliability curve — the product's primary success measure per the Brief — exists only for backtests (`CalibrationBin` rows keyed to `BacktestRun`). Live deployed performance has no record at all.
- Recommendation snapshots and decisions are being written every week (including `final_pre_kickoff` snapshots since Live Pipeline & Staleness) and none of them can be evaluated. The PRD journeys "Post-Slate Scoring" and "Checking Model Accuracy" are unimplementable.
- Downstream, Probability Recalibration must be fitted against live contract-like calibration evidence, and the paper-to-live gate consumes the market comparison. Neither can be specified until this pitch produces the evidence. This pitch produces it and must not consume it: no correction fitting, no sizing, no gate.

## 4. Scope and non-scope

**In scope**

- `Outcome` model and idempotent Kalshi settlement ingest (TypeScript, machine-triggered, scheduled).
- Python grading job producing `ProjectionGrade` and `ThresholdGrade` rows for completed games, idempotent, correction-aware, recorded as a `grading` pipeline run.
- Stat-correction regrading: a new `PlayerGameStatCorrection` version regrades affected rows and every read-time aggregate reflects it.
- Settlement-change handling: a changed settlement updates the `Outcome` row with provenance, and all read-time contract-facing grades reflect it.
- The shared accuracy surface at `/accuracy`: calibration panel (live + backtest records, ten fixed buckets, two denominators, below-floor treatment), error-vs-baselines panel, market comparison panel with uncertainty interval, population/version/stat/season scope, exclusions disclosure, grading freshness line, year-round availability.
- The admin-only overrides surface at `/accuracy/overrides`: disposition record, agreement table, timing cost, per-decision table.
- Contract detail outcome block.
- Health surface delta: `outcome_ingest` and `grading` signals plus the awaiting-grades count.
- Navigation entry for Accuracy (shared).

**Out of scope**

- Probability recalibration, correction fitting, correction versioning (Bankroll, Sizing & Paper Trading). Producing the curve is in scope; fitting anything to it is a stop-condition breach.
- Position sizing, bankroll, ledgers, P&L, paper or live positions, order placement.
- Suggestion-source analytics and shadow-projection surfaces (Adjustment Suggestions & Source Reliability). Grading is keyed by projection id, so shadows will grade through the same machinery; no surface, chart, or placeholder ships.
- A backtest-run browser. Backtest calibration renders inside `/accuracy` as a labelled record read from existing `CalibrationBin` rows; run configuration detail stays in the CLI.
- Denormalising edge, staleness, or any live-read aggregate into stored columns. The recurring temptation this pitch must resist is a stored "accuracy summary" table; the volumes (thousands of grade rows per season) do not justify one and a stale copy is worse than a slow read.
- Manual result editing. Corrections arrive through ingest; there is no admin form for outcomes.
- In-game or post-kickoff grading displays.

## 5. Core concepts

| Concept | Description |
| ------- | ----------- |
| `Outcome` | The settled result of one Kalshi contract: result (`yes`/`no`/`voided`), settlement time as reported, ingest provenance, and a supersession count for changed settlements. One per contract. **Never read by Python.** |
| `ProjectionGrade` | One graded projection: the official value it was graded against, which stat version supplied it, absolute errors for mean and median, and a status from the unresolvable taxonomy. One per graded projection. Written and updated only by the Python grading job. |
| `ThresholdGrade` | One binary threshold observation derived from one graded projection: threshold, stated probability, binary outcome, threshold source (`policy` or `market`), and the `contractLike` flag. Several per projection; correlated by construction, which is why every aggregate reports both denominators. |
| Graded projection (evaluative unit) | Per `(playerId, gameId, statType, modelVersion)`, the projection with the latest `informationCutoff` at or before kickoff (ties broken by latest `computedAt`). Earlier intra-week revisions are superseded working states and are not graded. |
| Graded recommendation (evaluative unit) | The `final_pre_kickoff` snapshot for a contract. No final snapshot → recommendation outcome is `missing_final_snapshot`, never graded against a substitute. |
| Graded decision (evaluative unit) | The acted-on decision: the latest `Decision` row per contract per user (the one not superseded). Graded against `Outcome` per its own disposition; its stored snapshot supplies the decision-time edge. |
| Timing cost | Read-time derivation: final-state edge minus decision-time edge, both oriented to the decision's side, in probability points. Positive means waiting would have been better. Not stored. |
| Population | `contract_like` (the `is_contract_like` volume-floor function, already in `sightline_model.constants`), `all` (every graded projection), `market_linked` (threshold grades whose threshold came from a listed contract). Selected explicitly, never implied. |
| Record | `live` (grade tables written by this pitch), `backtest` (existing `CalibrationBin`/`BacktestRun` aggregates), `compare` (both, labelled, never merged). |
| Grading freshness | Derived from `PipelineRun` rows (`grading`, `outcome_ingest` categories) plus a count of completed games with ungraded eligible projections. Not stored. |

Distinctions that must survive implementation:

- **Settlement and the official line are two facts.** `Outcome.result` and `PlayerGameStat` values never overwrite each other. A disagreement (settlement implies one side of the threshold, official value the other) is computed on read and displayed as `source_conflict` — both values shown, nothing reconciled.
- **`gradedStatVersion` is provenance, not a cache.** A grade row records which `PlayerGameStat.version` it graded against; a correction bumps the version, and the grading job regrades rows whose `gradedStatVersion` trails the current version. Evidence of the prior grade is the corrections table plus the version fields — grades are updated in place, corrections are append-only.
- **Grades are derived data.** Everything in `ProjectionGrade`/`ThresholdGrade` is recomputable from projections and official stats. Decisions and positions remain the only unreconstructible data; no migration risk attaches to grade tables.
- **Corrected actuals are grading targets, never features.** The grading job reads via `GradingCorpus` (no cutoff, current corrected line) — the sanctioned grading exception. Nothing here widens the feature path.
- **`took`, `faded`, `skipped` are three states; unmarked is the absence of a row** and appears in no override metric.

## 6. States and lifecycle

```prisma
enum OutcomeResult {
  yes
  no
  voided
}

enum ProjectionGradeStatus {
  graded
  missing_official_result   // game complete, no trustworthy PlayerGameStat row for this player-game
  game_never_completed      // game reached cancelled status; terminal
  unsupported_stat_type     // defensive: projection stat outside the gradeable set
}
```

Contract-facing states are **derived at read time**, not stored: `pending` (no `Outcome` row yet), `settled` (`yes`/`no`), `voided`, `missing_final_snapshot` (recommendation/timing only), `source_conflict` (both truths present and implying different sides of the threshold), `unresolved_identity` (contract never resolved to a player — excluded from projection-linked populations and disclosed in the exclusions line).

| From | To | Trigger | Side effects |
| ---- | -- | ------- | ------------ |
| no `Outcome` row | `yes` / `no` / `voided` | settlement ingest finds the market settled | Row created with `settledAt` (as reported), `recordedAt`, `supersededCount = 0` |
| `Outcome(result=X)` | same result | re-ingest, unchanged upstream | No write. Idempotent by comparison, not by error swallowing. |
| `Outcome(result=X)` | different result | Kalshi corrects a settlement | Row updated in place; `supersededCount` incremented; `previousResult` and `previousRecordedAt` set. All read-time recommendation/decision grades reflect the new result immediately. |
| projection, game `completed`, no grade row | `graded` | grading job, official line present | `ProjectionGrade` + `ThresholdGrade` rows written with `gradedStatVersion` |
| projection, game `completed`, no stat row | `missing_official_result` | grading job | Grade row written with status, no values. Revisited every cycle until a stat row appears (then upgraded to `graded`). |
| projection, game `cancelled` | `game_never_completed` | grading job | Terminal status; excluded from every accuracy denominator, counted in exclusions. |
| `graded` at version *n* | `graded` at version *n+1* | `PlayerGameStatCorrection` with a newer version | Grade and threshold rows recomputed and updated in place. Aggregates reflect it on next read — there is no cached aggregate to invalidate. |
| absence of grade rows for a completed game | — | — | The `pending` state. Surfaced via the awaiting-grades health count and the freshness line, never presented as a completed record. |

An interrupted grading run leaves whole games either graded or not (per-game transaction), so partial cycles are visible as a non-zero awaiting-grades count rather than as a half-graded game presented as complete.

## 7. UI integration

The design doc governs appearance and states; this section maps screens to data.

**Screens**

| Screen | Route | Data needed | Actions |
| ------ | ----- | ----------- | ------- |
| Accuracy | `/accuracy` (server component, `requireSession`) | `AccuracyDto` for the parsed scope; role decides serializer | Scope changes via URL query only; no mutations |
| Overrides | `/accuracy/overrides` (server component, `requireAdmin`) | `OverridesDto` for the parsed scope | Row links to contract detail; no mutations |
| Contract detail delta | `/slate/[contractId]` | `OutcomeBlockDto` appended to the existing detail read when the game is complete | none |
| Health delta | `/health` | Two new `HealthSignalDto` entries + awaiting-grades count | none |

**Components** (per design doc inventory): `ReliabilityCurve` is the second sanctioned Recharts wrapper and must copy `DistributionSummary`'s contract — every colour/font/stroke from `useTheme()`, `isAnimationActive={false}`, `role="img"` with the bucket table as its text equivalent, degenerate-data prose fallback. `AccuracyScopeBar`, `SampleSizePair`, `GradeStatusChip` (over `StatusChip`) are new; `EmptyState`, `NumericText`, `HealthStateChip`, disposition treatment are reused.

**Forms and validation**: there are no forms. Scope query parsing falls back to defaults on unrecognized values (user-editable URL, not a contract).

**MUI integration notes**: nav gains `{ label: "Accuracy", href: "/accuracy", adminOnly: false }` in `NavSections.ts`. `/accuracy/overrides` joins the `requireAdmin()` route list in `build-invariants.test.ts`. All new pages export `dynamic = "force-dynamic"` (asserted by the same invariant test). No colour literal outside `src/theme/index.ts` — the curve reads tokens at runtime.

## 8. Data model

**Relationship to existing schema**

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `Outcome` | 1:1 | `Contract` | Settlement for one contract; exists regardless of projection or resolution status |
| `ProjectionGrade` | 1:1 | `Projection` | Grade for one evaluative-unit projection |
| `ThresholdGrade` | N:1 | `Projection` | Threshold observations for one graded projection |
| `ThresholdGrade` | N:0..1 | `Contract` | Set when the threshold came from a listed contract (`market` source) |
| `PipelineRun` | — | — | Gains `outcome_ingest` and `grading` categories |

**New models**

```prisma
enum OutcomeResult {
  yes
  no
  voided
}

enum ProjectionGradeStatus {
  graded
  missing_official_result
  game_never_completed
  unsupported_stat_type
}

enum ThresholdSource {
  policy
  market
}

/// Kalshi settlement for one contract. Market-derived: on the Python import blocklist.
/// Not a bitemporal fact table — it is a measurement record like backtest_runs, and it
/// must never feed a projection, so it carries no validAt/knownAt by design.
model Outcome {
  id                 String        @id @default(uuid())
  contractId         String        @unique @map("contract_id")
  result             OutcomeResult
  settledAt          DateTime?     @map("settled_at")          // as reported by Kalshi; null when not supplied
  recordedAt         DateTime      @map("recorded_at")         // when Sightline ingested it
  rawResult          String        @map("raw_result")          // Kalshi's verbatim result string, for audit
  supersededCount    Int           @default(0) @map("superseded_count")
  previousResult     OutcomeResult? @map("previous_result")
  previousRecordedAt DateTime?     @map("previous_recorded_at")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")

  contract           Contract      @relation(fields: [contractId], references: [id])

  @@index([recordedAt])
  @@map("outcomes")
}

/// Grade for one projection against the official corrected line. Written only by the
/// Python grading job. Derived data: recomputable, updated in place on correction.
model ProjectionGrade {
  id                 String                 @id @default(uuid())
  projectionId       String                 @unique @map("projection_id")
  status             ProjectionGradeStatus
  officialValue      Decimal?               @map("official_value") @db.Decimal(8, 3)
  gradedStatVersion  Int?                   @map("graded_stat_version")
  absErrorMean       Decimal?               @map("abs_error_mean") @db.Decimal(8, 3)
  absErrorMedian     Decimal?               @map("abs_error_median") @db.Decimal(8, 3)
  seasonAvgAbsError  Decimal?               @map("season_avg_abs_error") @db.Decimal(8, 3)
  trailingFiveAbsError Decimal?             @map("trailing_five_abs_error") @db.Decimal(8, 3)
  contractLike       Boolean                @map("contract_like")
  gradedAt           DateTime               @map("graded_at")
  createdAt          DateTime               @default(now()) @map("created_at")
  updatedAt          DateTime               @updatedAt @map("updated_at")

  projection         Projection             @relation(fields: [projectionId], references: [id])

  @@index([status])
  @@index([contractLike])
  @@map("projection_grades")
}

/// One binary threshold observation. Several per projection; correlated by construction.
model ThresholdGrade {
  id                 String          @id @default(uuid())
  projectionId       String          @map("projection_id")
  contractId         String?         @map("contract_id")
  thresholdSource    ThresholdSource @map("threshold_source")
  threshold          Decimal         @map("threshold") @db.Decimal(6, 1)
  statedProbability  Decimal         @map("stated_probability") @db.Decimal(6, 5)
  outcome            Boolean
  contractLike       Boolean         @map("contract_like")
  gradedStatVersion  Int             @map("graded_stat_version")
  gradedAt           DateTime        @map("graded_at")
  createdAt          DateTime        @default(now()) @map("created_at")
  updatedAt          DateTime        @updatedAt @map("updated_at")

  projection         Projection      @relation(fields: [projectionId], references: [id])
  contract           Contract?       @relation(fields: [contractId], references: [id])

  @@unique([projectionId, thresholdSource, threshold])
  @@index([contractId])
  @@map("threshold_grades")
}
```

Baseline errors (`seasonAvgAbsError`, `trailingFiveAbsError`) are stored per grade because the baselines are as-of-cutoff quantities the Python side already computes (`sightline_model.baselines`); recomputing them at read time in TypeScript would duplicate as-of logic across the seam, which is exactly the duplication the two-runtime rule exists to prevent. This is the stated reason the derived-state posture requires.

**Updated models** (new fields/relations only)

```prisma
model Contract {
  outcome         Outcome?
  thresholdGrades ThresholdGrade[]
}

model Projection {
  grade           ProjectionGrade?
  thresholdGrades ThresholdGrade[]
}

enum PipelineJobCategory {
  ingest
  recompute
  keepalive
  outcome_ingest   // new — TS settlement ingest
  grading          // new — Python grading job
}
```

**Raw SQL constructs** (appended to the generated migration, per repo convention)

```sql
-- A settled outcome is immutable except through supersession: enforce that a
-- superseded row retains its provenance.
alter table outcomes add constraint outcomes_supersession_provenance
  check (superseded_count = 0 or previous_result is not null);

-- Threshold grades derived from a market threshold must name their contract.
alter table threshold_grades add constraint threshold_grades_market_has_contract
  check (threshold_source <> 'market' or contract_id is not null);

-- A graded grade carries its values; an unresolvable one carries none.
alter table projection_grades add constraint projection_grades_status_values
  check (
    (status = 'graded' and official_value is not null and graded_stat_version is not null)
    or (status <> 'graded' and official_value is null)
  );
```

**Derived fields**

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Recommendation correctness | no | final snapshot `side` + `Outcome.result` | `correct` when side matches result; voided → excluded |
| Decision outcome | no | acted-on `Decision.disposition` + `snapshotSide` + `Outcome.result` | took: won if snapshot side matches result; faded: won if the *other* side matches (the side he preferred); skipped: no win/loss, settlement shown descriptively |
| Timing cost | no | decision snapshot vs `final_pre_kickoff` snapshot, oriented to the decision's side | Positive = final edge exceeded decision edge. Unavailable when no final snapshot, when voided, or when the final observation lacks the needed side |
| Live calibration buckets | no | `GROUP BY width_bucket` over `ThresholdGrade` | Ten fixed buckets matching `binIndex` 0–9; both denominators per bucket; `belowFloor` = obs < 1,000 |
| Error panel | no | aggregates over `ProjectionGrade` | MAE/RMSE model vs both baselines; median disclosed |
| Market comparison | no | `final_pre_kickoff` snapshots + `Outcome` | Model Brier vs market Brier (implied prob from executable ask on the snapshot side), mean edge with 95% normal-approximation interval |
| Grading freshness | no | `PipelineRun` + count of completed games with ungraded eligible projections | Shared line shows graded-through week + last cycle; health shows signal states |
| `source_conflict` | no | official value vs threshold vs settlement side | Only when both truths present and disagreeing |
| Backtest record | stored (existing) | `CalibrationBin`, `BacktestRun.aggregates` | Read-only here; era split disclosed whenever rendered |

## 9. Authorization and access control

| Resource / surface | Read | Write |
| ------------------ | ---- | ----- |
| `/accuracy` and its DTO | any authenticated user (`requireSession`); serializer selected by role | — |
| `/accuracy/overrides` and its DTO | admin only (`requireAdmin`, `forbidden()` in place) | — |
| Contract detail outcome block | shared portion any authenticated user; decision lines admin serializer only | — |
| `/health` delta | admin only (existing gate) | — |
| `Outcome`, grade tables | server-side reads only; no client access | settlement ingest route (machine token); Python grading job (service-role, direct connection) |
| `POST /api/pipeline/outcome-ingest` | — | `verifyPipelineToken` bearer only |

- The viewer serializer for `/accuracy` **never queries the `decisions` table**. Private keys are structurally absent, following `readSlate(role)`. No count, label, or filter in a viewer payload may be derived from decisions.
- `/accuracy/overrides` is added to the hardcoded admin-route list in `build-invariants.test.ts`.
- RLS remains unenabled (inherited open posture, restated below); server-side checks are the mechanism. The Python grading job connects with the service-role credential over the direct connection, per the existing pipeline pattern, and never serves a request.
- The freshness line (graded-through week, last cycle timestamp) is deliberately shared — it qualifies shared metrics. Signal states, failure detail, and the awaiting count stay admin-only on `/health`.

## 10. Route handlers and API surface

Reads are server components through Prisma — no `/api/accuracy` route exists; the pages read `src/lib/accuracy/*` directly. One new machine route:

```http
POST /api/pipeline/outcome-ingest
Authorization: Bearer <PIPELINE_SCHEDULER_TOKEN>
```

```typescript
export type PipelineOutcomeIngestResult = {
  skipped?: "not_expected" | "coalesced";
  contractsConsidered: number;
  outcomesWritten: number;     // new settlements recorded
  outcomesSuperseded: number;  // settlements that changed
  unavailable: number;         // tickers Kalshi could not report yet
  degraded: boolean;           // Kalshi outage — designed state, 200 not 503
};
```

Behavior:

- `export const dynamic = "force-dynamic"`; token verified with the existing constant-time `verifyPipelineToken`; unconfigured token → 503 `upstream_unavailable` shape, matching the existing pipeline routes.
- Selects contracts whose game `status = completed` (or whose `closeTime` has passed) lacking a settled `Outcome`, plus — on a trailing window of 7 days — contracts with an `Outcome`, to detect settlement changes.
- Fetches settlement via a new Kalshi client read (`getMarketsByTickers`), which must follow the existing client's error vocabulary (`KalshiUnavailableError`, `KalshiRateLimitError`) and must not add any of the forbidden paths (`/orders`, `/portfolio`, `/balance`, `/fills`, `/positions` — asserted by the build invariants).
- Upserts `Outcome` rows: no-op when unchanged; supersession fields set when changed. All writes for one run inside `$transaction` batches per contract page; a Kalshi outage mid-run records what it got and reports `degraded: true`.
- Records a `PipelineRun` with `category: outcome_ingest` via the existing invocation-id idempotency (`@@unique([category, invocationId])` makes duplicate cron delivery a structural no-op).
- Scheduled by a new workflow `.github/workflows/pipeline-outcomes.yml`, `cron: "30 * * * *"` — hourly; the route returns `skipped: "not_expected"` outside the season window, mirroring the price-refresh dormancy rules.

The Python grading job is not a route. It is `uv run sightline-ingest grade --invocation-id …`, wired into `pipeline-nightly.yml` after ingest and recompute, recording `PipelineRun{category: grading}` through the existing `start_pipeline_run`/`finish_pipeline_run` helpers with per-game `record_pipeline_run_game` rows. Per game, grading runs in one transaction: all grade rows for a game commit together or not at all.

Grading job algorithm (per completed game, per evaluative-unit projection):

1. Resolve official value via `GradingCorpus.final_player_stats_for_game` (current corrected line, no cutoff — the sanctioned exception).
2. No stat row → upsert `ProjectionGrade{status: missing_official_result}`. Game cancelled → `game_never_completed` (terminal). Otherwise compute errors (mean and median vs official value) and the two baseline errors via the existing baseline functions at the projection's own `informationCutoff`.
3. Emit `ThresholdGrade` rows: `policy` thresholds from the stored threshold policy version (same generator the backtest uses), and `market` thresholds from `contracts` rows resolved to this player-game-stat (reading `contracts` is permitted; `price_observations`, `recommendation_snapshots`, and `outcomes` are not — the blocklist is extended to enforce the third).
4. `statedProbability` = P(value > threshold) evaluated from the stored distribution (`quantiles`/`pmf`) with the same interpolation the model uses (`sightline_model.distributions`); `outcome` = official value > threshold.
5. Upsert by `(projectionId, thresholdSource, threshold)`; skip when `gradedStatVersion` already equals the current stat version — idempotence is comparison, not error handling. A correction bumps the version and the same upsert path regrades.

## 11. Validation rules

| Surface | Rule | Behavior |
| ------- | ---- | -------- |
| Accuracy scope params | unrecognized `record`/`version`/`population`/`stat`/`season` values | fall back to that control's default; never an error |
| Scope with no data | any combination | designed no-data state per panel; page never 500s (DoD: a period with no settled markets must not fail the surface) |
| Outcome ingest | Kalshi result string not mappable to `yes`/`no`/`voided` | contract counted in `unavailable`, run continues, result string logged in the run's error message — never a fabricated result |
| Outcome ingest | settlement for a contract Sightline never projected or never resolved | `Outcome` written anyway (settlement retention and model grading are separate responsibilities) |
| Outcome ingest | request without valid bearer token | 401 `unauthorized` / 503 when unconfigured, matching existing pipeline routes |
| Grading job | projection whose game is not `completed`/`cancelled` | not eligible; never graded pre-game |
| Grading job | official value present but game later corrected | regrade path only; original projection, snapshots, decisions never mutated |
| Market panel | fewer than 30 graded market-linked observations | insufficient-sample state with running count; no headline edge |
| Calibration bucket | fewer than 1,000 threshold observations | rendered provisional (`belowFloor`), excluded from summary sentences, never hidden |
| Timing cost | no final snapshot, voided outcome, or missing needed book side | `unavailable` with reason; never zero |

Nothing in any response leaks Prisma error text, connection strings, the scheduler token, or anything about the Kalshi signing key.

## 12. UI data contracts

```typescript
export type AccuracyScope = {
  record: "live" | "backtest" | "compare";
  modelVersion: string | "all";           // "all" labelled "All versions (deployed system)"
  population: "contract_like" | "all" | "market_linked";
  statType: StatType | "all";
  season: number | "all";
};

export type CalibrationBucketDto = {
  binIndex: number;                        // 0–9, fixed tenths
  binLow: number; binHigh: number;
  predictedMean: number | null;
  observedRate: number | null;
  thresholdObservations: number;
  projectionCount: number;
  belowFloor: boolean;
};

export type CalibrationSeriesDto = {
  kind: "live" | "backtest";
  label: string;                           // includes both denominators
  brier: number | null;
  thresholdObservations: number;
  projectionCount: number;
  buckets: CalibrationBucketDto[];
  eraDisclosure: string | null;            // backtest only: reanalysis-era split line
};

export type ErrorPanelDto = {
  projectionCount: number;
  model: { mae: number; rmse: number } | null;
  seasonAverage: { mae: number; rmse: number } | null;
  trailingFive: { mae: number; rmse: number } | null;
  medianMae: number | null;                // disclosed, never a baseline head-to-head
};

export type MarketComparisonDto =
  | { state: "insufficient"; graded: number; required: 30 }
  | {
      state: "ready";
      thresholdObservations: number;
      projectionCount: number;
      modelBrier: number;
      marketBrier: number;
      meanEdgePoints: number;              // executable side, at final snapshot
      ci95Low: number; ci95High: number;   // never rendered without these
      midpointEdgePoints: number | null;   // labelled secondary
    };

export type AccuracyDto = {
  scope: AccuracyScope;
  gradedThroughWeek: { season: number; week: number } | null;
  lastGradingCycleAt: string | null;
  gradingDelayed: boolean;
  calibration: CalibrationSeriesDto[];     // one or two entries; compare = two, labelled
  errorPanel: ErrorPanelDto | null;        // null → designed empty state
  market: MarketComparisonDto;
  exclusions: { reason: string; count: number }[];
  availableVersions: string[]; availableSeasons: number[];
  overridesEntry?: { decisionCount: number }; // ADMIN SERIALIZER ONLY — key absent for viewers
};

export type OverrideDecisionRowDto = {
  contractId: string;
  decidedAt: string;
  playerName: string; statType: StatType; threshold: number;
  disposition: "took" | "faded" | "skipped";
  edgeAtDecision: number | null;
  edgeAtFinal: number | null;
  timingCostPoints: number | null;
  timingUnavailableReason: "missing_final_snapshot" | "voided" | "side_unavailable" | null;
  outcome: "won" | "lost" | "voided" | "pending" | "settled_yes" | "settled_no";
  sourcesDisagree: boolean;
};

export type OverridesDto = {
  scope: { statType: StatType | "all"; season: number | "all" };
  tiles: {
    took: { total: number; settled: number; won: number; lost: number; voided: number; pending: number };
    faded: { total: number; settled: number; won: number; lost: number; voided: number; pending: number };
    skipped: { total: number; settledYes: number; settledNo: number; voided: number; pending: number };
  };
  agreement: {
    disposition: "took" | "faded" | "skipped";
    recommended: { count: number; won: number | null };
    notRecommended: { count: number; won: number | null };
  }[];
  timing: {
    medianPoints: number | null; meanPoints: number | null;
    measurable: number; total: number;
    unavailable: { reason: string; count: number }[];
  };
  decisions: OverrideDecisionRowDto[];
};

export type OutcomeBlockDto = {
  officialValue: number | null;
  officialCorrectedAt: string | null;      // latest correction date, when any
  settlement: { result: "yes" | "no" | "voided"; settledAt: string | null } | null;
  projectionGrade: { status: ProjectionGradeStatus; hit: boolean | null; statedProbability: number | null } | null;
  recommendationGrade: "correct" | "incorrect" | "voided" | "missing_final_snapshot" | "pending" | null;
  sourcesDisagree: boolean;
  decision?: { disposition: string; outcome: string };  // ADMIN SERIALIZER ONLY
};
```

Contract rules: `null` and `0` are different states everywhere; every rate travels with its counts in the same object (`SampleSizePair` renders them); `overridesEntry` and `decision` keys are added by the admin serializer and never nulled for viewers; no DTO field is derived from the Kalshi credential or service-role path.

Health DTO: `HealthSignalDto.key` union widens to `"ingest" | "recompute" | "price_refresh" | "outcome_ingest" | "grading"`, and the grading signal gains `awaitingGrades: number` rendered as the sub-line. Existing six-state vocabulary unchanged.

## 13. Testing strategy

Categories follow the repo's risk ranking. All tests co-located per convention; DB-marked pytest for grading; Jest for reads/serializers; Playwright for role enforcement.

**1. Temporal integrity (adversarial)**

- GIVEN a projection and a stat correction landing after grading, WHEN the game is regraded, THEN the projection row, its drivers, its snapshots, and all decisions are byte-identical before and after — only grade rows change.
- GIVEN the grading job's modules, THEN they import `GradingCorpus` (sanctioned) and never `AsOfCorpus` writes — and `verify.py`'s feature-code guard still passes: no feature module gained a grading import.
- GIVEN baseline errors stored on grades, THEN they are computed at the projection's own `informationCutoff` (assert a fixture where a later game would change the baseline if leaked).

**2. Prices never feed projections (structural)**

- Extend `python/tests/test_import_graph.py` `FORBIDDEN` with `"outcome"` table references (`"outcomes"` naming the settlement table) so settlement can never reach either Python package; assert the sweep still covers both packages and now fails on a planted reference.
- `src/lib/pipeline/final-snapshot.ts` remains free of `/outcome/i` (existing capture-only assertion must keep passing — this pitch's code must not touch that module).

**3. Grading and idempotence**

- GIVEN a completed game graded once, WHEN the grading job runs again with nothing changed, THEN zero rows are written or updated (assert by `updatedAt`).
- GIVEN a correction bumping `PlayerGameStat.version`, WHEN grading runs, THEN affected `ProjectionGrade`/`ThresholdGrade` rows carry the new `gradedStatVersion` and recomputed values, and unaffected games' rows are untouched.
- GIVEN settlement ingest re-run against unchanged settlements, THEN no duplicate `Outcome` rows and no updates. GIVEN a changed settlement, THEN supersession fields set and `supersededCount` incremented.
- GIVEN a grading run interrupted mid-game (transaction abort), THEN that game has no partial grade rows and the awaiting-grades count includes it.
- GIVEN a projection whose game never produced a stat line, THEN status `missing_official_result`, never a miss, never silently absent — and it upgrades to `graded` when the line later arrives.

**4. Contract-to-player resolution edges**

- GIVEN a settlement for an unresolved contract, THEN the `Outcome` row is written, no projection grade is fabricated, and the accuracy exclusions line counts it as `unresolved_identity`.
- GIVEN a voided market with decisions logged against it, THEN decision outcomes render `voided`, no win/loss denominator includes them, and timing cost is unavailable with reason `voided`.

**5. Kalshi integration (adversarial)**

- GIVEN Kalshi unavailable mid-ingest, THEN the route returns 200 with `degraded: true`, records what it obtained, and the health signal reflects the last *successful* run only.
- GIVEN an unmappable result string, THEN the contract lands in `unavailable` and no `Outcome` is fabricated.
- GIVEN the new client method, THEN the client still contains none of the forbidden trading paths (existing build invariant re-asserted).

**6. Role enforcement and privacy**

- GIVEN a viewer session, WHEN `/accuracy` is read, THEN the serialized payload contains no `overridesEntry` key, no `decision` key on the outcome block, and — structurally — the viewer read path contains no Prisma query against `decisions` (source assertion, mirroring the slate serializer test).
- GIVEN a viewer deep link to `/accuracy/overrides`, THEN the server responds 403 in place with no partial shell (Playwright, both projects).
- GIVEN the accuracy page for a viewer, THEN the freshness line renders (deliberately shared) and no awaiting-grades count appears.

**7. Read-time derivations**

- Timing-cost orientation: fixtures for took-yes, faded (final snapshot on yes, decision preferring no), edited decision (superseded chain — acted-on decision governs), missing final snapshot, missing book side. Sign convention asserted: final minus decision, positive = waiting better, on the decision's side.
- Recommendation grading: final snapshot side vs each `OutcomeResult`; `missing_final_snapshot` when absent.
- `source_conflict`: official value on one side of threshold, settlement on the other → flag true, both values in the DTO.
- Calibration bucketing: fixed tenths; both denominators; `belowFloor` at exactly 999 vs 1,000; a scope with zero grades renders the empty state, not a curve.
- Market panel: interval always present in `ready` state; `insufficient` below 30; midpoint labelled secondary; population pinned to market-linked regardless of selector.

**8. Health derivation**

- `outcome_ingest`/`grading` signals derive through the existing `deriveSignalState` precedence; awaiting-grades counts completed games with ungraded eligible projections; offseason renders `not_expected`.

## 14. Acceptance criteria

**Outcome Ingest and Scoring**

- [ ] Kalshi settlements ingest on schedule with no manual action; official results continue to ingest via the existing stats dataset; the two sources remain distinct rows with distinct timestamps.
- [ ] Every projection for a completed game reaches `graded` or an explicit unresolvable status; a cancelled game's projections are terminal `game_never_completed`.
- [ ] Re-running settlement ingest, official-result ingest, or grading over unchanged inputs produces no duplicates and no changes.
- [ ] A stat correction regrades affected records and every read-time aggregate reflects it; a changed settlement updates recommendation and decision outcomes on read.
- [ ] Regrading never mutates projections, snapshots, decisions, or model versions.
- [ ] A settlement for a never-projected contract is retained without a fabricated grade; a voided contract receives `voided` and enters no win/loss denominator.
- [ ] An interrupted grading cycle leaves whole games ungraded and visible in the awaiting count, never a partial game presented as graded.

**Accuracy and Calibration Surface**

- [ ] `/accuracy` renders for any authenticated user, year-round, from stored results only — no backtest, recompute, settlement refresh, or grading in the request path.
- [ ] The reliability curve renders ten fixed buckets with observed vs stated rates, both denominators per bucket and per headline, provisional treatment below 1,000 observations, and the bucket table as its accessible text equivalent.
- [ ] Brier renders for the selected population; error panel renders MAE/RMSE vs both baselines mean-vs-mean with the median disclosed; the two panels are never combined.
- [ ] Live, backtest, and compare are labelled records, never merged; the backtest record carries its era-split disclosure.
- [ ] Model versions report separately by default; the combined view is labelled "All versions (deployed system)"; no backfill exists.
- [ ] Population, stat, and season are explicit, URL-carried, and update every denominator together; the market panel pins to market-linked and says so.
- [ ] Market comparison uses the executable price on the snapshot side at the final pre-kickoff observation, never renders without its 95% interval, and shows midpoint only as a labelled secondary.
- [ ] Empty scopes, insufficient samples, and periods with no settled markets render designed states; the page never fails wholesale.
- [ ] Exclusions are counted by reason beside the population.
- [ ] The freshness line shows graded-through week and last cycle, with a delay disclosure when late.

**Override performance and timing cost**

- [ ] `/accuracy/overrides` is admin-only server-side; viewer deep links get 403 in place; viewer accuracy payloads contain no decision-derived keys.
- [ ] Took, faded, skipped remain three states; fades grade on the side preferred; skips show settlement descriptively with no win/loss language; unmarked contracts appear nowhere.
- [ ] Timing cost derives from stored snapshots only, signed positive = waiting better, oriented to the decision's side; unavailable decisions are counted by reason and never zero-filled; edited decisions grade the acted-on state.
- [ ] The selection-bias statement renders always.
- [ ] `sources disagree` renders where the truths conflict, with both values preserved and visible on the contract's outcome block.

**Health**

- [ ] Exactly three additions: `outcome_ingest` signal, `grading` signal, awaiting-grades count. Existing conventions, no controls, no history.

## 15. Explicit non-goals

- **Permanent:** no recalibration fitting, no sizing, no bankroll, no P&L, no order placement, no win-rate leaderboards or social comparison, no analytics workstation (cohort builders, exports, notebooks), no sportsbook/DFS comparison, no in-game grading, no manual outcome editing, no Parquet served through the app.
- **Deferred, do not preclude:** suggestion/shadow grading surfaces (the grading machinery must accept shadow projections by id when they exist); backtest-run browser; recalibration consuming the contract-like live curve; the paper-to-live gate consuming the market comparison; viewer decision logging.

## 16. Open questions

All questions material to this pitch are resolved (see the design doc's "Decisions settled" and the run progress file). Inherited postures restated, not reopened:

1. **RLS on user-scoped tables** — remains unenabled; server-side checks are the mechanism. Grade and outcome tables are shared reference data and would gain nothing from RLS. Non-blocking.
2. **Slate ranking price side** (ask vs midpoint) — owned by Kalshi Market Sync; this pitch consumes stored snapshots as written and takes no position. Non-blocking.
3. **Kalshi settlement API shape** — the client method must be verified against the live API during implementation (result string vocabulary, settlement timestamp field). The ingest is specified to treat unmappable results as `unavailable` precisely so a vocabulary surprise degrades honestly. Non-blocking to design; verify at build.

## 17. Future considerations

- Probability Recalibration will fit against the live contract-like `ThresholdGrade` population; the `(projectionId, thresholdSource, threshold)` key and `contractLike` flag are shaped so that read is a filter, not a migration.
- The paper-to-live gate will consume `MarketComparisonDto` (Brier vs market where both existed) — already computed with the interval the Brief requires.
- Adjustment Suggestions' shadow projections are ordinary `Projection` rows; grading picks them up by id with no machinery change, and suggestion analytics will join grades to suggestions in its own pitch.
- Position grading (Kalshi Trading) will grade against `Outcome.result` — the same settlement fact, deliberately stored once.
