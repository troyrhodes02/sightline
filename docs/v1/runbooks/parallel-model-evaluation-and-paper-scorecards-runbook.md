# Runbook — Parallel Model Evaluation & Paper Scorecards (Pitch 11)

Everything needed outside the codebase to operate this feature: configuring a continuous paper-evaluation campaign, confirming both engines actually run live shadow projections, migrating an existing Pitch 7 paper campaign into the three-portfolio structure, and confirming the Dry Run removal stranded no test or diagnostic.

> Scope reminder: this feature is **paper only**. No control here places a real order or moves real money; real-money operation is Pitch 12 (Kalshi Live Trading) and always requires explicit human action. Every recommendation, leader, and readiness state is read-only with respect to production configuration — the only production-config change is a confirmed human save of the per-stat model selection in Paper Bot → Settings.

Spec: `docs/v1/specs/parallel-model-evaluation-and-paper-scorecards-spec.md`. Decisions referenced as D1–D22.

---

## 1. Prerequisites

- Both engines fitted and loadable in the live environment: Baseline `baseline-zil-0.1.0` and Simulation `simulation-mc-0.1.0`. The live production environment must be able to load the fitted Simulation artifacts (not only local backtests) — confirm the artifact path/version resolves before enabling continuous evaluation.
- A stored `BacktestRun` + `RecalibrationFit` per model version (Simulation and Baseline each have their own fitted correction — D4).
- Env: both `DATABASE_URL` (pooler, app traffic) and the direct connection (Python bulk writes / migrations) configured. Prisma owns the schema; Python never migrates.

---

## 2. Configure a continuous paper-evaluation campaign

A campaign is one `PaperEvaluationCampaign` (shared config) with up to three child `PaperCampaign` portfolios (Baseline, Simulation, and Hybrid when a hybrid selection exists), each reusing the existing paper machinery independently.

**Via the UI (normal path):** Paper Bot → **Settings**:
1. Set **Starting bankroll** (default $1,000). Locked once any position fills — set it before enabling.
2. Set **Risk mode** (Conservative default; or Moderate / Aggressive / Custom). Applies identically to all three portfolios so the comparison is fair (D11/D19).
3. Set **Withdrawal ceiling** (default 1.5×).
4. Set the **Active model by stat type** (the per-stat `ModelSelection`). This defines the active configuration (Baseline-only, Simulation-only, or Hybrid) and therefore which portfolio the readiness gate evaluates (D2). Sightline shows a recommendation (★) beside each stat — it is advisory; saving is an explicit, confirmed human action and is the only production-config write in the feature (D12/D13).
5. Toggle **Continuous paper evaluation** on. Both engines then run every eligible game window automatically — the active model drives the slate, the other runs in shadow — with no per-cycle approval and no Dry Run gate (D7).

**Notes:**
- Changing a stat's active model resets that configuration's readiness clock against the newly-active configuration's own portfolio (D2). The confirmation dialog states this. Do not switch configurations immediately before a readiness check expecting prior evidence to count — it does not.
- Changing starting bankroll or risk mode mid-campaign: bankroll is locked after the first fill; a risk-mode change is versioned (append-only `PaperRiskConfig`) and open positions keep the limits they were opened under. Both are recorded, never silently applied.

---

## 3. Confirm BOTH engines are running live shadow projections (not just the active one)

The most important operational check for this feature. Continuous evaluation must be generating and grading projections for **both** engines every eligible window, or the comparison is hollow.

1. **Projection rows exist for both model versions.** For a recent in-window game/stat where Simulation supports the stat, confirm two current pre-kickoff projections exist — one `baseline-zil-0.1.0` and one `simulation-mc-0.1.0` — with distinct `model_version` and `computed_at` before the game's kickoff freeze:
   ```sql
   select model_version, count(*), max(computed_at)
   from projections p
   join games g on g.id = p.game_id
   where g.kickoff_at > now()  -- upcoming window
   group by model_version;
   ```
   Both versions must appear. If only the active one appears, the parallel-execution step (SIG-103) is not running — check the live pipeline logs and the model-selection registry.
2. **Both engines are being graded.** After a completed game, both versions' projections should reach graded/unresolvable states via the existing grading machinery. Confirm `ProjectionGrade`/`ThresholdGrade` rows exist for both model versions for that game.
3. **Temporal integrity (no backfilled live evidence).** Every projection counted as live evidence must have `computed_at` **before** its game's kickoff freeze. Spot-check that no projection with `computed_at` at or after kickoff is being counted:
   ```sql
   select p.id, p.model_version, p.computed_at, g.kickoff_at
   from projections p join games g on g.id = p.game_id
   where p.computed_at >= g.kickoff_at;   -- these must never be counted as live evidence
   ```
   If any exist, they must be excluded from the comparison (the read enforces this; this query is a canary).
4. **Snapshot dedup (D3).** Repeated pre-kickoff recomputes of one contract count as exactly one live observation per model — the latest before the freeze. Confirm the comparison read's live count for a heavily-recomputed contract equals 1 per model, not the recompute count. (Covered by the automated dedup test; verify in the Model Performance → Breakdown live counts if in doubt.)
5. **Recalibration fairness (D4).** On Model Performance → Advanced, each series names its model version and its own correction. Baseline's Brier must be computed under Baseline's fit and Simulation's under Simulation's — never crossed. This is structurally enforced; the Advanced labels are the human-visible confirmation.

