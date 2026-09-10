---
version: 1.0.0
status: draft
author: autonomous-pipeline
last_updated: 2026-09-10
pitch_reference: docs/v1/pitches/slate-experience-and-prop-research.md
design_reference: docs/v1/design-docs/slate-experience-and-prop-research-design-doc.md
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: (milestone: Pitch 10 — Slate Experience & Prop Research)
---

# Slate Experience & Prop Research — Technical Specification

## 1. Summary

This pitch re-shapes the Slate around games and players instead of individual contracts, adds a **Prop Research** probability checker, moves Accuracy and the operational tools behind the admin boundary, and makes Kalshi price freshness automatic. The core technical abstraction is that **almost none of this is new data — it is a new projection of data the system already stores.** The Slate's grouped shape, the player card's threshold stepping, and Prop Research's arbitrary-threshold answer are all read-time reshapings of the same `Projection` rows and the same `probAtLeast()` evaluation that `readSlate` already uses; the pitch adds one new read surface (`/api/research`), one authorization relocation, and one concurrency primitive (a Postgres advisory lock around price refresh). No projection is recomputed and no new fact table is introduced.

It fits the Sunday-morning workflow by answering *what does Sightline like right now, for which players* in one scan, then letting the user open a single player, step through their thresholds and stat types without a round trip, and — via Prop Research — check any line they encounter elsewhere against a distribution Sightline has already computed. Working means: the grouped slate renders from stored data with no model run and a measurably faster initial paint (≥30% LCP reduction against a 300-contract fixture); a viewer's markup contains no trace of any relocated admin surface and every relocated route rejects a viewer server-side; Prop Research reports `P(≥)` and `P(<)` that sum to exactly 100% and never renders an edge without a real market price; and concurrent viewers opening the Slate produce exactly one upstream Kalshi refresh.

Ranking, edge computation, staleness semantics, the projection engine, recalibration, and position sizing are all unchanged. This pitch reorganizes and presents; it does not remodel.

## 2. Problem

The system today can produce the grouped, best-first, player-centered experience the pitch wants, but only as a flat list of contracts ranked by confidence-adjusted edge — the same player appears once per threshold, game context repeats on every row, and the strongest opportunities compete visually with hundreds of others. It cannot yet:

- Present a player once per game with their thresholds and stat types reachable inside a single unit.
- Answer an arbitrary player/stat/threshold question ("Stafford over 225.5 passing yards?") for a line Kalshi does not list, even though the stored distribution already contains the answer.
- Keep prices fresh without a privileged user pressing "Refresh Prices."
- Restrict general model-accuracy analytics to the admin — the Architecture Doc currently makes it a shared viewer surface.
- Show the first useful slate render without paying the rendering cost of every contract's detail up front.

This blocks the PRD's primary journey — *open the app, find the strongest opportunities, understand them, research a line* — and it is the last user-experience pitch before the model-shadow and live-trading pitches, so the surface the group actually uses is defined here.

## 3. Scope and non-scope

### In scope

- Grouped Slate read shape: game → player → props, with a best-opportunities-first cross-game ordering derived from the existing ranking.
- Player card model: one player per game, a computed "best opportunity," and all thresholds/stat types delivered for local (no-refetch) stepping.
- Player search and combinable filters (game, team, date/window, stat type, recommendation/direction, confidence, market availability) as read-time selection over already-loaded rows.
- Progressive disclosure: distribution and drivers load only on detail; the collapsed card carries a summary.
- Inline adjustment context: accepted-adjustment note for both roles; inline pending accept/decline for admin, reusing Pitch 9 routes.
- Simplified freshness vocabulary (five states) derived from existing stored signals, with raw timestamps retained in detail and Health.
- Automatic price refresh: freshness-gated on-view/return refresh reusing the server-side Kalshi integration; a Postgres advisory lock preventing concurrent duplicate upstream calls; manual refresh demoted to an admin diagnostic.
- Prop Research: a new read surface computing `P(≥ threshold)` / `P(< threshold)` from a stored base distribution for an upcoming (pre-kickoff) player/stat/game, viewer-accessible, probability-only.
- Admin information architecture: Accuracy (and model comparison) moved behind `requireAdmin()`; Suggestions removed from primary nav; nav reorganized into an Admin group; every relocated route server-guarded and covered by the isolation test suite.
- Accuracy plain-language summary layer above the existing (retained) advanced panels.
- Performance measurement: a 300-contract seed fixture, an automated Lighthouse LCP check, a committed pre-change baseline, and a CI gate asserting ≥30% LCP reduction.

