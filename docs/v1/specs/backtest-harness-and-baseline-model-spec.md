---
version: 1.0.0
status: draft
author: Sightline
last_updated: 2026-07-28
pitch_reference: docs/v1/pitches/backtest-harness-and-baseline-model.md
design_reference: n/a — no user-facing surface. The Temporary Backtest Inspection UI and its
  verification-cleanup requirement were withdrawn by the owner on 2026-07-28; verification moves to
  the terminal (see "Operation Surface"). A design doc and UI preview were drafted for the withdrawn
  interface and have been removed from the repository; they were never implemented and this spec
  supersedes them entirely.
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
brief_reference: docs/planning/sightline-product-brief.md
linear_issue: [SIG-### — Backtest Harness & Baseline Model]
---

# Backtest Harness & Baseline Model (Projection Engine · Backtesting Harness)

## Summary

This pitch ships the first complete projection loop: an engine that emits a **probability distribution** for a player-stat-game, a harness that walks history **forward in time** running that engine at a point-in-time cutoff, two permanent naive baselines, calibration over threshold events, durable aggregate results, and local Parquet artefacts. Nothing user-facing ships. Everything runs from the terminal.

The core technical abstraction is that **a projection is a parameterised distribution, and a backtest is a pure function of (corpus state, configuration, model version, code version)**. Both halves of that sentence are load-bearing. Because the projection is a distribution and not a point estimate, any threshold probability is a closed-form evaluation of stored parameters — a new Kalshi threshold costs an arithmetic call, never a re-run. Because the backtest is a pure function, re-running it over an unchanged corpus with an unchanged configuration must produce **byte-identical** artefacts, and the harness proves this by storing digests of what it produced rather than asserting it in prose. The baseline engine draws **no random numbers at all**; determinism here is a property of the computation, not of a lucky seed.

"Working" means five things, in priority order. (1) The leakage suite proves that every prediction was computed from a corpus view whose `known_at` boundary precedes the game, that a deliberately-inserted late fact is unreachable, and that the batched read path added for throughput returns exactly the rows the single-row path returns. (2) A repeat run reproduces all three digests — predictions, aggregates, calibration — and `sightline-backtest verify` exits non-zero if it does not. (3) The model's error is reported against both baselines over an **identical evaluation population**, broken out by stat type, season, and weather era, with the reanalysis era never folded into a headline number. (4) Every excluded, failed, and unprojectable candidate is accounted for by reason code, and no aggregate hides a truncation. (5) The engine never reads a Kalshi price, structurally, and an import-graph test proves it.

---

## Problem

The system cannot yet answer whether its projections are worth anything, and it has no instrument that could tell it.

Concretely, today:

- **The corpus can prove what was knowable, but nothing consumes that proof.** Pitch 1 shipped `AsOfCorpus` and the bitemporal columns behind it. No code path yet turns a cutoff-bounded corpus view into a prediction, so the leakage guarantee is currently a guarantee about an empty set.
- **There is no distribution anywhere in the system.** Kalshi contracts ask binary threshold questions. Without a stored distribution, there is no way to answer "what is P(receiving yards ≥ 74.5)" for a threshold that did not exist when the model ran, and Pitch 4's edge calculation has nothing to compare a price against.
- **There is no floor.** Nothing establishes that a projection beats the arithmetic a person could do in a spreadsheet — a season average and a trailing-five average. Without that floor, every future model improvement is measured against nothing.
- **There is no reproducibility evidence.** The Architecture Doc requires that a projection re-run against the same inputs and cutoff produce the same output, and that a backtest be reproducible from its stored configuration and code version. No stored artefact currently carries enough to check either claim.
- **Trading is gated on a stored `BacktestRun` that does not exist.** Pitch 9 cannot start, and by design should not.

This blocks Pitch 4 (Edge Calculation needs threshold probabilities), Pitch 6 (the Accuracy and Calibration Surface reads `BacktestRun` and `CalibrationBin`), Pitch 7 (the Simulation Engine must beat this baseline to justify itself), and Pitch 9 (trading cannot be enabled without a stored accuracy record). It supports the PRD's **Projection Engine** and **Backtesting Harness** features directly.

---

## Scope and Non-Scope

### In Scope

- **Projection Engine, first implementation.** A closed-form distributional model per supported stat type, reading exclusively through `AsOfCorpus`, emitting distribution parameters, projected value, interval, confidence, drivers, `computedAt`, `informationCutoff`, and `modelVersion`.
- **Threshold probability derivation.** Closed-form `P(X ≥ t)` from stored parameters, for any threshold, without re-running the engine.
- **Backtesting Harness.** Chronological execution over a configurable season range and stat-type subset, with a documented cutoff policy, explicit exclusion accounting, interruption safety, and reproducibility digests.
- **Season-average baseline** and **trailing-five baseline**, both point-in-time, both permanent.
- **Calibration computation** over threshold events, with fixed bins, a reporting floor, and both observation and projection counts retained.
- **Durable aggregates.** New Prisma models `BacktestRun` and `CalibrationBin`, written by the Python runtime.
- **Local Parquet artefacts** for per-prediction, per-threshold, per-exclusion, and per-prior output.
- **Batched as-of reads.** New batch methods on `AsOfCorpus` carrying the identical cutoff predicate, added because per-prediction round trips do not finish a five-season run in a tolerable time.
- **Terminal verification surface.** `sightline-backtest` subcommands — `run`, `show`, `calibration`, `predictions`, `explain`, `exclusions`, `thresholds`, `verify` — covering every inspection requirement the withdrawn UI carried.
- **Runbook** at `docs/v1/runbooks/backtest.md`.

### Out of Scope

- **Any user interface.** No Next.js route, no React component, no HTML report, no local viewer, no dev server. The owner withdrew the Temporary Backtest Inspection UI and its cleanup step on 2026-07-28; the verification requirements it carried are re-homed to the CLI, one command per requirement, and are listed in Acceptance Criteria.
- **Historical Data Ingest** (Pitch 1). This spec consumes the corpus and extends the as-of layer with batch reads. It does not change reconstruction policy, identity resolution, or weather acquisition.
- **Kalshi Market Sync** (Pitch 4). No contracts, prices, settlement, or market discovery. The engine has no notion of a market.
- **Edge Calculation and Recommendation** (Pitch 4). Threshold probabilities are produced; nothing compares them to a price.
- **`Projection` and `ProjectionDriver` tables.** Live projection storage lands with Pitch 4, which is the first pitch with something to store projections *for*. This pitch fixes the projection's **shape** as a dataclass and a Parquet schema, and Pitch 4 maps it to the Prisma model.
- **Accuracy and Calibration Surface** (Pitch 6). This pitch writes what that surface reads. It renders nothing.
- **Simulation Engine** (Pitch 7). No joint game simulation, play-volume model, usage allocation, efficiency layer, teammate correlation, or Monte Carlo.
- **Usage redistribution** when a teammate is inactive (Pitches 7–8).
- **Adjustment Suggestions**, shadow projections, source reliability (Pitch 8).
- **Scheduled execution.** Backtests run locally, manually. GitHub Actions scheduling is Pitch 5 and never runs a backtest.
- **Hyperparameter search** as a product feature, a model registry, an experiment platform, or a feature store.

### Named creep temptations (explicitly excluded)

| Temptation | Why it is excluded |
| ---------- | ------------------ |
| Storing per-prediction rows in Postgres "so the app can query them" | Millions of rows in the application's relational path. Parquet is the decided home; only aggregates are durable. |
| A `Projection` table now, "since we're here" | Pitch 4 owns live projection storage. An unused table invites a second write path before the first consumer exists. |
| Giving the baselines a distribution so they get a Brier score | Inventing a distribution for a point estimate is a modelling decision this pitch did not scope. Baselines are compared on error; see Resolved Decisions. |
| A `--resume` flag for interrupted runs | An interrupted run is discarded and re-run. Partial-result resumption is where "presented as complete" bugs live. |
| Tuning the baseline until it wins | The baseline exists to establish a floor and validate the harness. Feature experimentation here is Pitch 7 wearing a disguise. |
| Adding a fourth or fifth baseline | Two are specified. A third is a modelling opinion, not a harness requirement. |

---

## Core Concepts

| Concept | Description |
| ------- | ----------- |
| `StatType` | The unit of prediction. Six values ship: `passing_yards`, `rushing_yards`, `receiving_yards`, `receptions`, `rushing_tds`, `receiving_tds`. Grouped into two **families** by distributional treatment. |
| Stat family | `continuous_nonneg` (the three yardage types) and `count` (receptions and both TD types). A family determines the distribution, the threshold grid, and the confidence constants. Adding a stat type to an existing family is a registry entry, not a code change. |
| `ProjectionResult` | One player, one stat type, one game, one model version, one information cutoff. Carries distribution parameters, projected value, interval, confidence, drivers, and provenance. The Parquet row and the future `Projection` row are both projections of this object. |
| `DistributionKind` | `zero_inflated_lognormal` (continuous family) or `negative_binomial` (count family). Determines how parameters are interpreted and how `P(X ≥ t)` is evaluated. |
| Distribution parameters | The canonical representation. `zero_inflated_lognormal`: `p_zero`, `mu`, `sigma`. `negative_binomial`: `r`, `p`. Threshold probabilities are **always** evaluated from these, never interpolated from the quantile grid. |
| Quantile grid | A fixed nine-point grid (p05, p10, p25, p50, p75, p90, p95, plus mean and mass-below-zero) emitted for display and for the "impossible output" detector. **Display and diagnostics only.** It is never the source of a probability. |
| `informationCutoff` | The as-of timestamp the projection was computed against. Derived by the harness's cutoff policy, never by the model. |
| `computedAt` | Wall-clock time the projection was produced. Distinct from `informationCutoff` and **excluded from every digest**. |
| `n_eff` | Effective eligible history: the count of the player's prior games, visible at the cutoff, that carry a non-null value for the stat's family. Drives shrinkage and confidence. |
| Prior | A per-`(season, stat_type, position)` distribution fitted **only from seasons strictly before that season**. Walk-forward by construction; cached and re-derivable. |
| Season-average baseline | Mean of the player's eligible prior games **in the same season**, visible at the cutoff. Undefined before the player's first eligible game of that season. |
| Trailing-five baseline | Mean of up to five most recent eligible prior games, visible at the cutoff. **May cross a season boundary.** Requires at least one. |
| Comparison population | Predictions where the model **and** both baselines all produced a value. Every model-vs-baseline error figure is computed over exactly this set. |
| Model-only population | Every successful model projection, including those where a baseline was undefined. Reported alongside, never merged. |
| Threshold observation | One `(prediction, threshold)` pair with a stated probability and a binary outcome. Several per prediction; correlated by construction. |
| Reporting floor | 1,000 threshold observations per calibration bin. Below it, a bin is flagged `below_floor` and excluded from any summary claim, never hidden. |
| Weather era | `archived_forecast` (2021+) or `reanalysis` (pre-2021), taken from `GameWeather.era` when visible at the cutoff, otherwise from the season rule. Every aggregate is broken out by it. |
| Run digest | Three BLAKE2b digests over canonically-serialised artefacts: `predictionsDigest`, `aggregateDigest`, `calibrationDigest`. The reproducibility claim is these three strings. |
| Corpus digest | A digest over the corpus state a run read: per-fact-table row counts and max `known_at` within scope, plus the set of contributing `IngestRun` ids. Makes "the same stored corpus state" a checkable condition rather than an assumption. |
| `EvaluationWindow` | `development`, `validation`, or `holdout`. Recorded per run so selection pressure against a reporting period is countable rather than invisible. |

### Distinctions to preserve

- **`computedAt` and `informationCutoff` are two timestamps.** The first is excluded from digests; the second is part of the computation's identity.
- **`validAt` and `knownAt` are two timestamps** and belong to Pitch 1. This pitch never writes a fact table.
- **Distribution parameters and the quantile grid are not interchangeable.** Parameters are canonical; the grid is derived and display-only. A threshold probability read off the grid is a defect.
- **The comparison population and the model-only population are two numbers.** Reporting one as the other is the exact no-go about excluding difficult cases from one series and not another.
- **Threshold-observation count and projection count are two sample sizes.** A bin of 28,440 threshold observations from 12,208 projections has an effective sample nearer the second.
- **An unprojectable candidate and an excluded candidate are different.** The engine declining (`insufficient_history`) is a modelled outcome with a reason code; the harness excluding (`no_actual_stat_line`) is a population decision. Both are retained; neither is silent.
- **The baseline model draws no random numbers.** `seed` is recorded and asserted unused (`rngDraws = 0`). Pitch 7 will need it; this pitch must not depend on it.

### Ownership

Every entity introduced here is **shared reference data**. `BacktestRun` and `CalibrationBin` have no `userId` and never will. There is no per-user partition, no tenant column, and no row-level isolation on these tables. Parquet artefacts are local files on the operator's disk, git-ignored, never served.

---

## States and Lifecycle

### Enums

```prisma
enum StatType {
  passing_yards
  rushing_yards
  receiving_yards
  receptions
  rushing_tds
  receiving_tds
}

enum BacktestStatus {
  running     // started; artefacts incomplete; never readable as a result
  completed   // finished; manifest written; digests computed; _COMPLETE marker present
  failed      // raised and recorded; artefacts retained for diagnosis
  interrupted // SIGINT/SIGTERM; artefacts retained; never a result
}

enum EvaluationWindow {
  development
  validation
  holdout
}
```

`Confidence` (`high` | `medium` | `low`) and `DistributionKind` (`zero_inflated_lognormal` | `negative_binomial`) are **Python-side and Parquet-side vocabularies in this pitch**. They become Prisma enums when Pitch 4 introduces the `Projection` table, and Pitch 4 **must** reuse these exact values rather than mint new ones.

### Backtest run lifecycle

| From | To | Trigger | Side effects |
| ---- | -- | ------- | ------------ |
| — | `running` | `sightline-backtest run` starts | `BacktestRun` row inserted with config, `modelVersion`, `codeVersion`, `engineConfigDigest`, `corpusDigest`, `seed`, `startedAt`. Artefact directory created. **No `_COMPLETE` marker.** |
| `running` | `completed` | Every scheduled game processed and aggregates written | Parquet datasets flushed and closed → aggregates computed → `CalibrationBin` rows inserted → digests computed → `manifest.json` written → `_COMPLETE` marker written → `BacktestRun` updated to `completed` with `finishedAt`, counts, aggregates, digests. **In that order.** |
| `running` | `failed` | Unhandled exception | `BacktestRun.status = failed`, sanitized `errorMessage`, `finishedAt` set. Artefacts retained. No `CalibrationBin` rows. No `_COMPLETE`. |
| `running` | `interrupted` | SIGINT / SIGTERM | Same as `failed` with `status = interrupted`. The signal handler must complete the status write before exiting. |
| `running` | `running` (stale) | Process killed uncatchably | The row remains `running` forever. This is correct: an abandoned run is not a result. `show`/`verify` refuse it. A `--reap` flag on `run` may mark rows older than 24h as `interrupted`; it never marks them `completed`. |
| `completed` | — | — | **Terminal and immutable.** A completed run is never mutated, never recomputed in place, and never deleted by tooling. Re-running the same configuration creates a **new** run; experiment history is preserved by design. |

Any status other than `completed` makes a run unreadable as a result: `show`, `calibration`, and `predictions` print the status band and the partial counts, and exit non-zero with `--strict`.

### Per-candidate lifecycle

Every `(game, player, stat_type)` candidate reaches exactly one terminal state, and all four are written to artefacts.

| State | Meaning | Written to |
| ----- | ------- | ---------- |
| `projected` | The engine produced a distribution | `predictions/`, plus `thresholds/` rows |
| `unprojectable` | The engine declined — `insufficient_history` (zero eligible prior games) | `exclusions/` with `stage = engine` |
| `excluded` | The harness removed it from a population — `no_actual_stat_line`, `player_unresolved`, `baseline_unavailable`, `corpus_gap_weather`, `cutoff_after_kickoff` | `exclusions/` with `stage = harness` |
| `failed` | The harness raised on this candidate — `harness_error` | `exclusions/` with `stage = harness`, plus the sanitized exception type |

`baseline_unavailable` is a **population** exclusion, not a candidate exclusion: the prediction stays in `predictions/` and in the model-only population, and is absent only from the comparison population. The exclusions dataset records it as such so the two counts reconcile exactly.

---

## Determinism contract

The user-facing requirement is that a run repeated over the same corpus reproduces its numbers. That requirement is only meaningful if every source of nondeterminism is named and closed. This section is normative.

### D1 — No randomness

The baseline engine is closed-form. It calls no RNG, performs no sampling, and does no Monte Carlo. `BacktestRun.rngDraws` is written as `0` and a test asserts it. `seed` is recorded for forward compatibility with Pitch 7 and **must not** influence any value this pitch produces; a test runs the same configuration under two different seeds and asserts identical digests.

### D2 — Deterministic iteration order

- Games are processed ordered by `(kickoff_at ASC, game_id ASC)` — the tiebreaker is required because kickoff times collide constantly.
- Candidates within a game are ordered by `(player_id ASC, stat_type ASC)` using the enum's declaration order, not the string ordering of the locale.
- Thresholds within a prediction follow the grid's declared order.
- Parquet row order is the iteration order; parts are written sequentially and named `part-00000.parquet` upward.

### D3 — Deterministic arithmetic

- All model arithmetic is float64 NumPy. Float64 operations are deterministic for a fixed order of operations; the order is fixed by D2.
- Aggregates are **not** accumulated in streaming order. Each metric is computed by reading the finished Parquet dataset, sorting by the canonical key, and reducing with `math.fsum` over the sorted array. This makes aggregates invariant to chunking, batching, and any future parallelism.
- Every persisted numeric is quantised before it is written: `ROUND_HALF_EVEN` to the decimal places declared in the artefact schema. Digests are computed over the **quantised** values, so a difference below the quantum cannot flip a digest and a difference above it always does.
- No `set` or `dict` iteration is permitted to influence output ordering. Where a set is used for membership, the emitted order comes from a sorted list.

### D4 — Deterministic inputs

- Every read goes through `AsOfCorpus` bound to the candidate's `informationCutoff`. SQL carries `ORDER BY` on a unique key wherever the result feeds computation; an unordered result set is treated as a defect even when the values are aggregated.
- Priors are fitted per `(season, stat_type, position)` from seasons strictly earlier, and the fitted parameters are **written to `priors/`** so a run's priors are reproducible without re-fitting and inspectable without re-running.
- `corpusDigest` pins the corpus state. A repeat run whose `corpusDigest` differs is not a reproducibility failure — it is a different experiment, and `verify` says so in those words rather than reporting a mismatch.

### D5 — Values excluded from digests

`computedAt`, `startedAt`, `finishedAt`, `duration`, `artifactPath`, Parquet file metadata, and the run id itself are excluded. Digests cover the **content** of predictions, aggregates, and calibration bins only.

### D6 — What `verify` asserts

`sightline-backtest verify <run> [--against <run>]` recomputes from raw artefacts and exits non-zero on any failure:

| Assertion | Failure meaning |
| --------- | --------------- |
| Recomputed aggregates equal stored `aggregates` | The stored summary and the raw rows disagree |
| Recomputed calibration bins equal stored `CalibrationBin` rows | Same, for calibration |
| All three digests match `--against` run's digests | Reproducibility failure — the headline check |
| `corpusDigest` and `engineConfigDigest` match `--against` | Not a failure; reported as "different experiment", exit 0 with a notice |
| Every prediction has `informationCutoff < kickoff_known_at_cutoff` and `< games.kickoff_at` | Temporal integrity failure — blocking |
| Every continuous prediction has `mass_below_zero == 0` | Impossible distribution output |
| Comparison population identical across model and both baselines | Incompatible comparison |
| `predictions + exclusions == candidates` | Unaccounted candidates |
| `rngDraws == 0` | The model acquired randomness |

---

## Data Model

Prisma remains the single source of schema truth. The Python runtime writes these tables over the direct connection and never migrates them.

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `BacktestRun` | 1 → many | `CalibrationBin` | A run's reliability points; cascade-deleted with the run |
| `BacktestRun` | reads | `Game`, `PlayerGameStat`, `PlayerGameContext`, `GameWeather`, `GameScheduleRevision` | Through `AsOfCorpus` only |
| `BacktestRun` | reads | `PlayerGameStat` (+ corrections) | Through `GradingCorpus` only, for actuals |
| `BacktestRun` | records | `IngestRun` ids | Via `corpusDigest`, so a run's corpus provenance is traceable |
| `CalibrationBin` | consumed by | Pitch 6 Accuracy Surface | Read-only, through Prisma, by any authenticated user |

### New models

```prisma
enum StatType {
  passing_yards
  rushing_yards
  receiving_yards
  receptions
  rushing_tds
  receiving_tds
}

enum BacktestStatus {
  running
  completed
  failed
  interrupted
}

enum EvaluationWindow {
  development
  validation
  holdout
}

model BacktestRun {
  id     String         @id @default(uuid())
  label  String? // optional operator label, e.g. "zil-shrinkage-k4"
  status BacktestStatus @default(running)

  // --- Configuration: everything needed to identify the experiment ---------
  seasonFrom             Int              @map("season_from")
  seasonTo               Int              @map("season_to")
  seasonTypes            String[]         @map("season_types") // ["REG"] | ["REG","POST"]
  statTypes              StatType[]       @map("stat_types")
  evaluationWindow       EvaluationWindow @map("evaluation_window")
  cutoffPolicy           String           @map("cutoff_policy") // e.g. "kickoff_minus_90m/v1"
  thresholdPolicyVersion String           @map("threshold_policy_version") // e.g. "grid-v1"
  gradingTarget          String           @map("grading_target") // "official_corrected" | "first_published"
  modelVersion           String           @map("model_version") // e.g. "baseline-zil-0.1.0"
  codeVersion            String           @map("code_version") // git sha, "unknown" never guessed
  codeDirty              Boolean          @default(false) @map("code_dirty")
  seed                   Int
  rngDraws               Int              @default(0) @map("rng_draws") // asserted 0 for this engine
  engineConfig           Json             @map("engine_config") // full resolved constants
  engineConfigDigest     String           @map("engine_config_digest")
  corpusDigest           String           @map("corpus_digest")

  // --- Population accounting ----------------------------------------------
  candidateCount        Int @default(0) @map("candidate_count")
  projectedCount        Int @default(0) @map("projected_count")
  unprojectableCount    Int @default(0) @map("unprojectable_count")
  excludedCount         Int @default(0) @map("excluded_count")
  comparisonCount       Int @default(0) @map("comparison_count")
  thresholdObsCount     Int @default(0) @map("threshold_obs_count")

  // --- Results -------------------------------------------------------------
  // Documented, versioned shape (see "Aggregates contract"). The Architecture
  // Doc names BacktestRun as the home of "aggregate results"; breakouts live
  // here rather than in an entity the approved data model does not name.
  aggregates        Json?   @map("aggregates")
  aggregatesVersion Int     @default(1) @map("aggregates_version")

  predictionsDigest String? @map("predictions_digest")
  aggregateDigest   String? @map("aggregate_digest")
  calibrationDigest String? @map("calibration_digest")

  // --- Artefacts and provenance -------------------------------------------
  artifactPath String    @map("artifact_path") // local path; never served, never a URL
  errorMessage String?   @map("error_message") // sanitized; never contains a DSN
  startedAt    DateTime  @map("started_at")
  finishedAt   DateTime? @map("finished_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  calibrationBins CalibrationBin[]

  @@index([status, startedAt(sort: Desc)])
  @@index([modelVersion, startedAt(sort: Desc)])
  @@index([evaluationWindow])
  @@map("backtest_runs")
}

model CalibrationBin {
  id            String @id @default(uuid())
  backtestRunId String @map("backtest_run_id")

  // Segment. NULL means "all" on that axis; exactly one row set exists per
  // (statType, season, era) combination the run emitted.
  statType StatType?   @map("stat_type")
  season   Int?
  era      WeatherEra?

  binIndex Int     @map("bin_index") // 0..9
  binLow   Decimal @map("bin_low") @db.Decimal(4, 3) // 0.000
  binHigh  Decimal @map("bin_high") @db.Decimal(4, 3) // 0.100

  predictedMean Decimal @map("predicted_mean") @db.Decimal(6, 5)
  observedRate  Decimal @map("observed_rate") @db.Decimal(6, 5)

  // Two sample sizes, never one. Threshold events from the same distribution
  // are correlated; projectionCount is the effective sample.
  thresholdObservations Int     @map("threshold_observations")
  projectionCount       Int     @map("projection_count")
  belowFloor            Boolean @default(false) @map("below_floor")

  createdAt DateTime @default(now()) @map("created_at")

  backtestRun BacktestRun @relation(fields: [backtestRunId], references: [id], onDelete: Cascade)

  @@unique([backtestRunId, statType, season, era, binIndex])
  @@index([backtestRunId])
  @@map("calibration_bins")
}
```

**Notes on the shape.**

- `statTypes` is `StatType[]` — a Postgres enum array. Prisma supports scalar-list enums on Postgres, and the Python side reads it as a text array.
- `seasonTypes` is `String[]` rather than an enum because `Game.seasonType` is already a `String` in the existing schema; introducing an enum here without migrating that column would create two vocabularies.
- `aggregates` is `Json`. Rationale is in the model comment: the approved data model names `BacktestRun` and `CalibrationBin` and no third entity, and breakout metrics are exactly the "aggregate results" that model is described as holding. A `BacktestMetric` table would be a divergence from the Architecture Doc; if Pitch 6 finds Json awkward to query, that is a Pitch 6 migration with a stated reason.
- `NULL` segment semantics on `CalibrationBin` are load-bearing and the unique key includes them. Postgres treats `NULL`s as distinct in unique indexes, so a partial unique index is required to make the "all" rows genuinely unique.

### Raw SQL constructs

```sql
-- CalibrationBin segment uniqueness. Postgres treats NULLs as distinct in a
-- unique index, so the @@unique above does not prevent duplicate "all" rows.
-- A single unique index over COALESCEd sentinels was rejected by Postgres and
-- must not be restored: enum-to-text casts are STABLE, not IMMUTABLE, and
-- index expressions require IMMUTABLE. Instead, a CHECK pins every row to a
-- single segment axis — which also forbids cross-axis rows the sentinel form
-- would have admitted — and four partial unique indexes, one per axis, need
-- no cast at all. Together they cover every legal row exactly once.
alter table calibration_bins
  add constraint calibration_bins_single_axis check (
    (case when stat_type is null then 0 else 1 end
     + case when season is null then 0 else 1 end
     + case when era is null then 0 else 1 end) <= 1
  );

create unique index calibration_bins_all_segment_uniq
  on calibration_bins (backtest_run_id, bin_index)
  where stat_type is null and season is null and era is null;

create unique index calibration_bins_stat_segment_uniq
  on calibration_bins (backtest_run_id, stat_type, bin_index)
  where stat_type is not null;

create unique index calibration_bins_season_segment_uniq
  on calibration_bins (backtest_run_id, season, bin_index)
  where season is not null;

create unique index calibration_bins_era_segment_uniq
  on calibration_bins (backtest_run_id, era, bin_index)
  where era is not null;

-- A bin is a probability bucket. These are cheap and they catch a class of
-- unit error (percent vs proportion) that is otherwise invisible in a chart.
alter table calibration_bins
  add constraint calibration_bins_bounds check (
    bin_low >= 0 and bin_high <= 1 and bin_low < bin_high
    and predicted_mean >= 0 and predicted_mean <= 1
    and observed_rate >= 0 and observed_rate <= 1
    and threshold_observations >= 0
    and projection_count >= 0
    and projection_count <= threshold_observations
  );

-- Population accounting must reconcile on a completed run. A run that cannot
-- account for its own candidates is not a result.
alter table backtest_runs
  add constraint backtest_runs_population_reconciles check (
    status <> 'completed'
    or (projected_count + unprojectable_count + excluded_count = candidate_count
        and comparison_count <= projected_count)
  );

-- A completed run must carry its reproducibility evidence.
alter table backtest_runs
  add constraint backtest_runs_completed_has_digests check (
    status <> 'completed'
    or (predictions_digest is not null
        and aggregate_digest is not null
        and calibration_digest is not null
        and finished_at is not null)
  );

-- No RLS on these tables. They are shared reference data with no per-user
-- partition (Architecture Doc -> "not multi-tenancy"). Stated here so the
-- absence is a decision rather than an oversight.
```

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Threshold probability | no (derived on demand) | distribution parameters | Closed form. A new threshold never requires a re-run — the PRD criterion. |
| Quantile grid | yes, in Parquet | distribution parameters | Display and the mass-below-zero detector only. Never the source of a probability. |
| Projected value | yes | distribution mean | The mean, not the median — documented and asserted. |
| Interval | yes | p10 / p90 of the distribution | Same object as the threshold probabilities, per DoD. |
| Confidence | yes | `n_eff` and relative interval width | Deterministic rule; see the constants table. |
| `n_eff` | yes, in Parquet | eligible prior games at the cutoff | Retained so a confidence value is explicable without re-running. |
| MAE / RMSE / Brier / log loss | yes, in `aggregates` | per-prediction Parquet | Recomputed by `verify` and asserted equal. |
| Calibration bins | yes, in `CalibrationBin` | threshold Parquet | Same. |
| Weather era per prediction | yes, in Parquet | `GameWeather.era` at cutoff, else season rule | `era_source` column records which applied. |
| Corpus digest | yes | fact-table counts + max `known_at` + `IngestRun` ids in scope | Makes the reproducibility precondition checkable. |
| Timing cost, edge, staleness | no | — | Not this pitch. Named here so nobody adds them. |

---

## Model specification (normative constants)

The engine is deliberately simple and fully specified. Every constant below is in `engineConfig`, hashed into `engineConfigDigest`, and changing any of them changes `modelVersion`.

### Stat-type registry

| StatType | Family | Source column | Distribution | Threshold grid (`grid-v1`) | PMF cap |
| -------- | ------ | ------------- | ------------ | -------------------------- | ------- |
| `passing_yards` | `continuous_nonneg` | `passing_yards` | zero-inflated log-normal | 149.5 → 349.5 step 25 (9) | — |
| `rushing_yards` | `continuous_nonneg` | `rushing_yards` | zero-inflated log-normal | 24.5 → 124.5 step 10 (11) | — |
| `receiving_yards` | `continuous_nonneg` | `receiving_yards` | zero-inflated log-normal | 24.5 → 124.5 step 10 (11) | — |
| `receptions` | `count` | `receptions` | negative binomial | 1.5 → 8.5 step 1 (8) | 15 |
| `rushing_tds` | `count` | `rushing_tds` | negative binomial | 0.5, 1.5 (2) | 4 |
| `receiving_tds` | `count` | `receiving_tds` | negative binomial | 0.5, 1.5 (2) | 4 |

Adding a stat type to an existing family is a registry row. Adding a *family* is the only change that touches `distributions.py`. This is what the PRD's "adding a new stat type does not require structural change" means operationally.

### Eligibility

A prior game is **eligible** for a candidate if, at the cutoff: its stat line is visible through `AsOfCorpus.trailing_player_stats` (which already enforces publication-time and correction roll-back), and the stat's source column is non-null. A null column is absence, never zero — a quarterback's `receiving_yards` of `NULL` is not a zero-yard receiving performance.

### Form aggregation

Exponentially-weighted over the most recent `TRAILING_WINDOW = 8` eligible games, half-life 4 games, weights `w_i = 0.5^(age_i / 4)` normalised to sum 1, ages counted in eligible games not calendar weeks.

### Shrinkage to the prior

```
posterior_mean = (n_eff · ew_mean + K0 · prior_mean) / (n_eff + K0),  K0 = 4
```

`prior_mean` and the prior's dispersion come from the `(season, stat_type, position)` prior fitted on seasons strictly earlier. `position` is `Player.position`, which is roster position and carries no team affiliation — the "current roster state joined to a historical game" trap does not apply.

### Distribution fitting

**Continuous family — zero-inflated log-normal.**

- `p_zero` = shrunk rate of zero/absent-production games among eligible priors, shrunk to the prior's zero rate with the same `K0`.
- `mu`, `sigma` = method-of-moments fit on `log(x)` over the strictly positive eligible values, shrunk to the prior's `mu`/`sigma`. Floor `sigma` at the family constant `SIGMA_FLOOR = 0.35` so a player with three near-identical games does not receive a physically absurd interval.
- `P(X ≥ t) = (1 − p_zero) · (1 − Φ((ln t − mu) / sigma))` for `t > 0`. Thresholds are always `x.5`, so the `≥` versus `>` distinction never bites; the spec fixes `≥` regardless.
- Mean = `(1 − p_zero) · exp(mu + sigma² / 2)`. Support `[0, ∞)`. `mass_below_zero` is structurally `0` and is emitted anyway as the detector.

**Count family — negative binomial.**

- Fit `r`, `p` by method of moments on the shrunk mean and variance, with `variance > mean` enforced (fall back to `variance = mean · 1.05` when the sample is under-dispersed, so `r` stays finite and positive).
- PMF emitted explicitly for `k = 0 … cap`, plus `tail_mass` for `k > cap`. `P(X ≥ t) = Σ_{k ≥ ceil(t)} pmf(k)` including the tail.
- Zero mass is the first element of the PMF and is emitted as its own column, because a stat dominated by zeros must be visibly represented rather than approximated by a curve.

### Confidence

Deterministic, evaluated in this order; first match wins.

| Condition | Confidence |
| --------- | ---------- |
| `n_eff == 0` | not applicable — the candidate is `unprojectable(insufficient_history)` |
| `n_eff < 3` | `low` |
| relative width `w > W_LOW` | `low` |
| `n_eff ≥ 6` and `w ≤ W_HIGH` | `high` |
| otherwise | `medium` |

`w = (p90 − p10) / max(projected_value, FLOOR)`, with family constants:

| Family | `W_HIGH` | `W_LOW` | `FLOOR` |
| ------ | -------- | ------- | ------- |
| `continuous_nonneg` | 1.20 | 2.00 | 10.0 |
| `count` | 1.60 | 2.60 | 0.5 |

Confidence is an ordinal label, **not** a calibrated probability, and no surface may present it as one.

### Drivers

Three to five deterministic sentences per projection, ordered by absolute contribution to the posterior mean, emitted as a JSON list in the prediction row. Fixed templates, e.g. `"8 eligible prior games; exponentially-weighted form 62.4 receiving yards."`, `"Shrunk 31% toward the WR prior for 2023 (fitted on 1999–2022)."`, `"Zero-production rate 0.09 over eligible games."` No driver may reference a value the projection did not use.

### Cutoff policy (`kickoff_minus_90m/v1`)

```
k_actual = games.kickoff_at
k_known  = kickoff from the latest GameScheduleRevision known at (k_actual − 7 days)
cutoff   = min(k_actual, k_known) − 90 minutes
```

`min` is deliberate: for a **cutoff**, resolving *earlier* is the conservative direction, the mirror image of `knownAt`, where resolving later is conservative. If no schedule revision is visible seven days out, `k_known` is undefined and `k_actual` is used. If `cutoff ≥ k_actual` for any reason, the candidate is excluded with `cutoff_after_kickoff` — a condition that should never occur and whose count is asserted zero by `verify`.

### Grading target

The backtest grades against the **official corrected line** via `GradingCorpus.final_player_stat`, and records `grading_target = "official_corrected"` on the run plus a per-prediction `correction_applied` boolean. Rationale: the backtest measures how well the model predicted what happened, and the corrected line is the best evidence of what happened. The alternative (first-published) is reconstructible from `PlayerGameStatCorrection.prior_values`, and `show` reports the count of affected predictions so the sensitivity is visible.

This resolves the grading target **for backtest evaluation only**. Whether Kalshi settlement or the official line is truth for grading a *position* remains open and belongs to the Outcome Ingest pitch. The two questions are not the same question.

---

## Authorization and Access Control

This pitch adds no HTTP surface, no route handler, no session, and no role check, because it adds no request path.

- **Python runtime.** Connects with the service-role credential over the **direct** (non-pooled) connection, per `CLAUDE.md`. It bypasses RLS by design; its isolation guarantee is that it never serves a user request. No route handler may ever use this credential, and none exists to.
- **`BacktestRun` and `CalibrationBin` are shared read surfaces.** When Pitch 6 renders them, an authenticated session is required and nothing more. There is no admin-only gate and no per-user scoping, because a calibration curve is identical for every user.
- **No RLS** is enabled on either table. Shared reference data does not get row-level isolation; that would be ceremony. Stated explicitly so it is not later read as an omission.
- **Artefacts are local files.** `artifactPath` is a filesystem path, never a URL, and no code path in this repository serves it. `python/artifacts/` is git-ignored.
- **Credential safety.** `errorMessage` passes through the existing `sanitize_error` before it is written, exactly as `IngestRun.errorMessage` does. The CLI's failure output uses the same function. A DSN must never reach a row, a log line, or stdout.

---

## Operation Surface (Python)

A second console script on the existing project: `sightline-backtest`. The distribution name stays `sightline-ingest`; the package boundary is what the import-graph invariant cares about.

```toml
[project.scripts]
sightline-ingest   = "sightline_ingest.cli:main"
sightline-backtest = "sightline_model.cli:main"

[tool.hatch.build.targets.wheel]
packages = ["src/sightline_ingest", "src/sightline_model"]
```

### Package layout

```text
python/src/sightline_model/
  __init__.py
  stat_types.py     # registry: family, source column, threshold grid, PMF cap
  distributions.py  # ZILogNormal / NegativeBinomial: fit, quantiles, threshold_prob, pmf
  priors.py         # walk-forward prior fitting, cached per (season, stat_type, position)
  features.py       # as-of-only feature assembly; takes an AsOfCorpus, never a DSN
  projection.py     # ProjectionResult, project_one(), drivers
  baselines.py      # season_average(), trailing_five()
  harness.py        # chronological loop, candidate enumeration, run lifecycle
  metrics.py        # MAE/RMSE/Brier/log-loss, calibration binning, digests
  artifacts.py      # Parquet schemas, manifest, _COMPLETE marker, digest computation
  persist.py        # BacktestRun / CalibrationBin writes over the direct connection
  cli.py            # subcommands below
```

`features.py` and `projection.py` accept an **`AsOfCorpus` instance**, never a connection factory or a DSN. A feature function that could open its own connection could bypass the cutoff; removing that possibility is cheaper than testing for it.

### Commands

```text
# Execute. The only command that writes.
uv run sightline-backtest run \
    --seasons 2016-2021 \
    --stat-types rushing_yards,receiving_yards,passing_yards,receptions \
    --season-types REG \
    --window development \
    [--label zil-shrinkage-k4] [--seed 20260728] [--limit-games N] [--reap]

# Inspect. All read-only, all stdout, all support --json.
uv run sightline-backtest show        <run-id>                   # manifest, populations, aggregates
uv run sightline-backtest show        <run-id> --breakout era     # total|stat|season|era
uv run sightline-backtest calibration <run-id> [--stat rushing_yards] [--era reanalysis]
uv run sightline-backtest predictions <run-id> [--cohort rookie] [--player "Nacua"]
                                      [--sort err] [--limit 50]
uv run sightline-backtest explain     <run-id> --prediction <pid>
uv run sightline-backtest exclusions  <run-id> [--reason insufficient_history] [--examples 12]
uv run sightline-backtest thresholds  <run-id> --prediction <pid> [--at 74.5]
uv run sightline-backtest verify      <run-id> [--against <run-id>] [--strict]
uv run sightline-backtest list        [--model-version ...] [--window holdout]
```

### Command contracts

| Command | Reads | Writes | Exit codes |
| ------- | ----- | ------ | ---------- |
| `run` | corpus via `AsOfCorpus`, actuals via `GradingCorpus` | `BacktestRun`, `CalibrationBin`, Parquet artefacts | 0 completed · 1 failed/interrupted · 2 usage/config |
| `show` | `BacktestRun` + manifest | nothing | 0 · 1 if `--strict` and status ≠ `completed` |
| `calibration` | `CalibrationBin` (+ Parquet for `--stat`/`--era` slices not persisted) | nothing | 0 · 1 under `--strict` |
| `predictions` | `predictions/` Parquet | nothing | 0 |
| `explain` | `predictions/`, `thresholds/`, plus a **live as-of read at the stored cutoff** for the eligible-source and excluded-by-cutoff panels | nothing | 0 · 1 if the prediction id is unknown |
| `exclusions` | `exclusions/` Parquet | nothing | 0 |
| `thresholds` | `predictions/` Parquet, evaluates closed form | nothing | 0 |
| `verify` | everything | nothing | 0 pass · 1 any assertion failed · 2 usage |
| `list` | `BacktestRun` | nothing | 0 |

`explain` is the terminal replacement for the withdrawn detail view and is the most important inspection command. It prints, for one prediction: player, game, stat type, distribution parameters, the quantile grid, `mass_below_zero`, the full threshold table, projected value, interval, confidence with its `n_eff` and width inputs, drivers, actual and its percentile, `computedAt`, `informationCutoff`, kickoff, the latest eligible source record per source with its `known_at` and `OBSERVED`/`RECONSTRUCTED` flag, and up to ten future-dated records that were unreachable at the cutoff. The last two blocks require a live as-of read; they are diagnostics and must never mutate an artefact.

### Batched as-of reads (a change to the Layer-1 read path)

Per-candidate round trips do not finish a multi-season run in tolerable time. The harness reads **once per (game, cutoff)** for all candidate players in that game.

```python
class AsOfCorpus:
    def trailing_player_stats_batch(
        self, *, player_ids: list[str], before_game_id: str
    ) -> pl.DataFrame: ...

    def player_context_batch(
        self, *, player_ids: list[str], game_id: str, context_type: str
    ) -> pl.DataFrame: ...

    def rest_and_travel_batch(
        self, *, player_ids: list[str], game_id: str
    ) -> pl.DataFrame: ...
```

Requirements, because this touches the invariant's first layer:

- Each batch method is the **same SQL** as its single-row twin with `player_id = any(%(pids)s)` substituted for `player_id = %(pid)s`, plus `player_id` added to `ORDER BY`. The cutoff predicate is textually identical and the correction roll-back logic is shared, not reimplemented.
- A **differential test** asserts that for every player in a fixture game, `batch(...)` filtered to that player equals `single(...)` row for row, column for column, dtype for dtype.
- The batch methods return a frame keyed by `player_id`; the harness must not assume input order is preserved.
- Per `CLAUDE.md` → Workflow: this change requires a backtest re-run and a digest comparison against the prior stored run before merge. Since this pitch produces the first run, the comparison is between a small single-row-path run and the same configuration on the batch path, and the digests must be identical.

### Artefact layout

```text
python/artifacts/backtests/<run-id>/
├── manifest.json              # config, digests, populations, engine constants
├── predictions/part-*.parquet
├── thresholds/part-*.parquet
├── exclusions/part-*.parquet
├── priors/part-*.parquet
└── _COMPLETE                  # written last, after the manifest
```

`_COMPLETE` is the filesystem twin of `status = completed`. A directory without it is never read as a result, and the two must agree — `verify` asserts they do, because a crash between the marker and the row update is exactly the kind of state that gets presented as complete six weeks later.

### Artefact schemas

`predictions/` — one row per successful projection. Quantisation in parentheses is applied before writing and before hashing.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `prediction_id` | string | deterministic: BLAKE2b of `(run-independent)` `game_id`, `player_id`, `stat_type`, `model_version`, `information_cutoff` |
| `game_id`, `player_id` | string | |
| `season`, `week` | int32 | |
| `season_type` | string | |
| `stat_type` | string | enum value |
| `team_abbr_at_game` | string | team at the time of the game, never current |
| `position` | string | roster position used for the prior |
| `model_version`, `code_version` | string | |
| `distribution_kind` | string | |
| `params` | struct | ZIL: `p_zero`(6), `mu`(6), `sigma`(6). NB: `r`(6), `p`(6) |
| `pmf` | list\<float64\> | count family only; index = k, plus `tail_mass` |
| `tail_mass` | float64 (6) | count family only |
| `q05,q10,q25,q50,q75,q90,q95` | float64 (3) | display grid |
| `projected_value` | float64 (3) | distribution mean |
| `interval_low`, `interval_high` | float64 (3) | p10 / p90 |
| `mass_below_zero` | float64 (6) | detector; structurally 0 |
| `confidence` | string | `high`/`medium`/`low` |
| `n_eff` | int32 | eligible prior games |
| `relative_width` | float64 (4) | confidence input, retained for explicability |
| `drivers` | list\<string\> | ordered by contribution |
| `information_cutoff`, `kickoff_at` | timestamp\[us, UTC\] | |
| `computed_at` | timestamp\[us, UTC\] | **excluded from digests** |
| `weather_era` | string | |
| `era_source` | string | `weather_row` or `season_rule` |
| `actual` | float64 (1) | corrected official line |
| `correction_applied` | bool | a correction existed for this player-game |
| `actual_percentile` | float64 (4) | percentile of the actual in the predicted distribution |
| `abs_error`, `sq_error` | float64 (4) | model error, precomputed for deterministic reduction |
| `baseline_season_avg`, `baseline_trailing5` | float64 (3), nullable | null when undefined |
| `baseline_season_avg_abs_error`, `baseline_trailing5_abs_error` | float64 (4), nullable | |
| `in_comparison_population` | bool | true iff model and both baselines are all non-null |
| `cohorts` | list\<string\> | `rookie`, `sparse`, `role_change`, `returning`, `low_confidence`, `reanalysis`, `impossible_output` — precomputed flags, deterministic rules in `engineConfig` |

`thresholds/` — one row per `(prediction, threshold)`: `prediction_id`, `stat_type`, `threshold`(1), `probability`(6), `outcome` bool, `season`, `weather_era`, `bin_index`.

`exclusions/` — one row per non-projected candidate or population exclusion: `game_id`, `player_id`, `stat_type`, `stage` (`engine`|`harness`), `reason`, `detail` (sanitized), `prediction_id` (nullable, set for `baseline_unavailable`).

`priors/` — one row per `(season, stat_type, position)`: fitted parameters, `fitted_from_seasons`, `sample_games`, `sample_players`.

### Aggregates contract (`aggregatesVersion = 1`)

```json
{
  "aggregatesVersion": 1,
  "population": { "candidates": 0, "projected": 0, "unprojectable": 0,
                  "excluded": 0, "comparison": 0, "modelOnly": 0 },
  "overall": {
    "comparison": {
      "model":          { "mae": 0.0, "rmse": 0.0, "n": 0 },
      "seasonAverage":  { "mae": 0.0, "rmse": 0.0, "n": 0 },
      "trailingFive":   { "mae": 0.0, "rmse": 0.0, "n": 0 }
    },
    "modelOnly": { "model": { "mae": 0.0, "rmse": 0.0, "n": 0 } },
    "thresholds": { "brier": 0.0, "logLoss": 0.0,
                    "observations": 0, "projections": 0 }
  },
  "byStatType": { "rushing_yards": { "…same shape as overall…" } },
  "bySeason":   { "2019": { "…" } },
  "byEra":      { "reanalysis": { "…" }, "archived_forecast": { "…" } },
  "notes": {
    "reanalysisLeakAccepted": true,
    "correctionAppliedCount": 0,
    "cutoffAfterKickoffCount": 0
  }
}
```

`n` is present on every metric object and equals the comparison population for that segment. A metric the run did not compute is **absent**, never `0` and never `null` — `show` renders an absent key as `— (not computed)`.

### Failure format

| Condition | Behaviour |
| --------- | --------- |
| Corpus unreachable at start | Exit 2 before inserting a `BacktestRun`. Nothing partial is created. |
| Corpus becomes unreachable mid-run | `status = failed`, sanitized message, artefacts retained, exit 1 |
| A single candidate raises | `exclusions/` row with `reason = harness_error` and the exception **type**; the run continues. If `harness_error` exceeds `MAX_CANDIDATE_ERRORS = 100`, the run aborts as `failed` — a systematic fault must not be laundered into an exclusion count. |
| SIGINT / SIGTERM | `status = interrupted`, artefacts retained, exit 1 |
| `--seasons` outside corpus coverage | Exit 2 with the covered range named, before any work |
| Unknown stat type | Exit 2 listing the registry |
| Credentials in any error path | Never. `sanitize_error` on every write and every print. |

---

## Validation Rules

| Field / condition | Validation | Warn or Block | Outcome |
| ----------------- | ---------- | ------------- | ------- |
| `--seasons` range | start ≤ end; both within `SourceCoverage` for every required dataset | **Block** | exit 2, coverage named |
| `--stat-types` | every value in the registry | **Block** | exit 2, registry listed |
| `--window holdout` | permitted, but the run records it and `list --window holdout` counts distinct model versions that have touched it | **Warn** | printed at start: "this is holdout run N for model version X" |
| `informationCutoff ≥ kickoff` | forbidden | **Block** (per candidate) | excluded `cutoff_after_kickoff`; `verify` asserts the count is 0 |
| A feature value obtained outside `AsOfCorpus` | forbidden | **Block** (structural) | `features.py` accepts only an `AsOfCorpus`; import-graph test enforces the rest |
| `mass_below_zero > 0` on a `continuous_nonneg` stat | forbidden | **Block** | prediction flagged `impossible_output`; `verify` fails the run |
| Negative or `NaN` distribution parameter | forbidden | **Block** | candidate becomes `harness_error`; counts toward the abort threshold |
| PMF sums to `1 ± 1e-9` (incl. tail) | required | **Block** | as above |
| Threshold probability outside `[0, 1]` | forbidden | **Block** | as above |
| `n_eff == 0` | expected | **Warn** | `unprojectable(insufficient_history)`, retained with reason |
| Baseline undefined (week 1 season average) | expected | **Warn** | prediction retained; excluded from comparison population only, recorded as `baseline_unavailable` |
| Actual missing for a played game | expected | **Warn** | excluded `no_actual_stat_line`, applied identically to model and both baselines |
| Model and baseline populations differ | forbidden | **Block** | `verify` fails; a mismatched comparison is a defect, not a footnote |
| `codeVersion == "unknown"` | permitted, recorded | **Warn** | printed prominently; `verify --strict` fails, since the run is not attributable |
| Dirty working tree | permitted, recorded | **Warn** | `codeDirty = true`; `verify --strict` fails |
| `rngDraws != 0` | forbidden for this engine | **Block** | `verify` fails |
| Any Kalshi table in the query path | forbidden | **Block** | import-graph test; review-blocking |

---

## Testing Strategy

pytest, in `python/tests/`. DB integration tests use `TEST_DATABASE_URL` and the existing `db` marker; the local Postgres on `:5433` is already running — reuse it rather than starting a second container.

### 1. Temporal leakage — adversarial, and first

```text
TEST: projection_cannot_see_the_game_it_predicts
GIVEN: A completed historical game with a full stat line, snap counts, and a
       Friday injury upgrade, all with known_at after the game's cutoff
WHEN:  The engine projects that player-stat-game at the harness's cutoff
THEN:
  - The trailing window contains zero rows from that game or later
  - n_eff equals the count of games published strictly before the cutoff
  - The projection is byte-identical to one computed from a corpus in which the
    post-cutoff rows were never inserted

TEST: adversarial_late_fact_is_unreachable_through_the_feature_path
GIVEN: A PlayerGameContext row inserted with known_at one second after the cutoff
WHEN:  features.assemble() runs at that cutoff
THEN:
  - The row is absent from the assembled features
  - It is absent from the SQL result set, not filtered in Python
  - The same row IS visible at cutoff + 2s, proving the fixture is real

TEST: batch_and_single_as_of_reads_are_identical
GIVEN: A game with 40 candidate players and a mix of eligible history depths
WHEN:  trailing_player_stats_batch() and trailing_player_stats() are both run
THEN:
  - For every player, the frames are equal row for row, column for column,
    including dtypes and correction roll-back behaviour
  - A digest over the batch result equals a digest over the concatenated
    single-player results in canonical order

TEST: corrected_actual_never_re_enters_features
GIVEN: A PlayerGameStat corrected after the target game's cutoff
WHEN:  The engine projects a later game for that player
THEN:
  - The trailing window carries the value as published at the cutoff
  - GradingCorpus is not reachable from any module features.py imports

TEST: season_aggregate_is_structurally_impossible
GIVEN: The feature module
THEN:  No function computes a mean over a season without a cutoff-bounded
       eligible-games list; asserted by inspecting that every aggregation input
       originates from an AsOfCorpus call within the same call stack

TEST: cutoff_policy_survives_a_flexed_kickoff
GIVEN: A game moved from 13:00 to 20:20, with the revision known 3 days out
WHEN:  The cutoff is derived
THEN:
  - cutoff = min(actual, known-7d) − 90m
  - cutoff < both kickoff values
  - A game flexed EARLIER still yields a cutoff before the actual kickoff
```

### 2. Prices never feed projections (structural)

```text
TEST: model_package_import_graph_is_clean
GIVEN: sightline_model and every module it transitively imports
THEN:
  - No import of a Kalshi client, price module, or recommendation module
  - No SQL string in the package references price_observations,
    recommendation_snapshots, contracts, or kalshi
  - The assertion covers sightline_ingest re-exports, not just direct imports
```

### 3. Determinism and reproducibility

```text
TEST: repeat_run_reproduces_all_three_digests
GIVEN: A fixture corpus and a fixed configuration
WHEN:  The same run executes twice
THEN:
  - predictionsDigest, aggregateDigest, calibrationDigest all match
  - corpusDigest and engineConfigDigest match
  - computedAt differs and does not affect any digest

TEST: seed_does_not_influence_output
WHEN:  The same configuration runs with seed 1 and seed 999999
THEN:  All three digests match; rngDraws is 0 in both

TEST: aggregates_are_invariant_to_chunking
GIVEN: The same predictions written as 1 part file and as 37 part files
WHEN:  Aggregates are computed
THEN:  Byte-identical aggregate JSON, because reduction is fsum over a sorted array

TEST: verify_recomputes_and_agrees
WHEN:  verify runs against a completed run
THEN:
  - Recomputed aggregates equal stored aggregates exactly
  - Recomputed calibration bins equal stored CalibrationBin rows exactly
  - Exit code 0

TEST: verify_detects_a_tampered_aggregate
GIVEN: A completed run whose stored MAE is edited by 0.01
WHEN:  verify runs
THEN:  Exit 1, the offending metric and both values named

TEST: threshold_probability_needs_no_rerun
GIVEN: A completed run
WHEN:  `thresholds --at 87.5` is requested for a threshold not in grid-v1
THEN:
  - A probability is returned from stored parameters
  - No engine code executes, no corpus read occurs
```

### 4. Interruption and idempotence

```text
TEST: interrupted_run_is_never_a_result
GIVEN: A run killed with SIGINT after 40% of games
WHEN:  show / calibration / predictions are invoked
THEN:
  - Status renders as interrupted
  - No CalibrationBin rows exist
  - No _COMPLETE marker exists
  - --strict exits 1

TEST: crash_between_marker_and_row_is_detected
GIVEN: Artefacts with _COMPLETE present but BacktestRun.status = running
WHEN:  verify runs
THEN:  Exit 1 naming the disagreement; the run is not readable as complete

TEST: rerunning_the_same_config_creates_a_new_run_with_equal_digests
THEN:
  - Two BacktestRun rows exist (experiment history preserved)
  - Their digests are equal
  - Neither mutates the other's CalibrationBin rows

TEST: population_accounting_reconciles
THEN: projected + unprojectable + excluded == candidates, enforced by a CHECK
      constraint and asserted by verify
```

### 5. Model behaviour and sparse data

```text
TEST: rookie_debut_declines_rather_than_guessing
GIVEN: A player with zero eligible prior games
THEN:
  - Candidate is unprojectable(insufficient_history)
  - It appears in exclusions/ with a reason, never silently absent
  - It is excluded from model AND both baseline populations identically

TEST: one_prior_game_yields_low_confidence_and_a_wide_interval
GIVEN: n_eff == 1
THEN:
  - confidence == "low"
  - The posterior is prior-dominated (weight on the prior ≥ K0/(1+K0))
  - p90 − p10 exceeds the same player's interval at n_eff == 8

TEST: zero_heavy_stat_keeps_its_zero_mass
GIVEN: receiving_tds for a player with 1 TD in 12 games
THEN:
  - distribution_kind == "negative_binomial"
  - pmf[0] > 0.6
  - No continuous approximation is used, and no quantile grid is consulted for
    P(X ≥ 0.5)

TEST: continuous_distribution_never_puts_mass_below_zero
GIVEN: Every projected continuous prediction in a fixture run
THEN:  mass_below_zero == 0 for all; the impossible_output cohort is empty

TEST: returning_from_absence_is_flagged_not_hidden
GIVEN: A player whose last eligible game is 9 weeks earlier
THEN:  The prediction carries cohort "returning" and is inspectable via
       `predictions --cohort returning`

TEST: role_change_is_visible_in_n_eff_not_career_totals
GIVEN: A player with 90 career games and 3 in the current role
THEN:  n_eff reflects eligible games, and confidence does not read "high"
       merely because the career is long
```

### 6. Baselines and evaluation

```text
TEST: baselines_use_the_same_eligible_history_as_the_model
GIVEN: A candidate with 6 eligible priors, one of which is a correction
       published after the cutoff
THEN:  Both baselines see the pre-correction values, exactly as the model does

TEST: season_average_undefined_in_week_one
THEN:
  - baseline_season_avg is null
  - in_comparison_population is false
  - The prediction remains in predictions/ and in the model-only population
  - exclusions/ carries a baseline_unavailable row referencing the prediction_id

TEST: trailing_five_uses_at_most_five_and_may_cross_seasons
THEN:  Exactly min(5, eligible) games; the window may span an offseason and the
       spanning is recorded in drivers

TEST: comparison_population_is_identical_across_all_three_series
THEN:  n is equal for model, seasonAverage, and trailingFive in every segment
       of aggregates; verify fails if not

TEST: era_breakout_is_always_present
GIVEN: A run spanning 2019–2023
THEN:
  - byEra contains both reanalysis and archived_forecast
  - notes.reanalysisLeakAccepted is true
  - show prints the era caveat in words, not as a flag
```

### 7. Calibration

```text
TEST: bins_retain_both_counts
THEN:  Every CalibrationBin has thresholdObservations and projectionCount, and
       projectionCount <= thresholdObservations (CHECK-enforced)

TEST: sparse_bin_is_flagged_not_dropped
GIVEN: A bin with 734 threshold observations
THEN:
  - belowFloor is true
  - The bin is stored and displayed
  - It is excluded from any summary sentence show prints

TEST: brier_is_computable_from_stored_rows
GIVEN: thresholds/ Parquet only
THEN:  A recomputed Brier equals aggregates.overall.thresholds.brier exactly

TEST: calibration_segments_are_uniquely_keyed
GIVEN: Rows for (stat=null, season=null, era=null) and (stat=rushing_yards, …)
THEN:  The partial unique index accepts both and rejects a duplicate "all" row
```

### 8. Failure and security

```text
TEST: dsn_never_appears_in_an_error_path
GIVEN: A run started against an unreachable database with a password in the DSN
WHEN:  The failure is recorded and printed
THEN:
  - BacktestRun.errorMessage contains no host, user, or password
  - stdout and stderr contain none either
  - The assertion covers psycopg OperationalError text specifically

TEST: systematic_candidate_failure_aborts_rather_than_accumulating
GIVEN: A fault causing every candidate to raise
THEN:  The run aborts as failed after MAX_CANDIDATE_ERRORS, and does not
       complete with a large harness_error count

TEST: no_backtest_execution_surface_exists_outside_the_cli
THEN:  No route handler, no server action, and no HTTP path triggers a run
```

### 9. Integration scenario

```text
TEST: corpus_to_stored_calibration_end_to_end
SCENARIO: The whole pitch, over a small fixture corpus

STEP 1: Ingest a fixture corpus spanning 2020–2022 (both weather eras)
VERIFY: Facts carry validAt, knownAt, knownAtReconstructed

STEP 2: Run the backtest over 2021–2022, three stat types
VERIFY: Status completed, _COMPLETE present, digests written, populations reconcile

STEP 3: verify <run>
VERIFY: Exit 0; recomputed aggregates and bins equal stored

STEP 4: Re-run the identical configuration
VERIFY: New run id; all three digests equal; corpusDigest equal

STEP 5: Insert a stat correction into the fixture corpus and re-run
VERIFY: corpusDigest differs; verify --against reports "different experiment",
        exit 0 with a notice, NOT a reproducibility failure

STEP 6: explain a rookie prediction
VERIFY: Prints cutoff, kickoff, eligible sources with OBSERVED/RECONSTRUCTED,
        and at least one future-dated record marked unreachable

STEP 7: Kill a run mid-flight with SIGINT
VERIFY: status interrupted, no CalibrationBin rows, no _COMPLETE, show --strict
        exits 1
```

### Test data factories

Python factories live in `python/tests/factories`. Per the testing patterns: **never default `known_at` to `now()`** — a factory that does makes leakage tests pass while production leaks.

```python
def create_test_eligible_history(*, n_games: int, stat: str = "receiving_yards",
                                 base: float = 62.0, cutoff: datetime) -> list[dict]:
    """n eligible prior games, all published strictly before `cutoff`."""

def create_test_late_fact(*, cutoff: datetime, delta_seconds: int = 1) -> dict:
    """A fact whose known_at is deliberately after the cutoff. The adversary."""
```

---

## Acceptance Criteria

Every UI bullet from the pitch's Definition of Done is re-homed to a command and marked ⟨was-UI⟩.

### Backtest execution

- [ ] A backtest runs from the terminal over a configurable season range.
- [ ] A run can be restricted to a subset of stat types without code changes.
- [ ] Terminal output identifies configuration, progress, exclusions, failures, and final status.
- [ ] Games are processed in chronological order by `(kickoff_at, game_id)`.
- [ ] Every model-facing read goes through `AsOfCorpus`; `features.py` cannot open a connection.
- [ ] No fact with `known_at > informationCutoff` is reachable by any projection.
- [ ] A repeat run over the same corpus state, configuration, model version, code version, and seed produces identical digests.

### Projection output

- [ ] Every successful projection emits a distribution, not a point estimate.
- [ ] `P(X ≥ t)` for any threshold is derivable from stored parameters without re-running the engine (`thresholds --at`).
- [ ] Every projection carries projected value and interval derived from the same distribution as its threshold probabilities.
- [ ] Every projection records `computedAt`, `informationCutoff`, and `modelVersion`.
- [ ] Every projection carries a confidence value derived from interval width and `n_eff`, with both inputs retained.
- [ ] Every projection carries ordered, human-readable drivers.
- [ ] Re-projecting against the same inputs and cutoff yields an identical result.
- [ ] Kalshi prices are not read by the model, features, baselines, or harness — proven by import graph.

### Baselines and evaluation

- [ ] Season-average baseline computed from same-season eligible prior games only.
- [ ] Trailing-five baseline computed from at most five eligible prior games.
- [ ] Early-season behaviour is defined, deterministic, and reported (`baseline_unavailable`).
- [ ] Model error reported against actuals.
- [ ] Both baselines' errors computed over the **identical** comparison population.
- [ ] Results broken out by stat type, by season, and by weather era.
- [ ] The reanalysis era is never folded into a headline figure without its caveat.
- [ ] Calibration compares stated threshold probabilities to observed outcomes across ten fixed bins.
- [ ] Every bin retains threshold-observation count and projection count.
- [ ] Brier score is recomputable from stored per-prediction rows.

### Stored results and reproducibility

- [ ] Aggregates written to `BacktestRun`; calibration written to `CalibrationBin`.
- [ ] Raw per-prediction output written to Parquet, never to Postgres.
- [ ] Every run records period, stat types, model version, code version, cutoff policy, threshold policy, grading target, seed, and engine config digest.
- [ ] Configuration drift against the current engine is detectable from the stored run (`list`, `show` compare `engineConfigDigest`).
- [ ] `rngDraws == 0` is recorded and asserted.
- [ ] An interrupted or failed run is visibly incomplete and never returned as complete.
- [ ] `_COMPLETE` and `status` must agree; disagreement fails `verify`.

### Failure and sparse-data behaviour

- [ ] Missing required data produces an explicit exclusion with a reason code, never a fabricated value.
- [ ] A player with zero eligible history is declined with a reason, not guessed.
- [ ] 1–2 eligible games yields a wide, prior-dominated, `low`-confidence projection.
- [ ] Rookie, role-change, and returning cases are flagged as cohorts and inspectable.
- [ ] Zero-heavy stats use an explicit PMF with visible zero mass.
- [ ] Failed, skipped, and unprojectable cases retain reason codes in `exclusions/`.
- [ ] Exclusions apply identically to model and both baselines, and `verify` proves it.

### Terminal verification ⟨replaces the withdrawn UI⟩

- [ ] ⟨was-UI⟩ `show` prints run identity: model version, code version, seed, seasons, stat types, cutoff policy, grading target, corpus state.
- [ ] ⟨was-UI⟩ `show` distinguishes completed from running, failed, and interrupted.
- [ ] ⟨was-UI⟩ `show` prints model error alongside both baselines.
- [ ] ⟨was-UI⟩ `show --breakout stat|season|era` covers all three breakouts.
- [ ] ⟨was-UI⟩ `calibration` prints bins with predicted, observed, and both counts.
- [ ] ⟨was-UI⟩ `calibration` prints a text summary naming where the model is over- or under-confident and on what sample.
- [ ] ⟨was-UI⟩ `predictions` filters, sorts, and discloses any sample bound it applies.
- [ ] ⟨was-UI⟩ `explain` prints player, game, stat type, projected value, interval, confidence, actual, model version, and the full distribution.
- [ ] ⟨was-UI⟩ `explain` prints multiple threshold probabilities from one distribution.
- [ ] ⟨was-UI⟩ `explain` prints information cutoff and kickoff.
- [ ] ⟨was-UI⟩ `explain` prints the latest eligible source records used.
- [ ] ⟨was-UI⟩ `explain` prints future-dated records excluded by the cutoff where they exist.
- [ ] ⟨was-UI⟩ `explain` marks each source `OBSERVED` or `RECONSTRUCTED`.
- [ ] ⟨was-UI⟩ `exclusions` groups by reason with counts and examples.
- [ ] ⟨was-UI⟩ `predictions --cohort` reaches sparse-history, rookie, role-change, and returning cases.
- [ ] ⟨was-UI⟩ `verify` detects impossible distribution output for stats where it is invalid.
- [ ] ⟨was-UI⟩ `verify --against` demonstrates repeat-run reproducibility.
- [ ] No browser, no server, no port, no route is introduced by any of the above.

### Documentation

- [ ] `docs/v1/runbooks/backtest.md` covers: executing a run; choosing seasons and stat types; how the cutoff is applied; the durable and local artefacts produced; both baselines; the calibration output and its sample-size limits; every inspection command with example output; and the statement that beating naive baselines is necessary but does not establish an edge over Kalshi prices.
- [ ] The runbook records the `development` / `validation` / `holdout` season constants, that holdout runs are counted per model version, and the promotion gate (Resolved Decision 14).
- [ ] The runbook states that no command deletes artefacts, and which run directories are safe to prune by hand.

---

## Explicit Non-Goals

**Permanent** — from the Product Brief, not to be relitigated: sportsbook or DFS integration; public or commercial access; live in-game trading; film or tape-derived inputs; viewers trading through the application or their credentials being custodied; general sports data browsing. Additionally permanent for this feature: **no browser-triggered backtest execution**, ever, in any pitch.

**Deferred** — do not build, do not preclude: bankroll and portfolio management; NBA; WNBA; friend pick sharing; additional stat types beyond the six; additional suggestion sources. Also deferred rather than forbidden: a production Accuracy and Calibration Surface (Pitch 6), live `Projection` storage (Pitch 4), the Simulation Engine (Pitch 7), and scheduled recomputation (Pitch 5).

---

## Resolved Decisions

Recorded because the pitch left them open and a deterministic spec must close them.

1. **Six stat types**, two families, chosen so that both distributional treatments and the zero-heavy case ship. Adding a stat type to an existing family is a registry entry.
2. **Zero-inflated log-normal** for continuous, **negative binomial** for counts. Both closed-form, both non-negative by construction.
3. **Parameters are canonical; the quantile grid is display-only.** Threshold probabilities are exact, not interpolated.
4. **Walk-forward priors refit at season boundaries only**, from strictly earlier seasons. Not per-game, not per-week.
5. **Baselines are point estimates and receive MAE/RMSE only.** They get no Brier score, because giving a point estimate a distribution is a modelling decision this pitch did not scope, and a fabricated one would make the calibration comparison meaningless.
6. **Two populations, both reported.** Comparison (all three series defined) drives every model-vs-baseline claim; model-only is reported alongside so week-1 predictions are not silently discarded.
7. **Grading against the official corrected line**, for the backtest only, with `correction_applied` retained per prediction. The position-grading question stays open and belongs to Outcome Ingest.
8. **Fixed threshold grids (`grid-v1`)**, versioned, stated in every calibration output.
9. **Cutoff = min(actual kickoff, kickoff known 7 days out) − 90 minutes.** Earlier is conservative for a cutoff.
10. **No `Projection` table in this pitch.** The shape is fixed; the table lands with its first consumer.
11. **`aggregates` as versioned Json** rather than a `BacktestMetric` entity the approved data model does not name.
12. **Verification is terminal-only.** The Temporary Backtest Inspection UI and its cleanup step are withdrawn; every inspection requirement maps to a command in Acceptance Criteria.

Resolved 2026-07-28, closing the spec's own open questions:

13. **Evaluation windows are fixed constants**, recorded in `engineConfig` and printed by `run`:

    | Window | Seasons | Use |
    | ------ | ------- | --- |
    | `development` | 2016–2021 | Free iteration. Spans both weather eras deliberately, so the era split is exercised from the first run. |
    | `validation` | 2022–2023 | Candidate comparison. Run when a model version is believed finished. |
    | `holdout` | 2024–2025 | Run **once per model version**. `list --window holdout` prints the count of distinct model versions that have touched it; that count is the selection-bias record. |

    A run may name any season range; the window label is what is recorded and counted. Running `development` seasons under a `holdout` label is possible and is a lie the operator tells on purpose — the constants above are what the runbook and the promotion gate refer to.

14. **The promotion gate is stated, and it is not a binary victory by 0.01.** A model version is eligible to supersede the baseline engine (and to unlock Pitch 7's comparison) only when, on a `validation` run:
    - model MAE beats the **better** of the two baselines by ≥ 3% relative, overall; **and**
    - it beats the better baseline in at least two of the three `continuous_nonneg` stat types; **and**
    - it beats the better baseline in **each weather era separately**, so an aggregate win carried by reanalysis-era seasons does not count; **and**
    - no calibration bin above the reporting floor deviates from its predicted probability by more than 0.10.

    The gate is configuration, not a constant in code, and the runbook states it. It is a gate on claiming improvement, not on merging this pitch.

15. **`passing_yards` ships in the default run.** It is a listed Kalshi market and a distinct volume regime; the thin per-week population (~32 relevant players) is a reason to read its `n` column, not a reason to withhold it. `--stat-types` excludes it per run when unwanted.

16. **Artefacts are never deleted by tooling.** `python/artifacts/` is git-ignored and grows. No command in this pitch removes a directory, and none will be added — a tool that prunes experiment history will eventually prune the run someone was citing. The runbook documents manual pruning and states which directories are safe to remove (any run whose `BacktestRun.status` is not `completed`).

17. **`explain` performs a live as-of read**, bounded by the prediction's stored `informationCutoff`, for the eligible-source and excluded-by-cutoff panels only. It is labelled a diagnostic in its own output. The alternative — persisting a source snapshot per prediction — would multiply artefact size for a panel read a handful of times per run. `explain` never writes, and a test asserts that running it leaves every artefact digest unchanged.

### Inherited, deliberately not resolved here

- Whether edge computes against the ask or the midpoint (Pitch 4 — no prices exist here).
- Whether Kalshi settlement or the official stat line is truth for grading a **position** (Outcome Ingest).
- How the Accuracy Surface treats projections from superseded model versions (Pitch 6 — this pitch stores `modelVersion` so the question is answerable).
- Whether RLS is enabled on the user-scoped tables (no user-scoped table exists yet).

---

## Open Questions

**None blocking.** The five questions this spec raised at v1.0.0 were closed on 2026-07-28 and are recorded as Resolved Decisions 13–17: evaluation-window seasons, the promotion gate, `passing_yards` inclusion, artefact retention, and `explain`'s live as-of read.

Four questions remain open by inheritance from the approved documents. None of them block this pitch, and each is listed above under "Inherited, deliberately not resolved here" — edge against ask or midpoint, settlement versus official line for grading a position, superseded model versions on the accuracy surface, and RLS on user-scoped tables.

A question that arises **during** implementation belongs here with its default assumption stated, not in a commit message.

---

## Implementation breakdown

Milestone: **Pitch 2: Backtest Harness & Baseline Model** in the Sightline V1 Linear project.

| PR | Issue | Contents |
| -- | ----- | -------- |
| 1/8 | SIG-13 | Prisma enums, `BacktestRun`, `CalibrationBin`, raw-SQL constraints; `sightline_model` package + `sightline-backtest` script + `list`; import-graph guard extended |
| 2/8 | SIG-14 | Batched as-of reads on `AsOfCorpus` + differential equivalence suite (**highest-risk PR**) |
| 3/8 | SIG-15 | Stat-type registry, zero-inflated log-normal and negative binomial, walk-forward priors |
| 4/8 | SIG-16 | Projection Engine: feature assembly, `ProjectionResult`, confidence, drivers |
| 5/8 | SIG-17 | Harness: candidate ordering, cutoff policy, baselines, exclusions, Parquet artefacts, run lifecycle |
| 6/8 | SIG-18 | Metrics, calibration bins, versioned aggregates, three run digests |
| 7/8 | SIG-19 | CLI inspection commands — the ⟨was-UI⟩ surface |
| 8/8 | SIG-20 | `verify`, adversarial leakage and determinism suites, integration scenario, runbook (capstone) |

SIG-15 is independent of SIG-14 and can run in parallel with it; everything else is a chain.

---

## Future Considerations

- **Pitch 4** maps `ProjectionResult` onto the `Projection` and `ProjectionDriver` tables and reuses the `Confidence` and `DistributionKind` vocabularies verbatim. Threshold probabilities against live Kalshi thresholds are a closed-form call on stored parameters — no new engine work.
- **Pitch 6** reads `BacktestRun.aggregates` and `CalibrationBin` directly. `belowFloor` and `projectionCount` exist so that surface can render provisional buckets honestly without recomputing anything.
- **Pitch 7** replaces the engine behind the same `ProjectionResult` contract. The baselines, the harness, the digests, and every metric survive unchanged, which is the point of building the instrument first. `seed` and `rngDraws` exist for the simulation's benefit and are asserted inert until then.
- **Pitch 9** gates trading on the existence of a `completed` `BacktestRun`. The `status` enum and the `_COMPLETE`/row agreement check are what make that gate meaningful rather than decorative.
- **The batch as-of methods** added here become the read path for live slate recomputation in Pitch 5, where a full slate must recompute in seconds.
