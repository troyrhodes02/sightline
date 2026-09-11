# Run Progress — Parallel Model Evaluation & Paper Scorecards

**Slug:** `parallel-model-evaluation-and-paper-scorecards`
**Linear project:** Sightline V1 (`ee9590bc-2cf0-4ca1-9e19-9a7d9c26b084`)
**Pitch doc:** https://linear.app/sightline-pilot/document/sightline-pitch-parallel-model-evaluation-and-paper-scorecards-d6575e25360f
**Run mode:** Autonomous Pipeline Policy. **This run does NOT merge into `main`.** Ends with feature PR open, verified, reviewed, audited, green.

## Current step

Steps 1–5 complete (pitch, design doc, UI preview, spec, Resolved Decisions D1–D22 recorded in spec + open-question flags). Starting Step 6: milestone + Linear issues.

Note: spec fork hallucinated completion once (0 tool uses); spec was authored directly in main thread instead. All good.

## Codebase facts (from Explore survey — ground truth for spec/tickets)

**Accuracy (to become Model Performance):**
- Page `src/app/(app)/accuracy/page.tsx` — **admin-only (`requireAdmin()`)**, `adminGroup` in nav. Overrides at `.../overrides`.
- Screen `src/components/screens/Accuracy.tsx`; `src/components/accuracy/{ReliabilityCurve,AccuracyScopeBar,SampleSizePair,OverridesEntry}.tsx`.
- DTOs `src/lib/dto/accuracy.ts`; read `src/lib/accuracy/read.ts`; scope `src/lib/accuracy/scope.ts`.
- Scope params: record(live|backtest|compare), population(contract_like|all|market_linked), modelVersion(active|all|lifetime), stat, season. 10 fixed calibration bins.
- **DECISION: Model Performance stays admin-only** (matches impl + pitch framing). Viewers' only model evidence = contract track-record block.

**Autonomy (to become Paper Bot):**
- Pages under `src/app/(app)/autonomy/{,cycles,positions,review,readiness,configuration,dry-run,override}/`.
- Screens `src/components/screens/Autonomy*.tsx` (7); tabs `src/components/autonomy/AutonomyTabs.tsx`; primitives `src/components/autonomy/primitives.tsx` (RiskModeChip, ExposureMeter, Figure, BankrollChart).
- DTOs `src/lib/dto/autonomy.ts`. Paper libs `src/lib/paper/{plan,breakers,read,dry-run,recalibration/store}.ts`.

**Prisma (schema.prisma):**
- `ModelSelection` (@id statType → modelVersion, backtestRunId, brierDelta, sampleSize, promotedAt). One row per StatType.
- `RecalibrationFit` (version Int unique, **modelVersion**, backtestRunId, method, shrinkageK, knots Json, isActive). Correction already keyed by modelVersion → D4 friendly.
- `Projection` (modelVersion; unique [playerId,gameId,statType,modelVersion,informationCutoff,provenance]; index [gameId,statType,modelVersion,computedAt desc]).
- `PaperCampaign` (single campaign: startingBankrollCents, activeBankrollCents, highWaterMarkCents, autonomyEnabled, killSwitchEngaged). **Needs a portfolio dimension (baseline/simulation/hybrid) — real schema change.**
- `PaperPosition`, `PaperLedgerEntry` (kinds incl withdrawal), `PaperRiskConfig` (append-only), `PaperCycle`, `PaperCycleCandidate` (raw+corrected prob), `PaperDryRun` (schema.prisma ~1740) — **remove table + route + screen + tab; keep runDryRun()/planCycle() logic as internal/test util (D7).**
- Model versions: Baseline `baseline-zil-0.1.0`; Simulation `simulation-mc-0.1.0`.

**Nav:** `src/components/shell/NavSections.ts` (`SECTIONS`), `src/components/shell/AppShell.tsx`. adminGroup gathers admin items into Admin dropdown; `requireAdmin()` server gate per route; nav absence for viewers (not disabled).

**Dry Run removal file list:** AutonomyDryRun screen, `/autonomy/dry-run` page, `/api/autonomy/dry-run` route, AutonomyTabs entry, PaperDryRun model+migration. Keep `runDryRun()` body reachable by tests only, `planCycle()`.

## Key architectural decisions for the spec (resumable)

