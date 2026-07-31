# Runbook — Backtest Harness & Baseline Model

How to run a Sightline backtest, how to read what it produces, and what it does
**not** entitle you to claim.

Ships with the capability, per the pitch. Spec: `docs/v1/specs/backtest-harness-and-baseline-model-spec.md`.

---

## Before you start

The backtest reads the corpus built by Pitch 1 and writes to the same Postgres.
It runs locally and never in CI — a full run is hours of work with no execution
ceiling to respect and no per-minute cost to justify.

```bash
docker compose up -d db                 # local Postgres on :5433, if not running
uv sync --project python
uv run --project python sightline-backtest --help
```

Environment (repo-root `.env`, same as ingest):

- `DIRECT_URL` — the direct, non-pooled connection. Bulk reads and writes use it.
- `INGEST_DATABASE_URL` — optional explicit override.
- `TEST_DATABASE_URL` — the local container, used by the test suite.

### Corpus scope (deliberate, not data loss)

The working corpus is **2010–2021** (~211k `PlayerGameStat` rows), a deliberate
narrowing from the earlier 2002–2023 (~387k). It is derived data, fully
re-ingestable, and covers the SIG-27 development window (2019–2021) with several
seasons of prior history for walk-forward priors. The 2002 floor still holds
(pre-2002 rows carry no `team_abbr_at_game`); the 2010 start simply avoids
paying for older seasons the current window does not use — extend `--seasons` to
re-ingest more whenever a wider window is wanted.

`game_weather` and `player_game_context` (snaps, participation, injuries) are
**empty by deliberate scoping**, not oversight. The baseline model reads
neither, so ingesting them buys nothing today. Their ingest is built and working
(the `weather` and `context` datasets) and will be loaded when the **Simulation
Engine** (the second Projection Engine implementation) needs game environment
and usage inputs — that is the pitch that requires them, not the baseline.

---

## Executing a run

```bash
uv run --project python sightline-backtest run \
    --seasons 2016-2021 \
    --stat-types rushing_yards,receiving_yards,passing_yards,receptions \
    --season-types REG \
    --window development
```

| Flag | Meaning |
| ---- | ------- |
| `--seasons` | Inclusive range, or a single season. Must be covered by the corpus. **The corpus floor is 2002**: pre-2002 nflverse rows carry no `team_abbr_at_game`, and ingest skips-and-counts them rather than inventing a team (SIG-25). |
| `--stat-types` | Any of `passing_yards`, `rushing_yards`, `receiving_yards`, `receptions`, `rushing_tds`, `receiving_tds`. A typo is rejected before any work starts. |
| `--season-types` | `REG`, or `REG,POST`. |
| `--window` | `development`, `validation`, or `holdout`. See the protocol below. |
| `--label` | Optional operator label, e.g. `zil-shrinkage-k4`. |
| `--seed` | Recorded, and **inert**: the baseline engine is closed-form and draws no random numbers. It exists for the Simulation Engine (Pitch 7). |
| `--limit-games` | Bound the run while iterating. |
| `--reap` | Mark abandoned `running` rows as `interrupted` first. Never as completed. |

The run is the **only** command that writes. `run` validates `--seasons`
against `source_coverage` before inserting a run row: a season outside ingested
coverage exits 2 with the covered range named, and no run row is created.

### How the information cutoff is applied

```
cutoff = min(actual kickoff, kickoff known 7 days out) − 90 minutes
```

`min` is deliberate. For a cutoff, resolving **earlier** is the conservative
direction — the mirror image of `known_at`, where resolving *later* is
conservative. A game flexed later must not hand the model a window it would not
have had; a game flexed earlier must not push the cutoff past its own kickoff.

Every model-facing read goes through the as-of query layer bound to that cutoff.
Rows whose `known_at` postdates it are absent from the result set, not filtered
out of it afterward. `verify` asserts no prediction has a cutoff at or after the
kickoff it predicts.

---

## What a run produces

**Durable, in Postgres** — read by the Accuracy and Calibration Surface (Pitch 6):

- `backtest_runs` — configuration, code version, populations, aggregates, three digests.
- `calibration_bins` — the reliability curve, one row set per single-axis segment.

**Local, on disk** — never in Postgres, never served, never a URL:

```
python/artifacts/backtests/<run-id>/
├── manifest.json
├── predictions/part-*.parquet
├── thresholds/part-*.parquet
├── exclusions/part-*.parquet
├── priors/part-*.parquet
└── _COMPLETE
```

`priors/` holds one row per `(season, stat_type, position)` prior the run used —
the fitted parameters plus `fitted_from_seasons`, `sample_games`, and
`sample_players` — so the walk-forward refit is auditable from the artefacts
alone.

`_COMPLETE` is the filesystem twin of `status = completed` and is written last.
`verify` asserts the two agree — a crash between them is exactly the state that
gets presented as a finished backtest six weeks later.

