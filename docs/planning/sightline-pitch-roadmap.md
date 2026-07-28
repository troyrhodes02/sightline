# Sightline — Pitch Roadmap

## Sequencing Logic

The ordering is driven by one asymmetry: **most of this product can be validated offline, and the single most important thing about it cannot.** Twenty-five seasons of historical data let the backtest establish whether the model beats naive baselines, and that work can happen at any time of year. But the riskiest assumption — whether Sightline can be better calibrated than the market it trades against — depends on Kalshi prop prices, which have only existed since the 2025 season. There is not enough price history to backtest it. That answer accumulates one live slate at a time, and every week the product is not instrumented is a week of market data, decision records, and source-reliability evidence that can never be recovered.

So the roadmap front-loads **measurement infrastructure over modelling sophistication**. Pitches 1 and 2 establish the historical corpus with point-in-time discipline and the backtest harness, including a deliberately simple baseline projection model — which is not throwaway work, since the success criteria permanently require season-average and trailing-five baselines to compare against. Pitch 3 builds the shell, brand, and access model before any substantial surface exists, so nothing is constructed in stock Material UI and rebuilt later. Pitches 4 through 6 turn on the market side, the live pipeline, and the scoring loop, at which point Sightline is a complete working product that records everything it needs to eventually answer its own hardest question. The simulation engine arrives at pitch 7, swapping the model behind surfaces that already store, display, price, and grade projections — a contained change, rather than building an interface around an unvalidated model.

Risk is therefore split rather than uniformly front-loaded. The *technical* risk — temporal leakage — is attacked first, in pitch 1, because point-in-time correctness cannot be retrofitted and its failure mode is silent and flattering. The *product* risk is deliberately deferred, not because it is unimportant but because it is unanswerable until live weeks accumulate. Trading is last by an explicit gate: it does not ship until the harness has produced a real accuracy record.

---

## Pitches

### Pitch 1: Corpus & Point-in-Time Foundation

- **Type:** Foundational
- **Value delivered:** A complete, queryable historical NFL corpus that structurally cannot leak future information into a past prediction. Nothing user-facing ships, but every downstream claim about accuracy depends on this being right.
- **Includes:** Historical Data Ingest. Bitemporal schema with `valid_at` and `known_at` on every fact. The as-of query layer. Player identity resolution across nflverse, ESPN, and Kalshi naming. Weather ingest with the era-split policy. Prisma schema and migrations as the single source of schema truth.
- **Defers:** All modelling, all market data, all interface.
- **Depends on:** Nothing.
- **Definition of done:**
  - Play-by-play, rosters, depth charts, snap counts, participation, schedules, and injury designations are ingested for the full covered history and retrievable per player-game.
  - Every fact carries `valid_at` and `known_at`; reconstructed timestamps are flagged as reconstructed.
  - The as-of query layer makes any row with `known_at` later than a supplied cutoff unreachable — enforced structurally, not by convention.
  - A leakage test suite asserts that a query for a past game returns identical results regardless of when it is run.
  - Weather uses archived-forecast sources for seasons where they exist and reanalysis earlier, with the era recorded per record.
  - Ingest is idempotent; re-running produces no duplicates and no changes.
  - A named source becoming unavailable produces an explicit failure, never a silent gap.
  - Player identity resolves across all sources, with manual override available for unmatched cases.

### Pitch 2: Backtest Harness & Baseline Model

- **Type:** Foundational
- **Value delivered:** The ability to answer "is this model any good" before a single live slate exists — and a permanent baseline that every future model is measured against.
- **Includes:** Backtesting Harness. Projection Engine, first implementation: a simple distributional model producing a full distribution per player-stat-game from trailing form with an assumed shape per stat type. Season-average and trailing-five baselines. Calibration computation. Runbook documentation.
- **Defers:** Simulation, usage allocation, teammate interaction effects, any live data, any interface.
- **Depends on:** Pitch 1.
- **Definition of done:**
  - A run executes chronologically across a configurable season range using only information available before each game.
  - Output is a distribution per projection, not a point estimate; threshold probability is derivable for any threshold.
  - Every projection carries `computed_at`, `information_cutoff`, `model_version`, and a confidence value.
  - Results include error against actuals and against both baselines, plus calibration figures, broken out by stat type, season, and weather era.
  - A run is reproducible from stored configuration and code version; simulation is seeded.
  - Aggregate results and calibration bins are written to Postgres; raw per-prediction output is written to local Parquet.
  - Written runbook documentation covers executing, configuring, and interpreting a run — shipped as part of this pitch, not after it.
  - An interrupted run never leaves partial results presented as complete.