### Out of scope

- Any change to the projection engine, simulation, recalibration, position sizing, or ranking algorithm (RD-5).
- Any new Kalshi client, credential location, or second scheduling path.
- A payout/price-entry system for Prop Research or any external-platform integration/scraping.
- Recomputing projections in response to a typed threshold or refreshing projections on the price cadence.
- Any new caching/CDN/database tier.
- Building a general historical research tool or projecting players not already in the serving set.

## 4. Core concepts

| Concept | Description |
| ------- | ----------- |
| `GameGroup` (DTO) | A scheduled, not-yet-kicked-off game with its teams, kickoff, aggregate freshness, and its player cards. Read-time grouping of existing rows; not persisted. |
| `PlayerCard` (DTO) | One player within one game. Carries the player's **best opportunity** and all their props (per stat type), each with a precomputed probability and edge. Not persisted. |
| Best opportunity | The player's prop with the greatest `confidenceAdjustedEdge`, using the existing `computeEdge`/`compareSlateRows` logic unchanged. Both directions eligible. |
| Prop (DTO) | One (contract or stored-projection) threshold+direction for a player/stat, with `modelProbability`, `confidence`, market price (nullable), and `edgePoints` (nullable). |
| Prop Research result | `P(≥ threshold)` and `P(< threshold)` for a stored **base** distribution, plus projected value, interval, confidence, drivers, freshness, provenance. Never an edge. |
| Freshness state | A plain-language label (`current`, `updated_recently`, `new_info_pending`, `stale`, `unavailable`) derived from existing signals; price freshness and projection freshness remain distinct facts. |
| Price-refresh advisory lock | A transaction-scoped Postgres advisory lock keyed by the affected market set, ensuring concurrent staleness-triggered refreshes produce exactly one upstream Kalshi call. |
| Relocated admin surface | A route that was shared or standalone and is now under the admin boundary: `/accuracy` (and children), model comparison, `/suggestions`. |

Invariants this feature must preserve (an agent will collapse these if not told):

- **`computedAt` and `informationCutoff` are two timestamps.** Neither is removed by the freshness simplification.
- **Edge is derived; `RecommendationSnapshot` is stored.** No stored edge, no `isStale` column, no denormalizing job is added.
- **Staleness is computed on read from the game's own kickoff.** The five-state vocabulary is a display mapping over the existing `StalenessDto`, not a new stored state.
- **Base and shadow projections both exist and are both graded.** Prop Research reads the **base** projection only; accepted-shadow resolution on the Slate is unchanged from Pitch 9.
- **Prices never feed projections.** Prop Research and the grouped read never let a price influence a probability. No modelling/feature code path is touched.
- **Prop Research probability-only.** `P(≥) + P(<) = 100%` exactly; no edge without a real market price.
- **`took`/`faded`/`skipped` are three states; unmarked is the absence of a `Decision`.** Unchanged; still admin-only.

## 5. States and lifecycle

No new persisted enums. The feature relies on existing enums (`StatType`, `Confidence`, `SuggestionStatus`, `ProjectionProvenance`, `Disposition`) and derives display states.

### Freshness state derivation (display-only)

| Derived state | Condition (from existing signals) | Treatment |
| ------------- | --------------------------------- | --------- |
| `current` | Projection not stale (`isStale=false`, `predatesInactives=false`); freshest price within on-view interval | Neutral |
| `updated_recently` | Price refreshed within interval; projection not stale; no material pending suggestion | Neutral |
| `new_info_pending` | A material pending `AdjustmentSuggestion` exists for the player/game, OR `predatesInactives=true` and not yet past boundary | Caution |
| `stale` | `StalenessDto.isStale=true`, or `predatesInactives=true` past the inactives boundary | Caution, list-visible |
| `unavailable` | No current projection, or Kalshi degraded (no fresh price) | Neutral, last-known time or `—` |

