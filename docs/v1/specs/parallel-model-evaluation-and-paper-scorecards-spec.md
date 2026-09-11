---
version: 1.0.0
status: draft
author: Autonomous Pipeline (Claude)
last_updated: 2026-09-10
pitch_reference: docs/v1/pitches/parallel-model-evaluation-and-paper-scorecards.md
design_reference: docs/v1/design-docs/parallel-model-evaluation-and-paper-scorecards-design-doc.md
ui_reference: docs/v1/ui/parallel-model-evaluation-and-paper-scorecards-ui-preview.html
prd_reference: docs/planning/prd.md
architecture_reference: docs/planning/architecture.md
linear_issue: (milestone: Parallel Model Evaluation & Paper Scorecards)
---

# Parallel Model Evaluation & Paper Scorecards — Technical Spec

## Summary

This feature lets Sightline run both projection engines — the permanent **Baseline** (`baseline-zil-0.1.0`) and the **Simulation Engine** (`simulation-mc-0.1.0`) — against the same live NFL slates simultaneously, grade both, and present a plain-language answer to *which engine should Sightline trust, and why*. The core technical abstraction is that **evaluation is parallel and read-only with respect to production**: the non-active engine runs in *shadow* — it produces a real pre-kickoff projection, it is stored, it is graded through the existing machinery, it drives its own hypothetical paper portfolio — but it never changes what the slate shows or which model any future real-money path would use. There is exactly one place in the entire feature where production configuration changes, and it is a confirmed human save in Paper Bot → Settings.

Two surfaces are reorganised around that abstraction. **Accuracy** becomes **Model Performance** (admin-only) with three levels — Summary (leader, recommendation, scorecards, in plain language), Breakdown (comparisons by stat type / confidence / probability range / live-vs-backtest / financial), and Advanced (the prior Accuracy surface preserved intact for AI and expert diagnosis). **Autonomy** becomes **Paper Bot** (admin-only) with three surfaces — Performance (three portfolio scorecards + readiness), Activity (positions + cycle diagnostics), and Settings (bankroll, risk, model selection) — retiring the Dry Run workflow while keeping its underlying preview function as a test-only utility.

"Working" means: both engines' live projections accumulate and grade separately; the comparison read scores each model's Brier under *its own* fitted recalibration and is structurally incapable of crossing them; repeated pre-kickoff recomputes of one contract count as exactly one live observation per model; three paper portfolios (Baseline, Simulation, and — when a hybrid selection exists — Hybrid) accumulate under identical bankroll and risk assumptions with their own opportunity counts; readiness is always evaluated against the currently-active configuration's own portfolio and its clock resets when the configuration changes; and no computed recommendation, leader, or readiness state ever mutates the active model selection.

## Problem

The system cannot answer several questions today:

- **It cannot compare the two engines on live evidence.** The live pipeline generates only the active model per stat type (`ModelSelection`). Whichever engine is not active stops accumulating comparable live projection history, so Sightline cannot learn how Simulation would have performed on the exact games Baseline was active for, or vice versa.
- **It cannot present model quality in plain language.** The Accuracy surface exposes Brier, calibration bins, reliability curves, and market comparison — valuable to the system and to AI, but William does not perform statistical diagnosis from raw tables. There is no "which model leads, how strong is the evidence, what do you recommend" layer.
- **It cannot compare the engines financially under equal conditions.** There is one `PaperCampaign`; there is no way to run Baseline, Simulation, and a Hybrid configuration as three parallel portfolios starting from the same fake bankroll under the same risk rules.
- **Its operational workflow no longer matches NFL cadence.** Dry Run is a manual pre-cycle inspection gate designed for a fast crypto loop; for football, continuous paper evaluation across real game windows is the useful evidence source, and Dry Run adds ceremony.

This feature closes those gaps. It depends on Pitch 2 (Baseline + Backtesting Harness), Pitch 5 (Live Pipeline & Staleness — pre-kickoff point-in-time projections), Pitch 6 (Outcome Scoring & Accuracy Surface — grading + the surface being simplified), Pitch 7 (Bankroll, Sizing & Autonomous Paper Trading — the paper machinery reused per portfolio), and Pitch 8 (Simulation Engine — the second engine). It unlocks the eventual live-readiness decision that Pitch 12 (Kalshi Live Trading) gates on.

## Scope and non-scope

### In scope

