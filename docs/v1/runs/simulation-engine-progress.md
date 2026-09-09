# Run Progress — Simulation Engine

Slug: `simulation-engine`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

**Step 8 in progress** — working tickets. Steps 1–7 complete. Feature branch
`feat/simulation-engine`, feature PR #64 open against `main`.

### Ticket log

- **SIG-66 (Foundation)** — branch `feat/SIG-66-foundation` off `feat/simulation-engine`.
  Schema: `ProjectionDecline`, `GameSimulation`, `PlayerOutcomeCorrelation`,
  `ModelSelection` (+ enums), check constraints, composite index for
  model-version-scoped freshest selection, `ModelSelection` seed (all six stat
  types → `baseline-zil-0.1.0`). Single clean migration
  `20260909191831_simulation_engine_foundation`. Python: `sightline_model/simulation/`
  package (`config.py` — `SIMULATION_MODEL_VERSION=simulation-mc-0.1.0`,
  DRAW_COUNT=5000, quantile grid, per-stat PMF support; `seed.py` — deterministic
  per-game `derive_seed` canonicalized to UTC). Import-guard extended with
  simulation-coverage + planted-price self-tests.
  Verify: prisma:validate ✓, migrate applied clean ✓, test:schema 29 ✓,
  typecheck ✓, build ✓, new pytest 10 ✓ + import-graph 20 ✓, full pytest (running).
  **Local-only lint noise:** `prisma/seed-dev-game.ts` (pre-existing UNTRACKED
  file from before this run, not on any branch) has 4 `no-console` errors; my
  committed changes are lint-clean and CI never sees the uncommitted file.

### Test DB note

`TEST_DATABASE_URL` → `localhost:5433/sightline`, a disposable Postgres container
(`docker compose up -d db`). Brought up and migrated (`DATABASE_URL=$TEST_DATABASE_URL
DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy`) so DB-marked pytest runs
instead of erroring on a refused connection.

## Pipeline checklist

- [x] 1. Pull pitch doc from Linear → `docs/v1/pitches/simulation-engine.md`
- [x] 2. Design doc → `docs/v1/design-docs/simulation-engine-design-doc.md`
- [x] 3. UI preview → `docs/v1/ui/simulation-engine-ui-preview.html`
- [x] 4. Spec → `docs/v1/specs/simulation-engine-spec.md`
- [x] 5. Resolve remaining open questions as Resolved Decisions (spec §Resolved Decisions: RD-SIM-1…9)
- [ ] 6. Milestone + Linear issues, chained blockedBy, IDs captured here
- [ ] 7. Feature PR into main
- [ ] 8. Work every ticket in order (branch chain), PR each
- [ ] 9. Runbook → `docs/v1/runbooks/simulation-engine-runbook.md`
- [ ] 10. Squash-merge every ticket PR into the feature branch, in order
- [ ] 11. Full verification suite on the feature branch
- [ ] 12. `/review` feature branch vs main → inline comments on the feature PR
- [ ] 13. `/sightline-review-audit` those comments; implement/defer/discuss/skip
- [ ] 14. Commit, push, re-run full suite. **STOP — do not merge.**
- [ ] 15. Run report → `docs/v1/runs/simulation-engine-report.md`

## Pre-resolved decisions (from the run instruction — approved-doc authority)

1. **Model selection is per stat type.** Each stat type runs on Simulation Engine
   or Pitch-2 baseline, whichever has the stronger validated backtest record.
   Promotion bar: over ≥2 backtested seasons in the contract-like population,
   Simulation Brier beats baseline by **≥0.01 absolute** on **≥500 graded
   predictions**. Every projection carries the id of the model that produced it.
2. **Joint outcomes are produced and exposed, NOT consumed by Position Sizing.**
   Boundary wins over the Open-Q2 recommendation. This pitch builds and persists
   joint-outcome data queryable by game; it does NOT touch Position Sizing's
   ranking/sizing/cap logic. Future integration pitch decides consumption.
3. **Accuracy surface splits by model version** — separate Baseline and Simulation
   Engine records (curves, Brier, sample counts). Optional "Sightline lifetime"
   combined view, clearly labeled, never default. Live-readiness evaluation always
   uses the currently active model's record, never the lifetime blend.
4. **Evidence floor.** Zero relevant historical opportunities → no distribution,
   explicit "insufficient evidence to project" state. One-to-a-handful → project
   wide with low confidence; NO new decline gate (existing confidence-scaled
   sizing drives stake toward zero).
5. **Compact distribution representation.** Continuous stats → quantile grid at
   {1,5,10,25,50,75,90,95,99} with monotone piecewise-linear CDF interpolation.
   Low-count discrete → explicit PMF over 0–4 plus aggregated "5+" tail bucket.
   Neither stores raw draws.
6. **5,000 draws per game**, fixed and versioned in the simulation config,
   vectorized (never a Python per-run loop). (Lighter than the Architecture Doc's
   illustrative 10,000; flagged for human review in the report.)
