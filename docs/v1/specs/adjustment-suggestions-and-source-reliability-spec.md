---
version: 1.0.0
status: draft
author: autonomous-pipeline
last_updated: 2026-09-09
pitch_reference: docs/v1/pitches/adjustment-suggestions-and-source-reliability.md
design_reference: docs/v1/design-docs/adjustment-suggestions-and-source-reliability-design-doc.md
ui_reference: docs/v1/ui/adjustment-suggestions-and-source-reliability-ui-preview.html
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: (milestone: Adjustment Suggestions & Source Reliability)
---

# Adjustment Suggestions & Source Reliability — Technical Spec

## 1. Summary

This feature lets an unproven external feed — ESPN inactives — influence what William sees and what the paper bot trades, **without ever letting the feed do so automatically**. The core abstraction is that **a suggestion is a proposal, and the projection it proposes is a real, stored, graded projection that is not active until William says so.** ESPN reports a player inactive; Sightline re-runs the affected game's simulation with that player marked unavailable, stores the result as a *shadow projection* (a `Projection` row discriminated as `adjustment_shadow`), and raises a suggestion describing the base→proposed change. Accepting makes the shadow the active projection; declining leaves the base active. Both the base and the shadow are graded through the **existing** Python grading job regardless of what William chose.

Two independent questions are answered by two independent figures. **Source Accuracy** grades the ESPN *claim* ("was this player actually inactive?") against official participation data — never against Kalshi settlement. **Adjustment Accuracy** grades whether reacting *improved the projection*, by comparing the base and shadow grades against the official stat line. They share no denominator, are never combined, and each is withheld as a numeric rate below its own minimum sample.

"Working" means: an ESPN report never mutates a projection on its own; a pending material suggestion blocks autonomous trading of exactly the affected player's contracts (reusing the stale-projection refusal path) and nothing else; a suggestion after kickoff never edits the frozen pre-game record; base and shadow are both queryable and gradable forever; and the two reliability figures can never be read as one number.

## 2. Problem

Sightline cannot yet react to late information. The projection layer is only as current as its `informationCutoff`; when ESPN reports an inactive twenty minutes before kickoff, the slate keeps showing projections that assume the player plays, and the paper bot keeps trading them. The staleness layer (Pitch 5) can only mark a game as *predates-inactives* — it has no source to clear that state and no mechanism to react.

The system also cannot answer whether ESPN is trustworthy. Nothing grades a source claim, and nothing grades an adjustment that was declined, so there is no accumulating evidence to decide — later, deliberately — whether the feed has earned more trust. And because a correct claim followed by a bad workload redistribution looks identical to a wrong claim if the two are measured together, the system must separate source correctness from adjustment quality from the first row of data, or the distinction is unrecoverable.

This pitch unlocks controlled reactivity for the paper bot (Pitch 7 consumes accepted projections) and builds the reliability evidence that a future automatic-trust pitch would require. It depends on the Simulation Engine (Pitch 8) for usage redistribution and its evidence floor, on Outcome Scoring (Pitch 6) for grading, and on Live Pipeline & Staleness (Pitch 5) for the honest-stale fallback when ESPN is down.

## 3. Scope and non-scope

### In scope

- A general **Adjustment Suggestions** mechanism: source claim → proposed change to a projection → accept/decline → shadow projection, source-agnostic in shape.
- **ESPN inactives** as the first and only source, ingested as an **optional** dataset (its outage never fails the cycle).
- Shadow projection computation via the Simulation Engine with an availability override, honoring the as-of cutoff and the evidence floor.
- Materiality gating (decision 5), dedup/reversal/conflict state machine (decision 3), post-kickoff freeze (decision 4), insufficient-evidence hold (decision 6).
- Grading both base and shadow through the existing grade job; grading source claims against official participation.
- Accept/decline route handlers (admin-only), the Suggestions section (Pending / History / Reliability), the slate pending marker, and the shared accepted-adjustment reason line.
- Reusing the autonomous-cycle refusal path to block the affected player's contracts on a pending material suggestion (decision 1), tagged `pending_suggestion`.
- Annotating an existing paper position when the projection changes after entry (decision 8); **no** auto-exit.
- Source Accuracy and Adjustment Accuracy as two independent, sample-gated figures (decisions 9, 10).

### Out of scope

- Any automatic-trust path, toggle, or config flag — **not built, not even disabled** (decision 2).
- Automated position exit/offset/reduction — **not built, not even behind a flag** (decision 8).
- Additional suggestion sources (depth chart, limited snaps, healthy scratches, weather, news/social). Deferred; the mechanism must accept them without redesign.
- Redesign of the Simulation Engine, Probability Recalibration, risk modes, sizing, or circuit breakers.
- The later Baseline-vs-Simulation dual-engine shadow evaluation.
- Any use of Kalshi price movement as a status signal; any Kalshi price entering the model path.
- Real Kalshi order execution (Pitch 11).

## 4. Core concepts

