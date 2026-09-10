# Sightline — Pitch: Slate Experience & Prop Research

> Source: Linear document "Sightline — Pitch: Slate Experience & Prop Research"
> (https://linear.app/sightline-pilot/document/sightline-pitch-slate-experience-and-prop-research-a10cbee4f7a7)
> Pulled to disk for the autonomous pitch pipeline. This is a verbatim mirror of the Linear pitch.

## Summary

This pitch redesigns Sightline around its simplest user job:

**Open the app, immediately find the strongest opportunities, understand why Sightline likes them, and quickly research any specific player prop.**

The current application exposes the product largely in the shape that its underlying data exists: individual contracts appear as a long ranked list, the same player appears repeatedly for different thresholds, operational and analytical surfaces occupy primary navigation, and advanced statistical measurements are presented without enough interpretation.

That is useful to the person building Sightline. It is considerably less useful to someone who opens Sightline five minutes before making a decision.

This pitch turns the Slate into the primary product experience.

Contracts are grouped into game and player-centered cards. A player appears once within a game, with available stat types and thresholds accessible inside that player experience rather than repeated as separate full-width rows. The strongest opportunities are surfaced first, while search, game, team, date, stat-type, recommendation, and other basic filters make the entire slate easy to explore.

Adjustment Suggestions become contextual information inside the Slate rather than a separate primary workflow.

Advanced operational and analytical tools move into an admin-only area. Accuracy remains comprehensive, but its default presentation answers understandable questions such as whether Sightline is performing well, whether enough evidence exists yet, and whether the active model is outperforming its comparisons. Detailed calibration analysis remains available underneath.

This pitch also adds **Prop Research**.

An authenticated user can search for any upcoming player/stat combination for which Sightline already has a current stored projection distribution, enter an arbitrary threshold, and immediately see Sightline's probability of the player finishing above or below that number, together with the model projection, expected range, confidence, evidence, and freshness.

Prop Research does not require Kalshi to list that threshold and does not require another model run. It reuses the distribution Sightline has already computed. The Projection Engine was deliberately designed so arbitrary threshold probabilities can be derived from a stored distribution.

If no market price or payout is provided, Prop Research reports **probability, not economic edge**.

Finally, the pitch removes routine manual price refreshing from the user experience. Prices refresh automatically using existing infrastructure, while freshness remains visible in simple language.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L

This pitch touches several existing surfaces:

* Slate.
* Contract detail.
* Adjustment Suggestions presentation.
* Accuracy and Calibration Surface presentation.
* Navigation and role-based information architecture.
* Kalshi price freshness.
* A new Prop Research journey.
* Front-end performance of the core application.

That is substantial surface area, but it remains one coherent vertical slice because all of it serves one product outcome:

**make Sightline dramatically easier and faster to use for finding and researching player props.**

Splitting "redesign the Slate" from "add the research view" would produce overlapping player-selection, projection-detail, filtering, and distribution UI twice.

Likewise, moving admin surfaces out of primary navigation is part of simplifying the core experience rather than an independent analytics project.

The appetite constrains this pitch to reorganizing and presenting capabilities Sightline already possesses, plus arbitrary-threshold research from existing stored distributions. It does not authorize rebuilding the projection system, creating new sports integrations, or turning Sightline into a general-purpose betting platform.

## Problem

Sightline currently knows considerably more than its interface makes easy to use.

A slate can contain hundreds of Kalshi contracts.

Because every threshold is represented independently, a single player may occupy multiple rows:

* receiving yards ≥ 14.5
* receiving yards ≥ 24.5
* receiving yards ≥ 39.5
* receiving yards ≥ 49.5
* receiving yards ≥ 59.5
* and so on

Those are meaningfully different contracts to the model, but they are not meaningfully different **players** to the person scanning a Sunday slate.

Presenting every threshold as another large row causes several problems:

* Players repeat constantly.
* Game context is repeated instead of organizing the page.
* Related thresholds are visually disconnected.
* Hundreds of props require long scrolling.
* Finding one player requires scanning or browser search rather than product search.
* Changing from receiving to rushing or receptions requires traversing the same list again.
* The strongest opportunities compete visually with everything else.

The current Slate technically ranks contracts by confidence-adjusted edge, which is correct behavior from Pitch 4. The problem is not the ranking calculation.

The problem is the information hierarchy around it.

The application also treats several advanced capabilities as primary destinations even though they do not serve the ordinary viewer's main task.

Accuracy, Autonomy, Suggestions, Health, and Users all have legitimate roles in Sightline, but they are not peers of the Slate for a viewer who simply wants to know what the system currently likes.

Accuracy has the opposite problem from Slate.

Instead of too many repeated opportunities, it immediately exposes concepts such as Brier score, calibration buckets, sample floors, model versions, populations, and baseline comparisons. Those measurements remain important and are explicitly required by the PRD.

But their current presentation asks the user to understand the measurement machinery before telling them what the machinery currently implies.

The application also contains information that is useful outside Kalshi.

Sightline already stores full probability distributions. That means if another platform presents a player threshold that Kalshi does not currently list, Sightline may already possess everything required to estimate the probability of that player clearing the line.

Today there is no simple interface for asking that question.

Finally, routine price freshness should not depend on William remembering to click a Refresh Prices button.

The architecture already intended market prices to refresh independently from projections, on view and on a background interval. Requiring repeated manual intervention undermines both simplicity and the eventual viewer experience.

## Solution Shape

### The Slate becomes the home experience

After authentication, ordinary users land on the Slate.

The Slate is designed first around:

**What does Sightline like right now?**

The strongest actionable opportunities appear first.

The page still permits browsing every supported current Kalshi contract, but complete market coverage no longer dictates the default visual hierarchy.

A viewer should be able to open Sightline, scan the strongest opportunities, open one interesting player, understand the relevant probability, and leave without ever needing to understand how the model's calibration bins are stored.

### Game-centered organization

The Slate organizes upcoming opportunities around games and their scheduled dates/windows.

Users can quickly move among games rather than encountering a single undifferentiated list.

A game presentation communicates at minimum:

* Teams.
* Scheduled kickoff.
* Freshness state.
* Players with available projections/contracts.
* Whether meaningful late information currently affects the game.

The exact interaction pattern, such as sections, tabs, collapsible groups, or another responsive treatment, belongs to design.

The requirement is that game context becomes structure rather than repeated metadata on every row.

### Player cards

Within a game, a player appears as one primary card or grouped unit.

The card summarizes the information needed to decide whether the player is worth inspecting:

* Player.
* Team/opponent context.
* Best current opportunity.
* Direction.
* Sightline probability.
* Confidence.
* Current market context when the selected prop is a Kalshi contract.
* Freshness.
* Relevant accepted adjustment context.

If the player has several available thresholds or stat types, those are selectable within the player's experience.

Changing the selected threshold updates the corresponding:

* Projection probability.
* Market price.
* Edge.
* Recommendation.
* Confidence.
* Detail context.

The page no longer requires rendering Michael Wilson six times merely because six humans at an exchange typed six different yardage numbers.

### Best opportunities first

The default Kalshi Slate emphasizes the strongest recommendations.

For market-linked props, "best" continues to respect Sightline's existing confidence-adjusted edge logic rather than sorting by probability alone.

Both directions can qualify as good opportunities.

A strong recommendation that the event **does not** occur is still an opportunity and should not disappear merely because it lacks the emotional optimism of an Over.

The direction is always explicit.

Users can switch from the focused best-opportunity view to broader slate exploration.

### Search

The core Slate provides player search.

Typing a player's name immediately narrows the current upcoming slate to matching players.

Search does not require knowing the game, team, contract ticker, or exact Kalshi wording.

The same player-search interaction is reusable by Prop Research.

### Filters

The Slate supports practical filters that reflect how users browse NFL props:

* Game.
* Team.
* Date or game window.
* Stat type.
* Recommendation/direction.
* Confidence.
* Availability of a current market.

Filters combine rather than operating as mutually exclusive page modes.

There is always a clear way to return to the default best-opportunity view.

### Stat-type navigation

Users can narrow the slate to available stat families such as:

* Passing yards.
* Rushing yards.
* Receiving yards.
* Receptions.
* Touchdowns.
* Other stat types supported by the active Projection Engine.

The interface derives available options from supported/current data rather than hardcoding a menu that becomes wrong when another stat type is added.

### Contract and projection detail

Selecting a player/prop opens the deeper analysis without leaving the user to rediscover the player in another giant list.

The detailed experience preserves the useful information already required by Sightline:

* Projected value.
* Distribution/range.
* Probability for the selected threshold.
* Confidence.
* Projection Drivers.
* Market price and edge for a Kalshi contract.
* Projection provenance.
* Freshness.
* Relevant adjustment information.

Distribution graphs and advanced details load as part of the opened detail experience rather than imposing their rendering cost on every collapsed player card.

The simplification is not accomplished by deleting useful evidence.

It is accomplished by revealing evidence progressively.

### Suggestions live where the affected projection lives

Adjustment Suggestions no longer require a primary navigation destination for ordinary use.

For William, a material pending suggestion appears contextually on the affected game/player/prop.

He can see that new information needs attention and inspect the proposed impact from the place where it matters.

The Pitch 9 authorization rules remain unchanged:

* William can accept or decline.
* Viewers cannot.

For viewers:

* An accepted adjustment may be shown as context explaining why the current projection changed.
* A material unresolved condition can be represented through simple freshness/status language.
* They do not receive the admin's accept/decline workflow.

Suggestion history and **Suggestion Reliability Analytics** belong in the admin area.

### Simplified freshness

Ordinary users should not have to interpret separate operational timestamps merely to know whether a number is usable.

The Slate translates system state into understandable status such as:

* **Current**
* **Updated recently**
* **New information pending**
* **Stale**
* **Unavailable**

Exact copy belongs to design.

Users can inspect timestamps and additional detail when useful, but raw operational metadata does not dominate every card.

The distinction between prices and projections remains real:

**Price freshness** means how recently Sightline refreshed Kalshi.

**Projection freshness** means whether the current model output reflects the information Sightline expects to know for that game.

Refreshing one does not falsely mark the other current.

### Automatic Kalshi price refresh

Routine price freshness no longer depends on an admin action.

The product automatically refreshes the active upcoming-market set and prices.

The user-level behavior is:

1. Background refresh occurs on a regular cadence during relevant pregame periods.
2. Opening or returning to the Slate checks whether stored prices are older than the expected interval.
3. When appropriate, the server refreshes them automatically.
4. Multiple viewers opening the page do not cause duplicate unrestricted upstream requests.
5. Updated prices flow into displayed edge without requiring a page-level manual workflow.
6. The interface communicates when the most recent automatic refresh failed.

The starting background target is **approximately every five minutes during relevant pregame windows**, subject to rate limits and the chosen no-new-cost scheduler's practical behavior.

The scheduler is not required to run aggressively twenty-four hours per day when no relevant markets need fresh prices.

The implementation should use existing Sightline infrastructure and the existing server-side Kalshi integration rather than creating another Kalshi client or another credential location.

The design stage should prefer an existing-platform scheduler and remain within included quotas rather than introducing a recurring paid scheduling service.

The existing manual refresh operation may remain available inside admin diagnostics as a recovery/debug action, but it is not part of the normal Slate workflow.

### Projection refresh remains separate

This pitch does not recompute the Simulation Engine every five minutes merely because prices do.

Projection recomputes remain governed by the existing live-pipeline and staleness rules.

If important football information arrives after a projection was computed, the projection can legitimately remain stale until that game's model input is updated and recomputed.

The simplified UI communicates this without pretending a fresh market price repaired an old football forecast.

### Viewer experience

A regular viewer gets a deliberately narrow application.

Their primary product is:

**Slate + Prop Research**

They can:

* Browse current opportunities.
* Search players.
* Filter the slate.
* Open player/prop detail.
* Read probabilities.
* Read recommendations.
* Inspect evidence and distributions.
* See current Kalshi prices and edge where applicable.
* See simple freshness state.
* Use Prop Research.

They cannot:

* Refresh prices manually.
* Accept or decline Adjustment Suggestions.
* Operate paper trading.
* Run Dry Run.
* Change risk configuration.
* View bankroll.
* View position/sizing history.
* View private suggestion reliability.
* Manage users.
* Operate system-health controls.
* Operate model selection.

Server-side authorization remains authoritative.

### Admin information architecture

Advanced tools move out of the viewer-oriented primary navigation into a clearly separated admin area.

The admin area organizes capabilities such as:

* Accuracy.
* Model comparison.
* Autonomous paper trading.
* Dry Run.
* Bankroll and risk configuration.
* Suggestion management/history.
* Suggestion Reliability Analytics.
* Health.
* Users.
* Other operational configuration.

This pitch intentionally changes one prior architecture decision.

The current Architecture Doc describes general model accuracy as a shared authenticated surface, while only override/timing analytics are admin-only.

Under this revised product decision, **Accuracy and advanced model analytics move to the admin experience**.

Viewers consume the model's outputs rather than its evaluation machinery.

That permission change must be reflected upstream in the PRD and Architecture Doc rather than existing only as hidden navigation.

### Accuracy becomes understandable before becoming technical

The underlying metrics remain.

Sightline still needs:

* Brier score.
* Calibration/reliability.
* Sample sizes.
* Baseline comparison.
* Market comparison where available.
* Filtering by relevant stat/time/model dimensions.

The first layer of Accuracy, however, translates those into the questions William is actually trying to answer:

**How is the active model doing?**

**Do we have enough results to trust this measurement yet?**

**Are the probabilities calibrated?**

**Is this model outperforming the baseline?**

**How does it compare with the market where we have enough comparable observations?**

**Is performance improving, stable, or deteriorating?**

A summary communicates these conclusions first.

The existing technical graphs and calibration buckets remain accessible as deeper analysis, not deleted.

Terms such as Brier score should include concise interpretation instead of assuming the number explains itself through sheer numerical authority.

### Prop Research

Prop Research is a simple probability checker built on Sightline's existing stored projection distributions.

A user can:

1. Search a player.
2. Choose one of the upcoming games for which Sightline has a current projection.
3. Choose an available stat type.
4. Enter a custom threshold.
5. View the probability distribution result instantly.

For example:

**Matthew Stafford**
**Passing yards**
**225.5**

Sightline can then show:

* Central projected value.
* Expected range.
* Probability above the entered threshold.
* Probability below the entered threshold.
* Confidence.
* Relevant Projection Drivers.
* Freshness.
* Model/version context in deeper details.

Because the threshold probability is derived from an already-stored distribution, entering another number does not trigger a new Simulation Engine run.

### Prop Research without market economics

When the user manually enters a threshold from PrizePicks, Underdog, a sportsbook, a conversation with their uncle, or any other external context, Sightline does not know the complete economic terms of that wager.

Therefore it does not fabricate edge.

The result communicates something like:

**Sightline estimates a 64% probability of clearing 225.5.**

It may indicate which side the model favors.

It does **not** claim:

**+14% edge**

unless Sightline also possesses a valid market price against which that probability can be compared.

No payout/price-entry system is required in this pitch.

### No external platform integration

Prop Research does not integrate with PrizePicks, Underdog, sportsbooks, or another betting platform.

The user manually supplies the threshold.

Sightline supplies its football probability.

This preserves the Product Brief's Kalshi-only integration boundary while still making the model useful for generic research.

### Research scope

Prop Research works for player/stat/game distributions that Sightline **already has stored for an upcoming game**.

It does not require the production Projection Engine to begin computing every NFL player merely because somebody might someday search for him.

If no current stored distribution exists for the requested player/stat combination, the product says that Sightline does not currently have a projection for it.

This keeps the research feature cheap and honest.

### Responsive experience

The redesign remains fully usable on phone, tablet, and desktop.

Cards and filters cannot rely on a desktop-wide table.

On smaller screens:

* The most important player/prop information remains visible immediately.
* Secondary information moves into detail.
* Filters remain usable without horizontal scrolling.
* Player cards remain easy to scan.
* Graphs remain inspectable after opening detail.

This preserves the responsive requirement established by Brand and Responsive Interface.

### Performance

Performance is part of the product change rather than cosmetic cleanup afterward.

The current Slate should not pay the cost of preparing every possible detail for hundreds of contracts before showing the first useful opportunity.

The redesigned Slate follows progressive disclosure:

* Initial load prioritizes game/player summaries and the information required to rank/browse them.
* Distribution graphs and detail-only information do not block the initial useful Slate.
* Repeated thresholds for one player do not each require a full independent visible component when collapsed.
* Opening a player/prop can load deeper detail when requested.
* Search and filters do not cause full model recomputation.
* Prop Research evaluates an existing stored distribution and does not invoke the Simulation Engine.
* Price refresh occurs independently from the initial stored Slate read.

Before implementation changes are accepted, the current Slate is measured as the baseline.

After implementation, the same production-size slate must demonstrate a meaningful improvement in initial usable render and interaction responsiveness.

The design/build may optimize existing queries, payloads, rendering work, and component structure where measurement shows waste.

It must not introduce unnecessary distributed caching, infrastructure, or paid performance services for Sightline's tiny user scale. The Architecture Doc explicitly describes the data scale as small and warns that over-engineering is the more likely failure.

## In Scope

* Slate information-architecture redesign.
* Game-centered grouping.
* Player-centered cards/grouping.
* Multiple thresholds under one player/stat experience.
* Best-opportunities-first default view.
* Search by player.
* Game filter.
* Team filter.
* Date/game-window filter.
* Stat-type filter.
* Recommendation/direction filter.
* Confidence filtering where useful.
* Clear reset/default view.
* Simplified contract detail.
* Existing distribution graph/detail accessible on demand.
* Existing Projection Drivers accessible in context.
* Accepted Adjustment Suggestion context inline.
* Pending Adjustment Suggestion actions inline for admin.
* Removal of Suggestions as a required primary navigation destination.
* Viewer-oriented Slate navigation.
* Dedicated admin information architecture.
* Accuracy moved to admin-only.
* Simplified Accuracy summary.
* Advanced Accuracy analysis retained underneath.
* Plain-language explanation of model-quality metrics.
* Simplified freshness presentation.
* Automatic Kalshi price refresh.
* No-new-paid-service preference for scheduled price freshness.
* Automatic on-view freshness check.
* Admin diagnostic/manual refresh only as fallback rather than ordinary behavior.
* **Prop Research** for current stored player/stat/game distributions.
* Arbitrary threshold entry.
* Over/above probability.
* Under/below probability.
* Model projection/range.
* Confidence.
* Evidence/drivers.
* Freshness.
* Viewer access to Prop Research.
* No external price/payout requirement for generic research.
* Performance measurement and improvement of the Slate.
* Responsive phone, tablet, and desktop behavior.

## Out of Scope / Boundaries

* No PrizePicks integration.
* No Underdog integration.
* No sportsbook integration.
* No automated scraping of external prop lines.
* No DFS slip creation.
* No payout calculator for external platforms.
* No external-site account credentials.
* No claim of economic edge when only a threshold is known.
* No automatic external bet placement.
* No real Kalshi trading.
* No redesign of the Projection Engine.
* No redesign of Probability Recalibration.
* No redesign of Position Sizing.
* No model fitting or backtesting from Prop Research.
* No Simulation Engine execution in response to typing a threshold.
* No requirement to create projections for players/stat types not already present in the current serving projection set.
* No general historical NFL research tool.
* No player biography/stat encyclopedia.
* No fantasy lineup builder.
* No generalized sportsbook odds comparison.
* No social/community picks feed.
* No viewer access to admin analytics.
* No viewer access to bankroll or autonomous operation.
* No viewer access to suggestion decisions.
* No viewer manual price-refresh control.
* No five-minute full-model recomputation merely because market prices refresh every five minutes.
* No new Kalshi credential location.
* No second Kalshi client.
* No new paid scheduler unless existing-platform approaches are proven inadequate.
* No new caching platform merely to make the Slate faster.
* No removal of calibration/Brier detail from the product; it becomes secondary rather than primary.
* No automatic interpretation that a probability above 50% makes an external prop profitable.
* No automatic risk-mode or trading changes resulting from this UI redesign.

## Definition of Done

### Slate hierarchy

* The default Slate no longer presents the entire active market as one uninterrupted repeated-player list.
* Upcoming opportunities are navigable by game.
* The same player is represented once per relevant game context in the primary grouped experience.
* Multiple thresholds for the same player/stat can be inspected within that player's experience.
* Multiple supported stat types can be reached without forcing the player to appear as unrelated repeated rows.
* Selecting a different threshold updates the probability and corresponding market information correctly.
* Selecting a different stat type updates the corresponding projection correctly.
* Game context remains obvious while inspecting a player.
* The strongest current opportunities are accessible without scrolling through the entire market.
* Both favorable YES/Over-type and NO/Under-type opportunities can qualify as strong opportunities.
* Contracts below the recommendation threshold remain discoverable rather than silently disappearing.

### Search and filters

* A user can search the current Slate by player name.
* Search tolerates ordinary partial-name input.
* A user can filter by game.
* A user can filter by team.
* A user can filter by stat type.
* A user can filter by relevant date/window.
* A user can narrow by recommendation/direction.
* Supported filters can be combined.
* Clearing filters returns to the normal best-opportunity experience.
* A zero-result search/filter produces an understandable empty state.
* Filtering never changes the underlying probability merely because the view changed.

### Player/prop detail

* Opening a player/prop exposes the existing distribution information.
* Projected value is visible.
* Expected range is visible.
* Selected-threshold probability is visible.
* Confidence is visible.
* Relevant Projection Drivers are visible.
* Market price and edge are visible when valid Kalshi market information exists.
* Freshness is visible in understandable language.
* Projection provenance remains inspectable without dominating the primary card.
* Detail behavior remains usable on mobile without horizontal scrolling.

### Adjustment Suggestions

* Pending material suggestions are discoverable from the affected player/game for the admin.
* The admin can reach the Pitch 9 accept/decline action without navigating to a standalone Suggestions screen.
* Accepting or declining retains Pitch 9's existing historical behavior.
* Accepted adjustments are reflected on the Slate.
* Viewers cannot accept or decline.
* Viewers can understand when an accepted adjustment materially changed the current projection.
* Suggestion Reliability Analytics remain admin-only.
* A pending material update cannot appear to a viewer as an unquestionably current ordinary projection.

### Viewer experience

* A viewer lands in a simple read-oriented experience.
* A viewer can browse and search the Slate.
* A viewer can use the supported filters.
* A viewer can inspect player/prop details.
* A viewer can use Prop Research.
* A viewer can see simple freshness information.
* A viewer can see market information already permitted by the product.
* A viewer cannot operate price refresh manually.
* A viewer cannot access Accuracy.
* A viewer cannot access Autonomy.
* A viewer cannot access Dry Run.
* A viewer cannot access bankroll or sizing.
* A viewer cannot access Health administration.
* A viewer cannot access Users administration.
* A viewer cannot access private suggestion-management or reliability analytics.
* Role restrictions are enforced server-side rather than solely through navigation.

### Admin information architecture

* William can reach all existing administrative capabilities from an explicitly admin-oriented area.
* Accuracy remains reachable.
* Autonomous paper operation remains reachable.
* Dry Run remains reachable.
* Bankroll/risk controls remain reachable.
* Suggestion history/reliability remains reachable.
* Health remains reachable.
* User management remains reachable.
* Moving a feature out of primary navigation does not remove or weaken its underlying capability.
* Viewer URLs cannot deep-link around the admin boundary.

### Accuracy simplification

* The first Accuracy view communicates the current model-quality state in plain language.
* The view communicates whether sample size is sufficient for meaningful interpretation.
* Calibration status is explained rather than represented only by a chart.
* Brier score remains available.
* Brier score includes understandable interpretation.
* Baseline comparison remains available.
* Market comparison remains available when enough comparable observations exist.
* Insufficient market sample is communicated as insufficient evidence rather than poor performance.
* Sample sizes remain shown for rates.
* Detailed reliability/calibration charts remain available in a deeper/advanced view.
* Stat/time/model filtering remains available where relevant.
* Existing stored backtest results remain accessible.
* Simplifying the presentation does not discard the underlying measurement record.

### Automatic price refresh

* Routine Slate use does not require pressing Refresh Prices.
* Prices refresh automatically during relevant pregame periods.
* The initial target cadence is approximately five minutes while upcoming markets are in the active refresh window.
* Opening or returning to the Slate checks whether current stored prices have exceeded the expected freshness interval.
* An appropriate stale price can trigger a server-managed refresh without a privileged user action.
* Concurrent viewers do not create uncontrolled duplicate Kalshi refreshes.
* Kalshi rate limits remain respected.
* Both sides of the relevant market continue to be stored with observation timestamps as required by Kalshi Market Sync.
* Edge continues to use the freshest available projection and price independently.
* A failed automatic refresh does not erase the previous valid price.
* A failed refresh produces visible freshness degradation.
* The automatic mechanism reuses the existing server-side Kalshi integration.
* No Kalshi signing/API credential is sent to a client.
* The routine implementation requires no new paid scheduling vendor.
* Manual refresh, if retained, exists only as an admin recovery/debug control and is unnecessary for normal operation.

### Projection freshness

* Projection and price freshness remain distinct.
* A successful price refresh does not clear a stale projection.
* A fresh model recompute does not claim the market price is current if price refresh failed.
* Viewers receive a simple understandable freshness state.
* Admin diagnostics retain detailed timestamps through Health.
* Existing `computed_at` and `information_cutoff` data remain intact.

### Prop Research

* An authenticated user can search for a player with a current stored upcoming projection.
* The user can select among stat types for which a stored distribution exists.
* The user can enter an arbitrary supported threshold.
* The result is calculated from the existing stored distribution.
* Changing the threshold does not run the Projection Engine again.
* Continuous-stat threshold probability is correctly derived from the stored distribution representation.
* Low-count discrete-stat probability uses the appropriate stored distribution representation.
* The result communicates the probability above/clearing the threshold.
* The complementary below/under probability is also available.
* The result shows Sightline's central projected value.
* The result shows expected range.
* The result shows confidence.
* The result shows relevant evidence/Projection Drivers.
* The result shows freshness.
* When no market price exists, economic edge is not displayed.
* A generic manually entered threshold is not labeled profitable merely because the model favors one side.
* When no current stored projection exists, the user receives a clear unavailable state rather than a fabricated probability.
* Prop Research is available to viewers as well as admin.
* The threshold source does not need to be identified.
* No external platform credential, URL, or integration is required.

### Performance

* The current production-size Slate is measured before implementation as a performance baseline.
* The redesigned Slate demonstrates improved initial usable rendering against that baseline under comparable conditions.
* Initial Slate usability does not wait for distribution charts for every contract/player.
* Detail-only visualizations do not have to render before the user opens the relevant detail.
* Player grouping reduces the amount of repeated visible UI required for many thresholds.
* Search and filter interactions remain responsive on a production-size slate.
* Prop Research threshold changes feel immediate because they operate against an existing distribution rather than executing a model job.
* Opening Slate does not wait for a model recompute.
* A background market refresh does not block showing the latest stored Slate.
* Optimizations remain proportionate to Sightline's small user/data scale.
* A new paid cache/CDN/database tier is not required merely to satisfy this pitch.

## Rabbit Holes

* **Turning cards into tiny tables.** Grouping the existing rows inside rectangles without changing hierarchy technically produces cards and solves almost nothing.
* **Putting every threshold on every collapsed card.** The point is progressive disclosure, not relocating the wall of numbers six inches to the left.
* **Ranking by win probability.** A 94% contract is not automatically a good opportunity if the market charges more than the event is worth.
* **Hiding negative-direction opportunities.** "Recommended no" can represent the best trade in the market and deserves the same hierarchy as "recommended yes."
* **Too many filters.** The goal is easy exploration, not recreating an Excel ribbon for football.
* **Mobile filter overload.** Desktop filter bars tend to become unusable when blindly shrunk to a phone.
* **Global search scope.** Player search for current props should not accidentally become a full historical person database.
* **Prop Research appearing to recommend external wagers.** Probability and expected value are different when payout economics are unknown.
* **Threshold semantics.** `≥ 225.5`, `> 225.5`, integer stats, and discrete outcomes must use consistent underlying probability semantics rather than labels that quietly disagree with the stored distribution.
* **No projection available.** Research must not fall back to season average just because a user typed a recognizable player name.
* **Stale research output.** Custom threshold calculation can be instant while the distribution it is calculated from is old. Those are separate facts.
* **Refreshing prices too aggressively.** Five-minute background freshness does not imply querying every Kalshi market every few seconds all week.
* **Using GitHub Actions as a price ticker.** The existing scheduler has no timing SLA and private-repository minutes are finite.
* **Moving credentials for convenience.** A scheduler should invoke existing secured price logic rather than introducing another independent Kalshi integration.
* **Treating automatic refresh as trading-grade market data.** This is a browse/research freshness improvement, not high-frequency execution infrastructure.
* **Confusing price freshness and projection freshness.** One can be seconds old while the other is stale because of new player-status information.
* **Hiding stale state because it looks ugly.** Simplification must make warnings clearer, not remove inconvenient truth.
* **Accuracy oversimplification.** "Model good" without sample size or supporting evidence is as misleading as the current wall of calibration terminology.
* **Deleting advanced analytics.** William still needs them. They simply belong behind the first explanatory layer.
* **Permission drift.** Moving Accuracy to admin-only intentionally changes the earlier shared-read architecture and must be updated consistently.
* **Viewer-specific projections.** Viewer simplification must not create separate model outputs. Shared projections remain shared.
* **Suggestion duplication.** Inline pending suggestions should reuse Pitch 9, not create a second suggestion state tied to Slate cards.
* **Performance by hiding data permanently.** Lazy detail is useful; silently dropping important detail is not.
* **Premature caching infrastructure.** Sightline has a handful of users and a small database. Query/render waste should be fixed before inventing distributed cache invalidation as a hobby.
* **Design-copy explosion.** The product needs plain-language explanations, not paragraph-length tutorials attached to every percentage.
* **PrizePicks imitation becoming cloning.** Familiar card/grouping patterns are useful. Sightline should retain its own design system and information model rather than reproducing another product screen-for-screen.

## No-Gos

* Do not retain the single giant repeated-contract list as the primary Slate experience.
* Do not represent each threshold as an unrelated full-size player row when it belongs to the same player/stat context.
* Do not hide the best opportunities behind game-by-game browsing.
* Do not sort "best" solely by highest predicted probability.
* Do not remove valid NO/Under opportunities from the best-opportunity view.
* Do not make player search admin-only.
* Do not make basic slate filtering admin-only.
* Do not expose admin surfaces merely because navigation cleanup is inconvenient.
* Do not rely on hidden navigation as authorization.
* Do not keep a standalone Suggestions tab solely because Pitch 9 originally created one.
* Do not delete suggestion history/reliability when removing it from primary navigation.
* Do not show viewers private pending-suggestion actions.
* Do not expose bankroll or autonomous controls to viewers.
* Do not make viewers responsible for refreshing prices.
* Do not require William to press Refresh Prices during normal use.
* Do not refresh the entire Simulation Engine every five minutes merely because prices refresh on that cadence.
* Do not create another Kalshi client for the scheduler.
* Do not copy Kalshi credentials into another runtime merely to schedule refreshes.
* Do not add a paid scheduler before exhausting existing infrastructure.
* Do not advertise absolute real-time pricing when the refresh mechanism does not provide that guarantee.
* Do not let failed price refresh silently masquerade as current data.
* Do not let fresh prices clear stale projections.
* Do not remove `computed_at` or `information_cutoff` because the UI becomes simpler.
* Do not remove Brier score, calibration, sample sizes, or baseline comparison from Accuracy.
* Do not make those statistics the first thing a user has to understand.
* Do not show external-prop economic edge without economic inputs.
* Do not add PrizePicks/Underdog/sportsbook APIs.
* Do not scrape external slips or lines.
* Do not accept external betting credentials.
* Do not trigger model simulation from arbitrary threshold entry.
* Do not manufacture a projection for a player/stat pair that does not have a current stored distribution.
* Do not turn Prop Research into a general sports database.
* Do not build historical research in this pitch.
* Do not introduce a new caching service before measuring the actual bottleneck.
* Do not preload every distribution graph on the Slate.
* Do not optimize for imaginary thousands of concurrent users.

## Dependencies

* **Pitch 3: App Shell, Brand & Access** supplies the responsive design system and authenticated admin/viewer roles that this pitch reorganizes rather than replaces.
* **Pitch 4: Kalshi Sync, The Slate & Decision Log** supplies Kalshi Market Sync, the Slate, contract detail, price observations, edge calculations, and recommendation ranking that this pitch restructures. Its existing requirement for refresh on view/background interval is completed rather than replaced here.
* **Pitch 5: Live Pipeline & Staleness** supplies projection freshness and health state. This pitch simplifies how that state is communicated without redefining what makes a projection stale.
* **Pitch 6: Outcome Scoring & Accuracy Surface** supplies the measurements that the redesigned admin Accuracy experience interprets and reorganizes.
* **Pitch 8: Simulation Engine** supplies stored full distributions from which Prop Research can answer arbitrary threshold questions without re-simulation.
* **Pitch 9: Adjustment Suggestions & Source Reliability** supplies pending/accepted suggestion state and reliability history. This pitch moves those interactions into their more useful context rather than implementing another suggestion mechanism.
* Existing server-side Kalshi price-refresh behavior is reused. No viewer credential or browser-side Kalshi access is introduced.
* Existing Supabase and Vercel production infrastructure remain the preferred foundation for frequent automatic price-refresh scheduling.
* The chosen scheduler must keep Kalshi refresh logic server-side and must fit within existing included platform usage wherever practical.

## Open Questions

There are no major user-behavior questions blocking this pitch.

The design stage still needs to choose the exact visual treatment for game grouping, player cards, filters, detail expansion, and the admin navigation, but those are design decisions rather than unresolved product behavior.

The **five-minute price-refresh cadence** should be treated as the starting operating target and measured during implementation. If the existing no-additional-cost infrastructure makes a different cadence materially safer or more reliable, that can be adjusted without changing the product requirement: **users should normally see recently refreshed prices without doing anything manually.**

There are also three upstream documents that need to be synchronized because this pitch intentionally changes previous scope:

* **PRD / Architecture permissions:** general Accuracy becomes admin-only rather than a shared viewer surface.
* **Roadmap:** this becomes the new **Pitch 10: Slate Experience & Prop Research**, pushing Parallel Model Shadow Evaluation to Pitch 11 and Kalshi Live Trading to Pitch 12.
* **Kalshi Market Sync / UI expectations:** automatic refresh becomes the normal experience; manual Refresh Prices is demoted to an admin recovery/debug action rather than an ordinary workflow.

That leaves the user-facing V1 much closer to what you're actually trying to use: **best props first, browse by game/player, research any stored line you encounter elsewhere, and leave the statistical/operational machinery available without making everybody stare at it.**
