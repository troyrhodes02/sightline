# API Conventions

Standard patterns for Sightline route handlers, server mutations, and the Kalshi proxy surface.

Sightline is an invite-only tool for one admin and a handful of view-only friends — not a public API product. Every request runs in the context of the caller's authenticated session and role; nothing here should imply otherwise. Most reads happen in server components through Prisma and never touch a route at all. These conventions apply when defining explicit route handlers, mutation contracts documented in specs, or any endpoint-like surface.

For the access model, integration list, and what is deferred, read `CLAUDE.md`. This file covers shape and naming only.

## Scope

Use these conventions for:

- Route handlers that need a stable request/response contract
- Server mutation contracts documented in technical specs
- The Kalshi proxy and price-refresh surface
- Any endpoint-like surface needing consistent naming, errors, validation, and response shapes

Do not create public API endpoints. Sightline has no external consumers and no path toward having any.

## Base configuration

```text
Base URL: /api
Authentication: Supabase session, verified server-side on every route
Content-Type: application/json
```

There is no versioned integration-facing API and no API-key surface. If a spec proposes one, that is a new pitch, not a convention question.

## Resource naming

Use plural nouns for collections.

```text
/api/contracts
/api/projections
/api/prices
/api/recommendations
/api/suggestions
/api/decisions
/api/positions
/api/outcomes
/api/backtest-runs
/api/users
/api/invitations
```

Use nested resources where ownership is part of the domain.

```text
/api/contracts/:contractId/projections
/api/contracts/:contractId/decision
/api/backtest-runs/:runId/calibration-bins
```

Use action names only for operations beyond ordinary CRUD.

```text
POST /api/prices/refresh
POST /api/suggestions/:id/accept
POST /api/suggestions/:id/decline
POST /api/orders
POST /api/users/:id/revoke
```

- Resource names match the PRD data objects exactly.
- Keep action endpoints domain-specific. `accept` and `decline` are real domain transitions with different grading semantics; a generic `PATCH /api/suggestions/:id` with a status field would hide that.
- Do not create generic workflow verbs when a normal update is enough.
- Do not model deferred work in route naming. No `/api/bankroll`, no `/api/nba`, no `/api/picks`.

## Resource inventory

| Resource | Purpose |
| -------- | ------- |
| `contracts` | Kalshi player-prop markets resolved to a player, stat type, threshold, and game — or flagged unresolved |
| `projections` | Sightline's distribution over a player's outcome, with confidence, drivers, and provenance |
| `prices` | Timestamped readings of a contract's book, both sides |
| `recommendations` | Stored recommendation snapshots, retained for grading |
| `suggestions` | Adjustment suggestions with source, evidence, proposed change, and status |
| `decisions` | The admin's disposition toward a contract, with its decision-time snapshot |
| `positions` | Holdings resulting from executed orders, linked to decision, recommendation, and projection |
| `outcomes` | Settlement and official results; the grading source |
| `backtest-runs` | Stored harness executions with configuration, code version, and aggregate results |
| `users` | Accounts and roles |
| `invitations` | Invite state |

Aggregate reads — `/api/slate`, `/api/accuracy`, `/api/health` — are covered under Aggregates below rather than being resources.

## Request patterns

### List

```http
GET /api/contracts?game_id=:id&stat_type=receiving_yards&resolved=true&limit=50&offset=0&sort=confidence_adjusted_edge&order=desc
```

| Param | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `limit` | int | `50` | Max results |
| `offset` | int | `0` | Pagination offset |
| `sort` | string | `confidence_adjusted_edge` | Sort field |
| `order` | string | `desc` | `asc` or `desc` |
| `game_id` | uuid | none | Restrict to one game |
| `stat_type` | enum | none | Restrict to one stat type |
| `resolved` | bool | none | Filter unresolved contracts in or out |
| `kickoff_after` / `kickoff_before` | ISO 8601 | none | Kickoff window |

Response envelope:

```json
{ "contracts": [], "total": 0, "limit": 50, "offset": 0 }
```

Offset pagination is correct for this product. A slate is fourteen games and tens of contracts; the largest list in the system is backtest calibration bins, which is still small. Cursor pagination would be machinery without a problem.

### Get

```http
GET /api/contracts/:id
```

Returns the full resource the caller is allowed to access. Contracts, projections, and prices are shared reference data, so a `404` here means the resource genuinely does not exist. For `decisions` and `positions`, which are user-scoped and admin-only, a resource belonging to another user must be indistinguishable from a nonexistent one — return `not_found`, never `forbidden`, because `forbidden` confirms existence.

### Create

```http
POST /api/decisions
```

Minimum required fields are the contract and the disposition. **Snapshot values are never accepted from the client** — the handler reads the freshest projection and price server-side. A request body containing snapshot fields is a validation error, not a value to trust.

```json
{ "contractId": "8f2c...", "disposition": "faded" }
```

Response returns the created resource with id, timestamps, and the server-derived snapshot.

### Update

```http
PATCH /api/decisions/:id
```

