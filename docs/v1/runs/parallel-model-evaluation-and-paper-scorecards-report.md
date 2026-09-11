# Run Report — Parallel Model Evaluation & Paper Scorecards (Pitch 11)

**Slug:** `parallel-model-evaluation-and-paper-scorecards`
**Linear project:** Sightline V1 · **Milestone:** Pitch 11: Parallel Model Evaluation & Paper Scorecards
**Run mode:** Autonomous Pipeline Policy — **this run did NOT merge into `main`.**
**Date:** 2026-09-11

---

## Status: awaiting human review — NOT merged

The feature branch `feature/parallel-model-evaluation-and-paper-scorecards` is verified, reviewed, audited, and green, with its PR open for human review. **It has not been merged into `main`, and must not be until a human approves it.**

**Feature PR:** https://github.com/troyrhodes02/sightline/pull/106 (open, base `main`, marked do-not-merge).

All seven ticket PRs were squash-merged into the feature branch in build order and closed (see map below). The feature PR carries the whole feature as one reviewable unit.

---

## What shipped

Runs Baseline (`baseline-zil-0.1.0`) and Simulation (`simulation-mc-0.1.0`) as parallel live engines — the non-active one in shadow — grades both, and answers *which engine should Sightline trust, and why* in plain language, while running three continuous paper portfolios under identical assumptions. No computed recommendation, leader, or readiness state ever changes production; the only production-config mutation is a confirmed human save of the per-stat model selection.

Delivered across 7 tickets (all verification green at each; see per-ticket notes in the progress file):

| Ticket | PR | Scope | Squash commit |
| ------ | -- | ----- | ------------- |
| **SIG-102** PME-1 | #107 | Data model — `PaperEvaluationCampaign`, `PaperPortfolio` enum, portfolio discriminator on `PaperCampaign`, `sourceModelVersion`, drop `PaperDryRun`; migration + backfill | d6a1d8c |
| **SIG-103** PME-2 | #108 | Both engines run live (shadow); dual grading; temporal-integrity guard (`computed_at < kickoff`) | 6c6a58e |
| **SIG-104** PME-3 | #109 | `src/lib/model-eval/` comparison read + leader/recommendation; structural recalibration fairness (D4); live dedup (D3) | 88cfc89 |
| **SIG-106** PME-5 | #110 | Three paper portfolios, per-portfolio cycles/scorecards, opportunity counts (D5), Hybrid attribution (D6) | 2755a7e |
| **SIG-105** PME-4 | #111 | Model Performance surface (Summary/Breakdown/Advanced) + Accuracy→Model Performance rename + redirects | ece8ca8 |
| **SIG-107** PME-6 | #112 | Paper Bot reorg (Performance/Activity/Settings), model selection, readiness reset (D2), Dry Run removal (D7) | 3e7e3b9 |
| **SIG-108** PME-7 | #113 | Viewer track-record block on contract detail (D8/D18) | c87bb3d |

*(Build order note: SIG-105 and SIG-106 are PME-4 and PME-5 respectively; the three-portfolio backend (SIG-106) was built before the Model Performance UI (SIG-105) so the UI could consume the scorecards. The Linear `SIG-106 blockedBy SIG-105` edge is therefore cosmetically backwards — no functional impact. Flagged for optional human cleanup.)*

---

## Leader / too-close / insufficient-evidence per stat type (decision 1 thresholds)

Decision 1 thresholds: absolute Brier margin ≥ 0.01 to declare a leader; **Live** floor 50 graded predictions; **Backtest** floor 500.

**The leader / too-close-to-call / not-enough-evidence split is computed at read time from graded data — it is not a static code output.** In this pre-deployment environment **no continuous live paper campaign has accumulated graded predictions**, so under decision 1:

- **Live Performance:** every stat type reads **not enough evidence** (0 live graded predictions < the 50 floor). The live comparison becomes meaningful only once continuous evaluation has run for real pre-kickoff windows and grading has accumulated ≥ 50 graded predictions per stat type — roughly two-plus NFL weeks in.
- **Historical Backtest:** the per-stat leader depends on the stored `BacktestRun` / `CalibrationBin` records present in the target database at read time. That is a data/ops input (which backtests have been run and stored), not a code deliverable of this pitch; the surface renders whatever the stored records support, applying the same 0.01 margin / 500 floor. No leader is asserted here because doing so would require fabricating graded data this environment does not contain.

This is the honest state: the machinery to compute and display the split is built, tested, and correct; the split itself is empty on the live side until a real campaign runs. Verifying the live split is a runbook step (§3 "Confirm BOTH engines are running live shadow projections").

---

## Required upstream amendments (for a human to apply to the planning docs)

These were **not** applied during this run (out of scope for the run; the pitch names the first two itself):