**No command deletes artefacts.** A tool that prunes experiment history
eventually prunes the run someone was citing. To prune by hand, remove
directories whose `backtest_runs.status` is not `completed`; those are runs that
died and are not results.

---

## Reloading a stored run (portability)

A `BacktestRun` and its `CalibrationBin` rows live in Postgres, so a run made on
one machine is invisible to another. Pitch 6 (accuracy surface) renders these,
and Pitch 7 (recalibration) is fitted against them, so the citable run is
exported to the repo as JSON and reloads into any fresh database — no corpus
rebuild, no 40-minute re-run.

The citable Track A re-baseline (SIG-27) is committed at
`docs/v1/tests/sig27-export/sig27-rebaseline.json`: the `BacktestRun` row (full
config, digests, code version, and the complete `aggregates` including the
`contractLike` block and per-stat pairs) plus every `CalibrationBin` for the run
across all segments — pooled, per stat, per season, per era, contract-like, and
contract-like × stat-type.

Reload into a database that already has the schema (`prisma migrate deploy`):

```bash
psql "$DIRECT_URL" <<'SQL'
\set js `cat docs/v1/tests/sig27-export/sig27-rebaseline.json`
insert into backtest_runs
  select * from jsonb_populate_record(null::backtest_runs, (:'js'::jsonb)->'backtestRun')
  on conflict (id) do nothing;
insert into calibration_bins
  select * from jsonb_populate_recordset(null::calibration_bins, (:'js'::jsonb)->'calibrationBins')
  on conflict do nothing;
SQL
```

`jsonb_populate_record` maps JSON keys to columns by name and casts enums and
decimals from the schema, so the reload is schema-aware and order-independent.
After it, `sightline-backtest show <run-id>` and `calibration <run-id>
--population contract_like` work against the reloaded run.

The **Parquet predictions are not in the export** (they are gitignored and
large — ~12 MB for a three-season run) and are only needed for `explain` /
per-prediction inspection and digest re-verification, not for rendering the
curve. If a future session needs `verify` to recompute from raw artefacts, the
run's `artifacts/backtests/<run-id>/` directory must be copied alongside; the
aggregates and bins in the export are sufficient for everything else.

---

## Inspecting a run

All read-only. `--strict` turns "this run is not a completed result" into a
non-zero exit, so a script cannot quietly build on partial numbers. Every
command below (and `list`) takes `--json` for machine-readable output; the
examples show the human-readable form.

```bash
sightline-backtest list
sightline-backtest show        <run-id> [--breakout total|stat|season|era]
sightline-backtest calibration <run-id> [--stat rushing_yards] [--era reanalysis] [--season 2021] [--population contract_like]
sightline-backtest predictions <run-id> [--cohort low_confidence] [--limit 50]
sightline-backtest explain     <run-id> --prediction <prediction-id>
sightline-backtest exclusions  <run-id> [--reason insufficient_history]
sightline-backtest thresholds  <run-id> --prediction <id> [--at 87.5]
sightline-backtest verify      <run-id> [--against <run-id>] [--strict]
```

**Calibration segments are single-axis** — `all`, per `--stat`, per `--season`,
per `--era`, and the `--population contract_like` sub-population (SIG-26).
Contract-like membership is a per-stat volume floor on the projected value —
passing 100 · rushing 20 · receiving 20 · receptions 2 · TDs 0.2 yds/events —
applied to `projected_value`, which is pre-cutoff and never conditions on the
outcome. **These floors are PROVISIONAL** and must be re-anchored against
Kalshi's real listing behaviour before the paper run, because the floor defines
the population the recalibration layer is fitted on. 0.5×/1×/2× sensitivity is
re-derivable from the projected value stored on each prediction. Cross-axis
slices (contract-like within a stat) are derived from the artefacts on demand,
never stored.

`explain` is the one to reach for when a number looks wrong. It prints the
distribution and its parameters, the full threshold table, the temporal block,
the drivers, the eligible source records with `OBSERVED`/`RECONSTRUCTED` flags,
and the records that existed in the corpus and were **unreachable** at the
cutoff. That last panel is what turns the leakage guarantee from an assertion
into something you can look at.

`thresholds --at` answers any threshold from the stored parameters, with no
engine execution and no corpus read. Adding a threshold never costs a re-run.

---

## Reading the output honestly

**The baselines.** Season-average is the mean of the player's eligible prior
games **in the same season**, and is undefined before their first eligible game
of that season — not zero, and not last year's number wearing this year's
label. Trailing-five is the mean of at most five most recent eligible games and
**may cross a season boundary**, because recent form does not reset in September.

**Two populations, and they are two numbers.** The *comparison* population is
predictions where the model and both baselines are all defined; every
model-vs-baseline figure is computed over exactly it. The *model-only*
population is every successful projection, including week 1 where no season
average exists. `show` prints both. Reporting one as the other is the failure
the equal-treatment rule exists to prevent.

