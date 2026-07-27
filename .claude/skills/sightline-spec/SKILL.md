---
name: sightline-spec
description: >
  Generate detailed technical specifications for Sightline features. Use when
  creating new feature specs, updating existing specs, or when the user mentions
  "spec", "specification", "technical design", "technical spec", "implementation
  spec", or needs to document a Sightline feature for implementation. Specs
  follow a consistent structure with product context, core concepts, states,
  UI integration, Prisma data model, authorization, route handler surfaces,
  validation, UI data contracts, testing strategy, acceptance criteria, and
  explicit scope boundaries. Requires an expanded pitch and a design doc as
  input, with the PRD and Architecture Doc as upstream references. Trigger
  before implementation begins on any Sightline feature.
---

# Sightline Specification Generator

Generate detailed technical specifications for Sightline features following established project conventions.

Specs sit after the pitch and design-doc stages. They translate product and design intent into build-ready technical direction without becoming ticket-level task lists.

Sightline's planning chain:

```text
Product Brief → PRD → Pitch Roadmap → Pitch → Design Doc → Technical Spec → Tickets → Build
```

The spec answers: **how should this feature be built?**

It defines data shape, mutations, server/client boundaries, validation, integration points, testing strategy, and acceptance criteria. It does not drift into product discovery or pixel-level visual design.

## Technical ground truth

**Read `CLAUDE.md` before writing any spec.** It is the authoritative statement of this project's stack, invariants, security rules, and product boundaries. Where a spec and `CLAUDE.md` conflict, `CLAUDE.md` wins. Read `docs/planning/architecture.md` for the rationale behind those decisions when a spec needs to justify or extend one.

The following five anchors are inlined here only because this skill acts on them in nearly every spec:

- **Schema format:** Prisma schema. All migrations originate from Prisma, which is the single source of schema truth. Raw SQL migrations appear only for constructs Prisma does not manage — row-level security policies, partial and expression indexes, and check constraints.
- **Styling system:** Material UI, with Recharts for charts wrapped so they read from the MUI theme. Do not introduce Tailwind, styled-components, CSS modules, or a second component library.
- **Data-access idiom:** server-first. Server components read through Prisma with the session resolved server-side; mutations run through **route handlers**, not server actions. Client components are interactive islands. The only sanctioned client-side fetch is the slate polling Sightline's own price-refresh route.
- **Bitemporal facts:** every fact that could influence a projection carries `validAt` and `knownAt`, both non-nullable. Model-facing reads go through the as-of query layer. A new fact table without both columns is a schema bug.
- **Two runtimes:** Prisma owns the schema; the Python runtime reads and writes those tables but **never migrates**. A spec that introduces a Python-side migration mechanism is wrong.

Everything else — access model, integration list, what is deferred, what infrastructure the project deliberately lacks — comes from `CLAUDE.md` at invocation time. Do not restate it here.

## Prerequisites

Before writing a spec, ensure you have:

1. **Expanded pitch document** — the scoped slice, problem, appetite, in-scope features, boundaries, definition of done, rabbit holes, no-gos, dependencies. **Supplied by the user; this skill does not generate pitches.**
2. **Design document** — UI/UX behavior, screens, flows, states, interaction patterns, component expectations. See `sightline-design-doc`. Pitches with no user-facing surface — Corpus & Point-in-Time Foundation, Backtest Harness & Baseline Model, Simulation Engine — have no design doc, and their specs omit the UI Integration and UI Data Contracts sections rather than inventing screens.
3. **`docs/planning/prd.md`** — feature inventory, acceptance criteria, user journeys, edge cases, Post-MVP boundaries.
4. **`docs/planning/architecture.md`** — approved stack and technical rationale.
5. **`CLAUDE.md`** — repo engineering ground truth and invariants.
6. **Existing schema and migrations** — current models, enums, indexes, and RLS policies.
7. **Existing app code** — current directory structure, the as-of query layer, the MUI theme, and test patterns.

## File conventions