Partial update; include only changed fields. Changing a disposition **must not** re-take the decision-time snapshot — the snapshot has to reflect the decision actually acted on, and re-taking it would silently destroy the timing-cost calculation. Record the change as a distinct event.

### Delete

```http
DELETE /api/decisions/:id
```

Decisions and positions are the only data in this system that cannot be reconstructed. Deletes are soft, never cascade, and require explicit confirmation at the UI layer. Contracts, projections, prices, and outcomes are never deleted through an API — they are system-maintained and superseded rather than removed.

## Domain actions

```http
POST /api/prices/refresh
```

```json
{ "gameIds": ["3a1f...", "9c02..."] }
```

```json
{
  "refreshed": 2,
  "observedAt": "2026-10-25T15:42:11Z",
  "rateLimitRemaining": 7,
  "degraded": false
}
```

Rate-limit budget is managed server-side, which is the only reason this is an endpoint rather than a client fetch. A Kalshi outage returns `200` with `"degraded": true` and no price data — degraded mode is a designed state, not an error.

```http
POST /api/suggestions/:id/accept
```

```json
{ "status": "accepted", "projectionId": "1b7d...", "displayedProjectionUpdated": true }
```

Accepting updates the displayed projection. It does not touch the shadow projection, which is computed and graded regardless of status. A response implying otherwise is wrong.

```http
POST /api/orders
```

```json
{
  "contractId": "8f2c...",
  "side": "yes",
  "quantity": 25,
  "limitPriceCents": 56,
  "confirmationToken": "d41f..."
}
```

Order placement requires a `confirmationToken` issued by a prior quote step. A request without one is rejected with `validation_error`. See Idempotency below.

## Response patterns

**Success** — timestamps in ISO 8601 with timezone. Prices are integer cents. Probabilities are numbers between 0 and 1; the UI formats them as percentages.

**Created** — return the created resource with `201`.

**No content** — `204` only when the caller needs no body. Sightline's default is that mutations return the updated resource, so the UI does not need a second fetch.

**Error** — the consistent shape:

```json
{
  "error": "validation_error",
  "message": "Order exceeds the per-slate exposure cap.",
  "details": { "quantity": "Cap remaining: 12 contracts." }
}
```

- Error messages should be human-readable.
- Field-level validation belongs in `details`.
- Do not leak Prisma error text, raw database errors, internal policy names, service-role behavior, connection strings, or anything about the Kalshi signing key.

## Standard error codes

| Code | HTTP status | When to use |
| ---- | ----------- | ----------- |
| `not_found` | 404 | Resource does not exist or is not accessible to this caller |
| `validation_error` | 400 | Invalid request payload |
| `invalid_state_transition` | 400 | Action not allowed for the current state — accepting an already-declined suggestion, deciding on a settled contract |
| `duplicate_resource` | 409 | Hard uniqueness violation |
| `conflict` | 409 | Write conflict, or a market that closed between quote and confirmation |
| `unauthorized` | 401 | Missing or invalid session |
| `forbidden` | 403 | Authenticated but not permitted — viewer reaching an admin route |
| `rate_limited` | 429 | Kalshi rate-limit budget exhausted |
| `upstream_unavailable` | 503 | Kalshi, ESPN, or Open-Meteo unreachable where the route cannot degrade |
| `internal_error` | 500 | Unexpected server error |

Sightline has no upload surface, so `unsupported_media_type` and `payload_too_large` are not part of this product's error vocabulary.

## Duplicate and conflict handling

Sightline's posture is **warn rather than block** wherever the PRD treats an unusual state as legitimate, and **block** only where money or an invariant is involved.

Warn — return `200` with a warning payload rather than an error:

```json
{
  "decision": { "id": "...", "disposition": "took" },
  "warnings": [
    {
      "code": "existing_decision",
      "message": "A decision already exists on this contract. This one supersedes it."
    }
  ]
}
```

Warn cases: a second decision on a contract that already has one; a suggestion contradicting an earlier suggestion from the same source; a decision logged on a contract with no projection; a decision logged after kickoff.

Block with `409 conflict`: an order whose market closed between quote and confirmation, and a duplicate order submission carrying the same idempotency key with a different payload.

Use `409 duplicate_resource` only when a true uniqueness constraint prevents the write — a second pending invitation for an email that already has one.

## Filtering and sorting

```text
Exact match:     ?stat_type=rushing_yards
Partial search:  ?search=chase
Multiple values: ?stat_type=receiving_yards,rushing_yards
Date ranges:     ?kickoff_after=2026-10-25T00:00:00Z&kickoff_before=2026-10-26T00:00:00Z
```

| Sort field | Usage |
| ---------- | ----- |
| `confidence_adjusted_edge` | The slate default — a smaller edge on a high-confidence projection can outrank a larger edge on a shaky one |
| `edge_points` | Raw disagreement, for inspection |
| `kickoff` | Chronological slate review |
| `computed_at` | Finding the oldest projections |
| `observed_at` | Price recency |
| `decided_at` | Decision log |

