# Runbook — Bankroll, Sizing & Autonomous Paper Trading

Everything needed outside the codebase to bring autonomous paper trading up:
the migration, every configuration value and its default, the scheduling
platform's cadence, and how to run and read a Dry Run against a real upcoming
window **before autonomy is ever enabled**.

Companion runbooks: `live-pipeline.md` (the scheduled pipeline this extends),
`outcome-scoring-and-grading.md` (settlement, which paper settlement consumes),
`kalshi-market-sync.md` (the market client and its rate-limit budget).

> **This feature places no real order and touches no Kalshi signing credential
> beyond the existing market-data key.** There is no paper→live switch in this
> pitch, no live ledger in the schema, and no control anywhere that activates
> real-money trading. If a step below appears to require one, stop — something
> has gone wrong.

---

## 1. Migration

One additive migration, `20260907005456_paper_trading_tables`. It creates 14
tables and 8 enums, adds three values to `PipelineJobCategory`, and appends
hand-written partial unique indexes and CHECK constraints Prisma cannot express.
No existing table gains or loses a column, and nothing backfills.

```bash
# Against the development Supabase project (or a local container).
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
npx prisma generate
```

Verify the constraints landed — these are the ones that guard rules application
code alone would eventually relax:

```sql
-- Expect 2 rows: one active breach per condition, one active fit per model.
select indexname from pg_indexes
where indexname in (
  'paper_breaches_one_active_per_condition',
  'recalibration_fits_one_active_per_model'
);

-- Expect 8 rows. `paper_cycle_candidates_fill_within_book` is the flattering-
-- fill guard: without it, an optimisation that walked the order book could
-- inflate a season of simulated returns and nothing would object.
select conname from pg_constraint
where conname like 'paper_%' or conname like 'recalibration_%';
```

**Rollback.** The migration is additive, so rolling back is dropping the new
tables and enum values. Do not do this once a campaign has fills:
`PaperPosition`, `PaperFill`, and `PaperLedgerEntry` are the only records of a
paper campaign, and they cannot be reconstructed. Treat them the way `Decision`
is treated — a drop requires explicit sign-off.

---

## 2. Configuration values

Two layers, deliberately separate.

### 2a. Fixed constants — `src/lib/paper/config.ts`

Changing any of these is a code change and a deploy. They are constants rather
than environment variables because a bound that differed between environments
would make the same campaign read safe in one place and halted in another.

| Constant | Default | What it governs |
| --- | --- | --- |
| `RISK_PRESETS.conservative` | 0.25× Kelly · game 5% · slate 15% · warn 5% · halt 10% | The default mode |
| `RISK_PRESETS.moderate` | 0.50× Kelly · game 8% · slate 25% · warn 5% · halt 15% | |
| `RISK_PRESETS.aggressive` | 0.75× Kelly · game 12% · slate 35% · warn 5% · halt 20% | |
| `PROBABILITY_CEILING` | `0.75` | No stake above this **corrected** probability. Independent of risk mode; raising it needs calibration evidence, not a winning streak |
| `KELLY_WARNING_THRESHOLD` | `0.75` | Above this, Custom shows a persistent warning. It does **not** block |
| `CUSTOM_KELLY_MIN` / `MAX` | `0` / `1.0` | Custom mode's admitted range |
| `CUSTOM_CAP_MIN_PCT` / `MAX_PCT` | `1` / `50` | Custom cap range, mirrored by a database CHECK |
| `DEFAULT_STARTING_BANKROLL_CENTS` | `100_000` ($1,000) | Seed for a new campaign |
| `DEFAULT_WITHDRAWAL_CEILING_MULTIPLE` | `1.5` | Seed for the ratchet's working ceiling |
| `KALSHI_FEE_RATE` | `0.07` | Kalshi's general trading fee, taker side |
| `PRE_KICKOFF_CUTOFF_MINUTES` | `10` | **Not configurable at runtime, and not relaxed by any risk mode** |
| `EXECUTION_WINDOW_HOURS` | `6` | A game becomes eligible this long before its own kickoff |
| `PAPER_CYCLE_INTERVAL_MINUTES` | `30` | At most one cycle per game per this interval |
| `MAX_ALLOCATION_PASSES` | `3` | Reallocation bound |
| `CALIBRATION_WINDOW` | `100` | Trailing graded predictions the breaker judges |
| `CALIBRATION_MIN_OBSERVATIONS` | `30` | Below this, each arm reports insufficient data and does **not** evaluate |
| `CALIBRATION_DEGRADATION_TOLERANCE` | `0.03` | Rolling Brier over stored backtest Brier |
| `CALIBRATION_MARKET_TOLERANCE` | `0.02` | Rolling Brier over Kalshi's Brier on the same contracts |
| `SHRINKAGE_K` | `200` | Live observations at which live evidence carries equal weight with the prior |
| `REQUIRED_PAPER_WEEKS` | `2` | **No environment variable, query parameter, or test seam shortens this** |
| `PAPER_SETTLEMENT_LATE_AFTER_HOURS` (health config) | `3` | Settlement lateness bound |

