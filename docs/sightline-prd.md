# Sightline — PRD / Feature Breakdown

## Overview

Sightline projects NFL player statistical performance and compares those projections against live Kalshi player-prop contract prices, surfacing the contracts where its own probability estimate disagrees with the market's. It reports a projected value, an expected range, a confidence level, and the drivers behind each projection, and it grades every prediction it makes against settled outcomes so that its own accuracy is continuously measurable rather than assumed.

The core job: **tell William which of today's Kalshi NFL player contracts are mispriced, and how much to trust that judgment.**

Two roles exist. William is the admin — he sees everything, and in the final V1 pitch he can place trades through the application. A small number of invited friends hold viewer accounts: they see projections, prices, edges, and recommendations, and they place any trades themselves on Kalshi directly. Sightline never holds a viewer's Kalshi credentials.

---

## Core User Journeys

### Journey: Pre-Kickoff Slate Review

The primary journey and the one the product lives or dies on.

1. William opens Sightline some hours before the next kickoff window, on phone, tablet, or desktop.
2. The app presents the rolling slate — every Kalshi player-prop contract for games that have not yet started, ranked by confidence-adjusted edge.
3. Contracts meeting the recommendation threshold are visibly marked. Low-confidence and low-edge contracts remain in the list, de-emphasized rather than hidden.
4. Each row carries the essentials at a glance: the player, the stat and threshold, Sightline's probability, Kalshi's price, and the edge between them.
5. He opens a contract he's interested in. The detail view gives him the projected value and its range, the confidence and what drives it, the top factors behind the projection, when the projection was computed, and what information it was computed against.
6. If a game's inactives have dropped and Sightline hasn't ingested them, that game's contracts are marked stale. He can see that the projection predates information he knows exists.
7. He decides. If he agrees with a recommendation and wants the position, he takes it. If he disagrees, he can fade it or pass.
8. He marks his decision with one tap — took, faded, or skipped. The app records what he was looking at when he decided, not merely what he chose.
9. He can also mark a decision on a contract Sightline never recommended, including ones it flagged as having no edge.

**Where it branches or fails:** Kalshi may be unreachable, in which case projections still display without prices or edges. A contract may exist for a player Sightline cannot project. The slate may be empty entirely — a Tuesday in November or any day in June.

### Journey: Responding to an Adjustment Suggestion

1. An ingest source — initially the ESPN inactives feed — reports something that would materially change a projection.
2. Sightline raises a suggestion against the affected projection, carrying its source, the evidence behind it, and the specific change it proposes.
3. Simultaneously and independently of William, the system computes the adjusted projection and begins tracking it as a shadow. This happens whether or not he ever looks at the suggestion.
4. William sees the suggestion on the affected contract, with the evidence and the proposed change to value, range, and confidence.
5. He accepts it in one tap, and the displayed projection updates. Or he declines, and the displayed projection stands.
6. Either way, both the base projection and the shadow-adjusted projection are graded against the eventual outcome.
7. Over time, the suggestion analytics answer two separate questions: was the source telling the truth, and was the adjustment the right response to it.

### Journey: Post-Slate Scoring

Automatic; William's participation is reading, not doing.

1. Games complete and Kalshi settles its contracts.
2. Sightline ingests settlements and official results.
3. Every projection is graded. Every recommendation is scored as right or wrong. Every logged decision is evaluated against what actually happened. Every suggestion, accepted or declined, is graded against both the source's truthfulness and the adjustment's accuracy.
4. The timing cost of each decision is computed — the difference between the edge at the moment he acted and the edge immediately before kickoff.
5. All of this flows into the accuracy surfaces without any manual entry.

### Journey: Checking Model Accuracy

1. William opens the accuracy surface, at any time of year.
2. He sees the reliability curve: predictions bucketed by stated probability against observed hit rate, with the Brier score summarizing it.
3. He sees model error against the season-average and trailing-five baselines.
4. He sees, where markets existed, how Sightline's probabilities compared to Kalshi's prices over time.
5. He sees his own override record — how his takes, fades, and skips performed relative to what the model recommended — and his timing cost.
6. He sees suggestion-source reliability, broken out by source.

