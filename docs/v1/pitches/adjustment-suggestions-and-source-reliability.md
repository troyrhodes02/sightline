# Sightline — Pitch: Adjustment Suggestions & Source Reliability

## Summary

This pitch gives Sightline a controlled way to react to late-breaking player information without blindly trusting an external source.

ESPN inactives becomes the first live suggestion source. When ESPN reports information that should materially affect a projection, Sightline computes what the projection would look like with that information applied, preserves that adjusted version for later grading, and presents William with a clear explanation of what changed and why.

William can accept or decline the suggestion in one action. Accepting makes the adjusted projection the version used by the product; declining keeps the original projection active. Either way, Sightline later grades both versions.

Over time, a private reliability surface tells William two separate things:

1. **Was the source actually right?**
2. **When the source was right, did Sightline make a better projection by reacting to it?**

The result is a system that can use breaking information carefully while accumulating the evidence required to decide whether particular sources and adjustment behavior deserve more trust later.

## Type & Appetite

* **Type:** Feature
* **Appetite:** M — This pitch combines one reusable suggestion mechanism, one external source, shadow-adjusted projections, acceptance/decline behavior, automatic grading, and a focused reliability surface. The pieces interact, but the capability remains bounded because it does not introduce a general news system, automatic source trust, new model architecture, or real trading behavior.

The pitch should remain one vertical slice.

Building ESPN ingest without presenting suggestions would create invisible data with no user value. Building suggestion UI without shadow projections would make it impossible to measure whether accepting or declining was actually correct. Building reliability analytics separately would arrive with no trustworthy history to analyze.

Together they form one coherent capability:

**receive late information → calculate its effect → let William decide → grade both possibilities → learn whether the source and adjustment were trustworthy.**

## Problem

Sightline's Simulation Engine gives the system a much richer understanding of player opportunity, usage, efficiency, and teammate interactions.

But projections are still only as current as the information available when they were computed.

Late NFL news can materially change the game shortly before kickoff.

The clearest example is inactives.

If a starting receiver is unexpectedly ruled out, that may change:

* Another receiver's target share.
* A tight end's expected usage.
* Running-back opportunity.
* Quarterback efficiency.
* The range and confidence of several player projections in the same game.

Sightline already has a staleness model for situations where important information exists but has not been incorporated.

The problem is what happens next.

The first intended real-time source for inactives is ESPN. The Architecture Doc explicitly treats this feed as unsupported and potentially unreliable.

Automatically allowing that source to change projections would therefore give an undocumented third-party feed direct influence over the probabilities that eventually determine autonomous positions.

That is too much trust before the source has earned it.

Ignoring the information completely is also unsatisfactory.

If ESPN correctly reports that a high-usage player is out and Sightline knowingly continues displaying projections based on him playing, the model is using obsolete assumptions.

There is also a second, subtler problem.

Suppose ESPN correctly reports that a receiver is inactive.

Sightline adjusts the remaining receivers upward.

Those adjusted projections perform badly.

There are two completely different explanations:

* ESPN gave Sightline bad information.
* ESPN was right, but Sightline redistributed the missing player's workload badly.

If those are measured as one combined outcome, Sightline cannot tell whether it should distrust the feed or improve its own adjustment behavior.

This pitch separates those questions.

## Solution Shape

### ESPN becomes the first suggestion source

Sightline consumes ESPN inactives as the first real-time source connected to the general **Adjustment Suggestions** mechanism.

The integration is deliberately non-critical.

ESPN does not become part of the core Projection Engine.

An ESPN response does not silently overwrite player status.

An ESPN report does not automatically rewrite the active projection merely because the endpoint returned data.

Instead, relevant information can create an Adjustment Suggestion.

The general mechanism is built so future approved sources can use the same suggestion, display, shadow-projection, and grading behavior without creating a second system.

Potential later sources include limited-snap expectations, depth-chart changes, healthy scratches, return-from-injury information, or other structured signals.

Those additional sources are explicitly outside this pitch.

### Suggestions exist only for material projection changes

The purpose of the suggestion system is not to turn every source event into an alert.

