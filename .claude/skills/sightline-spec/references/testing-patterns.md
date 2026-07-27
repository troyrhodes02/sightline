# Testing Patterns

Standard test patterns for Sightline feature specs. Jest for TypeScript unit and integration, Playwright for end-to-end, pytest for the Python runtime.

## Test case format

Use GIVEN/WHEN/THEN structure:

```text
TEST: descriptive_snake_case_name
GIVEN: Preconditions describing initial state
  - Specific entity states
  - Relationships that exist
  - Any relevant configuration
WHEN: The action being tested
  - The call with a specific payload, OR
  - The system event that triggers behavior
THEN:
  - Expected state changes
  - Expected response format
  - Side effects
```

## Priority

Ranked, matching `CLAUDE.md` → Testing. Where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins and this file is wrong.

1. **Temporal leakage — adversarial, and first.** It ranks first because it is the only failure in this system that is both silent and flattering: a leaking backtest produces *better* numbers, which is exactly the signal nobody questions. It gates everything downstream, since no calibration figure and no recommendation means anything if leakage is present.
2. **Prices never feed projections.**
3. **Grading and idempotence**, including stat-correction re-grading.
4. **Contract-to-player resolution.**
5. **Kalshi integration, adversarially.**
6. **Role enforcement.**

Lean tests or manual verification are acceptable for low-risk UI and CRUD. The exception that is never lean is anything touching the as-of query layer, `knownAt` handling, or feature computation — that code has no visible failure mode, so tests are the only thing standing between a leak and a season of fictional calibration numbers.

## Required test categories

Every spec must include tests in these categories.

### 1. Happy path

```text
TEST: record_decision_basic
GIVEN: A resolved Contract with a current Projection and a current PriceObservation
WHEN: POST /api/decisions with { contractId, disposition: "took" }
THEN:
  - Decision created with userId from the session
  - Snapshot fields populated from the freshest projection and price
  - decidedAt set
  - Response 201 with the DecisionDto
```

### 2. State transition

```text
TEST: suggestion_accept_updates_display_only
GIVEN: An AdjustmentSuggestion in status pending, with a shadow Projection stored
WHEN: POST /api/suggestions/:id/accept
THEN:
  - Status changes to accepted
  - The displayed projection reflects the proposed change
  - The shadow projection is byte-identical to before the call
  - Both base and shadow remain queued for grading

TEST: decision_change_preserves_original_snapshot
GIVEN: A Decision with disposition took and a snapshot taken at 11:02
WHEN: PATCH /api/decisions/:id with { disposition: "faded" } at 14:30
THEN:
  - Disposition changes to faded
  - Snapshot fields are unchanged from 11:02
  - The change is recorded as a distinct event
  - Timing cost remains computable from the original snapshot
```

### 3. Validation

```text
TEST: decision_rejects_client_supplied_snapshot
GIVEN: A valid Contract
WHEN: POST /api/decisions with a body containing snapshotEdgePoints
THEN:
  - Response 400, error validation_error
  - details identifies the offending field
  - No Decision row created

TEST: order_rejects_missing_confirmation_token
GIVEN: An admin session and sufficient balance
WHEN: POST /api/orders without confirmationToken
THEN:
  - Response 400, error validation_error
  - No order submitted to Kalshi
```

### 4. Side effects

```text
TEST: outcome_ingest_grades_all_dependents
GIVEN: A settled Contract with a Projection, a RecommendationSnapshot, a Decision,
       and an AdjustmentSuggestion with a shadow projection
WHEN: Outcome ingest runs for that contract
THEN:
  - Projection reaches a graded state
  - RecommendationSnapshot scored
  - Decision evaluated
  - Both base and shadow projections graded
  - All writes committed together

TEST: decision_write_atomicity
GIVEN: A valid Contract
WHEN: The snapshot read succeeds but the Decision insert fails
THEN:
  - No partial state persists
  - No Decision row exists
  - The transaction is rolled back in full
```

### 5. Security and privacy

These must try to break the model, not confirm that the happy path is scoped.

```text
TEST: viewer_cannot_reach_any_admin_surface
GIVEN: An authenticated viewer session and an admin with decisions and positions
WHEN: The viewer requests every admin route — decisions, positions, orders,
      override performance, timing cost, suggestion reliability, users,
      invitations — by direct URL, by nested path, and by list filter
THEN:
  - Every path denies
  - User-scoped resources return not_found rather than forbidden, so the
    existence of the admin's decisions is not confirmable
  - No partial shell is rendered before the check
  - No admin data appears in any response body, including error details

TEST: kalshi_signing_key_never_leaves_the_server
GIVEN: Any route that touches the Kalshi integration
WHEN: The route succeeds, fails validation, and fails upstream
THEN:
  - No response body, error message, or log line contains the API key ID
    or any part of the RSA private key
  - The key is not present in any DTO type

TEST: no_route_accepts_a_viewer_credential
GIVEN: The full route surface
WHEN: Request schemas are enumerated
THEN:
  - No schema contains a field for a Kalshi credential
  - A request supplying one is rejected as validation_error, not silently ignored
```