### Journey: Placing a Trade

Admin only, and the final V1 pitch.

1. From a contract detail view, William chooses to take a position.
2. He specifies size. The app shows the price he will actually pay and the cost of the position.
3. He confirms explicitly. No order is ever submitted from a single tap.
4. The order is submitted to Kalshi and the result — filled, partially filled, rejected — is reported plainly.
5. The resulting position is recorded and linked to the decision, the recommendation, and the projection that produced it.

**Where it fails:** rejected orders, partial fills, insufficient balance, a market that closed between viewing and confirming, a per-slate cap already reached.

### Journey: Viewer Slate Review

1. A friend opens Sightline and authenticates.
2. They see the same slate, the same projections, prices, edges, confidence values, and recommendations that William sees.
3. They see none of William's positions, decision log, or analytics.
4. They place any trades they want directly on Kalshi, outside the application.

### Journey: Invite and Onboarding

1. William invites a person by email. Public signup does not exist.
2. The invitee accepts, sets credentials, and lands on the slate with viewer permissions.
3. William can revoke access at any time.

### Journey: Empty Slate

1. Between the Super Bowl and September, or on any day with no upcoming games, the slate view is empty.
2. The empty state is deliberate rather than broken — it states when the next games are, and routes to the accuracy and backtest surfaces, which remain live year-round.

---

## Feature Inventory

### MVP Features

#### Historical Data Ingest

- **What it does:** Pulls and maintains the historical NFL corpus that the model trains and backtests on — play-by-play, rosters, depth charts, snap counts and participation, injury designations, schedule, weather, and rest and travel context. Covers the full player universe, not merely players with contracts.
- **Why:** The model must be fit and validated on all players. Training only on players Kalshi lists would bias the model toward stars and teach it nothing about the backup who just inherited a workload — which is exactly the situation where a market is most likely to be mispriced.
- **Acceptance criteria:**
  - Every completed game in the covered history has play-by-play, participation, and final player stat lines retrievable.
  - Every record carries the timestamp at which its information became available, so point-in-time reconstruction is possible.
  - Ingest is idempotent — re-running over an already-ingested period produces no duplicates and no changes.
  - A named data source going unavailable produces an explicit ingest failure, never a silent gap.
  - Stat corrections applied after initial publication are captured and update the stored result.
- **Edge cases / failure states:**
  - A player changes teams mid-season; history follows the player, and team-context features reflect the team he was on at the time.
  - Player identity collision across sources — two players with the same name, or a name rendered differently by two feeds.
  - A game is postponed, relocated, or cancelled.
  - A source silently changes its schema or column names.
  - Participation data is missing for a subset of games, which is a known gap in public sources — the model must tolerate its absence rather than assume it.
  - Weather is unavailable or meaningless for a dome game.

#### Projection Engine

- **What it does:** Produces, for a given player, stat type, and game, a probability distribution over the outcome — from which a projected value, an expected range, a threshold probability, and a confidence level are derived, alongside the primary factors driving the projection.
- **Why:** This is the product's substance. Every other feature either feeds it or presents it.
- **Acceptance criteria:**
  - Output is a distribution, not a point estimate; the probability of clearing any given threshold is derivable from it.
  - Every projection carries a computed-at timestamp and a record of the information cutoff it was computed against.
  - Every projection carries a confidence value derived from the width of its interval and the volume of relevant history for that player in that role.
  - Every projection carries its top drivers in a form displayable to a person.
  - A projection is reproducible: re-running against the same inputs and the same information cutoff produces the same output.
  - The engine never reads Kalshi prices as an input.
  - Adding a new stat type does not require structural change to the engine.