Price freshness and projection freshness are computed separately; a successful price refresh never sets a projection state to non-stale, and a projection recompute never marks the price current.

### Suggestion accept/decline (unchanged Pitch 9 transitions, new entry point)

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| `pending` | `accepted` | admin only | Shadow becomes the active projection via the existing resolver; base untouched and still graded. Card projection + note update in place. |
| `pending` | `declined` | admin only | Base remains active; shadow untouched and still graded. Card removes the pending band. |

The inline Slate action posts to the existing `/api/suggestions/[id]/accept|decline` routes; no new suggestion state or mechanism is introduced.

### Prop Research availability (RD-4)

| Condition | Result |
| --------- | ------ |
| Current stored **base** `Projection` exists for player/stat/game AND `game.kickoffAt > now` | Result computed |
| No current stored base projection (or a `ProjectionDecline` row) | Honest "no current projection" state; never a fallback |
| `game.kickoffAt <= now` | "This game has started" state; no probability shown |

## 6. UI integration

Reference the design doc for full UI/UX. This section specifies the technical support.

### Screens

| Screen | Data needed | Actions |
| ------ | ----------- | ------- |
| Slate (grouped) | `SlateGroupedDto` (games → players → props + bestOpportunities + availableStatTypes + price freshness) | search, filter, toggle view, expand card, open detail, admin accept/decline |
| Player card | Delivered within `SlateGroupedDto`; no per-card fetch | stat/threshold selection (local), open detail, accept/decline (admin) |
| Player/prop detail | Existing `ContractDetailDto` (unchanged) | take/fade/skip (admin), accept/decline (admin), Esc-close |
| Prop Research | `PropResearchProjectionDto` (distribution + metadata) delivered for local recompute; player search results | search player, select game/stat, enter threshold, view result, link to contract |
| Accuracy summary | Existing accuracy reads + a derived `AccuracySummaryDto` | expand Advanced analysis; scope selectors unchanged |
| Admin nav | `visibleSections(role)` (extended) | navigate to admin destinations (admin only) |

### Components

| Component | Data contract | Notes |
| --------- | ------------- | ----- |
| `SlateControls` | `availableStatTypes`, `availableGames`, current scope | Search + filters operate on loaded data; write URL params; never refetch the whole slate |
| `GameGroup` | `GameGroupDto` | Collapsible; freshness chip + player count |
| `PlayerCard` | `PlayerCardDto` | Collapsed shows `bestOpportunity`; expanded stat/threshold table from `props`; adjustment context by role |
| `PropResearchForm` / `PropResearchResult` | `PropResearchProjectionDto` | Threshold recompute is local via shared `probAtLeast`; no round trip |
| `AutoRefreshIsland` | on-view/return trigger; freshness interval | Replaces/extends `SlatePoller`; POSTs Sightline's own refresh route only |
| `AccuracySummary` | `AccuracySummaryDto` | Interprets existing metrics; adds no new metric |

### Material UI integration

- Player card, game group, threshold table, filters, and the Prop Research form use themed MUI components (`Card`, `Collapse`, `Table`, `ToggleButtonGroup`, `Popover`/`Drawer`, `Autocomplete`, `TextField`, `Accordion`). Distribution graphics reuse the existing `DistributionSummary`/`PmfBars` (Recharts, theme-driven).
- Loading uses `Skeleton` at matching heights; the slate never shows a spinner waiting on a model run.
- Filters collapse into a full-width `Drawer` at `xs`; nothing scrolls horizontally at any breakpoint; player-card collapsed height is identical across recommended/below-threshold variants.
- Accessibility: `aria-expanded` on cards, labelled tablist for the stat selector, header semantics on the threshold table, text-equivalent summaries for distribution charts, announced above/below figures in Prop Research.

## 7. Data model

**No new Prisma models and no new columns.** This feature is read-shape, authorization, and concurrency; the schema is unchanged.