### Pitch 3: App Shell, Brand & Access

- **Type:** Foundational
- **Value delivered:** A branded, responsive, invite-only application that authenticated users can log into — the container every later surface is built inside.
- **Includes:** Brand and Responsive Interface. Authentication and Invite. The Material UI theme as a named deliverable. Navigation, empty states, and the health read.
- **Defers:** Every data surface. This pitch ships a shell, deliberately.
- **Depends on:** Nothing technically, but sequenced here so no user-facing surface is ever built in stock Material UI.
- **Definition of done:**
  - A comprehensive Material UI theme defines palette, typography, shape, elevation, and component overrides, and every surface uses it without inline one-off styling.
  - Public signup does not exist; accounts are created only by admin invitation, and revocation takes effect immediately.
  - Admin and viewer roles exist and are enforced server-side; a viewer deep-linking to an admin route is rejected by the server, not merely hidden in the interface.
  - Every surface is usable at phone, tablet, and desktop widths without horizontal scrolling.
  - Empty states are designed across every surface rather than rendering as errors.
  - The health read exposes last successful ingest, recompute, and price refresh.
  - Sessions persist across devices.

### Pitch 4: Kalshi Sync, The Slate & Decision Log

- **Type:** Feature
- **Value delivered:** The core loop. William opens Sightline, sees every listed Kalshi contract ranked by confidence-adjusted edge with recommendations marked, and records what he did about it. From this pitch onward the unbackfillable data — market prices and decisions — begins accumulating.
- **Includes:** Kalshi Market Sync. Edge Calculation and Recommendation. Decision Log. The slate list, the contract detail view with drivers and distribution summary, and the take/fade/skip control.
- **Defers:** Scheduled recomputes and staleness marking (pitch 5), settlement and grading (pitch 6), order placement (pitch 9). Projections come from the pitch 2 baseline model, computed manually or on demand.
- **Depends on:** Pitches 1, 2, 3.
- **Definition of done:**
  - The active contract set for all upcoming games is discovered and refreshed on view and on a background interval, within published rate limits.
  - Every contract resolves to a player, stat type, threshold, and game, or is explicitly flagged unresolved and surfaced rather than dropped.
  - Both sides of the book are stored with an observed-at timestamp.
  - Edge is computed at read time from the freshest projection and freshest price, each displayed with its own timestamp.
  - The slate ranks by confidence-adjusted edge; contracts below the recommendation threshold remain visible and de-emphasised rather than filtered.
  - The recommendation threshold is configuration, not a constant.
  - Recommendation snapshots are stored so they can be graded later.
  - A decision is anchored to a contract, not a recommendation, and can be logged on a contract Sightline never flagged.
  - Took, faded, and skipped are distinct; unmarked is a valid resting state.
  - The decision snapshot is captured server-side, never from client-supplied numbers.
  - A Kalshi outage degrades to projections-only; the slate still renders.
  - An empty slate renders as a designed empty state.
  - Decisions are invisible to viewers.

### Pitch 5: Live Pipeline & Staleness