- **Edge cases / failure states:**
  - A player with little or no relevant history — a rookie debut, or a player in an unprecedented role. The engine must produce a wide, low-confidence projection or explicitly decline, never a confident guess.
  - A player returning from extended absence with stale form data.
  - A contract exists for a player the engine cannot project at all.
  - Extreme weather or a game environment with no historical analogue.
  - A stat type with a naturally low base rate, where a distribution is dominated by the zero case.

#### Kalshi Market Sync

- **What it does:** Discovers the currently listed Kalshi NFL player-prop contracts, resolves each to a player, stat type, threshold, and game, and keeps their prices current. Ingests settlement when markets resolve.
- **Why:** The market side of the comparison. Without it, Sightline is a projection site.
- **Acceptance criteria:**
  - The active contract set for all upcoming games is retrievable and refreshed on a background interval and on view.
  - Every contract is resolved to a Sightline player, stat type, threshold, and game, or is explicitly flagged unresolved.
  - Prices carry an observed-at timestamp and are displayed with it.
  - Both sides of the book are captured, so that edge can be computed against the price actually payable rather than a midpoint.
  - Settled markets are ingested with their resolution and linked to the projections that predicted them.
  - Market data requests stay within the platform's published rate limits.
  - A Kalshi outage degrades the app to projections-only rather than failing the view.
- **Edge cases / failure states:**
  - A contract references a player Sightline cannot resolve by name.
  - Kalshi relists a market at a different threshold mid-week, or lists multiple thresholds for the same player and stat.
  - A market is voided or cancelled after decisions have been logged against it.
  - A market prices at an extreme where no meaningful edge is computable.
  - A spread wide enough that edge against the ask and edge against the midpoint tell different stories.
  - Kalshi's settlement disagrees with the official stat line, or an NFL stat correction lands after settlement.
  - The market list is empty or arrives late for an imminent game.

#### Edge Calculation and Recommendation

- **What it does:** Computes, for every resolvable contract, the difference between Sightline's threshold probability and Kalshi's price, adjusts for confidence, ranks the slate, and marks contracts meeting the recommendation threshold.
- **Why:** Converts two numbers into a decision. This is the core job, expressed as a feature.
- **Acceptance criteria:**
  - Edge is computed from the freshest available projection and the freshest available price, each displayed with its own timestamp.
  - Ranking is by confidence-adjusted edge, so that a smaller edge on a high-confidence projection can outrank a larger edge on a shaky one.
  - The recommendation threshold is configuration, not a hardcoded constant.
  - Contracts below the threshold remain visible and ranked, visually de-emphasized rather than filtered out.
  - Every recommendation is stored as it existed, so it can be graded after settlement.
  - No edge is computed or displayed for a contract whose projection is missing.
- **Edge cases / failure states:**
  - A stale projection paired with a current price, which is the most dangerous state in the product and must be visible as such.
  - A contract with a price but no projection, or a projection but no price.
  - Ties, and slates where nothing clears the threshold — a legitimate outcome that must display as such rather than as an error.
  - A game already underway or completed still appearing in the contract set.

#### Staleness Disclosure

- **What it does:** Marks projections whose information cutoff predates known events — most importantly, a game whose inactives have been announced but not yet ingested.
- **Why:** At ninety minutes to kickoff Sightline is structurally the slowest participant in the market. It cannot win a race against traders repricing on breaking news, so it must instead be honest about what it does not yet know. A projection that admits it predates inactives is more useful than one that silently pretends to be current.
- **Acceptance criteria:**
  - Every contract row and detail view exposes the age of its projection and the information cutoff behind it.
  - Once a game passes the point at which inactives are published, its contracts are marked stale until inactives are ingested.
  - Staleness is scoped per game, so an early game going stale does not mark later games.
  - Staleness is visible in the list view, not only on the detail view.
- **Edge cases / failure states:**
  - The inactives source is unavailable at the moment it is expected, which must produce visible staleness rather than false currency.
  - A game whose kickoff moves, shifting the entire staleness clock.
  - Multiple games in a window reaching the staleness boundary simultaneously.

