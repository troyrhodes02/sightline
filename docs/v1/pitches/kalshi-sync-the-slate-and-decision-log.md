# Sightline — Pitch: Kalshi Sync, The Slate & Decision Log

> Source: Linear document `133b353a-1b81-4f36-a521-84a44b91da1c` in project **Sightline V1**.
> https://linear.app/sightline-pilot/document/sightline-pitch-kalshi-sync-the-slate-and-decision-log-bb963b10c4ae

## Summary

This pitch delivers Sightline's first complete user-facing product loop. William and invited viewers can open the application, see the upcoming Kalshi NFL player-prop market alongside Sightline's stored projections, inspect where the model disagrees with current prices, and understand which contracts the system considers most compelling.

William can also record what he decided to do about any contract, including contracts Sightline did not recommend. From this pitch onward, Sightline begins accumulating the market observations, recommendation states, and human decisions that cannot be reconstructed later and that every downstream grading, accuracy, bankroll, and trading feature depends on.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L — This pitch combines an external market integration, cross-source contract resolution, live price state, projection-to-market comparison, recommendation ranking, two substantial application surfaces, role-aware private decisions, degraded modes, and durable snapshots for later grading. The scope is large, but it is a coherent vertical slice: removing any major part would leave the core pre-kickoff workflow incomplete.

This pitch should not be split into "Kalshi backend," "slate UI," and "decision logging" pitches. Those pieces only deliver value when they work together. A market sync without the slate is invisible infrastructure, the slate without current market data is merely a projection browser, and the slate without decision capture fails to begin measuring whether William's judgment adds value.

## Problem

Sightline's core job is to tell William which of today's Kalshi NFL player contracts are mispriced, how much to trust that judgment, and how much to stake. Pitches 1 and 2 establish the historical corpus, point-in-time discipline, backtest harness, and baseline projection model, but they do not yet answer the question William faces before kickoff: how does Sightline's belief compare with the price currently available in the market?

Without the market side, a projection has no decision context. A receiver projected for 62 yards is not automatically a trade. The relevant question is whether the probability of clearing Kalshi's threshold is meaningfully different from the probability implied by the price William can actually obtain.

That comparison must also be inspectable. William is technically sophisticated and does not want an unexplained verdict. He needs to see the underlying projection, expected range, confidence, drivers, timestamps, and market state so that he can judge whether the apparent edge is trustworthy or rests on old or incomplete information.

Finally, William currently has no durable record of his own decisions. Even if the model identifies useful disagreements, Sightline cannot later determine whether William followed good recommendations, correctly faded bad ones, acted too early, or simply remembered his best calls. A decision must be captured with the state visible at the time it was made or it becomes anecdote rather than evidence.

This pitch solves that missing core loop: connect stored projections to current Kalshi contracts, rank the resulting opportunities, expose the reasoning, and record William's response.

## Solution Shape

Sightline presents a rolling pre-kickoff slate containing Kalshi NFL player-prop contracts for games that have not yet started.

For every discovered market, the system attempts to resolve the contract to the corresponding Sightline player, stat type, threshold, and game. Successfully resolved contracts are joined with the freshest stored projection and the freshest observed Kalshi book state. Contracts that cannot be resolved are retained and surfaced explicitly rather than disappearing from the slate.

The application does not run the projection model when the slate is opened. It reads projections already stored by the Pitch 2 model path and combines them with current market observations according to the two-clock architecture established in the Architecture Doc:

* Projections are precomputed and stored.
* Market prices are refreshed independently.
* Edge is computed when the slate is read from the freshest available projection and market observation.
* The user never waits for a model run merely to open the application.

The slate is ordered by confidence-adjusted edge. Contracts that meet the configurable recommendation threshold are visibly marked, while contracts below the threshold remain available and are visually de-emphasized rather than removed. A slate containing no recommendations is a valid outcome, not a system failure.

Each contract row provides the information needed for rapid comparison:

* Player and game context.
* Stat type and threshold.
* Sightline's threshold probability.
* Kalshi's current price.
* The resulting edge.
* Projection confidence.
* Recommendation state.
* Projection and price timestamps.