### Relationship to existing schema (reads only)

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| Grouped slate read | reads | `Game`, `Contract`, `Projection`, `PriceObservation`, `AdjustmentSuggestion` | Same reads as `readSlate`, regrouped by game→player |
| Prop Research read | reads | `Player`, `Game`, `Projection` (provenance `base`), `ProjectionDriver`, `ProjectionDecline` | Selects a current base projection for an upcoming game |
| Price refresh | reads/writes | `MarketSyncRun`, `PriceObservation` | Unchanged write path; adds an advisory lock around `runMarketSync` |

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Best opportunity | no | max `confidenceAdjustedEdge` across a player's props | Uses existing `computeEdge`/`compareSlateRows`; RD-5 |
| Grouped structure | no | games → players → props over existing rows | Read-time grouping |
| Freshness state | no | `StalenessDto`, price age, material pending suggestion | Display mapping; §5 |
| Prop Research `P(≥)` / `P(<)` | no | stored base distribution via `probAtLeast` | `P(<) = 1 − probAtLeast`; RD-1 |
| Price-refresh dedup | no | Postgres advisory lock + existing min-interval coalescing | §10 |

### Raw SQL constructs

The advisory lock uses Postgres session/transaction functions, not schema DDL:

```sql
-- Transaction-scoped advisory lock keyed by a stable hash of the affected market set.
-- Acquired at the start of a staleness-triggered refresh; auto-released at COMMIT/ROLLBACK.
-- A concurrent caller that cannot acquire it immediately skips the upstream call and
-- reads whatever price the in-flight refresh writes. No schema change.
SELECT pg_try_advisory_xact_lock(hashtext($1));  -- $1 = market-set key, e.g. "price-refresh:v1"
```

No new RLS policies are required; the relocation of Accuracy is enforced in the route/server layer (§9), consistent with the project's server-side-first authorization posture. RLS on user-scoped tables remains an open item (§16), unchanged by this pitch.

## 8. Authorization and access control

Two roles, admin and viewer; not multi-tenancy. This pitch **narrows** viewer access.

| Resource | Read | Notes |
| -------- | ---- | ----- |
| Slate (grouped) | admin + viewer | Shared; grouping and search/filter are not admin-gated (No-Go: player search / basic filters must not be admin-only) |
| Player/prop detail | admin + viewer | Shared; take/fade/skip + accept/decline remain admin-only inline actions |
| Prop Research (`/research`, `/api/research/*`) | admin + viewer | Shared; viewer-accessible per pitch |
| Accuracy (`/accuracy` + children) | **admin only** | CHANGED from shared. `page.tsx` guard changes `requireSession()` → `requireAdmin()`; role branching in `readAccuracy` collapses to admin-always |
| Model comparison | admin only | Under the admin boundary |
| Suggestions (`/suggestions`, accept/decline) | admin only | Unchanged (already admin); removed from primary nav |
| Manual price refresh (`/api/prices/refresh` when invoked as a diagnostic) | admin only for the explicit control | The automatic on-view refresh path requires an authenticated session (any role) because it is the shared slate keeping itself current; the **manual button/control** is admin-only diagnostics |
| Pipeline price-refresh route | bearer token | Unchanged backstop |

Rules:

- **Every relocated route rejects a viewer server-side** via the existing `requireAdmin()` → `forbidden()` (in-place 403), never a redirect and never a partial shell. The nav filter (`visibleSections`) is a courtesy, not the boundary.
- `visibleSections(role)` is updated so `Accuracy` becomes `adminOnly: true`, `Suggestions` leaves primary nav, and a viewer's visible set is exactly `Slate`, `Prop Research`, `Settings`.
- `userId` for any admin action is resolved from the session, never the client. No role is ever accepted from a request body.
- The Python runtime is untouched; no route handler uses the service-role credential.

Worked guard (Accuracy relocation):

```typescript
// src/app/(app)/accuracy/page.tsx — was requireSession(); now:
export default async function AccuracyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();               // rejects viewers in place with 403
  const scope = parseAccuracyScope(await searchParams);
  const accuracy = await readAccuracy(scope, "admin");   // role branch collapses to admin
  return <Accuracy accuracy={accuracy} />;
}
```

## 9. Route handlers and API surface

Reads happen in server components through Prisma. New/changed HTTP surfaces:

```http
GET  /api/research/players?q={partial}          # players with a current stored upcoming base projection
GET  /api/research/projection?playerId&gameId&statType   # the base distribution + metadata for local recompute
POST /api/prices/refresh                          # existing; now advisory-locked + freshness-gated (any session)
```