| Concept | Description |
| ------- | ----------- |
| `AdjustmentSourceEvent` | The **claim** an external source made about one player: identity `(source, subjectPlayerId, claimType)`. Bitemporal (`validAt`/`knownAt`). Carries the current claim value, lifecycle status, and — after the game — a source-correctness outcome. This is the dedup / reversal / conflict identity and the **Source Accuracy** grading target. *(New entity; see RD-AS-1 and the architecture amendment in §17.)* |
| `AdjustmentSuggestion` | A proposed change to **one** target projection produced by a source event — the architecture's named entity. Carries the base projection, the shadow projection (nullable), status, materiality, and human-readable evidence/reason. The **Adjustment Accuracy** grading unit. One source event may produce several (one per materially-affected teammate). |
| shadow projection | The adjusted projection, stored as a `Projection` row with `provenance = adjustment_shadow` and `adjustmentSuggestionId` set. A **real, durable, gradable** projection — never a browser preview. |
| base projection | The pre-existing `Projection` (`provenance = base`). Never destroyed, overwritten, or hidden by a suggestion. Remains queryable and gradable after acceptance. |
| active projection | What the slate, edge, recommendation, and cycle read for a `(player, game, statType)`: the accepted shadow if a suggestion for that key is `accepted`, otherwise the freshest **base** projection. A stored shadow is **never** active merely by existing. |
| materiality | Whether a suggestion is worth raising: ≥ 3 pp threshold-probability shift on ≥ 1 listed contract, or (no listed contract) ≥ 10% relative shift to `projectedValue` (decision 5). |
| Source Accuracy | Per source: of the source's *verifiable* claims, how many were factually correct, graded against `PlayerGameContext.participation_status`. Sample-gated at 15. |
| Adjustment Accuracy | Per source: of the *gradable* impacts (base and shadow both graded), how many the shadow improved over the base against the official stat line. Sample-gated at 15, independently. |
| `pending_suggestion` | A new `BindingConstraint` value: the autonomous cycle refused this contract because its player has a pending material suggestion. Distinct from `stale_projection`, same refusal path. |

**Invariants the spec must preserve:**

- `computedAt` ≠ `informationCutoff`. A shadow computed at 11:40a against an ESPN report known at 11:38a has `computedAt = 11:40a`, `informationCutoff = 11:38a`.
- `validAt` ≠ `knownAt` on `AdjustmentSourceEvent`. The claim is valid *of the game* and became known when ESPN published it.
- Base and shadow are two rows, both graded. Neither is derived from William's choice.
- Source Accuracy and Adjustment Accuracy are two figures, never one.
- The Python runtime never reads `PriceObservation` or `RecommendationSnapshot`. Materiality uses `Contract.threshold` (application data, not price) plus the two projections' own distributions.

## 5. States and lifecycle

### Enums

```prisma
/// Lifecycle of a source claim under the (source, subjectPlayer, claimType)
/// dedup identity.
enum SourceEventStatus {
  active        // the current confirmed claim; may have open suggestions
  superseded    // replaced by a newer confirmed value on the same identity
  conflicting   // two contradictory unconfirmed values within the conflict window
  post_kickoff  // arrived after actual kickoff; retained, source-graded, non-actionable
}

/// Whether the source's factual claim proved correct. Graded against official
/// participation, never Kalshi settlement. `unverifiable` when participation is
/// unavailable — never fabricated as correct.
enum SourceClaimOutcome {
  correct
  incorrect
  unverifiable
}

/// A per-projection proposed change.
enum SuggestionStatus {
  pending                // awaiting William; blocks the affected player's contracts
  accepted               // shadow is the active projection
  declined               // base remains active; shadow still graded
  insufficient_evidence  // model cannot defensibly estimate; no shadow; contract held
  superseded             // its source event was superseded; retained as history
}
```

`Confidence` (`high|medium|low`), `StatType`, `DataSource` (already carries `espn`), and `ProjectionDeclineReason` (`insufficient_evidence`) are reused unchanged. `claimType` and `claimValue` are **validated strings** (open sets that grow without a migration): `claimType = "game_status"`, `claimValue ∈ {"out","doubtful","questionable","active"}` for this pitch.

### Source event transitions (dedup / reversal / conflict — decision 3)

A new source observation on identity `(source, subjectPlayerId, claimType)` is compared to the current `active` event:

| Situation | Result | Side effects |
| --------- | ------ | ------------ |
| No active event, pre-kickoff | create `active` event | evaluate materiality → create suggestions or `insufficient_evidence` |
| Same value as active event | duplicate | update `lastConfirmedAt` only; no new suggestion |
| Different value, prior event **not yet stable** (within `CONFLICT_WINDOW_MINUTES = 5` of `raisedAt`, no confirmation) | `conflicting` | both events retained; the active event → `conflicting`, naming both claims; **no** suggestions treated as current; affected contracts remain honestly stale, not auto-blocked-as-pending |
| Different value, prior event **stable** (older than the conflict window) | reversal / update | prior event → `superseded`, its suggestions → `superseded` (shadows retained & still graded); new `active` event created; materiality re-evaluated fresh |
| Any observation with `now ≥ game.kickoffAt` | `post_kickoff` | event retained and source-graded; **no** suggestion, **no** shadow, frozen pre-game record untouched |

"Stable" = `(now − raisedAt) > CONFLICT_WINDOW_MINUTES` with no contradicting observation in that window.

### Suggestion transitions

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| — | `pending` | system | shadow projection created; affected player's contracts blocked in the cycle (`pending_suggestion`) |
| — | `insufficient_evidence` | system | **no** shadow; affected contract held from autonomous trading exactly like a pending suggestion |
| `pending` | `accepted` | admin only | active projection for the key becomes the shadow; downstream edge/recommendation/cycle read it; base untouched; existing open position annotated `projection changed after entry`, never auto-exited |
| `pending` | `declined` | admin only | base remains active; shadow untouched and still graded |
| `pending`/`accepted`/`declined` | `superseded` | system | on source-event reversal; row retained; shadow retained & still graded |
| graded | re-graded | conditional | only on a stat correction; idempotent; cascades through the existing grade path to both base and shadow |

