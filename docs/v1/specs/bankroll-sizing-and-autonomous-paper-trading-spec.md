---
version: 1.0.0
status: draft
author: Autonomous pitch pipeline (Claude Code)
last_updated: 2026-09-06
pitch_reference: docs/v1/pitches/bankroll-sizing-and-autonomous-paper-trading.md
design_reference: docs/v1/design-docs/bankroll-sizing-and-autonomous-paper-trading-design-doc.md
ui_preview_reference: docs/v1/ui/bankroll-sizing-and-autonomous-paper-trading-ui-preview.html
prd_reference: docs/planning/prd.md
architecture_reference: docs/planning/architecture.md
linear_issue: see docs/v1/runs/bankroll-sizing-and-autonomous-paper-trading-progress.md
---

# Bankroll, Sizing & Autonomous Paper Trading — Technical Specification

## 1. Summary

This feature turns Sightline from something that reports mispricing into something that acts on it, with fake money, unsupervised, and then accounts for every dollar.

The core technical abstraction is **the plan and the ledger are two different things, connected by exactly one writer**. A *plan* is a pure function of stored state — projections, corrected probabilities, observed books, bankroll, exposure, breaker state, risk configuration — producing a ranked, capped, fill-modelled set of intended positions along with the constraint that bound each one. The plan is deterministic and side-effect free, which is what makes Dry Run, autonomous execution, and counterfactual replay the same logic rather than three near-copies. The *ledger* is an append-only record of what actually happened to the paper bankroll. Exactly one code path turns a plan into ledger entries, and it does so inside a single transaction per cycle.

Two further abstractions carry the pitch's safety requirements. **Desired total exposure is tracked per logical opportunity, not per execution attempt**, so a retried or duplicated scheduler delivery recomputes a total and compares it against what is held rather than reapplying an instruction. And **the paper ledger has no live counterpart in this schema at all** — there is no `mode` discriminator that a forgotten `where` clause could leak across, because the live ledger does not exist yet. Separation is structural, not disciplinary.

Working means: a cycle that takes no positions is recorded as a success with its reason; every simulated position carries both the stake that was wanted and the stake that filled; every candidate names the single constraint that bound it; a breaker trip stops new positions without touching existing ones; and no code path anywhere moves the system from paper money to real money, because none exists.

## 2. Problem

By the end of Outcome Scoring & Accuracy Surface, Sightline can price a contract, disagree with the market, disclose staleness, grade what happened, and report calibration. Six things it still cannot do:

- It cannot correct a raw model probability for measured calibration error, so any stake computed from a model probability inherits the model's top-end overconfidence at full strength.
- It cannot express how much money an opportunity is worth, only how many probability points it disagrees by. Kelly-family sizing needs corrected probability, executable price, fees, and bankroll — three of which the application never assembles in one place.
- It cannot hold a bankroll. There is no `Position`, no balance, no exposure, and no high-water mark.
- It cannot act without a human. Every write in the system today originates in an admin session or a Python batch job; nothing evaluates a slate and decides.
- It cannot stop itself. There is no breaker, no kill switch, and no notion of an unsafe operating state.
- It cannot answer the question the whole product is building toward — *would this have made money under realistic execution* — because it has never simulated an execution.

This blocks the Kalshi Trading pitch entirely: real order placement without a proven staking path, a proven safety path, and evidence from a paper campaign would be putting money behind an untested decision process.

## 3. Scope and non-scope

### In scope

- **Probability Recalibration** — a versioned, stored monotone correction fitted from the stored contract-like backtest calibration record, blended with live graded results under shrinkage. Sizing consumes only the corrected probability.
- **Bankroll & Ledger** — one paper campaign with a configurable starting balance, an append-only ledger, reconstructible history, open exposure, and a high-water mark.
- **Position Sizing** — fractional Kelly on the fee-adjusted executable price, scaled by projection confidence, bounded by per-game and per-slate exposure caps and by available bankroll, with the binding constraint recorded per candidate.
- **Joint slate allocation and realistic paper fills** — one ranked allocation over the game window's candidates, top-of-book-only fills, partial fills, unfilled remainder returned and reallocated within a bounded number of passes.
- **Duplicate prevention** — desired total exposure per (contract, game window, decision date), incremental additions only.
- **Dry Run** — the same plan, rendered, writing no position and no ledger entry.
- **Autonomous Execution** — a scheduled per-game-window cycle with a ten-minute pre-kickoff hard cutoff, stale-projection refusal, and a recorded outcome for every attempt including the ones that do nothing.
- **Circuit breakers, kill switch, resume, and Force Override** — drawdown warning and halt, calibration, exposure, and the kill switch; permanent breach records; per-condition override acknowledgement.
- **Simulated withdrawals** — an automatic ratchet above a configurable working ceiling, recorded separately from active bankroll.
- **Paper performance review** and **counterfactual risk-mode replay** over completed periods.
- **Live Readiness** — evidence per criterion, including the two-complete-NFL-weeks-with-positive-P&L gate, reported and never acted upon.
- Seven admin-only surfaces under `/autonomy`, plus three Health signals.

### Out of scope

- **The Simulation Engine.** Projections come from whatever engine is deployed; this feature reads them.
- **Real Kalshi order placement, real fills, reconciliation, portfolio or balance reads, and any use of a signing key for anything but the existing market-data GETs.** No client method is added beyond a market-data orderbook read.
- **A paper→live mode switch, a live ledger, and any activation control.** "Mode" in this spec means risk mode. The operating-mode switch belongs to Kalshi Trading.
- **Real withdrawals**, including a notification of one.
- **Any change to the slate, contract detail, or accuracy surfaces.** Autonomy reads from them; it does not annotate them. The nearest creep temptation — a "paper position held" badge on a shared contract row — is deliberately refused (design decision 24).
- **Adjustment suggestions feeding sizing.** Sizing consumes the base projection's corrected probability.
- **Correlation modelling across contracts.** The per-game cap is the correlation defence until the Simulation Engine supplies joint outcomes.
- **A denormalised edge, exposure, or drawdown column, or a job maintaining one.** The two existing derived-state rules stand; the two new stored values (ledger running balance, high-water mark) are justified in §8 and are not caches of current edge.
- **Bankroll and portfolio management as a product** (V2): multiple bankrolls, allocation across strategies, tax lots.

## 4. Core concepts

| Concept | Description |
| ------- | ----------- |
| `PaperCampaign` | The single paper account. Holds the starting balance, the operational switches (autonomy enabled, kill switch), and the high-water mark. Exactly one row in practice; the schema does not forbid a second, but nothing creates one. |
| `PaperRiskConfig` | An **append-only** configuration version: risk mode, Kelly fraction, per-game and per-slate cap percentages, drawdown warn and halt percentages, probability ceiling, withdrawal ceiling multiple. Superseded by writing a new row, never by updating one. Every cycle records the config it ran under. |
| `RecalibrationFit` | A stored, versioned monotone map from raw threshold probability to corrected probability, with the backtest run and live sample it was fitted from. Sizing reads the active fit; historical candidates keep the fit id they used. |
| Corrected probability | `RecalibrationFit` applied to the projection's raw `probAtLeast`. **The only probability sizing sees.** Raw is retained beside it on every candidate row. |
| Executable price | The ask in integer cents on the side the corrected probability favours. Midpoint is never used for sizing or fills. |
| Fee-adjusted price | Executable price plus Kalshi's per-contract trading fee. Ranking, the no-edge-after-fees test, and stake conversion all use this, never the raw ask. |
| Kelly edge | `(b·p − q) / b` on the fee-adjusted price, where `p` is corrected probability, `q = 1 − p`, `b = (1 − c_eff)/c_eff`. The ranking key **and** the unscaled stake fraction — one number, two uses, so ranking and sizing can never disagree about what is attractive. |
| Exposure | Cost basis of open positions, in cents. A Kalshi position's maximum loss is what was paid, so cost basis *is* the amount at risk. Fees paid count toward it. |
| Active bankroll | Settled balance plus the current market value of open positions. |
| Settled balance | The running balance of the append-only ledger. Fees, stakes, settlements, void refunds, and withdrawals all move it. |
| Mark-to-market | Settled balance plus, per open position, `contracts × bid` on the held side. **Bid, not ask** — what could be realised, which is the conservative direction. |
| High-water mark | The greatest mark-to-market value observed. Monotone except at a simulated withdrawal, which resets it to the post-withdrawal active bankroll. |
| Drawdown | `(highWaterMark − markToMarket) / highWaterMark`. Reports `unavailable` — never a settled-only substitute — when any open position has no usable bid. |
| `PaperDesiredExposure` | The duplicate-prevention record. Keyed `(campaign, contract, gameWindowKey, decisionDate)`, it stores the desired **total** exposure for that logical opportunity. A retry compares against it and against what is held; only a genuine increment is eligible. |
| `PaperCycle` | One autonomous evaluation of one game window. Recorded for every attempt, including `no_candidate`, `skipped`, and `failed`. **Scheduled cycles only** — dry runs and replays live in separate tables. |
| `PaperCycleCandidate` | One contract's full audit row: raw and corrected probability, confidence, executable price, fee, observed top-of-book size, Kelly edge, fraction applied, intended stake, filled stake, verdict, and `boundBy`. |
| `boundBy` | The single named constraint that determined the outcome. A closed enum, never null, `none` when nothing bound. |
| `PaperPosition` | One simulated holding per contract per campaign. Accumulates across increments; `PaperFill` rows record each increment. Carries `intendedStakeCents` permanently beside the actual cost. |
| `PaperBreach` | A safety condition that tripped, with its measured value, threshold, and config version. Resolution is `active`, `cleared`, or `force_overridden`; **`force_overridden` is terminal and never becomes `cleared`.** |
| `PaperDryRun` | An inspection record. Stores the plan as JSON, references no position and no ledger entry, and is excluded by construction from every bankroll, review, and readiness read. |
| `PaperReplay` / `PaperReplayModeResult` | A counterfactual over a completed period. Separate tables for the same reason: nothing that reads bankroll, readiness, or active configuration may reach them. |

### Distinctions that must not be collapsed

- **Intended stake and filled stake are two fields.** A complete fill is the two numbers agreeing, not the absence of one.
- **`no_stake` and `refused` are two verdicts.** `no_stake` means the economics did not support one; `refused` means the candidate was ineligible (stale, unpriced) before economics were considered.
- **Settled balance, active bankroll, and total paper wealth are three numbers.** Wealth includes cumulative withdrawals; active does not.
- **Drawdown `unavailable` is not drawdown `0`.**
- **Kalshi settlement governs position accounting; the official stat line governs model grading.** Established in the Outcome Scoring pitch and unchanged here: they are stored separately and never reconciled.
- **A risk-mode change is a new `PaperRiskConfig` row**, never an update. Open positions and past cycles keep the row they ran under.
- **Recalibration version and model version are distinguishable.** A `RecalibrationFit` names its `modelVersion`; a change to either is a separate, recorded event.

## 5. States and lifecycle

### New enums

```prisma
enum RiskMode {
  conservative
  moderate
  aggressive
  custom
}

enum AutonomyStatus {
  disabled // never enabled, or turned off deliberately. The resting state.
  active   // new positions permitted
  halted   // one or more breakers tripped; existing positions still settle
  killed   // kill switch engaged — a human act, distinct from a breaker halt
}

enum BreachCondition {
  drawdown_warning // does NOT halt
  drawdown_halt
  calibration
  exposure
  kill_switch
}

enum BreachResolution {
  active
  cleared
  force_overridden // terminal; never becomes `cleared`
}

enum PaperCycleOutcome {
  ok
  partial_fill
  no_candidate
  halted
  skipped
  failed
}

enum CandidateVerdict {
  filled
  partial
  no_stake // economics did not support a stake
  refused  // ineligible before economics were considered
  blocked  // a breaker tripped before this candidate was reached
}

enum BindingConstraint {
  none
  top_of_book_size
  per_game_cap
  per_slate_cap
  available_bankroll
  probability_ceiling
  no_edge_after_fees
  stale_projection
  price_unavailable
  pre_kickoff_cutoff
  breaker
  no_active_recalibration
  opposite_side_held
}

enum PaperPositionStatus {
  open
  settled_won
  settled_lost
  voided // terminal, distinct from settled_lost; cost basis and fees returned
}

enum PaperLedgerEntryKind {
  opening_balance
  stake_debit
  fee_debit
  settlement_credit
  void_refund
  withdrawal
}
```

`BindingConstraint` gains two values beyond the design doc's eleven. The design doc enumerated the constraints a *priced* candidate can hit; both additions are refusals that happen outside that frame and need their own name rather than borrowing another's. `no_active_recalibration` — a campaign with no fitted recalibration cannot size anything at all. `opposite_side_held` — the candidate is priceable and has an edge, but the position already open on that contract is on the other side (see decision 41).