- **Type:** Foundational
- **Value delivered:** Sightline maintains itself. Projections refresh on a news-driven schedule without intervention, and the product is honest about the age of what it is showing.
- **Includes:** Staleness Disclosure. Scheduled ingest, recompute, and price jobs on GitHub Actions. Per-game recompute scoping. Keepalive workflow. Health surfacing in the interface.
- **Defers:** Adjustment suggestions and the ESPN feed (pitch 8).
- **Depends on:** Pitches 1, 2, 4.
- **Definition of done:**
  - Nightly in-week ingest and recompute run on schedule, plus a morning-of recompute per game window.
  - Recomputes are scoped per game and measured backward from each game's own kickoff, so Thursday, Sunday morning international, Saturday, and Monday games are one code path.
  - Every contract row and detail view exposes projection age and information cutoff.
  - Once a game passes the point at which inactives publish, its contracts are marked stale until ingested — visible in the list view, not only on detail.
  - Staleness is scoped per game; an early game going stale does not mark later ones.
  - A keepalive workflow commits before the sixty-day inactivity deadline, so schedules survive the offseason.
  - The interface surfaces when the last successful run falls outside expected bounds, so a silently skipped job is visible in the product.
  - Slate rendering never waits on a model run.

### Pitch 6: Outcome Scoring & Accuracy Surface

- **Type:** Feature
- **Value delivered:** The loop closes. Every projection, recommendation, and decision is graded automatically, and the product's primary success metric becomes visible inside the product.
- **Includes:** Outcome Ingest and Scoring. Accuracy and Calibration Surface. Override performance and timing cost.
- **Defers:** Suggestion reliability analytics, which require pitch 8.
- **Depends on:** Pitches 1, 2, 4.
- **Definition of done:**
  - Settlement and official results are ingested with no manual action.
  - Every projection for a completed game reaches a graded or explicitly unresolvable state.
  - Grading is idempotent; a stat correction re-grades affected records rather than leaving a stale result.
  - The reliability curve renders observed hit rate against stated probability with sample size per bucket, alongside the Brier score and both baselines.
  - The surface is filterable by stat type and time period and remains available year-round, including when no games are scheduled.
  - Timing cost is computed from the difference between decision-time and final pre-kickoff snapshots.
  - Override performance and timing cost are admin-only.
  - Every displayed rate carries its sample size; insufficient data renders as an honest empty state rather than a precise-looking figure.

### Pitch 7: Simulation Engine

- **Type:** Feature
- **Value delivered:** The real model. Joint distributions across players in a game, native handling of usage redistribution, and readable drivers that fall out of the model's structure rather than being narrated on top of it.
- **Includes:** Projection Engine, second implementation: game environment, usage allocation, efficiency, and vectorised Monte Carlo. Per-layer calibration validation. The baseline model is retained permanently as a comparison.
- **Defers:** Nothing new user-facing — this swaps the model behind existing surfaces.
- **Depends on:** Pitches 1, 2. Ships against surfaces built in 4 through 6.
- **Definition of done:**
  - Simulation is vectorised across runs; a full slate recompute completes well under a minute and a single-game recompute in seconds.
  - Output is a compact stored distribution — quantile grid for continuous stats, explicit probability mass function for low-count discrete stats — from which any threshold probability is derivable without re-simulating.
  - Joint outcomes across players within a game are derivable from stored runs.
  - Each layer is validated separately: predicted play counts and predicted usage shares are independently calibrated.
  - Drivers are produced from the model's own structure and are readable as sentences.
  - Backtest results demonstrate the simulation's calibration and error against the pitch 2 baseline, per stat type and season.
  - Kalshi prices are not an input at any layer.
  - Adding a stat type requires no structural change.
  - Simulation is seeded and reproducible.

### Pitch 8: Adjustment Suggestions & Source Reliability