Terminal/exceptional: a `conflicting` event offers no accept/decline; a `post_kickoff` event and an `insufficient_evidence` suggestion offer no accept/decline. A voided/cancelled game makes source grading `unverifiable` for that claim and drops both projections' impacts from the Adjustment Accuracy denominator (never fabricated).

## 6. UI integration

Reference the design doc for visual detail. Implementation support:

**Screens**

| Screen | Route | Role | Data | Actions |
| ------ | ----- | ---- | ---- | ------- |
| Contract detail — pending panel | `/slate/[contractId]` | admin | base + shadow summaries, evidence, materiality label, status | Accept / Decline (one action each) |
| Slate pending marker | `/slate` | admin | per-contract pending/held flag | none (opens detail) |
| Accepted reason line | `/slate`, `/slate/[contractId]` | all | reason string for the active accepted suggestion | none |
| Suggestions ▸ Pending | `/suggestions` | admin | pending suggestions + conflicting/post_kickoff events + held | Accept / Decline / Open |
| Suggestions ▸ History | `/suggestions/history` | admin | every event & suggestion with disposition, source outcome, base-vs-adj | Open |
| Suggestions ▸ Reliability | `/suggestions/reliability` | admin | per-source two-figure reliability + breakdown | none |
| Health — ESPN source row | `/health` | admin | last ESPN check timestamp / outage | none |

**Components** — `PendingSuggestionPanel`, `ProposedChangeTable`, `AdjustmentReasonLine`, `PendingSuggestionMarker`, `SuggestionCard`, `ReliabilityTile`, `SuggestionHistoryTable`. All read theme tokens; charts (none required here beyond tiles) would use the Recharts wrapper. The two reliability tiles must never be composed into a single figure.

**MUI integration** — Accept/Decline are equal-weight `Button`s (neither dominant, no confirmation dialog — the action is reversible in effect and non-destructive). `ReliabilityTile` renders the count always and the percentage only when `denominator ≥ RELIABILITY_MIN_SAMPLE`. Admin surfaces render nothing before the server role check (no partial shell). Reason line and pending marker are theme-token-only, colourblind-safe (text + glyph, not colour alone).

## 7. Data model

### Relationship to existing schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `AdjustmentSourceEvent` | many-to-one | `Player` (`subjectPlayerId`) | the player the claim is about |
| `AdjustmentSourceEvent` | many-to-one | `Game` | the game the claim pertains to |
| `AdjustmentSourceEvent` | self (supersededBy) | `AdjustmentSourceEvent` | reversal chain |
| `AdjustmentSuggestion` | many-to-one | `AdjustmentSourceEvent` | the claim that produced it |
| `AdjustmentSuggestion` | many-to-one | `Player` (`targetPlayerId`) | the projection's player |
| `AdjustmentSuggestion` | one-to-one | `Projection` (`baseProjectionId`) | the base projection |
| `AdjustmentSuggestion` | one-to-one | `Projection` (`shadowProjectionId`) | the shadow (nullable) |
| `AdjustmentSuggestion` | many-to-one | `User` (`decidedByUserId`) | who accepted/declined (admin) |
| `Projection` | (adds) | `AdjustmentSuggestion` | `provenance`, `adjustmentSuggestionId` |

### New models

