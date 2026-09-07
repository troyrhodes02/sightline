# Run Report — Bankroll, Sizing & Autonomous Paper Trading

Slug: `bankroll-sizing-and-autonomous-paper-trading`
Linear project: **Sightline V1** · Milestone: **Bankroll, Sizing & Autonomous Paper Trading**
Mode: Autonomous Pipeline Policy (`CLAUDE.md`)
Run completed: 2026-09-07

---

## THE BRANCH IS NOT MERGED

**`feat/bankroll-sizing-and-autonomous-paper-trading` is awaiting human review and has NOT been merged into `main`.**

- **Feature PR: <https://github.com/troyrhodes02/sightline/pull/56>** — open, all six ticket PRs merged into it, suite green, review audit applied, CI green.
- This was the run instruction: a money-adjacent pitch, read line by line before it lands.
- Nothing in this run touched a Kalshi signing key, placed an order, or called a withdrawal API — not even to test the path. No stop condition was hit.

**Read the review-audit section below first.** Fourteen defects were found and
fixed after the tickets were complete, six of which would have corrupted the
ledger or stranded the scheduler. They are the part of this branch most worth a
human's attention, and several of them are the kind of mistake that only shows up
as a number that looks slightly too good.

---

## What shipped

Sightline can now trade — with fake money, unsupervised, before kickoff — and account for every dollar of it afterward.

The core abstraction is **the plan and the ledger are two different things, connected by exactly one writer.** A plan is a pure function of stored state; `executeCycle` is the only code path that turns one into ledger entries. Scheduled execution, Dry Run, and counterfactual replay all call the same planner, which is why they cannot drift apart, and why Dry Run is safe by construction rather than by discipline — it simply never calls the writer.

### Documents

| Artefact | Path |
| --- | --- |
| Pitch (verbatim from Linear) | `docs/v1/pitches/bankroll-sizing-and-autonomous-paper-trading.md` |
| Design doc | `docs/v1/design-docs/bankroll-sizing-and-autonomous-paper-trading-design-doc.md` |
| UI preview (standalone HTML, 31 frames, both modes) | `docs/v1/ui/bankroll-sizing-and-autonomous-paper-trading-ui-preview.html` |
| Technical spec | `docs/v1/specs/bankroll-sizing-and-autonomous-paper-trading-spec.md` |
| Runbook | `docs/v1/runbooks/bankroll-sizing-and-autonomous-paper-trading-runbook.md` |
| Progress (resumable) | `docs/v1/runs/bankroll-sizing-and-autonomous-paper-trading-progress.md` |

### Tickets

All six **complete**, each squash-merged into the feature branch in order.