- **Filename:** `feature-name-spec.md`
- **Location:** the pitch folder, or as specified by the user
- **Format:** Markdown with `prisma`, `typescript`, `python`, `sql`, `http`, `json`, and `text` code blocks
- **Schema examples:** Prisma schema. Raw `sql` only for RLS policies, partial or expression indexes, and check constraints.
- **UI examples:** TypeScript/React with Material UI

A blank scaffold lives at `assets/spec-template.md`. Use it when starting a spec from scratch.

## Required sections

Every spec must include these sections in order. Omit a section only when it genuinely does not apply to the feature — an empty section is worse than an absent one.

### 1. Metadata header

```markdown
---
version: 1.0.0
status: draft | review | approved
author: [name]
last_updated: YYYY-MM-DD
pitch_reference: [link or filename]
design_reference: [link or filename]
prd_reference: docs/planning/prd.md
architecture_reference: docs/planning/architecture.md
linear_issue: [SIGHT-### if applicable]
---
```

- Include every available upstream reference.
- Use the exact pitch names from `docs/planning/pitch-roadmap.md` and feature names from `docs/planning/prd.md`. Do not rename features between documents.

### 2. Summary

Two to three paragraphs: what the feature does in one sentence; the core technical abstraction; how it fits Sightline's Sunday-morning workflow; and what "working" means from an implementation perspective.

Worked example, showing the abstraction-first framing:

> Edge Calculation and Recommendation joins two independently-clocked values at read time. The abstraction is that **edge is a view, not a record**: a projection has a clock driven by news, a price has a clock driven by the market, and the disagreement between them is computed when someone looks rather than stored when either changes. What persists is `RecommendationSnapshot` — a frozen copy taken so the recommendation can be graded after settlement. Working means a slate read never waits on a model run, every displayed edge carries the two timestamps it was derived from, and no snapshot is ever mistaken for a cache.

Do not write a summary that restates the feature list. The value is in naming the abstraction.

### 3. Problem

The specific technical gap this feature closes: what the system cannot answer today, why it blocks downstream work, which PRD journey it supports, which pitch it unlocks or depends on. Worked examples of real gaps in this product:

- The app cannot yet tell whether a stored projection was computed before or after inactives were published for its game.
- The app cannot yet distinguish a contract with no edge from a contract Sightline failed to price.
- The app cannot yet answer whether the ESPN feed is reliable, because nothing grades a suggestion whose adjustment was declined.
- The app cannot yet prove that a backtest number was produced without look-ahead, only assert it.
- The app cannot yet detect that an order succeeded at Kalshi but failed to record locally.

### 4. Scope and non-scope

**In scope** — the exact feature behaviors this spec covers.

**Out of scope** — deferred or explicitly excluded behavior.

- Pull boundaries from the pitch and PRD.
- Explicitly name adjacent features that tempt creep. In this product the recurring temptations are: adding a background job to denormalise edge or staleness; pulling settlement grading into a pitch that only displays; adding a second suggestion source while building the first; and adding bankroll tracking alongside trading.
- If something is Post-MVP, say so.
- Do not relitigate permanent non-goals unless the feature is genuinely near one.

### 5. Core concepts

Define each entity, field, derived concept, or behavior the feature introduces.

| Concept | Description |
| ------- | ----------- |
| `Projection` | One player, one stat type, one game, one model version. Stores a compact distribution, not a point estimate. |
| `informationCutoff` | The as-of timestamp a projection was computed against. Distinct from `computedAt`. |

Include ownership rules, cardinality, required vs. nullable, derived vs. persisted, and business invariants.

Sightline-specific distinctions the spec must preserve — an agent will collapse these if not told:

- **`computedAt` and `informationCutoff` are two different timestamps.** When a projection was produced, versus what it was allowed to see. A recompute at 11:40am against a Friday cutoff is a real and important state.
- **`validAt` and `knownAt` are two different timestamps.** When a fact was true of the world, versus when it became available. An injury designation is valid of Week 12 and became known on Friday.
- **Edge is derived; `RecommendationSnapshot` is stored.** The snapshot exists for grading, not for reading. Never treat it as a cache of current edge.
- **Staleness is computed on read** from the game's own kickoff. There is no `isStale` column and no job that maintains one.
- **The base projection and the shadow-adjusted projection both exist and both are graded**, regardless of whether the suggestion was accepted.
- **Source accuracy and adjustment accuracy are two separate figures.**
- **`took`, `faded`, and `skipped` are three states; unmarked is the absence of a `Decision` row**, not a fourth enum value.
- **Kalshi settlement and the official stat line are two facts** and may disagree. Store both; do not reconcile into one number.
- **Ownership:** `Decision` and `Position` carry a `userId` and are written with the acting user's identity resolved from the session. Every other entity is shared reference data with no per-user partition.

### 6. States and lifecycle

Valid states, transitions, and side effects. Use the exact enum values from the data model — do not invent state names.

```prisma
enum Disposition {
  took
  faded
  skipped
}

enum SuggestionStatus {
  pending
  accepted
  declined
}

enum Confidence {
  high
  medium
  low
}
```

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| no row | `took` | yes | `Decision` created with a server-read snapshot of projection, price, edge, confidence, and projection timestamps |
| `took` | `faded` | yes | Snapshot is **not** re-taken; the original decision-time snapshot must reflect the decision actually acted on. Record the change explicitly. |
| `pending` | `accepted` | admin only | Displayed projection updates; the shadow projection is untouched and still graded |
| `pending` | `declined` | admin only | Displayed projection unchanged; the shadow projection is untouched and still graded |
| graded | re-graded | conditional | Only on a stat correction. Re-grading is idempotent and cascades to recommendation, decision, and suggestion outcomes. |

- Only include state tables relevant to the current feature.
- Document terminal states — a voided contract, an unresolvable grading — and how they affect active views.
- Document confirmation behavior for destructive or surprising transitions.

### 7. UI integration

Reference the design doc for detailed UI/UX. This section specifies how the technical implementation supports it.

**Screens** — for each: purpose, data needed, actions.

**Components** — for each: data contract, notes.

**Forms and validation** — for each field: type, required, validation, notes.

**Material UI integration** — document only where it matters: component choice, required variants, disabled and loading states, dialog behavior, accessibility expectations, theme token usage, responsive behavior. Do not restate the visual design; that is the design doc's job.

Omit this section entirely for pitches with no user-facing surface.

### 8. Data model

Use Prisma schema. Raw SQL appears only for RLS policies, partial or expression indexes, and check constraints.

**Relationship to existing schema** — a table of from / relation / to / description.

**New models** — full definitions with real field names, types, nullability, defaults, indexes, and mappings.

```prisma
model Projection {
  id                 String   @id @default(uuid())
  playerId           String   @map("player_id")
  gameId             String   @map("game_id")
  statType           StatType @map("stat_type")
  modelVersion       String   @map("model_version")

  // Compact distribution, never raw draws. Quantile grid for continuous stats;
  // explicit PMF for low-count discrete stats such as touchdowns.
  distributionKind   DistributionKind @map("distribution_kind")
  distribution       Json

  projectedValue     Decimal  @map("projected_value") @db.Decimal(8, 3)
  intervalLow        Decimal  @map("interval_low")    @db.Decimal(8, 3)
  intervalHigh       Decimal  @map("interval_high")   @db.Decimal(8, 3)
  confidence         Confidence

  computedAt         DateTime @map("computed_at")
  informationCutoff  DateTime @map("information_cutoff")
  createdAt          DateTime @default(now()) @map("created_at")

  player             Player   @relation(fields: [playerId], references: [id])
  game               Game     @relation(fields: [gameId], references: [id])
  drivers            ProjectionDriver[]

  @@index([gameId, statType, computedAt(sort: Desc)])
  @@index([playerId, gameId, statType, modelVersion])
  @@map("projections")
}
```

