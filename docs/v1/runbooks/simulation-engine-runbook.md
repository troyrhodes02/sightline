# Runbook — Simulation Engine

Everything needed to operate the Simulation Engine that lives **outside the
codebase**: how to run its historical validation backtest, where its artifacts
land, how per-stat-type promotion is reviewed and applied, how the model-version
and recalibration handoff is performed, and the production compute the sub-minute
full-slate target assumes.

Spec: `docs/v1/specs/simulation-engine-spec.md`. Pitch:
`docs/v1/pitches/simulation-engine.md`. This runbook assumes the Backtest Harness
runbook (`docs/v1/runbooks/backtest.md`) and the Live Pipeline runbook
(`docs/v1/runbooks/live-pipeline.md`) as background — the Simulation Engine plugs
into both rather than replacing them.

> **The model version is `simulation-mc-0.1.0`.** It coexists with the permanent
> Pitch 2 baseline `baseline-zil-0.1.0`. Neither overwrites the other. The active
> model is chosen **per stat type** by the `model_selections` table, which ships
> with every stat type on the baseline.

## The V1 launch sequence (do these in order)

This is the operational spine of the pitch. Each step is human-triggered; nothing
downstream happens automatically when an earlier step passes.

1. **Fit the component models offline.** The three layers (game environment,
   usage allocation, efficiency) are fit on the historical corpus, off the
   request path, and their artifacts written to local disk. This is a local job,
   not CI, and not the web app.
2. **Run the historical validation backtest** for `simulation-mc-0.1.0` (below).
   Hours, local, never in CI.
3. **Establish its calibration record** — the backtest writes `BacktestRun` +
   `calibration_bins` for the simulation version, per stat type / season / era.
4. **Refit Probability Recalibration for the new model version** (the handoff,
   below) — a separate action from promotion.
5. **Promote per stat type** whatever clears the bar (below) by applying the
   reviewed `model_selections` change.
6. **Run a fresh Pitch 7 Dry Run** using the promoted model and the intended risk
   configuration. **This pitch does not do this and builds no mechanism to
   trigger it** — it is a human action in the staking pitch's flow.
7. **Inspect** the Dry Run's slate allocation and simulated fills.
8. **Enable autonomous paper trading** only after that Dry Run passes — again, a
   human action in the staking pitch, never triggered here.

A future material model change (a new `simulation-mc-x.y.z`) repeats 2–6: a new
version never silently takes over a running autonomous strategy without a fresh
Dry Run.

## Running the historical validation backtest

The Simulation Engine runs through the **existing** chronological Backtesting
Harness under the same point-in-time discipline as the baseline — only
information known before each game reaches each prediction; the run is seeded and
reproducible from stored configuration and code version.

The simulation backtest is exposed as `run_simulation_backtest(...)` in
`sightline_model.simulation.backtest` (SIG-70). It reuses the harness's game
enumeration, cutoff derivation, grading, artifact writing, and digesting; it is
**not** wired into the `sightline-backtest run` CLI, because the pitch forbids a
web-app trigger and this is a deliberate human-run local step. Invoke it from a
short local script or the REPL:

```bash
uv run --project python python - <<'PY'
from sightline_model.simulation.backtest import run_simulation_backtest
# Confirm the exact config/keyword arguments against the function signature.
run = run_simulation_backtest(
    seasons=(2021, 2023),      # >= 2 seasons, contract-like population
    season_types=("REG",),
    # stat_types default to the six supported; narrow if desired.
)
print("simulation BacktestRun id:", run)
PY
```

(A thin `sightline-backtest run --engine simulation` CLI wrapper would be a
reasonable follow-up; it is intentionally absent today so nothing can trigger a
full backtest by accident.)

- **It is slow by design** (roughly tens of millions of game simulations across
  seasons) and **runs locally, never in CI**. Expect hours.
- It must be run against a **clean, unchanged corpus state**; the run pins a
  `corpus_digest` so "the same stored corpus" is a checkable precondition.
