# Sightline — CLAUDE.md

Sightline tells its admin which of today's Kalshi NFL player-prop contracts are mispriced, and how much to trust that judgment. Access is **request-and-approve** through Supabase Auth: anyone may request an account, nobody gets access until the admin approves it. One admin who sees everything and logs decisions, and a handful of viewer accounts who see the shared analytical surfaces and nothing personal. This is not multi-tenancy — the projections, prices, and edges are identical for every user.

This file is persistent context for Claude Code. It encodes the non-obvious rules and invariants specific to this project. For product intent see `docs/planning/product-brief.md`; for features and acceptance criteria see `docs/planning/prd.md`; for technical decisions and rationale see `docs/planning/architecture.md`; for build sequencing see `docs/planning/pitch-roadmap.md`. This file is the "how we write code here" layer on top of those.

## Stack (ground truth)

Sightline is two runtimes sharing one Postgres database. Python owns everything upstream of a stored projection; TypeScript owns everything downstream. They communicate through Postgres and nowhere else — no RPC, no shared runtime, no message broker.

**Python side — modelling, ingest, backtesting**

- **Python 3.12+ with `uv`** — dependency and environment management. Not pip, not poetry, not conda.
- **`nflreadpy`** — the only sanctioned nflverse client. **`nfl_data_py` is deprecated and archived** by the nflverse maintainers. It has a decade of tutorials and Stack Overflow answers behind it, which means it is what gets reached for by default and by training-data reflex. It is wrong. If you find yourself importing `nfl_data_py`, stop.
- **Polars** — the primary DataFrame library, following `nflreadpy`'s native output. Converting to pandas at a boundary is permitted as an exception; mixing both across the codebase is not.
- **NumPy** — the simulation core. Simulation **must** be vectorised across runs, executing all iterations as array operations. A Python loop over simulation runs is the same model roughly two orders of magnitude slower, and it is the difference between an overnight backtest and a four-hour one.
- **scikit-learn plus a gradient-boosting library** — the component models inside the simulation (play volume, usage allocation, efficiency). Fit offline; their outputs feed the simulation rather than producing stat lines directly.
- **Parquet on local disk** — raw backtest artefacts. Millions of per-prediction rows never enter Postgres. Only `BacktestRun` aggregates and `CalibrationBin` rows do.
- **pytest** — the test runner.

**TypeScript side — application**

- **Next.js (App Router), React, TypeScript** — the user-facing application. It **never runs a model.** Every surface is a database read plus a live price fetch.
- **Prisma** — ORM and the **single source of schema truth.** All migrations originate here. Prisma is the query layer for application data.
- **Supabase** — Postgres and Auth. The Supabase client handles the auth session; it is **not** the query layer for application data. That is Prisma. Supabase Storage is not used by this project.
- **Material UI** — the only component and styling system. No Tailwind, no styled-components, no CSS modules, no hand-authored stylesheets. Theming happens through MUI's theme, which is a named deliverable of the App Shell, Brand & Access pitch rather than an emergent property of building screens.
- **Recharts** — charts only, always wrapped in a component that reads every colour, font, and stroke from the MUI theme. See `.claude/skills/sightline-ui-design/SKILL.md` for the brand system. *(Pending: `architecture.md` → Tech Stack does not yet name a charting library. Add it there so the doc and this file agree.)*
- **Jest** for unit and integration tests, **Playwright** for end-to-end.
- **Vercel** — hosting. **GitHub Actions** — scheduled Python jobs. Backtests run locally, never in CI.

**Deliberate absences.** Each of these was considered and rejected; do not add one without flagging it first:

- No message queue and no worker service. The job schedule is a handful of GitHub Actions cron entries, not a pipeline.
- No WebSocket connection to Kalshi, despite one being offered. It is the right tool for millisecond market-making and the wrong one for a person checking a phone before kickoff, and a persistent socket is a poor fit for serverless hosting.
- No specialised time-series or vector store. The corpus is roughly a million plays; Postgres is correct.
- No caching layer beyond Next.js defaults, no horizontal scaling, no distributed computation. Three users, ~300 games a season. Over-engineering for imagined scale is the more likely failure here than under-provisioning.
- No microservices. The two-runtime split is the only decomposition and it exists because of a language boundary, not a scaling one.

Do not add libraries or infrastructure not already decided in the Architecture Doc without flagging it first.