**Updated models** — show only new or changed fields.

**Enums** — use database-level Prisma enums for closed domain sets that the UI maps to visual treatments (`Disposition`, `SuggestionStatus`, `Confidence`, `StatType`). Use validated strings for open sets that grow without a migration, such as suggestion source identifiers.

**Schema conventions:**

- Model names are `PascalCase` singular; table mappings are `snake_case` plural via `@@map`.
- Every field maps explicitly with `@map` to `snake_case`, because the Python runtime reads these tables directly and reads them by column name.
- `id` is a UUID with `@default(uuid())`. `createdAt` uses `@default(now())`; `updatedAt` uses `@updatedAt` only where updates are expected.
- Money and probability values use `Decimal` with explicit precision. Never `Float` for anything a person reads as a number.
- Prices are stored as integer cents, never as decimals or dollars.
- Relations are declared on both sides with explicit `fields` and `references`.
- Index every foreign key, and index the sort key of any list the slate or accuracy surface reads.
- **Every fact table carries `validAt` and `knownAt`, both non-nullable, plus a `knownAtReconstructed` boolean where the value was inferred rather than observed.**

**Raw SQL constructs** — RLS policies, partial indexes, and check constraints are written as raw migrations because Prisma does not manage them. Example:

```sql
-- Decisions are user-scoped. Defence in depth only; server-side role checks
-- remain the primary mechanism (see CLAUDE.md → Authorization).
alter table decisions enable row level security;

create policy decisions_owner_rw on decisions
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

**Derived fields** — a table of field / stored? / computed from / notes. Sightline's default posture is **compute on read**. Storing a derived value requires a stated reason in the spec, and "performance" is not one at this data volume.

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Edge | no | freshest `Projection` + freshest `PriceObservation` | Computed at read time. No column, no job. |
| Staleness | no | game kickoff, `informationCutoff`, inactives ingest state | Per game, measured backward from that game's own kickoff. |
| Recommendation snapshot | yes | edge at a point in time | Stored so it can be graded. Not a cache. |
| Timing cost | no | decision-time snapshot vs. final pre-kickoff snapshot | Both snapshots are stored; the difference is not. |

### 9. Authorization and access control

Sightline has two roles, admin and viewer, and **this is not multi-tenancy.** Projections, prices, edges, recommendations, contracts, and all reference data are identical for every user. Only `Decision` and `Position` are user-scoped. A spec that adds a tenant column or scopes shared reference data by user has misread the model.

Enforcement is server-side in Next.js — in server components and route handlers. Hiding a navigation item is not authorization. RLS on the user-scoped tables is defence in depth and is **not** the primary mechanism; a spec must never rely on it alone, and must note that the Python runtime connects with a service-role credential and bypasses it entirely by design.

Worked guard example, consistent with the model above:

```typescript
// Admin-only route handler. Rejects server-side; never renders a partial shell first.
export async function POST(req: Request) {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return jsonError("forbidden", 403);
  }

  const body = decisionInputSchema.parse(await req.json());

  // userId comes from the session, never from the request body.
  const decision = await recordDecision({
    contractId: body.contractId,
    disposition: body.disposition,
    userId: session.user.id,
  });

  return Response.json(toDecisionDto(decision), { status: 201 });
}
```

Document required policies per resource: read, create, update, delete.

- **Never rely on RLS alone**, and never rely on the client to supply a user identifier.
- **Ownership is direct, not inherited.** `Decision` and `Position` carry `userId` themselves. Do not derive ownership by joining through `Contract`, which is shared.
- **The Python runtime is the sanctioned privileged path.** It bypasses RLS with a service-role credential and is walled off by never serving a user request. No route handler may use that credential.

### 10. Route handlers and API surface

Sightline uses **route handlers**, not server actions, for every mutation and for the Kalshi proxy. Reads happen in server components through Prisma and do not need a route unless the client refreshes them — which, in this product, is only price refresh.

For each operation document: input type, output type, side effects.

```typescript
export type RecordDecisionInput = {
  contractId: string;
  disposition: "took" | "faded" | "skipped";
};

