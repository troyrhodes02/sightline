# Sightline — Architecture Doc

## Tech Stack

Sightline is two runtimes sharing one database. Python owns everything upstream of a stored projection; TypeScript owns everything downstream of it. They communicate through Postgres and nowhere else — no RPC, no shared runtime, no message broker. This seam exists because the two halves of the product already run on different clocks: projections are precomputed when news arrives, prices are fetched live, and edge is computed at read time from the freshest of each.

### Python — modelling, ingest, and backtesting

**Python 3.12+** with **uv** for dependency and environment management. The modelling half of this product is distributional simulation over a million-play historical corpus, which is Python's home ground and not TypeScript's. Writing quantile-aware simulation and feature engineering in TypeScript would mean rebuilding an ecosystem that already exists.

**`nflreadpy`** for all nflverse data access. This is load-bearing and easy to get wrong: `nfl_data_py` is the package with a decade of tutorials, Stack Overflow answers, and blog posts behind it, and it has been **deprecated and archived** by the nflverse maintainers in favour of `nflreadpy`. Any agent building this from training data will reach for the dead package by default. `nflreadpy` is the maintained port of the R `nflreadr` client and returns **Polars** DataFrames rather than pandas.

**Polars** as the primary DataFrame library, following `nflreadpy`'s native output. Converting to pandas at the boundary is possible but should be the exception — mixing both across the codebase is the stack-incoherence failure this project should avoid.

**NumPy** for the simulation core. The single most important implementation constraint in this document: simulation must be **vectorised across runs**, executing all iterations as array operations rather than looping game-by-game in Python. Same model, roughly two orders of magnitude difference in wall-clock time, and the difference between a four-hour backtest and an overnight one.

**scikit-learn** and a gradient-boosting library for the component models inside the simulation — play-volume, usage allocation, and efficiency. These are fit offline and their outputs feed the simulation rather than producing stat lines directly.

**Parquet** for raw backtest artefacts on local disk. Millions of per-prediction rows never enter Postgres.

### TypeScript — application

**Next.js (App Router)** with **React** and **TypeScript**. Server components read projections directly; route handlers own the Kalshi proxy, decision writes, and admin operations. The app never runs a model — every user-facing surface is a database read plus a live price fetch.

**Material UI** for the component system, with **no utility-CSS framework and no hand-authored stylesheets**. Theming happens through MUI's own system. One tension to name explicitly: stock MUI reads as stock MUI, and the product requires a real visual identity. The resolution is a comprehensive theme — palette, typography, shape, elevation, and component-level overrides defined once and never bypassed with inline one-offs. That theme is a named deliverable of the brand work, not an emergent property of building screens.

**Prisma** as ORM and the **single source of schema truth**. All migrations originate here. Python treats the resulting tables as a contract it reads and writes but never migrates.

**Supabase** for **Postgres** and **Auth**. Postgres is correct for this data — it is relational, modest in volume, and queried with joins and time-range filters. There is no case here for a specialised store: the entire historical corpus is roughly a million plays and tens of thousands of player-games, which is small. Supabase Auth removes the hand-rolled-auth risk entirely.

**Vercel** for hosting the Next.js application, and **GitHub Actions** for scheduled Python jobs. Backtests run locally.

### What was deliberately not chosen

No specialised time-series or vector store — the data volume does not justify one. No message queue or worker service — the job schedule is a handful of cron entries, not a pipeline. No WebSocket connection to Kalshi despite one being offered — that is the right tool for millisecond market-making and the wrong one for a person checking a phone before kickoff, and a persistent socket is a poor fit for serverless hosting. No microservices. The two-runtime split is the only decomposition, and it exists because of a genuine language boundary rather than a scaling one.

---

## Data Model

### Temporal design