7. **Seed derivation** deterministic from `(player_id, game_id, model_version,
   information_cutoff)`, never wall-clock/random. Identical inputs → identical
   stored distribution.
8. **Per-layer validation metrics.** Game environment → MAE on total offensive
   plays and pass/rush split per team-game. Usage allocation → MAE on target
   share and carry share over players with a real opportunity. Efficiency →
   evaluated implicitly through final-output error + calibration.
9. **Model version + recalibration handoff.** `simulation-v1` distinct from
   `baseline-v1`; each model version gets its own Probability Recalibration fit.
   Promotion (decision 1) is a model-version change; recalibration refit is a
   separate subsequent action.

Additional: this pitch does NOT run a Dry Run or enable autonomous paper trading —
both remain downstream human-triggered gates in the staking pitch.

## Resolved Decisions (accumulating)

_The spec's Resolved Decisions table is authoritative; new ones appended there and
summarized here as made._

## Ground truth from codebase research (step 1)

### Python side (`python/src/`)

- **Baseline projection engine** — `sightline_model/projection.py`. `project_one(history, *, prior, spec, game_id, kickoff, information_cutoff, computed_at) -> ProjectionResult | Unprojectable`. **Per-player** interface — the harness calls it once per candidate player. The Simulation Engine is inherently **per-game/joint**, so it needs a new game-level entry point that produces all players together; `project_one` cannot be reused as-is.
- **ProjectionResult** (`projection.py`): `model_version` (baseline = `"baseline-zil-0.1.0"`), `distribution_kind`, `params`, `quantiles` (currently q05,q10,q25,q50,q75,q90,q95), `pmf`/`tail_mass`/`zero_mass` (count family), `projected_value` (mean), `projected_median` (q50, the displayed estimate), `interval_low`/`interval_high` (q10/q90), `confidence` (ordinal high/medium/low), `n_eff`, `relative_width`, `drivers` (list[str]), `cohorts` (flags incl. `sparse`, `low_confidence`, `impossible_output`), `computed_at`, `information_cutoff`. **`Unprojectable`** is the explicit decline (reason code) when `n_eff < MIN_ELIGIBLE_GAMES` — this is the mechanism for decision-4's "insufficient evidence to project".
- **Distributions** (`distributions.py`): `ZeroInflatedLogNormal{p_zero, mu, sigma}` (yardage), `NegativeBinomial{r, p, cap}` (counts). Both expose `prob_at_least`, `quantile`, `mean`, `zero_mass`/`mass_below_zero`. Fit by method-of-moments after shrinkage.
- **As-of layer** — `sightline_ingest/asof.py`, `AsOfCorpus(connect, cutoff)`. Sanctioned reads: `trailing_player_stats[_batch]`, `population_stats`, `schedule_as_known`, `game_weather`, `player_context[_batch]`, `latest_injury_designation`. Cutoff applied structurally in SQL (`known_at <= cutoff`), corrections rolled back via lateral subquery. **No sanctioned raw fact read without a cutoff.** Feature code always uses the batch variants.
- **Backtest harness** — `sightline_model/harness.py` `run_backtest()`. Chronological over games ordered by kickoff; `derive_cutoff = min(actual_kickoff, schedule_known_kickoff) - 90min`; two `AsOfCorpus` (lookback for schedule-as-known + cutoff-bound for features); grading via walled-off `GradingCorpus` (never imported by model code). Writes Parquet (`artifacts/backtests/{run_id}/{dataset}/`) then aggregates → `complete_run()` writes `BacktestRun` + `calibration_bins` atomically. BacktestRun carries `model_version`, `code_version`, `seed`, `rng_draws` (0 for baseline/analytic), `engine_config_digest`, `corpus_digest`. Reproducibility via BLAKE2b digests (`digests.py`).
- **Import guard** — `python/tests/test_import_graph.py`. `FORBIDDEN` tuple (~47 tokens) incl. `PriceObservation`, `RecommendationSnapshot`, outcomes SQL forms, paper tables, `recalibration_fits`. Token sweep over both packages + planted-reference and false-positive self-tests. **Extend `FORBIDDEN` + plant/allow tests for the three new modeling layers.**
- **Features** — `sightline_model/features.py` `EligibleHistory` (+ `assemble`/`assemble_batch`). Eligibility: a prior game counts only if its stat line was known at cutoff and non-null. `n_eff` = eligible-game count. Available inputs: 12 stat columns per eligible game + team-at-game; game context via `player_context`. **No PlayByPlay reads yet; baseline uses none.** The Simulation Engine's game-environment + usage layers need new feature helpers, all threading the cutoff through `AsOfCorpus`.
- **Config/versioning** — `sightline_model/constants.py` `engine_config()` (hashed into digest); `MODEL_VERSION`. Baseline is fully analytic (no RNG). Polars throughout; **no NumPy yet** — the vectorized simulation core introduces it.
- **Metrics** — `metrics.py` `compute_aggregates` → `byStatType`/`bySeason`/`byEra`/`contractLike`, Brier + point-estimate blocks. `AGGREGATES_VERSION = 2`.
- **Tests** — `python/tests/`, `pytest.mark.db`, `TEST_DATABASE_URL`. Leakage suite `test_asof_leakage.py` (plant `known_at > cutoff`, assert structurally absent).

