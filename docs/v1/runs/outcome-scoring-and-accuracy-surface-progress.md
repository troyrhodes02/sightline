# Run Progress — Outcome Scoring & Accuracy Surface

Slug: `outcome-scoring-and-accuracy-surface`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

## Current step

**Step 3 — UI preview** (steps 1–2 complete).

Key ground truth established (from planning-doc + codebase research):
- Final pre-kickoff snapshot EXISTS and is wired: `RecommendationSnapshot.trigger = final_pre_kickoff`, captured by `src/lib/pipeline/final-snapshot.ts` via `/api/pipeline/price-refresh` on the 15-min cron, 45-min window, partial unique index one-per-contract. Postponed-game re-capture semantics deliberately deferred to this pitch.
- NO `Outcome` model exists; `Contract` has no settlement columns; Kalshi client has no settlement endpoint (needs new method).
- Python import-graph guard (`python/tests/test_import_graph.py`) forbids price/recommendation table names in both Python packages → contract-facing grading (settlement, recommendations, decisions, market comparison) must be TypeScript-side; model grading (projection vs official stats) is Python-side via `GradingCorpus`.
- `CalibrationBin` is backtest-scoped (`backtestRunId` FK, population `contract_like`, `belowFloor` at 1,000-obs REPORTING_FLOOR, 10 fixed bins). Live calibration needs new storage.
- Correction signal exists: `PlayerGameStatCorrection` rows written by stats ingest; nothing consumes them yet.
- Health: closed union `"ingest"|"recompute"|"price_refresh"` in `src/lib/dto/health.ts` must widen; `PipelineJobCategory` enum needs new values via migration.
- SIG-28: `projectedValue` = mean (headline), `projectedMedian` = q50. Aggregates JSON has `pointEstimates {mean, median}`; baselines refuse Brier (metrics.py).
- Nav: add Accuracy to `src/components/shell/NavSections.ts` (`adminOnly: false`); admin routes must be added to `build-invariants.test.ts` list.

## Pipeline checklist

- [x] 1. Pull pitch doc from Linear → `docs/v1/pitches/outcome-scoring-and-accuracy-surface.md`
- [x] 2. Design doc → `docs/v1/design-docs/outcome-scoring-and-accuracy-surface-design-doc.md`
- [x] 3. UI preview → `docs/v1/ui/outcome-scoring-and-accuracy-surface-ui-preview.html`
- [x] 4. Spec → `docs/v1/specs/outcome-scoring-and-accuracy-surface-spec.md`
- [x] 5. Resolve remaining open questions as Resolved Decisions (all 18: 1–11 pre-resolved by instruction, 12–18 in design doc; spec restates; three inherited postures noted non-blocking in spec §16)
- [ ] 6. Milestone + Linear issues, chained blockedBy, IDs captured here
- [ ] 7. Feature PR into main
- [ ] 8. Work every ticket in order (branch chain), PR each
- [ ] 9. Runbook
- [ ] 10. Squash-merge ticket PRs into feature branch in order
- [ ] 11. Full verification suite on feature branch
- [ ] 12. /review feature branch vs main, findings as inline comments on feature PR
- [ ] 13. /sightline-review-audit those comments; disposition each
- [ ] 14. Re-run suite; squash-merge feature branch into main if green
- [ ] 15. Run report → `docs/v1/runs/outcome-scoring-and-accuracy-surface-report.md`

## Pre-resolved decisions (from the run instruction — treat as approved-doc authority)