Opening a resolved contract reveals the fuller reasoning already produced by the projection system:

* Projected value.
* Expected range or distribution summary.
* Confidence.
* Top projection drivers.
* Projection computation time.
* Information cutoff.
* Current market observations.
* Recommendation state and comparison details.

The detail view explains the current opportunity; it does not introduce manual projection editing, adjustment suggestions, staking, or order placement.

William can record one of three explicit dispositions against a contract:

* **Took** — he agrees sufficiently to take the indicated side outside Sightline.
* **Faded** — he takes or favors the opposing side.
* **Skipped** — he considered the contract and intentionally passed.

A contract may also remain unmarked. Sightline never forces a decision merely because William opened a detail view.

The decision is anchored to the contract rather than to the recommendation. William can therefore log a take, fade, or skip on any visible contract, including one that Sightline did not recommend or one where its current edge was negligible.

When William records or changes a decision, the server captures the relevant decision-time state from trusted stored and live data. The browser does not submit authoritative values for projection probability, price, confidence, edge, or recommendation status. This preserves the decision as a trustworthy historical observation that can be graded in a later pitch.

Recommendation states are also persisted at meaningful points so that the system can later grade what it recommended, not merely reconstruct what the current model would recommend after the fact. The precise snapshot-triggering rules belong to the design document, but the resulting history must represent recommendation states as they actually existed.

The interface respects the access model established in Pitch 3:

* Admin and viewers see the same shared slate, projections, prices, edges, recommendations, confidence values, and projection reasoning.
* Only William can create or change decisions.
* Viewers cannot see William's decision state, decision history, or any private analytics derived from it.
* Authorization remains server-enforced rather than dependent on hidden controls.

Kalshi failures produce a degraded but usable application. If current market data cannot be retrieved, stored projections and their reasoning remain available while prices, edges, and recommendations are clearly unavailable. The slate does not collapse into a generic error page merely because Kalshi is temporarily unreachable.

The market integration, price observations, contract resolution, recommendation snapshots, and decision records follow the source-of-truth and security boundaries established in the Architecture Doc. This pitch points to those decisions and does not redefine schemas, routes, signing logic, or component structures.

## In Scope

* **Kalshi Market Sync** — Discover currently listed Kalshi NFL player-prop contracts, resolve each contract to Sightline's player, stat type, threshold, and game, capture both sides of the current market with observation timestamps, refresh market state within published limits, and visibly retain unresolved contracts.
* **Edge Calculation and Recommendation** — Compare the freshest stored projection with the freshest current price, compute confidence-adjusted edge, rank the slate, apply a configurable recommendation threshold, and persist recommendation states for later grading.
* **Decision Log** — Allow the admin to mark took, faded, skipped, or leave a contract unmarked, while capturing trusted decision-time state and keeping all decision information invisible to viewers.

The following user-facing surfaces are included as the vertical presentation of those PRD features:

* The rolling slate list.
* The contract detail view.
* Shared projection, market, edge, confidence, and recommendation presentation.
* Projection distribution summary and top-driver presentation.
* Admin take, fade, and skip controls.
* Designed empty, unresolved, partially available, and Kalshi-unavailable states.

This pitch includes only the discovery and live-pricing portion of **Kalshi Market Sync**. Settlement ingest from that PRD feature is explicitly delivered later by **Pitch 6: Outcome Scoring & Accuracy Surface**.

## Out of Scope / Boundaries