A suggestion is raised when the new information produces a meaningful proposed change to an existing projection.

Each suggestion tells William:

* Which player or projection is affected.
* Which source produced the information.
* What the source says.
* The human-readable evidence.
* What Sightline proposes changing.
* How projected value changes.
* How the expected range changes.
* How confidence changes.

Where the new information affects teammate usage through the Simulation Engine, the suggestion can cover the resulting projection changes produced by that model structure rather than a hand-authored numerical guess.

### Base projection remains preserved

The existing projection is never destroyed simply because an adjustment has been proposed.

It remains the **base projection**.

That matters because Sightline later needs to answer:

> What would the model have predicted if we had ignored this information?

Historical evaluation should not depend on whether William happened to click Accept.

### Shadow projection

Whenever Sightline raises a valid suggestion, it also computes the adjusted result as a **shadow projection**.

This happens whether William:

* Accepts the suggestion.
* Declines it.
* Never opens it.

The shadow exists for measurement independently of William's choice.

That means the system later knows:

* How the base projection performed.
* How the adjusted projection performed.
* Which one William chose to display.
* Whether reacting to the source would actually have improved the forecast.

The shadow is not merely a preview generated in the browser.

It becomes a durable projection that can be graded through the existing Outcome Ingest and Scoring capability.

### Accept

William can accept a pending suggestion in one action.

Acceptance makes the adjusted projection the active displayed projection for the affected player/stat/game.

The slate and contract detail surfaces then use the accepted projection according to the product's normal projection-selection rules.

That means downstream edge and recommendation calculations reflect the newly accepted state.

If autonomous paper trading evaluates the contract after the adjustment has become active, it uses the current accepted projection rather than the obsolete base version.

Accepting does not destroy the base projection.

Both versions remain historically available for grading.

### Decline

William can decline the suggestion in one action.

The base projection remains active.

The adjusted shadow projection still remains stored and is still graded later.

Declining therefore means:

> Do not use this proposed adjustment in the active product.

It does **not** mean:

> Pretend the alternative never existed.

### Pending

A suggestion may remain pending when William has not yet acted.

The product makes that state explicit.

The presence of important unresolved late information must not be mistaken for an ordinary fully current projection.

How autonomous paper execution should treat a still-pending material suggestion is an important user-level decision and remains under Open Questions below.

### Viewers

Viewers cannot accept or decline suggestions.

Those actions are admin-only.

Once William accepts an adjustment, viewers see the resulting active projection because viewers and William share the same projection, price, edge, and recommendation surfaces.

No viewer receives a private alternate model or personal projection state.

### Source reliability

Every suggestion eventually contributes evidence about the source itself when the claim can be verified.

For ESPN inactives, the source question is conceptually straightforward:

> ESPN said this player would not play. Was that report actually correct?

Sightline records that separately from whether the proposed projection adjustment was successful.

The reliability surface reports **Source Accuracy** independently.

A source can therefore become demonstrably trustworthy even if the modelling response to its information still needs improvement.

### Adjustment accuracy

Sightline separately asks:

> Did incorporating this information improve the projection?

The base and shadow-adjusted projections are both compared with the eventual outcome.

This produces **Adjustment Accuracy** independently of Source Accuracy.

Possible combinations become understandable:

**Source correct + adjustment improved projection**
Best case. The information was trustworthy and Sightline reacted well.

**Source correct + adjustment hurt projection**
The feed worked; Sightline's redistribution or modelling response needs work.

**Source incorrect + adjustment hurt projection**
The source provided bad information and acting on it caused damage.

**Source incorrect + adjustment happened to improve projection**
A lucky result, not evidence that the source deserved trust.

This distinction is central to the feature.

### Sample sizes

Every source and adjustment reliability rate includes its sample size.

A source being correct on 3 of 3 reports does not get presented with the same authority as one being correct on 97 of 100.

When there is not enough evidence to draw a meaningful conclusion, the product says so.

It does not produce a polished 100.0% score because three observations happened to cooperate.

### Source-specific history