### Autonomy status transitions

`AutonomyStatus` is **derived on read**, not stored — from `PaperCampaign.autonomyEnabled`, `PaperCampaign.killSwitchEngaged`, and the existence of `active` breaches. There is no status column to fall out of sync.

| Condition | Derived status |
| --------- | -------------- |
| `killSwitchEngaged` | `killed` (outranks everything) |
| not `autonomyEnabled` | `disabled` |
| any `PaperBreach` with `resolution = active` and `condition != drawdown_warning` | `halted` |
| otherwise | `active` |

A `drawdown_warning` breach is visible and never halts. It is the only condition with that property.

### Control transitions

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| any | `killed` | admin, always | `killSwitchEngaged = true`; `PaperControlEvent{kind: killed}`. **No confirmation.** No position touched, nothing settled, nothing deleted. |
| `killed` | previous | admin, confirmed | `killSwitchEngaged = false`; `PaperControlEvent{kind: kill_released}`. Breakers still apply — releasing the kill switch does not clear a breach. |
| `halted` | `active` (Resume) | only when **every** non-warning breach has cleared on re-evaluation | Each cleared breach → `resolution = cleared`, `resolvedAt`, `resolvedByUserId`. `PaperControlEvent{kind: resumed}`. Refused with `invalid_state_transition` if any condition is still breached. |
| `halted` | `active` (Force Override) | admin, per-condition acknowledgement | Each acknowledged breach → `resolution = force_overridden`, `resolvedAt`, `resolvedByUserId`. `PaperControlEvent{kind: force_overridden}`. **The breaker is not disabled**; the next cycle evaluates it again and may open a new breach row. |
| `active` | `halted` | automatic, during a cycle or a settlement pass | New `PaperBreach` rows. Positions already created in the cycle remain; remaining candidates are recorded `blocked` with `boundBy = breaker`. The cycle's outcome is `halted`. |
| `disabled` | `active` | admin, confirmed | Refused while any non-warning breach is `active`. |
| any | mode change | admin, confirmed | New `PaperRiskConfig` row. **No historical row is rewritten.** Open positions keep their creating config. |

Force Override is refused if the acknowledged breach has cleared between page load and submit (`invalid_state_transition`, message directing to Resume) — overriding a condition that is no longer breached would put a false record in the audit trail. It is also refused entirely while the kill switch is engaged.

### Position lifecycle

| From | To | Trigger | Side effects |
| ---- | -- | ------- | ------------ |
| — | `open` | a fill in a scheduled cycle | `PaperPosition` + `PaperFill` + `stake_debit` + `fee_debit` ledger entries, all in one transaction |
| `open` | `open` (larger) | a later cycle whose desired total exceeds the held total | A second `PaperFill` and its ledger entries. `contracts`, `costBasisCents`, `feesPaidCents`, and `intendedStakeCents` accumulate. Never a second position row. |
| `open` | `settled_won` / `settled_lost` | the contract's `Outcome` is `yes`/`no` | `settlement_credit` (zero for a loss), `realizedPnlCents` computed, position closed |
| `open` | `voided` | the contract's `Outcome` is `voided` | `void_refund` for cost basis **and** fees; `realizedPnlCents = 0` |
| settled | re-settled | `Outcome` supersession (Kalshi changed its settlement) | The prior settlement's ledger entries are **reversed with new compensating entries**, never deleted, and the new settlement is applied. The ledger stays append-only. |
| any | deleted | — | **Never.** No code path deletes a `PaperPosition`, a `PaperFill`, or a `PaperLedgerEntry`. |

A breaker trip settles nothing and closes nothing. Open positions continue to settle normally while `halted` or `killed`.

## 6. UI integration

Seven admin-only surfaces under `/autonomy`, plus additions to `/health`. Full visual specification is in the design doc and the UI preview; this section covers what the implementation must supply.

| Screen | Route | Data needed | Actions |
| ------ | ----- | ----------- | ------- |
| Overview | `/autonomy` | `AutonomyOverviewDto` | Kill, release kill, Resume, navigate to Force Override / Configuration |
| Cycles | `/autonomy/cycles` | `CycleListDto` (season/week scoped) | Open a cycle |
| Cycle detail | `/autonomy/cycles/[cycleId]` | `CycleDetailDto` | Link to contract detail |
| Positions | `/autonomy/positions` | `PositionListDto` (status filter) | — |
| Review | `/autonomy/review` | `ReviewDto` + `ReplayComparisonDto` | Run replay |
| Readiness | `/autonomy/readiness` | `ReadinessDto` | Link to `/accuracy` |
| Dry Run | `/autonomy/dry-run` | `DryRunWindowsDto`, `CyclePlanDto` | Run dry run |
| Configuration | `/autonomy/configuration` | `ConfigurationDto` | Save configuration |
| Force Override | `/autonomy/override` | `ActiveBreachesDto` | Force override |

Every one of these is a server component reading through Prisma with `requireAdmin()`, `export const dynamic = "force-dynamic"`, and must be added to the admin-route list in `src/invariants/build-invariants.test.ts`. Mutations are route handlers under `/api/autonomy/*`; the client components are interactive islands only (kill button, filter toggles, configuration form, override acknowledgement checkboxes, run buttons).

### Components

| Component | Data contract | Notes |
| --------- | ------------- | ----- |
| `KillSwitchButton` | `{ engaged: boolean }` | Client island. `POST /api/autonomy/kill` with no confirmation dialog. Renders and functions even when the overview read failed. Accessible name states the effect. |
| `AutonomyStateBanner` | `BreachDto[]`, `AutonomyStatus` | `role="alert"`. Renders every simultaneous breach. |
| `BankrollHeadline` | four figures with decomposition sub-lines | `unavailable` is a rendered value, not a blank. |
| `ExposureMeter` | `{ label, usedCents, capCents, capPercent, bankrollCents }` | ARIA `meter`. Both the cap's dollar value and its percentage render. |
| `BankrollChart` | series + `highWaterMarkCents` + `haltThresholdCents` | Recharts, every colour and font from `useTheme()`, `visuallyHidden` text summary. |
| `CandidateCard` | `CandidateDto` | Shared by Cycle detail and Dry Run; a `tense` prop is the only difference. |
| `BoundByLabel` | `BindingConstraint` + optional detail | Closed set; never renders blank. |
| `BreachRow` | `BreachDto` | One shape in the banner, the review table, and the override route. |
| `ReadinessCriterion` | `{ met, label, evidence }` | Unevaluable renders as not-met with the reason. |
| `PaperModeSubtitle` | — | Static; present on all seven surfaces. |

### Forms

Configuration is the only form.

| Field | Type | Required | Validation |
| ----- | ---- | -------- | ---------- |
| `mode` | enum | yes | one of four |
| `kellyFraction` | decimal | when `custom` | `0 ≤ x ≤ 1.0`, ≤ 3 dp. `> 0.75` renders a persistent `aria-live="polite"` warning and **is accepted** |
| `perGameCapPct` | int | when `custom` | 1–50 |
| `perSlateCapPct` | int | when `custom` | 1–50, `≥ perGameCapPct` |
| `drawdownHaltPct` | int | when `custom` | 1–50, `> drawdownWarnPct` |
| `startingBankrollCents` | int | yes | `> 0`; **rejected when any `PaperFill` exists** |
| `withdrawalCeilingMultiple` | decimal | yes | `≥ 1.0`, ≤ 2 dp |
| `autonomyEnabled` | boolean | yes | rejected while a non-warning breach is `active` |

## 7. Data model

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `PaperCycle` | many-to-one | `Game` | The game window evaluated |
| `PaperCycleCandidate` | many-to-one | `Contract` | The contract considered |
| `PaperCycleCandidate` | many-to-one | `Projection` (nullable) | The projection priced; null for a refused-unprojected candidate |
| `PaperCycleCandidate` | many-to-one | `PriceObservation` (nullable) | The observation the ask came from |
| `PaperPosition` | many-to-one | `Contract` | Settles against that contract's `Outcome` |
| `RecalibrationFit` | many-to-one | `BacktestRun` | The stored contract-like calibration record it was fitted from |
| `PaperRiskConfig` / `PaperControlEvent` | many-to-one | `User` | The admin who made the change; identity from the session |
| `PaperCycle` | many-to-one | `PipelineRun` (nullable) | The scheduled invocation that produced it |

**No relation to `Decision`.** An autonomous position is not a decision; the admin took no disposition. Conflating them would corrupt the override-performance analytics, which measure the admin's reads.

### New models