- Parallel live execution of Baseline and Simulation for supported projections; shadow evaluation of the non-active engine; automatic grading of both.
- Separate live model-version records; Historical Backtest vs Live Performance separation, never blended.
- Overall model leader and leader-by-stat-type with evidence-strength / insufficient-evidence states; a plain-language recommendation that never activates itself.
- Human-controlled, per-stat-type model selection (Hybrid configuration); continued shadow evaluation after selection changes.
- Model Performance redesign into Summary → Breakdown → Advanced; probability-range and confidence-level performance summaries; existing detailed statistics retained in Advanced.
- Limited viewer-facing track-record / calibration context on contract detail.
- Three parallel continuous simulated paper portfolios (Baseline, Simulation, Hybrid) under the same starting bankroll and risk assumptions, with per-portfolio opportunity counts; time filtering over the running campaign.
- Paper Bot reorganisation (Performance / Activity / Settings); readiness as a summary state with detail retained.
- Removal of Dry Run as a user-facing feature and gate; removal of Cycles and Review as primary destinations, with underlying records retained.

### Out of scope

- **Kalshi Live Trading**, any real-money mode, real orders, real fills — Pitch 12.
- **What-if Replay / arbitrary bankroll replay.** The period filter windows the running campaign only. The existing risk-mode `PaperReplay` records are retained but Review is not a primary surface; no new replay is built.
- Any automatic promotion, auto-selection, or auto-Hybrid; any code path where a computed recommendation/leader/readiness state writes production configuration (stop-condition-level No-Go).
- Rebuilding the Baseline or Simulation engine, new model training, or changes to Backtesting Harness point-in-time rules.
- Feeding market prices into any Projection Engine.
- Any viewer access to paper bankrolls, model selection, advanced analytics, risk config, or withdrawals; any viewer-specific model configuration or portfolio.
- A composite "model score"; blending Live and Backtest into one metric.

## Core concepts

| Concept | Description |
| ------- | ----------- |
| Shadow evaluation | A projection generated by the non-active engine for a supported game/stat before kickoff. Stored, graded, and drives its own paper portfolio; never the slate's active projection and never a production-config input. |
| `PaperEvaluationCampaign` | **New.** The parent grouping one continuous paper-evaluation campaign: shared starting bankroll, withdrawal ceiling, continuous-evaluation flag, campaign-wide kill switch, campaign start. Owns the three portfolios. |
| `PaperCampaign` (extended) | Now one **portfolio** within an evaluation campaign, discriminated by `portfolio ∈ {baseline, simulation, hybrid}`. Keeps its own bankroll, ledger, cycles, positions, breaches, and high-water mark — the entire existing paper machinery, reused three times. |
| Portfolio | Baseline-only, Simulation-only, or Hybrid. Hybrid exists only when a hybrid selection exists. Each is fed the same eligible windows but may evaluate a different opportunity set (D5). |
| Live observation (comparison) | Exactly one graded prediction per (model, contract) — the latest projection with `computedAt` before the game's kickoff-freeze boundary (D3). Earlier pre-kickoff recomputes are retained as superseded snapshots and excluded from every comparison count. |
| Leader state | One of `simulation_leads`, `baseline_leads`, `too_close_to_call`, `not_enough_evidence` (D14), computed by RD-1: absolute Brier margin ≥ 0.01 with live n ≥ 50 / backtest n ≥ 500 (D1). |
| Recommendation | Derived plain-language text over stored evidence. Decision support only; never mutates `ModelSelection` (D12). |
| Active configuration | The current per-stat `ModelSelection`, interpreted as Baseline-only, Simulation-only, or Hybrid. The readiness gate always evaluates *this* configuration's own portfolio (D2). |
| Recalibration fairness | Each model's Brier/calibration is read under its own `RecalibrationFit`, keyed by `modelVersion`. The read is structurally incapable of scoring one model under another's correction (D4). |

**Distinctions that must be preserved (an agent will collapse these if not told):**

- `computedAt` (when a projection was produced) and `informationCutoff` (what it was allowed to see) are two timestamps. A live observation requires `computedAt` **before** the game's kickoff freeze — a projection computed after the final score is not live evidence (temporal integrity, backfilling form).
- Live Performance and Historical Backtest are two labelled records, never one number.
- Source model of a Hybrid position is fixed at open time and never relabeled by a later selection change (D6).
- Edge remains derived on read; `RecommendationSnapshot` remains stored-for-grading only. This feature adds no denormalised edge or staleness.
- Paper figures and any future live-money ledger are never aggregable.

## States and lifecycle

### Enums

```prisma
enum PaperPortfolio {
  baseline
  simulation
  hybrid
}
```

Reused, unchanged: `RiskMode`, `BreachCondition`, `BreachResolution`, `PaperCycleOutcome`, `CandidateVerdict`, `BindingConstraint`, `PaperPositionStatus`, `PaperLedgerEntryKind`, `Confidence`, `StatType`.

### Leader determination (per record, per population)

| Condition | Resulting state |
| --------- | --------------- |
| sample below floor (live < 50 or backtest < 500) | `not_enough_evidence` |
| sample OK, `abs(brier_baseline − brier_simulation) < 0.01` | `too_close_to_call` |
| sample OK, margin ≥ 0.01, simulation lower Brier | `simulation_leads` |
| sample OK, margin ≥ 0.01, baseline lower Brier | `baseline_leads` |