`/api/slate` (existing) returns the grouped DTO after this pitch; the server component reads directly via `readSlateGrouped`.

### Prop Research player search

```typescript
export type ResearchPlayerDto = {
  playerId: string;
  fullName: string;
  games: Array<{ gameId: string; label: string; kickoffAt: string; statTypes: StatType[] }>;
};
// GET /api/research/players?q= → { players: ResearchPlayerDto[] }
// Only players with >=1 current base Projection for a game with kickoffAt > now.
```

### Prop Research projection

```typescript
export type PropResearchProjectionDto = {
  playerId: string;
  playerName: string;
  gameId: string;
  gameLabel: string;
  kickoffAt: string;            // used to enforce pre-kickoff on the client too
  statType: StatType;
  // Distribution delivered so the client recomputes P(>=)/P(<) locally on threshold change.
  distributionKind: string;
  params: Record<string, number>;
  pmf: number[] | null;
  quantiles: Record<string, number> | null;
  projectedValue: number;
  projectedMedian: number;
  intervalLow: number;
  intervalHigh: number;
  confidence: Confidence;
  drivers: string[];
  computedAt: string;
  informationCutoff: string;
  modelVersion: string;
  freshness: FreshnessStateDto;
  // Present only when a currently-listed contract at the *entered* threshold exists with a fresh price.
  listedContractId: string | null;   // resolved per-threshold client-side against a small listed-set
};
// GET /api/research/projection?playerId&gameId&statType
//   404-equivalent JSON { available: false, reason: "no_projection" | "game_started" } when unavailable.
```

- The threshold is **not** a server parameter for the probability: the client recomputes `P(≥)`/`P(<)` locally via the shared `probAtLeast` so typing is instant and no engine runs. The server may also expose a pure `evaluate` helper for tests.
- `listedContractId` supports the "View contract" link only; Prop Research computes no edge (RD-8).

### Automatic price refresh

`POST /api/prices/refresh` keeps its signature and degraded-mode behavior. Changes:

- Wrap `runMarketSync()` in the advisory lock (§10). Callers that cannot acquire the lock return the current stored state (`coalesced: true`) without an upstream call.
- Freshness gating: the `AutoRefreshIsland` triggers this only when the freshest stored price exceeds the on-view freshness interval (`PRICE_ONVIEW_FRESHNESS_SECONDS`). A viewer session is sufficient; the explicit manual **control** is admin-only.

Error responses follow `references/api-conventions.md`. Kalshi unavailable returns 200 with `degraded: true`, never 5xx.

## 10. Concurrency: price-refresh advisory lock (RD-2, RD-7)

The existing coalescing is an in-process `inFlight` gate plus a DB min-interval check — insufficient across serverless instances. Add a transaction-scoped Postgres advisory lock:

```typescript
// src/lib/kalshi/refresh-lock.ts (new)
export async function withPriceRefreshLock<T>(
  marketSetKey: string,
  run: () => Promise<T>,
  onBusy: () => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext(${marketSetKey})) AS locked`;
    if (!locked) return onBusy();     // another refresh holds it → read latest stored prices
    return run();                      // sole caller performs the upstream Kalshi sync
  });
}
```

- **`onBusy` performs no Kalshi call** — it returns the freshest stored `PriceObservation` set. This is the mechanism satisfying "concurrent viewers do not create uncontrolled duplicate Kalshi refreshes" and the required test "two concurrent staleness-triggered refreshes → exactly one upstream Kalshi call."
- The "30-second TTL" from RD-2 is expressed by the freshness/min-interval gate (`KALSHI_SYNC_MIN_INTERVAL_SECONDS` / `PRICE_ONVIEW_FRESHNESS_SECONDS`, defaulted to 30s for the on-view path): the advisory lock guarantees single-flight for the duration of a refresh, and the interval guarantees a fresh result is reused rather than re-fetched. The lock auto-releases at transaction end, so no stuck lock can outlive a crashed request.
- The backstop GitHub Actions `pipeline-prices.yml` is unchanged; its cadence is NOT increased (avoids the "GitHub Actions as a price ticker" rabbit hole). The ≈5-minute target is the on-view freshness interval, not the scheduler cadence.

## 11. Validation rules

| Field / input | Validation | Behavior |
| ------------- | ---------- | -------- |
| Slate filter params | Lenient parse; unknown → default | Never errors; over-narrow → empty state |
| `q` (search) | trimmed string | Empty → unfiltered |
| Prop Research `playerId`/`gameId` | must exist and resolve to a current base projection for a pre-kickoff game | Unavailable → honest no-data JSON, never a fallback |
| Prop Research `statType` | must be a valid `StatType` with a stored distribution | Invalid → no-data state |
| Prop Research threshold | numeric, finite; any real value in support | Non-numeric → result disabled with inline helper; prior result preserved |
| Accept/decline (admin) | suggestion must be `pending`; admin session | Non-pending → `invalid_state_transition`; viewer → 403 |
| Price refresh | authenticated session | Manual control admin-only; Kalshi outage → degraded 200 |

- **Warn, not block:** no projection, nothing recommended, no market for a stat, an unresolved contract — all displayable.
- **Block:** any attempt to display an edge in Prop Research without a market price; any client-supplied probability or role; any credential exposure.
- No internal DB/Prisma text, storage paths, or anything about the Kalshi signing key ever appears in a response.

## 12. UI data contracts

```typescript
export type FreshnessStateDto = {
  state: "current" | "updated_recently" | "new_info_pending" | "stale" | "unavailable";
  // Raw signals retained for detail/Health; the label is derived, the timestamps are not removed.
  projectionComputedAt: string | null;
  informationCutoff: string | null;
  priceObservedAt: string | null;
};

export type PropDto = {
  contractId: string | null;          // null for a stored projection with no listed contract
  threshold: number;
  direction: "above" | "below";
  modelProbability: number | null;    // null vs 0 are different states
  confidence: Confidence | null;
  bidCents: number | null;
  askCents: number | null;
  edgePoints: number | null;          // null when no market — not zero
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;
};

export type PlayerCardDto = {
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  statTypes: StatType[];              // derived from stored data, never hardcoded
  props: PropDto[];                   // all thresholds across stat types
  bestOpportunity: PropDto | null;    // max confidenceAdjustedEdge; null if none has edge
  projectionState: "projected" | "insufficient_evidence" | "none";
  freshness: FreshnessStateDto;
  adjustment: { kind: "accepted" | "pending" | null; note: string | null; suggestionId: string | null };
  // Admin-only fields ABSENT (not null) from viewer payloads:
  currentDisposition?: Disposition;
  decidedAt?: string;
};

export type GameGroupDto = {
  gameId: string;
  homeTeam: string; awayTeam: string;
  kickoffAt: string;
  freshness: FreshnessStateDto;
  players: PlayerCardDto[];
};

export type SlateGroupedDto = {
  games: GameGroupDto[];
  bestOpportunities: Array<{ playerId: string; gameId: string; prop: PropDto; playerName: string; teamAbbreviation: string; kickoffLabel: string }>;
  unresolved: UnresolvedRowDto[];     // unchanged
  availableStatTypes: StatType[];
  availableGames: Array<{ gameId: string; label: string }>;
  pricesUpdatedAt: string | null;
  priceDegraded: boolean;
};

export type PropResearchResultDto = {
  // computed client-side from PropResearchProjectionDto for the entered threshold
  threshold: number;
  probabilityAbove: number;           // P(stat >= threshold)
  probabilityBelow: number;           // P(stat < threshold) === 1 - probabilityAbove
  // no edge, no profitability — ever
};