Suggestion reliability is reported separately by source.

ESPN begins as the only source, but the data and user experience preserve source identity so future sources can accumulate their own records.

Adding another source later should not require redesigning the fundamental reliability view.

### Suggestion history

William can inspect what happened historically:

* What information arrived.
* Which projection it affected.
* What the base projection said.
* What the adjusted projection said.
* Whether William accepted or declined.
* Whether the source proved correct.
* Whether the adjustment improved the prediction.

This gives the reliability numbers context rather than reducing them to unexplained percentages.

The pitch does not need to become a general news archive.

The history exists to explain Sightline's projection adjustments and their results.

### Reversed information

A source can change its report.

For example:

1. ESPN reports a player inactive.
2. Sightline creates a suggestion.
3. ESPN later reports the player active.

Sightline must not pretend the first event never happened.

The reversal is handled explicitly.

The earlier suggestion becomes historical evidence, and the current suggestion state reflects the newest source information.

William must be able to understand that the source changed its claim rather than thinking Sightline randomly changed its mind.

The exact presentation belongs to design.

### Contradictory information

The same source may produce duplicate or contradictory events.

Sightline does not create an uncontrolled stack of identical suggestions for the same underlying projection.

The system must distinguish:

* Repeated confirmation of the same information.
* A genuine update.
* A reversal.
* Contradictory current states.

When confidence in the source state itself is unclear, the product favors visible uncertainty rather than silently selecting whichever event arrived last without context.

### After kickoff

This is a pre-game product.

A suggestion arriving after kickoff cannot become an active pre-game projection adjustment.

The information can still be retained where useful for source-reliability analysis, but it cannot rewrite what Sightline claims it knew or predicted before the game.

Historical timing remains honest.

### ESPN outage

If ESPN is unavailable, Suggestion generation stops.

The rest of Sightline remains functional.

The application continues using the existing staleness behavior from Pitch 5 rather than treating ESPN failure as a general application outage.

Affected games remain honestly stale where required information cannot be confirmed and incorporated.

The bot does not infer a player's inactive status from Kalshi price movement as a substitute.

### Autonomous paper trading interaction

Pitch 7's safety rules remain authoritative.

Autonomous trading:

* Never uses stale projections.
* Never bypasses the hard pre-kickoff cutoff.
* Uses whatever projection is currently approved as active.
* Does not automatically trust raw third-party information merely because a suggestion exists.

An accepted suggestion can influence subsequent autonomous decisions because it has become the active projection.

A declined suggestion does not.

Pending suggestions require an explicit policy defined under Open Questions.

### Human-readable reasoning

Suggestion evidence is presented in plain language.

William should be able to understand something equivalent to:

> ESPN reports Player A inactive. Sightline estimates Player B's receiving usage increases from X to Y, moving his receiving-yard projection from A to B and increasing uncertainty.

The specific numbers and model factors come from the underlying projection system.

The product does not invent narrative explanations disconnected from actual model behavior.

### Relationship to the later Parallel Model Shadow Evaluation pitch

This pitch's use of a **shadow projection** is different from the new end-of-roadmap dual-engine shadow capability.

Pitch 9 shadows:

**base projection vs projection adjusted for new information**

The later Parallel Model Shadow Evaluation pitch shadows:

**Baseline prediction engine vs Simulation Engine on the same live slate**

Both use the idea of evaluating something without necessarily letting it control trading, but they answer different questions and should remain separate capabilities.

## In Scope

* **Adjustment Suggestions** — General source-to-suggestion mechanism with source identity, evidence, target projection, proposed changes, accept/decline state, and shadow-adjusted projection.
* **Suggestion Reliability Analytics** — Separate source accuracy and adjustment accuracy with sample size and historical supporting evidence.
* ESPN inactives as the first suggestion source.
* Human-readable evidence from the source.
* Proposed projection changes to value, range, and confidence.
* Shadow projection creation regardless of William's acceptance decision.
* Base and adjusted projection grading.
* One-action Accept.
* One-action Decline.
* Pending suggestion state.
* Explicit handling of duplicate source events.
* Explicit handling of contradictory source events.
* Explicit handling of reversed source information.
* Honest handling of suggestions arriving after kickoff.
* Honest ESPN-unavailable behavior.
* Existing stale-state integration.
* Accepted adjustments flowing into the shared slate.
* Accepted adjustments flowing into Edge Calculation and Recommendation.
* Accepted adjustments becoming eligible for subsequent paper-trading decisions.
* Admin-only suggestion actions.
* Viewer visibility of the effects of accepted changes.
* Private suggestion-reliability analytics.
* Per-source historical reliability.
* Sample-size disclosure.

