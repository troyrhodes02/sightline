# Run Progress — Parallel Model Evaluation & Paper Scorecards

**Slug:** `parallel-model-evaluation-and-paper-scorecards`
**Linear project:** Sightline V1 (`ee9590bc-2cf0-4ca1-9e19-9a7d9c26b084`)
**Pitch doc:** https://linear.app/sightline-pilot/document/sightline-pitch-parallel-model-evaluation-and-paper-scorecards-d6575e25360f
**Run mode:** Autonomous Pipeline Policy. **This run does NOT merge into `main`.** Ends with feature PR open, verified, reviewed, audited, green.

## Current step

Step 1 complete (pitch pulled to repo). Starting Step 2: design doc.

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

(none created yet — see Step 6)

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