```prisma
// ---------------------------------------------------------------------------
// Autonomous paper trading (Bankroll, Sizing & Autonomous Paper Trading)
//
// NONE of these are bitemporal fact tables. They are account and operational
// records: no validAt/knownAt, no ingest_run_id, and nothing here may ever
// feed a projection. Every table in this block is on the Python import-graph
// blocklist — the modelling runtime has no reason to know a bankroll exists,
// and `paper_cycle_candidates` carries executable prices, which makes it as
// barred as `price_observations`.
//
// There is NO live ledger in this schema and no `mode` discriminator. Paper
// and live separation is structural: the live tables arrive with the Kalshi
// Trading pitch as their own models, so no query can aggregate across them
// by forgetting a filter.
// ---------------------------------------------------------------------------

/// The single paper account. Operational switches and the high-water mark
/// live here; every configurable NUMBER lives on PaperRiskConfig, so a cycle
/// can name the exact configuration it ran under.
model PaperCampaign {
  id                    String   @id @default(uuid())
  label                 String? // operator label, e.g. "2026 week 9 onward"
  startingBankrollCents Int      @map("starting_bankroll_cents")
  autonomyEnabled       Boolean  @default(false) @map("autonomy_enabled")
  killSwitchEngaged     Boolean  @default(false) @map("kill_switch_engaged")

  // Greatest mark-to-market value observed. Monotone EXCEPT at a simulated
  // withdrawal, which resets it to the post-withdrawal active bankroll so
  // deliberately removing profit never reads as a loss. Stored rather than
  // derived because it depends on the path of mark observations, not all of
  // which are retained; every update is written inside the same transaction
  // as the entry that caused it.
  highWaterMarkCents Int      @map("high_water_mark_cents")
  highWaterMarkAt    DateTime @map("high_water_mark_at")

  startedAt DateTime @map("started_at")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  riskConfigs   PaperRiskConfig[]
  ledgerEntries PaperLedgerEntry[]
  cycles        PaperCycle[]
  positions     PaperPosition[]
  breaches      PaperBreach[]
  controlEvents PaperControlEvent[]
  desired       PaperDesiredExposure[]
  dryRuns       PaperDryRun[]
  replays       PaperReplay[]

  @@map("paper_campaigns")
}

/// Append-only configuration version. A mode change writes a new row; no row
/// is ever updated. Every cycle, breach, and position records the row it ran
/// under, which is what makes "open positions keep their original limits"
/// true of the data rather than only of the copy.
model PaperRiskConfig {
  id         String   @id @default(uuid())
  campaignId String   @map("campaign_id")
  mode       RiskMode

  kellyFraction   Decimal @map("kelly_fraction") @db.Decimal(4, 3) // 0.000–1.000
  perGameCapPct   Int     @map("per_game_cap_pct") // % of CURRENT active bankroll
  perSlateCapPct  Int     @map("per_slate_cap_pct")
  drawdownWarnPct Int     @map("drawdown_warn_pct")
  drawdownHaltPct Int     @map("drawdown_halt_pct")

  // Independent of risk mode by product rule; stored per version so a change
  // is recorded, and asserted equal across preset modes by a schema test.
  probabilityCeiling Decimal @map("probability_ceiling") @db.Decimal(4, 3)

  withdrawalCeilingMultiple Decimal @map("withdrawal_ceiling_multiple") @db.Decimal(4, 2)

  effectiveFrom   DateTime @map("effective_from")
  createdByUserId String   @map("created_by_user_id")
  createdAt       DateTime @default(now()) @map("created_at")

  campaign  PaperCampaign   @relation(fields: [campaignId], references: [id])
  createdBy User            @relation(fields: [createdByUserId], references: [id])
  cycles    PaperCycle[]
  breaches  PaperBreach[]
  positions PaperPosition[]
  dryRuns   PaperDryRun[]

  @@index([campaignId, effectiveFrom(sort: Desc)])
  @@map("paper_risk_configs")
}

/// Human control actions against the campaign. Append-only audit trail;
/// `force_overridden` events are the ones this table exists for.
model PaperControlEvent {
  id          String   @id @default(uuid())
  campaignId  String   @map("campaign_id")
  kind        String // enabled | disabled | killed | kill_released | resumed | force_overridden | config_changed | starting_bankroll_set
  actorUserId String   @map("actor_user_id")
  detail      Json? // breach ids, outgoing/incoming config id — never free-form user text
  occurredAt  DateTime @map("occurred_at")
  createdAt   DateTime @default(now()) @map("created_at")

  campaign PaperCampaign @relation(fields: [campaignId], references: [id])
  actor    User          @relation(fields: [actorUserId], references: [id])

  @@index([campaignId, occurredAt(sort: Desc)])
  @@map("paper_control_events")
}

/// Append-only bankroll history. `balanceAfterCents` is a running total, not
/// a cache of current state: it is a fact of the entry, makes the balance at
/// any historical point readable without replaying the whole ledger, and lets
/// a corrupted sequence be detected. A test asserts the running total equals
/// the cumulative sum of `amountCents` for every campaign.
model PaperLedgerEntry {
  id                String               @id @default(uuid())
  campaignId        String               @map("campaign_id")
  kind              PaperLedgerEntryKind
  amountCents       Int                  @map("amount_cents") // signed
  balanceAfterCents Int                  @map("balance_after_cents") // settled balance after this entry
  positionId        String?              @map("position_id")
  cycleId           String?              @map("cycle_id")
  note              String? // e.g. "settlement superseded: yes -> no"
  occurredAt        DateTime             @map("occurred_at")
  createdAt         DateTime             @default(now()) @map("created_at")

  campaign PaperCampaign  @relation(fields: [campaignId], references: [id])
  position PaperPosition? @relation(fields: [positionId], references: [id])
  cycle    PaperCycle?    @relation(fields: [cycleId], references: [id])

  @@index([campaignId, occurredAt, id])
  @@index([positionId])
  @@map("paper_ledger_entries")
}

/// The versioned probability correction. Fitted from the stored contract-like
/// backtest calibration record, blended with live graded results under
/// per-bin shrinkage. NOTHING price-derived is an input.
model RecalibrationFit {
  id      String @id @default(uuid())
  version Int    @unique // monotonic; displayed as "v3"

  modelVersion  String @map("model_version")
  backtestRunId String @map("backtest_run_id")
  method        String // "pava_piecewise_linear/v1"
  shrinkageK    Int    @map("shrinkage_k") // live observations at which live weight = 0.5

  liveObservationCount Int       @map("live_observation_count")
  liveWindowFrom       DateTime? @map("live_window_from")
  liveWindowTo         DateTime? @map("live_window_to")

  /// Monotone non-decreasing knots [[raw, corrected], …], anchored at (0,0)
  /// and (1,1). Piecewise-linear between them.
  knots Json

  isActive Boolean  @default(false) @map("is_active")
  fittedAt DateTime @map("fitted_at")

  backtestRun BacktestRun           @relation(fields: [backtestRunId], references: [id])
  candidates  PaperCycleCandidate[]
  cycles      PaperCycle[]
  dryRuns     PaperDryRun[]

  @@index([modelVersion, fittedAt(sort: Desc)])
  @@map("recalibration_fits")
}

/// One autonomous evaluation of one game window. SCHEDULED CYCLES ONLY —
/// dry runs and replays have their own tables so no aggregate can reach them.
model PaperCycle {
  id             String  @id @default(uuid())
  campaignId     String  @map("campaign_id")
  riskConfigId   String  @map("risk_config_id")
  recalibrationId String? @map("recalibration_id")
  gameId         String  @map("game_id")
  pipelineRunId  String? @map("pipeline_run_id")

  /// The scheduler invocation. `(campaignId, gameId, invocationId)` unique
  /// makes duplicate cron delivery a structural no-op, matching the keepalive
  /// and outcome-ingest pattern.
  invocationId String? @map("invocation_id")

  outcome    PaperCycleOutcome
  skipReason String?           @map("skip_reason")

  candidatesEvaluated Int @default(0) @map("candidates_evaluated")
  candidatesSized     Int @default(0) @map("candidates_sized")
  candidatesFilled    Int @default(0) @map("candidates_filled")
  stakedCents         Int @default(0) @map("staked_cents")

  // State AS IT WAS. Never re-read for display.
  bankrollAtEvaluationCents Int @map("bankroll_at_evaluation_cents")
  settledBalanceCents       Int @map("settled_balance_cents")
  openExposureCents         Int @map("open_exposure_cents")
  slateCapacityCents        Int @map("slate_capacity_cents")
  gameCapacityCents         Int @map("game_capacity_cents")
  highWaterMarkCents        Int @map("high_water_mark_cents")

  // Breaker measurements at evaluation, retained so a replay reuses them
  // rather than recomputing a model-quality number from a different window.
  drawdownBps            Int?     @map("drawdown_bps") // null when mark-to-market unavailable
  calibrationBrier       Decimal? @map("calibration_brier") @db.Decimal(6, 5)
  calibrationMarketBrier Decimal? @map("calibration_market_brier") @db.Decimal(6, 5)
  calibrationSampleSize  Int?     @map("calibration_sample_size")

  allocationPasses Int  @default(0) @map("allocation_passes")
  allocationTrace  Json @map("allocation_trace") // ordered, human-readable pass lines

  errorMessage String?   @map("error_message") // sanitized; never a URL or credential
  startedAt    DateTime  @map("started_at")
  finishedAt   DateTime? @map("finished_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  campaign      PaperCampaign         @relation(fields: [campaignId], references: [id])
  riskConfig    PaperRiskConfig       @relation(fields: [riskConfigId], references: [id])
  recalibration RecalibrationFit?     @relation(fields: [recalibrationId], references: [id])
  game          Game                  @relation(fields: [gameId], references: [id])
  pipelineRun   PipelineRun?          @relation(fields: [pipelineRunId], references: [id])
  candidates    PaperCycleCandidate[]
  fills         PaperFill[]
  ledgerEntries PaperLedgerEntry[]
  breaches      PaperBreach[]

  @@unique([campaignId, gameId, invocationId])
  @@index([campaignId, startedAt(sort: Desc)])
  @@index([gameId])
  @@map("paper_cycles")
}

/// The audit trail. One row per contract considered, whatever the outcome.
model PaperCycleCandidate {
  id                 String  @id @default(uuid())
  cycleId            String  @map("cycle_id")
  contractId         String  @map("contract_id")
  projectionId       String? @map("projection_id")
  priceObservationId String? @map("price_observation_id")
  recalibrationId    String? @map("recalibration_id")

  rank Int // 0-based, by Kelly edge descending; refused candidates rank last

  rawProbability       Decimal?    @map("raw_probability") @db.Decimal(6, 5)
  correctedProbability Decimal?    @map("corrected_probability") @db.Decimal(6, 5)
  confidence           Confidence?
  side                 MarketSide?

  askCents               Int? @map("ask_cents")
  feeCents               Int? @map("fee_cents") // for the intended order size
  netPriceCents          Int? @map("net_price_cents") // per-contract, fee-adjusted, rounded up
  topOfBookSizeContracts Int? @map("top_of_book_size_contracts")

  kellyEdge            Decimal? @map("kelly_edge") @db.Decimal(7, 6)
  kellyFractionApplied Decimal? @map("kelly_fraction_applied") @db.Decimal(5, 4) // mode fraction × confidence weight

  intendedStakeCents Int @default(0) @map("intended_stake_cents")
  intendedContracts  Int @default(0) @map("intended_contracts")
  filledContracts    Int @default(0) @map("filled_contracts")
  filledCostCents    Int @default(0) @map("filled_cost_cents")
  filledFeeCents     Int @default(0) @map("filled_fee_cents")

  verdict      CandidateVerdict
  boundBy      BindingConstraint
  boundByDetail String?          @map("bound_by_detail") // e.g. the breach condition name

  positionId String? @map("position_id")
  createdAt  DateTime @default(now()) @map("created_at")

  cycle            PaperCycle        @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  contract         Contract          @relation(fields: [contractId], references: [id])
  projection       Projection?       @relation(fields: [projectionId], references: [id])
  priceObservation PriceObservation? @relation(fields: [priceObservationId], references: [id])
  recalibration    RecalibrationFit? @relation(fields: [recalibrationId], references: [id])
  position         PaperPosition?    @relation(fields: [positionId], references: [id])

  @@unique([cycleId, contractId])
  @@index([contractId])
  @@map("paper_cycle_candidates")
}

/// One simulated holding. Accumulates across increments; `PaperFill` records
/// each. `intendedStakeCents` accumulates alongside cost so the ledger can
/// never present the wished-for stake as the actual one, or lose it.
model PaperPosition {
  id           String @id @default(uuid())
  campaignId   String @map("campaign_id")
  contractId   String @map("contract_id")
  riskConfigId String @map("risk_config_id") // the config it was OPENED under

  side               MarketSide
  contracts          Int
  costBasisCents     Int @map("cost_basis_cents") // price only
  feesPaidCents      Int @map("fees_paid_cents")
  intendedStakeCents Int @map("intended_stake_cents")

  status           PaperPositionStatus @default(open)
  settlementResult OutcomeResult?      @map("settlement_result")
  proceedsCents    Int?                @map("proceeds_cents")
  realizedPnlCents Int?                @map("realized_pnl_cents")
  settledAt        DateTime?           @map("settled_at")

  openedAt  DateTime @map("opened_at")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  campaign      PaperCampaign         @relation(fields: [campaignId], references: [id])
  contract      Contract              @relation(fields: [contractId], references: [id])
  riskConfig    PaperRiskConfig       @relation(fields: [riskConfigId], references: [id])
  fills         PaperFill[]
  ledgerEntries PaperLedgerEntry[]
  candidates    PaperCycleCandidate[]

  @@unique([campaignId, contractId])
  @@index([campaignId, status])
  @@map("paper_positions")
}

/// One simulated execution. Append-only; an increment is a new fill, never an
/// edit to an existing one.
model PaperFill {
  id          String   @id @default(uuid())
  positionId  String   @map("position_id")
  cycleId     String   @map("cycle_id")
  candidateId String   @unique @map("candidate_id")
  contracts   Int
  priceCents  Int      @map("price_cents") // per contract, executable ask
  feeCents    Int      @map("fee_cents") // for this fill, rounded up
  costCents   Int      @map("cost_cents") // contracts × priceCents
  filledAt    DateTime @map("filled_at")
  createdAt   DateTime @default(now()) @map("created_at")

  position PaperPosition @relation(fields: [positionId], references: [id])
  cycle    PaperCycle    @relation(fields: [cycleId], references: [id])

  @@index([positionId])
  @@index([cycleId])
  @@map("paper_fills")
}

/// Duplicate-execution identity: (contract, game window, account-local
/// decision date). Stores DESIRED TOTAL exposure, so a retry compares totals
/// rather than reapplying an instruction.
model PaperDesiredExposure {
  id            String   @id @default(uuid())
  campaignId    String   @map("campaign_id")
  contractId    String   @map("contract_id")
  gameWindowKey String   @map("game_window_key") // ISO instant of the game's kickoff, UTC
  decisionDate  DateTime @map("decision_date") @db.Date // account-local (America/New_York)

  desiredContracts  Int      @map("desired_contracts")
  desiredStakeCents Int      @map("desired_stake_cents")
  lastCycleId       String?  @map("last_cycle_id")
  updatedAt         DateTime @updatedAt @map("updated_at")
  createdAt         DateTime @default(now()) @map("created_at")

  campaign PaperCampaign @relation(fields: [campaignId], references: [id])
  contract Contract      @relation(fields: [contractId], references: [id])

  @@unique([campaignId, contractId, gameWindowKey, decisionDate])
  @@map("paper_desired_exposures")
}

/// A safety condition that tripped. Never deleted; `force_overridden` is
/// terminal and is what makes "the bot wanted to stop and was overruled"
/// permanently visible.
model PaperBreach {
  id           String           @id @default(uuid())
  campaignId   String           @map("campaign_id")
  riskConfigId String           @map("risk_config_id")
  condition    BreachCondition
  resolution   BreachResolution @default(active)

  measuredValue    Decimal @map("measured_value") @db.Decimal(12, 5)
  measuredDisplay  String  @map("measured_display") // rendered verbatim; built server-side
  thresholdValue   Decimal @map("threshold_value") @db.Decimal(12, 5)
  thresholdDisplay String  @map("threshold_display")

  detectedByCycleId String?   @map("detected_by_cycle_id")
  trippedAt         DateTime  @map("tripped_at")
  resolvedAt        DateTime? @map("resolved_at")
  resolvedByUserId  String?   @map("resolved_by_user_id")
  createdAt         DateTime  @default(now()) @map("created_at")

  campaign   PaperCampaign   @relation(fields: [campaignId], references: [id])
  riskConfig PaperRiskConfig @relation(fields: [riskConfigId], references: [id])
  cycle      PaperCycle?     @relation(fields: [detectedByCycleId], references: [id])
  resolvedBy User?           @relation(fields: [resolvedByUserId], references: [id])

  @@index([campaignId, trippedAt(sort: Desc)])
  @@map("paper_breaches")
}

/// Inspection only. Writes no position and no ledger entry, and is
/// structurally unreachable from every bankroll, review, and readiness read.
model PaperDryRun {
  id              String  @id @default(uuid())
  campaignId      String  @map("campaign_id")
  riskConfigId    String  @map("risk_config_id")
  recalibrationId String? @map("recalibration_id")
  gameId          String  @map("game_id")
  actorUserId     String  @map("actor_user_id")

  wouldExecute      Boolean @map("would_execute")
  blockedByBreaches Json?   @map("blocked_by_breaches") // condition names active at run time
  /// The full plan, in the same shape `CandidateDto` renders. Not rows: this
  /// is not ledger data and must not look like it.
  plan              Json

  ranAt     DateTime @map("ran_at")
  createdAt DateTime @default(now()) @map("created_at")

  campaign      PaperCampaign     @relation(fields: [campaignId], references: [id])
  riskConfig    PaperRiskConfig   @relation(fields: [riskConfigId], references: [id])
  recalibration RecalibrationFit? @relation(fields: [recalibrationId], references: [id])
  game          Game              @relation(fields: [gameId], references: [id])
  actor         User              @relation(fields: [actorUserId], references: [id])

  @@index([campaignId, ranAt(sort: Desc)])
  @@map("paper_dry_runs")
}

/// Counterfactual risk-mode replay over a completed period. Separate tables,
/// for the same reason as PaperDryRun: nothing that reads bankroll,
/// readiness, or the active risk mode may reach them.
model PaperReplay {
  id          String   @id @default(uuid())
  campaignId  String   @map("campaign_id")
  periodKind  String   @map("period_kind") // "game_window" | "week" | "campaign"
  periodKey   String   @map("period_key") // "2026-w9", "2026-11-02T18:00:00Z", "campaign"
  actualMode  RiskMode @map("actual_mode")
  actorUserId String   @map("actor_user_id")
  ranAt       DateTime @map("ran_at")
  createdAt   DateTime @default(now()) @map("created_at")

  campaign PaperCampaign           @relation(fields: [campaignId], references: [id])
  actor    User                    @relation(fields: [actorUserId], references: [id])
  results  PaperReplayModeResult[]

  @@unique([campaignId, periodKind, periodKey, ranAt])
  @@index([campaignId, periodKind, periodKey])
  @@map("paper_replays")
}

model PaperReplayModeResult {
  id       String   @id @default(uuid())
  replayId String   @map("replay_id")
  mode     RiskMode

  endingActiveCents Int @map("ending_active_cents")
  netPnlCents       Int @map("net_pnl_cents")
  withdrawnCents    Int @map("withdrawn_cents")
  maxDrawdownBps    Int @map("max_drawdown_bps")
  positionCount     Int @map("position_count")
  breakerTrips      Int @map("breaker_trips")

  createdAt DateTime @default(now()) @map("created_at")

  replay PaperReplay @relation(fields: [replayId], references: [id], onDelete: Cascade)

  @@unique([replayId, mode])
  @@map("paper_replay_mode_results")
}
```