- **Three portfolios (central schema change):** today there is ONE `PaperCampaign` (starting bankroll, high-water, kill switch; owns riskConfigs/ledger/cycles/positions/breaches). Pitch needs THREE parallel portfolios (baseline/simulation/hybrid). **Approach: introduce a parent `PaperEvaluationCampaign` (shared config: starting bankroll, risk config lineage, withdrawal, continuous-eval enabled, campaign start, model-selection snapshot) and add `portfolio` enum + `evaluationCampaignId` to `PaperCampaign`; create 3 PaperCampaign rows (hybrid only when a hybrid selection exists) that each reuse the ENTIRE existing paper machinery (ledger/cycles/positions/breaches/high-water) independently.** Kill switch is campaign(eval)-wide; breaches are per portfolio. This reuses pitch-7 machinery ×3 rather than reinventing.
- **Both engines run live:** live pipeline currently generates only the active model per stat (ModelSelection). Change: generate BOTH baseline + simulation projections every eligible window where Simulation supports the stat (Projection unique key already allows multiple modelVersions). Grading already grades all stored projections. Shadow = the non-active model's projection; stored, graded, drives its own portfolio, never the slate's active projection (D22).
- **Live-evidence dedup (D3):** comparison read counts one obs per model per contract = latest projection with computedAt before the game's kickoff-freeze boundary; earlier pre-kickoff recomputes retained (superseded) but excluded. Kickoff-freeze concept from Adjustment Suggestions/Live Pipeline.
- **Recalibration fairness (D4):** RecalibrationFit is already keyed by modelVersion. Comparison read must resolve each series' correction by its own modelVersion — no shared/default fit. Structural test: attempting to score model A's projections under model B's fit is impossible through the read API (the read takes (modelVersion) and fetches its own fit; no param lets you cross them).
- **Leader/recommendation logic:** pure function over stored Brier per (model, population, record) applying RD-1 (margin ≥0.01, live n≥50, backtest n≥500) → one of {simulation_leads, baseline_leads, too_close_to_call, not_enough_evidence}. Overall pools contract-like; by-stat per stat. Recommendation is derived text; NEVER writes ModelSelection (D12).
- **Model selection:** ModelSelection table (per statType → modelVersion) already exists; Settings writes it on confirmed human save only; that write is the ONLY production-config mutation in the feature. Switching resets readiness clock (D2) — readiness computed against the active config's own portfolio; store an "activeConfigChangedAt"/portfolio-start marker so the 2-week clock measures from the last change.
- **PaperReplay (risk-mode counterfactual from pitch 7):** retained in schema, Review nav removed; not a primary surface. What-if Replay stays excluded. Do not delete records.
- **Routes:** rename Accuracy→Model Performance (`/model-performance`, admin), levels via `?level=`; Autonomy→Paper Bot (`/autonomy`), sub `/autonomy/activity`,`/autonomy/settings`. 308-redirects for legacy paths; `/autonomy/dry-run` removed.

## Pipeline steps

1. [x] Pull pitch → `docs/v1/pitches/parallel-model-evaluation-and-paper-scorecards.md`
2. [ ] `/sightline-design-doc` → design-docs/...-design-doc.md
3. [ ] `/sightline-ui-design` → ui/...-ui-preview.html
4. [ ] `/sightline-spec` → specs/...-spec.md
5. [ ] Resolve remaining open questions → Resolved Decisions in spec
6. [ ] Milestone + Linear issues chained blockedBy
7. [ ] Feature PR into main
8. [ ] Work every ticket via /sightline-ticket-worker
9. [ ] Runbook
10. [ ] Squash-merge ticket PRs into feature branch
11. [ ] Full verification suite (+7 pitch-specific tests)
12. [ ] /review → inline comments on feature PR
13. [ ] /sightline-review-audit → implement/defer/discuss/skip
14. [ ] Commit, push, re-run suite. STOP (no merge to main).
15. [ ] Run report

## Tickets

Milestone: **Pitch 11: Parallel Model Evaluation & Paper Scorecards** (`3d847a2f-6962-42f9-a693-cd38c47543a8`).
Linear team `Sightline` (prefix SIG-). Linear chain (each branches off the previous; first off the feature branch):

1. **SIG-102** PME-1: Data model — evaluation campaign, portfolio discriminator, Hybrid attribution, drop PaperDryRun
2. **SIG-103** PME-2: Parallel live shadow projections + dual grading (temporal integrity) — blockedBy 102
3. **SIG-104** PME-3: Model comparison read + leader/recommendation engine (D1/D3/D4) — blockedBy 103
4. **SIG-105** PME-4: Model Performance surface (Summary/Breakdown/Advanced) + Accuracy→Model Performance rename — blockedBy 104
5. **SIG-106** PME-5: Three paper portfolios — per-portfolio cycles, scorecards, opportunity counts, Hybrid attribution — blockedBy 105
6. **SIG-107** PME-6: Paper Bot reorg + model selection + readiness reset + Dry Run removal — blockedBy 106
7. **SIG-108** PME-7: Viewer track-record block on contract detail (D8/D18) — blockedBy 107