Overall pools all stat types into one contract-like population before applying the rule; by-stat-type applies it independently within each stat type's own population.

### Model-selection transitions (the only production-config mutation)

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| stat = Baseline | stat = Simulation (or reverse) | admin only, confirmed | `ModelSelection` row updated for that stat; `activeConfigChangedAt` set on the evaluation campaign; the active configuration's portfolio `portfolioStartedAt` reset so the two-week readiness clock restarts (D2); a `PaperControlEvent(kind="config_changed")` recorded. Never triggered by a recommendation/leader/readiness code path. |
| any recommendation/leader/readiness computation | any config write | **never** | Structural: those reads return DTOs only; no write path exists. |

### Portfolio / cycle lifecycle

Unchanged from Pitch 7 per portfolio: a `PaperCycle` runs for a game window, produces `PaperCycleCandidate`s ranked by Kelly edge, fills produce `PaperPosition`s, breaches halt a **single portfolio** (not the whole campaign), kill switch is campaign-wide. Continuous evaluation runs cycles for every eligible window with no per-cycle approval; there is no Dry Run gate.

## UI integration

Full UI/UX in the design doc and UI preview. Technical support:

### Screens

| Screen | Route | Role | Data needed | Actions |
| ------ | ----- | ---- | ----------- | ------- |
| Model Performance — Summary | `/model-performance?level=summary` | admin | overall leader, recommendation text, per-stat leaders, three portfolio scorecards, readiness summary, exclusions | none (read-only); links only |
| Model Performance — Breakdown | `/model-performance?level=breakdown&facet=…` | admin | per-facet comparisons with sample sizes | none |
| Model Performance — Advanced | `/model-performance?level=advanced` | admin | the preserved accuracy panels + two-model reliability overlay | none; Overrides link (admin) |
| Contract detail — track record | `/slate/[contractId]` | **shared** | active model's range interpretation + track-record label, subject to 30-obs floor | none |
| Paper Bot — Performance | `/autonomy` | admin | three portfolio scorecards, per-portfolio breach state, bankroll history (3 series), readiness summary + detail | Kill / Resume / Force override (per portfolio) |
| Paper Bot — Activity | `/autonomy/activity` | admin | positions (with portfolio + model attribution), cycles diagnostics | none; cycle detail navigation |
| Paper Bot — Settings | `/autonomy/settings` | admin | current `ModelSelection`, recommendations, risk config, bankroll, continuous-eval flag | Save selection (confirmed); Save configuration; toggle continuous eval |

### Route renames and redirects

- `/accuracy` → 308 → `/model-performance` (carry `?level=advanced` when the legacy deep link targeted a statistical panel). `/accuracy/overrides` → `/model-performance/overrides`.
- `/autonomy/{cycles,positions}` → 308 → `/autonomy/activity`; `/autonomy/{review,readiness,configuration}` → `/autonomy` (Performance) or `/autonomy/settings` as appropriate.
- `/autonomy/dry-run` → removed; redirect to `/autonomy`.

### Material UI integration

- Model Performance level tabs and Paper Bot section tabs use MUI `Tabs` (secondary row). Record/facet/period selectors use `ToggleButtonGroup` / `Select`, deep-linked via query params.
- The two-model reliability overlay reuses `ReliabilityCurve` (Recharts, theme-fed) extended to two series (Baseline dashed, Simulation solid), each labelled with its version and correction; the bucket table remains its text equivalent.
- `PortfolioScorecard`, `LeaderChip`, `EvidenceChip`, `ModelSelectionTable`, `ModelTrackRecordBlock` are new; `BankrollChart` extends to three series; `PositionsTable`/`CyclesTable`/`CandidateCard` gain a portfolio column + model attribution. Money renders neutral; only P&L sign takes colour.
- Save-selection is a confirmed action (MUI `Dialog`) restating outgoing/incoming model and the readiness-reset consequence. No "apply recommendation" control exists anywhere.

## Data model

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `PaperEvaluationCampaign` | has many | `PaperCampaign` | The three portfolios of one campaign |
| `PaperCampaign` | belongs to | `PaperEvaluationCampaign` | Portfolio within a campaign; discriminated by `portfolio` |
| `PaperCampaign` | has many | `PaperCycle`, `PaperPosition`, `PaperLedgerEntry`, `PaperBreach`, `PaperRiskConfig` | Existing relations, now per portfolio |
| `PaperCycle` | references | `Projection` (via candidate) | Whose `modelVersion` attributes the shadow/active engine |
| `ModelSelection` | keyed by | `StatType` | The active configuration read at decision time and by readiness |
| `RecalibrationFit` | keyed by | `modelVersion` | Each model's own correction — the fairness anchor (D4) |

### New model — `PaperEvaluationCampaign`