Every fact that could influence a projection carries **two timestamps**: `valid_at`, when the fact was true of the world, and `known_at`, when it became available. An injury designation is valid of Week 12 but became known on Friday afternoon. All model-facing reads go through a query layer that takes an explicit as-of cutoff and makes any row with `known_at` later than the cutoff structurally unreachable. Leakage becomes something you would have to work to cause rather than something you have to remember to avoid.

The cost is that every ingest must record `known_at` honestly, and for historical bulk loads it must often be **reconstructed** — nflverse publishes the fact without publishing when it became public. Reconstruction rules must be conservative and documented per source: injury reports resolve to their scheduled publication window, weekly stats to the day after the game, and so on. A reconstructed `known_at` is flagged as reconstructed so its reliability is visible in backtest analysis.

### Reference entities

**Team** and **Player** are stable identities. Player carries external identifiers from every source — nflverse ID, ESPN ID, and Kalshi's naming — because cross-source identity resolution is a named risk and needs an explicit mapping rather than name matching at query time.

**Game** holds kickoff time, participants, venue, dome flag, and schedule metadata. Kickoff time is the anchor for all scheduling: every recompute and staleness boundary is measured backward from a game's own kickoff rather than from a calendar day. This is what makes Thursday night, a 9:30am London game, and a late-season Saturday doubleheader identical code paths.

**PlayByPlay** and **PlayerGameStat** hold the historical corpus and final actuals. `PlayerGameStat` is the grading target and is mutable in one specific way: a stat correction updates it and triggers re-grading downstream.

**PlayerGameContext** holds the per-game situational facts — snap share, participation, injury designation, rest days, travel, and weather. Fully bitemporal; this is where most leakage risk lives.

### Projection entities

**Projection** is one player, one stat type, one game, from one model version. It stores a **compact representation of the full distribution** rather than a point estimate: a quantile grid for continuous stats such as yardage, and an explicit probability mass function for low-count discrete stats such as touchdowns. This matters because Kalshi thresholds change and new contracts appear — storing the distribution means any threshold probability is derivable later without re-simulating. Alongside the distribution it carries the projected value, the interval, a confidence value, `computed_at`, `information_cutoff`, and `model_version`.

Ten thousand raw draws are never persisted. The compact representation is what survives.

**ProjectionDriver** holds the human-readable factors behind a projection, ordered by contribution, so the detail view can explain itself without recomputation.

**Contract** is a Kalshi market resolved to a player, stat type, threshold, and game — or explicitly marked unresolved. Unresolved contracts are retained and surfaced, never silently dropped.

**PriceObservation** is a timestamped reading of a contract's book, storing **both sides** rather than a midpoint, so edge can be computed against the price actually payable.

**RecommendationSnapshot** stores a recommendation as it existed at a point in time, so it can be graded after settlement. Live edge is computed at read time and not stored; only snapshots persist.

### Human and evaluative entities

**AdjustmentSuggestion** carries source, evidence, target projection, proposed change, and status. Every suggestion links to a **shadow projection** — the adjusted projection, computed and stored regardless of whether the suggestion was accepted, so grading is never confounded by the admin's choices.

**Decision** is anchored to a contract rather than to a recommendation, so a decision can exist where Sightline never recommended anything. It stores a full snapshot of decision-time state and links to the final pre-kickoff snapshot; the difference yields timing cost. Took, faded, and skipped are distinct states, and unmarked is the absence of a row rather than a value.

**Position** results from an executed order and links back to the decision, recommendation, and projection that produced it.

**Outcome** holds settlement and the official result, and is the grading source for everything upstream.

**BacktestRun** stores configuration, code version, period, and aggregate results; **CalibrationBin** stores the reliability curve points the app renders. Raw per-prediction output stays in local Parquet.

**User** and **Invitation** hold accounts, roles, and invite state.

### Volume

The full historical corpus is on the order of a million plays and tens of thousands of player-games. Projections accumulate at roughly a few thousand rows per week in season. This is a small database, and the architecture should reflect that rather than anticipating scale that will not arrive.

---

## Consistency & State