| Ticket | Title | PR | Feature-branch commit |
| --- | --- | --- | --- |
| SIG-60 | Paper ledger schema, risk configuration, sizing arithmetic core | [#57](https://github.com/troyrhodes02/sightline/pull/57) | `aca1455` |
| SIG-61 | Probability Recalibration — shrinkage fit, versioning, nightly refit | [#63](https://github.com/troyrhodes02/sightline/pull/63) | `c4a4b1e` |
| SIG-62 | The decision path — selection, ranking, sizing, caps, conservative fills | [#59](https://github.com/troyrhodes02/sightline/pull/59) | `69ee280` |
| SIG-63 | Autonomous execution, circuit breakers, settlement, withdrawal ratchet | [#60](https://github.com/troyrhodes02/sightline/pull/60) | `9509028` |
| SIG-64 | Autonomy surfaces, nav, health signals | [#61](https://github.com/troyrhodes02/sightline/pull/61) | `d9f18f4` |
| SIG-65 | Dry Run, review, counterfactual replay, readiness, runbook | [#62](https://github.com/troyrhodes02/sightline/pull/62) | `dcd6389` |

**PR #58 became #63.** `gh pr merge 57 --squash --delete-branch` deleted SIG-60's branch, which auto-closed #58 (its base no longer existed) and left it un-reopenable. It was recreated from the same branch with the same body. The remaining PRs were retargeted to the feature branch *before* their parents merged, so none was orphaned again.

### Scale

96 files, 24,639 insertions against 9 deletions. 14 new tables, 8 new enums, 9 new admin surfaces, 9 new routes, 1 new workflow.

---

## Decisions made on your behalf

Forty-one resolved decisions in total. **1–12 came from the run instruction** and were treated as approved-doc authority; they are restated in the spec but are yours, not mine. **13–41 are the ones I made** and are the ones worth your attention. The authoritative table is spec §21.

### The ones most worth arguing with

| # | Decision | Why |
| --- | --- | --- |
| 26 | **Dry runs and replays live in separate tables** from cycles, positions, and the ledger | The stop conditions name replay results leaking into bankroll or readiness as a halt. Separate tables make that structural rather than a filter every future aggregate must remember. Costs: three storage families instead of one. |
| 27 | **No paper/live mode column, and no live ledger model at all** | "Paper and live never aggregate" becomes a property of the schema rather than of every query. Kalshi Trading must add `Live*` models as their own family and edit a build-failing test to do it — which is the review moment the assertion exists to force. |
| 30 | Kalshi fee `ceil(0.07 · C · P · (1−P))`, **taker-only** | The published general schedule. Paper crosses the spread at the ask, so no maker tier applies. If Kalshi's schedule has changed, this is the number to re-check. |
| 32 | Mark-to-market values a position at the **bid**, not the ask | The bid is what could be realised. The ask would inflate the account by the spread on every position, most where the market is thinnest — exactly where the model's apparent edges are largest. |
| 33 | **Both** staleness states refuse a candidate | `predatesInactives` is a disclosure a human can weigh; the bot cannot, so it does not stake. This is stricter than the slate's treatment and deliberately so. |
| 35 | Missing orderbook depth **refuses** rather than defaulting to any size | The single most tempting flattering-fill optimisation, closed at the source and again by a database CHECK. |
| 38 | No active recalibration ⇒ **refuse to size**, with its own `boundBy` value | Sizing from a raw probability is a No-Go, so refusing is the only other option. It means a fresh deployment sizes nothing until a backtest exists — correct, but it will look like a bug the first time. |
| 39 | Mark-to-market unavailable ⇒ the cycle **creates nothing** | A safety check that cannot run is not a safety check. One open position without a usable bid stops the whole cycle. Conservative, and it will occasionally cost a fill. |
| 36 | Three allocation passes; a size-capped candidate is **liquidity-exhausted** for the cycle | Prevents the partial-fill reallocation loop the pitch names as a rabbit hole. |
| 37 | Recalibration is `pava_piecewise_linear/v1` with per-bin shrinkage `K = 200` | Monotone by construction, degenerates to the backtest prior with no live data, assumes no distribution. `K` is the one number here with no external justification — it is a judgment about how fast live evidence should earn trust. |
| 40 | New Kalshi client method `getOrderbookTop` | The pitch requires executable liquidity "without creating a second market client". It is a public market-data GET; the write-endpoint invariant is unchanged. **Its bid/ask inversion is worth checking independently** — if it is backwards, every fill in the campaign is priced and sized against the wrong side and nothing else would notice. |
| 41 | A candidate whose better side has flipped away from the open position is **refused**, with its own `boundBy = opposite_side_held` | A paper position holds one side, so an increment on the other side is not an increment. The alternatives were closing the existing side to open the new one — the bot trading out of a position on its own initiative, which this pitch does not scope — or letting the executor's guard throw and abort the cycle run. Added during the review audit, as finding 1's fix. |

### Deliberate departures worth naming

- **`PaperPosition`, not `Position`.** The Architecture Doc names `Position`; this reserves that name for the *live* entity Kalshi Trading will build. A paper position never becomes a live one, so they are two entities rather than one with a flag. Adding entities beyond the Architecture Doc's list is this repo's established practice (`PipelineRun`, `ProjectionGrade`, `ThresholdGrade`, `SourceCoverage` and others are all absent from it). Recorded as an amendment below.
- **`/autonomy`, and `/bankroll` stays forbidden.** The build invariant banning a `/bankroll` route guards the deferred V2 portfolio product. This ships a paper bankroll under a namespace that names what it actually is, and the ban stays with a comment explaining the distinction.
- **The slate and contract detail are untouched.** No paper-position annotation on any shared surface, even admin-conditionally. The leak risk on a viewer-visible screen outweighs the convenience, and Positions already answers the question.

---

## Review findings and how each was dispositioned

`/review` against `main` produced **13 findings**, all posted as inline comments
on PR #56. `/sightline-review-audit` dispositioned **all 13 as VALID / IN_SCOPE /
IMPLEMENT**, and all 13 are fixed on the branch. None was deferred, skipped, or
left open for discussion — every one is a correctness, data-integrity or honesty
regression this branch introduced, which the audit skill classifies IN_SCOPE
regardless of what any acceptance criterion said.

Six of them would have corrupted or halted the system rather than merely
displayed something wrong, so they are listed first.

### The six that would have broken it

| # | Site | What would have happened |
| - | ---- | ------------------------ |
| 1 | `plan.ts:656` | Held contracts were keyed by contract id with **no side**. When the book moved enough between cycles that the better side flipped, the planner sized an increment on the opposite side of an open position, the executor's `existing.side !== side` guard threw, and — not being a `P2002` — the throw escaped as a 500 with the `PipelineRun` stranded in `running` and every remaining game in the slate unevaluated. Fixed: the side travels with the count, and a flip is **refused explicitly** rather than traded through. Closing the old side to open the new one would be the bot trading out of a position on its own initiative, which this pitch does not scope. |
| 2 | `schema.prisma:1411` | `kelly_edge DECIMAL(7,6)` caps magnitude at 9.999999, but the edge `p − q·c/(1−c)` is unbounded below and is stored for **rejected** candidates too. A thin book quoting only lowball bids on both sides yields asks near 96c and an edge past −12: `numeric field overflow`, whole cycle transaction rolled back. Fixed: `DECIMAL(12,6)`, which covers the arithmetic's real bound of about ±107. |
| 3 | `pipeline/paper-settlement.ts:210` | The hourly settlement pass persisted a `kill_switch` **breach row** that nothing clears — `engageKillSwitch` deliberately writes only the campaign flag, precisely so `releaseKillSwitch` has nothing left behind. Sequence: operator kills the bot, the :20 pass opens an active breach, operator releases the kill switch, and the bot stays halted on a condition nobody tripped, with `saveConfiguration` refusing to re-enable autonomy. Fixed: `killSwitchEngaged: false`, matching the cycle path, plus a structural assertion that the two paths cannot disagree again. |
| 4 | `replay.ts:321` | A period is replayable only once every position in it has settled, so the outcome exists from the replay's **first** iteration — and settlement was gated on the outcome merely existing. `held.delete()` therefore wiped duplicate prevention after cycle one, and three cycles pricing the same contract opened the full desired stake three times: **3× exposure, 3× position count**, and a P&L for a position size the campaign never held. Fixed: settlement is gated on the game having finished (kickoff + 4h, longer than a game runs), with a final sweep so the counterfactual still reaches a settled state. |
| 8 | `pipeline/paper-cycle.ts:182` | Only Kalshi errors were absorbed; anything else escaped before `finishRun`, leaving the run row in `running` forever. `readHealth` selects the paper-cycle signal by `status: "succeeded"`, so the health surface would keep reporting the last good run's timestamp while nothing was running — the exact failure the surface exists to expose, hidden by the surface itself. Fixed: the row is always closed out, and the error is **re-thrown** afterward so a constraint violation is still a red Actions run. |
| 9 | `pipeline-autonomy.yml:54` | `concurrency` serialises workflow **runs**, not the jobs inside one, and neither job `needs` the other — so a manual dispatch started the cycle and the settlement pass together, each appending ledger entries from a balance read in its own transaction. `balanceAfterCents` would stop equalling the cumulative sum of `amountCents`, which is the single property the append-only ledger's integrity rests on and cannot be repaired without rewriting history. Fixed: `needs: cycle` with `always()`. The transaction-level half of this was already closed during step 8, by reading the running balance **inside** the write transaction rather than from the planner's snapshot. |

### The seven that would have lied

| # | Site | What it reported |
| - | ---- | ---------------- |
| 5 | `replay.ts:151` | The risk config was read `effectiveFrom: "asc"` — the campaign's **first** version — while every other read in the feature uses `desc`. A campaign that started Conservative and switched to Aggressive in week 3 would replay week 5 with `actualMode: conservative`, presenting the aggressive counterfactual as a road not taken when it is what actually happened. |
| 6 | `review.ts:213` | Money figures were campaign-wide while every other figure on the screen was period-scoped. An eight-week campaign up $400 overall that lost $60 in week 5 displayed "Net paper P&L +$400.00" under the "2026 week 5" heading. Fixed by splitting `periodMoney` from `campaignMoney` and giving the campaign figures their own heading — the number that ignores the period now says so. |
| 7 | `calibration-window.ts:59` | The rolling Brier covered the whole window; the market Brier covered only the market-linked subset. The breaker compared two different samples, so a model strong on the predictions Kalshi never priced could pass a comparison it should fail — or be halted on a gap that was purely a sample difference. Fixed with `modelBrierOnMarketContracts`: the model scored over exactly the contracts the market was scored on, one grade per contract on both sides. Both `calibrationVerdict` and readiness's `market_relative` criterion now use it. |
| 10 | `read.ts:206` | `take: 500` with `occurredAt: "asc"` returns the **oldest** 500 entries, so past a couple of Sundays the bankroll chart would freeze at campaign start while the balance displayed beside it kept moving. |
| 11 | `plan.ts:325` | `unfilledStakeCents` was `intendedStakeCents − (cost + fee)`, subtracting an order-level fee ceiling from a per-contract one. A fully filled 30-contract order at 54c reported 7c of stake returned; the cycle detail and the positions list both showed it. Now derived from unfilled **contracts**, so a complete fill is zero by construction. |
| 12 | `api/autonomy/replay/route.ts:52` | `replayEligibility` sat above the `try`, so a malformed `periodKey` reached `new Date(key)` / `Number(...)` and escaped as a raw Prisma error instead of the sanitised response the rest of the handler returns. Fixed on both sides: a discriminated-union schema with a shape check per period kind, and the call moved inside the try. |
| 13 | `controls.ts:257` | Force Override wrote `force_overridden` to **every** active breach, including a non-halting `drawdown_warning` the override screen never renders and the acknowledgements were never computed against. It then appeared in readiness evidence and the safety log as a condition somebody deliberately overruled. Fixed: only the halting conditions, which are the only ones the operator was shown. |

### A fourteenth, found during the audit

Writing the regression test for finding 4 surfaced a second replay divergence
the review had not caught: `simulateMode` reset its per-game exposure to zero on
every cycle, so a replay could stake the full per-game cap again every thirty
minutes, and it counted **fills** rather than positions, so two increments on one
contract reported as two positions. Both are the same failure as finding 4 — the
counterfactual diverging from the run it claims to be a counterfactual of,
always in the direction that flatters it. Fixed with it: game exposure is carried
across cycles exactly as the live path carries `gameExposureCents`, and positions
are counted as distinct contracts.

### Two refinements to the fixes themselves

Both are about what the record says rather than what the bot does, and both were
made after re-reading the first pass:

- The side-flip refusal originally recorded `boundBy: none` with the reason in
  free text. `BoundByLabel`'s own docstring says an empty or unnamed constraint
  reads as "we did not check", which is the one thing the audit trail must never
  say — so `BindingConstraint` gained `opposite_side_held`, the way
  `no_active_recalibration` has its own name. It is spec decision 41.
- That check also ran **ahead** of the probability ceiling, the
  no-edge-after-fees test and the unreadable-depth test, so a candidate failing
  one of those *and* sitting opposite an open position was recorded as
  `opposite_side_held`. Same outcome, wrong reason: a portfolio fact was masking
  a reason that would have applied with no position at all. It now runs last
  among the refusals, so the value means precisely "this was otherwise a live
  opportunity, declined only because of what is already held".
- The replay's final settlement sweep now counts toward drawdown like every
  intermediate balance. The final settled balance usually rises, so this can only
  add a trough the alternative history really reached, never hide one.

### Tests added with the fixes

Fourteen, because none of these bugs was caught by the 793 tests already on the
branch:

- `plan.test.ts` — the side flip is refused rather than filled; an opposite-side
  holding is not reported as "desired total already held"; a complete fill has
  zero unfilled stake; a partial fill's unfilled stake is whole contracts.
- `breakers.test.ts` — the market arm judges the **matched** sample, asserted in
  both directions: a bad window with a good matched sample must not trip, and a
  good window with a bad matched sample must.
- `replay.test.ts` *(new)* — one position across repeated cycles for one game;
  a four-cycle period produces results **identical** to a one-cycle period when
  nothing is capped; the counterfactual reaches a settled state rather than
  reporting positions at cost.
- `controls.test.ts` *(new)* — Force Override leaves a non-halting warning alone
  and still overrides every halting condition.
- `boundaries.test.ts` — two structural assertions: the kill switch has exactly
  one owner (the settlement pass can never persist it as a breach), and a
  pipeline run row is always closed out.

---

## Verification results

Run on the feature branch after the audit was applied. Every check below was
actually executed; the outcomes are as printed.

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | pass |
| Types | `npx tsc --noEmit` | pass |
| Format | `npx prettier --check` | pass |
| Schema | `npx prisma validate` | pass |
| Unit + integration | `npx jest` | **807 passed**, 1 failure — pre-existing and local-only, see below |
| Schema invariants | `npm run test:schema` | **29 passed** |
| Build | `npm run build` | pass — all nine autonomy pages and nine routes dynamic |
| Python | `TEST_DATABASE_URL=... uv run pytest` | **363 passed** in 7m20s, against a migrated local Postgres. The audit changed no Python file at all — the diff over the audit commits under `python/` is empty. |
| CI on PR #56 | GitHub Actions | all jobs pass — web app (lint, types, unit, build, e2e), Python ingest (unit + DB integration), Prisma schema invariants, Vercel |
| End-to-end | `npx playwright test` | **44 passed, 36 skipped** — the skips are auth suites needing seeded-account credentials, which run in CI |

The three checks the run instruction named specifically:

- **The temporal-leakage suite passes unchanged.** No test in `python/tests/` was
  modified, skipped, or re-baselined at any point in this run.
- **The Python import-graph assertion holds.** `test_import_graph.py` was extended
  to every new table (`paper_*`, `recalibration_fits`) alongside `PriceObservation`
  and `RecommendationSnapshot`, with planted-reference and false-positive
  self-tests proving the assertion can actually fail.
- **Paper and live ledgers cannot be joined or aggregated.**
  `prisma/tests/schema-invariants.test.mjs` asserts there is no mode discriminator
  on any ledger-shaped model, no ledger-shaped model outside the `paper_*` family,
  and no `Live*` model at all. Kalshi Trading must add its own family **and edit a
  build-failing test** to do it, which is the review moment the assertion exists
  to force.

**One failing test, pre-existing and local only.**
`src/lib/pipeline/auth.test.ts › reports an unset server token as unconfigured`
fails on this machine and passes in CI. Reproduced on a clean tree by stashing:
`next/jest` loads the repo `.env`, which defines `PIPELINE_SCHEDULER_TOKEN`, so
the default parameter resolves where the test expects nothing. CI has no `.env`.
It belongs to an earlier pitch and was deliberately **not** fixed here — a
drive-by edit to another pitch's test would make a stacked branch harder to read.
It is a follow-up, not a finding against this branch.

---

## Required upstream amendments

**`docs/planning/` was deliberately not edited during this run.** These need a human to apply.

1. **Pitch Roadmap** — merge former Pitches 7 and 8 into this pitch and renumber the remaining pitches.
2. **PRD** — add the Conservative / Moderate / Aggressive / Custom risk-mode presets and the counterfactual replay behaviour.
3. **PRD** — distinguish automatic *simulated* paper withdrawals from notification-only *real* withdrawals.
4. **PRD** — explicitly permit admin Force Override while preserving breaker auditability.
5. **PRD** — live-readiness criteria require two complete NFL weeks of positive cumulative net paper P&L, alongside the existing calibration, market-relative, baseline, drawdown and operational gates.
6. **Launch sequencing** — the intended Week 1 autonomous paper campaign begins only after the Simulation Engine ships and a fresh Dry Run against it has passed.
7. **This run's numeric defaults (instruction decisions 1–9), flagged for explicit human review** — they were not specified upstream and are now live in code:
   - Kelly fractions 0.25 / 0.50 / 0.75; Custom 0–1.0 with a non-blocking warning above 0.75
   - Caps 5/15, 8/25, 12/35 percent of **current** active bankroll; Custom 1–50
   - Starting bankroll $1,000; withdrawal working ceiling 1.5× as a repeating ratchet
   - Ranking by Kelly edge on the fee-adjusted executable price
   - Top-of-book-only fills, remainder not chased
   - Calibration breaker: rolling 100, minimum 30, +0.03 degradation, +0.02 market
   - Drawdown mark-to-market, high-water mark reset on withdrawal
   - Duplicate identity = (contract, game window, account-local decision date)
8. **Architecture Doc data model** *(observed, not in the original list)* — it names `Position`; this pitch introduces `PaperPosition` and reserves `Position` for the live entity. Worth recording so the next reader does not think one was renamed.

---

## Deferred

Nothing from the review was deferred — all fourteen defects are fixed on the
branch. Two items are carried forward as follow-ups outside this pitch:

1. **`src/lib/pipeline/auth.test.ts`'s local-only failure.** Belongs to an
   earlier pitch. The fix is to stop the test inheriting `process.env` from the
   repo `.env`, which is a one-line change to that test — deliberately not made
   inside a stacked branch for a different feature.
2. **The four inherited open questions** listed in spec §22 (ask versus midpoint,
   Kalshi settlement versus the official line as grading truth, superseded model
   versions on the calibration surface, and RLS on user-scoped tables) are
   restated rather than re-decided. None of them is answerable from inside this
   pitch, and none of them blocks it.

---

## Requiring a decision that could not be made autonomously

Nothing blocked the run — no stop condition was hit, and every open question was
resolved and recorded. Three things nevertheless want a human before this branch
runs against anything:

1. **The nine numeric defaults from the run instruction (decisions 1–9).** They
   came from the instruction, not from an approved doc, and they are now live in
   `src/lib/paper/config.ts`. They are amendment 7 below and should be confirmed
   as intentional rather than inherited.
2. **`getOrderbookTop`'s bid/ask inversion** (`src/lib/kalshi/client.ts`). Kalshi's
   orderbook returns resting **bids**; buying YES crosses the NO book at
   `100 − bestNoBid` for that bid's size. If that is backwards, every fill in the
   campaign is priced and sized against the wrong side of the market and nothing
   else in the system would notice. It is the single line in this branch most
   worth verifying against a live orderbook response.
3. **`SHRINKAGE_K = 200`.** The one number in the recalibration fit with no
   external justification — it is a judgment about how quickly live evidence
   should be allowed to outweigh the backtest prior, and it is worth disagreeing
   with deliberately rather than inheriting.

---

## Where to start reading

For a branch this size, in this order:

1. `src/lib/paper/plan.ts` — the pure planner. Every economic decision the bot
   makes is here, and it is the file the review found two defects in.
2. `src/lib/paper/execute.ts` — the single writer. Nothing else turns a plan into
   ledger entries; that is what makes Dry Run safe by construction.
3. `src/lib/paper/fees.ts` and `kelly.ts` — small, and every rounding in them is
   deliberately against the position.
4. `src/lib/paper/boundaries.test.ts` — twenty-two assertions about what the code
   *cannot* do, which is the part of the test suite worth reading rather than
   trusting.
5. The migration's hand-written constraint tail — the flattering-fill guard lives
   in the database, not only in TypeScript.