## Out of Scope / Boundaries

* ESPN information does not automatically modify an active projection without going through the suggestion mechanism.
* Source reliability does not automatically grant ESPN permission to change projections in this pitch.
* Future automatic trust policies are outside scope unless explicitly added later.
* Additional suggestion sources are excluded.
* Depth-chart feeds beyond existing data are excluded.
* Limited-snap feeds beyond existing data are excluded.
* Weather-change suggestions are excluded.
* Social/news scraping is excluded.
* Twitter/X monitoring is excluded.
* Beat-reporter ingestion is excluded.
* General natural-language news analysis is excluded.
* A generic notification/news inbox is excluded.
* The Simulation Engine is not redesigned.
* Probability Recalibration is not redesigned.
* Risk modes are not changed.
* Position Sizing is not changed.
* Circuit-breaker thresholds are not changed.
* Suggestions cannot disable stale-projection protection.
* Suggestions cannot bypass the ten-minute hard cutoff.
* Suggestions arriving after kickoff cannot alter the pre-game prediction record.
* Kalshi price movement is not used to infer player status.
* Kalshi prices remain outside the Projection Engine.
* Real Kalshi orders remain Pitch 10.
* Suggestion reliability does not automatically switch the product from paper to live.
* Suggestion reliability does not automatically change risk mode.
* Viewer accounts cannot accept or decline suggestions.
* Viewer accounts do not get private suggestion histories or reliability-management controls.
* Sightline does not become a general NFL breaking-news product.
* Historical suggestion records do not become a social feed.
* Source accuracy and adjustment accuracy are not collapsed into one score.
* Small samples are not presented as settled reliability.
* An accepted suggestion does not delete or overwrite the base projection.
* A declined suggestion does not delete the shadow projection.
* The later Baseline-versus-Simulation shadow pipeline is excluded from this pitch.

## Definition of Done

* ESPN inactives can produce Adjustment Suggestions against affected projections.
* A suggestion identifies its source.
* A suggestion identifies its target projection.
* A suggestion contains human-readable evidence.
* A suggestion describes the proposed change to projected value.
* A suggestion describes the proposed change to expected range.
* A suggestion describes the proposed change to confidence.
* The proposed adjustment is derived from the actual projection system rather than a hand-authored arbitrary number.
* A shadow-adjusted projection is produced regardless of whether William acts on the suggestion.
* The base projection remains preserved after a shadow projection exists.
* William can accept a pending suggestion in one action.
* Accepting makes the adjusted projection the active displayed projection.
* William can decline a pending suggestion in one action.
* Declining leaves the base projection active.
* Declining does not prevent the shadow projection from being graded.
* Ignoring a suggestion does not prevent the shadow projection from being graded.
* Both base and adjusted projections can be graded against the actual game result.
* Suggestion grading uses the existing outcome-scoring path rather than requiring manual result entry.
* Accepted and declined suggestions remain historically distinguishable.
* Suggestion state is not inferred from which projection happened to perform better after the game.
* Source correctness can be evaluated separately from projection-adjustment quality.
* Adjustment quality can be evaluated independently of whether William accepted the suggestion.
* Source Accuracy is reported separately from Adjustment Accuracy.
* Both rates are reported per source.
* Every displayed reliability rate includes its sample size.
* Insufficient sample size produces an honest limited-data state.
* Suggestions whose source claims cannot later be verified do not receive fabricated source-accuracy outcomes.
* Duplicate source events do not create uncontrolled duplicate suggestions.
* A source reversing itself is explicitly represented.
* Contradictory source information is explicitly represented rather than silently discarded.
* A suggestion received after kickoff does not alter the recorded pre-game active projection.
* ESPN becoming unavailable does not break the slate.
* ESPN becoming unavailable stops new ESPN-driven suggestions.
* Where required late information remains unavailable, the existing staleness system continues to disclose that condition.
* Kalshi prices are never used as a substitute player-status source.
* Viewers cannot accept suggestions.
* Viewers cannot decline suggestions.
* A viewer deep-linking to suggestion-management actions is rejected server-side.
* Viewers can see the effects of an accepted adjustment through the shared projection surfaces.
* Suggestion Reliability Analytics remain admin-only.
* Accepted projections participate normally in downstream Edge Calculation and Recommendation.
* A later autonomous paper cycle uses the current accepted projection rather than an obsolete base projection.
* Historical grading can still distinguish the base and adjusted versions after the active projection changes.
* Adding a future suggestion source does not require redesigning the core suggestion, display, shadow, or grading mechanism.