**Two clocks, deliberately decoupled.** Projections are precomputed on a news-driven schedule and stored. Prices are fetched live from Kalshi on view and on a background interval. Edge is computed at read time by joining the freshest projection to the freshest price. Neither clock waits on the other, and the user never waits on a model run — opening the slate is a database read.

**Recomputes are scoped per game**, not per slate. Inactives for the 1pm window affect 1pm games only; later games are untouched. Every recompute is measured against its own game's kickoff.

**Staleness is disclosed rather than raced.** At ninety minutes to kickoff Sightline is structurally the slowest participant in the market — news reaches traders in seconds and a recompute pipeline cannot beat that. The design consequence is that projections carry their `computed_at` and `information_cutoff` into the interface, and once a game passes the point where inactives publish, its contracts are marked stale until ingested. A projection that admits it predates inactives is more useful than one that silently pretends to be current. This is also what makes GitHub Actions' lack of a timing SLA tolerable: a late run shows as an older timestamp rather than a wrong number.

**Prices never feed projections.** Kalshi price movement is the comparison target and must never become a model input, even indirectly. Inferring a player's status from a violent price move would make the model partially derivative of the market it is trying to beat and would quietly destroy the calibration measurement that is the product's primary success metric.

**Source of truth.** Postgres holds everything the application displays. Local Parquet holds raw backtest output. nflverse, Kalshi, ESPN, and Open-Meteo are upstream sources, never queried live by the web application except for Kalshi prices.

**Idempotence is required** of ingest, projection, and grading. Re-running any of them over an already-processed period produces no duplicates and no changes. Stat corrections are the deliberate exception: a correction updates the actual and re-grades everything downstream of it.

**What must never be lost:** decisions and positions. Everything else is derivable — projections can be recomputed, prices refetched, grades recalculated. Decisions are the only human-generated data in the system and the only thing that cannot be reconstructed.

**No offline support.** Sightline is online-only across all clients.

---

## Auth & Identity

Supabase Auth with email and password, **public signup disabled**. Accounts exist only by admin invitation. Sessions are Supabase-managed and persist across devices.

Authentication is enforced server-side in Next.js — in server components and route handlers — rather than by conditionally rendering the interface. Every protected read and write independently verifies the session.

The admin's Kalshi credentials are the only trading credentials the system ever holds. <br>Kalshi authenticates with an API key ID and an RSA private key used to sign requests, which means the key carries signing authority over a funded account. It lives server-side only, in Vercel environment configuration, is never sent to a client, never logged, and never appears in a response body. All Kalshi calls originate from the server; the browser talks only to Sightline.

No viewer credential is ever accepted, stored, transmitted, or custodied. This is a product commitment from the Brief, not an implementation detail, and it is the reason viewers trade on Kalshi directly rather than through the application.

---

## Authorization

Two roles: **admin** and **viewer**.

**This is not multi-tenancy, and should not be built as though it were.** Projections, prices, edges, recommendations, contracts, and all reference data are *identical for every user* — there is no per-user partition of shared data. Only decisions, positions, and bankroll are user-scoped, and each belongs to exactly one user. Row-level isolation of shared reference data would be pure ceremony.

The model is therefore a role-based read/write split:

- **Shared read surfaces** — slate, projections, prices, edges, recommendations, drivers, staleness, model accuracy — require an authenticated session and no more.
- **Admin-only surfaces** — decision log, positions, override performance, timing cost, suggestion reliability analytics, bankroll from V2, trading, and user management — require an admin role check server-side.
- **User-scoped writes** — decisions, and positions from the trading feature onward — are always written with the acting user's identity and never accept a user identifier from the client.

Role checks live in server code. Hiding a navigation item is not authorization; a viewer deep-linking to an admin route must be rejected server-side.

Postgres row-level security is available through Supabase and worth enabling as defence in depth on the user-scoped tables. Note that the Python runtime connects with a service-role credential and bypasses RLS entirely — it is a batch process operating outside the request path, and its isolation guarantee is that it never serves user requests.