```prisma
/// A claim an external source made about one player, under the dedup identity
/// (source, subjectPlayerId, claimType). Bitemporal: valid_at is the game it
/// pertains to; known_at is when the source published it. The Source Accuracy
/// grading target. ESPN reports live ONLY here and never in PlayerGameContext,
/// so an unproven feed can never reach the as-of feature path.
model AdjustmentSourceEvent {
  id             String            @id @default(uuid())
  source         DataSource        // espn for this pitch; open for future sources
  subjectPlayerId String           @map("subject_player_id")
  gameId         String            @map("game_id")
  claimType      String            @map("claim_type")   // validated: "game_status"
  claimValue     String            @map("claim_value")  // validated: "out" | "doubtful" | ...
  evidenceText   String            @map("evidence_text") // verbatim source-derived, plain language

  status         SourceEventStatus @default(active)
  supersededById String?           @map("superseded_by_id")

  // Source-correctness grade (written after the game by the grading pass).
  sourceOutcome  SourceClaimOutcome? @map("source_outcome")
  gradedStatVersion Int?            @map("graded_stat_version")
  sourceGradedAt DateTime?          @map("source_graded_at")

  validAt              DateTime @map("valid_at")               // the game
  knownAt              DateTime @map("known_at")               // source publication time
  knownAtReconstructed Boolean  @default(false) @map("known_at_reconstructed") // live feed: observed, not reconstructed
  raisedAt             DateTime @map("raised_at")              // first stored, used for the conflict window
  lastConfirmedAt      DateTime @map("last_confirmed_at")

  ingestRunId String   @map("ingest_run_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  subjectPlayer Player @relation(fields: [subjectPlayerId], references: [id])
  game          Game   @relation(fields: [gameId], references: [id])
  supersededBy  AdjustmentSourceEvent? @relation("EventReversal", fields: [supersededById], references: [id])
  supersedes    AdjustmentSourceEvent[] @relation("EventReversal")
  suggestions   AdjustmentSuggestion[]

  // At most one ACTIVE/CONFLICTING event per identity is enforced in code inside
  // the ingest transaction (a partial unique index; see raw SQL below).
  @@index([source, subjectPlayerId, claimType, status])
  @@index([gameId, status])
  @@index([knownAt])
  @@map("adjustment_source_events")
}

/// A proposed change to ONE projection produced by a source event. The
/// Adjustment Accuracy grading unit. Never deletes or mutates the base
/// projection; never deletes the shadow on decline.
model AdjustmentSuggestion {
  id            String   @id @default(uuid())
  sourceEventId String   @map("source_event_id")
  targetPlayerId String  @map("target_player_id")
  gameId        String   @map("game_id")
  statType      StatType @map("stat_type")

  baseProjectionId   String  @map("base_projection_id")
  shadowProjectionId String? @map("shadow_projection_id") // null when insufficient_evidence

  status SuggestionStatus @default(pending)

  // Materiality (decision 5). Exactly one of the two is the deciding metric.
  materialityKind      String  @map("materiality_kind")   // "listed_threshold_pp" | "unlisted_relative_pct"
  materialThresholdPp  Decimal? @map("material_threshold_pp") @db.Decimal(6, 2) // max abs pp shift over listed contracts
  materialRelativePct  Decimal? @map("material_relative_pct") @db.Decimal(6, 2) // relative % shift to projected value
  reasonText           String   @map("reason_text")        // plain-language, model-derived; rendered verbatim

  decidedByUserId String?   @map("decided_by_user_id")
  decidedAt       DateTime? @map("decided_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  sourceEvent      AdjustmentSourceEvent @relation(fields: [sourceEventId], references: [id])
  targetPlayer     Player                @relation(fields: [targetPlayerId], references: [id])
  game             Game                  @relation(fields: [gameId], references: [id])
  baseProjection   Projection            @relation("BaseProjection", fields: [baseProjectionId], references: [id])
  shadowProjection Projection?           @relation("ShadowProjection", fields: [shadowProjectionId], references: [id])
  decidedBy        User?                 @relation(fields: [decidedByUserId], references: [id])

  // One live (pending/accepted/declined/insufficient_evidence) suggestion per
  // (sourceEvent, targetPlayer, statType); superseding creates a new row.
  @@index([gameId, status])
  @@index([targetPlayerId, gameId, statType, status])
  @@index([sourceEventId])
  @@map("adjustment_suggestions")
}
```

### Updated models

```prisma
enum ProjectionProvenance {
  base
  adjustment_shadow
}

model Projection {
  // ... existing fields unchanged ...
  provenance             ProjectionProvenance @default(base)
  adjustmentSuggestionId String?              @map("adjustment_suggestion_id")

  baseForSuggestion   AdjustmentSuggestion[] @relation("BaseProjection")
  shadowForSuggestion AdjustmentSuggestion?  @relation("ShadowProjection")

  // Provenance joins the natural key so a shadow can never collide with a base
  // that happens to share a cutoff. Existing rows default to `base`, so the
  // migration is additive and preserves current uniqueness.
  @@unique([playerId, gameId, statType, modelVersion, informationCutoff, provenance])
  @@index([gameId, statType, provenance, computedAt(sort: Desc)]) // active-base selection excludes shadows
}
```

```prisma
enum BindingConstraint {
  // ... existing values ...
  pending_suggestion // affected player has a pending material suggestion (decision 1)
}
```

`PaperPosition` gains an annotation field for decision 8:

```prisma
model PaperPosition {
  // ... existing fields ...
  projectionChangedAfterEntry Boolean   @default(false) @map("projection_changed_after_entry")
  projectionChangedAt         DateTime? @map("projection_changed_at")
}
```

### Raw SQL constructs

```sql
-- At most one non-terminal source event per dedup identity. superseded events
-- are historical and excluded; active/conflicting/post_kickoff are "live".
create unique index adjustment_source_events_one_live_per_identity
  on adjustment_source_events (source, subject_player_id, claim_type)
  where status <> 'superseded';

-- The evidence text and reason text must never be empty (they are the whole
-- point of the human-readable requirement).
alter table adjustment_source_events
  add constraint source_event_evidence_nonempty check (length(evidence_text) > 0);
alter table adjustment_suggestions
  add constraint suggestion_reason_nonempty check (length(reason_text) > 0);

-- A shadow suggestion must reference distinct base and shadow projections.
alter table adjustment_suggestions
  add constraint suggestion_base_shadow_distinct
  check (shadow_projection_id is null or shadow_projection_id <> base_projection_id);
```

No RLS is added: these tables are shared reference/analytics data gated by server-side admin checks, consistent with the rest of the schema. `Decision`/`Position` remain the only user-scoped tables.

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| active projection | no | accepted suggestion else freshest base | Resolved on read; a stored shadow is never active by existing |
| Adjustment outcome (improved/hurt/neutral) | no | base `ProjectionGrade` vs shadow `ProjectionGrade` | Computed on read from the two grades |
| Adjustment Accuracy rate | no | count of improved / gradable impacts | Computed on read; withheld below 15 |
| Source Accuracy rate | no | count of correct / verifiable claims | Computed on read; withheld below 15 |
| pending-block flag | no | pending/insufficient_evidence suggestion for the contract's player/game/stat | Evaluated per cycle, recorded as `BindingConstraint` on the candidate |
| materiality | yes (on suggestion) | base vs shadow distributions + `Contract.threshold` | Stored because it gated creation and is shown; the raising computation is not re-derivable cheaply |