## The core invariant: temporal integrity

**This is the single most important rule in the codebase.** No fact whose `known_at` is later than a projection's information cutoff may reach that projection, at any layer, ever.

Everything Sightline claims about itself rests on the backtest being honest. If any feature is computed from information that postdates the game it predicts, the model looks skilled, the calibration curve looks excellent, the recommendations look sharp — and all of it is fiction that surfaces months later when live results diverge from backtested ones, with real money on the line. This failure mode is silent by construction and it is *flattering*: a leaking backtest produces better numbers, which is exactly the signal a developer is least inclined to question. It also cannot be retrofitted. A leak discovered in month six invalidates every stored projection, every calibration bin, and every claim made to the people who were invited to look at it.

Enforcement is layered, and neither layer is sufficient alone.

**Layer 1 — the as-of query layer (Python, all model-facing reads).** Every read that feeds a projection goes through a query layer that takes an explicit as-of cutoff and makes any row with `known_at` later than that cutoff structurally unreachable. There is no sanctioned path that reads a fact table directly. A feature function that accepts a raw DataFrame it did not obtain through the as-of layer is a leak waiting to happen, regardless of whether it currently leaks. The anti-pattern to watch for in feature code: a helper that pulls "the player's season stats" without threading the cutoff through, then filters afterward. Filtering afterward is not the same as being unable to see the row.

**Layer 2 — `known_at` on every fact (schema, Prisma migrations).** Every fact that could influence a projection carries two timestamps: `valid_at`, when the fact was true of the world, and `known_at`, when it became available. `known_at` is non-nullable. A new fact table without both columns is a schema bug, not a style preference. This layer is what makes Layer 1 *possible* — a query layer cannot filter on a column that does not exist — but it is inert on its own, because nothing stops code from reading the table without a cutoff.

### Reconstructed `known_at` is where this actually breaks

nflverse publishes the fact without publishing when the fact became public. For historical bulk loads, `known_at` must therefore be **reconstructed**, and every reconstruction is a guess. Guessing generously — assuming information was available earlier than it was — leaks, and leaks in the direction that flatters the model. Therefore:

- Reconstruction rules are **conservative and documented per source.** Injury reports resolve to their scheduled publication window; weekly stats to the day after the game. When in doubt, resolve later, not earlier. Never resolve a reconstruction to the game date itself.
- Every reconstructed `known_at` is **flagged as reconstructed**, so its reliability is visible in backtest analysis rather than invisible in an aggregate.
- **Never rely on a source's own ordering or file layout as a proxy for availability.** A row appearing in an earlier file does not mean it was known earlier.
- **Season-level aggregates are forbidden as features.** Any value computed over a full season and joined to a mid-season game leaks the rest of the season backwards. This is the most common accidental leak and the hardest to see in a diff, because the code looks like ordinary aggregation.
- **Current roster and team state must never be joined to a historical game.** History follows the player; team-context features reflect the team the player was on at the time.
- **Corrected actuals must not be treated as known at game time.** A stat correction carries a correction date; using the corrected value as though it were the original is a subtle leak in grading rather than in prediction, which makes it easier to miss.

If you are ever unsure whether a code path respects the as-of cutoff, treat it as a blocking issue, not a detail.

### Two sanctioned exceptions, both walled off

**Stat corrections.** Ingest, projection, and grading are otherwise strictly idempotent — re-running over an already-processed period produces no duplicates and no changes. Stat corrections are the deliberate exception: a correction updates `PlayerGameStat` and triggers re-grading of everything downstream. This exception applies to **grading only**. It must never become a path by which corrected values re-enter feature computation for the game they correct.

**Pre-2021 weather.** Open-Meteo's `/v1/archive` endpoint serves ERA5 reanalysis — what the weather actually was, assembled after the fact. Using it for prediction is look-ahead bias of exactly the kind this invariant exists to prevent: on Saturday you do not know Sunday's wind, you know Saturday's forecast of it. The archived-forecast datasets are the correct source, and they begin around 2021–2022 while play-by-play reaches back to 1999. The sanctioned resolution: archived forecasts for 2021-forward, reanalysis for earlier seasons, the era recorded per record, and **backtest calibration reported split across the two eras** so that suspiciously strong performance in the older era is visible rather than buried in an aggregate. This leak is accepted and reported. It is never silently averaged away.