---

## API Surface

The spine, not an exhaustive route list.

**Slate and projections.** A slate read returns upcoming contracts with their resolved players, current projections, latest prices, computed edges, confidence, recommendation status, and staleness state — ranked by confidence-adjusted edge. A contract detail read adds the distribution summary, drivers, projection provenance, and any pending suggestion. Both are authenticated reads available to all roles.

**Prices.** A server-side refresh operation proxies Kalshi market data, writes price observations, and returns current state. Rate-limit budget is managed on the server, which is the only reason this is an endpoint rather than a client fetch.

**Suggestions.** Accept and decline operations, admin-only, updating the displayed projection without touching the shadow projection, which is computed independently and always graded.

**Decisions.** Create and update a decision against a contract, admin-only, capturing the decision-time snapshot server-side rather than trusting client-supplied numbers.

**Accuracy.** Reads for the reliability curve and bins, baseline comparisons, and market comparison — available to all roles. Override performance and timing cost are a separate admin-only read.

**Backtests.** A read of stored runs and their aggregate results. There is no route to trigger a run; execution is out-of-band by design, since the model is not tuned from the interface.

**Trading.** Admin-only order placement, with an explicit confirmation step, per-slate cap enforcement, and a reconciliation read that compares Kalshi's positions against locally recorded ones.

**Administration.** Invitation creation, role assignment, and revocation.

**Health.** A read exposing last successful ingest, last successful recompute, and last successful price refresh, so silent scheduler failure is visible in the product rather than only in a logs tab.

---

## External Integrations

### nflverse (via `nflreadpy`)

Historical and in-season play-by-play, rosters, depth charts, snap counts, participation, schedules, and injury reports. Free, MIT-licensed client code. Note that FTN charting data distributed through nflverse carries a **CC-BY-SA 4.0** licence requiring attribution — if used, attribution is a build requirement.

**If unavailable:** the model cannot update with new results. Projections continue from the last good ingest and are marked stale. Degraded, not broken.

**Known gaps:** participation data has historically had coverage holes. Features derived from it must tolerate absence rather than assume presence.

### Kalshi

Market discovery, prices, settlement, and — in the final MVP feature — order placement. REST for discovery, snapshots, orders, and fills. Free to access; per-contract trading fees apply to executed orders. Authentication uses an API key ID with RSA-PSS request signing. Market-data rate limits sit around ten requests per second, which is comfortably above what a slate-sized pull requires.

A demo environment exists and is where the trading feature is developed and exercised before any live account is enabled.

**If unavailable:** the application degrades to projections-only. Prices, edges, and recommendations disappear; the slate still renders. This is an explicit degraded mode, not an error state.

**Named risk:** contract-to-player resolution. Kalshi identifies players by its own naming, which must be mapped to nflverse identities. This will break on unusual names, suffixes, mid-season signings, and duplicates. Mitigation is an explicit mapping table with manual override, and unresolved contracts surfaced in the interface rather than dropped.

### ESPN (undocumented endpoints)

Real-time inactives, as the first source for the adjustment-suggestion mechanism. Undocumented and unsupported, with no stability guarantee.

**Deliberately non-critical.** This is why the suggestion mechanism exists: the feed never adjusts a projection automatically. It proposes, the admin accepts or declines, and both the base and adjusted projections are graded regardless. If ESPN breaks, suggestions stop firing and affected games display as stale — which is the honest state.

Suggestion reliability analytics separate two failure modes that would otherwise be conflated: the source being wrong about a player's status, and the source being right while the model's redistribution of that player's workload was wrong. Without that split, an immature redistribution model gets blamed on the feed.

### Open-Meteo