* Scheduled projection ingest and recomputation are excluded. Projections are produced manually or through the existing out-of-band Pitch 2 path until **Pitch 5: Live Pipeline & Staleness** automates them.
* Staleness calculation and stale-contract marking are excluded. Projection and price timestamps are visible, but the explicit staleness model belongs to Pitch 5.
* Morning-of-game recompute behavior, per-game scheduling, scheduler keepalive, and skipped-job health detection belong to Pitch 5.
* Kalshi settlement ingest, official result ingest, grading, stat-correction handling, and outcome reconciliation belong to **Pitch 6: Outcome Scoring & Accuracy Surface**.
* Reliability curves, Brier scores, baseline comparisons, override performance, recommendation performance, and timing-cost analytics belong to Pitch 6.
* The final pre-kickoff snapshot used to calculate timing cost is not completed here. Pitch 4 captures decision-time state; Pitch 6 owns the final comparison and derived timing metric.
* Probability recalibration, bankroll state, paper and live ledgers, stake calculations, exposure caps, and dry runs belong to **Pitch 7: Bankroll, Sizing & Paper Trading**.
* Autonomous decision cycles, scheduled paper execution, circuit breakers, withdrawal notifications, and the paper-to-live gate belong to **Pitch 8: Autonomous Execution & Circuit Breakers**.
* Simulation-based projections, joint outcomes, usage redistribution, and advanced model-derived drivers belong to **Pitch 9: Simulation Engine**.
* Adjustment suggestions and source-reliability behavior belong to **Pitch 10: Adjustment Suggestions & Source Reliability**.
* Order placement, fill handling, funded-account reconciliation, and live Kalshi positions belong to **Pitch 11: Kalshi Live Trading**.
* This pitch does not allow viewers to log decisions, maintain personal pick histories, or share picks. Those would change the viewer role and belong to later product consideration.
* This pitch does not create or edit projections from the interface.
* This pitch does not allow William to manually overwrite model probabilities, confidence values, or recommendation calculations.
* This pitch does not use Kalshi prices as model inputs. Prices remain the comparison target.
* This pitch does not guarantee that a displayed recommendation can be filled at meaningful size. Market liquidity analysis and paper-fill fidelity are handled in later staking work.
* This pitch does not support in-game contracts or actions after kickoff.
* This pitch does not integrate sportsbooks, DFS products, or any venue other than Kalshi.
* This pitch does not introduce notifications, alerts, messaging, or social activity.
* This pitch does not become a general Kalshi market browser. Only supported NFL player-performance contracts are relevant to the product.

## Definition of Done

* The active Kalshi NFL player-prop contract set for all upcoming, not-yet-started games can be discovered and presented in Sightline.
* The active contract set refreshes when the slate is viewed and on a bounded background interval without exceeding Kalshi's published market-data limits.
* Every discovered contract is either resolved to a Sightline player, stat type, threshold, and game or is explicitly represented as unresolved.
* An unresolved contract is visible for investigation and is never silently dropped from the discovered market set.
* Both sides of each available market are captured with an observed-at timestamp.
* Projection and market timestamps are displayed separately so the user can distinguish old model state from old price state.
* A resolved contract with both a projection and an available price has its edge computed from the freshest available instance of each.
* A contract with a price but no usable projection displays no edge or recommendation.
* A contract with a projection but no available price continues to expose projection information without inventing an edge.
* The slate ranks resolved, comparable contracts by confidence-adjusted edge.
* The recommendation threshold is configuration rather than a hardcoded product constant.
* Contracts below the recommendation threshold remain visible and ranked but are visually de-emphasized.
* A slate where nothing exceeds the recommendation threshold renders as a valid no-recommendations state.
* Recommendation states are persisted as historical snapshots so later grading can determine what Sightline recommended at the relevant time.
* The slate row for a resolved contract shows the player, stat and threshold, model probability, current market price, edge, confidence, recommendation state, and relevant timestamps.
* Opening a resolved contract exposes the projected value, expected range or distribution summary, confidence, top available drivers, computed-at time, information cutoff, current price state, and recommendation context.
* A contract that cannot be projected can still be surfaced without displaying fabricated probabilities, edges, or recommendations.
* William can mark a visible contract as took, faded, or skipped.
* Took, faded, and skipped remain distinct states.
* William can leave a contract unmarked without being prompted or forced to select a disposition.
* William can record a decision against a contract Sightline did not recommend.
* Decisions are anchored to contracts rather than requiring a recommendation record to exist.
* Decision-time model probability, market price, edge, confidence, recommendation state, and projection timestamp are captured from server-trusted state rather than client-submitted numbers.
* Viewers cannot create, edit, delete, retrieve, infer, or see William's decisions through either the interface or direct route access.
* A Kalshi outage degrades the application to projection-only behavior rather than preventing the slate and contract-detail surfaces from rendering.
* An empty contract set renders as a designed empty state rather than as an application error.
* Games that have started or completed do not remain actionable in the upcoming slate.
* A market void, cancellation, disappearance, or threshold change does not silently erase previously stored recommendation or decision history.
* Refreshing current prices does not alter previously captured decision-time or recommendation-snapshot values.
* Opening the slate does not trigger or wait for a model run.