#### Adjustment Suggestions

- **What it does:** A general mechanism by which an ingest source proposes a change to a projection, carrying its evidence, for the admin to accept or decline in one tap. Inactives are the first source; limited-snaps designations, depth-chart changes, and healthy scratches follow the same shape.
- **Why:** It keeps a source of unproven reliability out of the automatic path while still surfacing what it knows, and it builds the evidence to decide whether that source can be trusted later.
- **Acceptance criteria:**
  - A suggestion carries its source, its evidence in human-readable form, the projection it targets, and the specific change it proposes to value, range, and confidence.
  - Accepting updates the displayed projection; declining leaves it unchanged. Both are one action.
  - The adjusted projection is computed and tracked as a shadow regardless of acceptance, so grading is never confounded by the admin's choices.
  - Both base and adjusted projections are graded against the outcome for every suggestion raised.
  - Adding a new suggestion source requires no change to the suggestion, display, or grading mechanism.
  - Viewers see the effect of accepted suggestions but cannot accept or decline.
- **Edge cases / failure states:**
  - A suggestion for a player with no listed contract.
  - Duplicate or contradictory suggestions from the same source for the same projection.
  - A suggestion arriving after kickoff.
  - A source reversing itself — a player declared out and then active.
  - A suggestion whose proposed adjustment cannot be computed for lack of history.

#### Suggestion Reliability Analytics

- **What it does:** Reports, per source, how often the source's claim was factually correct, and separately how often the adjustment it prompted improved the projection.
- **Why:** Two different failure modes hide behind one symptom. The source can be wrong — a player reported out who plays. Or the source can be right and the adjustment wrong — the player was genuinely out and the model redistributed his workload badly. Conflating them means retiring a reliable feed because of an immature redistribution model.
- **Acceptance criteria:**
  - Source accuracy and adjustment accuracy are reported as separate figures.
  - Both are broken out by source.
  - Sample size is displayed alongside every rate, so a small-sample figure cannot be mistaken for a settled one.
  - Figures are computed from shadow-graded outcomes, independent of which suggestions were accepted.
- **Edge cases / failure states:**
  - Too few observations to say anything, which must be stated rather than rendered as a precise-looking percentage.
  - A source whose claims cannot be verified from available data.

#### Decision Log

- **What it does:** Records the admin's disposition toward a contract — took, faded, or skipped — capturing the full state he was looking at when he decided.
- **Why:** It is the only way to ever answer whether William's own reads add value on top of the model, and whether he acts too early.
- **Acceptance criteria:**
  - A decision is anchored to a contract, not to a recommendation, so a decision can be logged on a contract Sightline never flagged.
  - Took, faded, and skipped are distinct states — fading is a position on the other side and is not the same as passing.
  - Unmarked is a valid resting state; no disposition is ever forced.
  - The decision stores a snapshot of the moment: model probability, market price, edge, confidence, recommendation status, and projection timestamp.
  - The final pre-kickoff state is also stored, and the difference between the two yields timing cost.
  - Decisions are gradeable against settlement without manual entry.
  - Decisions are admin-only and invisible to viewers.
- **Edge cases / failure states:**
  - A decision on a contract later voided by Kalshi.
  - A decision changed after being logged — the snapshot must reflect the decision actually acted on.
  - A decision logged after kickoff.
  - Multiple decisions on the same contract.

#### Outcome Ingest and Scoring

- **What it does:** Ingests settled markets and official results, then grades every projection, recommendation, decision, and suggestion produced against them.
- **Why:** Closes the loop with no manual entry, which is the difference between a measurement system and an abandoned one.
- **Acceptance criteria:**
  - Settlement ingest requires no manual action.
  - Every projection for a completed game reaches a graded state or an explicit unresolvable state.
  - Grading is idempotent and survives re-running.
  - A stat correction arriving after grading re-grades the affected records rather than leaving a stale result.
  - Recommendation outcomes, decision outcomes, and suggestion outcomes are each derivable from stored data.