## 8. Authorization and access control

Two roles; not multi-tenancy. All suggestion data is shared analytics gated by role — there is no per-user partition.

| Resource | Read | Create | Update | Delete |
| -------- | ---- | ------ | ------ | ------ |
| `/suggestions*` pages & reads | admin only (server) | — | — | — |
| `POST /api/suggestions/:id/accept` | — | admin only | — | — |
| `POST /api/suggestions/:id/decline` | — | admin only | — | — |
| accepted-adjustment reason on slate/detail | all roles | — | — | — |
| `AdjustmentSourceEvent` / `AdjustmentSuggestion` writes | Python runtime only (service-role, direct connection) | — | — | never deleted |

- Accept/decline resolve the acting user from the session; `decidedByUserId` is set server-side, never from the client. The request body carries only the suggestion id (in the path).
- A viewer hitting any `/suggestions*` route or accept/decline handler is rejected server-side (`requireAdmin` → 403 in place), never a partial render.
- The Python runtime writes suggestions and shadows with the service-role credential on the direct connection, exactly as other ingest/grading jobs do. No route handler uses that credential. The Python runtime still may not read `PriceObservation`/`RecommendationSnapshot` — enforced by the existing import-graph test, extended to the new modules.

## 9. Route handlers and API surface

```typescript
// POST /api/suggestions/:id/accept   (admin)
export type AcceptSuggestionResult = {
  suggestion: SuggestionDto;          // status now "accepted"
  activeProjectionId: string;         // = shadowProjectionId
};

// POST /api/suggestions/:id/decline  (admin)
export type DeclineSuggestionResult = {
  suggestion: SuggestionDto;          // status now "declined"
  activeProjectionId: string;         // = baseProjectionId (unchanged)
};
```

- Both are **idempotent transitions from `pending` only.** Accepting an already-accepted suggestion returns the current state with `200` (no error); accepting a `superseded`/`insufficient_evidence`/`declined`/`conflicting`/`post_kickoff` suggestion returns `409 conflict` with a coded body and the current state. This matches the design doc's "resolved by another session → refresh, don't error."
- Accept, in one `$transaction`: set `status=accepted`, `decidedByUserId`, `decidedAt`; annotate any open `PaperPosition` on the target contract (`projectionChangedAfterEntry=true`, `projectionChangedAt=now`). It does **not** write a new projection — the shadow already exists; acceptance only flips which projection the active-projection resolver returns.
- There is **no** endpoint that creates, auto-accepts, or bulk-resolves suggestions. Creation happens only in the Python runtime. Any such route would be a stop-condition violation.
- Reads (`/suggestions`, `/suggestions/history`, `/suggestions/reliability`) are server-component Prisma reads, not routes.
- Error shape follows `references/api-conventions.md` (`{ error: { code, message } }`), never leaking Prisma text or the Kalshi key.

## 10. Validation rules

| Input | Validation | Error |
| ----- | ---------- | ----- |
| accept/decline `:id` | valid uuid; suggestion exists | `not_found` (404) |
| accept/decline | suggestion `status == pending` | `409 conflict` with current status |
| accept/decline caller | session role `admin` | `forbidden` (403) |
| request body | must be empty/ignored; no client snapshot or user id accepted | `validation_error` (400) if extra fields |

Python-side write validation (block, do not warn):
- A suggestion is created **only** pre-kickoff (`knownAt < game.kickoffAt`). A post-kickoff observation writes a `post_kickoff` event with **no** suggestion.
- A shadow projection is written through the **as-of layer** at `informationCutoff = event.knownAt`; a shadow whose computation touched a fact with `knownAt > informationCutoff` is a leak and must fail the run (asserted by the leakage suite).
- If the inheriting teammate is below `EVIDENCE_FLOOR_OPPORTUNITIES`, write `insufficient_evidence` (no shadow), never a fabricated distribution.
- Materiality below both thresholds → **no** suggestion row at all (the redistribution stays internal Simulation Engine behavior).
- `AdjustmentSourceEvent.knownAt` may never be set later than the ESPN observation time; never resolved to the game date.

## 11. UI data contracts

```typescript
export type ProjectionSummaryDto = {
  projectionId: string;
  projectedValue: number;
  intervalLow: number;
  intervalHigh: number;
  confidence: "high" | "medium" | "low";
  thresholdProbability: number | null; // P(≥ contract threshold), null if no listed contract
};

export type SuggestionDto = {
  id: string;
  source: string;                       // "espn"
  claimType: string;                    // "game_status"
  claimValue: string;                   // "out"
  subjectPlayerName: string;            // Tee Higgins
  targetPlayerName: string;             // Ja'Marr Chase
  statType: StatType;
  status: "pending" | "accepted" | "declined" | "insufficient_evidence" | "superseded";
  evidenceText: string;
  reasonText: string;
  raisedAt: string;
  materialityLabel: string;             // "material · +12.8 pp" | "material · +11% proj (no listed contract)"
  base: ProjectionSummaryDto;
  proposed: ProjectionSummaryDto | null; // null when insufficient_evidence
};

// Slate/contract-detail additions
export type SlateRowDto = {
  // ... existing fields ...
  pendingSuggestion?: { id: string; source: string; held: boolean } | null; // ADMIN serializer only — absent for viewers
  acceptedAdjustmentReason?: string | null;                                 // shared — present for all roles when active proj is accepted shadow
};

// Reliability — two independent figures, never merged
export type SourceReliabilityDto = {
  source: string;
  sourceAccuracy: { correct: number; verifiable: number; rate: number | null };     // rate null below min sample
  adjustmentAccuracy: { improved: number; gradable: number; rate: number | null };  // independent denominator
  adjustmentBreakdown: { improved: number; hurt: number; neutral: number };
  minSample: number; // 15
};
```