### 2b. Runtime configuration — the Configuration screen

Set at `/autonomy/configuration`. Each save **appends** a `PaperRiskConfig`
version; no row is ever edited, which is what makes "open positions keep the
limits they were created under" true of the data.

| Setting | Default | Notes |
| --- | --- | --- |
| Risk mode | `conservative` | Conservative is the starting recommendation |
| Custom Kelly fraction | preset's | 0–1.0; above 0.75 warns and is accepted |
| Custom per-game / per-slate cap | preset's | 1–50%, slate ≥ game |
| Custom drawdown halt | preset's | 1–50%, must exceed the 5% warning |
| Starting bankroll | $1,000 | **Locked once any fill exists.** It defines the historical record |
| Withdrawal ceiling multiple | 1.5× | The ratchet repeats each time the ceiling is exceeded |
| Autonomous execution | off | Refused while a halting condition is active |

### 2c. Environment

**No new environment variables.** The two pipeline routes reuse
`PIPELINE_SCHEDULER_TOKEN`; the orderbook read reuses the existing optional
`KALSHI_API_KEY_ID` / `KALSHI_PRIVATE_KEY_PEM` market-data pair.

---

## 3. Scheduling

`.github/workflows/pipeline-autonomy.yml`, two crons in one file.

| Phase | Cron | Route |
| --- | --- | --- |
| Autonomous cycle | `*/10 * * * *` | `POST /api/pipeline/paper-cycle` |
| Paper settlement | `20 * * * *` | `POST /api/pipeline/paper-settlement` |

**Ten minutes, not fifteen.** The hard cutoff is ten minutes before kickoff; a
coarser cadence would routinely leave the last half hour before kickoff — when
the book is most informative — unevaluated.

**:20, not :30.** Settlement is offset from outcome ingest at `:30` so it reads
what the *previous* hour's ingest wrote, rather than racing the job that
supplies its input.

The cron fires year-round; the **route** decides, per game and from stored
state, whether anything happens:

- No game with a kickoff inside the lookahead → `skipped: "not_expected"`, and
  **no run row**. An offseason no-op every ten minutes would be noise.
- Campaign disabled or killed → `skipped`, **with** a run row. The operator
  needs to see that the scheduler is alive while the bot is deliberately off,
  which is a different fact from the scheduler having stopped.
- Per game, eligible only in `[kickoff − 6h, kickoff − 10min]`, and only when
  the last cycle for that game started more than 30 minutes ago.

**Keepalive still applies.** GitHub disables scheduled workflows after 60 days
without a commit to the default branch — on private repositories too. The
existing `keepalive.yml` covers every workflow in the repository, this one
included. Nothing extra is needed, but if the keepalive is ever removed, the
autonomy schedule dies with the rest in the February-to-September offseason and
the failure surfaces in September.

Required secrets (already configured for the other pipeline workflows):
`APP_BASE_URL`, `PIPELINE_SCHEDULER_TOKEN`.

---