export type AccuracySummaryDto = {
  verdict: "calibrated" | "provisional" | "drifting";
  thresholdObservations: number;
  projectionCount: number;
  brier: number | null;
  brierGloss: string;                 // "lower is better; 0.25 ≈ coin flip, 0 perfect"
  calibrationVerdict: string;
  baselineVerdict: string;
  marketVerdict: string;              // "insufficient comparable observations" framed as not-enough, not bad
  trend: "improving" | "stable" | "deteriorating" | "insufficient";
};
```

- Derived field names are identical across surfaces: `edgePoints`, `confidenceAdjustedEdge`, `modelProbability` match the existing `SlateRowDto`.
- `modelProbability`/`edgePoints` null ≠ zero, enforced in serializers.
- Admin-only fields are structurally absent from viewer payloads (separate code paths), matching the existing pattern.

## 13. Testing strategy

Organized by area, GIVEN/WHEN/THEN. Sightline's risk order applies; for this pitch the load-bearing categories are role enforcement, prices-never-feed-projections (structurally preserved), and the pitch-specific correctness tests.

**Grouped slate**
- GIVEN a player with six thresholds across two stat types WHEN the slate reads THEN the player appears exactly once per game with all props under one `PlayerCardDto`.
- GIVEN mixed above/below props WHEN best opportunity is chosen THEN it is the max `confidenceAdjustedEdge` and a below-direction prop can win (RD-5).
- GIVEN a filter combination with no matches WHEN applied THEN an empty state is returned and no probability changes.
- GIVEN below-threshold props WHEN the slate renders THEN they remain present and de-emphasised, never removed.

**Threshold semantics (RD-1) — required**
- GIVEN a discrete-stat stored distribution and an integer threshold N WHEN computing THEN `P(≥N) + P(<N) === 1` exactly, with no separately-vanishing "exactly N" mass. Assert across the golden fixture for NB and empirical-PMF families.
- GIVEN a continuous stat WHEN computing at a `.5` threshold THEN `P(≥) + P(<) === 1` and `≥`/`>` agree (zero point mass).

**Prop Research — required**
- GIVEN a player/stat with no current stored distribution WHEN researched THEN the result is the "no current projection" state and never a season average or any approximation.
- GIVEN no market price for the entered threshold WHEN a result renders THEN no edge or profitability value appears anywhere in the payload/DTO (RD-8).
- GIVEN a game with `kickoffAt <= now` WHEN researched THEN the "game started" state returns and no probability is shown (RD-4).
- GIVEN a threshold change WHEN recomputed THEN no projection query/engine run occurs (recompute is local).
- GIVEN a base and an accepted-shadow projection WHEN researched THEN Prop Research reads the base distribution (does not silently use the shadow).

**Duplicate-refresh lock (RD-2) — required**
- GIVEN two concurrent staleness-triggered refreshes for the same market set WHEN both run THEN exactly one acquires the advisory lock and performs the upstream Kalshi call; the other returns the stored result with no upstream call.
- GIVEN a failed refresh WHEN it errors THEN the previous valid `PriceObservation` is retained and freshness degrades visibly.

**Role enforcement (RD-6) — required, extend `e2e/authenticated.spec.ts` and `NavSections.test.ts`**
- GIVEN a viewer session WHEN it deep-links to each relocated route (`/accuracy`, `/accuracy/overrides`, model comparison, `/suggestions`) THEN each returns an in-place 403 with no admin data in the markup and the URL unchanged.
- GIVEN `visibleSections("viewer")` THEN the set is exactly `Slate`, `Prop Research`, `Settings` (no `Accuracy`, no `Suggestions`).
- GIVEN `visibleSections("admin")` THEN every admin destination is present.
- GIVEN a viewer WHEN the slate renders THEN no accept/decline control and no admin decision field is present in the payload/markup.

**Prices-never-feed-projections (invariant)**
- Structural: assert no new Python or modelling import reaches `PriceObservation`/`RecommendationSnapshot`; Prop Research and grouped read are TypeScript read paths only.

**Freshness**
- GIVEN a fresh price and a stale projection THEN the projection state remains stale (a price refresh never clears it) and the two facts render distinctly.

**Performance (RD-3, RD-10)**
- CI: seed the 300-contract fixture, run Lighthouse LCP against the pre-change baseline and the feature branch; assert ≥30% LCP reduction. **Enforcing** as of SIG-99 (`PERF_ENFORCE_LCP=1`, no `continue-on-error`) — a branch that misses the bar is a red build. The gate is inert against a placeholder baseline by design (`lcpCompare.comparabilityReason`), so the real pre-change baseline is captured in the provisioned CI environment per `docs/v1/perf/README.md`.

## 14. Acceptance criteria

**Slate hierarchy**
- [ ] The default Slate is not one uninterrupted repeated-player list; opportunities are navigable by game.
- [ ] A player appears once per game; multiple thresholds and stat types are reachable within the player experience.
- [ ] Selecting a different threshold/stat updates probability, price, edge, recommendation, confidence from loaded data (no refetch, no model run).
- [ ] Strongest opportunities are accessible without scrolling the whole market; both YES/Over and NO/Under can qualify; ranking is unchanged.
- [ ] Below-threshold contracts remain discoverable, de-emphasised.

**Search & filters**
- [ ] Player search tolerates partial input; game/team/date/stat/direction/confidence/market filters combine; reset returns to default best view; zero-result empty state; filtering never changes a probability.

**Player/prop detail**
- [ ] Distribution, drivers, range, probability, confidence, market/edge (when valid), freshness, and provenance are present; usable on mobile without horizontal scroll; distribution renders only in detail.

**Adjustment suggestions**
- [ ] Admin reaches accept/decline inline from the affected player without a standalone Suggestions screen; Pitch 9 behavior retained; accepted adjustments reflected on the Slate; viewers cannot accept/decline and never see the action; reliability analytics remain admin-only.

**Viewer experience & admin IA**
- [ ] Viewer primary nav is Slate + Prop Research (+ Settings); viewer cannot access Accuracy, model comparison, Suggestions, Autonomy, Dry Run, bankroll, Health, Users by any route; every relocated route rejects a viewer server-side; admin reaches all capabilities from the Admin area with no capability weakened.

**Accuracy simplification**
- [ ] First view is plain-language with sample sufficiency; Brier retained with interpretation; baseline and market comparison retained; insufficient market sample framed as insufficient evidence; advanced calibration/reliability retained underneath; sample sizes shown for rates.

**Automatic price refresh**
- [ ] Routine use requires no manual refresh; on-view/return check triggers a server refresh when stale; concurrent viewers produce exactly one upstream call; a failed refresh retains the previous price and degrades freshness visibly; manual refresh is admin diagnostic only; no credential reaches a client; no new paid scheduler.

**Projection freshness**
- [ ] Price and projection freshness stay distinct; a price refresh never clears a stale projection; `computedAt`/`informationCutoff` intact.

**Prop Research**
- [ ] Viewer-accessible; searches players with a current stored upcoming projection; arbitrary threshold; `P(≥)`/`P(<)` complementary; central value, range, confidence, drivers, freshness shown; no edge without a market price; honest no-projection state; threshold change runs no engine.

**Performance**
- [ ] 300-contract baseline measured pre-change; feature branch shows ≥30% LCP reduction in CI; initial slate does not wait for charts or a model run; optimizations proportionate to scale; no new cache/CDN/DB tier.

## 15. Explicit non-goals

- **Permanent:** sportsbook/DFS integration or scraping; external betting credentials; a payout calculator for external platforms; public/commercial access; live in-game trading; film/tape inputs; viewers trading through the app; general sports-data browsing; any economic-edge claim in Prop Research without a market price.
- **Deferred (not precluded):** a payout/price-entry system to compute edge on external lines; NBA/WNBA; friend pick sharing; additional stat types; additional suggestion sources; a general historical research tool.

## 16. Open questions

1. **Edge against ask vs midpoint** — inherited, unchanged. The grouped read reuses the existing `computeEdge` decision; this pitch does not resolve it.
2. **Grading truth (settlement vs official)** — inherited; not touched by this pitch.
3. **Superseded model versions on the accuracy surface** — inherited; the summary layer reports the active version by default, consistent with the existing scope selector.
4. **RLS on user-scoped tables** — inherited; unchanged. Server-side checks remain primary.
5. **On-view freshness interval default** — assumed 30s (aligns with the RD-2 lock TTL); adjustable without changing the product requirement. Non-blocking.
6. **Model comparison route** — if a dedicated `/accuracy/compare` or model-comparison route does not yet exist as its own path, the per-version split remains inside `/accuracy`; either way it is admin-only. Non-blocking.

## 17. Future considerations

- Prop Research's local distribution evaluation is the natural substrate for a later external-line payout/edge feature (deferred) — a payout input plus the existing `probAtLeast` yields edge without new modelling.
- The grouped `SlateGroupedDto` is sport-agnostic (player/game/stat), preserving the NBA/WNBA path.
- The Admin area grouping gives later operational pitches (model shadow evaluation, live trading) a home without further nav restructuring.