```prisma
/// The parent of one continuous paper-evaluation campaign. Shared configuration
/// and campaign-wide switches live here; each PaperCampaign child is one portfolio
/// (baseline / simulation / hybrid) with its own bankroll, ledger, and history.
model PaperEvaluationCampaign {
  id                        String  @id @default(uuid())
  label                     String?
  startingBankrollCents     Int     @map("starting_bankroll_cents")
  withdrawalCeilingMultiple Decimal @map("withdrawal_ceiling_multiple") @db.Decimal(4, 2)
  continuousEvaluationEnabled Boolean @default(false) @map("continuous_evaluation_enabled")

  // Campaign-wide human halt. A breach halts a single portfolio; the kill switch
  // stops new positions across all portfolios.
  killSwitchEngaged Boolean @default(false) @map("kill_switch_engaged")

  campaignStartedAt DateTime  @map("campaign_started_at")
  // Set whenever the active per-stat model selection changes. Reads the readiness
  // clock off the affected portfolio's portfolioStartedAt (D2), not off this field
  // directly; kept for audit and display of "configuration last changed".
  activeConfigChangedAt DateTime? @map("active_config_changed_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  portfolios PaperCampaign[]

  @@map("paper_evaluation_campaigns")
}
```

### Updated model — `PaperCampaign`

Only new/changed fields shown. `killSwitchEngaged` moves to the parent (a per-portfolio kill was never a product requirement); `startingBankrollCents` stays for the per-portfolio opening balance (identical across portfolios by construction) and to keep the historical record self-describing.

```prisma
model PaperCampaign {
  // ... existing fields (startingBankrollCents, highWaterMarkCents, highWaterMarkAt,
  //     startedAt, autonomyEnabled, timestamps, and all existing relations) ...

  evaluationCampaignId String        @map("evaluation_campaign_id")
  portfolio            PaperPortfolio

  // The readiness clock anchor for THIS portfolio. Set at portfolio creation and
  // RESET whenever this portfolio becomes the newly-active configuration (D2).
  portfolioStartedAt DateTime @map("portfolio_started_at")

  evaluationCampaign PaperEvaluationCampaign @relation(fields: [evaluationCampaignId], references: [id])

  @@unique([evaluationCampaignId, portfolio])
  @@index([evaluationCampaignId])
  // ... existing @@map("paper_campaigns") ...
}
```

`killSwitchEngaged` is removed from `PaperCampaign` (moved to the parent). Reads that referenced it now read the parent's flag.

### Updated model — `PaperPosition` and `PaperCycleCandidate` (Hybrid attribution)

```prisma
model PaperPosition {
  // ... existing fields ...
  // The model version that produced the driving probability for THIS position.
  // Set at open time and never rewritten. For baseline/simulation portfolios this
  // equals the portfolio's engine; for the hybrid portfolio it records which engine
  // was selected for the stat at decision time (D6).
  sourceModelVersion String @map("source_model_version")
}

model PaperCycleCandidate {
  // ... existing fields (already carries projectionId) ...
  // Denormalised for the hybrid audit trail so a later selection change cannot alter
  // how a historical candidate reads. Equals projection.modelVersion at cycle time.
  sourceModelVersion String? @map("source_model_version")
}
```

### Removed model — `PaperDryRun`

`PaperDryRun` (table `paper_dry_runs`) is dropped. It holds only inspection records that write no bankroll state and are referenced by no financial, review, or readiness read, so the drop loses no irreplaceable data (it is not `Decision` or `Position`). This is a destructive schema change named explicitly in the migration section and covered by the pitch's Dry Run retirement. Its relation edges on `PaperCampaign`, `PaperRiskConfig`, `RecalibrationFit`, `Game`, and `User` are removed.

### Migration plan

1. Create `paper_evaluation_campaigns` and `PaperPortfolio` enum.
2. Add `evaluation_campaign_id`, `portfolio`, `portfolio_started_at` to `paper_campaigns` (nullable in the additive migration).
3. **Backfill:** for any existing `PaperCampaign`, create one `PaperEvaluationCampaign` (copying `startingBankrollCents`, withdrawal multiple from the active `PaperRiskConfig`, `killSwitchEngaged`, `startedAt` → `campaignStartedAt`), set the existing campaign's `evaluation_campaign_id` to it, `portfolio` to the portfolio matching the currently-active configuration (Baseline-only or Simulation-only per the dominant `ModelSelection`; default `baseline` if ambiguous), and `portfolio_started_at = startedAt`. Create the sibling portfolio rows (empty bankroll history) so both engines begin accumulating; create `hybrid` only if a mixed `ModelSelection` exists. See the runbook for operating this on the dev/prod campaign.
4. Make `evaluation_campaign_id`, `portfolio`, `portfolio_started_at` non-nullable; add the `@@unique`.
5. Move `kill_switch_engaged` to the parent (backfill from the existing campaign, then drop the column).
6. Add `source_model_version` to `paper_positions` (non-null; backfill from each position's cycle candidate's `projection.modelVersion`) and `paper_cycle_candidates` (nullable).
7. Drop `paper_dry_runs` and its FKs.