- `pendingSuggestion` is **omitted** from the viewer serializer entirely (not nulled) — absence, not a hidden key.
- `acceptedAdjustmentReason` carries no private state (a public ESPN claim + shared projection) and is present for all roles.
- The DTO cannot represent a single combined reliability number; `SourceReliabilityDto` has no field that sums or averages the two. This is deliberate and load-bearing.

## 12. Python runtime design

### ESPN inactives ingest (optional dataset)

- A new dataset in `python/src/sightline_ingest/datasets/espn_inactives.py`, registered in `cycle.py` as an **optional** source (like weather): its failure records a per-source `IngestRun(status=failed)` and never marks the cycle failed. On outage, no new suggestions; affected games stay honestly stale via the existing Pitch 5 mechanism. **Never** infers status from any Kalshi-derived signal.
- ESPN endpoint is undocumented/unauthenticated; treated conservatively (rate-limited, timeout, schema-tolerant). A schema change producing valid HTTP with unexpected shape is a recorded ingest failure, not a crash and not a silent gap.
- Player resolution reuses `identity_resolution.NameIndex.resolve()` / `player_external_ids(source='espn')`; ambiguous/unresolved subjects are retained and surfaced, never guessed into a wrong player.
- Writes `AdjustmentSourceEvent` rows only (never `PlayerGameContext`), so ESPN never enters the as-of feature path.

### Suggestion engine

- `python/src/sightline_model/suggestions/engine.py`: runs the source-event state machine (decision 3), and for each newly-`active` pre-kickoff claim of `claimValue ∈ {out, doubtful}` for a player in a game whose contracts are of interest:
  1. Recompute the affected game via `simulation.live.project_game_simulation()` with the subject marked unavailable (`available[subjectPlayerId] = False` before `allocate_shares()`), at `informationCutoff = event.knownAt`, through the `AsOfCorpus`.
  2. For each teammate projection that changed, compute materiality: threshold-probability shift on listed `Contract`s (read `Contract.threshold`; never price), else relative value shift.
  3. If material and the teammate clears `EVIDENCE_FLOOR_OPPORTUNITIES` → persist the shadow `Projection` (`provenance=adjustment_shadow`, deterministic id keyed additionally by suggestion identity) and create `AdjustmentSuggestion(status=pending)`.
  4. If material but the teammate is below the floor → `AdjustmentSuggestion(status=insufficient_evidence)`, no shadow.
  5. If not material → no row.
- Shadow persistence reuses `project_live` persist machinery; base-projection writes are unchanged. The shadow's natural key includes `provenance`, so it cannot collide with the base.

### Grading extensions (`grade_job.py`)

- **Shadow grading:** extend the eligible-projection selection so shadows are graded in addition to the freshest base. Base selection keeps `DISTINCT ON (player, game, stat, model_version)` restricted to `provenance='base'`; a second pass selects **every** ungraded shadow (`provenance='adjustment_shadow'`) for completed/cancelled games (all shadows, incl. superseded, are graded). Both write `ProjectionGrade`/`ThresholdGrade` through the existing idempotent upsert — no grade-table schema change.
- **Source-claim grading:** a new pass grades each `AdjustmentSourceEvent` for a completed game against `PlayerGameContext.participation_status` for the subject player: `out`/`doubtful` claim vs actual DNP/played → `correct`/`incorrect`; participation unavailable → `unverifiable`. Writes `sourceOutcome`, `sourceGradedAt`, `gradedStatVersion`. Idempotent (`IS DISTINCT FROM`), re-graded on a stat/participation correction. Never graded against Kalshi settlement/`Outcome`.

### TypeScript active-projection resolver

- A shared helper `selectActiveProjection(playerId, gameId, statType)` (and its batch form for the slate) returns the accepted shadow if a suggestion for that key is `accepted`, else the freshest `provenance='base'` projection. The slate read (`readSlate`), contract detail (`readContractDetail`), and the paper cycle's projection selection (`paper-cycle.ts`) all route through it. This is the shadow-contamination guard.
- The cycle's candidate builder additionally queries pending/insufficient-evidence suggestions per game and sets `boundBy = pending_suggestion` on the affected player's candidates via the existing refusal path in `plan.ts` — the same structural action as `stale_projection`, a distinct reason code.

## 13. Testing strategy

Priorities follow `CLAUDE.md`. Pitch-required tests are marked **[required]**.

**Temporal leakage (first, adversarial)**
- GIVEN a shadow computed at `informationCutoff = t` WHEN any fact with `knownAt > t` exists THEN it is structurally unreachable and the shadow is identical whether computed then or now.
- **[required]** GIVEN an ESPN observation with `knownAt` after actual kickoff WHEN ingested THEN a `post_kickoff` event is written and the frozen pre-game active projection is unchanged — using the **kickoff timestamp**, not the 10-minute trading cutoff, as the boundary.

**Prices never feed projections**
- **[required]** Import-graph assertion: no module in the suggestion engine, shadow computation, materiality, or ESPN ingest imports any path reaching `PriceObservation`/`RecommendationSnapshot`. Behavioral: materiality uses only `Contract.threshold` + projections.

