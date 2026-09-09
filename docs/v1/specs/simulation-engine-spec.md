# Simulation Engine — Technical Specification

**Feature:** Simulation Engine (second Projection Engine implementation)
**Pitch Source:** Sightline — Pitch: Simulation Engine (`docs/v1/pitches/simulation-engine.md`)
**Design Doc:** `docs/v1/design-docs/simulation-engine-design-doc.md`
**UI Preview:** `docs/v1/ui/simulation-engine-ui-preview.html`
**Upstream references:** `docs/planning/sightline-architecture.md`, `docs/planning/sightline-prd.md`, `docs/planning/sightline-pitch-roadmap.md`, `CLAUDE.md`
**Depends on:** Pitch 1 (Corpus & Point-in-Time Foundation), Pitch 2 (Backtest Harness & Baseline Model), Pitch 4 (Kalshi Sync / Slate), Pitch 6 (Outcome Scoring & Accuracy Surface), Pitch 7 (Bankroll, Sizing & Autonomous Paper Trading — recalibration + sizing consumers, unchanged by this pitch)

---

## Summary

This pitch adds Sightline's real V1 projection model: a three-layer football-process simulator (game environment → usage allocation → efficiency), combined through a **vectorized Monte Carlo game simulation** that produces every participating player's full stat line jointly, per game. From the simulated draws it derives the same compact distribution the baseline already stores — an empirical quantile grid for yardage, an explicit PMF for low-count stats — plus a joint-outcome representation queryable by game.

The engine is a **second, coexisting model version** (`simulation-mc-0.1.0`), not a replacement of the baseline (`baseline-zil-0.1.0`). Both remain permanent. Which model is active is decided **per stat type** by a `ModelSelection` registry driven by validated backtest evidence. Every existing surface — slate, contract detail, edge, recommendation, accuracy, sizing — consumes the active model's projections unchanged, with three small UI additions: model provenance, an "insufficient evidence to project" state, and a per-model-version split on the accuracy surface.

The user-facing footprint is thin; the weight is Python modelling, validation, and reproducibility. Everything the model reads flows through the existing as-of query layer; no layer reads a Kalshi price, a recommendation, or an edge.

## Problem

The baseline (`baseline-zil-0.1.0`) projects each player independently from trailing production and an assumed distribution shape. It cannot reason about game volume, role change, absence redistribution, or the fact that several contracts in one game depend on the same football events. It also gives no principled joint representation of same-game outcomes. And because it is a single opaque per-player fit, a bad projection cannot be traced to a cause.

The Simulation Engine makes the model both **more realistic** (it models the process that produces a stat line, so role change and redistribution fall out of the structure) and **more diagnosable** (each layer has an independent validation metric, so a regression localizes to game-volume, usage, or efficiency). It must earn activation per stat type against the permanent baseline, never by being newer or more elaborate.

## Scope and Non-Scope

### In Scope

- A second Projection Engine: game-environment, usage-allocation, and efficiency layers; a vectorized joint game simulation; compact distributions; joint outcomes; confidence; structural drivers.
- New `model_version` identity `simulation-mc-0.1.0`, coexisting with the baseline.
- `ModelSelection` registry: which model is active per stat type, driven by backtest evidence (RD-1 promotion bar).
- Empirical distribution representations: quantile grid (continuous), explicit PMF (discrete), plus TS threshold-probability rehydration for both, with cross-runtime golden parity.
- Explicit **insufficient-evidence decline** persistence and its surfacing on slate + contract detail.
- Joint-outcome persistence per game (correlations among projected player-stat marginals), queryable by game — **produced and stored, not consumed by Position Sizing** (RD-2).
- Backtest-harness integration: chronological run under the existing point-in-time discipline, per-stat-type/per-season/per-era results, per-layer validation metrics, baseline comparison, promotion-bar computation.
- Seeded reproducibility; a byte-identical stored distribution on re-run.
- Production performance: full-slate recompute well under a minute; single-game recompute in seconds; the slate never waits on a run.
- Accuracy surface per-model-version split with an optional, clearly-labelled combined "Sightline lifetime" view.
- New model-version calibration handoff into the existing Probability Recalibration feature (refit keyed by model version).

### Out of Scope

- Any change to Position Sizing's ranking, sizing, or cap logic — including any consumption of the joint-outcome data this pitch persists (RD-2). Hard per-game and per-slate caps continue to bind, unchanged.
- Adjustment Suggestions, ESPN inactives as a suggestion source, suggestion accept/decline, suggestion reliability analytics.
- Any new late-news ingestion product; any new stat type; any new market data.
- Running a Dry Run or enabling autonomous paper trading — both remain downstream human-triggered gates in the staking pitch, using this pitch's completed, validated model. This pitch builds no mechanism that auto-triggers a Dry Run or flips autonomy on when validation passes.
- Real Kalshi orders; fills; live reconciliation; Kelly-fraction adaptation; probability-ceiling changes; removal of any cap.
- Deleting or rewriting the baseline or its historical projections.
- Running full backtests from the web app.
- Persisting raw simulation draws.

### Named creep temptations (explicitly excluded)