Migrations originate from Prisma (single source of schema truth). The Python runtime reads these tables but never migrates.

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Leader state (overall / per stat) | no | model Briers per record+population under each model's own fit | Computed on read (D1/D4). No column. |
| Recommendation text | no | leader states + evidence strengths | Derived; never persisted as config. |
| Live observation set | no | graded projections deduped to latest pre-kickoff per (model, contract) | Computed on read (D3). |
| Track-record label / range rate | no | graded live+backtest evidence, 30-obs floor | Computed on read (D8). |
| Portfolio P&L / return / drawdown / total value | no | ledger + positions (existing derivation) | Per portfolio; unchanged posture. |
| Opportunity counts (evaluated / sized) | no | `PaperCycle.candidatesEvaluated` / `candidatesSized` aggregated per portfolio | Displayed with every scorecard (D5). |
| Readiness state | no | active configuration's portfolio, weeks since `portfolioStartedAt` | Re-evaluated on read (D2). |

## Authorization and access control

Two roles; not multi-tenancy. Projections, prices, leaders, recommendations, and calibration are identical for every user; only `Decision` and `Position` are user-scoped and are unaffected here.

- **Model Performance (all three levels) and Paper Bot (all three surfaces) are admin-only**, enforced server-side with `requireAdmin()` in the server component and every route handler — a viewer receives a 403 rendered in place, never a partial shell. This matches the current `/accuracy` and `/autonomy` gates. The nav items are absent for viewers, not disabled.
- **The contract-detail track-record block is the only model-quality surface a viewer sees.** It is served by a role-selected serializer that exposes only the active model's range interpretation and a strong/moderate/limited label — no leader comparison, no shadow figure, no bankroll, no admin link.
- **The only production-config mutation** (model selection) is an admin route handler with `requireAdmin()`, a confirmed body, and no acceptance of a client-supplied role or user identifier.
- No route handler uses the Python service-role credential. The Python runtime bypasses RLS by design and never serves a request.

```typescript
// /api/model-selection — the ONLY production-config mutation in this feature.
export async function POST(req: Request) {
  const session = await requireSession();
  if (session.user.role !== "admin") return jsonError("forbidden", 403);
  const body = modelSelectionInputSchema.parse(await req.json()); // { statType, modelVersion }
  // No leader/recommendation value is read here; the human's explicit choice is the input.
  const result = await applyModelSelection({
    statType: body.statType,
    modelVersion: body.modelVersion,
    actorUserId: session.user.id, // from session, never the body
  });
  return Response.json(toModelSelectionDto(result), { status: 200 });
}
```

## Route handlers and API surface

Reads happen in server components through Prisma. New/changed route handlers:

| Method + path | Input | Output | Side effects |
| ------------- | ----- | ------ | ------------ |
| `POST /api/model-selection` | `{ statType, modelVersion }` | `ModelSelectionDto` | Updates `ModelSelection`; resets the active portfolio's `portfolioStartedAt`; sets `activeConfigChangedAt`; records `PaperControlEvent`. Confirmed, admin-only. |
| `PUT /api/paper/evaluation-campaign` | `{ startingBankrollCents?, withdrawalCeilingMultiple?, continuousEvaluationEnabled? }` | `EvaluationCampaignDto` | Campaign config; starting bankroll locked once any position fills. |
| `POST /api/paper/kill` / `POST /api/paper/resume` / `POST /api/paper/override` | existing shapes, now scoped: kill is campaign-wide; resume/override take a `portfolio` | existing DTOs | Unchanged semantics per Pitch 7, scoped per portfolio for resume/override. |
| (removed) `POST /api/autonomy/dry-run` | — | — | Deleted. |

Reads (server components, no route): `readModelPerformance(scope)`, `readPortfolioScorecards(evaluationCampaignId, period)`, `readReadiness(evaluationCampaignId)`, `readContractTrackRecord(contractId, role)`.

Error responses follow `references/api-conventions.md`. No endpoint returns anything derived from the Kalshi signing key or a service-role identifier.

## Validation rules

| Input | Validation | Error code |
| ----- | ---------- | ---------- |
| `modelSelection.modelVersion` | must be a known model version that supports `statType`; Simulation rejected where unsupported | `invalid_model_for_stat` |
| `modelSelection` save | must be a confirmed request (idempotency key), admin session | `confirmation_required` / `forbidden` |
| `startingBankrollCents` | > 0; **rejected once any position has filled** (locked) | `bankroll_locked` |
| `withdrawalCeilingMultiple` | ≥ 1.0 | `invalid_withdrawal_ceiling` |
| any comparison read | must resolve each model's own `RecalibrationFit`; a request that cannot is an error, never a silent fallback to another model's fit | `recalibration_unavailable` |
| bucket-rate display | render numeric rate only at ≥ 30 observations; else the insufficient-evidence state | (not an error; a display rule) |