- Only expose sort fields the backing query actually supports and indexes.
- Filters combine predictably with AND.
- No-match results return an empty collection with `total: 0`, not an error. An empty slate is the most common state of the year and must never be an error.
- `search` covers player name and team abbreviation only.

## Idempotency

```http
Idempotency-Key: {uuid}
```

Required for `POST /api/orders`. An order that succeeds at Kalshi but fails to record locally is a named failure mode in the PRD, and a naive retry turns it into two positions.

- Return the cached response for duplicate keys within the configured window.
- Scope keys to the authenticated caller and the operation.
- Do not reuse keys across different operations.
- Recommended but not required for `POST /api/prices/refresh`, where a duplicate simply writes a redundant observation.
- Not necessary for decisions or suggestion transitions, which are naturally idempotent by target state.

## Aggregates

```http
GET /api/slate?window=upcoming
```

```json
{
  "generatedAt": "2026-10-25T15:42:11Z",
  "rows": [
    {
      "contractId": "8f2c...",
      "playerName": "Ja'Marr Chase",
      "teamAbbreviation": "CIN",
      "statType": "receiving_yards",
      "threshold": 74.5,
      "modelProbability": 0.614,
      "confidence": "high",
      "projectionComputedAt": "2026-10-25T11:02:00Z",
      "informationCutoff": "2026-10-25T10:00:00Z",
      "bidCents": 52,
      "askCents": 54,
      "priceObservedAt": "2026-10-25T15:41:58Z",
      "edgePoints": 7.4,
      "confidenceAdjustedEdge": 6.1,
      "isRecommended": true,
      "isStale": false,
      "isUnresolved": false
    }
  ],
  "degraded": false,
  "staleGameIds": []
}
```

```http
GET /api/accuracy?stat_type=receiving_yards&from=2025-09-01&to=2026-01-31
GET /api/health
```

- **Edge, confidence-adjusted edge, staleness, and recommendation status are computed on read and must not be persisted.** There is no column for any of them and no job that maintains one.
- Ordering is by confidence-adjusted edge descending, and the UI depends on it. Contracts below the recommendation threshold stay in the response with `isRecommended: false` — never filter them out server-side.
- Every rate returned by `/api/accuracy` carries its sample size in the same object. A rate without `sampleSize` is an incomplete response.
- `/api/health` returns last-success timestamps for ingest, recompute, and price refresh, so a silently skipped scheduled job is visible in the product rather than only in a logs tab.

## Security and privacy

All route surfaces must preserve Sightline's privacy model. `CLAUDE.md` states the invariants; this section states the shape-level consequences.

- Require an authenticated session on every route. There are no anonymous endpoints.
- **The Kalshi API key ID and RSA private key must never appear in a response body, an error message, a log line, or a debug field.** All Kalshi calls originate server-side; the browser talks only to Sightline.
- **No route ever accepts a Kalshi credential from a client.** There is no field for one on any request shape, and adding one is a product violation rather than a design choice.
- Admin-only routes check the role server-side and return `403 forbidden` — except on user-scoped resources, where a foreign-owned resource returns `404 not_found` so existence is not confirmed.
- User identity for writes comes from the session, never from the request body.
- Validate every payload server-side, including payloads the UI already validated.
- The service-role credential used by the Python runtime must never be reachable from a route handler.

## Versioning

Use `/api` for all internal routes. There is no external contract, so routes may evolve with the app. Do not add version prefixes speculatively.

## Naming summary

Good Sightline routes:

```text
GET    /api/slate
GET    /api/contracts
GET    /api/contracts/:id
GET    /api/contracts/:id/projections
POST   /api/prices/refresh
POST   /api/suggestions/:id/accept
POST   /api/suggestions/:id/decline
GET    /api/decisions
POST   /api/decisions
PATCH  /api/decisions/:id
GET    /api/accuracy
GET    /api/backtest-runs
GET    /api/backtest-runs/:id
POST   /api/orders
GET    /api/positions
GET    /api/health
POST   /api/invitations
POST   /api/users/:id/revoke
```

Avoid unless a pitch explicitly scopes them:

```text
/api/signup                      — public signup does not exist; accounts come from invitations
/api/auth/register               — same
/api/sportsbooks, /api/dfs       — permanent non-goal; Kalshi is the venue
/api/parlays                     — not a thing Sightline models
/api/picks, /api/subscriptions   — never a commercial product; picks are not sold
/api/live, /api/in-game          — no live in-game trading
/api/users/:id/credentials       — no viewer credential is ever accepted or stored
/api/bankroll                    — deferred to V2, not current scope
/api/nba, /api/wnba              — deferred sports
/api/messages                    — in-app messaging was considered and set aside
/api/backtest-runs/:id/execute   — runs are triggered out-of-band, never from the UI
```

Two routes look like they belong on the avoid list and do not. `POST /api/orders` is approved architecture — it is admin-only, Kalshi-only, gated on a stored backtest run, and enforces a per-slate cap. `POST /api/users/:id/revoke` and `POST /api/invitations` are approved user management, not signup; they are how the closed group is administered.
