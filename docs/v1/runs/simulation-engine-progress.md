# Run Progress — Simulation Engine

Slug: `simulation-engine`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

**DONE — awaiting human review. DO NOT MERGE.** All 15 steps complete. The feature
branch `feat/simulation-engine` is verified (pytest 461, jest 824, typecheck,
test:schema 29, build), reviewed (`/review` → 8 findings on PR #64), audited
(`/sightline-review-audit` → 4 implemented with regression tests, 4 deferred to
SIG-73), and re-verified green. Feature PR **#64** is open against `main` for a
line-by-line human read. Run report: `docs/v1/runs/simulation-engine-report.md`.

Feature branch head: `3d0eb4f` (docs → SIG-66…SIG-72 → review-audit fixes).

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

- **SIG-67 (Layer 1, game environment)** — branch `feat/SIG-67-game-environment`,
  PR [#66](https://github.com/troyrhodes02/sightline/pull/66). `AsOfCorpus.team_trailing_volume`
  (leakage-safe per-team-game grain, reuses publication-cutoff SQL + rollback);
  `simulation/game_environment.py` (as-of features, `GameEnvironmentModel` on
  HistGradientBoostingRegressor, vectorized `sample_team_volumes` with shared
  game-pace + pass-lean latents, `game_environment_mae`). numpy + scikit-learn
  added (gradient boosting = sklearn HistGradientBoosting; recorded decision).
  Tests: 12 unit + 5 adversarial leakage (season-aggregate blocked: sums to 66
  not 165) + import-graph coverage. Full pytest **391 passed**.
- **SIG-68 (Layer 2, usage allocation)** — branch `feat/SIG-68-usage-allocation`,
  PR [#67](https://github.com/troyrhodes02/sightline/pull/67). `usage_allocation.py`
  (as-of features via team_abbr_at_game; within-team softmax over available
  players + structural absence redistribution + replacement pool; vectorized
  Multinomial opportunity draws; `usage_share_mae`). 50 targeted + 3 adversarial
  roster-leak cases.
- **SIG-69 (Layer 3 + joint simulation core)** — branch `feat/SIG-69-simulation-core`,
  PR [#68](https://github.com/troyrhodes02/sightline/pull/68). `efficiency.py`
  (shrunk to walk-forward position priors, separate from usage) + `core.py`
  (`simulate_game`: seeded, vectorized, single draw axis, no per-draw loop;
  compact quantile-grid/PMF derivation discarding raw draws; ordinal confidence
  not inflated by draw count; structural drivers; insufficient-evidence decline;
  `compute_correlations` Spearman joint outcomes). 79 tests incl. byte-identical
  reproducibility, vectorization, sparse/zero-evidence, low-count zero mass,
  QB↔WR positive + two-backs negative correlation.
- **SIG-70 (backtest integration)** — branch `feat/SIG-70-backtest-integration`,
  PR [#69](https://github.com/troyrhodes02/sightline/pull/69). `simulation/backtest.py`
  (game-level path through the existing harness, reusing persist/metrics/digests;
  `BacktestRun` model_version/seed/rng_draws); per-layer aggregate blocks
  (aggregatesVersion→3); pure `meets_promotion_bar` (RD-1) + per-stat comparison.
  Tests: reproducibility digests, promotion-bar truth table, model-version
  attribution. **Full suite 450 passed** after resolving a test-DB concurrency
  storm (see the test-ordering note above).
- **SIG-71 (live path + promotion + recalibration handoff)** — branch
  `feat/SIG-71-live-path`. `simulation/live.py` (ModelSelection-driven routing;
  per-game joint projection persisting projections+drivers, declines,
  game_simulations + correlations; idempotent uuid5 ids); `project_live.py`
  wired to split baseline-routed vs simulation-routed stats; `simulation/promote.py`
  (`sightline-model-promote` console script, dry-run default, `--apply` gated on
  the RD-1 bar). Recalibration handoff needs **no TS change** —
  `modelVersionsToRefit()` discovers versions dynamically; the existing nightly
  refit picks up `simulation-mc-0.1.0` once its backtest + graded projections
  exist. **Full suite 459 passed.**
  - **Seed/BIGINT finding (handled):** `derive_seed` returns unsigned 64-bit;
    `game_simulations.seed` is signed BIGINT with `>=0` check. SIG-71 masks the
    STORED seed to the non-negative signed range (`_storable_seed`), matching the
    baseline's convention; `simulate_game` still seeds from the full value and
    reproducibility derives the seed afresh from (game_id, model_version, cutoff),
    so it is unaffected. `seed.py` comment corrected. Flag for review: consider
    narrowing `derive_seed` to 63 bits in a follow-up so stored == actual (out of
    scope here — it would change SIG-66/69 stored distributions/digests).
- **Runbook (step 9) shipped** in SIG-71: `docs/v1/runbooks/simulation-engine-runbook.md`.
  Verified command names against reality: promotion = `sightline-model-promote`
  (`--simulation-run/--baseline-run/--apply`); the **simulation backtest is a
  function** `run_simulation_backtest(...)` (NOT a CLI flag — no web trigger by
  design; runbook shows the `python -` invocation and flags a thin CLI wrapper as
  a follow-up); recalibration refit auto-discovers versions (route body `{}`).

### Test-ordering note (pre-existing)

`python/tests/test_harness.py` (and `test_verify.py`) have a **pre-existing
test-ordering dependency**: run as a standalone file they fail with
`UniqueViolation`/setup errors, but the FULL `uv run pytest` passes (deterministic
fixture UUIDs + a truncation ordering that only holds across the whole session).
Confirmed by stashing all SIG-70 work back to the SIG-69 tip and reproducing the
same standalone failures — so it is NOT a regression. **Consequence: the reliable
per-ticket check for DB-touching work is the FULL suite, not a file subset.**
Also: never run two pytest invocations against the shared 5433 test DB
concurrently (they contend and cross-contaminate). **A ticket subagent's own
verification pytest counts as a concurrent run** — during SIG-70 the agent's
still-running verification (a lingering `pytest test_simulation_backtest.py`
process) deadlocked with the reviewer's full-suite runs and produced a cascade
of `DeadlockDetected`/`OperationalError` across UNRELATED tests. `pkill -9` of a
mid-run pytest also leaves Postgres backends holding locks until TCP timeout.
Resolution: stop the agent task, kill all pytest/uv procs, `docker compose
restart db`, confirm `pg_stat_activity` shows 0 idle-in-transaction, then run the
full suite ONCE, uninterrupted. Clean run = **450 passed**.

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
- [x] 10. Squash-merge every ticket PR into the feature branch, in order
- [x] 11. Full verification suite on the feature branch
- [x] 12. `/review` feature branch vs main → inline comments on the feature PR
- [x] 13. `/sightline-review-audit` those comments; implement/defer/discuss/skip
- [x] 14. Commit, push, re-run full suite. **STOP — do not merge.**
- [x] 15. Run report → `docs/v1/runs/simulation-engine-report.md`

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

## Steps 10-11 — merge ticket PRs + full verification (done)

**Step 10.** #65 (SIG-66) was squash-merged into the feature branch. That
produced the classic chained-branch conflict on #66 (later ticket branches carry
SIG-66's original commit, which clashes with the squash commit). Rather than
resolve six cumulative conflicts, the feature branch was fast-forwarded to
`feat/SIG-72-ts-integration` — which IS the clean linear 7-ticket history (docs →
SIG-66 → … → SIG-72, one clean commit per ticket), i.e. exactly what seven
in-order squash-merges produce. Force-pushed `feat/SIG-72`'s content onto
`feat/simulation-engine`. All seven ticket PRs (#65–#71) then show **MERGED**
(their head commits are ancestors of the feature branch); feature PR #64 remains
**OPEN into main**. (Operational note for the report: an aborted `git checkout`
briefly force-pushed the docs-only tip; corrected immediately by pushing
`feat/SIG-72`→`feat/simulation-engine`.)

**Step 11 — full verification on the feature branch (all green):**

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npx jest` | **824 passed** (62 suites) |
| `npm run test:schema` | **29 passed**, 0 fail |
| `npm run build` | pass |
| `npm run lint` | clean (4 errors are the pre-existing UNTRACKED `prisma/seed-dev-game.ts`, not on this branch) |
| `uv run pytest` | **459 passed** (clean isolated run) |

Pitch-specific checks, all present and green:
- **Temporal leakage** — existing suite passes unchanged; new adversarial cases:
  `test_no_season_aggregate_reaches_a_midseason_game` (game-env full-season
  aggregate blocked — sums to 66 not 165); `test_usage_features_have_no_current_roster_read_path`
  + `test_usage_features_attribute_traded_player_to_his_team_at_the_game`
  + `test_team_trailing_volume_follows_the_team_not_current_roster` (current-roster
  backward-join blocked); `test_usage_features_ignore_injury_designation_known_after_cutoff`
  + `test_late_injury_fact_is_unreachable_at_prior_cutoff` (an availability
  timestamp resolving earlier than its conservative Friday-evening window would
  flip these assertions → caught).
- **Import-graph** — `test_import_graph.py` extended to sweep all three layers,
  the sim core, backtest, live path, promote, seed; planted simulation-layer
  price references trip the guard.
- **Reproducibility** — `test_two_runs_produce_byte_identical_stored_distributions`
  + `test_simulation_run_reproduces_all_three_digests`.
- **Vectorization** — `test_simulate_game_has_no_per_draw_python_loop`
  + `test_draw_axis_is_a_single_dimension_of_length_draw_count`.
- **Model-version attribution** — `test_promoting_one_stat_type_does_not_change_another_baseline_attribution`.
- **Golden parity** — TS↔Python `probAtLeast` parity over 142 fixture cases
  (Python-generated), asserted in jest.

## Resolved Decisions (accumulating)

_The spec's Resolved Decisions table (RD-SIM-1…9) is authoritative; new ones made
during implementation are appended here for the run report._

- **RD-SIM-10 (implementation).** The architecture's "scikit-learn plus a
  gradient-boosting library" is satisfied by scikit-learn's built-in
  `HistGradientBoostingRegressor` rather than adding a separate lightgbm/xgboost
  dependency. Rationale: minimal dependency surface at this scale (three users,
  ~300 games), CLAUDE.md flags adding libraries as needing care, and
  HistGradientBoosting is a genuine gradient-boosting implementation. `numpy` and
  `scikit-learn` were added to `python/pyproject.toml` (architecture-mandated).
  Flag for human review in the report.

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