1. Grading truth splits: official stats grade the model; Kalshi settlement grades contract-facing objects (recommendations, decisions, later positions). Disagreement is a displayable fact.
2. Final pre-kickoff snapshot is owned by Live Pipeline & Staleness; this pitch grades it. Verify capture exists; if missing/unreliable, mark decisions unavailable for timing cost — never fabricate zero. Record hidden dependency in run report.
3. Model calibration IS visible to viewers (Architecture Doc wins over PRD). Private stays private: positions, decision log, override perf, timing cost, ledgers, bankroll. Note PRD amendment in report.
4. Calibration reports two denominators always: threshold observations AND distinct projections. No statistical correlation correction — disclose.
5. Population explicit + selectable: contract-like (default), all eligible projections, market-linked (only valid pop for market comparison). Never silently chosen.
6. Baselines and Brier are separate panels: error panel (MAE/RMSE vs both baselines, mean-vs-mean headline per SIG-28); calibration panel (reliability + Brier, model + market). Never one comparison.
7. Market comparison: contemporaneous with the graded recommendation snapshot, executable price on relevant side (midpoint secondary, labelled); requires an uncertainty interval, not just sample size.
8. Model versions separated by default; explicitly labelled combined "deployed-system record" view permitted; never backfill history with a newer model.
9. Backtest and live always separately labelled; comparison permitted, never combined into one curve/score.
10. Timing cost signed: positive = acting early cost you (final pre-kickoff edge exceeded decision-time edge). Probability points. Fades oriented to preferred side. Missing snapshot → unavailable, never zero. Edited decision → acted-on snapshot governs.
11. Grading freshness: extend existing health surface with exactly three signals — last successful outcome ingest, last successful grading cycle, count of completed games awaiting grades. Nothing more.
- Override performance: descriptive, never causal; took/faded/skipped distinct; skip = no action; unmarked excluded; selection-bias caveat stated on the surface.
- Stale pitch numbers: reference dependencies by feature name, never pitch number, throughout design doc/spec/tickets.

## Remaining open questions to resolve during design/spec (record as Resolved Decisions)

From the pitch's 18: Q9 (insufficient-data thresholds), Q12 (confidence intervals outside market comparison), Q14 (weather-era visibility), Q15 (suggestion outcomes derivability), Q17 (unresolved-outcome taxonomy), plus bucket scheme, time-period definitions, and any others arising. (Q1–Q8, Q10, Q11, Q13, Q16, Q18 covered above.)

## Resolved Decisions (accumulating)

Design-doc decisions 12–18 (see "Decisions settled for this document" in the design doc; to be restated in spec):

12. Reliability curve: ten fixed-width buckets matching stored backtest `binIndex` 0–9, so Compare overlays are like-for-like. Adaptive/quantile binning rejected.
13. Insufficient data: calibration buckets below the established 1,000-threshold-observation floor render provisional (hollow/dashed, counts shown, excluded from summaries) matching `belowFloor`; market comparison needs ≥30 graded observations for a headline edge; override performance has no suppression floor (admin's own record, n always shown).
14. Time period = NFL season (+ "All seasons"). No rolling windows/calendar years/custom ranges. Postseason weeks belong to their season.
15. Weather-era visibility stays on the backtest record: era split disclosure line renders whenever the backtest record is shown; live record has no era dimension (all archived-forecast).
16. Graded recommendation unit = the `final_pre_kickoff` snapshot. No final snapshot → recommendation outcome explicitly unavailable (taxonomy `missing_final_snapshot`), never graded against a substitute. Decisions grade against their own stored decision snapshot + disposition.
17. Unresolvable taxonomy, one enum, seven reasons: `missing_official_result`, `unresolved_identity`, `unsupported_stat_type`, `game_never_completed`, `contract_voided`, `missing_final_snapshot`, `source_conflict`. Counts displayed beside every population; nothing silently excluded.
18. Suggestion grading readiness is structural (grading keys off projection/snapshot/decision identities generically; shadow projections will grade through the same machinery). No suggestion surface or placeholder ships.

## Tickets

Milestone: **Outcome Scoring & Accuracy Surface** (id `a084a6ae-8980-40f5-a335-53103c2d7653`) in project Sightline V1, team Sightline.
Chained SIG-51 ← SIG-52 ← SIG-53 ← SIG-54 ← SIG-55 (each blockedBy its predecessor). Work in this order.

| # | ID | Title | Status |
|---|----|-------|--------|
| 1 | SIG-51 | Outcome schema & Kalshi settlement ingest | Todo |
| 2 | SIG-52 | Python grading job: projection & threshold grades | Todo |
| 3 | SIG-53 | Accuracy surface: shared calibration, error & market panels | Todo |
| 4 | SIG-54 | Overrides surface & contract detail outcome block | Todo |
| 5 | SIG-55 | Grading health signals, freshness & e2e closure | Todo |

Note: Linear team has no "In Review" state — convention is In Progress + PR attached.

## Branches / PRs

Feature branch: `pitch/outcome-scoring-and-accuracy-surface` (planned; CI triggers on `pitch/**`).
Ticket branches: first off the feature branch, each subsequent off the last; squash-merge each into the feature branch in order (step 10).

(PR links recorded as they are opened)

## Deferred

(none yet)