Weather for outdoor venues. Free for non-commercial use with no API key, capped at 10,000 calls per day, 5,000 per hour, and 600 per minute. Data is **CC-BY 4.0** and attribution requires a visible link wherever the data is displayed — a user-interface requirement, not merely a licence-file line. Sightline qualifies as non-commercial by explicit product non-goal. The server is AGPLv3 and self-hostable if limits are ever exceeded.

**Which endpoint matters enormously.** The obvious choice is wrong. `/v1/archive` serves ERA5 reanalysis back to 1940 — what the weather *actually was*, assembled after the fact. Training or backtesting on reanalysis is look-ahead bias of exactly the kind the bitemporal design exists to prevent: on Saturday you do not know Sunday's actual wind, you know Saturday's forecast of it.

The correct sources are the archived-forecast datasets, which Open-Meteo explicitly frames as being for backtesting without look-ahead bias. The constraint is that these begin around 2021–2022, while play-by-play reaches back to 1999.

**The resulting decision, which must be documented rather than incidental:** archived forecasts for 2021-forward; reanalysis for earlier seasons with the leakage explicitly acknowledged; and backtest calibration reported split across the two eras, so that suspiciously strong performance in the older era is visible rather than hidden in an aggregate.

**If unavailable:** weather features fall back to seasonal climatology for the venue, with the projection flagged as degraded. Dome games bypass weather entirely.

---

## Environments & Deployment

**Local** runs Python development, model fitting, and all backtests. Backtesting is a multi-hour job — roughly twenty-five seasons of games at ten thousand simulation runs each — and belongs on a machine with no execution ceiling and no per-minute cost. The Next.js app runs locally against a development Supabase project.

**Production** is Vercel for the web application, Supabase for Postgres and Auth, and GitHub Actions for scheduled Python jobs. Prisma migrations run from local or CI against the production database; Python never migrates.

**Preview** uses Vercel's per-branch deployments pointed at the development Supabase project, which gives a review environment without operating a third tier.

**Kalshi's demo environment** is a required stop for the trading feature before live enablement.

### Scheduled jobs — and their sharp edges

GitHub Actions runs the in-season pipeline: nightly ingest and recompute through the week as injury reports and practice participation land, a morning-of recompute per game window, price and settlement ingest, and grading after games complete.

Three constraints must be designed around rather than discovered:

- **Scheduled workflows are disabled after 60 days without a commit** to the default branch, on private repositories as well as public ones. Only commits reset the timer — not releases, tags, issues, or merged pull requests. Sightline has a February-to-September offseason, so without intervention the schedule dies in spring and the failure surfaces in September. A keepalive workflow that commits a trivial marker before the deadline is mandatory, not optional.
- **There is no timing SLA.** Delays of five to thirty minutes are common, longer under load, and the minimum interval is five minutes. This is tolerable only because of the staleness-disclosure design; it would be disqualifying for a product that chased prices.
- **Failures are silent.** A skipped run leaves Sunday's slate showing Thursday's projections with nothing announcing it. The health read exposes last-success timestamps, and the interface surfaces them when they fall outside expected bounds.

### Database connectivity

Prisma connects through Supabase's transaction-mode pooler for application traffic and requires a direct connection for migrations — both URLs must be configured. Python's bulk writes use the direct connection rather than the pooler, since large transactional loads are a poor fit for transaction-mode pooling.

---

## Non-Functional Requirements

**Responsiveness is a product requirement, not an aspiration.** The slate must render from stored data, never waiting on a model run. This is a database read with a live price fetch layered on, and it should feel instant on a phone.

**Compute budgets.** A full slate simulation is roughly fourteen games at ten thousand runs — on the order of 140,000 game simulations, well under a minute vectorised. A single-game recompute triggered by inactives is seconds. A full backtest is roughly 67 million game simulations and takes hours. Only the last is slow, and it never sits in a user's path.

Note that simulation produces every player's full stat line per run, so reading sixty contracts off a simulated game costs the same as reading five. Scoping production inference to Kalshi-listed players is a product decision, not a performance one.