- **Edge cases / failure states:**
  - A game that never completes.
  - Kalshi settlement conflicting with the official stat line.
  - A settlement arriving for a market Sightline never projected.
  - Late corrections arriving days after the fact.

#### Accuracy and Calibration Surface

- **What it does:** Presents model accuracy in-app: a reliability curve with Brier score, error against the season-average and trailing-five baselines, comparison against market prices where they existed, the admin's own override record, and timing cost.
- **Why:** Calibration is the primary success measure for the product, and a measure that lives in a notebook does not get looked at.
- **Acceptance criteria:**
  - Reliability is displayed as observed hit rate against stated probability across buckets, with sample size per bucket.
  - Brier score is displayed, and the baselines are displayed alongside for comparison.
  - The surface is filterable by stat type and by time period.
  - The surface remains available year-round, including when no games are scheduled.
  - Override performance and timing cost are admin-only.
  - Every rate is displayed with its sample size.
- **Edge cases / failure states:**
  - Insufficient data to draw a curve, which must render as an honest empty state.
  - Buckets with too few observations to be meaningful.
  - A period containing no settled markets.

#### Backtesting Harness

- **What it does:** Runs the projection engine chronologically across historical seasons using only information available before each game, compares predictions to actual results, and stores the run's results for in-app display. Executed offline, not from the UI.
- **Why:** It is the gate on everything downstream — no recommendation and no trade should ship on an unvalidated model — and it is the only way to measure accuracy before a single live slate exists.
- **Acceptance criteria:**
  - A run uses only information whose availability timestamp precedes the game being predicted; leakage is prevented structurally rather than by convention.
  - A run is reproducible — the same configuration over the same period yields the same results.
  - Results include error against actuals and against both baselines, plus calibration figures, broken out by stat type and season.
  - Results are stored and displayed in-app without the run being triggerable from the UI.
  - Written runbook documentation covering how to execute a run, configure it, and interpret its output ships as part of this feature, not after it.
  - A run can be scoped to a subset of seasons or stat types.
- **Edge cases / failure states:**
  - A run interrupted partway, which must not leave partial results presented as complete.
  - A period where a required data source has gaps.
  - Configuration drift between a stored run's results and the current engine, which must be detectable from the stored run.
  - Rule or scoring changes across historical eras that make older seasons less comparable.

#### Authentication and Invite

- **What it does:** Invite-only access with two roles, admin and viewer. No public signup.
- **Why:** Sightline is a closed tool for a named group, and the role split is what keeps viewers permanently out of the trading and private analytics paths.
- **Acceptance criteria:**
  - Public signup does not exist; accounts are created only by admin invitation.
  - Every surface enforces its role server-side, not merely by hiding UI.
  - Viewers cannot reach positions, the decision log, bankroll surfaces, trading, or suggestion acceptance by any route.
  - The admin can revoke access, and revocation takes effect immediately.
  - Sessions persist across devices without repeated login.
- **Edge cases / failure states:**
  - An expired or reused invitation.
  - A revoked user with an active session.
  - A viewer deep-linking to an admin-only surface.

#### Brand and Responsive Interface

- **What it does:** A deliberate visual identity and a fully responsive layout across phone, tablet, and desktop.
- **Why:** An explicit product requirement. The slate is read on a phone on a Sunday morning and on a desktop during the week, and a tool that is unpleasant to open stops being opened — which is one of the stated success criteria.
- **Acceptance criteria:**
  - Every surface is usable at phone, tablet, and desktop widths without horizontal scrolling.
  - The slate list is legible and scannable on a phone without opening detail views.
  - A defined design system governs colour, type, spacing, and components, and every surface uses it.
  - Numeric density — probability, price, edge, confidence — is readable at a glance rather than requiring study.
  - Slate view renders from cached data rather than waiting on a model run.
- **Edge cases / failure states:**
  - Very long player names and unusually long stat descriptions.
  - A slate with an unusually large number of contracts.
  - Empty states across every surface.