## Rabbit Holes

* **Contract-to-player resolution.** Kalshi naming will differ from nflverse naming through suffixes, punctuation, initials, duplicate names, rookies, trades, and mid-season signings. Name matching that works on the obvious cases can still fail exactly where the product most needs a projection.
* **Multiple contracts for one player and stat.** Kalshi may list several thresholds for the same player-stat-game combination. Each is a distinct contract and must not overwrite or collapse into another.
* **Threshold changes and relisting.** A market may disappear and return at a different threshold. Historical observations, decisions, and recommendations must remain attached to the original contract identity rather than being rewritten as though the new listing were the same object.
* **Executable price versus midpoint.** A thin market can show a convincing midpoint edge that disappears at the ask. The roadmap intentionally leaves the recommendation-driving price unresolved until real slate behavior is observed.
* **Book-side interpretation.** Both sides must be represented correctly. Confusing the cost of buying one outcome with the implied probability or price of the opposing outcome can produce apparently sensible but inverted edges.
* **Price freshness during viewing.** The market can move between rendering the slate, opening detail, and logging a decision. The interface must make timestamps legible, and the server must capture the actual decision-time state rather than trusting the stale values rendered earlier.
* **Refresh storms.** Refresh-on-view plus a background interval can create duplicate traffic when several users open the slate or leave it running. Rate-limit discipline must be centralized rather than delegated to each browser.
* **Snapshot explosion.** Persisting every unchanged recommendation on every refresh would create noise without adding evaluative value. Persisting too little would make later grading impossible. The design stage must define the meaningful snapshot events.
* **Projection availability gaps.** Some listed players may have insufficient history or unsupported stat types. Their contracts must remain visible without the system bluffing a confident estimate.
* **Baseline driver quality.** Pitch 4 promises a detail view with drivers, but the Pitch 2 roadmap definition of done does not explicitly guarantee that the first baseline implementation produces useful human-readable drivers.
* **Game-state transitions.** Kickoff can move, games can be postponed or cancelled, and markets can remain open unexpectedly. The upcoming slate must not rely on a simplistic calendar-day filter.
* **Outage ambiguity.** Kalshi being completely unreachable differs from a single malformed market, a partial response, stale stored observations, or a rate-limit response. Those states should not all collapse into one generic "market unavailable" message.
* **Empty slate interpretation.** No NFL games, no listed contracts, late market publication, an integration failure, and every contract being unresolved are different conditions. The interface should avoid falsely reassuring or falsely alarming the user.
* **Decision changes.** The PRD permits changed decisions but does not fully define whether the product presents one mutable current disposition, an append-only decision history, or both. Grading later depends on what counts as the acted-on decision.
* **Post-kickoff writes.** A delayed browser, stale page, or moved kickoff can allow an attempted decision after the game begins. The authoritative boundary must be enforced server-side.
* **Voided markets.** A decision against a later-voided contract should remain part of the historical record without being treated as an ordinary win or loss.
* **Kalshi versus official identity.** A market may appear valid but reference the wrong game or stat mapping. A false successful resolution is more dangerous than an unresolved flag because it produces a confidently wrong edge.
* **Large-slate density.** The number of listed contracts is still unverified. A design that works for eight contracts may become unusable with sixty, while a dense terminal-like layout may feel absurd when only a handful exist.
* **Recommendation ties.** Equal or nearly equal confidence-adjusted edges need deterministic ordering so the slate does not reshuffle inexplicably across refreshes.
* **Extreme market prices.** Prices near zero or one can produce dramatic-looking differences that are not economically meaningful, liquid, or stable.
* **Projection version changes.** New projection runs can arrive while a user is reviewing the slate. Current edge should update, while historical recommendation and decision snapshots remain fixed.
* **Silent partial failure.** A successful page render containing only half the contract set can be more misleading than a visible failure. Market-set completeness needs an explicit concept during design.
* **Viewer privacy through indirect exposure.** Even if viewers cannot open a decision page, badges, row styling, counts, caching, or response payloads must not reveal which contracts William marked.