**Grading & idempotence**
- **[required]** GIVEN a declined suggestion WHEN the game settles THEN the shadow is graded (a `ProjectionGrade` row exists for it).
- **[required]** GIVEN an accepted suggestion WHEN queried after acceptance THEN the base projection remains separately queryable and gradable (its own `ProjectionGrade` exists, distinct from the shadow's).
- Re-running grading writes nothing; a stat correction re-grades both base and shadow and the source claim.
- Source claim graded against participation only; a voided game → `unverifiable`, not fabricated.

**State machine (decision 3)**
- **[required]** Three outcomes from one comparison rule: identical repeat → `lastConfirmedAt` bumped, no new suggestion; changed value (prior stable) → prior `superseded` + new event, fresh materiality; two conflicting values within 5 min → `conflicting`, neither current.

**Autonomous interaction (decision 1)**
- **[required]** GIVEN a pending material suggestion on player A WHEN a cycle runs THEN A's contracts are `refused` with `boundBy=pending_suggestion`, AND an unrelated contract in the same game and slate is planned/filled normally.
- GIVEN an accepted suggestion THEN the cycle reads the shadow as active; GIVEN a declined suggestion THEN it reads the base.
- GIVEN an open position on the affected contract when a suggestion is accepted THEN the position is annotated and never auto-exited (no offsetting order is planned).

**Reliability (decisions 9, 10)**
- **[required]** Source Accuracy and Adjustment Accuracy are computed and displayed as two independent values with independent sample gating; below 15 the rate is null and the count shown; there is no code path or DTO field that combines them.

**Security / privacy / role**
- A viewer is rejected server-side on every `/suggestions*` route and on accept/decline. `pendingSuggestion` is absent (not null) in the viewer slate DTO. The accepted reason line is present for viewers and contains no private state.

**Materiality & evidence floor**
- Sub-threshold change raises no suggestion. Below-floor teammate → `insufficient_evidence`, no shadow, contract held. Unlisted subject still produces teammate suggestions (decision 6).

**Idempotent ESPN ingest / outage**
- Re-publishing the same inactive list creates no duplicate suggestions. ESPN outage → optional-source failure, cycle still succeeds, affected games stale, no Kalshi-derived inference.

## 14. Acceptance criteria

**Mechanism**
- [ ] An ESPN inactive produces an `AdjustmentSourceEvent` and, per materially-affected teammate, an `AdjustmentSuggestion` with source, claim, target projection, evidence, reason, and proposed value/range/confidence.
- [ ] The proposed change is derived from the Simulation Engine (availability override), not hand-authored.
- [ ] A shadow `Projection` is created regardless of William's action; the base is preserved.
- [ ] Accept makes the shadow the active projection in one action; decline leaves the base active in one action.
- [ ] Declining/ignoring does not stop the shadow being graded; both base and shadow are graded via the existing path; both remain distinguishable after acceptance.

**Reliability**
- [ ] Source Accuracy and Adjustment Accuracy are reported separately, per source, each with sample size, each withheld below 15, count always shown.
- [ ] Source correctness is graded against official participation, never Kalshi settlement; unverifiable claims are not fabricated as correct.

**Edges**
- [ ] Duplicate events do not duplicate suggestions; reversals mark prior `superseded` and retain it; conflicts enter `conflicting` naming both.
- [ ] A post-kickoff report never alters the frozen pre-game record (kickoff-timestamp boundary), yet still contributes to Source Accuracy.
- [ ] Below the evidence floor → `insufficient_evidence`, no numeric adjustment, contract held from autonomous trading.
- [ ] An unlisted subject still affects listed teammates.

**Autonomy & safety**
- [ ] A pending material suggestion blocks only the affected player's contracts (`pending_suggestion`), not the game or slate; unrelated contracts trade.
- [ ] No mechanism makes a suggestion active without William's explicit accept. No trusted-source toggle exists. No automated position exit exists.
- [ ] Kalshi price movement is never used as a status signal; no Python model/feature path reads price.

**Access**
- [ ] Viewers cannot reach any `/suggestions*` surface or accept/decline; rejected server-side. Viewers see the accepted-adjustment reason line only.

## 15. Explicit non-goals

**Permanent:** sportsbook/DFS integration; public/commercial access; live in-game trading; film/tape inputs; viewers trading through the app or credential custody; general sports-data browsing; a general breaking-news product.

**Deferred (do not build, do not preclude):** automatic source trust; additional suggestion sources; automated position exit/offset; the Baseline-vs-Simulation dual-engine shadow; bankroll/portfolio management; NBA/WNBA; friend pick sharing.

## 16. Open questions

All seven pitch Open Questions are resolved (see Resolved Decisions, §18). Two run-chosen numeric defaults are flagged for human review, non-blocking:

1. `CONFLICT_WINDOW_MINUTES = 5` — the window within which two contradictory unconfirmed claims are treated as conflicting rather than as a reversal. Not specified upstream.
2. `RELIABILITY_MIN_SAMPLE = 15` — the per-metric minimum observations before a numeric rate is shown. Not specified upstream.

Inherited open questions restated (unchanged by this pitch): edge against ask vs midpoint; settlement vs official line as grading truth (this pitch uses **official participation** for source claims and the **official stat line** for adjustment grading, consistent with model grading); calibration treatment of superseded model versions; whether RLS is enabled on user-scoped tables.

Also flagged: `AdjustmentSourceEvent` is a **new entity** not named in the Architecture Doc, introduced to hold the claim-level dedup identity and Source Accuracy grade separately from the per-projection `AdjustmentSuggestion` (see §18 RD-AS-1). Architecture Doc should be amended to name it.

## 17. Future considerations

- A future automatic-trust pitch would read the accumulated `SourceReliabilityDto` and add a deliberate, separately-designed auto-apply path — this spec builds none of it and adds no flag.
- Additional sources drop in as new `AdjustmentSourceEvent.source` values + a new ingest dataset + (if a new claim shape) a new `claimType` string, with no change to suggestion, shadow, grading, or reliability mechanics.
- The active-projection resolver is the natural seam for the later dual-engine shadow evaluation, which would add a different provenance rather than reusing `adjustment_shadow`.

## 18. Resolved Decisions

Every decision below is recorded per the Autonomous Pipeline Policy. Decisions 1–10 are adopted verbatim in intent from the run instruction (approved-doc authority); RD-AS-* are implementation resolutions.

- **RD-1 — Pending block scope = affected player only, via the stale refusal path.** Reuse `plan.ts` refusal; add `BindingConstraint.pending_suggestion`; block the target player's contracts only, leaving teammates/game/slate trading. *Rationale: a pending-suggestion refusal and a stale-projection refusal are the same structural action; sharing the path keeps them diagnosable via distinct reason codes.*
- **RD-2 — No automatic-trust mechanism, not even disabled.** No toggle, no config flag, no confidence-based auto-approval. *Rationale: a disabled code path is still a path that can be flipped without a design pass; the pitch defers this deliberately.*
- **RD-3 — Dedup/reversal/conflict identity = `(source, subjectPlayer, claimType)`; conflict window 5 min.** Three testable outcomes from one comparison rule (§5). *Rationale: makes "duplicate", "reversal", "contradictory" mechanical rather than ad hoc.*
- **RD-4 — Kickoff freezes the pre-game record; the 10-minute cutoff does not.** Two different checks against two different timestamps: kickoff for the freeze, `PRE_KICKOFF_CUTOFF_MINUTES` for trading. Post-kickoff → source-graded, non-actionable, no shadow. *Rationale: conflating them would either edit frozen history or wrongly stop pre-kickoff shadow computation.*
- **RD-5 — Materiality = ≥3 pp on ≥1 listed contract, else ≥10% relative value with none listed.** Below either applicable threshold, no suggestion. *Rationale: the threshold that actually moves a real listed price is the one worth interrupting William for; the fallback keeps an untradeable-but-material redistribution visible.*
- **RD-6 — "Cannot calculate" reuses the Simulation Engine evidence floor (`EVIDENCE_FLOOR_OPPORTUNITIES` / `insufficient_evidence`).** Below floor → `insufficient_evidence`, no shadow, contract held. *Rationale: one floor, not two that can drift out of sync.*
- **RD-7 — Viewers see the reason for accepted adjustments only.** `acceptedAdjustmentReason` shared; pending/declined/controls omitted from viewer payloads. *Rationale: everyone understands a shared projection change; control stays with the admin.*
- **RD-8 — Existing positions frozen in place, annotated, never auto-exited (no disabled flag).** `PaperPosition.projectionChangedAfterEntry`. *Rationale: automated exits are real trading behavior needing their own evidence and design pass.*
- **RD-9 — Reliability minimum sample = 15, independently per metric, count always shown.** Independent denominators (not every correct claim yields a gradable adjustment). *Rationale: matches the pitch's "3 of 3 vs 97 of 100"; the two populations legitimately diverge.*
- **RD-10 — Source accuracy graded against official participation, never Kalshi settlement.** `PlayerGameContext.participation_status`. *Rationale: official data grades world-claims; settlement grades money; a voided contract must not corrupt a claim about whether a player played.*
- **RD-AS-1 — Introduce `AdjustmentSourceEvent` as a claim-level entity distinct from `AdjustmentSuggestion`.** The architecture names only `AdjustmentSuggestion` (per target projection). The dedup identity, reversal chain, conflict state, and Source Accuracy grade are claim-level and one claim affects several teammate projections, so they live on a separate entity; `AdjustmentSuggestion` stays per-projection as the architecture describes. *Rationale: honors the architecture's per-projection suggestion while giving the claim its own identity; recorded as an architecture amendment.*
- **RD-AS-2 — Shadow = `Projection` row discriminated by `provenance`, linked from the suggestion.** Grading reuses the existing job (base pass restricted to `provenance='base'`; a second pass grades every shadow). Provenance joins the natural key so base/shadow never collide. *Rationale: the pitch requires the shadow to be a durable projection gradable through the existing path; a discriminator keeps `model_version` semantically pure and avoids a synthetic version leaking into slate model-selection.*
- **RD-AS-3 — Accepted shadow becomes active via a shared resolver, never by mutating rows.** `selectActiveProjection` returns the accepted shadow else the freshest base; slate, detail, and cycle all use it. *Rationale: satisfies "shadow never active by existing" and "never overwrite the base" simultaneously.*
- **RD-AS-4 — Adjustment outcome (improved/hurt/neutral) is computed on read** from base vs shadow `ProjectionGrade.absErrorMean`, with a neutral band; not stored. *Rationale: derived-state posture; the grades are the source of truth.*
- **RD-AS-5 — ESPN reports are stored only on `AdjustmentSourceEvent`, never in `PlayerGameContext`.** *Rationale: `PlayerGameContext` is read by the as-of feature path; an unproven feed must never reach projections automatically.*