**Scale is small and should be treated as such.** Three users. Roughly 300 games a season. A million historical plays. A few thousand projections a week. There is no requirement here that justifies horizontal scaling, caching layers beyond the obvious, or any form of distributed computation. Over-engineering for imagined scale is the more likely failure than under-provisioning.

**Rate limits** to respect: Kalshi around ten requests per second for market data; Open-Meteo 10,000 daily, 5,000 hourly, 600 per minute; ESPN unpublished and therefore treated conservatively.

**Reproducibility.** A projection re-run against the same inputs and the same information cutoff must produce the same output, which requires seeded simulation. A backtest run must be reproducible from its stored configuration and code version.

**Security.** The Kalshi signing key is the highest-value secret in the system, and its blast radius is a funded trading account. Server-side only, never logged, never returned. Trading requires explicit confirmation and enforces a configurable per-slate exposure cap.

---

## Biggest Technical Risk

**Temporal leakage in the backtest.**

Everything the product claims about itself rests on the backtest being honest. If any feature is computed from information that postdates the game it predicts, the model looks skilled, the calibration curve looks excellent, the recommendations look sharp — and all of it is fiction that only reveals itself when live results diverge from backtested ones, months later and with real money on the line. It is the failure mode that is both most likely and most expensive, and it is silent by construction: a leaking backtest produces *better* numbers, which is exactly the signal a developer is disinclined to question.

The specific vectors, in rough order of likelihood:

- **Weather.** The default Open-Meteo endpoint serves reanalysis. Using it for pre-2021 seasons is a known, accepted leak that must be reported rather than hidden.
- **Reconstructed `known_at`.** Historical injury and depth-chart data arrives without publication timestamps. Every reconstruction is a guess, and guessing generously leaks.
- **Season-level aggregates.** Any feature computed over a full season and joined to a mid-season game leaks the rest of the season into the past.
- **Stat corrections.** Corrected actuals carry a correction date; using the corrected value as though it were known at game time is a subtle leak in grading.
- **Player and roster state.** Current rosters joined to historical games leak future team changes.

Mitigation is structural rather than procedural: the as-of query layer, `known_at` on every fact, reconstruction flags, and a leakage test suite that asserts a projection for a past game is identical whether computed then or now. Point-in-time correctness is the one thing in this architecture that cannot be retrofitted, which is why it is a foundational rather than a later concern.

**Secondary risks**, named but ranked below:

Contract-to-player resolution will break in ordinary ways and needs manual override from day one. The three-layer simulation compounds error across layers, so each layer must be validated separately — are predicted play counts calibrated, are predicted usage shares calibrated — or a badly calibrated result will be visible without being diagnosable. And the ESPN dependency is unsupported by construction, which the suggestion mechanism is specifically designed to survive.

---

## Open Questions

**Edge against the ask or the midpoint.** Buying costs the ask. On thin markets — precisely the ones most likely to be mispriced — the spread can be wide enough that an edge at the midpoint disappears at the executable price. Both sides of the book are stored so either is computable; which one drives ranking and recommendation needs a real slate to judge. Displaying both is the likely answer.

**Grading truth when Kalshi and the official stat line disagree.** Stat corrections can land days after settlement. The answer may legitimately differ by purpose: the official line is the right truth for grading the model, while Kalshi's settlement is the only truth for grading a position. If so, the two must be stored separately rather than reconciled into one number.

**Model versioning and historical projections.** When the model changes, existing stored projections were produced by a different model. Whether the calibration surface reports per-version, blends versions, or backfills is undecided. Backfilling is expensive and re-introduces leakage risk if the as-of discipline is not perfectly honoured on re-run.

**How many contracts list on a typical slate.** Still unverified, and it shapes the slate view's information density. Six and sixty are different designs.

**Whether row-level security is worth enabling** on user-scoped tables given a three-user, two-role system where the Python runtime bypasses it by design. Defensible either way; currently proposed as defence in depth rather than the primary mechanism.