- **Warn, don't block** where a state is legitimate: a stat with `not_enough_evidence`, a bucket below 30, a portfolio with a different opportunity set, an offseason with no cycles.
- **Block** on: any attempt to write production config from a non-selection path; a live observation whose `computedAt` is not before its game's kickoff freeze; a starting-bankroll change after positions exist; a comparison read that would cross model/correction.
- Never leak Prisma error text, storage paths, or Kalshi key material.

## UI data contracts

```typescript
export type LeaderState =
  | "simulation_leads" | "baseline_leads" | "too_close_to_call" | "not_enough_evidence";
export type EvidenceStrength = "strong" | "moderate" | "limited";
export type EvidenceRecord = "live" | "backtest";

export type ModelComparisonDto = {
  record: EvidenceRecord;
  population: "contract_like" | "all" | "market_linked";
  leader: LeaderState;
  baselineBrier: number | null;
  simulationBrier: number | null;
  brierMargin: number | null;          // abs(baseline − simulation); null if a side is empty
  baselineModelVersion: string;
  simulationModelVersion: string;
  liveObservations: number;            // deduped per (model, contract) — D3
  backtestObservations: number;
  evidence: EvidenceStrength;
};

export type StatLeaderRowDto = {
  statType: StatType;
  leader: LeaderState;
  brierMargin: number | null;
  sampleSize: number;                  // for the selected record
  evidence: EvidenceStrength;
  belowFloor: boolean;                 // sample under the applicable minimum
};

export type PortfolioScorecardDto = {
  portfolio: "baseline" | "simulation" | "hybrid";
  startingBankrollCents: number;
  activeBankrollCents: number | null;  // null = mark-to-market unavailable (degraded)
  withdrawnCents: number;
  totalValueCents: number | null;
  netPnlCents: number | null;
  returnPct: number | null;
  maxDrawdownBps: number | null;       // null when active bankroll unavailable
  candidatesEvaluated: number;         // D5
  candidatesSized: number;             // D5
  positionCount: number;
  riskMode: "conservative" | "moderate" | "aggressive" | "custom";
  breakerEventCount: number;
};

export type ReadinessSummaryDto = {
  state: "not_ready" | "paper_evidence_building" | "eligible_for_live_trading";
  activeConfigurationPortfolio: "baseline" | "simulation" | "hybrid";
  weeksComplete: number;               // against the active config's OWN portfolio
  weeksRequired: 2;
  paperResultPositive: boolean;
  modelQualityHealthy: boolean;
  operationalHealthy: boolean;
  // Detail rows retained (D21); never auto-enables live trading.
};

export type ContractTrackRecordDto = {
  modelProbability: number;
  confidence: Confidence;
  // Range interpretation — null contents below the 30-obs floor (D8).
  rangeLabel: string;                  // e.g. "70–80%"
  rangeObservedRate: number | null;    // null → below floor
  rangeSampleSize: number;
  trackRecord: EvidenceStrength;       // strong / moderate / limited
  belowFloor: boolean;
  // No leader, no shadow figure, no bankroll — viewer-safe.
};
```

- `activeBankrollCents === null` (mark-to-market unavailable) is distinct from `0`; drawdown then reports null rather than a settled-only basis.
- `rangeObservedRate === null` (below floor) is distinct from a real `0` rate.
- Field names are identical across surfaces (`netPnlCents`, `brierMargin`, `liveObservations` mean the same everywhere).

## Testing strategy

GIVEN/WHEN/THEN, organised by area. Categories: happy path; validation; state transitions; side effects; security/privacy; edge cases; invariant; integration; regression.

### Priority 1 — Temporal leakage (adversarial, first)

- GIVEN a game whose final score is known, WHEN a Simulation projection is computed after kickoff, THEN it is never counted as a live observation for the comparison — the live read excludes any projection with `computedAt` ≥ the game's kickoff freeze. (Backfilling form of the invariant.)
- GIVEN five pre-kickoff recomputes of one contract for one model, WHEN the live comparison sample is counted, THEN exactly one observation is counted, and it is the latest `computedAt` before the freeze (D3); the four earlier snapshots are retained and excluded.

### Priority 2 — Prices never feed projections / recalibration fairness

- Import-graph assertion: no module in the model-eval comparison read imports `PriceObservation`/`RecommendationSnapshot` into projection computation (existing invariant holds).
- **Structural fairness (D4):** the comparison read API takes a `modelVersion` and resolves that model's own `RecalibrationFit`. A test proves there is no parameter, overload, or code path that scores Baseline's projections under Simulation's fit (or the reverse) — attempting to do so is a type/graph impossibility, not a runtime guard.