Feature code must never have access to a read path that bypasses the as-of cutoff.

## The second invariant: prices never feed projections

**Kalshi price data must never become a model input, at any layer, including indirectly.** This ranks below temporal integrity only because its failure is recoverable — you can retrain. It is otherwise as important, and its failure mode is subtler.

If the model becomes even partially derivative of the market it is trying to beat, calibration stops measuring what the product claims it measures. Sightline's primary success metric is whether it is better calibrated than the market; a model that has read the market's prices cannot answer that question about itself. The product would still produce numbers, and the numbers would look fine.

What counts as violating this — an explicit list, because the indirect cases are the ones that happen:

- Reading `PriceObservation` from any Python module in the modelling or feature path.
- Inferring a player's status from price movement ("this contract moved 20 cents, he must be out").
- Using market-implied probabilities to calibrate, blend, shrink, or sanity-check a model output.
- Using price as a feature selection signal, a hyperparameter target, or a backtest filter.
- Using recommendation outcomes — which are price-derived — as training labels. Grade against `Outcome`, never against whether a recommendation was profitable.

The structural guarantee: the Python runtime has no reason to query `PriceObservation` or `RecommendationSnapshot` at all. Treat any import path that would let it do so as a review-blocking finding.

### Multi-step writes must be atomic

Any operation with multiple dependent writes — recording a decision alongside its decision-time snapshot, grading a projection alongside its recommendation and any decision against it, recording a position alongside its links to decision, recommendation, and projection — must succeed or fail together. Use Prisma's `$transaction`. Every such function takes an optional transaction client so it can either open its own boundary or compose into a caller's.

The decision snapshot is the canonical example, and it carries a second rule: **snapshot values are read server-side from the database, never accepted from the client.** A client that supplies its own idea of the edge it saw is supplying an unverifiable number into the one dataset in this system that cannot be reconstructed.

```typescript
export async function recordDecision(
  input: { contractId: string; disposition: Disposition; userId: string },
  tx?: Prisma.TransactionClient,
): Promise<Decision> {
  if (!tx) {
    return prisma.$transaction((client) => recordDecisionInner(input, client));
  }
  return recordDecisionInner(input, tx);
}

async function recordDecisionInner(
  input: { contractId: string; disposition: Disposition; userId: string },
  tx: Prisma.TransactionClient,
): Promise<Decision> {
  // Snapshot state is read here, server-side. Never trust client-supplied numbers.
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: input.contractId },
    include: {
      projections: { orderBy: { computedAt: "desc" }, take: 1 },
      priceObservations: { orderBy: { observedAt: "desc" }, take: 1 },
    },
  });

  const projection = contract.projections[0] ?? null;
  const price = contract.priceObservations[0] ?? null;

  return tx.decision.create({
    data: {
      // Anchored to the contract, not to a recommendation — a decision may exist
      // where Sightline recommended nothing at all.
      contractId: contract.id,
      userId: input.userId,
      disposition: input.disposition,
      snapshotModelProbability: projection?.thresholdProbability ?? null,
      snapshotMarketPrice: price?.askCents ?? null,
      snapshotConfidence: projection?.confidence ?? null,
      snapshotProjectionComputedAt: projection?.computedAt ?? null,
      snapshotInformationCutoff: projection?.informationCutoff ?? null,
    },
  });
}
```

## Data access

**Application data is read and written through Prisma in server-side code. Never fetch application data with client-side `fetch()` and never query the database from the browser.**

- Server components read via Prisma, with the authenticated user resolved from the Supabase session server-side.
- Mutations run through **route handlers** — decision writes, suggestion accept/decline, admin operations, and order placement. Not server actions, not raw client fetches.
- Client components are interactive islands only: the take/fade/skip control, the slate's filter and sort controls, the accuracy surface's stat-type and period filters, the appearance selector, and the confirmation step in order entry. They call route handlers; they never touch the data store and never hold credentials.
- The Supabase client handles the auth session in the browser. It must **never** be used as the query layer for application data.

**The one sanctioned client-side fetch:** the slate polls Sightline's own price-refresh route on a background interval. It never calls Kalshi directly — the browser talks only to Sightline, because the Kalshi rate-limit budget is managed server-side and the signing key lives there. This exception covers price refresh and nothing else. *(The polling mechanism — a data-fetching library versus a bare interval — is not decided in the approved docs. Choose one in the pitch that builds it and record it here.)*