## 4. Bringing it up, in order

Do these in sequence. Do not skip to step 5.

### Step 1 — confirm the prerequisites exist

Recalibration cannot be fitted without a stored contract-like backtest record,
and without recalibration **every candidate is refused** with
`no_active_recalibration` rather than sized from a raw probability.

```sql
-- Expect at least one row. If empty, run a backtest first (see backtest.md).
select id, label, model_version, evaluation_window, started_at
from backtest_runs
where status = 'completed'
  and id in (select backtest_run_id from calibration_bins
             where population = 'contract_like')
order by started_at desc limit 5;
```

### Step 2 — fit the correction

The nightly job does this automatically after grading, but the first fit can be
triggered directly:

```bash
curl --fail -X POST "$APP_BASE_URL/api/pipeline/recalibration-fit" \
  -H "Authorization: Bearer $PIPELINE_SCHEDULER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"invocationId":"manual:first-fit"}'
```

```sql
-- Expect exactly one active fit per model version.
select version, model_version, method, shrinkage_k,
       live_observation_count, is_active, fitted_at
from recalibration_fits order by version desc;
```

With no live graded observations the fit reproduces the backtest record exactly.
That is correct and expected — it is the required fallback, not a failure.

### Step 3 — create the campaign

Open `/autonomy/configuration` as the admin and save with **autonomous
execution OFF**. This creates the campaign, its first `PaperRiskConfig`, and an
`opening_balance` ledger entry.

```sql
select starting_bankroll_cents, autonomy_enabled, kill_switch_engaged,
       high_water_mark_cents from paper_campaigns;
select kind, amount_cents, balance_after_cents from paper_ledger_entries;
```

Set the starting bankroll **now**. It locks the moment the first fill exists.

### Step 4 — run a Dry Run against a real upcoming window

**This is the gate. Do not enable autonomy before reading a Dry Run.**

Open `/autonomy/dry-run`, pick an upcoming game window with resolvable
contracts, and run it. It calls the same `planCycle` a scheduled cycle calls,
with the same configuration, recalibration, bankroll state, caps, breaker
evaluation and fill policy — and writes exactly one `PaperDryRun` row and
nothing else.

**What to read, and what should worry you:**

| Read this | It is fine when | Investigate when |
| --- | --- | --- |
| `bound by:` on every candidate | Every candidate has one, including `none` | Any candidate shows a blank — the audit trail has a hole |
| `raw → corrected` probabilities | Corrected differs from raw, usually downward at the top end | They are identical everywhere (the fit may be an identity map) |
| Top-of-book size | A real integer per priced candidate | Absent — the candidate should have been refused with `price_unavailable`, not sized |
| Intended vs would-fill | Intended ≥ would-fill, always | Would-fill exceeds intended, or exceeds the displayed size |
| Kelly edge ordering | Descending down the list | An expensive near-certainty ranked above a genuine mispricing |
| The reallocation trace | States why it stopped and any unallocated remainder | Silent about a remainder |
| Refusals | Stale projections refused; above-ceiling candidates refused | A stale projection sized |

Confirm nothing was written:

```sql
select count(*) from paper_dry_runs;   -- increments by 1
select count(*) from paper_positions;  -- unchanged
select count(*) from paper_fills;      -- unchanged
select count(*) from paper_ledger_entries; -- unchanged (still just the opening balance)
select count(*) from paper_cycles;     -- unchanged
```

A failed Dry Run reports "Nothing was written." That is the whole point of the
mechanism: a failure here is inert.

### Step 5 — enable autonomy

Only after step 4 reads clean. `/autonomy/configuration` → autonomous execution
on. Enabling is refused while a halting condition is active.

Then watch the first live window on `/autonomy/cycles`. A cycle that took no
positions is a successful cycle; the bot is not expected to manufacture action.

---

## 5. Operating

### The three controls, and when each applies