### Updated models

```prisma
enum PipelineJobCategory {
  ingest
  recompute
  keepalive
  outcome_ingest
  grading
  paper_cycle       // NEW — scheduled autonomous execution
  paper_settlement  // NEW — settlement, withdrawal ratchet, breaker re-evaluation
  recalibration_fit // NEW — refit of the active probability correction
}
```

`Contract`, `Projection`, `PriceObservation`, `BacktestRun`, and `User` gain back-relations only. No existing column changes.

### Raw SQL constructs

```sql
-- One active breach per condition per campaign. Prisma cannot express a
-- partial unique index, and without it a flapping breaker would open a second
-- row for a condition that is already breached.
create unique index paper_breaches_one_active_per_condition
  on paper_breaches (campaign_id, condition)
  where resolution = 'active';

-- Exactly one active recalibration fit per model version.
create unique index recalibration_fits_one_active_per_model
  on recalibration_fits (model_version)
  where is_active = true;

-- A force-overridden breach must carry its resolver and time. A resolution
-- that lost its actor is an audit trail that lost its point.
alter table paper_breaches add constraint paper_breaches_resolution_provenance
  check (
    (resolution = 'active' and resolved_at is null and resolved_by_user_id is null)
    or (resolution <> 'active' and resolved_at is not null and resolved_by_user_id is not null)
  );

-- Percentage bounds, so an out-of-range configuration cannot be persisted even
-- if a route handler were bypassed.
alter table paper_risk_configs add constraint paper_risk_configs_bounds
  check (
    kelly_fraction >= 0 and kelly_fraction <= 1
    and per_game_cap_pct between 1 and 50
    and per_slate_cap_pct between 1 and 50
    and per_slate_cap_pct >= per_game_cap_pct
    and drawdown_warn_pct between 1 and 50
    and drawdown_halt_pct between 1 and 50
    and drawdown_halt_pct > drawdown_warn_pct
    and probability_ceiling > 0 and probability_ceiling <= 1
    and withdrawal_ceiling_multiple >= 1
  );

-- A fill can never exceed the size that was observed at the top of the book.
-- This is the flattering-fill guard expressed in the database, so an
-- optimisation in application code cannot quietly relax it.
alter table paper_cycle_candidates add constraint paper_cycle_candidates_fill_within_book
  check (
    top_of_book_size_contracts is null
    or filled_contracts <= top_of_book_size_contracts
  );

alter table paper_cycle_candidates add constraint paper_cycle_candidates_fill_within_intent
  check (filled_contracts <= intended_contracts);

-- Positive quantities and non-negative money.
alter table paper_positions add constraint paper_positions_non_negative
  check (contracts >= 0 and cost_basis_cents >= 0 and fees_paid_cents >= 0);

alter table paper_fills add constraint paper_fills_sane
  check (contracts > 0 and price_cents between 1 and 99 and fee_cents >= 0);
```

Row-level security is **not** enabled on these tables. They are admin-only, not user-scoped: there is one campaign, and it belongs to the product rather than to a user. `PaperControlEvent.actorUserId` and `PaperBreach.resolvedByUserId` record *who acted*, which is provenance, not ownership. Server-side `requireAdmin()` is the mechanism, consistent with `CLAUDE.md` → Authorization.

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| `AutonomyStatus` | **no** | campaign switches + active breaches | No status column to desynchronise |
| Settled balance (current) | no | last `PaperLedgerEntry.balanceAfterCents` | The running total is a fact of the entry, not a cache |
| Open exposure | no | sum of open `PaperPosition.costBasisCents + feesPaidCents` | |
| Mark-to-market | no | settled balance + Σ `contracts × bid` on held side | `unavailable` when any open position lacks a bid |
| Drawdown | no | high-water mark vs mark-to-market | `unavailable` propagates; never a settled-only fallback |
| Per-game / per-slate capacity | no | active bankroll × config percentages | Percentages of **current** active bankroll, re-derived each cycle |
| High-water mark | **yes** | greatest mark-to-market observed | Path-dependent on observations not all retained; reset on withdrawal. Justified above. |
| Corrected probability | **yes**, on the candidate | active `RecalibrationFit` applied to raw | Frozen with its `recalibrationId`. A refit never rewrites history. |
| Kelly edge, intended stake, `boundBy` | **yes**, on the candidate | the plan | The audit trail is the product; recomputing it later from changed state would be a different number. |
| Readiness state | no | criteria evaluated per request | Re-evaluated on each page load |
| Review figures | no | ledger + positions + breaches for the period | |

## 8. The decision path

One pure module, `src/lib/paper/plan.ts`, exporting `planCycle(input: CyclePlanInput): CyclePlan`. No Prisma, no env, no clock — everything is supplied. Scheduled execution, Dry Run, and replay all call it.

### 8.1 Candidate selection

For the game window's game, select `Contract` rows where `status = active`, `resolutionStatus = resolved`, `gameId` matches, and a projection exists for `(playerId, gameId, statType)`. For each:

1. **Staleness.** `stalenessForRow(...)` on the freshest projection. `isStale` **or** `predatesInactives` → `verdict = refused`, `boundBy = stale_projection`. The pitch requires refusing stale projections; the two-state disclosure already exists and both states are refusals here, because a projection that predates inactives is exactly the state autonomous execution must not stake against.
2. **Price.** No latest `PriceObservation`, or no ask on either side → `verdict = refused`, `boundBy = price_unavailable`.
3. **Recalibration.** No active `RecalibrationFit` for the projection's model version → `verdict = refused`, `boundBy = no_active_recalibration`, and the whole cycle records `outcome = no_candidate` with that reason. Sizing from a raw probability is a No-Go; refusing is the only other option.

### 8.2 Corrected probability

`raw = probAtLeast(storedDistribution, threshold)` — the existing `src/lib/slate/probability.ts`. Then `corrected = applyRecalibration(fit, raw)`, piecewise-linear interpolation over the fit's monotone knots, clamped to `[0.001, 0.999]`.

Side selection mirrors `computeEdge`: evaluate both sides at their fee-adjusted asks and take the greater Kelly edge. The side's probability is `corrected` for `yes` and `1 − corrected` for `no`.

**Probability ceiling.** If the side's probability exceeds the config's `probabilityCeiling` (0.750 default), `verdict = no_stake`, `boundBy = probability_ceiling`. The ceiling is checked on the **corrected** probability of the side actually being staked, and is read from the config version, never from the mode.

### 8.3 Fees and the fee-adjusted price

Kalshi's general trading fee, taker side:

```
feeDollars(contracts C, priceDollars P) = ceilToCent(FEE_RATE × C × P × (1 − P))
```

with `FEE_RATE = 0.07` as a named constant in `src/lib/paper/config.ts`. Paper execution is taker-only at the ask, so the maker fee schedule does not apply and is not modelled; settlement carries no fee.

For ranking and the no-edge test, the per-contract fee-adjusted price is

```
c_eff = c + FEE_RATE × c × (1 − c)      // dollars, per contract
```

rounded up to the cent for display and for stake conversion. The order-level fee actually charged uses the ceiling formula above on the filled contract count, so a fill's recorded fee is exact rather than a per-contract multiple.

### 8.4 Kelly edge and ranking

```
b = (1 − c_eff) / c_eff
kellyEdge = (b · p − q) / b = p − q · c_eff / (1 − c_eff)
```

`kellyEdge ≤ 0` → `verdict = no_stake`, `boundBy = no_edge_after_fees`.

Candidates are ordered by `kellyEdge` descending. Ties break by contract `kalshiTicker` ascending, so ordering is total and reproducible. Refused candidates rank last, in ticker order.

### 8.5 Sizing

```
fractionApplied = config.kellyFraction × CONFIDENCE_WEIGHTS[confidence]
desiredStakeCents = floor(kellyEdge × fractionApplied × activeBankrollCents)
```

`CONFIDENCE_WEIGHTS` is imported from `src/lib/slate/edge.ts` — the same `{ high: 1.0, medium: 0.7, low: 0.4 }` the slate ranks by. A second confidence scale for money would be the drift the shared constant exists to prevent.

Caps are applied in this order, and the **first one that reduces the stake is recorded** as `boundBy`:

1. `available_bankroll` — remaining unallocated settled balance in this pass.
2. `per_game_cap` — `floor(activeBankroll × perGameCapPct / 100)` minus exposure already held or allocated for that game.
3. `per_slate_cap` — same, campaign-wide across open positions and this cycle's allocations.

Then convert to whole contracts: `intendedContracts = floor(stakeCents / netPriceCents)`. Rounding is always **down**. `intendedContracts = 0` → `verdict = no_stake` with the cap that produced it as `boundBy`, or `available_bankroll` when nothing bound but the stake was under one contract.

### 8.6 Duplicate prevention

Before sizing produces an intent, the planner reads the desired-exposure key `(campaign, contract, gameWindowKey, decisionDate)`:

- `desiredContracts` from this evaluation is the **total** desired for the key, not an addition.
- `heldContracts` is the current `PaperPosition.contracts` for the contract.
- `eligibleIncrement = max(0, desiredContracts − heldContracts)`.
- `eligibleIncrement = 0` → `verdict = no_stake`, `boundBy = none`, `boundByDetail = "desired total already held"`. A retry of an unchanged evaluation therefore adds nothing.
- The increment is then subject to every cap **as if evaluated fresh**, using current exposure including the held position.