## Security invariants (non-negotiable)

### Access and registration model

Supabase Auth with email and password. **Anyone may request an account; nobody gets access until the admin approves it.**

A `User` row exists from the moment someone signs up, so **the row's existence grants nothing — only `status` does.** Four states: `pending` (requested, no access of any kind), `active` (approved), `denied` (refused), `revoked` (access ended after approval). Every protected surface re-reads that status per request, which is what makes both approval and revocation take effect immediately rather than whenever a token happens to expire.

Two consequences that are easy to get wrong:

- **Supabase's own public signup stays DISABLED at the project level.** Accounts are created by the application's `/api/auth/sign-up` route using the service-role client, which forces `status = pending`. Enabling Supabase's signup endpoint would open a path that bypasses that and creates an account with no status discipline at all. The `422` probe in the auth runbook remains a required invariant.
- **Sign-up answers identically whether or not the address already has an account.** It is a public surface, so a distinct "already registered" reply would let anyone enumerate who is in the group.

What deliberately does not exist, so that it does not get helpfully added: no social or OAuth login, no magic links, no public account-recovery flow, no email verification round-trip (approval is the gate). Password reset is not specified in the approved docs — do not build one without a pitch.

Authentication is enforced **server-side in Next.js**, in server components and route handlers. Every protected read and write independently verifies the session. Conditionally rendering the interface is not authentication.

Login errors must not distinguish an unknown email from a wrong password.

### Authorization

Two roles, admin and viewer. **This is not multi-tenancy and must not be built as though it were.** Projections, prices, edges, recommendations, contracts, and all reference data are identical for every user; there is no per-user partition of shared data, and row-level isolation of it would be pure ceremony.

- **Shared read surfaces** — slate, projections, prices, edges, recommendations, drivers, staleness, and model accuracy — require an authenticated session and nothing more.
- **Admin-only surfaces** — decision log, positions, override performance, timing cost, suggestion reliability analytics, trading, and user management — require a server-side role check.
- **User-scoped writes** — decisions, and positions from the trading pitch onward — are always written with the acting user's identity resolved from the session. Never accept a user identifier from the client, and never accept a role: a sign-up body carrying one is an attempt to self-assign admin.

Hiding a navigation item is not authorization. A viewer deep-linking to an admin route must be rejected by the server. Postgres row-level security on the user-scoped tables is proposed as defence in depth but is **not** the primary mechanism and is not yet decided; server-side role checks are.

### File and artefact storage

Sightline has no user-facing file storage and no uploads. Supabase Storage is unused. The only file artefacts are Parquet backtest outputs on local disk, which are never served, never uploaded, and never referenced by a URL the application can produce. Do not introduce an upload surface.

### Third-party credentials

**The Kalshi signing key is the highest-value secret in this system and its blast radius is a funded trading account.** Kalshi authenticates with an API key ID and an RSA private key used to sign requests, which means the key carries signing authority over real money.

- It lives in Vercel environment configuration, server-side only.
- It is never sent to a client, never logged, never included in an error message, and never appears in a response body.
- All Kalshi calls originate from the server.
- Only the admin's credentials are ever held. **No viewer credential is ever accepted, stored, transmitted, or custodied** — this is a product commitment from the Brief, not an implementation detail, and it is the reason viewers trade on Kalshi directly.
- The Supabase **service-role** key is the second-highest-value secret. It bypasses every Supabase-side check, and exactly two modules may reach it: the sign-up route and the access-decision route. A third importer is a review-blocking finding.
- Trading requires an explicit confirmation step and enforces a configurable per-slate exposure cap.
- The trading feature is exercised against Kalshi's demo environment before any live account is enabled, and cannot be enabled before a stored `BacktestRun` demonstrating accuracy exists.

Open-Meteo requires no key. ESPN's endpoints are undocumented and unauthenticated. nflverse is public.

## Business logic

### Edge and staleness are computed on read, never stored

Live edge is computed at read time by joining the freshest projection to the freshest price. **There is no stored edge column, no `is_stale` boolean, and no background job maintaining either.** An agent that does not know this will helpfully add a nightly job to denormalise edge, and that job will serve stale numbers on the one morning it matters.