1. **PRD / Roadmap — remove the "Dry Run required before Autonomous Execution" dependency chain.** The current PRD and Roadmap still state that Dry Run requires Position Sizing and Autonomous Execution requires Dry Run. Continuous paper evaluation supersedes that gate; Dry Run is retired as a user-facing workflow (its internal preview function is retained as a test-only utility).
2. **Roadmap — renumber Kalshi Live Trading to Pitch 12.** This pitch (Parallel Model Evaluation & Paper Scorecards) takes the Pitch 11 slot; Kalshi Live Trading becomes the remaining real-money pitch at Pitch 12.
3. **Numeric defaults flagged for explicit human review** (adopted as Resolved Decisions this run, but not specified upstream):
   - **50-observation Live-evidence minimum** (decision 1). Chosen because live evidence accrues one NFL week at a time and a 500-observation live floor would make "live evidence" unreachable in-season. Not specified in any approved doc — please confirm.
   - **30-observation bucket-display floor** (decision 8) for every probability-bucket rate (admin Breakdown/Advanced + viewer track-record). Reuses the calibration circuit-breaker minimum rather than inventing a fourth number. Please confirm.

*(Architecture/PRD housekeeping already noted in CLAUDE.md, unchanged by this run: `Invitation` removed; charting library (Recharts) still to be named in Architecture. Not part of this pitch.)*

---

## Decisions made on the user's behalf

**Pre-resolved by the run instruction (recorded as D1–D8 in the spec, cited as approved-doc authority):** leader/evidence thresholds (D1), readiness reset on config switch (D2), snapshot dedup (D3), structural recalibration fairness (D4), opportunity counts (D5), Hybrid attribution (D6), Dry Run removal keeping the preview fn (D7), 30-obs bucket floor (D8).

**Design/spec-level decisions (D9–D22 in the design doc & spec), each with rationale there.** Highlights:

- **Model Performance is admin-only** (D9), correcting the initial draft. The current `/accuracy` implementation is already `requireAdmin()`, and the pitch frames Model Performance as "the main admin model-quality experience"; the viewer's only model-quality surface is the contract track-record block (D18). This resolves the PRD's open "viewer calibration visibility" question by giving viewers the simplified form, not the full surface.
- **Three-portfolio data model** (spec §Data model): a parent `PaperEvaluationCampaign` with a `portfolio`-discriminated `PaperCampaign` per portfolio, reusing the entire Pitch 7 machinery ×3 rather than reinventing it.
- **Routes:** Accuracy→Model Performance and Autonomy→Paper Bot with 308-redirects for every legacy path; `/autonomy/dry-run` removed.

**Implementation decisions made by ticket workers** (recorded per-ticket in the progress file), e.g.: the risk config is authored once and **shared** across portfolios (not cloned per portfolio) so "risk mode never changes itself" stays a single-writer invariant; `SIMULATION_SUPPORTED_STATS` (yardage + receptions; TDs = "Sim n/a") as the single source of truth for the Settings disabled radio and the route's stat validation; missing Simulation artefacts degrade a live run to baseline-only loudly rather than aborting.

---

## Review findings and dispositions

An 8-angle automated review ran against the feature PR. **Six of the seven stop-condition invariants were independently confirmed structurally enforced by the code** (not merely by tests): no computed value mutates production config; recalibration fairness (D4) has no crossing path; temporal integrity (backfilling form) guards before persist in both engine paths; prices never feed projections; Model Performance + Paper Bot are admin-gated server-side and the viewer track-record read leaks no shadow/leader/bankroll; no secrets surface.

