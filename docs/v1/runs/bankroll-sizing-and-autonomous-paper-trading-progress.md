# Run Progress — Bankroll, Sizing & Autonomous Paper Trading

Slug: `bankroll-sizing-and-autonomous-paper-trading`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

**Step 8 — working tickets.** Steps 1–7 complete. Feature branch
`feat/bankroll-sizing-and-autonomous-paper-trading`, feature PR
[#56](https://github.com/troyrhodes02/sightline/pull/56) open against `main`.
Next: SIG-60 via `/sightline-ticket-worker`, branching off the feature branch.

## Pipeline checklist

- [x] 1. Pull pitch doc from Linear → `docs/v1/pitches/bankroll-sizing-and-autonomous-paper-trading.md`
- [x] 2. Design doc → `docs/v1/design-docs/bankroll-sizing-and-autonomous-paper-trading-design-doc.md`
- [x] 3. UI preview → `docs/v1/ui/bankroll-sizing-and-autonomous-paper-trading-ui-preview.html`
- [x] 4. Spec → `docs/v1/specs/bankroll-sizing-and-autonomous-paper-trading-spec.md`
- [x] 5. Resolve remaining open questions as Resolved Decisions (40 total: 1–12 pre-resolved by instruction, 13–25 in the design doc §20, 26–40 in the spec §21; spec §21 is the authoritative table)
- [x] 6. Milestone + Linear issues, chained blockedBy, IDs captured here
- [x] 7. Feature PR into main — #56
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

## Linear artefacts (step 6)

**Project:** Sightline V1 · **Milestone:** `Bankroll, Sizing & Autonomous Paper Trading`
(id `4f0b1061-8c8a-4175-bc5b-1ab453276295`)

Work these in order. Each is `blockedBy` the previous one.

| # | Ticket | Title | Branch chain |
| - | ------ | ----- | ------------ |
| 1 | SIG-60 | Paper ledger schema, risk configuration, and the sizing arithmetic core | off `feat/bankroll-sizing-and-autonomous-paper-trading` |
| 2 | SIG-61 | Probability Recalibration: shrinkage fit, versioning, and the nightly refit | off SIG-60's branch |
| 3 | SIG-62 | The decision path: candidate selection, ranking, sizing, caps, conservative fills, reallocation, duplicate prevention | off SIG-61's branch |
| 4 | SIG-63 | Autonomous execution, circuit breakers, settlement, and the withdrawal ratchet | off SIG-62's branch |
| 5 | SIG-64 | Autonomy surfaces: overview, cycles, cycle detail, positions, configuration, override, nav, health | off SIG-63's branch |
| 6 | SIG-65 | Dry Run, paper review, counterfactual risk-mode replay, live readiness, and the runbook | off SIG-64's branch |

Feature branch: `feat/bankroll-sizing-and-autonomous-paper-trading`
Feature PR: <https://github.com/troyrhodes02/sightline/pull/56> (docs-only at open; ticket PRs merge into it)

Linear note: this team has no "In Review" state — the convention is **In Progress + PR attached**.

## Resolved Decisions — where they live

The authoritative table is **spec §21**, forty rows.

- **1–12** — from the run instruction, treated as approved-doc authority. Restated verbatim above.
- **13–25** — settled in the design doc §20 (route namespace, readiness copy, review periods, confidence reuse, money colour, shared candidate card, `bound by:` as a closed required set, Force Override as a route, drawdown unavailability, permanent override records, Health neutrality for `disabled`, shared surfaces untouched, no reset control).
- **26–40** — settled in the spec §21 (separate dry-run/replay tables, no mode discriminator and no live ledger model, derived autonomy status, append-only risk config, the Kalshi fee formula, floor-to-whole-contracts, bid-based mark-to-market, both staleness states refusing, the execution window and cycle interval, missing depth refusing, three allocation passes with liquidity exhaustion, the `pava_piecewise_linear/v1` fit with K = 200, refusing to size without an active recalibration, refusing to size when mark-to-market is unavailable, and the new `getOrderbookTop` market-data client method).

Three inherited postures are restated in spec §22 rather than re-decided: ask-versus-midpoint (this feature sizes on the ask unconditionally), settlement-versus-official-line as grading truth (unchanged from the previous pitch), and RLS on user-scoped tables (these tables are not user-scoped; RLS is deliberately not enabled).

## Deliberate schema-vocabulary note (for the run report)

The Architecture Doc's data model names `Position`. This pitch introduces `PaperPosition`
and reserves `Position` for the **live** entity the Kalshi Trading pitch will build — a
paper position never becomes a live one, so they are two entities, not one with a flag.
Adding entities beyond the Architecture Doc's list is the established practice in this
repo (`PipelineRun`, `MarketSyncRun`, `ProjectionGrade`, `ThresholdGrade`,
`GameScheduleRevision`, `SourceCoverage`, `PlayerGameStatCorrection`, `PlayerExternalId`
are all absent from that list). Recorded as an eighth upstream amendment in the run report.