`gameWindowKey` is the game's stored `kickoffAt` as an ISO instant; `decisionDate` is the account-local date in `America/New_York`, the timezone the NFL schedule is expressed in.

### 8.7 Fill model

Top-of-book only, and never favourable:

- `available = topOfBookSizeContracts` on the executable side, from the orderbook read at evaluation time. **Absent depth is treated as zero, not as unlimited** — a candidate whose book size cannot be read is `refused` with `boundBy = price_unavailable`.
- `available ≥ intendedContracts` → complete fill at the ask.
- `0 < available < intendedContracts` → fill exactly `available` at the ask. **The book is never walked for the remainder**, and no worse price is assumed to have been available. `verdict = partial`, `boundBy = top_of_book_size`.
- `available = 0` → `verdict = no_stake`, `boundBy = top_of_book_size`.
- The unfilled remainder returns to available bankroll for the reallocation pass.

### 8.8 Reallocation

At most `MAX_ALLOCATION_PASSES = 3` passes.

- A candidate whose fill was capped by displayed size is **liquidity-exhausted** for the remainder of the cycle and is not retried. Its top-of-book was consumed; retrying it would be chasing liquidity Sightline has no evidence existed.
- Each subsequent pass re-runs §8.5–§8.7 over the remaining candidates with the reduced bankroll and increased exposure.
- The loop stops early when no remaining candidate has positive Kelly edge or when nothing filled in a pass.
- Every pass appends a human-readable line to `allocationTrace`, including the reason the loop stopped. An unallocated remainder is stated, not hidden.

### 8.9 The ten-minute cutoff

Evaluated **at the moment a fill would be written**, not only at cycle start. `now ≥ kickoffAt − 10 minutes` → the cycle records `outcome = skipped`, `skipReason = "pre_kickoff_cutoff"`, remaining candidates `verdict = blocked`, `boundBy = pre_kickoff_cutoff`, and **no position is created**. The cutoff is a constant, not configurable, and applies in every risk mode.

The execution window opens at `kickoffAt − 6 hours` (matching `GAMEDAY_PRICE_WINDOW_HOURS`, so the cycle only runs when the price cadence is already game-day).

## 9. Probability Recalibration

`src/lib/paper/recalibration/fit.ts` — pure; `store.ts` — persistence.

**Inputs, exhaustively:** `CalibrationBin` rows for the reference `BacktestRun` where `population = 'contract_like'`; `ThresholdGrade` rows where `contractLike = true` and the projection's `modelVersion` matches, joined to their projections. Nothing else. `PriceObservation`, `RecommendationSnapshot`, `Outcome`, and `Decision` are not read, and an import-graph assertion enforces that the recalibration module reaches none of them.

**Method, `pava_piecewise_linear/v1`:**

1. Bucket live `ThresholdGrade` rows into the same ten fixed tenths as `CalibrationBin.binIndex`, producing `predictedMeanLive_i`, `observedRateLive_i`, `nLive_i`.
2. Per bin, shrink toward the backtest prior:
   `w_i = nLive_i / (nLive_i + SHRINKAGE_K)` with `SHRINKAGE_K = 200`,
   `observed_i = w_i · observedRateLive_i + (1 − w_i) · observedRateBacktest_i`.
   With no live data `w_i = 0` and the fit is the backtest record exactly — the required fallback to the established prior rather than an unstable correction.
3. Enforce monotonicity across bins with pooled-adjacent-violators, weighted by `nLive_i + nBacktest_i`.
4. Knots = `(0, 0)`, then `(predictedMean_i, observed_i)` for every bin with any observations, then `(1, 1)`. Apply by piecewise-linear interpolation.

**Versioning.** A refit writes a new `RecalibrationFit` with `version = max + 1` and flips `isActive`. Historical candidates keep their `recalibrationId` and their stored `correctedProbability`; **no stored corrected probability is ever recomputed.** A model-version change produces a new fit rather than extending an existing one, and the two are distinguishable by `modelVersion` on the fit and by the separate `PaperControlEvent` recording the change.

**Cadence.** Refit nightly via `PipelineJobCategory.recalibration_fit`, appended to `pipeline-nightly.yml` after grading, and idempotent: a refit producing identical knots and an identical live sample writes no new version.

## 10. Circuit breakers

Evaluated at the start of every cycle (before sizing) and at the end of every settlement pass. Each evaluation may open at most one breach per condition, enforced by the partial unique index.

| Condition | Trips when | Threshold source | Halts? |
| --------- | ---------- | ---------------- | ------ |
| `drawdown_warning` | drawdown ≥ `drawdownWarnPct` (5%) | config | no |
| `drawdown_halt` | drawdown ≥ `drawdownHaltPct` (10/15/20%) | config | yes |
| `calibration` | rolling Brier exceeds the backtest Brier by > `CALIBRATION_DEGRADATION_TOLERANCE` (0.03), **or** exceeds Kalshi's rolling Brier over the same contracts by > `CALIBRATION_MARKET_TOLERANCE` (0.02) | constants | yes |
| `exposure` | open exposure > per-slate cap | config | yes |
| `kill_switch` | `killSwitchEngaged` | — | yes |

### Drawdown

`markToMarket = settledBalance + Σ (contracts × bidCents on the held side)` over open positions, using each contract's latest `PriceObservation`. If any open position has no usable bid, mark-to-market is `unavailable`:

- Drawdown reports `unavailable` on every surface — never a settled-only substitute.
- The **cycle refuses to open any position**, recording `outcome = failed`, `skipReason = "mark_to_market_unavailable"`. Refusing to stake while a safety check cannot run is the conservative direction, and it is the same posture as refusing a stale projection.

### Calibration

Window: the trailing `CALIBRATION_WINDOW = 100` graded threshold observations for the **current model version**, ordered by `gradedAt` descending. A model-version change therefore resets the window by construction — the filter, not a stored reset.

- **Degradation arm** — population `contractLike = true`, any `thresholdSource`. Requires `CALIBRATION_MIN_OBSERVATIONS = 30`; below it the arm reports `insufficient data` and does not evaluate.
- **Market arm** — the market-linked subset (`thresholdSource = market`, contract resolved, `Outcome` present, a `final_pre_kickoff` `RecommendationSnapshot` available). Requires the same minimum independently. Market Brier uses the executable price on the graded side at that snapshot, reusing `src/lib/accuracy/compute.ts`'s `marketComparison` inputs so the breaker and the accuracy surface can never disagree about the market's score.
- Below the minimum, the breaker **states that insufficient data exists** and does not trip. It never passes or fails on a sample too small to mean anything.

This is the one place a Kalshi-derived number influences autonomous behaviour, and it does so as a **safety check that can only stop trading**, never as an input to a probability. It is implemented entirely in TypeScript; the Python runtime remains barred from every price-derived table.

### Trip semantics inside a cycle

Positions created before the trip remain. Remaining candidates are written with `verdict = blocked`, `boundBy = breaker`, `boundByDetail = <condition>`. The cycle's outcome is `halted`. **The cycle is not rolled back** — the transaction commits the fills that legitimately happened alongside the breach row and the blocked candidates.

## 11. Settlement, withdrawal, and P&L

`POST /api/pipeline/paper-settlement`, hourly, `PipelineJobCategory.paper_settlement`. Per run, in one transaction per position:

1. Open positions whose contract has an `Outcome`:
   - `yes`/`no` matching the held side → `proceedsCents = contracts × 100`, `settlement_credit`, `status = settled_won`.
   - opposite → `proceedsCents = 0`, no credit entry, `status = settled_lost`.
   - `voided` → `void_refund` of `costBasisCents + feesPaidCents`, `realizedPnlCents = 0`, `status = voided`.
   - `realizedPnlCents = proceedsCents − costBasisCents − feesPaidCents`.
2. **Supersession.** An `Outcome` whose `supersededCount` increased since the position settled produces compensating ledger entries reversing the prior settlement, then applies the new one. Nothing is deleted or edited; the note field records the transition.
3. Recompute mark-to-market and advance the high-water mark if it increased.
4. **Withdrawal ratchet.** `ceiling = startingBankrollCents × withdrawalCeilingMultiple`. While `settledBalance > ceiling`: write a `withdrawal` entry of `−(settledBalance − ceiling)`, then **reset the high-water mark to the post-withdrawal active bankroll**, so a voluntary removal of profit never counts as a loss against the pre-withdrawal peak. The ceiling test uses settled balance only — unrealised value cannot be withdrawn.
5. Re-evaluate every breaker.

Cumulative withdrawals are `−Σ` of `withdrawal` entries. Total paper wealth is `activeBankroll + cumulativeWithdrawals`. Net paper P&L is `totalPaperWealth − startingBankroll`.

## 12. Counterfactual replay

`POST /api/autonomy/replay` over a completed period. A period is **replayable only when every position opened in it has settled or voided**; otherwise the route returns `invalid_state_transition` with the count still open.

The replay reads `PaperCycle` and `PaperCycleCandidate` rows for the period — which carry the raw and corrected probability, the executable ask, the fee, the observed top-of-book size, the confidence, and the settlement that followed — and re-runs `planCycle` per cycle in chronological order with a synthetic bankroll starting from the period's opening balance, substituting only the risk configuration. It applies the same fill policy against the **same recorded top-of-book sizes**, and the same settlements.

Guarantees, each individually tested:

- Replay reads no state later than the cycle it is replaying. It never reads an `Outcome` before that cycle's settlement pass would have, and it never reads a projection with a later `computedAt`.
- Replay recomputes no probability. It reuses the stored `correctedProbability`, so a later refit cannot leak backwards.
- Replay writes **only** `PaperReplay` and `PaperReplayModeResult`. It touches no ledger entry, no position, no breach, no campaign field, and no risk config.
- Replay never changes the active risk mode, and no code path reads a replay result to select one.

## 13. Authorization and access control

Every surface and every route in this feature is **admin-only**.

- Server components call `requireAdmin()` before any read; all seven `/autonomy` pages and the `/autonomy/override` page are added to the admin-route list in `src/invariants/build-invariants.test.ts`, and all carry `export const dynamic = "force-dynamic"`.
- Route handlers under `/api/autonomy/*` call `requireSession()` then reject non-admins with `forbidden`. The acting user's identity comes from the session for `PaperControlEvent.actorUserId`, `PaperRiskConfig.createdByUserId`, `PaperBreach.resolvedByUserId`, `PaperDryRun.actorUserId`, and `PaperReplay.actorUserId`. **No user identifier and no role is ever read from a request body.**
- Routes under `/api/pipeline/*` are machine-authenticated with the existing constant-time `verifyPipelineToken`. They read no user identity and have no role.
- The Autonomy nav item is `adminOnly: true` in `src/components/shell/NavSections.ts`. Nav filtering is a courtesy; the server rejection is the boundary.
- This is **not** multi-tenancy and no per-user partition of paper data exists. There is one campaign and it belongs to the product.
- RLS is not enabled on these tables (rationale in §7). The Python runtime's service-role credential bypasses RLS by design and is walled off by never serving a user request; no route handler uses it.

### Credential posture

This feature places no order, reads no portfolio or balance, and signs nothing but the existing market-data GETs. One Kalshi client method is added:

```typescript
/** Top of the executable book for one market. MARKET DATA ONLY. */
export async function getOrderbookTop(ticker: string): Promise<{
  yesAskCents: number | null;
  yesAskSizeContracts: number | null;
  noAskCents: number | null;
  noAskSizeContracts: number | null;
} | null>;
```

It calls `GET /markets/{ticker}/orderbook`, a public market-data endpoint. The build invariant asserting the client contains none of `/orders`, `/portfolio`, `/balance`, `/fills`, `/positions` remains unchanged and must continue to pass; `/orderbook` is added to no forbidden list because it is a read. The invariant asserting the Kalshi key pair is reachable from exactly two modules (`src/env.ts`, `src/lib/kalshi/client.ts`) also remains unchanged.

The `/bankroll` entry in the forbidden-route list in `src/invariants/build-invariants.test.ts` **stays**, guarding the deferred V2 bankroll-and-portfolio-management product. Its comment is updated to record that the paper bankroll ships under `/autonomy` and that a `/bankroll` route would be the V2 product. `/picks`, `/subscriptions`, `/nba`, `/wnba`, `/messages`, `/reset-password`, and `/forgot-password` are unchanged.

## 14. Route handlers and API surface

Reads are server components through Prisma. No `/api/autonomy/*` GET exists.