### 6. Edge cases

Drawn from the PRD's edge-case lists.

```text
TEST: empty_slate_is_success
GIVEN: No games scheduled — any day in June
WHEN: GET /api/slate
THEN:
  - Success response, not an error
  - rows: [], total: 0
  - degraded: false

TEST: nothing_clears_threshold
GIVEN: Fourteen contracts, none exceeding the recommendation threshold
WHEN: GET /api/slate
THEN:
  - All fourteen rows returned with isRecommended false
  - No row filtered out
  - Success, not an empty state

TEST: contract_with_price_but_no_projection
GIVEN: A Contract for a rookie the engine declined to project
WHEN: GET /api/slate
THEN:
  - Row present with modelProbability null and edgePoints null
  - null is distinguishable from zero in the response
  - isRecommended false

TEST: kalshi_outage_degrades_not_fails
GIVEN: Kalshi unreachable
WHEN: GET /api/slate
THEN:
  - Success response with projections present
  - Price and edge fields null, degraded true
  - priceObservedAt reflects the last successful fetch

TEST: voided_market_with_logged_decision
GIVEN: A Decision on a Contract that Kalshi later voids
WHEN: Settlement ingest runs
THEN:
  - The Decision is retained
  - Grading reaches an explicit unresolvable state, not a silent skip

TEST: kickoff_moves_shifting_staleness_clock
GIVEN: A Game whose kickoff is rescheduled two hours later
WHEN: Staleness is computed
THEN:
  - The boundary is measured from the new kickoff
  - Contracts for other games are unaffected

TEST: concurrent_order_submission
GIVEN: Two requests with the same Idempotency-Key
WHEN: Both attempt to place the same order
THEN:
  - Exactly one order reaches Kalshi
  - The second receives the cached response
  - Exactly one Position exists
```

### 7. Invariant tests

System properties that must hold over any state. One per named invariant, in `CLAUDE.md`'s rank order.

```text
TEST: temporal_integrity_no_future_facts_reach_a_projection
GIVEN: Any system state
THEN: No Projection was computed from a fact whose knownAt postdates that
      projection's informationCutoff
QUERY: For each Projection, re-run the as-of query layer at its stored
       informationCutoff and recompute
EXPECT: The recomputed projection is identical to the stored one

TEST: temporal_integrity_recompute_is_time_invariant
GIVEN: Any past Game
THEN: A projection for that game is identical whether computed at the time or now
QUERY: Compute at cutoff T, wait, compute again at cutoff T
EXPECT: Byte-identical distributions, given a seeded simulation

TEST: temporal_integrity_adversarial_late_fact
GIVEN: A fact deliberately inserted with knownAt after a cutoff
WHEN: The as-of query layer is queried at that cutoff
THEN: The row is unreachable — not filtered afterward, but absent from the result
EXPECT: Zero rows, and the feature function receives no path to the raw table

TEST: prices_never_feed_projections
GIVEN: Any system state
THEN: No module in the modelling, feature, or simulation path imports or queries
      PriceObservation or RecommendationSnapshot
VERIFY: Import-graph assertion over the Python package, plus a database-role
        check that the modelling path's queries never touch those tables

TEST: known_at_present_on_every_fact_table
GIVEN: Any migration state
THEN: Every table classified as a fact table has non-nullable validAt and knownAt
QUERY: Introspect the schema for fact tables lacking either column
EXPECT: Empty result

TEST: decision_ownership_is_direct
GIVEN: Any Decision or Position row
THEN: The row carries a userId set from a session, never inherited through Contract
VERIFY: Schema check plus a handler-level assertion that no write path reads a
        user identifier from a request body
```

### 8. Integration scenarios

Full lifecycle tests mirroring the PRD journeys.

```text
TEST: pre_kickoff_slate_review_to_settlement
SCENARIO: The primary journey, end to end

STEP 1: Ingest a completed historical corpus and compute projections for a slate
VERIFY:
  - Every projection carries computedAt, informationCutoff, and modelVersion

STEP 2: Sync Kalshi contracts and prices
VERIFY:
  - Every contract resolves to a player, stat type, threshold, and game, or is
    flagged unresolved and surfaced

STEP 3: Read the slate
VERIFY:
  - Rows ranked by confidence-adjusted edge
  - Below-threshold rows present and marked isRecommended false

STEP 4: Log a decision of faded on a contract Sightline did not recommend
VERIFY:
  - Decision anchored to the contract, not to a recommendation
  - Snapshot captured server-side

STEP 5: Pass the inactives boundary without ingesting inactives
VERIFY:
  - That game's contracts marked stale
  - Later games unaffected

STEP 6: Ingest settlement and official results
VERIFY:
  - Projection, recommendation, and decision all graded
  - Timing cost computable from the two snapshots

STEP 7: Apply a stat correction three days later
VERIFY:
  - Affected records re-graded
  - Re-grading is idempotent on a second run
```