Status / PRs (base of every ticket PR = feature branch; each ticket branch stacked off the previous):
- **SIG-102** ✅ DONE — PR #107, branch `wtrhodesdev/sig-102-pme-1-data-model-...`. Verification all green (prisma validate/format, typecheck, test 957/957, test:schema 36/36, format, build). Migration+backfill exercised end-to-end. Linear → In Progress (no "In Review" state in this workflow).
- **SIG-103** ⏳ next — branches off SIG-102's branch.
- SIG-104..108 pending.

**Note:** Linear workflow has no "In Review" state (Backlog/Todo/In Progress/Done/Canceled/Duplicate). Tickets handed off in "In Progress" with PR attached.

**Feature PR:** #106 (https://github.com/troyrhodes02/sightline/pull/106) — base main, DO NOT MERGE.

**Ticket-worker git flow:** each ticket branch is stacked off the previous; each ticket PR has base = feature branch. At Step 10 they squash-merge into feature in order. Runbook is drafted and staged at scratchpad `runbook-staged.md` (kept out of the tree during ticket work; restore to docs/v1/runbooks/ before final verification).

## Resolved Decisions

Pre-resolved by the run instruction (all cite the run instruction as approved-doc authority):

- **RD-1 Leader/evidence thresholds.** Leader (overall & by stat type) requires ≥0.01 absolute Brier margin (reuses Simulation Engine promotion bar). Below margin = "too close to call". Sample minimums: Historical Backtest ≥500 graded (Simulation Engine backtest bar); Live Performance ≥50 graded (new, lower because live accrues one NFL week at a time). Below minimum = "not enough evidence". Overall pools all stat types into one contract-like population; by-stat applies independently per stat type. One rule, one margin, two populations.
- **RD-2 Readiness reset.** Two-complete-NFL-weeks readiness (staking pitch) evaluates the currently-active configuration's own portfolio (Baseline-only / Simulation-only / Hybrid). Never borrows another portfolio's results. Changing active configuration resets the readiness clock against the newly active config's own portfolio; prior config's evidence does not transfer.
- **RD-3 Snapshot dedup.** Live evidence counts exactly one observation per model per contract = latest projection generated before the kickoff freeze boundary (reuses Adjustment Suggestions kickoff-timestamp). Earlier recomputes retained as superseded snapshots for audit, excluded from sample counts.
- **RD-4 Recalibration fairness (structural).** Every comparison reads each model's Brier/calibration using that model's own fitted Probability Recalibration state keyed by model version. Comparison query must be structurally incapable of scoring one model's projections against another's correction — model-version key threaded through, no shared/default correction object.
- **RD-5 Opportunity counts.** Every paper scorecard shows count evaluated + count sized, alongside P&L/return/drawdown. Baseline and Simulation need not see the same opportunity set.
- **RD-6 Hybrid attribution.** Going forward, Hybrid sources each stat's probability from the currently-selected model at decision time. Historically, an opened Hybrid position permanently retains the model that produced its driving probability; later selection changes never relabel it.
- **RD-7 Dry Run removal.** Remove Dry Run route, nav entry, and its prerequisite role. Keep the underlying decision-path-without-writing-a-position function as a non-navigable testing/diagnostic utility. Do NOT rename to "Preview" and keep the gate.
- **RD-8 Bucket display floor.** Every probability-bucket rate (admin Breakdown/Advanced + viewer track-record) uses a minimum of 30 observations before showing a numeric rate (reuses calibration circuit breaker minimum). Below 30 = states plainly not enough evidence.

## Upstream amendments (for run report — do NOT apply during run)

- PRD/Roadmap: remove "Dry Run required before Autonomous Execution" dependency chain; continuous paper evaluation supersedes it.
- Roadmap: Kalshi Live Trading renumbers to Pitch 12.
- Numeric defaults for human review: 50-observation live-evidence minimum; 30-observation bucket-display floor (live minimum not specified upstream).

## Stop conditions watch

- SC2 invariant: no recommendation/leader/readiness path writes to active model selection / Hybrid config / trading setting without explicit human action.
- RD-4 recalibration fairness is a second adjacent invariant: any comparison path lacking an explicit model-version key = defect.
- Temporal integrity (backfilling form): a live-evidence observation must never come from a post-game computation.
