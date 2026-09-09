# Run Report — Simulation Engine

Slug: `simulation-engine` · Linear project: **Sightline V1** · Milestone: **Simulation Engine**
Mode: Autonomous Pipeline Policy (`CLAUDE.md`)

## Status: awaiting human review — NOT merged

**The feature branch `feat/simulation-engine` is verified, reviewed, audited, and
green, and its PR is open against `main` for a line-by-line human read. It has NOT
been merged and must not be merged by this run.**

- **Feature PR:** <https://github.com/troyrhodes02/sightline/pull/64> (open into `main`)
- **Feature branch head:** `3d0eb4f` (docs → SIG-66 → … → SIG-72 → review-audit fixes)
- All seven ticket PRs (#65–#71) are **merged into the feature branch**; the
  follow-up cleanup ticket **SIG-73** is filed for later.

No stop condition was hit. Nothing in this run read a Kalshi price into a model,
ran a Dry Run, enabled autonomy, placed an order, or performed a destructive
operation on shared history.

## What shipped

Sightline's real V1 projection model: a three-layer football-process simulator
(**game environment → usage allocation → efficiency**) combined through a
**vectorized Monte Carlo game simulation** producing every participating player's
stat line jointly per game. It derives the same compact distribution the baseline
stores (empirical quantile grid for yardage, explicit PMF for low-count stats)
plus joint outcomes queryable by game, and coexists with the permanent Pitch 2
baseline as a distinct model version `simulation-mc-0.1.0`.

| Ticket | PR | Scope |
| --- | --- | --- |
| SIG-66 | [#65](https://github.com/troyrhodes02/sightline/pull/65) | Foundation — schema (`ProjectionDecline`, `GameSimulation`, `PlayerOutcomeCorrelation`, `ModelSelection` + seed), model-version identity, deterministic per-game seed, import-guard extension |
| SIG-67 | [#66](https://github.com/troyrhodes02/sightline/pull/66) | Layer 1 game-environment model + leakage-safe as-of `team_trailing_volume` + validation |
| SIG-68 | [#67](https://github.com/troyrhodes02/sightline/pull/67) | Layer 2 usage-allocation model + coherent within-team normalization + validation |
| SIG-69 | [#68](https://github.com/troyrhodes02/sightline/pull/68) | Layer 3 efficiency + vectorized joint simulation core, compact distributions, joint outcomes, confidence, drivers |
| SIG-70 | [#69](https://github.com/troyrhodes02/sightline/pull/69) | Backtest-harness integration, per-layer validation, baseline comparison, promotion-bar |
| SIG-71 | [#70](https://github.com/troyrhodes02/sightline/pull/70) | Live production path, `ModelSelection` routing, persistence, recalibration handoff, promotion tooling, runbook |
| SIG-72 | [#71](https://github.com/troyrhodes02/sightline/pull/71) | TS integration — provenance, insufficient-evidence, `probAtLeast` empirical kinds + golden parity, accuracy per-model-version split |

Docs: pitch, design doc, UI preview, spec, runbook, and this report under `docs/v1/`.

## Backtest results per stat type — NOT YET RUN (human gate)

**No stat type was promoted to the Simulation Engine in this run, and the
`ModelSelection` registry ships with all six stat types on the permanent baseline
`baseline-zil-0.1.0`.** This is the pitch's own designed sequencing, not a
shortfall:

- The multi-season validation backtest is, by the pitch's explicit rules, a
  **human-run, local, hours-long** step (the web app never triggers a full
  backtest; backtests run locally, not in CI). This environment has neither the
  loaded multi-season corpus nor the compute budget to run it honestly, and
  fabricating per-stat-type Brier numbers would violate verification honesty.
- The **promotion mechanism is built and tested** on fixture data: the pure
  `meets_promotion_bar(sim_brier, baseline_brier, n, seasons)` (≥0.01 absolute
  Brier improvement AND ≥500 graded predictions AND ≥2 seasons) and the reviewed
  `sightline-model-promote` CLI (dry-run default; `--apply` writes
  `ModelSelection` recording `backtest_run_id`/`brier_delta`/`sample_size`).
- **What a human does next** (see the runbook): fit the three layers offline →
  run `run_simulation_backtest` over ≥2 seasons → review the per-stat dry-run of
  `sightline-model-promote` against the 0.01/500 bar → apply promotion for the
  stat types that clear it → refit Probability Recalibration for
  `simulation-mc-0.1.0` → (in the staking pitch) run a fresh Dry Run → enable
  autonomy.

So the honest per-stat-type promotion table is: **all six stat types HELD on the
baseline, pending the human-run validation backtest.** The apparatus to compute
and apply that table is complete and green.

## Verification (step 14, after the review audit) — all green

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npx jest` | **824 passed** (62 suites) |
| `npm run test:schema` | **29 passed**, 0 fail |
| `npm run build` | pass |
| `npm run format` (prettier --check) | pass — see note below |
| `npm run lint` | clean — the only 4 errors are the pre-existing UNTRACKED `prisma/seed-dev-game.ts`, which is not on this branch and never reaches CI |
| `uv run pytest` | **461 passed** (clean, isolated run) |

> **Prettier note (honest correction):** `prettier --check` was initially failing
> on 8 TS files (SIG-72 output that wasn't fully formatted, plus the review-audit
> edits). Fixed with `format:write` in a follow-up commit (`7f36a23`); formatting
> only, no behavioral change; re-verified `format --check` clean, typecheck clean,
> and 189 jest tests green in the affected suites. This check had been omitted from
> the per-commit runs during the ticket work and is now passing.

Pitch-specific checks (all present and green):

- **Temporal-leakage suite passes unchanged, and gains the three required
  adversarial cases:** a game-environment feature from a full-season aggregate is
  blocked (`test_no_season_aggregate_reaches_a_midseason_game` — a week-3 trailing
  read sums to 66, never the full-season 165); a usage-allocation feature joining
  current roster backward is blocked (`test_usage_features_have_no_current_roster_read_path`,
  `test_usage_features_attribute_traded_player_to_his_team_at_the_game`,
  `test_team_trailing_volume_follows_the_team_not_current_roster`); and a
  reconstructed availability timestamp resolving earlier than its documented
  conservative window is caught (`test_usage_features_ignore_injury_designation_known_after_cutoff`
  + `test_late_injury_fact_is_unreachable_at_prior_cutoff` pin the Friday-evening
  publication window — those assertions flip if a reconstruction resolves early).
- **Import-graph assertion:** `test_import_graph.py` sweeps all three new layers,
  the simulation core, the backtest, the live path, the promote CLI, and the seed
  util; planted simulation-layer price references trip the guard.
- **Reproducibility:** byte-identical stored distribution on re-run
  (`test_two_runs_produce_byte_identical_stored_distributions`) and digest
  reproduction (`test_simulation_run_reproduces_all_three_digests`).
- **Vectorization:** no per-draw Python loop, single draw axis of length
  `draw_count` (`test_simulate_game_has_no_per_draw_python_loop`,
  `test_draw_axis_is_a_single_dimension_of_length_draw_count`).
- **Model-version attribution:** promoting one stat type does not change another
  stat type's baseline projection attribution
  (`test_promoting_one_stat_type_does_not_change_another_baseline_attribution`).
- **Golden parity:** TS `probAtLeast` matches the Python threshold-probability
  functions over 142 fixture cases (Python-generated), including the two new
  empirical kinds.

## Review and audit (steps 12–13)

`/review` of the feature branch vs `main` ran 8 finder angles (Python
correctness, TS correctness, cleanup/reuse, CLAUDE.md conventions), 1-vote
verified, and posted findings to PR #64
([comment](https://github.com/troyrhodes02/sightline/pull/64#issuecomment-5609471374)).
**The conventions/invariants angle found zero violations** — no modelling layer
reads a price/recommendation/edge, temporal integrity holds across all three new
layers, joint outcomes are produced but not consumed by Position Sizing, no
Dry Run/autonomy path, deterministic seeding, MUI-theme-only. Two candidate
correctness bugs were **refuted** during verification and never reached the PR (a
claimed caller-`rng` provenance mismatch — real callers never pass `rng`; a
multinomial float-drift `ValueError` — the `1e-6` replacement-pool floor guards
the simplex).

`/sightline-review-audit` dispositioned the surviving findings:

| # | Finding | Disposition |
| - | ------- | ----------- |
| 1 | `efficiency.py` yards-per-reception tail blow-up when a non-receiver's catch rate is clamped to `1e-4` | **IMPLEMENT** — floor the yardage divisor at `YARDAGE_CATCH_FLOOR=0.05` (not the Bernoulli's `1e-4`); receptions and the ~0 expected total unchanged; realistic receivers unaffected. Regression test added. |
| 2 | `core.py` drivers emit a false "0 plays, 100% below the league" for a player whose team wasn't simulated | **IMPLEMENT** — omit the volume sentence when `team_volume_mean == 0` (the "driver theater" no-go). Regression test added. |
| 3 | `PmfBars.tsx` threshold `ReferenceLine` uses a fractional numeric on a categorical band axis → never renders | **IMPLEMENT** — reference the cut bar's category label; omit when the cut is past the last bucket. |
| 4 | `prob_at_least_from_pmf` returns a silent `0` for a threshold above the PMF cap, with a dead `pmf[-1]` sub-branch | **IMPLEMENT (zero-risk)** — removed the dead branch and documented the invariant (per-stat `K` covers every listed threshold; residual beyond the tail is negligible by construction). Behaviour unchanged (returns 0), golden parity preserved. A behaviour-changing raise was rejected: it never triggers and a throw on the TS user path would risk the slate. |
| 5, 7 | Verbatim/leak-adjacent duplication (`_efficiency_history`, `_SIM_STAT_TYPES`, `SimulationModels`, un-factored `_pmf_quantile`) between `live.py`/`backtest.py` | **DEFER → SIG-73** — a cross-module refactor is safer as its own reviewed change than on a green branch at the audit stage. |
| 6 | `_rankdata` reimplements `scipy.stats.rankdata` | **DEFER (note in SIG-73)** — the hand-rolled version is tested and deterministic; low value, some risk to swap now. |
| 8 | `ContractDetail.tsx` renders no chart for an NB-family projection | **DEFER (note in SIG-73)** — pre-existing (not introduced by this PR); NB is the baseline family, and the Simulation Engine emits the empirical kinds. |

**Implement: 4 (all with regression tests) · Defer: 4 (SIG-73) · Skip: 0.** The
feature suite was re-run after the fixes — 461 pytest / 824 jest, all green.

## Decisions made on the user's behalf (each with rationale)

The run-instruction pre-resolved decisions (RD-1…9) were adopted verbatim,
including the boundary-wins resolution of the joint-outcome/Position-Sizing
conflict (RD-2). Additional decisions, recorded in the spec's Resolved Decisions
table (RD-SIM-1…9) and here:

1. **RD-SIM-1 — model version string `simulation-mc-0.1.0`** (engine=simulation,
   core=monte-carlo), matching the repo's `<engine>-<core>-<semver>` convention.
   The instruction's `simulation-v1`/`baseline-v1` are conceptual; the UI maps the
   concrete string to `SIM`/"Simulation Engine".
2. **RD-SIM-2 — `ModelSelection` is a DB table** read by both runtimes, changed
   only by a reviewed script — single source of truth, avoids TS/Python config
   divergence, and respects the no-in-app-tuning boundary.
3. **RD-SIM-3 — insufficient-evidence declines persist in a dedicated
   `ProjectionDecline` table** rather than a nullable-distribution `Projection`,
   keeping "a Projection is a real distribution" true and the decline explicit.
4. **RD-SIM-4 — joint outcomes as `GameSimulation` + `PlayerOutcomeCorrelation`**
   (pairwise Spearman among projected marginals), compact, queryable by game, no
   raw draws; consumption deferred (RD-2).
5. **RD-SIM-5 — PMF support is per stat type** (`K=4`+5+ for TDs, `K=15`+16+ for
   receptions). RD-5's literal "0–4+5+" was written for TDs and can't answer
   receptions' 8.5 threshold; per-stat `K` preserves the explicit-mass intent
   while satisfying the DoD's arbitrary-threshold requirement.
6. **RD-SIM-6 — empirical distribution kinds reuse `Projection`'s JSON columns**;
   no `Projection` migration.
7. **RD-SIM-7 — the simulation is seeded per game** from `(game_id, model_version,
   information_cutoff)`; joint simulation requires a shared per-game RNG stream, so
   per-player seeding (which would destroy the within-game correlation the DoD
   requires) is rejected. `player_id` is part of the prediction's identity, not a
   seed input.
8. **RD-SIM-8 — per-model-version calibration is selected by `BacktestRun`/live
   `model_version` filter**, no `CalibrationBin` schema change.
9. **RD-SIM-9 — default `ModelSelection` ships all-baseline**; promotion depends
   on the human-run validation backtest.
10. **RD-SIM-10 — gradient boosting is scikit-learn's `HistGradientBoostingRegressor`**
    rather than a separate lightgbm/xgboost dependency. The architecture mandates
    "scikit-learn plus a gradient-boosting library"; HistGradientBoosting is a
    genuine gradient booster and keeps the dependency surface minimal at this
    scale. `numpy` + `scikit-learn` were added to `python/pyproject.toml`
    (architecture-mandated). **Flagged for human review.**
11. **Seed / signed-BIGINT reconciliation.** `derive_seed` returns an unsigned
    64-bit value; `GameSimulation.seed` is a signed BIGINT with a `>= 0` check.
    The stored seed is masked to the non-negative signed range at the persistence
    boundary (provenance only); `simulate_game` seeds from the full value and
    reproducibility derives the seed afresh, so determinism is unaffected. A
    follow-up could narrow `derive_seed` to 63 bits so stored == actual — left out
    of scope because it would change SIG-66/69 stored distributions and digests.
12. **`record=compare` semantics on the accuracy surface changed** from
    live-vs-backtest to **model-vs-model** (Simulation vs Baseline), per the
    design doc / spec / RD-3. Existing accuracy tests were updated to the new
    (intended) semantics.

## Required upstream amendments (for a human to apply — `docs/planning/` NOT edited this run)

1. **Pitch Roadmap / PRD** — record the **per-stat-type model-selection policy**
   (RD-1) as the approved promotion mechanism, replacing any implication of an
   all-or-nothing model switch.
2. **Pitch Roadmap** — record that **joint-outcome consumption in Position Sizing
   is explicitly deferred to a future integration pitch** (RD-2), not included
   here. This pitch produces and persists the joint-outcome data; a future pitch
   decides how/whether Position Sizing consumes it.
3. **PRD** — record the **Accuracy & Calibration Surface's per-model-version split
   as the default view** (RD-3), with the lifetime blend as a secondary, clearly
   labelled option that is never the resolved default; live-readiness always reads
   the active model's own record.
4. **PRD** — record the **zero-evidence decline state and the sparse-evidence
   confidence-only behavior** (RD-4) as the approved resolution to the
   low-evidence question.
5. **Human review of this run's numeric defaults**, none of which were specified
   in the approved docs: the **0.01 absolute / 500-sample promotion bar**, the
   **5,000-draw** simulation count (lighter than the Architecture Doc's
   illustrative "ten thousand runs" — well within the sub-minute budget; the
   Architecture figure is an illustrative compute estimate, not a normative
   requirement, so this is a soft divergence flagged rather than a contradiction),
   and the **quantile-grid percentiles** `{1,5,10,25,50,75,90,95,99}`.
6. **Architecture Doc / CLAUDE.md** — the gradient-boosting library is realized as
   scikit-learn's `HistGradientBoostingRegressor` (RD-SIM-10); confirm this
   satisfies "scikit-learn plus a gradient-boosting library" or name a preferred
   separate library.

## Deferred / follow-ups

- **SIG-73** — dedup shared sim helpers across `live.py`/`backtest.py` and the
  layer modules (review findings 5–7); note NB-family chart rendering (finding 8).
- **Narrow `derive_seed` to 63 bits** so the stored `GameSimulation.seed` equals
  the actual seed (decision 11) — a small follow-up, out of scope here because it
  changes stored distributions/digests.
- **Pre-existing, local-only:** `prisma/seed-dev-game.ts` (an untracked file from
  before this run) trips `no-console` lint locally; it is on no branch and CI
  never sees it.
- A thin `sightline-backtest run --engine simulation` CLI wrapper for the
  simulation backtest (today it is the `run_simulation_backtest` function, invoked
  via a short script per the runbook — intentionally not a one-command trigger, so
  nothing can start a full backtest by accident).

## Nothing that required an un-makeable decision

Every open question was resolvable from the approved docs, the run instruction, or
codebase patterns; none needed to halt for a decision the run could not make. The
one genuine sequencing constraint — that promotion and the Dry Run are human gates
— is honored by shipping the apparatus and defaulting to the baseline rather than
promoting on unrun evidence.