## No-Gos

* Do not hide unresolved contracts to make the slate appear cleaner.
* Do not resolve contracts through unreviewable fuzzy name matching alone.
* Do not allow the browser to submit authoritative projection, price, edge, confidence, or recommendation values with a decision.
* Do not compute edge from a price with no visible timestamp.
* Do not pair a current price with a projection while concealing that the projection is older.
* Do not use Kalshi price movement as an input to the projection model.
* Do not trigger a model recomputation when the slate is opened.
* Do not block the entire slate because one contract is malformed or unresolved.
* Do not block projection access merely because Kalshi is unavailable.
* Do not filter low-edge contracts out of existence.
* Do not force William to record a decision.
* Do not treat skipped and faded as the same action.
* Do not require a Sightline recommendation before William can log a decision.
* Do not expose William's decisions to viewers in payloads, counts, filters, styling, or analytics.
* Do not begin calculating win rates or recommendation accuracy before settlement and grading exist.
* Do not build timing-cost analytics in this pitch.
* Do not add order-size fields, bankroll controls, Kelly settings, or trade buttons.
* Do not simulate fills or create paper positions.
* Do not place real or demo orders.
* Do not add a generic market watchlist, favorites system, comments, or social feed.
* Do not build a manual player-mapping operations suite larger than what is necessary to inspect and correct unresolved contracts.
* Do not introduce WebSockets for price updates. The Architecture Doc explicitly rejects millisecond market-making infrastructure for this product.
* Do not create a generalized exchange abstraction for hypothetical future venues.
* Do not optimize for thousands of concurrent users. Sightline has a deliberately small, invite-only audience.
* Do not silently overwrite prior recommendation states when projections or prices change.
* Do not fabricate a recommendation where either the projection or required market state is missing.
* Do not preemptively build Pitch 5 staleness rules inside timestamp presentation.
* Do not use settlement as the source for removing upcoming markets before Pitch 6 owns settlement ingest.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** — Supplies player and game identities, source mappings, the historical data foundation, and the point-in-time model required for trustworthy stored projections.
* **Pitch 2: Backtest Harness & Baseline Model** — Supplies the stored baseline projection distributions, projected values, confidence, timestamps, information cutoffs, and model versions that the slate compares against Kalshi prices.
* **Pitch 3: App Shell, Brand & Access** — Supplies the authenticated application container, Material UI design system, responsive shell, admin and viewer roles, navigation model, and server-enforced access boundaries.
* Kalshi market-data access must be configured for server-side use, including any credentials required for authenticated discovery or price requests.
* The player-identity mapping foundation from Pitch 1 must support explicit Kalshi identifiers or manual correction for names that cannot be resolved automatically.
* At least one current stored projection set from the Pitch 2 baseline path must exist for the slate to show model-to-market comparisons.
* The production database must be available as the shared seam between the Python-produced projections and the TypeScript application.
* The application environment must be able to reach Kalshi without exposing credentials or signing material to the browser.
* Published Kalshi market-data limits and the expected NFL contract taxonomy must be verified against the live integration before the design document fixes refresh and discovery behavior.

## Open Questions

### 1. Which price drives edge, ranking, and recommendation?

The Architecture Doc, PRD, and Pitch Roadmap deliberately leave open whether the primary comparison should use the executable ask, the midpoint, or present both while ranking conservatively.