## Rabbit Holes

* **Treating ESPN as authoritative because it usually works.** The unsupported nature of the integration is the entire reason the suggestion mechanism exists.
* **Automatically changing projections before trust has been earned.** This would turn an unreliable integration into a direct autonomous-trading input.
* **Confusing source failure with model failure.** A correct source followed by a poor workload redistribution should count against the adjustment, not ESPN.
* **Confusing a lucky adjustment with a good source.** Bad information can occasionally improve a prediction by accident.
* **Tiny reliability samples.** Three correct reports do not prove 100% source reliability.
* **Source reversals.** NFL status reporting can change as information develops.
* **Duplicate events.** Repeated publication of the same inactive list should not create multiple independent suggestions.
* **Contradictory states.** Two conflicting events need explicit handling rather than whichever row happened to be processed last winning by database combat.
* **Suggestions affecting multiple players.** One inactive player can alter several teammate projections through usage redistribution.
* **Partial adjustment success.** The suggested effect may help one teammate projection while hurting another.
* **Player without a Kalshi market.** Source information can still matter to teammates even when the player reported inactive has no listed contract.
* **Player without sufficient model history.** The source claim may be valid while the model cannot defensibly estimate the redistribution.
* **Late suggestions.** A correct report arriving after the product's decision window should not retroactively improve Sightline's pre-game record.
* **Pending suggestions and autonomous trading.** The product must not quietly choose between ignoring important information and automatically trusting it.
* **Accepted adjustment after a paper position already exists.** Updating the projection does not automatically answer whether an existing position should be reduced, offset, or simply left alone.
* **Viewer interpretation.** If a projection suddenly changes, viewers should not be left wondering whether the model randomly changed without any explanation.
* **Staleness versus suggestion status.** "We know new information exists" and "William accepted our proposed adjustment" are different facts.
* **ESPN outage recovery.** When the source returns, Sightline should not manufacture a flood of duplicate stale suggestions.
* **Source schema change.** An undocumented endpoint may return valid HTTP responses with unexpectedly changed data.
* **Suggestion history becoming a news feed.** The surface exists to explain model changes and source quality, not replace ESPN.
* **Over-generalizing the mechanism.** Supporting one unreliable structured feed does not require an enterprise rules engine for every information source imaginable.
* **Driver inconsistency.** The adjusted projection's explanation must correspond to the actual redistributed model state.
* **Shadow contamination.** The shadow projection must never accidentally become active simply because it exists.
* **Grading selection bias.** Reliability must include accepted and declined suggestions rather than only cases William believed looked plausible.
* **Autonomous system pressure.** Because Pitch 7 wants to run unattended, there will be temptation to make Pitch 9 automatically approve things simply to avoid blocking the bot.

## No-Gos