- **Type:** Feature
- **Value delivered:** Late-breaking information reaches the product without an unproven source being trusted automatically — and the evidence to decide whether it can be trusted later.
- **Includes:** Adjustment Suggestions as a general mechanism. Suggestion Reliability Analytics. ESPN inactives as the first source.
- **Defers:** Additional suggestion sources, which reuse the mechanism without changing it.
- **Depends on:** Pitches 1, 5, 6, 7.
- **Definition of done:**
  - A suggestion carries source, human-readable evidence, target projection, and proposed change to value, range, and confidence.
  - Accepting updates the displayed projection; declining leaves it unchanged; both are one action.
  - The adjusted projection is computed and stored as a shadow regardless of acceptance, and both base and adjusted are graded against the outcome.
  - Source accuracy and adjustment accuracy are reported as separate figures, broken out by source, with sample size displayed.
  - Adding a new source requires no change to the suggestion, display, or grading mechanism.
  - Viewers see the effects of accepted suggestions but cannot accept or decline.
  - The ESPN feed becoming unavailable stops suggestions and surfaces staleness rather than failing anything.
  - Contradictory or reversed suggestions from the same source are handled explicitly.

### Pitch 9: Kalshi Trading

- **Type:** Feature
- **Value delivered:** Positions are taken without leaving the application, and every position traces back to the projection and reasoning that produced it.
- **Includes:** Kalshi Trading. Order placement with confirmation, per-slate exposure cap, fill handling, position recording, and reconciliation.
- **Defers:** Bankroll and portfolio management, which is V2.
- **Depends on:** Pitches 4, 6, 7 — and gated on a stored backtest run demonstrating accuracy.
- **Definition of done:**
  - The feature is exercised against Kalshi's demo environment before any live account is enabled.
  - No order is submitted without an explicit confirmation showing size, the price actually payable, and total cost.
  - A configurable per-slate exposure cap exists and is enforced.
  - Fills, partial fills, and rejections are reported plainly and recorded.
  - Positions link to the decision, recommendation, and projection that produced them.
  - Reconciliation compares Kalshi's positions against locally recorded ones, so an order that succeeded remotely but failed to record locally is detectable.
  - Only the admin's credentials are ever stored; no viewer credential is accepted, stored, or transmitted.
  - The feature cannot be enabled before a stored backtest run exists.

---

## Dependency Map

Pitch 1 blocks everything. Nothing in this product is meaningful without a leakage-safe corpus.

Pitch 2 requires 1, and blocks 4, 6, 7, and 9 — every pitch that displays or grades a projection needs a projection to exist.

Pitch 3 has no technical dependency but is sequenced before 4 so that no user-facing surface is built outside the design system.

Pitch 4 requires 1, 2, and 3. It is the first pitch that delivers user-facing value and the first that accumulates unbackfillable data.

Pitch 5 requires 4, since staleness marks contracts and recomputes feed the slate.

Pitch 6 requires 4 for recommendation snapshots and decisions to grade, and 1 for official results.

Pitch 7 requires 1 and 2, and is designed to ship into surfaces built by 4 through 6. It has no dependency on 5, so pipeline and model work can proceed in either order if pitch 7 slips.

Pitch 8 requires 7 for meaningful redistribution, 5 for the staleness model it plugs into, and 6 for the grading its analytics depend on.

Pitch 9 requires 4, 6, and 7, plus the explicit gate of a stored backtest run.

No cycles. The only soft ordering is pitch 3 before pitch 4, which is a rework-avoidance decision rather than a technical constraint.

---

## Open Questions

**Whether pitch 4 should ship before pitch 3 if Week 1 comes under pressure.** The slate could technically be built on unstyled components and themed afterward. That inverts the rework-avoidance logic and is not recommended, but it is the release valve if the calendar tightens — and it is better than delaying the start of market-data accumulation.

**Whether the baseline model in pitch 2 is good enough to trade on.** If its calibration turns out to be acceptable, pitches 4 through 6 constitute a shippable product and pitch 7 becomes an improvement rather than a completion. If it is poor, pitch 7 becomes urgent. This is unknown until pitch 2 produces results, and it materially affects how the back half of the roadmap is paced.

**Whether pitch 7 needs to be split.** Game environment, usage allocation, and efficiency are three models. If any one proves research-heavy rather than build-heavy, splitting the pitch by layer — each landing with its own calibration validation — may be better than one long pitch. Deliberately left undecided until pitch 2 exposes how much signal the simple model already captures.

**Edge against ask or midpoint** remains open from the Architecture Doc and needs a real slate in pitch 4 to resolve.