- **Chasing the backtest.** The multi-season validation backtest evaluates a finished model. It is not iterated against until a stat type passes the 0.01/500 bar. Re-tuning a layer, re-running, and checking the bar in a loop is training on the evaluation set and is out of scope (a halt if attempted autonomously).
- **Joint outcomes leaking into sizing.** Building the joint data is in scope; any change to how Position Sizing ranks or caps correlated positions is out of scope and is a halt (RD-2).
- **Distributed compute / a message queue / a worker service** for simulation. Vectorized NumPy on the existing Python runtime meets the budget; anything more is over-engineering for three users and ~300 games.
- **Price or recommendation reads** from any modelling layer, however indirect — out of scope, a halt.

## Core Concepts

- **A projection is a compact distribution from one model version.** The Simulation Engine reuses the existing `Projection` storage. It writes new `distributionKind` values (`empirical_quantiles`, `empirical_pmf`) but the same columns; no migration to `Projection` itself.
- **`baseline-zil-0.1.0` and `simulation-mc-0.1.0` coexist.** The compound key `@@unique([playerId, gameId, statType, modelVersion, informationCutoff])` already permits two projections for the same player/game/stat. Neither overwrites the other. Historical baseline projections remain attributable to the baseline forever.
- **The active model is chosen per stat type, not globally.** `ModelSelection` names, per `StatType`, the `model_version` the application reads and the production pipeline runs. Default: every stat type on the baseline. A stat type flips to simulation only when the run-instruction promotion bar (RD-1) is met, applied by a reviewed change — never inside a tuning loop.
- **Insufficient evidence is a decision, not a gap.** Zero relevant historical opportunity as of the cutoff → the engine writes a `ProjectionDecline`, not a `Projection`. This is distinct from "no projection computed yet" (no row of either kind).
- **Simulation volume is not evidence volume.** Confidence reflects the player's role-history depth and the distribution's relative width, on the same ordinal scale the baseline uses — never inflated because 5,000 draws feel precise.
- **Joint outcomes are produced and exposed, not consumed.** Persisted per game and queryable; Position Sizing does not read them in this pitch.
- **`computedAt` and `informationCutoff` are two timestamps**, both carried on every projection and every decline, exactly as the baseline carries them.
- **The simulation is seeded per game.** Reproducibility is a property of the computation given `(game_id, model_version, information_cutoff)`, not of luck.
- **Prices never feed the model.** No modelling or simulation module may import a path that reaches `PriceObservation`, `RecommendationSnapshot`, or Sightline's computed edge. Enforced by the Python import-graph guard, extended to every new module.

### Distinctions to preserve

- **Game environment vs. usage vs. efficiency** are three separately-validated concepts. A material role change moves usage without a hand-authored final-stat override; a usage increase for one player draws opportunity away from teammates through the allocation normalization, not independently.
- **Model improvement vs. calibration refit** stay analytically distinct. Promotion (a `ModelSelection` change) is one action; refitting `RecalibrationFit` for the new model version is a separate, subsequent one.
- **The baseline is a permanent comparator**, not a fallback to be demoted. The `BASE` provenance indicator carries no visual demotion.

### Ownership

Every entity in this pitch is **shared reference/model data** with no per-user partition — projections, declines, game simulations, correlations, model selections, backtest runs, calibration bins, recalibration fits. There is no `userId` anywhere in this pitch. `Decision` and `Position` are untouched.

## States and Lifecycle

### Enums

```prisma
// NEW — the reason a projection was declined.
enum ProjectionDeclineReason {
  insufficient_evidence   // zero relevant opportunity as of cutoff (RD-4)
}

// NEW — correlation method for joint outcomes.
enum CorrelationMethod {
  spearman
}
```

Reused, unchanged: `StatType` (`passing_yards`, `rushing_yards`, `receiving_yards`, `receptions`, `rushing_tds`, `receiving_tds`), `Confidence` (`high|medium|low`), `WeatherEra`, `BacktestStatus`, `EvaluationWindow`.

### Per-game production lifecycle (live pipeline)

```text
game recompute triggered (existing Live Pipeline path, per game, off the request path)
  └─ derive information_cutoff (existing kickoff-minus-90m policy)
  └─ for each stat type whose ModelSelection.model_version == simulation:
       └─ assemble as-of features (game-environment, usage, efficiency) via AsOfCorpus
       └─ seed = derive_seed(game_id, model_version, information_cutoff)
       └─ simulate_game(...) → per-player joint draws (vectorized, 5,000)
       └─ per player/stat:
            ├─ enough evidence → write Projection (empirical dist + drivers + confidence)
            └─ zero relevant evidence → write ProjectionDecline(insufficient_evidence)
       └─ write GameSimulation + PlayerOutcomeCorrelation (joint outcomes)
  (stat types on the baseline continue to run the baseline engine unchanged)
```

Idempotence: a re-run with the same `(game_id, model_version, information_cutoff)` produces byte-identical `Projection` distributions (seeded) and upserts on the compound keys — no duplicates, no drift.

### Backtest lifecycle

The existing harness lifecycle (`running → completed`, atomic `complete_run`) is reused. A simulation backtest run carries `model_version = simulation-mc-0.1.0`, a non-zero `seed`, and `rng_draws = 5000`. Per-layer validation artifacts are written to Parquet alongside predictions; aggregates gain per-layer blocks (`aggregatesVersion` bump).

### Promotion lifecycle (human-reviewed, out of the app)