```http
POST /api/autonomy/kill                 # engage; no body, no confirmation
POST /api/autonomy/kill/release         # disengage
POST /api/autonomy/resume               # only when every non-warning breach has cleared
POST /api/autonomy/override             # { breachIds: string[] }
POST /api/autonomy/configuration        # ConfigurationInput
POST /api/autonomy/dry-run              # { gameId: string }
POST /api/autonomy/replay               # { periodKind, periodKey }
POST /api/pipeline/paper-cycle          # Authorization: Bearer <PIPELINE_SCHEDULER_TOKEN>
POST /api/pipeline/paper-settlement     # Authorization: Bearer <PIPELINE_SCHEDULER_TOKEN>
```

```typescript
export type ConfigurationInput = {
  mode: "conservative" | "moderate" | "aggressive" | "custom";
  kellyFraction?: number;      // required when mode === "custom"
  perGameCapPct?: number;
  perSlateCapPct?: number;
  drawdownHaltPct?: number;
  startingBankrollCents?: number;   // rejected when any PaperFill exists
  withdrawalCeilingMultiple: number;
  autonomyEnabled: boolean;
};

export type PaperCycleResult = {
  skipped?: "not_expected" | "coalesced" | "disabled" | "killed";
  windowsEvaluated: number;
  cycles: Array<{
    cycleId: string;
    gameId: string;
    outcome: PaperCycleOutcome;
    skipReason: string | null;
    candidatesEvaluated: number;
    candidatesFilled: number;
    stakedCents: number;
  }>;
  degraded: boolean; // Kalshi outage — designed state, 200 not 503
};

export type PaperSettlementResult = {
  skipped?: "not_expected" | "coalesced";
  positionsSettled: number;
  positionsVoided: number;
  settlementsSuperseded: number;
  withdrawalsMade: number;
  withdrawnCents: number;
  breachesOpened: number;
  degraded: boolean;
};
```

**Cadence, decided server-side.** A new workflow `.github/workflows/pipeline-autonomy.yml` runs `cron: "*/10 * * * *"` and calls `/api/pipeline/paper-cycle` unconditionally. The route decides, from stored state and never the calendar, mirroring `decidePriceRefreshAction`:

- No game with `kickoffAt` inside `[now, now + SEASON_LOOKAHEAD_DAYS]` → `skipped: "not_expected"`, no `PipelineRun` row (offseason dormancy is derived from stored data, as with price refresh).
- Campaign not enabled → `skipped: "disabled"`. Kill switch engaged → `skipped: "killed"`. Both record a `PipelineRun` so the operator can see the scheduler is alive while the bot is deliberately off.
- Per game, eligible when `kickoffAt − 6h ≤ now ≤ kickoffAt − 10min` **and** the last cycle for that game started more than `PAPER_CYCLE_INTERVAL_MINUTES` (30) ago; otherwise that game is coalesced.
- Duplicate scheduler delivery is a structural no-op via `@@unique([campaignId, gameId, invocationId])` — a P2002 on create is caught and reported as coalesced, matching the keepalive pattern.
- A Kalshi outage records `outcome = failed` with a sanitized reason and answers 200 with `degraded: true`. It never answers 5xx and never creates a position.

`/api/pipeline/paper-settlement` runs `cron: "20 * * * *"` in the same workflow file, offset from the outcome-ingest cron so settlement reads outcomes the previous ingest wrote.

**Error vocabulary** is the existing `jsonError` set. Feature-specific mappings:

| Situation | Code |
| --------- | ---- |
| Non-admin session on any `/api/autonomy/*` route | `forbidden` |
| Resume while a condition is still breached | `invalid_state_transition` |
| Force override naming a breach that has cleared | `invalid_state_transition` |
| Force override while the kill switch is engaged | `invalid_state_transition` |
| Enable autonomy while a non-warning breach is active | `invalid_state_transition` |
| Change starting bankroll after a fill exists | `invalid_state_transition` |
| Replay over a period with open positions | `invalid_state_transition` |
| Dry run for a game with no resolvable contracts | 200 with an empty plan — a legitimate result, not an error |
| Kalshi unavailable during a dry run | `upstream_unavailable`, and **nothing is written** |
| Configuration failing bounds | `validation_error` with field details |

## 15. Validation rules

| Surface | Rule | Behavior |
| ------- | ---- | -------- |
| Configuration | `kellyFraction > 0.75` | **Accepted.** Persistent inline warning, never a block — Custom exists to override presets deliberately |
| Configuration | `kellyFraction` outside `[0, 1]` | `validation_error` |
| Configuration | `perSlateCapPct < perGameCapPct` | `validation_error`, field-level |
| Configuration | any percentage outside `[1, 50]` | `validation_error` |
| Configuration | `startingBankrollCents` changed with fills present | `invalid_state_transition`; the field is also disabled in the UI |
| Configuration | `withdrawalCeilingMultiple < 1.0` | `validation_error` |
| Configuration | body carrying a `userId` or `role` | ignored; identity comes from the session. A test asserts a supplied `userId` does not reach the row |
| Override | `breachIds` not covering every currently active non-warning breach | `invalid_state_transition` — partial override is not a state |
| Override | a named breach not belonging to the campaign | `not_found` |
| Cycle | corrected probability above the ceiling | `no_stake`, not an error |
| Cycle | Kelly edge ≤ 0 after fees | `no_stake`, not an error |
| Cycle | stale or predates-inactives projection | `refused`, not an error |
| Cycle | book size absent | `refused` with `price_unavailable`; **never treated as unlimited depth** |
| Cycle | zero candidates | `outcome = no_candidate`, a successful run |
| Cycle | mark-to-market unavailable | `outcome = failed`, `mark_to_market_unavailable`; nothing created |
| Settlement | `Outcome` absent | position stays `open`; never force-settled |
| Settlement | position for a contract with a superseded outcome | compensating entries, never edits |
| Any pipeline route | missing or wrong bearer token | `unauthorized`; unconfigured → `upstream_unavailable` |

No response carries Prisma error text, a connection string, a Kalshi URL or header, the scheduler token, or anything about the signing key. `PaperCycle.errorMessage` stores the Kalshi client's already-sanitized message verbatim and nothing else.

## 16. UI data contracts

```typescript
export type AutonomyStatusDto = "disabled" | "active" | "halted" | "killed";

export type BreachDto = {
  id: string;
  condition: "drawdown_warning" | "drawdown_halt" | "calibration" | "exposure" | "kill_switch";
  label: string;
  conditionDescription: string;
  measuredDisplay: string;
  thresholdDisplay: string;
  trippedAt: string;
  resolution: "active" | "cleared" | "force_overridden";
  resolvedAt: string | null;
  resolvedByDisplayName: string | null;
  halts: boolean;
};

export type MoneyDto = { cents: number } | { unavailable: true };

export type AutonomyOverviewDto = {
  status: AutonomyStatusDto;
  killSwitchEngaged: boolean;
  paperOnly: true; // structural: no surface may render without it
  mode: {
    mode: "conservative" | "moderate" | "aggressive" | "custom";
    kellyFraction: number;
    perGameCapPct: number;
    perSlateCapPct: number;
    drawdownWarnPct: number;
    drawdownHaltPct: number;
    probabilityCeiling: number;
  };
  figures: {
    startingBankrollCents: number;
    settledBalanceCents: number;
    openExposureCents: number;
    activeBankroll: MoneyDto;
    cumulativeWithdrawalsCents: number;
    totalPaperWealth: MoneyDto;
    netPaperPnl: MoneyDto;
    maxDrawdownBps: number | null; // null === unavailable, never 0
    highWaterMarkCents: number;
    markToMarketAvailable: boolean;
    priceLastFetchedAt: string | null; // populated when mark is unavailable
  };
  exposure: {
    slate: { usedCents: number; capCents: number; capPct: number };
    games: Array<{ gameId: string; label: string; usedCents: number; capCents: number; capPct: number }>;
  };
  history: Array<{ at: string; settledCents: number; markCents: number | null }>;
  breaches: BreachDto[];
  recentCycles: CycleRowDto[];
  readiness: { state: ReadinessState; weeksComplete: number; weeksRequired: 2 };
  emptyReason: "not_enabled" | "offseason" | "no_cycles_this_week" | null;
};

export type CycleRowDto = {
  cycleId: string;
  startedAt: string;
  gameLabel: string;
  kickoffAt: string;
  outcome: "ok" | "partial_fill" | "no_candidate" | "halted" | "skipped" | "failed";
  reason: string | null;
  candidatesEvaluated: number | null;
  candidatesSized: number | null;
  candidatesFilled: number | null;
  stakedCents: number | null;
};

export type CandidateDto = {
  contractId: string;
  rank: number;
  playerName: string;
  teamAbbreviation: string;
  statType: StatType;
  threshold: number;

  // Model side. Null is "could not price", never zero.
  rawProbability: number | null;
  correctedProbability: number | null;
  confidence: "high" | "medium" | "low" | null;

  // Market side. Null is "no book", never zero.
  side: "yes" | "no" | null;
  askCents: number | null;
  feeCents: number | null;
  netPriceCents: number | null;
  topOfBookSizeContracts: number | null;

  kellyEdge: number | null;
  kellyFractionApplied: number | null;

  // Intended and filled are two fields, always both.
  intendedStakeCents: number;
  intendedContracts: number;
  filledContracts: number;
  filledCostCents: number;
  filledFeeCents: number;
  unfilledStakeCents: number;

  verdict: "filled" | "partial" | "no_stake" | "refused" | "blocked";
  boundBy: BindingConstraint;
  boundByDetail: string | null;
};

export type CycleDetailDto = {
  cycleId: string;
  gameLabel: string;
  kickoffAt: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: CycleRowDto["outcome"];
  reason: string | null;
  mode: AutonomyOverviewDto["mode"];
  recalibration: { version: number; backtestLabel: string; liveObservationCount: number } | null;
  bankrollAtEvaluationCents: number;
  slateCapacityCents: number;
  gameCapacityCents: number;
  candidates: CandidateDto[];
  allocationTrace: string[];
};

export type PositionRowDto = {
  positionId: string;
  contractId: string;
  playerName: string;
  statType: StatType;
  threshold: number;
  side: "yes" | "no";
  contracts: number;
  costBasisCents: number;
  feesPaidCents: number;
  intendedStakeCents: number;
  unfilledStakeCents: number;
  markCents: number | null; // null === unavailable
  status: "open" | "settled_won" | "settled_lost" | "voided";
  settlementResult: "yes" | "no" | "voided" | null;
  realizedPnlCents: number | null; // null while open — unrealised never enters this field
  openedAt: string;
  settledAt: string | null;
};

export type ReviewDto = {
  periodKind: "game_window" | "week" | "campaign";
  periodKey: string;
  periodLabel: string;
  modesUsed: Array<"conservative" | "moderate" | "aggressive" | "custom">;
  startingBankrollCents: number;
  endingActiveBankroll: MoneyDto;
  netPaperPnl: MoneyDto;
  cumulativeWithdrawalsCents: number;
  totalPaperWealth: MoneyDto;
  maxDrawdownBps: number | null;
  positionCount: number;
  settledCount: number;
  fillQuality: { complete: number; partial: number; unfilled: number };
  safetyEvents: BreachDto[];
  modelQuality: {
    rollingBrier: number | null;
    backtestBrier: number | null;
    marketBrier: number | null;
    gradedObservations: number;
  };
  replayAvailable: boolean;
  replayBlockedReason: string | null;
};

export type ReplayComparisonDto = {
  ranAt: string | null;
  actualMode: "conservative" | "moderate" | "aggressive" | "custom";
  rows: Array<{
    mode: "conservative" | "moderate" | "aggressive";
    endingActiveCents: number;
    netPnlCents: number;
    withdrawnCents: number;
    maxDrawdownBps: number;
    positionCount: number;
    breakerTrips: number;
    isActualMode: boolean;
  }>;
};

export type ReadinessState = "not_ready" | "paper_evidence_building" | "eligible_for_live_trading";

export type ReadinessCriterionDto = {
  key: string;
  category: "paper_evidence" | "model_quality" | "safety_operations";
  label: string;
  met: boolean;
  evidence: string;
  /** True when the criterion could not be evaluated. Never counts as met. */
  unevaluable: boolean;
};

export type ReadinessDto = {
  state: ReadinessState;
  criteria: ReadinessCriterionDto[];
  evaluatedAt: string;
  /** Renders in every state; stronger copy when eligible. */
  disclaimer: string;
};
```

`MoneyDto` is a discriminated union rather than `number | null` deliberately: `unavailable` is a first-class rendered state on this surface and a bare null invites a `?? 0` at a call site.

No DTO carries a Kalshi credential, a service-role identifier, a raw Prisma row, a scheduler token, or a viewer-visible field. `PaperDryRun` and `PaperReplay` data never appears in `AutonomyOverviewDto`, `ReviewDto`, or `ReadinessDto`.