---

## 4. Migrate an existing Pitch 7 paper campaign into the three-portfolio structure

The SIG-102 migration (`pme1_evaluation_campaign_portfolios`) creates the parent and backfills the existing single `PaperCampaign`. Operate it deliberately:

1. **Back up first.** Snapshot `paper_campaigns`, `paper_ledger_entries`, `paper_positions`, `paper_cycles`, `paper_breaches`. Paper history is a record; `Decision`/`Position` (the human-generated data) must never be touched — the migration does not touch them, but verify.
2. **Run the migration** against the target database (dev preview first, per workflow):
   ```bash
   npx prisma migrate deploy   # applies the committed migration
   ```
3. **What the backfill does** (per spec §Migration plan): creates one `PaperEvaluationCampaign` from the existing campaign's config (starting bankroll, withdrawal multiple from the active `PaperRiskConfig`, `killSwitchEngaged`, `startedAt` → `campaignStartedAt`); sets the existing campaign's `portfolio` to the currently-active configuration (Baseline-only or Simulation-only per the dominant `ModelSelection`; `baseline` if ambiguous) and `portfolioStartedAt = startedAt`; creates the sibling portfolio row(s) with empty bankroll history so the other engine begins accumulating; creates a `hybrid` portfolio only if a mixed `ModelSelection` exists; backfills `source_model_version` on positions from each position's cycle candidate's `projection.model_version` (fallback to the portfolio's engine version).
4. **Verify post-migration:**
   ```sql
   select ec.id, pc.portfolio, pc.portfolio_started_at, pc.starting_bankroll_cents
   from paper_evaluation_campaigns ec
   join paper_campaigns pc on pc.evaluation_campaign_id = ec.id;
   ```
   Expect one evaluation campaign and 2–3 portfolios. Confirm the pre-existing campaign's ledger/positions/cycles are attached to exactly one portfolio (the one matching the prior active configuration) and were not duplicated. Confirm the per-portfolio ledger running-total invariant still holds (the schema test asserts this).
5. **The prior campaign's accumulated evidence stays with its portfolio.** It does not become "Hybrid" evidence and does not transfer if the active configuration later changes (D2).

---

## 5. Confirm the Dry Run removal stranded nothing (D7)

Dry Run is retired as a **workflow and gate**, but the underlying decision-path-without-writing-a-position function survives as a non-navigable test/diagnostic utility. Confirm both halves:

1. **The user-facing surface is gone.**
   - `/autonomy/dry-run` returns 404 or redirects to `/autonomy`; it is absent from Paper Bot navigation.
   - `POST /api/autonomy/dry-run` no longer exists.
   - Enabling continuous paper evaluation requires no Dry Run (there is no gate).
2. **The internal preview function still works.** `runDryRun()` / `planCycle()` remain importable and callable from the test suite and internal diagnostics. Confirm the automated test asserting "route unreachable + nav absent while the function is still callable" passes. It must NOT have been renamed "Preview" with the gate preserved.
3. **No stranded test/diagnostic.** Grep for references to the removed route/screen/tab and confirm any remaining test uses the function directly, not the removed navigation path:
   ```bash
   grep -rn "dry-run\|dryRun\|DryRun\|PaperDryRun" src python prisma e2e tests 2>/dev/null
   ```
   Remaining hits should be: the retained `runDryRun`/`planCycle` utility and its direct-call tests. Any hit that navigates to `/autonomy/dry-run` or calls the removed API is a stranded reference to fix.
4. **`paper_dry_runs` table dropped.** The migration removes it; confirm no code reads `prisma.paperDryRun`.

---

## 6. Readiness (operational reading)

Readiness (Paper Bot → Performance) is a summary state (not_ready / paper_evidence_building / eligible_for_live_trading) with expandable criterion detail (D21). It always evaluates the **currently-active configuration's own portfolio** (D2) and its two-complete-NFL-weeks clock measures from that portfolio's `portfolio_started_at`. It never enables real-money trading — Pitch 12 + explicit human action is required. A green scorecard grants no permission.

---

## 7. Failure modes and recovery

- **Only one engine's projections appear:** parallel execution not running — check the live pipeline job and that the Simulation artifact loads in the live environment.
- **A portfolio halted (breach):** breaches are per portfolio; Resume (when cleared) or Force Override (with per-condition acknowledgement) from the Performance banner. The campaign-wide kill switch stops new positions across all portfolios.
- **Mark-to-market unavailable (Kalshi degraded):** the affected portfolio's active bankroll and drawdown render `unavailable` with a last-fetch timestamp; settled figures stay exact. Not an error.
- **Recalibration missing for a model version:** the comparison read errors for that series rather than silently using another model's fit (D4). Fit the missing `RecalibrationFit` for that model version.
- All scheduled-job caveats from Live Pipeline & Staleness still apply (GitHub Actions 60-day disable, no timing SLA, silent failures surfaced via Health).