- **Do not iterate the model against this backtest.** The backtest evaluates a
  finished model. Re-tuning a layer, re-running, and checking whether it now
  clears the promotion bar is training on the evaluation set and is forbidden
  (the pitch's "chasing backtest results" rabbit hole).

### Reproducibility

Re-running the identical configuration over the unchanged corpus reproduces the
run's `predictions_digest`, `aggregate_digest`, and `calibration_digest`. A
single production/backtest prediction re-run with the same `(game_id,
model_version, information_cutoff)` reproduces a **byte-identical** stored
distribution, because the per-game seed is derived from that triple (BLAKE2b),
never from the clock.

## Where the artifacts land

- **Raw per-prediction Parquet** — local disk under the backtest artifact path
  (`python/backtests/<run-id>/…` in local dev; see the Backtest runbook for the
  canonical layout). Millions of rows; **never** loaded into Postgres.
- **Aggregates** — `BacktestRun.aggregates` (JSON, `aggregatesVersion = 3`).
  Simulation runs carry per-layer validation blocks in addition to the baseline
  shape:
  - `gameEnvironment`: MAE of predicted vs observed total offensive plays, and of
    the pass/rush attempt split, per team-game.
  - `usageAllocation`: MAE of predicted vs observed target share and carry share,
    over players with a real opportunity only.
  These localize a final-projection regression to a layer (volume vs. usage vs.
  efficiency) instead of one opaque score.
- **Calibration** — `calibration_bins` rows tied to the run (which carries the
  `model_version`), per stat type / season / era / population.
- **Fitted component-model artifacts** — local disk (joblib); never served,
  never a URL.

Inspect a run with the existing terminal commands (`sightline-backtest show
<run-id> --breakout stat`, `calibration <run-id> --population contract_like`,
etc.). Weather-era reporting is preserved — read the reanalysis and
archived-forecast eras separately; do not average them.

## Reviewing and applying per-stat-type promotion

Promotion is a **reviewed, manual** action, gated on evidence. A stat type is
promoted to the Simulation Engine only when, over **≥ 2 backtested seasons in the
contract-like population**, its Brier score beats the baseline's by **≥ 0.01
absolute** on **≥ 500 graded predictions**. Below that bar the baseline stays
active for that stat type.

```bash
# Dry run (default): prints per-stat-type sim vs baseline Brier, delta, n, and
# which stat types would be promoted. Writes NOTHING.
uv run --project python -m sightline_model.simulation.promote \
  --simulation-run <sim-backtest-run-id> \
  --baseline-run <baseline-backtest-run-id>

# Apply the reviewed change to model_selections (only stat types clearing the bar):
uv run --project python -m sightline_model.simulation.promote \
  --simulation-run <sim-backtest-run-id> \
  --baseline-run <baseline-backtest-run-id> \
  --apply
```

- **Read the dry run before applying.** It reports, per stat type, both Brier
  scores, the delta, the sample size, and the promote/hold verdict. Confirm the
  sample size is real (≥ 500) and the improvement is ≥ 0.01 — a newer, more
  elaborate model is not a reason to promote.
- `--apply` updates `model_selections[stat_type]` to `simulation-mc-0.1.0` and
  records the `backtest_run_id`, `brier_delta`, and `sample_size` that justified
  it, so a future analyst can see why each stat type is where it is.
- Promotion changes **which model the slate reads and the pipeline runs** for
  that stat type. It does **not** touch any other stat type's projections, and it
  does **not** retroactively re-attribute historical baseline projections — those
  remain `baseline-zil-0.1.0` forever.
- **The application never performs promotion and never triggers the backtest.**
  There is no in-app control to tune the model or flip a stat type.

## Model-version and recalibration handoff

The two are deliberately separate actions so "the model got better" and "the
correction got refitted" stay distinguishable.

1. **Model-version change** = the promotion above (a `model_selections` edit).
2. **Recalibration refit** = a subsequent, separate step. The Probability
   Recalibration feature is already fully keyed by `model_version`
   (`src/lib/paper/recalibration/store.ts`), and its refit path **discovers**
   which versions to fit dynamically (`modelVersionsToRefit()` — every version
   carrying a completed `contract_like` `BacktestRun` plus graded projections).
   So **no code change and no per-version argument is needed**: once the
   simulation backtest exists and simulation projections have been graded, the
   existing nightly refit picks up `simulation-mc-0.1.0` automatically. To force
   it immediately rather than wait for the nightly cron, POST the same
   machine-authenticated pipeline route the cron calls:

   ```bash
   # Scheduler bearer token, same route as the nightly baseline refit. It refits
   # every eligible model version, now including simulation-mc-0.1.0.
   curl -sS -X POST "$APP_URL/api/pipeline/recalibration-fit" \
     -H "authorization: Bearer $PIPELINE_SCHEDULER_TOKEN" \
     -H "content-type: application/json" \
     -d '{}'
   ```

   The refit reads the simulation version's reference `BacktestRun` +
   `calibration_bins` and its live graded observations, fits the PAVA + shrinkage
   knots, and stores a `RecalibrationFit` row keyed to `simulation-mc-0.1.0`.
   **Refitting the correction never turns a poorly-calibrated model into a
   well-calibrated claim** — a strong correction layer is not evidence the
   underlying model is good; read the model's own calibration record.

3. **Only after** a stat type is promoted **and** the simulation version has an
   active recalibration fit does Position Sizing consume its recalibrated
   probabilities — and only then does the human run the fresh Dry Run.

## Production compute (the sub-minute target)

Production simulation is a batch job on the existing Python runtime, off the
request path. The slate never waits for it; users see the latest completed stored
projection while a newer run is processing.

- **Full-slate recompute**: ~14 games × 5,000 vectorized draws each ≈ 70,000 game
  simulations — **well under a minute** vectorized. The draw count (5,000) is part
  of the versioned config; the simulation core executes as NumPy array operations
  across the full draw axis, **never a Python loop per run**.
- **Single-game recompute** (e.g. triggered when inactives publish): **seconds**.
- One simulated game produces every participating player's full stat line, so
  reading sixty contracts off a game costs the same as reading five. Scoping
  production inference to Kalshi-listed players is a product decision, not a
  performance one.
- **Do not** add distributed compute, a worker service, or a message queue. Three
  users and ~300 games a season do not justify it, and it would violate the
  approved architecture.

### Running the live recompute

The production path is invoked by the Live Pipeline (a GitHub Actions cron →
token-authenticated route), not the web app. Per game, for stat types whose
`model_selections.model_version` is `simulation-mc-0.1.0`, it runs the joint
simulation and persists, idempotently:

- `projections` (+ `projection_drivers`) for each projected (player, stat),
- `projection_declines` for insufficient-evidence declines (zero relevant
  opportunity as of the cutoff),
- one `game_simulations` row plus its `player_outcome_correlations`.

Stat types still on the baseline continue to run the baseline engine unchanged in
the same pass. Re-running a game/cutoff upserts on the compound keys — no
duplicates, no drift.

## Invariants to hold when operating this

- **Prices are the opponent, not an input.** No layer, feature, or helper reads a
  Kalshi price, price movement, recommendation status, or Sightline edge. Enforced
  structurally by the Python import-graph guard.
- **Temporal integrity.** Only information known before a game reaches its
  prediction; reconstructed availability timestamps keep their documented
  conservative windows; no season-level aggregate and no current-roster backward
  join is ever a feature.
- **Joint outcomes are produced, not consumed by sizing.** `game_simulations` /
  `player_outcome_correlations` are queryable by game but are **not** read by
  Position Sizing in this pitch; the hard per-game and per-slate caps continue to
  bind unchanged.
- **No Dry Run and no autonomy flip happen here.** Both remain human-triggered
  gates in the staking pitch, using this pitch's completed, validated model.