#### Kalshi Trading

Admin only. The final MVP feature, deliberately last.

- **What it does:** Places orders on Kalshi from within Sightline, with explicit confirmation, and records the resulting positions against the decisions and projections that produced them.
- **Why:** Removes the app-switching step for the admin, and links positions to the reasoning behind them so that P&L is traceable to a projection.
- **Acceptance criteria:**
  - No order is submitted without an explicit confirmation step showing size, the price actually payable, and total cost.
  - The feature is exercised against the platform's demo environment before it is enabled against a live account.
  - A configurable per-slate exposure cap exists and is enforced.
  - Fills, partial fills, and rejections are reported plainly and recorded.
  - Positions link to the decision, recommendation, and projection that produced them.
  - Only the admin's credentials are ever stored; no viewer credential is ever accepted, stored, or transmitted.
  - The feature cannot be enabled before the backtesting harness has produced a stored accuracy record.
- **Edge cases / failure states:**
  - A market closing between view and confirmation.
  - Insufficient account balance.
  - Partial fill leaving an unintended position size.
  - Duplicate submission from a repeated confirmation.
  - The cap being reached mid-slate.
  - An order that succeeds at Kalshi but fails to record locally, which must be reconcilable.

### Post-MVP / Later

**Bankroll and Portfolio Management (V2).** Position sizing, exposure tracking, and P&L attribution against recommendations and projections. Admin-only. Deferred so that V3's sport expansion lands on top of a complete trading and tracking layer.

**NBA (V3).** A second sport. The entity model is sport-agnostic from the start — player, game, stat type, contract, and projection carry no NFL-specific structure — so NBA is a new stat and context module rather than a rewrite.

**WNBA (later).** Together with NBA and NFL this covers most of the calendar. Contingent on Kalshi listing enough contracts to be worth pricing, which is unverified.

**Friend pick sharing.** A shared feed where each user marks what they took, displayed to the group with the model's numbers attached. This makes the friends' disagreements measurable the same way the admin's are. Note that it converts viewers from read-only to a role that writes their own decisions — a real permission change, though still one that never involves their trading credentials.

**Additional stat types.** Defensive and other markets, if and when Kalshi lists them. The engine is built so new stat types are additive.

**Additional suggestion sources.** Limited-snaps and return-from-injury designations, depth-chart changes, healthy scratches, weather shifts. Each reuses the existing suggestion mechanism and inherits its grading automatically.

In-app messaging was considered and set aside. It is a substantial surface — notifications, read state, delivery, moderation — serving a group of three who already have a group chat that works better than anything built here. Pick sharing carries the collaborative value at a fraction of the cost.

---

## Data Objects (Product Level)

**Player.** A person with a stable identity across seasons and teams. Viewable; never created or edited by a user.

**Game.** A scheduled contest with a kickoff time, participants, venue, and conditions. Viewable; system-maintained.

**Contract.** A Kalshi player-prop market — a player, a stat type, a threshold, and the game it resolves against. Viewable; system-discovered. Users never create contracts.

**Projection.** Sightline's distribution over a player's outcome for a stat in a game, carrying projected value, range, confidence, drivers, computed-at time, and information cutoff. Viewable and inspectable; produced by the system, never hand-edited.

**Price Observation.** A point-in-time reading of a contract's market, both sides, with an observed-at timestamp. Viewable as current state and as history.

**Edge / Recommendation.** The computed disagreement between a projection and a price, confidence-adjusted, with a recommendation status. Viewable; graded after settlement.

**Adjustment Suggestion.** A proposed change to a projection, carrying source, evidence, proposed change, and status — pending, accepted, or declined. Admin accepts or declines; viewers see effects only. Every suggestion also carries a shadow-adjusted projection that exists regardless of status.

**Decision.** The admin's disposition toward a contract — took, faded, skipped, or unmarked — with a snapshot of decision-time state and a reference to final pre-kickoff state. Admin creates and may change; admin-visible only.