**Calibration sample sizes.** Every bin carries its threshold-observation count
*and* the number of projections behind it. Threshold events drawn from one
distribution are correlated, so **the projection count is the effective
sample**. Bins below the reporting floor (1,000 threshold observations) are
stored, displayed, flagged `SPARSE`, and excluded from any summary sentence —
a claim resting on eleven observations is a lie with a decimal point.

**The weather era split is not optional.** Pre-2021 weather is reanalysis: it
describes what the weather actually was, not what was forecast before kickoff.
Stronger performance in that era is *expected* and is not evidence of model
skill. Never read a total without `--breakout era`.

**Grading target.** The backtest grades against the official corrected line. It
measures how well the model predicted what happened, and the corrected line is
the best evidence of what happened. Whether Kalshi settlement or the official
line is truth for grading a *position* is a different question and is not
decided here.

**A metric that reads `— (not computed)` was not computed.** It is not zero.

---

## Evaluation windows and the promotion gate

| Window | Seasons | Use |
| ------ | ------- | --- |
| `development` | 2016–2021 | Free iteration. Spans both weather eras deliberately. |
| `validation` | 2022–2023 | Candidate comparison, when a model version is believed finished. |
| `holdout` | 2024–2025 | **Run once per model version.** |

`sightline-backtest list --window holdout` prints the count of distinct model
versions that have touched the holdout. That count *is* the selection-bias
record: a long list means the reported holdout performance has been selected
against and must not be read as an untouched estimate.

A model version is eligible to supersede the baseline engine only when, on a
`validation` run:

- it beats the **better** of the two baselines by ≥ 3% relative MAE overall; **and**
- it beats the better baseline in at least two of the three yardage stat types; **and**
- it beats the better baseline **in each weather era separately**, so an aggregate win carried by reanalysis-era seasons does not count; **and**
- no calibration bin above the reporting floor deviates from its predicted probability by more than 0.10.

---

## Verifying a run

```bash
sightline-backtest verify <run-id> --against <previous-run-id>
```

Recomputes the aggregates and bins from the raw artefacts and asserts the stored
summary agrees, then asserts the run is sound at all: the marker and the status
agree, no cutoff lands at or after its kickoff, no distribution places mass
below zero, the comparison population is identical across all three series, the
population reconciles, and `rng_draws` is zero. Exits non-zero on any failure.

`--against` compares all three digests. **A run over a changed corpus or a
changed engine configuration is reported as a *different experiment*, not as a
reproducibility failure** — conflating the two would train you to ignore the
real one.

`--strict` additionally fails a run whose `code_version` is `unknown` or whose
working tree was dirty. Such a run cannot be tied to an implementation and is
not evidence.

---

## Interruptions and failures

| State | What it means | What to do |
| ----- | ------------- | ---------- |
| `completed` | Artefacts written, digests stored, bins landed | Read it |
| `running` | In flight, or the process was killed uncatchably | Never a result. `--reap` marks 24h-old rows `interrupted` |
| `interrupted` | SIGINT/SIGTERM; artefacts retained for diagnosis | Discard and re-run. There is no `--resume`: partial-result resumption is where "presented as complete" bugs live |
| `failed` | Raised; sanitized message on the row | Read `error_message`, fix, re-run |

A run aborts rather than accumulating if more than 100 candidates raise. A model
declining to project is normal; the harness raising is not, and laundering a
thousand crashes into an exclusion count would let a broken run look merely
selective.

---

## After changing feature code

Per `CLAUDE.md` → Workflow: any change touching the as-of query layer,
`known_at` handling, or feature computation requires a backtest re-run and a
comparison against the prior stored run **before merge**.

```bash
sightline-backtest run --seasons 2016-2021 --stat-types ... --window development
sightline-backtest verify <new-run> --against <prior-run>
sightline-backtest show <new-run> --breakout era
```

**A leak makes the numbers improve.** An unexplained improvement in calibration
or error is a signal to investigate, not to celebrate. State the comparison in
the pull request either way.

---

## What a good result does not entitle you to claim

Beating the season-average and trailing-five baselines is **necessary and not
sufficient**. It establishes that the projections carry information beyond
arithmetic a person could do in a spreadsheet. It says nothing about whether
Sightline can beat Kalshi's prices, because no market data enters this pitch at
any point — the engine cannot read a price, and an import-graph test enforces it.

The market comparison requires Kalshi price history that does not yet exist. Do
not present a backtest result as evidence of edge.

---

## Note on the removed inspection interface

An earlier version of this pitch included a Temporary Backtest Inspection UI — a
local, disposable HTML report — to be built, reviewed once, and deleted. **The
owner withdrew it on 2026-07-28.** Verification is terminal-only, and every
requirement that surface carried is a command in this runbook. A design document
and a UI preview were drafted for it; neither was implemented and neither is in
the repository. If you find a reference to a backtest report page, it is stale.