## 17. Live Readiness

Nine criteria in three categories, re-evaluated per request. **A criterion that cannot be evaluated is `unevaluable` and never counts as met.**

| Category | Criterion | Met when |
| -------- | --------- | -------- |
| paper_evidence | Two complete NFL weeks | ≥ 2 distinct `(season, week)` values where every scheduled game has kicked off **and** every position opened in that week has settled or voided |
| paper_evidence | Positive cumulative net paper P&L | Sum of `realizedPnlCents` across those complete weeks > 0, after fills and fees |
| model_quality | Calibration within range | rolling Brier ≤ backtest Brier + 0.03, with ≥ 30 observations |
| model_quality | Performance relative to Kalshi | rolling Brier ≤ market Brier + 0.02 over the shared population, with ≥ 30 observations |
| model_quality | Approved baseline requirements | a `completed` `BacktestRun` on the holdout window beating both stored baselines |
| safety_operations | Drawdown within bounds | max drawdown over the campaign ≤ the active config's `drawdownHaltPct` |
| safety_operations | Breakers behaved as expected | every breach trip has a resolution, and no cycle opened a position while a halting breach was active |
| safety_operations | No unresolved operational failures | zero `failed` cycles in the trailing 14 days |
| safety_operations | Sizing and exposure responsible | zero cycles where a fill exceeded a cap or the intended stake |

State mapping:

- `eligible_for_live_trading` — every criterion met.
- `paper_evidence_building` — at least one complete paper week exists and no criterion is *failing* other than the paper-evidence ones still accumulating.
- `not_ready` — otherwise, including before any complete week.

**The two-week requirement is not shortenable.** There is no configuration value, environment variable, query parameter, or test seam that reduces it below two complete NFL weeks; the constant is `REQUIRED_PAPER_WEEKS = 2` in `src/lib/paper/config.ts` and a test asserts a one-week campaign with excellent numbers reports `paper_evidence_building`.

No route, DTO field, button, or code path exists that acts on `eligible_for_live_trading`. A test asserts the readiness module has no exported mutation and that no route handler imports it.

## 18. Testing strategy

Priorities follow `CLAUDE.md` → Testing, with this feature's own hazards inserted where they belong.

### 1. Temporal leakage — unchanged and still green

```text
GIVEN the existing leakage suite (python/tests/ and src/lib as applicable)
WHEN this feature's schema, modules, and routes are added
THEN every existing leakage test passes unchanged, with no test modified, skipped, or re-baselined
```

Enforced additionally by:

```text
GIVEN a counterfactual replay of a completed week
WHEN it evaluates a cycle
THEN it reads no projection with a computedAt later than that cycle's startedAt,
 AND it reuses the stored correctedProbability rather than applying the current RecalibrationFit,
 AND a fit created after the period cannot change the replay's output
```

### 2. Prices never feed projections — extended structurally

```text
GIVEN python/tests/test_import_graph.py
WHEN the blocklist is extended with the new market-derived and account tables
THEN no module in sightline_ingest or sightline_model references
     paper_cycle_candidates, paper_positions, paper_fills, paper_ledger_entries,
     paper_desired_exposures, paper_campaigns, paper_risk_configs, paper_breaches,
     paper_cycles, paper_dry_runs, paper_replays, or recalibration_fits
 AND the planted-reference self-test proves each new token is actually caught
 AND the legitimate-vocabulary self-test proves none of them false-positives
```

```text
GIVEN src/lib/paper/recalibration/**
WHEN its import graph is walked
THEN it reaches neither PriceObservation, RecommendationSnapshot, nor Outcome,
 AND its inputs are exactly CalibrationBin and ThresholdGrade
```

### 3. Paper and live ledgers cannot be joined or aggregated

```text
GIVEN the Prisma schema after this feature
WHEN every model is inspected
THEN no model carries a paper/live mode discriminator column,
 AND no model whose name is not prefixed "Paper" holds a balance, a stake, a fill, or a position,
 AND no live ledger model exists,
 AND therefore no query in src/ can aggregate a paper figure with a live one
```

```text
GIVEN every source file under src/lib/paper and src/app/(app)/autonomy
WHEN scanned
THEN none contains the identifiers "livePosition", "liveLedger", "liveBankroll",
     or a union of a paper table with any other ledger-shaped table
```

This is a schema-invariant test in `prisma/tests/` plus a source sweep in `src/invariants/`, so it fails the build rather than a single suite.

### 4. Fill honesty — the flattering-fill guards

```text
GIVEN a candidate with an intended stake of 25 contracts and a top-of-book size of 12
WHEN the fill model runs
THEN exactly 12 contracts fill at the displayed ask,
 AND no fill occurs at any other price,
 AND the remaining 13 contracts' cost returns to available bankroll,
 AND the candidate is not retried in a later pass of the same cycle
```

```text
GIVEN a candidate whose orderbook read returns no size
WHEN the fill model runs
THEN the candidate is refused with price_unavailable
 AND depth is never inferred, defaulted, or treated as unlimited
```

```text
GIVEN any stored PaperCycleCandidate
WHEN the database constraint is evaluated
THEN filled_contracts never exceeds top_of_book_size_contracts or intended_contracts
```

```text
GIVEN a fill
WHEN its price is recorded
THEN it equals the executable ask, never the midpoint and never the bid
```

### 5. Duplicate prevention and idempotence

```text
GIVEN a cycle that filled 32 contracts for a contract on a decision date
WHEN the same invocation is delivered again
THEN a P2002 on (campaignId, gameId, invocationId) yields a coalesced no-op with no Kalshi call

GIVEN a later cycle the same day whose desired total is unchanged at 32
THEN no increment is added and the candidate records boundBy "none" with detail "desired total already held"

GIVEN a later cycle whose desired total rises to 48
THEN exactly 16 additional contracts are eligible, subject to every cap re-evaluated fresh
 AND the position holds 48, never 80
```

```text
GIVEN a settlement pass re-run over an already-settled period
THEN no duplicate ledger entry is written and no balance changes
```

### 6. Breakers, kill, resume, override

```text
GIVEN a cycle that fills two candidates and then trips a drawdown halt
THEN both fills remain, the remaining candidates are blocked with boundBy "breaker",
     the cycle outcome is halted, and nothing is rolled back
```

```text
GIVEN a tripped breaker
THEN no open position is closed, deleted, or force-settled,
 AND settlement continues to process those positions normally
```

```text
GIVEN an active breach
WHEN Resume is attempted
THEN it is refused with invalid_state_transition
```

```text
GIVEN a force override of two active breaches
THEN both records become force_overridden with actor and time,
 AND a later evaluation of the same condition opens a NEW breach row,
 AND the overridden records never render as cleared,
 AND the override appears in the period's review
```

```text
GIVEN the kill switch engaged
THEN a force override is refused,
 AND the scheduled cycle route reports skipped "killed" and creates nothing,
 AND no confirmation was required to engage it
```

```text
GIVEN fewer than 30 graded observations in the window
THEN the calibration breaker reports insufficient data and does not trip in either direction
```

```text
GIVEN an open position with no usable bid
THEN drawdown reports unavailable, the overview renders unavailable rather than zero,
 AND the cycle refuses to open any position
```

### 7. Nothing adapts to measured performance

```text
GIVEN a campaign with a long winning streak
WHEN a cycle runs
THEN the Kelly fraction, the exposure caps, the probability ceiling, the breaker
     thresholds, and the risk mode are all identical to the previous cycle's,
 AND the only value that changed with performance is the bankroll the percentages apply to
```

```text
GIVEN a replay in which aggressive outperformed the actual mode
THEN the active PaperRiskConfig is unchanged,
 AND no code path reads PaperReplayModeResult outside the review surface
```

```text
GIVEN the source tree
THEN no module writes PaperRiskConfig outside the configuration route handler
```

### 8. Withdrawal and drawdown interaction

```text
GIVEN a settled balance of $1,640 with a $1,000 start and a 1.5× ceiling
THEN a withdrawal of $140 is recorded, active bankroll returns to $1,500,
 AND the high-water mark resets to the post-withdrawal active bankroll,
 AND the withdrawal does not create a drawdown
```

```text
GIVEN a balance that crosses the ceiling twice
THEN the ratchet fires twice and both withdrawals appear in history
```

### 9. Recalibration

```text
GIVEN no live graded observations
THEN the fit equals the backtest record exactly and the correction is stable

GIVEN 5 live observations in a bin
THEN that bin's live weight is 5/205, and the fit remains dominated by the prior

GIVEN backtest bins that are non-monotone
THEN PAVA produces a monotone non-decreasing map, and interpolation never inverts

GIVEN a refit
THEN a new version is written, isActive moves, and no stored correctedProbability
     on any historical candidate changes
```

### 10. Role enforcement and privacy

```text
GIVEN a viewer session
WHEN it requests each of /autonomy, /autonomy/cycles, /autonomy/cycles/[id],
     /autonomy/positions, /autonomy/review, /autonomy/readiness,
     /autonomy/dry-run, /autonomy/configuration, /autonomy/override
THEN each is rejected server-side with 403 and no autonomy chrome is rendered first
```

```text
GIVEN a viewer session
WHEN it POSTs to each /api/autonomy/* route
THEN each returns forbidden and no row is written
```

```text
GIVEN a viewer session
THEN the Autonomy nav item is absent — not disabled, not locked
 AND no shared surface (slate, contract detail, accuracy) reveals a bankroll,
     a position, a risk mode, or a breaker state
```

```text
GIVEN a configuration request whose body carries userId or role
THEN those fields are ignored and the session's identity is recorded
```

```text
GIVEN any response, log line, or PaperCycle.errorMessage
THEN it contains no Kalshi URL, header, key id, key material, or scheduler token
```

### 11. Money path is closed

```text
GIVEN the whole source tree after this feature
THEN the Kalshi client contains none of /orders, /portfolio, /balance, /fills, /positions,
 AND the key pair is reachable from exactly src/env.ts and src/lib/kalshi/client.ts,
 AND no module in src/lib/paper imports the Kalshi client's signing helper,
 AND no route, DTO, or component exists that transitions the system from paper to live
```

```text
GIVEN readiness reports eligible_for_live_trading
THEN no mutation is exposed by the readiness module and no route imports it
```

### 12. Integration scenarios

- A full Sunday: five game windows, one with no candidates, one partially filled, one halted mid-cycle, one skipped at the cutoff, one failed on a Kalshi outage — all six outcomes present, bankroll reconcilable.
- A voided market with an open position: cost basis and fees returned, `realizedPnlCents = 0`, terminal treatment distinct from a loss.
- An `Outcome` supersession after settlement: compensating entries, ledger still append-only, running balance still equal to the cumulative sum.
- A model-version change mid-campaign: the calibration window resets, a new fit is required, and a fresh Dry Run is possible without destroying the paper track record.
- A campaign with one excellent complete week: readiness is `paper_evidence_building`, not eligible.

### 13. Regression tests

- Every existing suite passes unchanged: `jest`, `test:schema`, `prisma:validate`, `pytest`, and the Playwright e2e suite.
- The existing build invariants — one styling system, no stylesheets, colour literals confined, no role from token claims, `force-dynamic` on authenticated routes, admin-route guard list, credential accounting, forbidden-route list — all pass with the new routes added to the appropriate lists.

## 19. Acceptance criteria

### Probability Recalibration

- [ ] The active fit is derived from the stored contract-like backtest calibration record.
- [ ] Raw and corrected probabilities are both stored on every candidate and both rendered.
- [ ] Sizing consumes only the corrected probability; no code path sizes from raw.
- [ ] No price-derived table is reachable from the recalibration module.
- [ ] Live results are shrunk toward the backtest prior; with no live data the fit equals the prior.
- [ ] The fit is versioned; a refit never rewrites a stored corrected probability.
- [ ] Recalibration version and model version are separately visible.

### Risk modes

- [ ] Conservative, Moderate, Aggressive, and Custom are selectable from the admin interface only.
- [ ] Conservative is the default for a new campaign.
- [ ] Conservative permits less exposure than Moderate, which permits less than Aggressive — asserted by a test over the preset constants.
- [ ] The probability ceiling is identical across all preset modes.
- [ ] Aggressive disables no breaker and no cutoff.
- [ ] The active mode is visible on every autonomy surface.
- [ ] A mode change writes a new config row; open positions keep their creating config.

### Position sizing