Buying costs the ask. On thin markets, an apparent midpoint edge may not be tradeable at all. The Pitch 7 sizing requirements later settle on executable price net of fees, but Pitch 4 still needs an explicit display and recommendation rule.

This pitch should observe real slate spreads and then resolve:

* Which price is displayed as the primary market probability.
* Which price drives ranking.
* Whether both midpoint and executable price are shown.
* How the selected side is explained for take and fade decisions.

### 2. How many contracts appear on a typical slate?

The Product Brief, PRD, and Architecture Doc all identify slate depth as unverified. The answer materially changes the main view.

The design document should not assume that six, twenty, and sixty contracts can share the same information density, navigation, filtering, and mobile treatment. Real Kalshi slate observation should inform the design before the list structure is finalized.

### 3. Does the Pitch 2 baseline provide displayable projection drivers?

The Pitch 4 roadmap explicitly includes a contract detail view with drivers and a distribution summary. The PRD's general **Projection Engine** acceptance criteria require top drivers, but the frozen Pitch 2 roadmap definition of done does not explicitly mention them.

Before the Pitch 4 design is finalized, verify whether the stored baseline projection already provides useful human-readable drivers. If it does not, the roadmap needs to clarify whether:

* Pitch 4 adds a minimal baseline-driver presentation.
* Pitch 2 receives a bounded correction ticket.
* The detail view ships with a deliberate unavailable state until Pitch 9's simulation-derived drivers arrive.

Inventing narrative explanations in the application is not an acceptable substitute.

### 4. Which events create a Recommendation Snapshot?

The requirement to preserve recommendations for later grading is clear, but the behavioral snapshot boundary is not.

Possible meaningful moments include:

* A recommendation first appearing.
* A recommendation changing state.
* A material price or projection change.
* William opening the contract.
* William recording a decision.
* A final pre-kickoff capture.

The design document must define sufficient history for later grading without storing endless identical snapshots from routine refreshes.

### 5. How may William change a decision?

The PRD names changed decisions and multiple decisions on one contract as edge cases but does not define the intended user behavior.

The design stage needs to resolve:

* Whether a decision is editable only before kickoff.
* Whether changing a decision preserves prior states.
* Which state counts as the final acted-on disposition.
* Whether a change captures a fresh decision-time snapshot.
* Whether multiple distinct decisions on opposing sides are ever legitimate.

This must be settled before Pitch 6 grades decisions.

### 6. What is the authoritative boundary for removing contracts from the upcoming slate?

Games can be postponed, kickoff times can change, and Kalshi markets may close earlier or later than expected. The pitch requires that started games cease to be actionable, but the exact relationship among scheduled kickoff, market status, and current time is not specified at the pitch level.

The design must choose an honest behavioral rule without drifting into in-game support.

### 7. How visible should unresolved contracts be to viewers?

Unresolved contracts must be surfaced rather than dropped. It remains unclear whether the full diagnostic reason and manual-resolution controls are admin-only while viewers receive a simpler unavailable state.

The access model should separate useful transparency from internal integration diagnostics.

### 8. What constitutes a complete market refresh?

A partially successful Kalshi response could leave the slate looking valid while silently omitting markets. Before implementation, the design document should define the observable distinction between:

* A complete refresh.
* A partial refresh.
* A stale cached contract set.
* A full Kalshi outage.
* An empty but valid market set.

### 9. How does manual contract-resolution correction behave historically?

The Architecture Doc requires explicit mapping with manual override, but the pitch does not determine whether correcting a mapping updates only future reads or also repairs earlier unresolved observations and recommendation eligibility.

The desired product behavior should be settled before the underlying design is chosen.

### 10. Which shared accuracy cues belong on the contract detail view?

Pitch 6 owns the formal Accuracy and Calibration Surface. However, a viewer assessing a recommendation may eventually need some indication of model calibration or sample reliability.

Pitch 4 should not pull the accuracy surface forward, but its contract-detail design should avoid a structure that makes later addition of trustworthy calibration context awkward or impossible.