* Do not automatically trust ESPN.
* Do not let an ESPN response directly overwrite a projection.
* Do not let the browser invent adjustment values.
* Do not destroy the base projection after an adjustment.
* Do not discard the shadow projection when William declines.
* Do not grade only accepted suggestions.
* Do not use William's decision as evidence that a source was correct.
* Do not combine Source Accuracy and Adjustment Accuracy into one percentage.
* Do not display reliability without sample size.
* Do not claim a source is proven from a tiny sample.
* Do not silently ignore source reversals.
* Do not silently ignore contradictory events.
* Do not create duplicate suggestions for repeated identical information.
* Do not retroactively modify the pre-game projection after kickoff.
* Do not allow viewers to accept or decline suggestions.
* Do not expose private suggestion-reliability analytics to viewers.
* Do not infer inactive status from Kalshi prices.
* Do not make Kalshi prices a model input.
* Do not bypass Pitch 5 staleness rules.
* Do not bypass Pitch 7's hard pre-kickoff cutoff.
* Do not automatically change bankroll risk settings because a source appears reliable.
* Do not automatically promote the system to live trading.
* Do not add Twitter, beat reporters, general news feeds, or AI news interpretation "while we are here."
* Do not build the later dual-engine shadow evaluation capability inside this pitch.
* Do not make ESPN failure a general application failure.
* Do not invent an adjustment when the model cannot defensibly calculate one.
* Do not create a confident adjustment simply because the source claim itself is confident.
* Do not add real Kalshi trade execution in this pitch.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** — supplies stable player/game identity and historical source truth needed to connect and later verify player-status information.
* **Pitch 5: Live Pipeline & Staleness** — supplies the per-game freshness model used when required late information has not been incorporated.
* **Pitch 6: Outcome Scoring & Accuracy Surface** — supplies automatic grading so base projections, adjusted shadows, and source claims can accumulate measurable outcomes.
* **Pitch 8: Simulation Engine** — supplies the usage-redistribution behavior needed for late player availability to produce meaningful teammate adjustments rather than isolated hand-edited point estimates.
* **Pitch 7: Bankroll, Sizing & Autonomous Paper Trading** is a downstream consumer of accepted projection state. Its safety rules constrain how suggestions interact with unattended operation, but the fundamental suggestion mechanism does not depend on position sizing to exist.
* ESPN's inactive feed must be accessible enough to provide the first suggestion source, while remaining treated as unsupported and non-critical.
* The existing projection-version and grading system must preserve base and shadow projections independently.
* Existing admin/viewer authorization must protect suggestion-management and reliability analytics.
* Existing contract detail and slate surfaces must be able to expose the effects and reasoning of accepted adjustments.

## Open Questions

_All seven Open Questions below carry an author recommendation and have been adopted as Resolved Decisions for this run. See the spec's Resolved Decisions section for the concrete, testable form of each._

### 1. What should the paper bot do if ESPN reports something important but you have not accepted or declined it yet?

**Recommendation adopted (A):** Do not trade the affected projection while a material suggestion is pending. Other unaffected players and games continue normally.

### 2. If ESPN eventually proves extremely reliable, do you want the option to let it update projections automatically?

**Recommendation adopted:** Keep Pitch 9 manual. Build reliability evidence first. No automatic-trust toggle is built in this pitch, even disabled.

### 3. If ESPN changes its report, what should you see?

**Recommendation adopted:** Show the newest state prominently but keep the previous report in history as superseded/reversed.

### 4. If information arrives after the bot already took a paper position, should Sightline try to get out of that position?

**Recommendation adopted (A):** Keep the existing position, stop further exposure, record that the projection changed after entry. No automated exits.

### 5. Should your friends see why an accepted projection changed?

**Recommendation adopted:** Show viewers the reason and source for an accepted adjustment. Never show pending/declined suggestions or accept/decline controls.

### 6. Should Sightline track useful source information even when there is no Kalshi contract for that player?

**Recommendation adopted:** Yes. The source event affects relevant projected teammates even when the inactive player has nothing tradeable.

### 7. If Sightline cannot confidently calculate the adjustment, what should happen?

**Recommendation adopted (B):** When evidence is below the Simulation Engine's zero-evidence floor, refuse to suggest a numerical change and keep the affected contracts blocked from autonomous trading.
