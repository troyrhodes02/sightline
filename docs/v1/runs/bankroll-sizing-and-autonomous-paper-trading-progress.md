# Run Progress — Bankroll, Sizing & Autonomous Paper Trading

Slug: `bankroll-sizing-and-autonomous-paper-trading`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

Step 2 — design doc.

## Pipeline checklist

- [x] 1. Pull pitch doc from Linear → `docs/v1/pitches/bankroll-sizing-and-autonomous-paper-trading.md`
- [ ] 2. Design doc → `docs/v1/design-docs/bankroll-sizing-and-autonomous-paper-trading-design-doc.md`
- [ ] 3. UI preview → `docs/v1/ui/bankroll-sizing-and-autonomous-paper-trading-ui-preview.html`
- [ ] 4. Spec → `docs/v1/specs/bankroll-sizing-and-autonomous-paper-trading-spec.md`
- [ ] 5. Resolve remaining open questions as Resolved Decisions
- [ ] 6. Milestone + Linear issues, chained blockedBy, IDs captured here
- [ ] 7. Feature PR into main
- [ ] 8. Work every ticket in order (branch chain), PR each
- [ ] 9. Runbook → `docs/v1/runbooks/bankroll-sizing-and-autonomous-paper-trading-runbook.md`
- [ ] 10. Squash-merge every ticket PR into the feature branch, in order
- [ ] 11. Full verification suite on the feature branch
- [ ] 12. `/review` feature branch vs main → inline comments on the feature PR
- [ ] 13. `/sightline-review-audit` those comments; implement/defer/discuss/skip
- [ ] 14. Commit, push, re-run full suite. **STOP — do not merge.**
- [ ] 15. Run report → `docs/v1/runs/bankroll-sizing-and-autonomous-paper-trading-report.md`

## Pre-resolved decisions (from the run instruction — approved-doc authority)

1. **Kelly fractions.** Conservative 0.25×, Moderate 0.50×, Aggressive 0.75×, Custom 0–1.0× admin-entered; >0.75 shows a persistent inline warning but is not blocked.
2. **Exposure caps scale with mode, as % of CURRENT active bankroll.** Conservative 5%/15%, Moderate 8%/25%, Aggressive 12%/35% (per-game/per-slate); Custom 1–50% each.
3. **Default starting paper bankroll $1,000**, admin-configurable.
4. **Withdrawal working ceiling = 1.5× starting bankroll**, admin-configurable; a repeating ratchet, resets active bankroll to exactly the ceiling, excess recorded as simulated withdrawn profit.
5. **Opportunity priority ranks by Kelly edge fraction** `(b·p − q)/b` on the fee-adjusted executable price, descending.
6. **Paper fills are top-of-book only**; displayed size ≥ desired → complete fill, else fill only the displayed size, never walk the book; remainder returns to available bankroll and is reconsidered in the same cycle's reallocation pass. No depth beyond top-of-book is ever inferred.
7. **Calibration breaker:** rolling 100 graded contract-like predictions, minimum 30 to evaluate. Trips on rolling Brier > backtest Brier + 0.03, or rolling Brier > Kalshi rolling Brier + 0.02 over the same contracts/window. Model-version change resets the window.
8. **Drawdown is mark-to-market** (settled balance + current market value of open positions) for both the high-water mark and the compared value. Both figures displayed. A simulated withdrawal resets the high-water mark to the new active balance immediately.
9. **Duplicate execution identity = (contract, game window, account-local decision date)**; desired TOTAL exposure tracked per key; retries add only a genuine increment, itself subject to every cap.
10. **A risk-mode change applies to new positions only**; open positions keep their creating mode's parameters for accounting and explanation.
11. **Force Override is structurally distinct**: separate control, only visible while a breach is active, requires selecting/typing the specific breached condition, confirmation screen states condition + measured value + threshold before enabling.
12. **No paper↔live switch in this pitch.** "Mode" here means risk mode only.

Upstream doc amendments (six, from the pitch's Open Questions) are recorded in the run
report for a human to apply. **Do not edit `docs/planning/` during this run.**

## Ground truth from codebase research (step 1)

- **Schema**: `Contract`, `PriceObservation` (both sides, integer cents, append-only, NO size/depth column), `Projection` (compact distribution + `confidence` + `informationCutoff`), `RecommendationSnapshot`, `Decision`, `Outcome` (Kalshi settlement, one per contract), `ProjectionGrade`, `ThresholdGrade` (`statedProbability`, `outcome`, `contractLike`), `BacktestRun` (+`aggregates` JSON), `CalibrationBin` (`population = 'contract_like'`, `binIndex` 0–9, `belowFloor`, floor 1,000).
- **No `Position` model exists yet.** Architecture names it; this pitch builds it.
- **Edge is computed on read** (`src/lib/slate/edge.ts`): executable ask on the better side, confidence weights `{high:1.0, medium:0.7, low:0.4}`, threshold from `RECOMMENDATION_THRESHOLD_POINTS`. No stored edge column.
- **Threshold probability** rehydrated in TS from stored distribution: `src/lib/slate/probability.ts` (`probAtLeast`), golden-file parity with Python.
- **Staleness**: `src/lib/slate/staleness.ts` / `staleness-read.ts`, measured backward from each game's own kickoff, `INACTIVES_LEAD_MINUTES` default 90.
- **Kalshi client** (`src/lib/kalshi/client.ts`): market-data GETs only (`listOpenMarkets`, `getMarketsByTickers`). Build invariant asserts the client contains none of `/orders`, `/portfolio`, `/balance`, `/fills`, `/positions`. **No orderbook/depth method exists yet.** Prices carry no size.
- **Scheduling**: GitHub Actions cron → token-authenticated `/api/pipeline/*` routes; the ROUTE decides cadence server-side from stored schedule (`src/lib/pipeline/cadence.ts`). `PipelineJobCategory` enum + `PipelineRun` with `@@unique([category, invocationId])` as the idempotency mechanism. Workflows: `pipeline-prices.yml` (*/15), `pipeline-gameday.yml`, `pipeline-nightly.yml`, `pipeline-outcomes.yml`, `keepalive.yml`.
- **Auth**: `requireSession()` / `requireAdmin()` in `src/lib/auth/session.ts`; every admin page must contain `requireAdmin()` and be listed in `src/invariants/build-invariants.test.ts`.
- **Build invariants** (`src/invariants/build-invariants.test.ts`) enforce: one styling system, no stylesheets, colour literals confined, no role from token claims, `force-dynamic` on authenticated routes, admin-route guard list, Kalshi key readable in exactly two modules, client has no write-capable endpoint, service-role key in one module, and a forbidden-route list that **currently includes `/bankroll`** — this pitch must update that list deliberately.
- **Python import guard** (`python/tests/test_import_graph.py`): token sweep over both packages for `price_observation`, `recommendation_snapshot`, `outcomes` SQL forms. New paper/bankroll tables must be added to it.
- **Config style**: product bounds live as named constants in `src/lib/health/config.ts` / `src/lib/accuracy/config.ts`; env-tunable values live in `src/env.ts` with zod defaults.

## Resolved Decisions (accumulating)

_See the design doc and spec for the authoritative list; new ones are appended here as they are made._
