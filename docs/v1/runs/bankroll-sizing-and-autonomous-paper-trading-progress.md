# Run Progress — Bankroll, Sizing & Autonomous Paper Trading

Slug: `bankroll-sizing-and-autonomous-paper-trading`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

**Step 14 done — awaiting human review. DO NOT MERGE.** Steps 1–14 complete;
step 15 is the run report. The feature branch is verified, reviewed, audited and
green, and PR [#56](https://github.com/troyrhodes02/sightline/pull/56) is open
against `main` for a line-by-line human read.

<details>
<summary>Step 8 — working tickets (complete)</summary>

Steps 1–7 complete. Feature branch
`feat/bankroll-sizing-and-autonomous-paper-trading`, feature PR
[#56](https://github.com/troyrhodes02/sightline/pull/56) open against `main`.

- **SIG-60 done** — branch `feat/SIG-60-paper-ledger-schema`, PR
  [#57](https://github.com/troyrhodes02/sightline/pull/57) into the feature branch.
  Schema (14 models, 8 enums, hand-written constraints), `src/lib/paper/{config,fees,kelly}.ts`,
  extended Python blocklist, paper/live non-aggregability schema invariant.
  Verified: jest 522, test:schema 29, lint, typecheck, format, prisma:validate,
  build, migrate deploy on a clean DB, pytest **363 passed** with `TEST_DATABASE_URL`.
- **SIG-61 done** — branch `feat/SIG-61-probability-recalibration` (off SIG-60), PR
  [#58](https://github.com/troyrhodes02/sightline/pull/58). PAVA + per-bin shrinkage
  fit, versioned storage, nightly refit route and workflow step, and the
  import-graph boundary guard (allowlist of five Prisma delegates).
  Verified: jest 580, test:schema 29, lint, typecheck, format, build.
- **SIG-62 done** — branch `feat/SIG-62-decision-path` (off SIG-61), PR
  [#59](https://github.com/troyrhodes02/sightline/pull/59). Pure `planCycle`,
  top-of-book-only fills, duplicate-exposure identity, `getOrderbookTop` with the
  bid/ask inversion. Verified: jest 637, schema 29, lint, typecheck, format, build.
- **SIG-63 done** — branch `feat/SIG-63-execution-breakers` (off SIG-62), PR
  [#60](https://github.com/troyrhodes02/sightline/pull/60). Single writer,
  breakers, settlement + withdrawal ratchet, cadence, seven routes, autonomy
  workflow, `autonomy-invariants.test.ts`. Verified: jest 726, schema 29, lint,
  typecheck, format, build.
- **SIG-64 done** — branch `feat/SIG-64-autonomy-surfaces` (off SIG-63), PR
  [#61](https://github.com/troyrhodes02/sightline/pull/61). Six admin surfaces,
  nav entry, two Health signals + state chip. Verified: jest 759, schema 29,
  lint, typecheck, format, build.
- **SIG-65 done** — branch `feat/SIG-65-dryrun-review-replay-readiness` (off
  SIG-64), PR [#62](https://github.com/troyrhodes02/sightline/pull/62). Dry Run,
  review, counterfactual replay, readiness, `boundaries.test.ts`, runbook.
  Verified: jest 793, schema 29, lint, typecheck, format, build.

**All six tickets complete and squash-merged into the feature branch, in order.**

Merge sequence and its one wrinkle, recorded because it changed PR numbers:
`gh pr merge 57 --squash --delete-branch` deleted SIG-60's branch, which
auto-CLOSED PR #58 (its base no longer existed) and made it un-reopenable. #58
was recreated as **#63** from the same branch with the same body, and the
remaining PRs were retargeted to the feature branch BEFORE their parents merged,
so none was orphaned again.

Two merge conflicts, both resolved without changing any ticket's substance:
- The run-progress file had been swept into ticket commits by a broad `git add`.
  Synced to the feature branch's copy on each ticket branch (one commit each).
- SIG-65 vs SIG-64 on `build-invariants.test.ts` (adjacent insertions into the
  admin-route list) and `NavSections.test.ts` (**line endings only** — a Python
  `write_text` on Windows wrote CRLF during SIG-64; prettier's LF is correct).
  Resolved by rebuilding SIG-65's branch as a single commit on the feature tip
  carrying SIG-65's tree, which is the strict superset. Verified afterwards that
  all nine autonomy routes are in the admin-route list.

Feature branch commits, one per ticket:
`aca1455` SIG-60 · `c4a4b1e` SIG-61 · `69ee280` SIG-62 · `9509028` SIG-63 ·
`d9f18f4` SIG-64 · `dcd6389` SIG-65

## Step 11 — full verification on the feature branch

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run format` | pass |
| `npm run prisma:validate` | pass |
| `npx jest` | **793 passed**, 1 pre-existing local-only failure (below) |
| `npm run test:schema` | **29 passed** |
| `npm run build` | pass — all nine autonomy pages and seven routes dynamic |
| `uv run pytest` (TEST_DATABASE_URL set) | **363 passed** |
| `npx playwright test` | **44 passed, 36 skipped** (auth suites need seeded-account creds; they run in CI) |

Pitch-specific checks the run instruction required, all green:
- **Temporal-leakage suite passes unchanged** — `python/tests/test_asof_leakage.py`
  and the rest of the Python suite, with no test modified, skipped or re-baselined.
- **Python import-graph assertion** — `test_import_graph.py` extended to every new
  table (`paper_*`, `recalibration_fits`) with planted-reference and
  false-positive self-tests; 8 tests pass.
- **Paper/live ledger non-joinability** — `prisma/tests/schema-invariants.test.mjs`
  asserts no mode discriminator on any ledger-shaped model, no ledger-shaped model
  outside the `paper_*` family, and no `Live*` model at all.

</details>

## Steps 12–13 — review and audit

`/review` produced **13 findings**, all posted as inline comments on PR #56.
`/sightline-review-audit` dispositioned **all 13 as VALID / IN_SCOPE / IMPLEMENT**:
every one is a correctness, data-integrity or honesty regression this branch
introduced, and several would roll back a whole cycle or corrupt the append-only
ledger. Nothing was deferred, skipped, or left to discuss.

A **fourteenth** issue surfaced while writing the regression test for finding 4:
the replay reset its per-game cap to zero on every cycle and counted fills rather
than positions, so a counterfactual could stake the full per-game cap again every
thirty minutes. Same family as finding 4 — the replay diverging from the run it
claims to be a counterfactual of, always in the flattering direction — so it was
fixed with it.

| # | Site | Fix |
| - | ---- | --- |
| 1 | `plan.ts` | Held positions carry their SIDE. A side flip is refused explicitly instead of reaching the executor, whose throw aborted the whole cycle run. |
| 2 | `schema.prisma` / migration | `kelly_edge` widened to `DECIMAL(12,6)`. The edge is stored for rejected candidates too and is unbounded below; an overflow rolled back the cycle transaction. |
| 3 | `pipeline/paper-settlement.ts` | Passes `killSwitchEngaged: false`, as the cycle path does. The persisted `kill_switch` breach outlived `releaseKillSwitch`. |
| 4 | `replay.ts` | Settlement is gated on the game having finished (kickoff + 4h), not on an outcome merely existing. Previously cleared `held` after cycle one and re-opened the full stake on every later cycle. |
| 5 | `replay.ts` | Risk config read `desc`, not `asc` — `actualMode` was reporting the mode the campaign was created with. |
| 6 | `review.ts` | Money split into `periodMoney` and `campaignMoney`, each under its own heading. Campaign-to-date P&L was rendering under a week's label. |
| 7 | `calibration-window.ts` | New `modelBrierOnMarketContracts`: the market arm now compares the model and Kalshi over the SAME contracts. |
| 8 | `pipeline/paper-cycle.ts` | The loop is wrapped so `finishRun` always runs; the error is re-thrown after. A stranded `running` row made the health surface report the last good timestamp. |
| 9 | `pipeline-autonomy.yml` | `settle` now `needs: cycle`, so a manual dispatch cannot run both against the ledger at once. |
| 10 | `read.ts` | Bankroll history takes the newest 500 and reverses. Ascending froze the chart at campaign start. |
| 11 | `plan.ts` | `unfilledStakeCents` derived from unfilled CONTRACTS; it was non-zero on a complete fill. |
| 12 | `api/autonomy/replay/route.ts` | Discriminated-union schema with a shape check per period kind, and eligibility moved inside the try. |
| 13 | `controls.ts` | Force Override resolves only the HALTING breaches — the ones actually put to the operator. |
| 14 | `replay.ts` | Per-game exposure carried across cycles; positions counted as distinct contracts, not fills. *(Found during the audit, not in the review.)* |

**14 regression tests added** for the fixes: side flip and unfilled stake in
`plan.test.ts`, the matched-sample market arm in `breakers.test.ts`, a new
`replay.test.ts` (duplicate prevention, exact invariance across repeated cycles,
and the counterfactual reaching a settled state), a new `controls.test.ts` (the
warning is left alone), and two structural assertions in `boundaries.test.ts`
(the kill switch has one owner; a pipeline run row is always closed out).

## Step 14 — re-verification after the audit

| Check | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run format` | pass |
| `npm run prisma:validate` | pass |
| `npx jest` | **807 passed**, 1 pre-existing local-only failure (below) |
| `npm run test:schema` | **29 passed** |
| `npm run build` | pass — all nine autonomy pages dynamic |
| `uv run pytest` (TEST_DATABASE_URL set) | **363 passed** |
| `npx playwright test` | **44 passed, 36 skipped** |

Post-audit commits on the feature branch, in order:

| Commit | What |
| --- | --- |
| `494b218` | The fourteen fixes, with fourteen regression tests |
| `4822584` | `BindingConstraint.opposite_side_held` — spec decision 41 |
| `bca6eb4` | The run report |
| `2350c6b` | Side-flip refusal runs last among the refusals; the replay's final settlement sweep counts toward drawdown |
| `d9d3337` | Report records decision 41 and the two refinements |

CI on PR #56 is green: web app (lint, types, unit, build, e2e), Python ingest
(unit + DB integration), Prisma schema invariants, Vercel.

**Step 15 done — the run report is at
`docs/v1/runs/bankroll-sizing-and-autonomous-paper-trading-report.md`. The branch
is NOT merged and must not be merged by this run. Nothing in it touched a Kalshi
signing key, placed an order, or called a withdrawal API, and no stop condition
was hit.**

**Known pre-existing failure, local only:** `src/lib/pipeline/auth.test.ts ›
reports an unset server token as unconfigured`. Reproduced on a clean tree by
stashing — `next/jest` loads the repo `.env`, which defines
`PIPELINE_SCHEDULER_TOKEN`, so the default parameter resolves where the test
expects nothing. CI has no `.env` and passes. Deliberately not fixed inside this
pitch's branches: it belongs to another pitch and a drive-by edit would make a
stacked branch harder to review. Recorded in the run report as a follow-up.

## Pipeline checklist

- [x] 1. Pull pitch doc from Linear → `docs/v1/pitches/bankroll-sizing-and-autonomous-paper-trading.md`
- [x] 2. Design doc → `docs/v1/design-docs/bankroll-sizing-and-autonomous-paper-trading-design-doc.md`
- [x] 3. UI preview → `docs/v1/ui/bankroll-sizing-and-autonomous-paper-trading-ui-preview.html`
- [x] 4. Spec → `docs/v1/specs/bankroll-sizing-and-autonomous-paper-trading-spec.md`
- [x] 5. Resolve remaining open questions as Resolved Decisions (40 total: 1–12 pre-resolved by instruction, 13–25 in the design doc §20, 26–40 in the spec §21; spec §21 is the authoritative table)
- [x] 6. Milestone + Linear issues, chained blockedBy, IDs captured here
- [x] 7. Feature PR into main — #56
- [x] 8. Work every ticket in order (branch chain), PR each — SIG-60 #57, SIG-61 #58, SIG-62 #59, SIG-63 #60, SIG-64 #61, SIG-65 #62
- [x] 9. Runbook → `docs/v1/runbooks/bankroll-sizing-and-autonomous-paper-trading-runbook.md` (shipped in SIG-65)
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

The authoritative table is **spec §21**, forty-one rows (the forty-first, `opposite_side_held`, was added during the review audit).

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