```text
run validation backtest (≥2 seasons, contract-like population)  ── human, local, hours
  └─ per stat type: simulation Brier vs baseline Brier on ≥500 graded predictions
       └─ if simulation beats baseline by ≥0.01 absolute AND n ≥ 500:
            └─ eligible for promotion
  └─ reviewed apply: update ModelSelection[stat_type] = simulation, recording
     backtest_run_id + brier_delta + sample_size
  └─ refit RecalibrationFit for simulation-mc-0.1.0 (separate, subsequent step)
  └─ (later, in the staking pitch, a human runs a fresh Dry Run before autonomy)
```

The application never performs promotion automatically and never triggers the backtest. Promotion is a reviewed data change (a seed/script update), gated on evidence.

## Determinism and reproducibility contract

- **R1 — Per-game seed.** `derive_seed(game_id, model_version, information_cutoff) = int.from_bytes(blake2b(f"{game_id}|{model_version}|{information_cutoff.isoformat()}".encode(), digest_size=8).digest(), "big")`. No wall-clock, no OS entropy, no `Math.random`. The RNG is `numpy.random.default_rng(seed)`.
- **R2 — Joint stream, not per-player.** The whole game is drawn from one seeded generator so within-game correlation is real. RD-7 lists `player_id` in the reproducibility identity; because the simulation is **joint per game**, the RNG is seeded at the game level and each player's marginal is a deterministic function of that one run. Per-player seeding is explicitly rejected — it would destroy the joint structure the Definition of Done requires. `player_id` is part of the stored prediction's identity, not an independent seed input. (Resolved Decision RD-SIM-7, refining RD-7 with rationale.)
- **R3 — Byte-identical stored distribution.** Re-running an identical historical prediction (same player, game, model version, cutoff, seed derivation, code version) yields a byte-identical stored quantile grid / PMF. Tested directly.
- **R4 — Deterministic reductions.** Quantile estimation, PMF binning, and correlation computation use fixed, order-independent NumPy reductions. Draw ordering is fixed by the seeded generator; no set/dict iteration feeds a numeric result.
- **R5 — Backtest reproducibility.** A simulation backtest over an unchanged corpus reproduces its `predictions_digest`, `aggregate_digest`, and `calibration_digest`, exactly as the baseline harness already guarantees. `seed` and `rng_draws` are recorded on `BacktestRun` and are part of the run's identity, not its digest-excluded fields.

## Data Model

### Relationship to existing schema

- **`Projection`** — reused with no column change. New `distributionKind` values only. `quantiles` JSON carries the 9-point grid `{q01,q05,q10,q25,q50,q75,q90,q95,q99}`; `pmf` JSON carries the explicit mass vector; `params` carries summary stats (`mean`, `sd`, `zeroMass`) for inspection. `modelVersion = "simulation-mc-0.1.0"`.
- **`ProjectionDriver`** — reused; simulation drivers are `ProjectionDriver` rows ordered by `rank`.
- **`BacktestRun` / `CalibrationBin`** — reused; a simulation run is another row with its own `modelVersion`, `seed`, `rng_draws`, `aggregates`. Calibration bins are tied to their run (which carries the version), so per-model-version calibration is selected by run — no `modelVersion` column added to `CalibrationBin`.
- **`RecalibrationFit`** — reused; already keyed by `modelVersion`. The simulation model gets its own fit.

### New models

```prisma
// A projection the engine explicitly declined to produce, for want of evidence.
// Distinct from the ordinary absence of any projection row. (RD-4)
model ProjectionDecline {
  id                String                  @id @default(uuid())
  playerId          String
  gameId            String
  statType          StatType
  modelVersion      String
  reason            ProjectionDeclineReason
  informationCutoff DateTime
  computedAt        DateTime
  createdAt         DateTime                @default(now())

  player Player @relation(fields: [playerId], references: [id])
  game   Game   @relation(fields: [gameId], references: [id])

  @@unique([playerId, gameId, statType, modelVersion, informationCutoff])
  @@index([gameId, statType])
}

// One vectorized joint game simulation. Metadata only — raw draws are never stored.
model GameSimulation {
  id                String   @id @default(uuid())
  gameId            String
  modelVersion      String
  informationCutoff DateTime
  computedAt        DateTime
  seed              BigInt   // the derived per-game seed (R1)
  drawCount         Int      // versioned config value (5000)
  createdAt         DateTime @default(now())

  game        Game                       @relation(fields: [gameId], references: [id])
  correlations PlayerOutcomeCorrelation[]

  @@unique([gameId, modelVersion, informationCutoff])
  @@index([gameId])
}

// A compact joint-outcome fact: the correlation between two player-stat marginals
// within one simulated game. Bounded to the projected marginals in the game.
// PRODUCED AND STORED, NOT CONSUMED BY POSITION SIZING (RD-2).
model PlayerOutcomeCorrelation {
  id               String            @id @default(uuid())
  gameSimulationId String
  playerAId        String
  statA            StatType
  playerBId        String
  statB            StatType
  method           CorrelationMethod @default(spearman)
  correlation      Decimal           @db.Decimal(6, 5) // [-1, 1]

  gameSimulation GameSimulation @relation(fields: [gameSimulationId], references: [id], onDelete: Cascade)

  @@unique([gameSimulationId, playerAId, statA, playerBId, statB])
  @@index([gameSimulationId])
}

// The active model per stat type. Single source of truth read by BOTH runtimes.
// Changed only by a reviewed script/migration, never by the app (RD-1).
model ModelSelection {
  statType     StatType @id
  modelVersion String
  // Evidence justifying the current selection (null while on the default baseline).
  backtestRunId String?
  brierDelta    Decimal? @db.Decimal(6, 4) // baseline Brier − simulation Brier (positive = simulation better)
  sampleSize    Int?
  note          String?
  promotedAt    DateTime @default(now())
  updatedAt     DateTime @updatedAt

  backtestRun BacktestRun? @relation(fields: [backtestRunId], references: [id])

  @@index([modelVersion])
}
```