export type DecisionDto = {
  id: string;
  contractId: string;
  disposition: "took" | "faded" | "skipped";
  snapshotModelProbability: number | null;
  snapshotMarketPriceCents: number | null;
  snapshotEdgePoints: number | null;
  snapshotConfidence: "high" | "medium" | "low" | null;
  snapshotProjectionComputedAt: string | null;
  decidedAt: string;
};
```

**Error response format** — the consistent shape and the standard code table live in `references/api-conventions.md`. Read that file when specifying any endpoint-like surface; it also covers naming, filtering, sorting, pagination, idempotency, and the routes this product must never grow.

### 11. Validation rules

Server-side validation for all inputs: field / validation / error code.

- Validate on the server even when the UI validates first. The UI is a convenience; the route handler is the contract.
- **Warn rather than block** where the PRD treats an unusual state as legitimate: a contract with no projection, a slate where nothing clears the threshold, a calibration bucket with too few observations, and an unresolved contract are all displayable states, not validation failures.
- **Block** on anything touching money or the invariants: an order exceeding the per-slate cap, an order without explicit confirmation, a decision carrying client-supplied snapshot values, a write attempting to set `knownAt` later than the observation that produced it.
- Do not allow invalid enum values.
- Do not leak internal database errors, Prisma error text, storage paths, or anything about the Kalshi signing key.

### 12. UI data contracts

The DTOs the UI consumes.

```typescript
export type SlateRowDto = {
  contractId: string;
  playerName: string;
  teamAbbreviation: string;
  statType: StatType;
  threshold: number;

  // Model side. Null when the engine could not project this player.
  modelProbability: number | null;
  confidence: Confidence | null;
  projectionComputedAt: string | null;
  informationCutoff: string | null;

  // Market side. Null when Kalshi is unavailable — a degraded mode, not an error.
  bidCents: number | null;
  askCents: number | null;
  priceObservedAt: string | null;

  // Derived at read time.
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;
  isStale: boolean;
  isUnresolved: boolean;
};
```

- DTOs match what screens need; do not expose raw rows blindly.
- **`modelProbability` and `edgePoints` being null are different states from being zero.** The UI must distinguish "no projection" from "no edge", and the DTO must let it.
- Nothing derived from the Kalshi signing key, and no service-role identifier, ever reaches a DTO.
- Derived field names must be identical across every surface that shows them. `edgePoints` on the slate and `edgePoints` on the decision log are the same field or the spec is wrong.

### 13. Testing strategy

Organize by feature area using GIVEN/WHEN/THEN. See `references/testing-patterns.md` for full category definitions, templates, and factories.

Required categories: happy path; validation; state transitions; side effects; security and privacy; edge cases; invariant tests; integration scenarios; regression tests.

Security and privacy in this product specifically means: a viewer cannot reach the decision log, positions, override performance, timing cost, suggestion reliability analytics, trading, or user management by any route; the Kalshi signing key never appears in a response, a log line, or an error; and no viewer credential is ever accepted by any surface.

Sightline's risk-ranked priorities, matching `CLAUDE.md` → Testing:

1. Temporal leakage — adversarial, and first. Gates everything downstream.
2. Prices never feed projections.
3. Grading and idempotence, including stat-correction re-grading.
4. Contract-to-player resolution.
5. Kalshi integration, adversarially.
6. Role enforcement.

### 14. Acceptance criteria

Checkbox list grouped by feature area, tracing directly to the pitch, PRD, design doc, or ticket.

- Criteria must be observable and testable.
- Do not invent criteria the upstream docs do not support.
- If a needed criterion is missing upstream, add it under Open Questions rather than inventing it.

### 15. Explicit non-goals

Keep permanent and deferred separate; they behave differently and an agent that treats deferred work as forbidden will architect corners it cannot get out of.

- **Permanent** (from the Brief): sportsbook and DFS integration; public or commercial access; live in-game trading; film or tape-derived inputs; viewers trading through the application or their credentials being stored; general sports data browsing.
- **Deferred** (from the PRD's Post-MVP list): bankroll and portfolio management; NBA; WNBA; friend pick sharing; additional stat types; additional suggestion sources. Do not build these, and do not preclude them.

### 16. Open questions

Numbered list of unresolved decisions. Ask only material questions; mark a question blocking if it blocks implementation, and otherwise state the default assumption. Four open questions are inherited from the approved docs and should be restated in any spec they touch rather than silently resolved: whether edge computes against the ask or the midpoint; whether Kalshi settlement or the official stat line is grading truth; how the calibration surface treats projections from superseded model versions; and whether RLS is enabled on the user-scoped tables.

### 17. Future considerations

How this feature enables later work. Keep clearly separate from current scope — future work is not a back door into the current ticket.

## Style guidelines

**Tables over ASCII diagrams** for relationships, field definitions, validation rules, data contracts, operation summaries, state transitions, and acceptance criteria groupings. ASCII only when it clarifies flow better than a table.

**Code blocks:** `prisma` for schema, `sql` for raw migrations, `typescript` for handlers, DTOs, and components, `python` for ingest, feature, and simulation code, `http` for route signatures, `json` for payloads, `text` for test cases.

**Detail level** — be explicit about field types, nullability, defaults, indexes, constraints, ownership, access policies, derived vs. stored state, server/client boundaries, side effects, error cases, validation behavior, tests, and acceptance criteria.

**Tone** — direct and technical. Use **must**, **should**, and **may** deliberately. Avoid hedging in requirements. Be clear about what is a product requirement versus an implementation recommendation. Keep scope boundaries firm.

## Reference files

- `references/api-conventions.md` — route naming, request/response shapes, error codes, filtering, idempotency, and the avoid list
- `references/testing-patterns.md` — test case templates, categories, factories, and invariant patterns
- `assets/spec-template.md` — blank spec scaffold
- `CLAUDE.md` — technical ground truth and invariants
- `docs/planning/product-brief.md`, `prd.md`, `architecture.md`, `pitch-roadmap.md`
- The relevant expanded pitch and design doc

## Workflow

1. **Receive the pitch and design doc** — read both to understand scope and UI behavior.
2. **Read `CLAUDE.md`** — ground truth and invariants, before anything else technical.
3. **Read upstream docs** — PRD, Brief, Architecture, Roadmap for boundaries and dependencies.
4. **Check existing schema and code** — identify what to extend rather than duplicate, especially the as-of query layer.
5. **Identify scope and non-scope** — protect the pitch boundary before designing details.
6. **Clarify critical ambiguities** — blockers only.
7. **Draft core concepts** — abstractions, relationships, invariants.
8. **Design the data model** — models, fields, indexes, constraints, policies.
9. **Checkpoint if risky** — stop and validate before continuing when the feature touches the as-of query layer, `knownAt` handling, feature computation, grading, the Kalshi credential path, or order placement. These are the areas where a wrong decision is silent.
10. **Define the operation surface** — route handlers, request/response shapes, error behavior.
11. **Define UI data contracts.**
12. **Write the testing strategy** — acceptance criteria, edge cases, invariants, workflows.
13. **Review for scope creep** — remove Post-MVP or adjacent-pitch work.
14. **Finalize** — update status.

## Interview guidelines

- Start with the most critical unknowns.
- Ask only questions that materially affect implementation.
- Provide options: "should this recompute be scoped per game or per slate — the architecture says per game, but this pitch's wording could be read either way."
- Reference specific upstream sections when asking.
- Surface tradeoffs explicitly: "storing the confidence-adjusted edge would make the slate query simpler, but the derived-state posture says compute on read, and at fourteen games a slate the query is not the problem."
- Capture deferred decisions in Open Questions.
- Do not ask questions already answered by the PRD, pitch, design doc, or Architecture Doc.