| Control | Where | Confirmation | Use when |
| --- | --- | --- | --- |
| **Kill** | `/autonomy`, always visible | **None, by design** | Stop now, ask later. Prevents new positions; deletes nothing |
| **Resume** | `/autonomy` banner | A dialog | The condition has **cleared**. Refused while anything is still breached |
| **Force Override** | `/autonomy/override` | Per-condition acknowledgement | The condition is still breached and you are deliberately overruling it |

Force Override is a separate route on purpose: a control that overrides a halt
must not sit one mis-tap from the control that clears one. It requires
acknowledging **each** breached condition, is refused while the kill switch is
engaged, and is refused if a named condition has cleared since you loaded the
page (use Resume instead). It **does not disable the breaker** — the condition
is evaluated again on the next cycle.

An override is recorded permanently and renders in Review as
`force_overridden`, with actor and time, at any age. It never becomes
`cleared`.

### Health

`/health` gains two signals and a state chip:

- **Autonomous paper cycle** — game-relative; dormant outside a window or when
  the bot is off.
- **Paper settlement** — late past 3h while positions await settlement.
- **Autonomy state** — `disabled` renders **neutral, not amber**. Choosing not
  to run the bot is a decision, not a fault.

### Withdrawals

Automatic and simulated. When settled balance exceeds
`startingBankroll × ceilingMultiple`, the excess is removed to simulated
withdrawn profit and the high-water mark resets to the post-withdrawal balance,
so banking profit never reads as a drawdown. The ratchet repeats.

**No real money moves. There is no real-withdrawal path in this codebase.**

---

## 6. Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| Every candidate `no_active_recalibration` | No active fit for the projections' model version | Run step 2. Check `recalibration_fits.is_active` and that `model_version` matches the projections |
| Every candidate `stale_projection` | Recompute has not run, or you are inside the inactives window | Check the recompute signal on `/health`; past `kickoff − 90m`, refusal is correct and expected |
| Every candidate `price_unavailable` with a readable ask | The orderbook read returned no size | Check Kalshi reachability. **Never "fix" this by defaulting a size** — refusing is correct |
| Cycles recorded `failed` with a Kalshi message | Outage or rate limit | Designed degraded state. No position was created; the next cycle retries |
| Cycle `skipped` / `pre_kickoff_cutoff` | The scheduler ran late | Correct behaviour. Do not shorten the cutoff |
| Cycle `failed` / `mark_to_market_unavailable` | An open position has no usable bid | Check price refresh. Refusing to stake while a safety check cannot run is intended |
| Drawdown shows `unavailable` | Same cause | It will not fall back to a settled-only figure; that would misstate the safety state |
| Calibration breaker never evaluates | Fewer than 30 graded observations in the window | Expected early. It states insufficient data rather than passing |
| Replay button disabled | Positions in the period are still open | Wait for settlement. Comparing a finished alternative against an unfinished actual is not a comparison |
| Readiness stuck at `paper_evidence_building` | Fewer than two complete weeks | Correct. There is no way to shorten it, and there should not be |

### Things to refuse to do

- Do not default an unreadable top-of-book size to any number.
- Do not walk the order book for an unfilled remainder.
- Do not fill at the midpoint "since it's simulated anyway".
- Do not relax the ten-minute cutoff, in any mode.
- Do not shorten `REQUIRED_PAPER_WEEKS` to reach an earlier eligible state.
- Do not delete a `PaperPosition`, `PaperFill`, or `PaperLedgerEntry` row.

Each of these would make paper performance look better than real execution
would have been, which corrupts the one thing this feature exists to produce.

---

## 7. Before the Week 1 campaign

Per the pitch's launch sequencing, the intended Week 1 autonomous paper
campaign waits for the Simulation Engine. When it ships:

1. Let the nightly job refit recalibration against the new model version's
   backtest record. A model-version change resets the calibration window by
   construction — the window filters on model version.
2. **Run a fresh Dry Run** against a real upcoming window with the new model,
   and read it as in step 4. This is required, not advisory.
3. Only then enable autonomy for Week 1.

Future material model changes require a new Dry Run before autonomy resumes.
The paper track record is not destroyed by a model swap; cycles keep the
recalibration version and risk config they ran under.