### 9. Regression tests

One per bug fixed, named for the behavior rather than the ticket, with the original failure reproduced.

## Test data factories

```typescript
export function createTestProjection(
  overrides: Partial<Projection> = {},
): Projection {
  return {
    id: randomUUID(),
    playerId: overrides.playerId ?? randomUUID(),
    gameId: overrides.gameId ?? randomUUID(),
    statType: "receiving_yards",
    modelVersion: "baseline-0.1.0",
    distributionKind: "quantile_grid",
    distribution: { q: [0.1, 0.25, 0.5, 0.75, 0.9], v: [22, 41, 63, 88, 117] },
    projectedValue: new Decimal("63.000"),
    intervalLow: new Decimal("22.000"),
    intervalHigh: new Decimal("117.000"),
    confidence: "high",
    computedAt: new Date("2026-10-25T11:02:00Z"),
    informationCutoff: new Date("2026-10-25T10:00:00Z"),
    createdAt: new Date("2026-10-25T11:02:00Z"),
    ...overrides,
  };
}
```

```python
def create_test_player_game_context(**overrides) -> dict:
    base = {
        "player_id": str(uuid4()),
        "game_id": str(uuid4()),
        "snap_share": 0.82,
        "injury_designation": None,
        "rest_days": 7,
        "travel_km": 0,
        "valid_at": datetime(2026, 10, 26, 17, 0, tzinfo=timezone.utc),
        "known_at": datetime(2026, 10, 24, 21, 0, tzinfo=timezone.utc),
        "known_at_reconstructed": False,
    }
    return {**base, **overrides}
```

Factory guidelines:

- Provide sensible defaults for every required field.
- Accept partial overrides.
- IDs are UUIDs; timestamps are explicit and timezone-aware. **Never default `knownAt` to `now()` in a factory** — a factory that does will make leakage tests pass while the production path leaks.
- Name clearly: `createTest{EntityName}` in TypeScript, `create_test_{entity_name}` in Python.
- TypeScript factories live alongside the tests that use them; Python factories live in the test package's `factories` module.

## Bitemporal verification

Any test touching a fact table must assert both timestamps, not just one. The common mistake is asserting `validAt` — the interesting one is `knownAt`, because it is the column the invariant depends on and the column a careless ingest will populate with the wrong value.

```text
THEN:
  - validAt equals the time the fact was true of the world
  - knownAt equals the documented reconstruction window for the source, not the
    ingest time and not the game date
  - knownAtReconstructed is true where the value was inferred
  - A query at a cutoff before knownAt cannot see the row
```

For weather specifically, assert the era: archived-forecast source for 2021-forward, reanalysis for earlier seasons, with the era recorded per record so calibration can be reported split across the two.

## Error response verification

Be specific — code, status, message shape, and structured details.

```text
THEN:
  - Response: 400
  - error: `validation_error`
  - details.quantity present and human-readable
  - No Prisma error text, connection string, or key material in any field
```

## Database state verification

For grading, ingest, and order placement, verify the resulting rows directly rather than trusting the response. An order that reports success is not evidence that a `Position` was written — that gap is a named failure mode in the PRD and reconciliation exists because of it.

## Negative tests

Always test what should not happen.

```text
TEST: backtest_run_not_triggerable_from_the_ui
GIVEN: An admin session
WHEN: Any route is probed for a backtest execution trigger
THEN:
  - No such route exists
  - Runs remain out-of-band by design

TEST: trading_blocked_without_a_stored_backtest_run
GIVEN: No BacktestRun rows exist
WHEN: POST /api/orders
THEN:
  - Rejected
  - No order reaches Kalshi
  - State unchanged
```

## Performance

Only three constraints in this system are real, and they come from the Architecture Doc's non-functional requirements:

- **The slate must render from stored data and never wait on a model run.** Assert that the slate read path issues no call into the modelling runtime.
- **Simulation must be vectorised across runs.** A full slate recompute completes well under a minute and a single-game recompute in seconds. A loop-based implementation passes correctness tests and fails this one, which is the point.
- **Kalshi market-data requests stay within roughly ten per second.** Assert the server-side budget, not the client's behavior.

Everything else about this product is three users and a million historical plays. Do not write load tests.