Eight findings were surfaced and dispositioned (full table posted on PR #106):

**Implemented (6):**
- 🔴 **CRITICAL — Simulation & Hybrid portfolios never traded.** The cycle looked up the risk config per portfolio and skipped any without one; only the baseline portfolio was ever configured, so Simulation and Hybrid were skipped every tick and the three-portfolio comparison was hollow. Fixed by resolving the campaign's **one shared** risk config for all portfolios (preserving the single-writer invariant) and giving each provisioned sibling an opening-balance ledger entry. Regression tests added. *This was the most important catch of the run — the feature's core was non-functional and all unit tests passed because fixtures set configs per-portfolio.*
- ComparisonBarChart no longer declares a winner within the 0.01 leader margin / on a tie (no false certainty vs the "too close to call" verdict).
- `scorecardForPortfolio` batches ~5 independent reads into one `Promise.all`.
- Shared `modelDisplayName()` helper replaces duplicated / hardcoded version literals in `LeaderChip` and `leader.ts`.
- Deterministic sibling autonomy inheritance (from baseline, not an unordered relation row).
- Provisioning field-divergence eliminated as a side effect of the shared-config fix.

**Deferred (2), documented in-code + here:**
- Hybrid cycle records the primary version's `recalibrationId` on all positions in the cycle — a provenance mis-attribution for non-primary candidates only; **scoring is unaffected** (model-eval reads calibration by modelVersion independently). A per-candidate `recalibrationId` on the write path is a follow-up.
- "View readiness detail →" links to Paper Bot Performance where the criterion detail sits behind a collapsed expander; a follow-up should pass state to open it expanded.

Also deferred from ticket work (in progress file, for follow-up): per-confidence and per-probability-bucket comparison **rates** on Model Performance Breakdown currently render the honest insufficient-evidence state (D8/D16 preserved) rather than fabricated rates, because SIG-104's comparison read exposes overall/per-stat/financial series but not per-confidence/per-bucket segmented series; a segmented read is a follow-up enhancement.

---

## Verification results (actual outcomes, feature branch, after audit fixes)

| Check | Result |
| ----- | ------ |
| `prisma validate` | ✅ pass |
| `prisma format` | ✅ pass |
| `typecheck` (`tsc --noEmit`) | ✅ pass |
| `format` (`prettier --check`) | ✅ pass (fixed `e2e/authenticated.spec.ts`, which had slipped through partial-scope checks in SIG-105/107/108) |
| `lint` (`eslint .`) | ✅ pass on the branch — the only errors are 4 pre-existing `no-console` in `prisma/seed-dev-game.ts`, an **untracked** file not on the branch (CI, on a fresh checkout, is clean; confirmed via `eslint . --ignore-pattern`) |
| schema tests (`node --test prisma/tests`) | ✅ 36/36 |
| Jest (unit + integration) | ✅ **1062/1062** (86 suites) |
| `build` (`prisma generate && next build`) | ✅ pass (routes `/model-performance`(+overrides), `/slate/[contractId]`, `/autonomy`+`/activity`+`/settings`, `/api/model-selection`; `/autonomy/dry-run` removed) |
| Python (`uv run pytest`) | ✅ **500/500** |
| e2e (`playwright`) | ⚠️ **not runnable locally** — the authenticated suite is skip-gated on a running server + seeded Supabase credentials unavailable in this environment. Specs were updated for the route rename and execute on the Vercel preview. |

**The 7 pitch-specific required tests all exist, assert correctly, and pass:**
1. Recalibration fairness structural — `model-eval/read.test.ts`: "has no public API shape that accepts a foreign fit or a crossing parameter".
2. Snapshot dedup — `model-eval/read.test.ts`: "counts exactly one observation per (model, contract) via DISTINCT ON latest pre-kickoff" + Python `test_post_kickoff_computation_is_never_stored_as_live`.
3. Readiness reset — `model-selection.test.ts`: "resets the newly-active HYBRID portfolio's clock, not Simulation's (D2)".
4. Both engines keep accruing — Python `test_both_engines_projections_are_graded_independently` + parallel `_project_all`.
5. Hybrid attribution retained — `portfolios.test.ts`: "never updates sourceModelVersion after a position is created".
6. Dry Run unreachable / fn callable — `paper-bot-invariants.test.ts`: "no /autonomy/dry-run page and no /api/autonomy/dry-run route" + "keeps runDryRun and planCycle importable and callable (not renamed Preview)".
7. No bucket rate below 30 — `track-record.test.ts`: "withholds the rate below 30 observations".

---

## Anything requiring a decision that could not be made autonomously

None blocked the run. Two items are flagged for human sign-off (above): the **50-observation live-evidence minimum** and the **30-observation bucket-display floor** — both adopted as defaults and clearly labelled, since the live minimum in particular was not specified upstream.

No stop condition was hit. Every stated invariant was independently confirmed enforced by the code. The one serious defect found in review (hollow sibling portfolios) was a functional bug, not an invariant breach, and was fixed within scope.

---

## Squash-merge / PR bookkeeping note (for transparency)

The ticket PRs were built as a stacked chain and squash-merged into the feature branch **locally**, in build order, then closed with a comment referencing their squash commit — because GitHub's squash button conflicted only on the run-progress doc file (edited on both the feature branch and the ticket branches). The feature branch's code tree was verified **byte-identical** to the cumulative tip of the stack before verification, so no ticket code was lost or altered by the local squash. All ticket code is in the feature branch under PR #106.

## Next steps for the human reviewer

1. Review PR #106.
2. Apply the three upstream doc amendments above (Dry Run dependency removal; Kalshi Live Trading → Pitch 12; confirm the two numeric defaults).
3. Optionally address the deferred follow-ups (per-candidate `recalibrationId`; Breakdown segmented rates; readiness-detail link expand-state; the cosmetic `SIG-106 blockedBy SIG-105` edge).
4. Before any real deployment, follow the runbook (`docs/v1/runbooks/parallel-model-evaluation-and-paper-scorecards-runbook.md`) §3 to confirm both engines are actually generating live shadow projections, and §4 to migrate any existing Pitch 7 campaign into the three-portfolio structure.