- Only `RecommendationSnapshot` persists, and only so a recommendation can be graded after settlement. It is a historical record, not a cache.
- Staleness is computed per game, measured backward from **that game's own kickoff**, never from a calendar day. This is what makes Thursday night, a 9:30am London game, a Saturday doubleheader, and Monday night a single code path.
- Staleness is scoped per game. An early game going stale does not mark later games.
- A projection is stale once its game passes the point at which inactives publish and inactives have not been ingested. Staleness is disclosed, not raced — at ninety minutes to kickoff Sightline is structurally the slowest participant in the market, and a projection that admits it predates inactives is more useful than one that silently pretends to be current.
- No edge is computed or displayed for a contract with no projection. A stale projection paired with a current price is the most dangerous state in the product and must be visibly marked in the list view, not only on detail.
- The recommendation threshold is configuration, not a constant. Contracts below it stay visible and ranked, de-emphasised rather than filtered out.

*(Undecided in the approved docs: whether edge computes against the ask or the midpoint. Both sides of the book are stored so either is derivable. Display both; the choice that drives ranking is resolved by the Kalshi Sync pitch against a real slate.)*

### Distinctions that must not be collapsed

**Took, faded, and skipped are three states, not two.** Fading is taking a position on the other side of the contract; skipping is passing entirely. Collapsing them destroys the ability to answer whether the admin's disagreements with the model add value. Unmarked is a valid resting state and is represented by the **absence of a row**, not by a fourth enum value. No disposition is ever forced.

**The base projection and the shadow-adjusted projection both exist, always.** When an adjustment suggestion is raised, the adjusted projection is computed and stored as a shadow regardless of whether the admin accepts it, and **both are graded against the outcome.** Accepting changes what is displayed; it does not change what is graded. If grading depended on acceptance, the analytics would measure the admin's choices rather than the source's reliability, which is the entire point of the mechanism.

**Source accuracy and adjustment accuracy are two separate figures and must never be combined.** A source can be wrong — a player reported out who plays. Or the source can be right and the adjustment wrong — the player was genuinely out and the model redistributed his workload badly. Conflating them means retiring a reliable feed because of an immature redistribution model. Both are reported per source, and **every rate is displayed with its sample size.**

**Kalshi's settlement and the official stat line are two facts and may disagree.** NFL stat corrections can land days after settlement. Store them separately rather than reconciling them into one number. *(Undecided in the approved docs: which is truth for grading. The answer may legitimately differ by purpose — the official line for grading the model, Kalshi's settlement for grading a position. Do not pick one silently.)*

### What must never be lost

Decisions and positions. Everything else is derivable: projections can be recomputed, prices refetched, grades recalculated. Decisions are the only human-generated data in this system and the only thing that cannot be reconstructed. Treat any migration or cleanup touching `Decision` or `Position` as requiring explicit sign-off.

## The Python runtime

The Python side is a batch process operating entirely outside the request path. It ingests, fits, simulates, backtests, and grades. It never serves a user request.

- **It never migrates.** Prisma is the single source of schema truth. Python treats the resulting tables as a contract it reads and writes but never alters. A Python migration tool appearing in this repo is a bug.
- **It connects directly, not through the pooler.** Prisma uses Supabase's transaction-mode pooler for application traffic and a direct connection for migrations; Python's bulk writes use the direct connection, because large transactional loads are a poor fit for transaction-mode pooling. Both URLs must be configured.
- **It bypasses row-level security by design**, connecting with a service-role credential. This is sanctioned precisely because it never serves user requests — that is its entire isolation guarantee. No code path may allow a user request to reach the Python runtime's credential.
- **It never reads Kalshi prices.** See the second invariant.
- **Ingest failures are explicit.** A named source becoming unavailable produces an ingest failure, never a silent gap.

### Scheduled jobs have three sharp edges

GitHub Actions runs the in-season pipeline. Three constraints must be designed around rather than discovered:

- **Scheduled workflows are disabled after 60 days without a commit** to the default branch, on private repositories as well as public ones. Only commits reset the timer — not releases, tags, issues, or merged pull requests. Sightline has a February-to-September offseason, so without intervention the schedule dies in spring and the failure surfaces in September. **A keepalive workflow that commits a trivial marker before the deadline is mandatory, not optional.**
- **There is no timing SLA.** Delays of five to thirty minutes are common, longer under load, and the minimum interval is five minutes. This is tolerable only because of staleness disclosure — a late run shows as an older timestamp rather than a wrong number.
- **Failures are silent.** A skipped run leaves Sunday's slate showing Thursday's projections with nothing announcing it. The health read exposes last-success timestamps for ingest, recompute, and price refresh, and the interface surfaces them when they fall outside expected bounds.

## Product boundaries (do not build these)

**Permanent non-goals.** These are never, not later:

- No sportsbook or DFS integration. PrizePicks, Underdog, DraftKings and their peers are out permanently. Kalshi is the venue.
- Never a public or commercial product. Invite-only to a small closed group; no open signup, no subscriptions, no selling picks.
- No live in-game trading. Sightline operates on pre-game state; once the ball is kicked its projections are stale by design.
- No film or tape-derived inputs. The model works from structured data only — box scores, play-by-play, participation, injury designations, weather, rest, travel.
- **Friends never trade through the application.** Sightline does not store, encrypt, custody, or transmit another person's Kalshi signing credentials, because those credentials carry authority to move money out of a funded account. View-only means view-only. This is a positive commitment, not merely a missing feature.
- Not a general sports data browser. Production inference is scoped to players with live Kalshi markets. The model trains and validates on the full historical player universe, but with no contract to price, Sightline has nothing to say.

**Deferred.** Do not build these unless a pitch calls for them, but do not architect in a way that precludes them: bankroll and portfolio management (V2); NBA (V3, which is why the entity model is sport-agnostic — player, game, stat type, contract, and projection carry no NFL-specific structure); WNBA; friend pick sharing (note that this converts viewers from read-only to a role that writes their own decisions, a real permission change); additional stat types; additional suggestion sources beyond ESPN inactives. In-app messaging was considered and set aside deliberately.

## Testing

Test frameworks: **Jest** for TypeScript unit and integration, **Playwright** for end-to-end, **pytest** for Python. Focus tests where correctness matters most. Highest-value targets, in order:

1. **Temporal leakage — adversarial, and first.** The leakage test suite asserts that a projection for a past game is identical whether computed then or now, and that a query with an as-of cutoff cannot return a row whose `known_at` postdates it. This ranks first because it is the only failure in this system that is both silent and flattering, and because it gates everything downstream: no calibration number and no recommendation means anything if this is broken. Write these tests to attack, not to confirm — construct the leak and prove it is blocked.
2. **Prices never feed projections.** Prove structurally that no modelling or feature code path reaches `PriceObservation` or `RecommendationSnapshot`. An import-graph assertion is worth more here than a behavioural test.
3. **Grading and idempotence.** Re-running ingest, projection, or grading over a processed period produces no duplicates and no changes. A stat correction re-grades affected records rather than leaving a stale result. An interrupted backtest run never leaves partial results presented as complete.
4. **Contract-to-player resolution.** This will break in ordinary ways: unusual names, suffixes, mid-season signings, duplicates, and Kalshi relisting a market at a different threshold mid-week. Test the failure path — an unresolved contract must be retained and surfaced, never silently dropped.
5. **Kalshi integration, adversarially.** Outage degrading to projections-only rather than failing the view; a voided market with decisions already logged against it; partial fills; an order that succeeds remotely but fails to record locally; the per-slate cap reached mid-slate.
6. **Role enforcement.** A viewer deep-linking to every admin route is rejected server-side. Test the route, not the navigation.

Test the risky logic hard; lean tests or manual verification are fine for low-risk UI and CRUD. The exception that is never lean is anything touching the as-of query layer or the `known_at` columns — that code has no visible failure mode, so tests are the only thing standing between a leak and a season of fictional calibration numbers.

## Workflow

1. Work against the current pitch. Keep changes scoped to that pitch's in-scope list; don't wander into a later pitch.
2. Commit with descriptive messages referencing the Linear issue ID.
3. Push and open a PR via `gh pr create`. Verify on the Vercel preview deployment, which points at the development Supabase project, before merging.

Two pieces of extra care warranted by this product's risk profile. Any change touching the as-of query layer, `known_at` handling, or feature computation requires a backtest re-run and a comparison against the prior stored run before merge — a leak introduced here does not produce a failing test unless someone wrote one, and the calibration numbers will improve rather than degrade. And no trading code path is exercised against a live Kalshi account before it has run against the demo environment.