### Priority 3 — Grading and idempotence

- Both engines' stored projections reach graded / explicitly unresolvable states through the existing grading machinery.
- Baseline keeps accruing live evidence after Simulation becomes active for a stat, and Simulation keeps accruing while Baseline is active — neither engine's collection stops on losing/never-having active status.
- Re-running grading over a processed period is idempotent; a stat correction re-grades affected records.

### Priority 4 — Contract-to-player resolution

- A shadow projection for an unresolved contract is retained and surfaced, never silently dropped, exactly as the active projection is.

### Priority 5 — Portfolio / readiness / attribution (feature invariants)

- **Readiness reset (D2):** GIVEN Simulation-only active with 1 complete week, WHEN the active configuration switches to Hybrid, THEN readiness evaluates Hybrid's own portfolio and the two-week clock restarts from the switch (`portfolioStartedAt`); Simulation's accumulated weeks do not transfer.
- **Hybrid attribution (D6):** GIVEN a Hybrid position opened while receiving-yards = Simulation, WHEN the selection later changes to Baseline, THEN the position's `sourceModelVersion` still reads Simulation.
- **Opportunity counts (D5):** each scorecard renders `candidatesEvaluated` and `candidatesSized`; a test asserts they are present and per-portfolio.
- **No auto-switch (stop-condition invariant):** a test asserts no recommendation/leader/readiness code path can write `ModelSelection`, the hybrid config, or a risk setting; the only writer is the confirmed selection route.
- **Bucket floor (D8):** no probability-bucket rate renders below 30 observations on any surface — admin Breakdown/Advanced or the viewer block; below floor renders the insufficient-evidence state.

### Priority 6 — Role enforcement

- A viewer deep-linking to `/model-performance` (all levels), `/model-performance/overrides`, `/autonomy`, `/autonomy/activity`, `/autonomy/settings` is rejected server-side (403), no shell first.
- The contract-detail track-record block on a viewer payload contains no leader, shadow, bankroll, or admin link.

### Dry Run retirement

- The `/autonomy/dry-run` route and its nav entry are unreachable (404/redirect) and absent from navigation, WHILE the underlying preview function (`runDryRun`/`planCycle`) remains callable from the test suite — proving the workflow was removed, not the capability, and it was not renamed "Preview" with the gate kept (D7).

## Acceptance criteria

### Parallel model evaluation
- [ ] Baseline and Simulation both generate live projections for the same supported game/stat; both retain distinct model identity; running shadow changes neither the active production model nor the slate.
- [ ] Both engines' live projections reach graded/unresolvable states; a stat remains evaluable for both after one becomes active; changing the active model does not stop the former active model accruing shadow evidence; missing Simulation support for a stat does not block Baseline.

### Live vs backtest
- [ ] Live and Backtest evidence are separately labelled and never blended into one count or score; live counts include only pre-kickoff projections; small live samples render as limited evidence.

### Comparison & recommendation
- [ ] Overall leader and per-stat leader render per D1/D14 with margin + sample size; `too_close_to_call` and `not_enough_evidence` render honestly; a plain-language recommendation renders and never activates itself.
- [ ] Each model's Brier/calibration is read under its own recalibration; crossing is structurally impossible (D4).

### Hybrid & selection
- [ ] Per-stat model selection is human-only, confirmed, visible; changing one stat never changes another; a Hybrid position retains its originating model permanently (D6); switching resets the readiness clock against the newly-active portfolio (D2).

### Model Performance surface
- [ ] Summary is legible without reading a curve; Advanced preserves Brier, reliability, bins, error, market comparison, model-version detail; probability-range and confidence performance render with sample sizes and the ≥30 floor (D8); confidence and probability are lexically distinct (D16).

### Paper portfolios
- [ ] Baseline, Simulation, and (when a hybrid selection exists) Hybrid accumulate under the same starting bankroll and risk config; each scorecard shows start/active/withdrawn/total/P&L/return/maxDD/positions plus opportunity counts (D5); no manual Dry Run required; a profitable short period is not presented as conclusive model-quality proof (D17).

### Viewer trust
- [ ] A viewer sees a concise track record and a sample-size-aware range interpretation on a contract, derived from the graded model record, with no admin controls, comparison, or bankroll; insufficient samples are described honestly.

### Simplified admin & readiness & Dry Run
- [ ] Dry Run is not a user-facing feature or gate; Cycles/Review are not primary destinations but their records remain; readiness is a summary state with detail retained and never auto-enables live trading; the internal preview function remains test-callable.

## Explicit non-goals

**Permanent (Brief):** sportsbook/DFS integration; public/commercial access; live in-game trading; film/tape inputs; viewers trading through Sightline or their credentials stored; general sports-data browsing; Sightline authorising its own production-config or real-money changes.