**Position.** A holding resulting from an executed order, linked to its decision, recommendation, and projection. Admin only, from the trading feature onward.

**Outcome.** The settled result of a contract and the official stat line behind it. System-ingested; grades everything upstream.

**Backtest Run.** A stored execution of the harness over a defined period and configuration, with its results. Viewable in-app; created out-of-band.

**User and Invitation.** An account with a role, and the invitation that created it. Admin creates, revokes, and manages.

---

## Permissions / Roles

**Admin.** One user, William. Full read across every surface. Accepts and declines adjustment suggestions. Creates and edits decisions. Places trades and holds positions. Sees the private layer: positions, decision log, override performance, timing cost, bankroll from V2 onward, and suggestion reliability analytics. Invites and revokes users.

**Viewer.** Invited friends. Read-only across the slate: projections, prices, edges, confidence, recommendations, drivers, and staleness. Cannot accept or decline suggestions, cannot log decisions, cannot trade, and cannot see the admin's positions, decision log, or private analytics. Sightline never stores, transmits, or custodies a viewer's Kalshi credentials — viewers trade on Kalshi directly, outside the application.

Role enforcement lives on the server. Hiding a surface in the interface is not sufficient.

---

## Feature Dependencies

Historical Data Ingest blocks the Projection Engine, which blocks everything that displays or grades a projection.

Kalshi Market Sync blocks Edge Calculation and Recommendation, and blocks Outcome Ingest and Scoring. Edge Calculation additionally requires the Projection Engine — it is the join of the two halves of the product.

Staleness Disclosure requires the Projection Engine's information-cutoff tracking and the schedule from Historical Data Ingest.

Adjustment Suggestions require the Projection Engine, since a suggestion is a proposed change to a projection and its shadow must be computable. Suggestion Reliability Analytics require Adjustment Suggestions and Outcome Ingest and Scoring.

Decision Log requires Edge Calculation, since a decision snapshots the recommendation state it was made against.

Outcome Ingest and Scoring requires Kalshi Market Sync for settlements and Historical Data Ingest for official results. The Accuracy and Calibration Surface requires it in turn, and additionally requires the Decision Log for the override and timing-cost portions.

The Backtesting Harness requires Historical Data Ingest and the Projection Engine, and requires point-in-time discipline in the former. It does not require Kalshi Market Sync — a backtest can measure accuracy against actual results without any market data, which means it can be built and run before markets are wired up at all.

Authentication and Invite blocks every user-facing surface.

Brand and Responsive Interface should precede the substantial user-facing surfaces so they are built in the design system rather than retrofitted into it.

Kalshi Trading requires the Decision Log, Edge Calculation, and a stored Backtest Run demonstrating accuracy. It is deliberately last.

---

## Open Questions

**Should model calibration be visible to viewers?** It is currently scoped admin-only, following the decision that the private layer stays private. But calibration is a property of the model rather than of William's activity, and a viewer deciding whether to act on a recommendation arguably needs to know how well-calibrated the recommender is. Positions, decision log, timing cost, and bankroll are unambiguously private. The reliability curve may not belong with them.

**Which price does edge compute against?** Buying costs the ask, not the midpoint. On thin markets — precisely the ones most likely to be mispriced — the spread can be wide enough that an edge against the midpoint disappears against the ask. The conservative choice is to compute against the executable price; the alternative is to display both. This needs a real slate to judge.

**How many contracts list on a typical slate?** Unverified, and it changes the shape of the main view. Six contracts and sixty contracts are different products.

**Kalshi settlement versus official stats.** NFL stat corrections can land days after a game. If Kalshi settles on a source or a timing that differs from the official line, Sightline's grading and Kalshi's settlement can disagree. Which is treated as truth for scoring purposes needs deciding, and the answer may differ between grading the model and grading a position.

**ESPN inactives reliability.** The entire suggestion mechanism exists because this is unproven. The analytics are designed to answer it, but the answer does not exist yet.