## Autonomous Pipeline Policy

When running the pitch pipeline unattended, the following governs every decision.

### Decide, don't ask

Resolve open questions yourself. Do not present options, do not wait for confirmation, do not end a turn with a question. The intended mode is: a pitch starts in the evening and is finished by morning.

Resolve in this order of authority:

1. The four approved planning docs at `docs/planning/` — Brief, PRD, Architecture, Roadmap.
2. `CLAUDE.md` and the skills.
3. Existing patterns in the codebase. Match what is there over what you would write fresh.
4. Your own judgment, stated as a decision rather than a preference.

Every resolved question is recorded in the spec as a **Resolved Decision** with a one-line rationale — never left open, and never silently answered.

### The four things that stop a run

Autonomy is bounded. Halt, write the reason to the run report, and stop — do not proceed under an assumption — if any of these arise:

1. **A contradiction with an approved doc.** If implementing the pitch as written would violate the Brief, PRD, Architecture Doc, or Roadmap, stop.
2. **A breach of a stated invariant.** Kalshi prices reaching a projection. A fact whose `known_at` postdates a projection's information cutoff. Paper and live ledgers becoming aggregable. Anything adapting to measured accuracy other than the recalibration layer.
3. **Credential or money-path scope.** Anything that stores, transmits, or signs with a Kalshi credential, or that could place a real order, beyond what the current pitch explicitly scopes.
4. **A destructive or irreversible operation** not named in the pitch — dropping tables, truncating the corpus, rewriting published history, force-pushing a shared branch.

Everything else: decide and continue.

### Verification honesty

Never report a check you did not run. Never mark a ticket complete on a failing check.

- **Per commit:** lint, typecheck, format, unit tests.
- **Per ticket boundary:** the above plus build.
- **Per feature branch, before review:** the full suite including e2e.

If a check fails, fix it. If it cannot be fixed without violating a stop condition, halt and report. Do not skip, disable, or mark as expected failure.

### Survive context exhaustion

Maintain `docs/v1/runs/<slug>-progress.md`, updated at every ticket boundary and every step transition. It records: current step, tickets created with their real identifiers, which are complete, branch and PR for each, every Resolved Decision so far, and anything deferred.

Write it so a fresh session with no prior context can read that file plus the spec and resume without repeating work.

### The run report

On completion or halt, write `docs/v1/runs/<slug>-report.md`:

- What shipped, and the state of every ticket and PR.
- **Decisions made on the user's behalf**, each with its rationale.
- Review findings and how each was dispositioned.
- Anything deferred, as ticket or code comment.
- Anything requiring a decision that could not be made autonomously.
- Verification results, per check, with actual outcomes.
- If halted: which stop condition, at which step, and what is needed to resume.

### Ticket identifiers

Ticket numbers do not exist until Linear assigns them. Never reference a number that has not been created. After creating tickets, capture the assigned identifiers, write them to the progress file, and work them in order from that list.

## Consistency with the planning docs

- Feature names must match `docs/planning/prd.md` and `docs/planning/pitch-roadmap.md` exactly: Historical Data Ingest, Projection Engine, Kalshi Market Sync, Edge Calculation and Recommendation, Staleness Disclosure, Adjustment Suggestions, Suggestion Reliability Analytics, Decision Log, Outcome Ingest and Scoring, Accuracy and Calibration Surface, Backtesting Harness, Authentication and Invite, Brand and Responsive Interface, Kalshi Trading.
- Data objects must match `docs/planning/architecture.md`'s data model: `Team`, `Player`, `Game`, `PlayByPlay`, `PlayerGameStat`, `PlayerGameContext`, `Projection`, `ProjectionDriver`, `Contract`, `PriceObservation`, `RecommendationSnapshot`, `AdjustmentSuggestion`, `Decision`, `Position`, `Outcome`, `BacktestRun`, `CalibrationBin`, `User`. **`Invitation` was removed when the access model changed to request-and-approve; the Architecture Doc and PRD still name it and should be amended.** Note that the PRD's "Edge / Recommendation" object is `RecommendationSnapshot` here; live edge is computed on read and has no entity.
- If a task seems to require contradicting an approved doc — or weakening temporal integrity — **stop and flag it rather than silently diverging.**