**Deferred (PRD Post-MVP):** Kalshi Live Trading (Pitch 12); What-if Replay / arbitrary bankroll replay; bankroll/portfolio management as a product; NBA/WNBA; friend pick sharing; additional stat types; additional suggestion sources. Build none; preclude none.

## Open questions

1. **Edge: ask vs midpoint** (inherited). Unchanged by this feature; portfolios inherit the Pitch 7 sizing basis. Default: as configured today.
2. **Grading truth: Kalshi settlement vs official stat line** (inherited). Model comparison grades against the official line via existing grading; paper P&L settles against Kalshi. Both retained separately.
3. **Superseded model-version calibration** (inherited). Advanced defaults to the deployed version; the two-model overlay labels each series' version. Default per the accuracy surface's decision.
4. **RLS on user-scoped tables** (inherited). Not required by this feature; unchanged.
5. **50-observation live-evidence minimum (D1)** — *flag for human review.* Not specified upstream; chosen because live evidence accrues one NFL week at a time and a 500-obs live minimum would be unreachable in-season. Default adopted; recorded in the run report for explicit human sign-off.
6. **30-observation bucket-display floor (D8)** — *flag for human review.* Reuses the calibration circuit-breaker minimum for a fourth surface rather than picking a new number. Default adopted; recorded in the run report.

## Resolved Decisions

D1–D8 cite the run instruction as approved-doc authority; D9–D22 are resolved in the design doc.

- **D1** — Leader requires abs Brier margin ≥ 0.01 (Simulation-Engine promotion bar) in the relevant population; live sample floor 50, backtest floor 500; else too_close_to_call / not_enough_evidence. Overall pools contract-like; by-stat per stat.
- **D2** — Readiness evaluates the currently-active configuration's own portfolio; two-week clock; switching resets the clock (via `portfolioStartedAt`); prior evidence does not transfer.
- **D3** — One live observation per (model, contract): the latest projection before the kickoff freeze; earlier recomputes retained but excluded.
- **D4** — Every comparison reads each model's Brier/calibration under its own `RecalibrationFit` keyed by `modelVersion`; crossing is structurally impossible.
- **D5** — Every scorecard shows candidates evaluated + sized alongside P&L/return/drawdown; portfolios may differ in opportunity set.
- **D6** — Hybrid sources per-stat probability from the current selection going forward; an opened position retains its originating model permanently (`sourceModelVersion`).
- **D7** — Dry Run route/nav/prerequisite removed; underlying preview function retained as a non-navigable test/diagnostic utility; not renamed "Preview" with the gate kept.
- **D8** — 30-observation floor for any probability-bucket rate (admin + viewer); below → honest insufficient-evidence state.
- **D9** — Accuracy → Model Performance, admin-only, three levels (`?level=`); `/accuracy` 308-redirects; Advanced preserves the accuracy surface.
- **D10** — Autonomy → Paper Bot, admin-only, three surfaces (`/autonomy`, `/autonomy/activity`, `/autonomy/settings`); legacy routes redirect; `/autonomy/dry-run` removed.
- **D11** — Three portfolios render as three equal columns, never merged, never a bankroll figure without opportunity counts; Hybrid absent when no hybrid selection.
- **D12** — Every recommendation/leader/readiness surface is read-only w.r.t. production config; no "apply recommendation" control anywhere.
- **D13** — Model selection lives in Paper Bot → Settings, per stat, human-only, confirmed; the only production-config mutation.
- **D14** — Four leader states as one closed vocabulary; every non-`not_enough_evidence` state carries margin + counts.
- **D15** — Live and Backtest are two labelled records; never blended.
- **D16** — Confidence uses words (low/medium/high); probability uses percentages; never adjacent without a distinguishing label.
- **D17** — Paper P&L never the headline of model quality; the standing separation sentence renders alongside financial results.
- **D18** — Viewers receive only the contract track-record block; no other model-quality surface.
- **D19** — Money is neutral-toned; only its sign takes colour; model figures wear the model accent, market figures wear mint.
- **D20** — Every paper figure says "paper", permanently; paper and any future live ledger never aggregable.
- **D21** — Readiness is a summary state with expandable criterion detail; nothing safety-relevant deleted.
- **D22** — Shadow evaluation is invisible on shared surfaces; admin comparison figures are labelled by model version so active vs shadow output is unambiguous.

## Future considerations

- The three-portfolio structure and per-portfolio readiness clock are what Pitch 12 (Kalshi Live Trading) will gate on; the live counterpart ledger sits beside the paper ledgers without merging.
- The comparison read (leader + recommendation) is the evidence layer a future human "promote model" action would consult — but the promotion remains a human act in Settings, never a computed write.
- What-if Replay, if ever built, extends the retained `PaperReplay` machinery; this feature deliberately does not preclude it but adds nothing toward it.