### TS side

- **`Projection`** (`prisma/schema.prisma`): `modelVersion` is a **plain String** (no enum). Compound unique `@@unique([playerId, gameId, statType, modelVersion, informationCutoff])` — baseline and simulation projections coexist per (player, game, stat). Fields: `distributionKind` (String, open set), `params` (Json), `pmf` (Json?), `quantiles` (Json), `projectedValue/Median`, `intervalLow/High`, `confidence` (enum high|medium|low), `nEff`, `computedAt`, `informationCutoff`, `drivers` (ProjectionDriver[]).
- **Slate read** (`src/lib/slate/read.ts`): `freshestProjections()` picks the freshest projection per (player, game, stat) across **ANY** modelVersion, ordered `computedAt desc`. **This is the central integration point** — per-stat-type model selection (decision 1) requires it to pick the freshest projection whose `modelVersion` == the active model *for that stat type*. `SlateRowDto` lacks `modelVersion` (add it); `ContractDetailDto` already carries `modelVersion`.
- **Threshold prob** (`src/lib/slate/probability.ts`): `probAtLeast(distribution, threshold)` handles `zero_inflated_lognormal` (params) and `negative_binomial` (pmf). Cross-runtime golden-file parity vs Python. **The Simulation Engine's empirical quantile-grid (continuous) and empirical PMF (discrete) are NEW distribution kinds** needing new interpolation branches here + matching Python + golden fixtures.
- **Accuracy surface** (`src/lib/accuracy/read.ts`): already version-aware. `liveSeries` filters by `model_version`; `backtestSeries` reads latest completed `BacktestRun` (carries `modelVersion`) but `CalibrationBin` rows are **not** segmented by version. `AccuracyDto.calibration` is `CalibrationSeriesDto[]` (never merged; `modelVersion` implicit in `label` only). Scope already has `version` + a `record=live|backtest|compare` axis and a `Version` selector. Needs: explicit `modelVersion` on the DTO, Baseline-vs-Simulation split, optional "Sightline lifetime" combined view (labeled, never default).
- **`RecalibrationFit`** carries `modelVersion` + monotonic `version` + `isActive`; `@@index([modelVersion, fittedAt desc])`. Per-model-version recalibration already supported.
- **Build invariants** (`src/invariants/build-invariants.test.ts`): admin routes call `requireAdmin()` + listed; authenticated routes `force-dynamic`; color literals confined; forbidden-route list. Accuracy is a **shared** read (viewers + admin); overrides sub-route admin-only, absent (not hidden) from viewer payloads.
- **Auth**: `requireSession()` / `requireAdmin()` in `src/lib/auth/session.ts`; status re-read from Postgres per request.
- **Insufficient-evidence** has no current representation — maps to Python `Unprojectable`; needs an explicit stored decline so contract detail shows "insufficient evidence to project" distinct from "no projection yet" (spec-level).

## Linear artefacts (step 6)

**Project:** Sightline V1 · **Milestone:** `Simulation Engine`
(id `64ae3566-b419-45b1-8912-970ab3c8ea2b`)

Work these in order. Each is `blockedBy` the previous one.

| # | Ticket | Title | Branch chain |
| - | ------ | ----- | ------------ |
| 1 | SIG-66 | Foundation: schema, model-version identity, ModelSelection registry, seed derivation, import-guard | off `feat/simulation-engine` |
| 2 | SIG-67 | Layer 1: game-environment model + as-of features + validation | off SIG-66 |
| 3 | SIG-68 | Layer 2: usage-allocation model + coherent normalization + validation | off SIG-67 |
| 4 | SIG-69 | Layer 3 + vectorized joint simulation core + compact dists + joint outcomes + confidence + drivers | off SIG-68 |
| 5 | SIG-70 | Backtest integration + per-layer validation + baseline comparison + promotion-bar | off SIG-69 |
| 6 | SIG-71 | Live production path + persistence + ModelSelection routing + recalibration handoff + promotion tooling | off SIG-70 |
| 7 | SIG-72 | TS integration: provenance, insufficient-evidence, probAtLeast kinds + golden parity, ModelSelection-aware slate, accuracy split | off SIG-71 |

Feature branch: `feat/simulation-engine`
Feature PR: <https://github.com/troyrhodes02/sightline/pull/64> (docs-only at open; ticket PRs merge into it)

Linear note: this team has no "In Review" state — convention is **In Progress + PR attached**.