- [ ] Sizing uses the executable ask, never the midpoint.
- [ ] Fees are applied before a positive stake is permitted.
- [ ] Kelly edge ≤ 0 after fees yields no stake.
- [ ] Lower confidence yields a smaller stake for otherwise identical inputs.
- [ ] Corrected probability above the ceiling yields no stake.
- [ ] Per-game and per-slate caps bind regardless of what Kelly proposes.
- [ ] Allocation is joint over the window and deterministic given identical inputs.
- [ ] Every candidate row records its inputs and exactly one `boundBy` value.

### Bankroll and ledger

- [ ] Starting bankroll is admin-configurable and locked once a fill exists.
- [ ] The ledger is append-only; the running balance equals the cumulative sum of amounts.
- [ ] No live ledger exists and no query can aggregate paper with live.
- [ ] The high-water mark is maintained and reset by a withdrawal.
- [ ] Open exposure renders against both caps with dollar and percentage values.
- [ ] Paper mode is disclosed on every surface.
- [ ] Kalshi settlement governs position accounting; the official line governs model grading.

### Realistic paper fills

- [ ] No fill exceeds the observed top-of-book size, enforced in the database.
- [ ] Partial fills are recorded at the displayed price only.
- [ ] The book is never walked for the remainder.
- [ ] Unavailable depth refuses rather than assuming depth.
- [ ] Unfilled capital returns to available bankroll and is reallocated within the same cycle.
- [ ] Reallocation respects every cap and terminates within three passes.
- [ ] The ledger records the filled position, and the intended stake is retained beside it.

### Duplicate prevention

- [ ] A repeated invocation creates nothing.
- [ ] An unchanged desired total adds nothing.
- [ ] A raised desired total adds only the increment, itself capped.

### Dry Run

- [ ] Dry Run uses the same planner, configuration, recalibration, and fill policy.
- [ ] Dry Run creates no position and writes no ledger entry.
- [ ] A no-opportunity window produces a legitimate empty result.
- [ ] Dry Run reports that a breaker would block.
- [ ] A failed Dry Run states that nothing was written.

### Autonomous execution

- [ ] Cycles run per game window relative to that game's own kickoff.
- [ ] Stale and predates-inactives projections are refused.
- [ ] Missing prices are refused.
- [ ] No position is created inside ten minutes of kickoff, in any mode.
- [ ] A delayed run skips rather than rushing.
- [ ] A zero-position cycle is recorded as successful.
- [ ] A skipped or failed cycle is visible with its reason.

### Circuit breakers

- [ ] Drawdown, calibration, exposure, and kill switch can each halt new positions.
- [ ] 5% warns; 10/15/20% halt per mode.
- [ ] Existing positions continue settling after a trip.
- [ ] Positions created before a mid-cycle trip remain; remaining candidates are blocked.
- [ ] Multiple conditions are simultaneously visible.
- [ ] No breaker recovers automatically.
- [ ] Resume is refused while a condition is breached.
- [ ] Force Override presents condition, measured value, and threshold before enabling, requires per-condition acknowledgement, is recorded permanently, and does not disable the breaker.
- [ ] The kill switch requires no confirmation and creates no data loss.

### Simulated withdrawals

- [ ] The ratchet fires whenever settled balance exceeds the ceiling, repeatedly.
- [ ] Withdrawn funds are tracked separately from active bankroll.
- [ ] A withdrawal creates no artificial drawdown.
- [ ] No real money movement exists anywhere in the codebase.

### Paper review and replay

- [ ] Review is available by game window, week, and campaign.
- [ ] All twelve required review figures render, including fill quality and force overrides.
- [ ] Replay uses stored historical state, changes only the risk configuration, and is saved.
- [ ] Replay results include P&L, drawdown, withdrawals, position count, and breaker activity.
- [ ] Replay writes only to its own tables and never changes the active mode.

### Live readiness

- [ ] Weeks operated are tracked and readiness cannot pass below two complete weeks.
- [ ] Cumulative P&L across those weeks must be positive after fills and fees.
- [ ] Calibration, market-relative, and baseline evidence are separate criteria.
- [ ] Unresolved operational failures and safety behaviour are criteria.
- [ ] Profitability and model-quality evidence are visibly distinct.
- [ ] Unmet categories are explained with measured values.
- [ ] Passing changes a chip and nothing else; no activation control exists.

### Access

- [ ] All nine autonomy routes and all seven mutation routes reject viewers server-side.
- [ ] No shared surface reveals any autonomy state.
- [ ] No viewer bankroll, credential field, or trading affordance exists.

## 20. Explicit non-goals

**Permanent** — sportsbook and DFS integration; public or commercial access; live in-game trading; film or tape-derived inputs; viewers trading through the application or any custody of another person's Kalshi credentials; general sports data browsing; Sightline authorising itself to risk real money.

**Deferred** — real order placement, real fills and reconciliation, the paper→live switch, and the live ledger (Kalshi Trading); real withdrawal recommendation; joint-distribution correlation modelling (Simulation Engine); adjustment suggestions feeding sizing; bankroll and portfolio management as a product, NBA, WNBA, friend pick sharing, additional stat types, additional suggestion sources (Post-MVP). None is precluded by this design: the plan/ledger split, the `Paper`-prefixed table family, and the `boundBy` enum all extend cleanly.

## 21. Resolved decisions

Decisions 1–12 come from the run instruction and carry approved-doc authority; 13–25 were settled in the design doc; 26–40 are settled here. None is left open.

| # | Decision | Rationale |
| - | -------- | --------- |
| 1 | Kelly fractions 0.25 / 0.50 / 0.75, Custom 0–1.0 with a non-blocking warning above 0.75 | Run instruction; standard fractional-Kelly convention against known probability error |
| 2 | Caps 5/15, 8/25, 12/35 percent of **current** active bankroll; Custom 1–50 | Run instruction; caps must scale with the account or become meaningless or punitive |
| 3 | Default starting paper bankroll $1,000, admin-configurable | Run instruction; the pitch's own example |
| 4 | Withdrawal ceiling 1.5× starting bankroll, a repeating ratchet | Run instruction |
| 5 | Opportunity priority ranks by Kelly edge `(b·p − q)/b` on the fee-adjusted price | Run instruction; one number for ranking and sizing so they cannot disagree |
| 6 | Top-of-book-only fills; remainder not chased; absent depth is never inferred | Run instruction; understating is the safe direction of error |
| 7 | Calibration breaker: rolling 100, minimum 30, +0.03 degradation, +0.02 market; model-version change resets the window | Run instruction |
| 8 | Drawdown measured mark-to-market; withdrawal resets the high-water mark | Run instruction |
| 9 | Duplicate identity = (contract, game window, account-local decision date), desired **total** tracked | Run instruction |
| 10 | Risk-mode change applies to new positions only | Run instruction; reinterpreting a live position's rationale would corrupt the audit trail |
| 11 | Force Override is structurally distinct: separate control, per-condition acknowledgement, facts before enabling | Run instruction |
| 12 | No paper↔live switch in this pitch | Run instruction; the switch belongs to Kalshi Trading |
| 13 | Route namespace `/autonomy`, admin-only, one nav section, seven surfaces under a secondary tab row | The `/bankroll` ban guards the deferred V2 product; `/autonomy` names what this is |
| 14 | Readiness uses the pitch's three state names verbatim; eligible is an outlined chip adjacent to no control | Eligibility is a report |
| 15 | Review periods: game window, NFL week, campaign-to-date | Matches the accuracy surface's season/week time vocabulary |
| 16 | Confidence enters sizing by multiplying the Kelly fraction by the existing `CONFIDENCE_WEIGHTS` | Reuse prevents the slate and the bot from disagreeing about confidence |
| 17 | Ledger money is neutral-toned; only its sign takes colour | Mint means "Kalshi told us this"; the paper bankroll is Sightline's own fiction |
| 18 | One `CandidateCard` shared by Cycle detail and Dry Run | A divergence would defeat Dry Run |
| 19 | `boundBy` is a required closed-set field, never blank | The audit trail is the product |
| 20 | Force Override is a route, not a dialog | A control that overrides a halt must not sit beside the one that clears it |
| 21 | Mark-to-market unavailable ⇒ drawdown unavailable, never settled-only | A figure on a different basis than the breaker's would misstate safety |
| 22 | `force_overridden` never ages into `cleared` | The record exists to show the bot wanted to stop |
| 23 | Autonomy `disabled` is neutral on Health, not amber | Health reports failures; being off is a decision |
| 24 | Slate and contract detail untouched — no paper annotation on a shared surface | Leak risk on a viewer-visible screen outweighs the convenience |
| 25 | No reset, clear, or delete control anywhere in the feature | Overwriting paper history is a No-Go |
| 26 | Dry runs and replays live in **separate tables** from cycles, positions, and the ledger | Structural, not disciplinary, separation; a forgotten filter cannot mix them |
| 27 | There is **no paper/live mode column** and no live ledger model in this schema | Makes "paper and live never aggregate" a property of the schema rather than of every query |
| 28 | `AutonomyStatus` is derived on read from switches and active breaches | No status column to desynchronise; consistent with the derived-state posture |
| 29 | `PaperRiskConfig` is append-only; the campaign holds only operational switches and the high-water mark | Satisfies "open positions keep their original limits" in the data, not just the copy |
| 30 | Kalshi general fee `ceil(0.07 · C · P · (1−P))`, taker-only, applied before the edge test and in stake conversion | The published general schedule; paper crosses the spread at the ask, so no maker tier applies |
| 31 | Stake converts to **whole contracts by flooring** | Kalshi trades whole contracts; rounding down is the conservative direction |
| 32 | Mark-to-market uses the **bid** on the held side | What could be realised, not what it would cost to buy again |
| 33 | Both staleness states (`isStale` and `predatesInactives`) refuse a candidate | Autonomous execution must not stake on a projection that admits it predates inactives |
| 34 | Execution window is `kickoff − 6h` to `kickoff − 10min`, at most one cycle per game per 30 minutes | Matches the existing game-day price cadence, so the cycle only runs when prices are already fresh |
| 35 | Missing orderbook depth refuses the candidate rather than defaulting to any size | The single most tempting flattering-fill optimisation, closed at the source |
| 36 | At most three allocation passes; a size-capped candidate is liquidity-exhausted for the cycle | Prevents the partial-fill reallocation loop the pitch names as a rabbit hole |
| 37 | Recalibration method `pava_piecewise_linear/v1` with per-bin shrinkage `K = 200` | Monotone by construction, degenerates to the prior with no live data, no distributional assumption |
| 38 | A campaign with no active recalibration refuses to size, with `boundBy = no_active_recalibration` | Sizing from a raw probability is a No-Go; refusing is the only other option |
| 39 | Mark-to-market unavailable causes the cycle to create nothing (`failed`, `mark_to_market_unavailable`) | Refusing to stake while a safety check cannot run is the conservative direction |
| 40 | New Kalshi client method `getOrderbookTop` — a public market-data GET; the write-endpoint invariant is unchanged | The pitch requires executable liquidity information "without creating a second market client" |
| 41 | A candidate whose better side has flipped away from the open position is **refused**, with `boundBy = opposite_side_held` | A paper position holds one side, so an increment on the other side is not an increment. The only alternatives are closing the existing side to open the new one — the bot trading out of a position on its own initiative, which this pitch does not scope — or letting the executor's guard throw, which aborts the whole cycle run. Refusing leaves the existing position to settle and records why. *(Added during the review audit; see the run report.)* |

## 22. Open questions

None blocking. Three postures inherited from the approved docs are restated here rather than silently re-decided:

1. **Edge against the ask or the midpoint** — this feature sizes and fills against the **ask** unconditionally, per the pitch's Definition of Done ("Position sizing uses executable price rather than midpoint"). The slate's own display question is unchanged by this spec.
2. **Kalshi settlement or the official stat line as grading truth** — unchanged from the Outcome Scoring pitch: settlement governs contract-facing accounting including paper positions; the official line governs model grading. This spec adds no reconciliation.
3. **RLS on user-scoped tables** — still undecided upstream and still not the primary mechanism. These tables are not user-scoped and RLS is deliberately not enabled on them; the decision does not extend here.

## 23. Future considerations

- **Kalshi Trading** adds `Live*` ledger models beside these, reusing `planCycle` unchanged and adding an order-submission step between plan and ledger. The `boundBy` enum extends with real-execution constraints (`order_rejected`, `insufficient_funds`); the paper tables are untouched.
- **The Simulation Engine** replaces the per-game cap's role as the correlation defence with joint outcomes. The plan's cap application is a single function and is where that change lands.
- **Adjustment Suggestions** will produce shadow-adjusted projections; `PaperCycleCandidate.projectionId` already points at whichever projection was priced, so adopting an adjusted projection is a selection change, not a schema change.
- **A second recalibration method** slots in behind `RecalibrationFit.method`, with old fits remaining readable and historical corrected probabilities untouched.