### Seed data (migration)

`ModelSelection` is seeded with all six stat types on the baseline:

```text
passing_yards   → baseline-zil-0.1.0
rushing_yards   → baseline-zil-0.1.0
receiving_yards → baseline-zil-0.1.0
receptions      → baseline-zil-0.1.0
rushing_tds     → baseline-zil-0.1.0
receiving_tds   → baseline-zil-0.1.0
```

No stat type ships promoted. Promotion is applied only after the human-run validation backtest clears the bar.

### Raw SQL constructs

- Check constraint on `PlayerOutcomeCorrelation.correlation` ∈ [-1, 1].
- Check constraint on `GameSimulation.drawCount > 0` and `seed >= 0`.
- Partial index on `Projection` by `(gameId, statType, modelVersion, computedAt desc)` to make model-version-scoped freshest-projection selection efficient (the slate's hot path).

### Derived, never stored

- Threshold probability `P(≥ t)` — rehydrated on read from the stored quantile grid / PMF, both runtimes.
- Live edge, recommendation status, staleness — unchanged, computed on read.
- Any pairwise correlation not among projected marginals — derivable but not stored (bounded set only).

## Model specification (normative)

This section is the modelling contract. Exact hyperparameters live in `engine_config()` and are versioned into the model-version digest; changing one requires a new model version.

### Simulation configuration (`simulation-mc-0.1.0`)

| Key | Value | Note |
| --- | ----- | ---- |
| `modelVersion` | `simulation-mc-0.1.0` | `<engine>-<core>-<semver>`; matches repo convention (`baseline-zil-0.1.0`). |
| `drawCount` | `5000` | RD-6. Vectorized; part of the versioned config. |
| `seedPolicy` | `game_blake2b/v1` | R1. |
| `quantileGrid` | `[0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99]` | RD-5. |
| `pmfSupport` | `{ rushing_tds: 4, receiving_tds: 4, receptions: 15 }` | K per stat; PMF over 0..K plus a `(K+1)+` tail bucket. See RD-SIM-5. |
| `evidenceFloor` | `1 relevant opportunity` | Below → `ProjectionDecline(insufficient_evidence)` (RD-4). |

### RD-SIM-5 — PMF support is per stat type

RD-5 specifies "0 through 4 plus a 5+ tail," written for touchdowns. Receptions is a count stat whose Kalshi thresholds reach 8.5; a 0–4+5+ PMF cannot answer `P(≥ 5.5)`…`P(≥ 8.5)`, contradicting the Definition of Done ("the probability of clearing an arbitrary supported threshold is derivable"). Resolution: the explicit PMF support is per stat type — `K = 4` (+`5+`) for the two touchdown stats, `K = 15` (+`16+`) for receptions — preserving the explicit-mass, large-zero-mass intent of RD-5 while keeping every listed threshold answerable. Yardage stats use the quantile grid, not a PMF. Recorded as a Resolved Decision.

### Layer 1 — Game environment

- **Target:** per team-game, expected **pass attempts** and **rush attempts** (from which total offensive plays derive), plus a residual dispersion for simulation.
- **Model:** a gradient-boosting regressor (the sanctioned gradient-boosting library) with two targets, fit offline on historical team-games. Simulation draws attempts from a Negative-Binomial parameterized by the predicted mean and a fitted dispersion; a shared **game-pace latent** and a shared **pass-lean latent** (standard-normal draws common to both teams in a game) induce realistic within-game correlation between the two teams' volumes.
- **Features (all as-of cutoff, via `AsOfCorpus`):** each team's trailing plays-per-game, pass rate, seconds-per-play proxy; opponent trailing plays and pass rate allowed; rest days; venue/dome; weather (era-aware — archived forecast 2021+, reanalysis earlier, era recorded); home/away. **No season-level aggregate; no current roster/team join; no price.**
- **Validation metric (RD-8):** MAE between predicted and observed total offensive plays, and separately between predicted and observed pass/rush attempt split, per team-game.

### Layer 2 — Usage allocation

- **Target:** per eligible player, expected **target share** (of team pass attempts) and **carry share** (of team rush attempts).
- **Model:** predict a per-player usage score from trailing usage (as-of), role/position, and availability (injury designation known at cutoff); normalize scores **within team** to shares summing to 1 over available players (softmax over the predicted scores, an absent player's score forced to −∞ → zero share). Redistribution on absence is structural: removing a player renormalizes the remainder. A per-team **replacement pool** absorbs share for stat coherence so allocations never exceed team opportunity.
- **Simulation:** given a draw's pass/rush attempts, per-player target and carry counts are drawn `Multinomial(pass_attempts, target_shares)` and `Multinomial(rush_attempts, carry_shares)`. Multinomial draws make teammates' opportunities compete — the within-team negative correlation.
- **Validation metric (RD-8):** MAE between predicted and observed target share and carry share, computed **only over players who recorded a real opportunity** in that game.

### Layer 3 — Efficiency

- **Target:** production per opportunity — yards per target and catch rate (receiving), yards per carry (rushing), yards per attempt and TD rate (passing), TD rate per carry/target.
- **Model:** per-player efficiency with **shrinkage to walk-forward position priors** (the existing prior machinery), so sparse players regress to their position. Kept strictly separate from usage.
- **Simulation:** given opportunity counts, production is drawn from the efficiency distributions per opportunity (e.g., receiving yards = Σ over targets of `catch ~ Bernoulli(catch_rate)` × `yards ~ LogNormal(...)`), vectorized across the 5,000 draws. TDs drawn as low-rate Bernoulli/Binomial per opportunity → the large zero mass the PMF preserves.
- **Validation:** evaluated implicitly through final-output point-estimate error and calibration (RD-8) — efficiency has no clean intermediate observable the way plays and shares do.

### Compact distribution derivation

From the 5,000 per-player draws for a stat:

- **Yardage → `empirical_quantiles`:** `numpy.quantile(draws, quantileGrid)` → the 9-point grid; `params = {mean, sd, zeroMass}`. Threshold prob later by monotone piecewise-linear interpolation on the implied CDF (see rehydration).
- **Counts → `empirical_pmf`:** histogram of draws over `0..K` with a `(K+1)+` tail bucket → the mass vector; `params = {mean, zeroMass}`. Threshold prob by summing tail mass.

Raw draws are discarded after derivation.

### Confidence (RD-4)

Ordinal `high|medium|low`, reusing the baseline's bands, driven by the player's **relevant role-history depth** (`n_eff` of the usage history establishing the current role) and the distribution's **relative width** — never by the draw count. Zero relevant opportunity → no projection, a decline. One-to-a-handful → wide distribution, `low` confidence, no new decline gate (the existing confidence-scaled sizing drives stake toward zero).

### Drivers (from structure, not narration)

Three-to-five deterministic sentences per projection, ordered by absolute contribution to the projected mean, each naming a real layer output: expected game volume vs. the team's norm; expected usage vs. the player's recent role; expected efficiency vs. his trailing form; material situational context (weather/rest/venue). No driver references a value the simulation did not use. Same contract the baseline drivers already meet.

### Insufficient-evidence decline (RD-4)

If, as of the information cutoff, the player has **zero recorded snaps, targets, or carries** establishing him in this role, the engine writes a `ProjectionDecline(insufficient_evidence)` instead of a `Projection`. This reuses the baseline's `Unprojectable` return internally; the difference is that production persists the decline so the surface can distinguish it from "no projection yet."

## Authorization and Access Control

- **Shared reads** (any authenticated session): the slate provenance indicator, contract-detail provenance and insufficient-evidence block, and the accuracy per-model-version split are all on shared surfaces. No role gate beyond an active session.
- **No new admin surface, no new mutation route.** Model selection changes via a reviewed script, not the app; there is no route that writes `ModelSelection`, `Projection`, `GameSimulation`, or any modelling entity from a user request.
- **The Python runtime** writes all modelling entities via its service-role direct connection, exactly as the baseline does. No user request reaches that credential.
- **Prices stay out of the model** — enforced structurally by the import-graph guard, not by a runtime check.

## Route Handlers and API Surface

No new route handlers with side effects. Changes are read-path only:

- **`GET /api/slate`** (existing) — `SlateRowDto` gains `modelVersion: string | null` and `projectionState: "projected" | "insufficient_evidence" | "none"`. Freshest-projection selection becomes `ModelSelection`-aware (below).
- **`/slate/[contractId]`** server read (existing) — `ContractDetailDto` gains `projectionState` and `declineReason`; `modelVersion` already present. Distribution rendering branches on the broader `distributionKind` set.
- **`GET /api/accuracy`** / `/accuracy` server read (existing) — scope `version` axis gains a `lifetime` sentinel; `CalibrationSeriesDto` gains `modelVersion`; `record=compare` overlays the two models. `readAccuracy` selects the backtest run and live series by the resolved model version, and computes the combined series only when `version=lifetime` is explicit.

### `ModelSelection`-aware freshest projection

`freshestProjections` (slate hot path) changes from "freshest across any model version" to "freshest whose `modelVersion` equals `ModelSelection[statType].modelVersion`." A single `ModelSelection` read per request (six rows, cacheable per request) supplies the mapping. When the active model has no projection but a `ProjectionDecline` exists for it → `projectionState = "insufficient_evidence"`. When neither exists → `projectionState = "none"` (unchanged behaviour). This is the only behavioural change to an existing hot path and is covered by the busiest test file.

## Threshold-probability rehydration (both runtimes, golden parity)

`probAtLeast` (TS `src/lib/slate/probability.ts`; Python `distributions`) gains two branches, kept byte-parity via the existing golden fixture:

- **`empirical_quantiles`:** build the implied CDF from the stored `(quantile, value)` points; `P(≥ t)` = `1 − CDF(t)` by **monotone piecewise-linear interpolation** between the two bracketing quantile points. Below `q01` the CDF clamps toward 0 (floor at value 0 for non-negative stats); above `q99` it clamps toward 1. Ties and non-strictly-increasing grids are handled by nudging to strict monotonicity before interpolation.
- **`empirical_pmf`:** `P(≥ t)` = sum of PMF mass at indices `≥ ceil(t)`, where the tail bucket `(K+1)+` contributes fully to any threshold `≤ K+1`. Thresholds above the supported range are a config error surfaced at ingest, not silently zero (the per-stat `K` is chosen to cover every listed threshold).

The golden fixture gains cases for both kinds; the TS↔Python parity test asserts identical results to the fixture's tolerance.

## UI Data Contracts

```typescript
// src/lib/dto/slate.ts
export type ProjectionState = "projected" | "insufficient_evidence" | "none";

export type SlateRowDto = {
  // …existing…
  modelVersion: string | null;      // NEW — drives SIM/BASE provenance chip
  projectionState: ProjectionState; // NEW — "insufficient_evidence" is a designed state
};

export type ContractDetailDto = SlateRowDto & {
  // …existing incl. modelVersion, quantiles, pmf, distributionKind, drivers…
  projectionState: ProjectionState; // NEW
  declineReason: string | null;     // NEW — human-readable; set only when insufficient_evidence
};

// src/lib/dto/accuracy.ts
export type CalibrationSeriesDto = {
  // …existing label, kind, buckets, denominators…
  modelVersion: string | "lifetime" | null; // NEW — explicit, not implied by label
};
export type AccuracyScope = {
  // …existing…
  version: string | "all" | "lifetime"; // "lifetime" combines; never the resolved default
};
```

- **`modelProbability === null` with `projectionState === "insufficient_evidence"`** is a distinct state from `projectionState === "none"`; the UI and DTO must keep them apart (an amber "insufficient evidence" chip vs. the ordinary "—").
- The provenance indicator never renders the raw `model_version` string to the user; it maps `simulation-mc-0.1.0 → SIM/Simulation Engine`, `baseline-zil-0.1.0 → BASE/Baseline`.

## Validation Rules

- **Warn, don't block:** a slate of all-`insufficient_evidence` rows, a stat type on the baseline, a model with too few graded predictions to calibrate — all are legitimate displayable states.
- **Block / halt (invariants):** any modelling module importing a price/recommendation/edge path; any feature computed from a season-level aggregate or a current-roster backward join; any reconstructed availability timestamp resolved earlier than its documented conservative window; any attempt to consume joint outcomes in Position Sizing; any auto-trigger of a Dry Run or autonomy flip.
- **`ModelSelection` integrity:** exactly one row per stat type; `modelVersion` must be a known version; a promotion row must carry `backtestRunId`, `brierDelta`, and `sampleSize`.
- **Correlation bounds:** stored correlations ∈ [-1, 1]; only among projected marginals in the game.

## Testing Strategy

Ordered by the codebase's testing priorities; the first two are the gate.

### 1. Temporal leakage — adversarial, extended to the three new layers (Python, first)

The existing `test_asof_leakage.py` passes **unchanged**. New adversarial cases, each constructing the leak and proving it is blocked:

- A **game-environment feature computed from a full-season aggregate** (e.g., season total plays joined to a mid-season game) is caught — the feature helper cannot obtain a season aggregate through `AsOfCorpus`, and a test plants one and asserts the pipeline refuses/omits it.
- A **usage-allocation feature joining current roster state backward** into a historical game is caught — history follows the player; a planted current-team join is asserted absent.
- A **reconstructed availability timestamp resolved earlier than its documented conservative window** is caught — a planted early `known_at` is rejected by the reconstruction rule's floor.
- A projection for a past game is **identical whether computed then or now** (the canonical leakage assertion), now also for the simulation model version.

### 2. Prices never feed projections (structural, Python)

`test_import_graph.py` extended: every new modelling module (game-environment, usage, efficiency, simulation core, validation harness integration, seed util) is added to the sweep; `FORBIDDEN` unchanged in intent (price/recommendation/edge tokens); planted-reference self-tests assert a price read in any new module trips the guard; false-positive tests keep legitimate vocabulary passing.

### 3. Reproducibility (Python)

- **R3 byte-identical:** run one historical prediction twice with the same `(game_id, model_version, information_cutoff)`; assert byte-identical stored quantile grid / PMF.
- **R5 digest stability:** a small simulation backtest over a fixed fixture corpus reproduces its digests.

### 4. Vectorization (Python)

A structural assertion that the simulation core executes as array operations across the full draw count, not a Python loop per run — asserted by (a) a source check that `simulate_game` contains no `for` loop over `range(drawCount)` / per-draw iteration, and (b) a shape/timing check that the draw axis is a single NumPy dimension of length `drawCount`.

### 5. Model behaviour and sparse data (Python)

- Zero relevant opportunity → `ProjectionDecline(insufficient_evidence)`, no `Projection`.
- One-to-a-handful opportunities → a `Projection` with `low` confidence and a wide interval; confidence is **not** inflated by the draw count.
- Low-count TD stats retain large zero mass in the PMF; extreme game context widens the distribution rather than narrowing it.
- Usage shares within a team sum coherently and never allocate more opportunity than the team has.

### 6. Joint outcomes (Python)

- A game simulation persists `GameSimulation` + `PlayerOutcomeCorrelation` for projected marginals; correlations ∈ [-1, 1]; a QB passing-yards and his WR receiving-yards marginals show positive correlation; two RBs' carry-share marginals show negative correlation (competing usage).
- Joint outcomes are queryable by game and are **not** read by any Position Sizing module (import-graph assertion that sizing does not import the correlation table).

### 7. Backtest, per-layer validation, baseline comparison (Python)

- A simulation run writes `BacktestRun(model_version=simulation-mc-0.1.0, seed≠0, rng_draws=5000)`, per-stat-type/per-season/per-era calibration bins, and per-layer validation blocks (game-environment MAE, usage-share MAE).
- The aggregates expose Brier per stat type for both models over the same contract-like population, and the promotion-bar computation (≥0.01 and ≥500) is a pure function tested on fixtures.
- **Model-version attribution:** promoting one stat type (flipping its `ModelSelection`) does not alter the `model_version` attribution of any other stat type's historical baseline projections — tested directly.

### 8. TS integration (Jest)

- `probAtLeast` new kinds match the golden fixture (TS↔Python parity).
- `freshestProjections` selects by `ModelSelection` per stat type; a decline surfaces as `insufficient_evidence`; absence surfaces as `none`.
- Slate + contract-detail DTOs carry `modelVersion` and `projectionState`; provenance maps versions to `SIM`/`BASE`, never the raw string.
- Accuracy: two model versions render as separate series; `version=lifetime` combines and is labelled and never the resolved default; a model with no graded data shows insufficient-sample, not a silent fallback.
- Build invariants: no new stylesheet/color-literal violation; accuracy stays a shared read; no forbidden route added.

### 9. Role enforcement

Accuracy and slate remain shared reads; no admin route is added, so the existing admin-route guard list is unchanged. A test asserts no modelling entity is exposed by a viewer-forbidden route (none exists).

## Acceptance Criteria

### Engine and distributions
1. `simulate_game` produces every participating player's stat line jointly per game, vectorized across 5,000 draws with no per-run Python loop.
2. Yardage stored as a 9-point empirical quantile grid; low-count stats as an explicit PMF with per-stat support covering every listed threshold; raw draws never persisted.
3. `P(≥ arbitrary threshold)` is derivable from the stored representation without re-simulating, in both runtimes, matching the golden fixture.
4. Zero relevant evidence → `ProjectionDecline(insufficient_evidence)`; sparse evidence → wide, `low`-confidence projection with no new decline gate.
5. Every projection carries `computedAt`, `informationCutoff`, `modelVersion`, `confidence`, and structural drivers.

### Joint outcomes
6. `GameSimulation` + `PlayerOutcomeCorrelation` persist per game, queryable by game, bounded to projected marginals; correlations ∈ [-1, 1].
7. No Position Sizing module reads the joint-outcome data (RD-2), asserted structurally.

### Per-layer validation & baseline comparison
8. Game-environment MAE (plays, pass/rush split) and usage-share MAE (over players with a real opportunity) are reported per run; a final regression is localizable to a layer.
9. A chronological backtest under the existing point-in-time discipline reports simulation calibration, point-estimate error, and Brier vs. baseline, per stat type and per season, with weather-era reporting preserved.
10. The promotion-bar computation (≥0.01 absolute Brier improvement on ≥500 graded predictions over ≥2 seasons, contract-like population) is a tested pure function; promotion is applied only by a reviewed `ModelSelection` change.

### Reproducibility & versioning
11. Re-running an identical historical prediction reproduces a byte-identical stored distribution.
12. `simulation-mc-0.1.0` is a distinct model version; baseline projections remain attributable to the baseline; promoting one stat type does not change another's attribution.
13. `RecalibrationFit` refits for the new model version as a separate step from promotion; the two remain analytically distinguishable.

### Application integration
14. Slate and contract detail show model provenance (`SIM`/`BASE`) and the insufficient-evidence state; the slate never waits on a model run.
15. `freshestProjections` selects the active model per stat type via `ModelSelection`.
16. The accuracy surface shows Baseline and Simulation Engine as separate records with their own curves, Brier, and both denominators; a labelled non-default "Sightline lifetime" combined view exists; live-readiness reads the active model's own record.
17. Full-slate recompute completes well under a minute and single-game in seconds under the approved workload; the app never triggers a full backtest.

### Invariants
18. No modelling/simulation module reads a price, recommendation, or edge — import-graph enforced.
19. The extended temporal-leakage suite catches a season-aggregate feature, a current-roster backward join, and an over-early reconstructed timestamp; the existing suite passes unchanged.
20. No Dry Run is run and autonomous paper trading is not enabled by this pitch.

## Explicit Non-Goals

- **Permanent (from the Brief):** sportsbook/DFS integration; public/commercial access; live in-game trading; film/tape features; viewers trading through the app; general sports-data browsing.
- **Deferred (from the PRD):** joint-outcome consumption in Position Sizing (a future integration pitch, RD-2); NBA/WNBA; additional stat types; additional suggestion sources; bankroll/portfolio redesign.
- This pitch adds no app control for tuning modelling parameters, no upload surface, no new secret, and no new scheduled job beyond the existing live-pipeline recompute path invoking the active engine.

## Resolved Decisions

The run-instruction pre-resolved decisions (RD-1…RD-9) are authoritative and restated in the run progress file. Decisions made or concretized in this spec:

| # | Decision | Rationale |
| - | -------- | --------- |
| RD-SIM-1 | Model version string is `simulation-mc-0.1.0` (engine=simulation, core=monte-carlo), not the literal `simulation-v1`. Baseline stays `baseline-zil-0.1.0`. | Matches the repo's `<engine>-<core>-<semver>` convention; `simulation-v1`/`baseline-v1` in the instruction are conceptual labels. Provenance UI maps the concrete string to `SIM`/`Simulation Engine`. |
| RD-SIM-2 | The active model per stat type lives in a DB `ModelSelection` table read by both runtimes, changed only by a reviewed script. | Single source of truth avoids TS/Python config divergence; a reviewed data change is exactly the "reviewed and applied" promotion the instruction requires; not app-tunable (respects the no-in-app-tuning boundary). |
| RD-SIM-3 | Insufficient-evidence declines persist in a dedicated `ProjectionDecline` table, not as a nullable-distribution `Projection`. | Keeps "a Projection is a real distribution" true; makes the decline explicit and distinct from "no projection yet," which the UI must distinguish. |
| RD-SIM-4 | Joint outcomes persist as `GameSimulation` + `PlayerOutcomeCorrelation` (pairwise Spearman among projected marginals), bounded to projected marginals. | Queryable by game, compact, no raw draws; a low-cardinality, honest joint representation. Consumption deferred (RD-2). |
| RD-SIM-5 | PMF support is per stat type: `K=4` (+5+) for TDs, `K=15` (+16+) for receptions; yardage uses the quantile grid. | RD-5's literal "0–4+5+" was written for TDs and cannot answer receptions' 8.5 threshold; per-stat `K` preserves RD-5's explicit-mass intent while satisfying the DoD's arbitrary-threshold requirement. |
| RD-SIM-6 | New empirical `distributionKind`s (`empirical_quantiles`, `empirical_pmf`) reuse `Projection`'s existing JSON columns; no `Projection` migration. | The architecture already designed `Projection` to store a compact distribution generically; the simulation output fits it. |
| RD-SIM-7 | The simulation is seeded per game from `(game_id, model_version, information_cutoff)`; `player_id` is part of the prediction's identity, not an independent seed input. | Joint simulation requires a shared per-game RNG stream; per-player seeding would destroy the within-game correlation the DoD requires. Honors RD-7's determinism intent with rationale. |
| RD-SIM-8 | Per-model-version calibration is selected by `BacktestRun`/live `model_version` filter, not by adding `modelVersion` to `CalibrationBin`. | The run already carries the version; live grades already filter by `p.model_version`; no schema change needed for the split. |
| RD-SIM-9 | The default `ModelSelection` ships every stat type on the baseline; no stat type is promoted by this run's code. | Promotion depends on the human-run multi-season validation backtest (pitch sequencing); shipping promoted would assert evidence not yet gathered. |

### Inherited, deliberately not resolved here

- Ask-vs-midpoint for edge (unchanged from the Slate/Kalshi pitch).
- Settlement-vs-official-line as grading truth (unchanged from Outcome Scoring).
- Point-estimate policy (median displayed; unchanged from the baseline cleanup).

## Open Questions

None blocking. The numeric defaults introduced here — the 0.01/500 promotion bar, the 5,000-draw count, and the quantile-grid percentiles — were supplied by the run instruction and are flagged in the run report for explicit human review, since none was specified in the approved docs.

## Implementation breakdown

See the Linear milestone. PR-sized chunks, chained `blockedBy`:

1. **Foundation** — schema (`ProjectionDecline`, `GameSimulation`, `PlayerOutcomeCorrelation`, `ModelSelection` + seed), simulation config + model-version identity, seed derivation util, import-graph extension.
2. **Game-environment layer** — features (as-of), the play-volume/pass-rush model, offline fit, its simulation-facing distribution, per-team-game validation metric, layer leakage tests.
3. **Usage-allocation layer** — target/carry-share model, coherent within-team normalization + absence redistribution, validation metric, layer leakage tests.
4. **Efficiency layer + vectorized joint simulation core** — efficiency models with shrinkage, `simulate_game` (5,000, vectorized), compact-representation derivation, joint correlations, confidence + structural drivers, insufficient-evidence decline, reproducibility + vectorization tests.
5. **Backtest integration + validation + baseline comparison** — game-level model protocol into the harness, chronological run, per-layer validation blocks, per-stat-type/season/era + Brier-vs-baseline, promotion-bar function, reproducibility/attribution tests.
6. **Live production path + recalibration handoff + promotion tooling + runbook** — game-level recompute + persistence, `ModelSelection`-driven engine routing, performance, `RecalibrationFit` refit for the new version, the reviewed promotion script, the runbook.
7. **TS integration** — provenance + insufficient-evidence on slate/detail, `probAtLeast` new kinds + golden parity, `ModelSelection`-aware freshest selection, accuracy split + lifetime + `CalibrationSeriesDto.modelVersion`, build invariants.
