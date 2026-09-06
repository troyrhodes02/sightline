# Sightline — Pitch: Outcome Scoring & Accuracy Surface

## Summary

This pitch closes Sightline’s measurement loop. Official player results and Kalshi settlements are ingested automatically, every eligible projection, recommendation, and decision receives a durable outcome, and later corrections cause the affected records to be graded again rather than leaving stale conclusions behind.

It also makes Sightline’s primary success measure visible inside the product. Authenticated users can inspect model calibration, Brier score, baseline comparisons, and market-relative performance throughout the year, while William receives a private view of how his takes, fades, skips, and decision timing performed relative to the model.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L — This pitch combines two independent outcome sources, automatic and repeatable grading, correction handling, several distinct scoring targets, probabilistic accuracy calculations, market comparison, baseline comparison, filtering, year-round interface states, private decision analytics, and final pre-kickoff timing comparisons. These pieces form one coherent vertical slice: scoring without an accuracy surface hides the result, while an accuracy surface without durable scoring is merely a decorative chart connected to nothing trustworthy.

The pitch should remain one vertical capability rather than being split into a “grading backend” pitch and a later “analytics UI” pitch. The surface is how the user verifies that grading works, and the grading system exists to feed the surface. Splitting them horizontally would create an invisible intermediate stage with no independent product value.

The L appetite is acceptable only while the pitch remains focused on measuring already-produced projections, recommendations, and decisions. Adding model experimentation, recalibration, bankroll analytics, suggestion-source analytics, or trade accounting would push the scope beyond this appetite.

## Problem

Sightline’s core job is to tell William which Kalshi NFL player contracts are mispriced, how much to trust that judgment, and how much to stake. Pitches 1 through 5 can establish the historical foundation, produce projections, compare them with live contracts, record recommendations and decisions, and keep the slate current. None of that proves that Sightline’s probabilities deserve trust.

Without automatic outcome scoring, every prediction remains an unsupported claim. William may remember a strong recommendation that won and forget three mediocre ones that lost. A model may appear accurate because its projected values are usually close while its threshold probabilities remain badly calibrated. A recommendation may look correct in hindsight even though it was made against a different price or projection state than the one later inspected.

The problem is not merely recording wins and losses. Sightline produces probability forecasts. A system assigning 70% probabilities should be right approximately 70% of the time across a sufficiently large sample. If it is right only half the time, then the model is overconfident even if some individual calls looked impressive. That calibration error becomes dangerous in later pitches because position sizing consumes probability, not enthusiasm.

A second measurement problem belongs to William’s own behavior. Pitch 4 records whether he took, faded, skipped, or left a contract unmarked, along with the state he saw at decision time. Until those decisions are graded, Sightline cannot determine whether his judgment improves on the model, whether he tends to reject good recommendations, or whether acting earlier costs him edge before kickoff.

A third problem is that NFL and market truth can change after initial publication. Official statistics can be corrected days later. Kalshi may settle before a correction or according to a source that disagrees with the final official line. If Sightline treats the first result it receives as immutable, the accuracy surface will slowly accumulate conclusions known to be wrong.

A notebook or command-line report is not sufficient. Calibration is the product’s primary success measure, and a measure hidden outside the product will not reliably inform Sunday decisions, later sizing rules, or the eventual paper-to-live gate.

This pitch solves the evidence problem: ingest the relevant outcomes, grade everything that can be graded, preserve unresolved cases honestly, and expose the model’s record without overstating what limited samples can establish.

## Solution Shape

After games complete, Sightline automatically obtains two kinds of outcome information:

* Official player statistical results used to evaluate what occurred on the field.
* Kalshi contract settlements used to determine how the corresponding market resolved.

The two sources are retained as distinct facts. Sightline does not silently force them into agreement when an NFL stat correction, market rule, void, or timing difference causes them to diverge. The Architecture Doc establishes that both official results and settlement belong in the outcome model; the exact grading truth assigned to each object type remains an explicit open question for the design stage.

Once sufficient outcome information is available, the system grades eligible records produced before the game:

* **Projections** are compared with the official player result.
* **Recommendation snapshots** are evaluated against the relevant contract outcome.
* **Decisions** are evaluated according to William’s recorded disposition and the contract outcome.
* **Suggestion and shadow-projection outcomes** remain derivable when the later Adjustment Suggestions feature begins producing them, but suggestion-reliability reporting does not ship in this pitch.

A completed game does not leave projections in an indefinite ambiguous state. Each eligible projection reaches one of two broad outcomes:

* Graded against an identified official result.
* Explicitly unresolvable, with the absence of a trustworthy grading target preserved rather than converted into a loss, excluded silently, or left pending forever.

Grading is repeatable. Running the same grading work against the same underlying facts produces the same result and does not create duplicates. When an official correction or changed settlement affects an existing grade, the affected records are re-evaluated and the visible aggregate metrics update accordingly.

The application presents model performance as probabilistic measurement rather than a pick record.

The primary shared accuracy view contains:

* A reliability curve comparing stated probability with observed hit rate across probability buckets.
* Sample size for every probability bucket.
* The model’s Brier score.
* Comparative performance against the season-average baseline.
* Comparative performance against the trailing-five baseline.
* Market-relative comparison where suitable Kalshi observations exist.
* Filters by stat type and time period.
* Honest no-data and insufficient-data states.
* Availability throughout the year, including periods with no upcoming games.

The exact visual form belongs to the design document. The pitch requires that a user can determine whether stated probabilities have matched observed outcomes and whether the model improves on the approved naive baselines.

Calibration, point-estimate error, and market comparison remain conceptually separate:

* Calibration asks whether events assigned a probability occur at approximately that frequency.
* Brier score summarizes the quality of binary probability forecasts.
* Baseline comparison establishes whether the model improves on season-average and trailing-five alternatives.
* Market comparison asks how Sightline’s probabilities performed relative to the corresponding Kalshi probabilities where both existed.

The interface must not collapse these into a single vague “accuracy percentage.” Humans have already done enough damage with leaderboards that reward one unexplained number.

The accuracy surface is available independently of the live slate. During the offseason or on a day with no upcoming contracts, users can still inspect historical performance rather than encountering an empty application.

William receives an additional private decision-analysis layer:

* Results associated with contracts he marked took.
* Results associated with contracts he marked faded.
* Results associated with contracts he marked skipped.
* Comparison between his dispositions and Sightline’s recommendation state.
* Timing cost derived from the difference between the edge captured at decision time and the final eligible pre-kickoff edge.

Timing cost uses stored historical states. It does not recompute what the decision-time edge would have been using current prices, current projections, or a newer model version. The final comparison point must represent the last valid pre-kickoff state defined by the product, not an after-the-fact reconstruction.

Override performance and timing cost are private to William and protected by the same server-side authorization model as the Decision Log. They do not appear in viewer responses, filters, counts, badges, or aggregate payloads.

The Architecture Doc describes general model-accuracy reads as available to authenticated users while keeping override performance and timing cost admin-only. The PRD still contains an open question about whether calibration should be visible to viewers. This pitch preserves that conflict as an explicit decision rather than silently choosing one document over another.

Outcome ingest and grading follow the existing two-runtime boundary:

* Python continues to own official NFL ingest and model-evaluation work upstream of stored results where appropriate.
* TypeScript continues to own Kalshi-facing application behavior.
* Postgres remains the shared seam.
* The application reads stored grading and aggregate results rather than running historical analysis in the user request path.

The pitch defines observable behavior and boundaries. It does not specify outcome tables, grading schemas, route contracts, bucket queries, scheduled workflow files, or chart components.

## In Scope

* **Outcome Ingest and Scoring** — Automatically ingest official player results and Kalshi settlements, link them to the appropriate games, contracts, projections, recommendation snapshots, and decisions, and produce durable graded or explicitly unresolvable states.
* **Accuracy and Calibration Surface** — Present reliability, Brier score, approved baseline comparisons, market-relative comparison where available, sample sizes, stat-type filtering, time-period filtering, and honest insufficient-data states inside the authenticated application.
* **Override performance** — Present William’s decision outcomes in relation to the recommendation and contract state recorded when he acted.
* **Timing cost** — Compare the edge captured in William’s decision-time snapshot with the final valid pre-kickoff snapshot.
* **Stat-correction regrading** — Re-evaluate affected grades and aggregate measures when an official result changes after initial grading.
* **Settlement-change handling** — Re-evaluate affected market-facing grades when the authoritative stored settlement changes or is corrected.
* **Year-round accuracy access** — Keep historical accuracy and calibration available when the current slate is empty.
* **Sample-size disclosure** — Display the relevant denominator alongside every rate, bucket, or decision-performance figure.
* **Unresolvable outcome disclosure** — Preserve and expose cases that cannot be graded reliably rather than silently excluding or misclassifying them.
* **Shared-versus-private accuracy separation** — Keep model-level performance separate from William’s private decisions and timing behavior.
* **Stored aggregate refresh** — Ensure visible accuracy results reflect the latest completed grading state, including later corrections.

The pitch uses outputs from the following already-named PRD features without renaming them:

* **Projection Engine** supplies the probabilities, projected values, information cutoffs, confidence values, and model versions being evaluated.
* **Backtesting Harness** supplies the stored baseline and historical run context used for comparison.
* **Kalshi Market Sync** supplies contracts, price observations, and settlements.
* **Edge Calculation and Recommendation** supplies recommendation snapshots.
* **Decision Log** supplies William’s dispositions and decision-time snapshots.
* **Historical Data Ingest** supplies official player results and later statistical corrections.

The Pitch Roadmap also assigns “override performance and timing cost” directly to this pitch. They are treated as the private evaluative surface built from **Decision Log** data rather than as newly renamed PRD features.

## Out of Scope / Boundaries

* Projection-model changes are excluded. This pitch measures the current model; it does not improve, tune, refit, or replace it.
* The simulation engine, joint distributions, usage redistribution, and model-derived drivers remain in **Simulation Engine**.
* Probability recalibration is excluded. Pitch 6 measures raw model behavior and provides evidence consumed by the later recalibration feature.
* Live recalibration updates, shrinkage toward a backtest prior, correction fitting, and correction-version management belong to **Bankroll, Sizing & Paper Trading**.
* Bankroll state, ledgers, high-water marks, open exposure, position sizing, Kelly configuration, probability ceilings, and dry-run intents are excluded.
* Paper positions and live positions are excluded.
* Profit-and-loss attribution is excluded. There are no executed or simulated positions in this pitch’s required scope.
* Autonomous execution, circuit breakers, withdrawal notifications, and go-live evaluation are excluded.
* Kalshi order placement, fills, rejections, partial fills, and reconciliation are excluded.
* Adjustment Suggestions are excluded.
* Suggestion-source accuracy and adjustment-reliability analytics are excluded and belong to **Adjustment Suggestions & Source Reliability**.
* This pitch does not provide controls to accept or decline suggestions.
* This pitch does not build a general model experimentation interface.
* Users cannot trigger a backtest from the accuracy surface.
* Users cannot change model parameters, probability buckets, historical results, or grading rules from the interface.
* The surface does not retroactively regenerate old projections using the current model.
* The surface does not replace historical projection probabilities when the model version changes.
* The surface does not present realised decision win rate as proof that the model is profitable.
* The surface does not calculate stake recommendations.
* The surface does not establish the final numerical paper-to-live thresholds. It supplies evidence that the later gate will consume.
* The surface does not make positive-edge claims conclusive over a short sample.
* The surface does not hide small samples behind polished percentages.
* The surface does not rank William against viewers or introduce social leaderboards.
* Viewer decision logging and friend-pick sharing remain outside MVP.
* The surface is not a general NFL statistics browser.
* No sportsbook or DFS comparisons are introduced.
* In-game grading displays or live win-probability tracking are excluded.
* Manual editing of official results or settlements through the ordinary product interface is excluded unless separately approved as a bounded administration need.
* Raw per-prediction backtest artifacts remain outside the application database according to the Architecture Doc. The user-facing surface consumes stored aggregate and grading results rather than importing local Parquet into the interface.
* Full observability for grading jobs is excluded. Pitch 5’s health conventions may be extended only enough to disclose grading freshness; this pitch does not become a job-monitoring platform.
* Final grading-policy resolution for conflicting official and Kalshi truths must not be disguised as an implementation detail. It requires an explicit product decision.

## Definition of Done

* Kalshi settlements for completed or otherwise resolved markets are ingested without William manually entering each result.
* Official player statistical results for completed games are ingested without William manually entering each result.
* Settlement ingest and official-result ingest preserve their distinct source and timing rather than collapsing them into one undifferentiated outcome value.
* A completed game’s eligible projections progress to either a graded state or an explicit unresolvable state.
* A projection without a trustworthy corresponding official result is not silently treated as a miss.
* A projection associated with a game that never completes does not remain indefinitely presented as ordinarily pending without an explanatory state.
* Recommendation outcomes are derivable from the stored recommendation snapshot and the relevant resolved outcome.
* Decision outcomes are derivable from the stored decision state and the relevant resolved outcome.
* A decision on a contract Sightline did not recommend remains gradeable.
* Took, faded, and skipped remain distinguishable in graded decision data.
* An unmarked contract is not treated as a skip or included in William’s disposition metrics.
* A voided or cancelled contract receives a distinct nonstandard outcome rather than being counted automatically as a win or loss.
* A settlement arriving for a contract Sightline never projected is retained without fabricating a projection grade.
* Re-running grading against unchanged outcomes produces no duplicate grades and no change in the resulting metrics.
* Re-running settlement ingest against unchanged settlements produces no duplicate outcomes.
* Re-running official-result ingest against unchanged results produces no duplicate outcomes.
* An interrupted grading cycle does not leave partial aggregate results presented as a completed current accuracy record.
* A later official stat correction causes affected projection grades to be recalculated.
* A later official stat correction causes affected aggregate accuracy and calibration results to update.
* A changed authoritative settlement causes affected recommendation and decision outcomes to be recalculated where the approved grading policy requires it.
* Regrading does not rewrite the original projection, recommendation snapshot, decision-time snapshot, or model version that produced the prediction.
* The system can identify which displayed aggregate results reflect the latest completed grading state.
* The reliability surface displays stated probability against observed hit rate across probability buckets.
* Every displayed reliability bucket includes its sample size.
* Buckets with insufficient observations are not rendered as settled, precise estimates.
* The model’s Brier score is displayed for the selected eligible population.
* The season-average baseline is displayed for comparison using the approved metric.
* The trailing-five baseline is displayed for comparison using the approved metric.
* The surface does not imply that baseline point-estimate error and probability calibration are the same measurement.
* Where compatible Kalshi market observations exist, the surface presents the approved market-relative comparison.
* Market comparison excludes or explicitly distinguishes records lacking the required comparable market state.
* The accuracy surface can be filtered by stat type.
* The accuracy surface can be filtered by time period.
* Applied filters update the sample sizes shown with the resulting figures.
* A filter combination containing no eligible graded observations produces a designed no-data state.
* The accuracy surface remains accessible when there are no upcoming NFL games.
* The accuracy surface remains accessible when the current Kalshi slate is empty.
* The absence of current games does not erase or hide historical accuracy.
* Every displayed percentage, hit rate, override rate, or bucket result includes its relevant sample size.
* Insufficient data to draw a meaningful reliability curve produces an honest empty or low-sample state rather than a smooth but unsupported line.
* A time period containing no settled markets does not cause the entire historical accuracy surface to fail.
* William can inspect outcomes associated with took decisions.
* William can inspect outcomes associated with faded decisions.
* William can inspect outcomes associated with skipped decisions without those skips being misrepresented as executed positions.
* William’s private decision analysis is derived from stored decision snapshots rather than reconstructed from current recommendation state.
* Timing cost is computed from the stored decision-time edge and the approved final pre-kickoff edge.
* Timing cost does not use a post-kickoff price or projection as the comparison state.
* A decision lacking a valid final pre-kickoff comparison is marked unavailable for timing-cost analysis rather than assigned a fabricated zero.
* Changing a decision before kickoff does not cause the system to grade a snapshot other than the approved acted-on decision state.
* Override performance and timing cost are accessible only to the admin.
* Viewers cannot retrieve William’s decisions, override performance, timing cost, or private sample counts through direct route access.
* Viewer-facing response data does not contain hidden private decision fields merely because the interface omits them.
* Model-level and private decision-level metrics remain distinguishable throughout the interface.
* Accuracy reads do not trigger a backtest, projection recomputation, settlement refresh, or full grading run in the user request path.
* The surface renders from completed stored results and does not block on a long-running grading process.
* A delayed grading cycle leaves the last completed accuracy results available with honest freshness rather than replacing them with an application error.
* A grading or outcome-ingest failure becomes operationally visible rather than silently freezing the accuracy record indefinitely.
* Suggestion reliability is not displayed before the Adjustment Suggestions feature produces the required source and shadow-outcome history.
* Historical results are not silently recomputed with a newer model merely to make model-version comparisons appear continuous.

The source documents do not fully settle the grading truth for every object type, the market observation used for comparison, viewer access to calibration, or model-version aggregation. The corresponding Definition-of-Done bullets remain conditional on those product decisions and must be resolved before the design document can turn them into exact behavior.

## Rabbit Holes

* **Kalshi settlement versus official statistics.** An NFL stat correction can change the official player result after Kalshi has settled. The product may legitimately need one truth for evaluating the model and another for evaluating a market position or contract decision.
* **Recommendation and decision truth.** The Architecture Doc suggests official results for model grading and Kalshi settlement for position grading, but recommendations and decisions sit between those concepts. They express beliefs about contracts using a model of official statistics.
* **Silently reconciling disagreement.** Overwriting one source with the other destroys evidence that the sources diverged and makes later investigation impossible.
* **Corrections after aggregate publication.** A correction must update both the individual grade and every aggregate containing it without producing mismatched totals or stale cached metrics.
* **Correction chains.** More than one correction may arrive. Regrading must follow the current stored truth while retaining enough provenance to understand why results changed.
* **Settlement arriving before official results.** Contract-facing grades may be available while model-facing grades remain pending. One must not imply completion of the other.
* **Official results arriving without settlement.** Model calibration may be computable while recommendation and decision outcomes remain unresolved.
* **Games that never complete.** Suspended, cancelled, or abandoned games need a terminal or explicitly pending state that does not pollute ordinary accuracy.
* **Voided contracts.** A void is neither a correct nor incorrect recommendation in the ordinary sense and should not be casually placed in a denominator.
* **Markets Sightline never projected.** Kalshi may settle a discovered contract that remained unresolved or lacked a projection. Settlement retention and model grading are separate responsibilities.
* **Projections without markets.** The Product Brief defines calibration across every prediction, not only traded or market-linked predictions. The accuracy population cannot silently shrink to the easiest contracts to join.
* **Contract-like versus full projection populations.** Later recalibration is fitted on the contract-like population, while general model accuracy may cover a broader projection population. The surface must not blur these populations.
* **Multiple thresholds from one distribution.** Several contracts for the same player-stat-game can create correlated binary observations derived from one projection. Treating them as fully independent can make sample size look more informative than it is.
* **Repeated recommendation snapshots.** A single contract may have several recommendation states before kickoff. The grading surface needs a clear evaluative unit rather than counting every refresh as an independent prediction.
* **Which recommendation is graded.** First recommendation, last recommendation, decision-time recommendation, and final pre-kickoff recommendation answer different questions.
* **Missing final pre-kickoff snapshots.** Timing cost cannot be reconstructed honestly when the required comparison state was never captured.
* **Defining “final pre-kickoff.”** The last observed state, a scheduled cutoff state, and the last state before market close can differ.
* **Kickoff changes.** A flexed or postponed game changes which snapshot qualifies as pre-kickoff.
* **Post-kickoff observations.** Delayed clocks or ingestion can accidentally label a state captured after kickoff as pre-kickoff.
* **Decision edits.** If William changes took to skipped or fade to took, the product must know which snapshot reflects the decision actually acted upon.
* **Multiple decisions on one contract.** The PRD names this as an edge case but does not state whether multiple historical actions are valid or an error.
* **Skip performance.** A skipped contract can later be classified as an avoided loss or missed win, but either interpretation can become misleading without a precise denominator and comparison rule.
* **Fade semantics.** Fading could mean preferring the opposite outcome, actually taking the opposite side outside Sightline, or merely rejecting the recommendation. The current product language needs one settled meaning before grading.
* **Override performance selection bias.** William chooses which contracts to mark. His override record is not an unbiased comparison with the model’s full prediction population.
* **Timing-cost sign conventions.** “Cost” could be positive when waiting would have improved the price, negative when acting early captured value, or expressed as absolute edge change. The interface must choose a comprehensible convention.
* **Price used for timing cost.** Ask, bid, midpoint, executable side, and recommendation-driving price can produce different answers.
* **Market comparison time.** Comparing Sightline with the market at first listing, recommendation time, decision time, or final pre-kickoff answers different questions.
* **Market comparison side.** A probability derived from the wrong side of the book can invert the apparent comparison while still producing plausible numbers.
* **Thin-market spreads.** A midpoint may look well calibrated while the executable price was never available at that level.
* **Brier population.** Including every threshold derived from one player distribution can overweight players with multiple listed contracts.
* **Calibration buckets.** Fixed-width buckets, quantile buckets, and adaptive bins have different readability and small-sample behavior.
* **Sparse high-probability bins.** The top of the range is the most dangerous area for later Kelly sizing and often the area with the fewest observations.
* **Low-base-rate stat types.** Touchdowns and similar outcomes can produce buckets dominated by zero events and require careful interpretation.
* **Sample-size thresholds.** The PRD requires honest small-sample handling but does not define when a figure becomes displayable or merely cautionary.
* **Confidence intervals.** The Product Brief says market-edge evidence should not be reported without uncertainty, but the PRD does not explicitly require uncertainty intervals on the accuracy surface.
* **Baseline metric mismatch.** Season-average and trailing-five baselines may primarily supply point estimates, while Brier score evaluates threshold probabilities. “Displayed alongside” does not automatically define a valid like-for-like comparison.
* **Backtest versus live results.** The product may contain historical backtest calibration and live production calibration with different populations and data quality. Blending them can hide drift.
* **Weather-era splits.** Pitch 2 reports backtests by weather era. The Pitch 6 surface does not explicitly state whether those distinctions remain visible.
* **Model-version blending.** Combining results from materially different model versions can make the displayed calibration curve describe no actual model.
* **Model-version fragmentation.** Separating every version can create tiny samples that prevent any useful live conclusion.
* **Backfilling with a new model.** Recomputing old projections risks point-in-time leakage and changes the question from “how did the deployed system perform?” to “how would the new system have performed?”
* **Corrected actuals in historical replay.** A stat corrected days later must not be treated as information the model had before kickoff, even though it may be the right final grading target.
* **Unresolvable-state inflation.** An overly broad unresolvable category can become a place to hide difficult misses.
* **Silent exclusion.** Aggregate queries can accidentally omit unresolved, voided, or missing records without showing how much of the population was excluded.
* **Denominator drift.** A late correction, resolution, or mapping fix changes sample sizes and can make previously viewed percentages move.
* **Rounding.** Small buckets can display percentages that look dramatically different because of one observation.
* **Year-boundary filters.** Calendar year, NFL season, rolling days, and postseason inclusion are different time-period definitions.
* **Stat-type taxonomy changes.** Adding a new stat type later must not rewrite historical aggregate meaning.
* **Viewer-access conflict.** The Architecture Doc makes general accuracy shared; the PRD still asks whether calibration belongs to viewers.
* **Private-data leakage through aggregates.** Viewer-safe model metrics can accidentally include filters, labels, or small counts that reveal William’s decisions.
* **Accuracy becoming a verdict.** A green Brier score or upward chart can be misread as proof of profitability, especially over a short market history.
* **Win-rate fixation.** A high win rate can be achieved by selecting expensive contracts and says little about calibration or edge.
* **Profitability inference without fills.** Pitch 6 has neither paper-fill fidelity nor real execution data and must not imply tradable returns.
* **Grading job freshness.** An accuracy surface can look complete while recent games remain ungraded unless completion and freshness are visible.
* **Partial grading runs.** Updating some stat types or games while leaving old aggregates in place can create internally inconsistent screens.
* **Suggestion sequencing.** The PRD says suggestion outcomes are derivable from Outcome Ingest, but the feature producing suggestions arrives later.
* **Roadmap numbering drift.** Pitch 6 defers suggestion reliability analytics to “pitch 8,” while the current roadmap assigns that feature to Pitch 10.
* **Turning the surface into a research workstation.** Arbitrary cohort builders, custom formulas, exports, notebooks, and parameter tuning would rapidly turn one useful product page into a worse analytics platform.

## No-Gos

* Do not require manual entry for ordinary settlements or official results.
* Do not silently drop a projection that cannot be graded.
* Do not count an unresolvable projection as a miss.
* Do not count a voided contract as an ordinary win or loss.
* Do not overwrite official results with Kalshi settlement values.
* Do not overwrite Kalshi settlements with corrected official statistics.
* Do not hide disagreements between outcome sources.
* Do not mutate the original projection when a result changes.
* Do not mutate recommendation or decision snapshots during regrading.
* Do not grade historical records using the current projection state.
* Do not backfill old production projections with a newer model without an explicitly approved separate analysis.
* Do not use post-kickoff prices to calculate pre-kickoff timing cost.
* Do not reconstruct decision-time state from current values.
* Do not invent a final pre-kickoff snapshot when none exists.
* Do not treat unmarked contracts as skipped decisions.
* Do not collapse took, faded, and skipped into one override category.
* Do not present skipped decisions as executed trades.
* Do not imply that override performance is an unbiased head-to-head test between William and the model.
* Do not expose William’s decisions or private analytics to viewers.
* Do not rely on hidden navigation as the authorization boundary.
* Do not place private decision fields in viewer-facing payloads.
* Do not reduce model performance to one generic accuracy percentage.
* Do not substitute win rate for calibration.
* Do not display a percentage without its sample size.
* Do not render a smooth reliability curve from inadequate data.
* Do not hide empty or sparse buckets merely to make the chart look cleaner.
* Do not imply that a short positive-edge period proves durable market advantage.
* Do not compare Sightline with Kalshi using an unspecified price or observation time.
* Do not mix ask, bid, and midpoint comparisons without clear labels.
* Do not compare unlike baseline and model metrics under one misleading label.
* Do not blend backtest and live-production performance without disclosing the population.
* Do not blend model versions silently.
* Do not make model-version backfilling the default response to sparse live data.
* Do not let accuracy-page requests trigger backtests or large grading jobs.
* Do not make the user wait for a full regrade to open the surface.
* Do not replace the last completed accuracy state with a blank page while regrading runs.
* Do not present a partial grading run as complete.
* Do not allow a failed result source to produce a green all-current state.
* Do not build probability recalibration in this pitch.
* Do not let displayed performance automatically alter the model, Kelly fraction, recommendation threshold, or any staking parameter.
* Do not add bankroll or P&L analytics.
* Do not simulate fills or positions.
* Do not place demo or live orders.
* Do not establish the paper-to-live thresholds by intuition inside this pitch.
* Do not pull suggestion-source analytics forward.
* Do not create a placeholder suggestion-reliability chart from nonexistent data.
* Do not add social rankings, friend comparisons, or public sharing.
* Do not expose raw local Parquet artifacts through the web application.
* Do not turn the accuracy surface into a generic SQL explorer or model-tuning console.
* Do not add manual result-editing tools casually. Any correction path must preserve provenance and authorization.
* Do not treat “official result received” as proof that every associated contract has settled.
* Do not treat “contract settled” as proof that the official player result is final.
* Do not permanently freeze grades merely because they have already appeared in the interface.
* Do not let a correction erase evidence that the prior grade existed or why the aggregate changed.
* Do not use market prices as projection inputs while computing market comparison.
* Do not include in-game markets or post-kickoff recommendations.
* Do not integrate sportsbooks or DFS platforms.
* Do not expand this pitch into portfolio attribution, source reliability, or live trading analytics.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** — Supplies official player-game results, game and player identities, correction-aware source ingest, and the temporal discipline needed to preserve what was known when a projection was made.
* **Pitch 2: Backtest Harness & Baseline Model** — Supplies the projections being graded, their distributions and model versions, the season-average and trailing-five baselines, stored backtest results, and the calibration context used for comparison.
* **Pitch 4: Kalshi Sync, The Slate & Decision Log** — Supplies resolved contracts, price observations, recommendation snapshots, William’s decisions, and decision-time state.
* **Pitch 3: App Shell, Brand & Access**, transitively through Pitch 4 — Supplies the authenticated application shell, responsive design system, and admin-versus-viewer authorization boundary.
* Kalshi settlement access must be configured through the existing server-side Kalshi integration rather than through a second unrelated credential path.
* Official result ingest must preserve later stat corrections rather than treating the first published result as immutable.
* Recommendation snapshots must contain enough historical state to evaluate the recommendation that actually existed.
* Decision records must preserve the acted-on decision-time snapshot.
* A valid final pre-kickoff snapshot must exist for decisions included in timing-cost analysis.
* Contract, game, player, threshold, and stat-type identity must remain stable enough to join projections, settlements, and official results.
* Completed grading state and aggregate accuracy results must be available through the serving database.
* The application must distinguish the latest completed grading state from a currently running or failed grading attempt.
* The approved season-average and trailing-five comparison metrics must be available in a form suitable for the in-app surface.
* The product must define the eligible population for model calibration, market comparison, and override analysis.
* The product must define how model versions are separated or combined.
* The product must define which outcome truth grades projections, recommendations, decisions, and later positions when Kalshi and the official result disagree.
* The product must define which market price and observation time are used for market comparison and timing cost.
* The viewer-access policy for general model calibration must be resolved before final authorization behavior can be accepted.
* The scheduled environment must support outcome ingest and grading after games, following the architecture’s existing GitHub Actions and shared-database approach without placing long-running analysis in the web request path.

The roadmap does not list Pitch 5 as a dependency. Core outcome grading can exist without Pitch 5, but timing cost depends on a reliable final pre-kickoff snapshot. If Pitch 5 owns that capture through its kickoff-relative schedule, then Pitch 6 has a hidden dependency that the roadmap must acknowledge. If Pitch 6 owns the capture instead, that behavior must be explicitly included rather than appearing magically at grading time.

## Open Questions

### 1. Which truth grades each object when Kalshi and official statistics disagree?

The Architecture Doc proposes that official statistics are the correct truth for grading the model while Kalshi settlement is the correct truth for grading a position. Pitch 6 does not yet contain positions, but it does grade recommendations and decisions tied to Kalshi contracts.

The product must explicitly assign the grading source for:

* Projection threshold accuracy.
* Projection point-estimate error.
* Recommendation correctness.
* Took decisions.
* Faded decisions.
* Skipped decisions.
* Later paper and live positions.

Both source values should remain stored regardless of the policy. The open question is which one determines each displayed result.

### 2. Who owns the final pre-kickoff snapshot?

Timing cost requires a decision-time state and a final pre-kickoff state. Pitch 4 stores recommendation and decision snapshots, while Pitch 5 owns kickoff-relative scheduling. Neither current pitch definition unambiguously owns the final capture.

The roadmap must choose one shape:

* Pitch 4’s snapshot rules already guarantee a final pre-kickoff state.
* Pitch 5 captures the final state as part of the live pipeline.
* Pitch 6 adds a narrowly scoped final-snapshot capture capability.
* Timing cost is deferred until a trustworthy capture mechanism exists.

This decision also determines whether Pitch 6 formally depends on Pitch 5.

### 3. Is model calibration visible to viewers?

The Architecture Doc states that reliability, baseline comparison, and market comparison are authenticated reads available to all roles, with override performance and timing cost separated as admin-only.

The PRD still carries an open question saying calibration is currently scoped admin-only but may properly belong to viewers because it describes model quality rather than William’s private behavior.

The source documents should be reconciled before design. Positions, decisions, override performance, and timing cost remain unambiguously private either way.

### 4. How are model versions represented?

The Architecture Doc explicitly leaves unresolved whether the accuracy surface:

* Reports each model version separately.
* Blends versions into one deployed-system record.
* Allows both views.
* Backfills old periods with newer models.

Backfilling changes the question and introduces leakage risk. Blending versions can create a calibration curve that describes no current model. Separating every version can leave unusably small samples.

The design document needs an approved product rule before aggregation behavior is specified.

### 5. Which Kalshi price and timestamp define the market comparison?

The PRD requires comparison against market prices where they existed, but does not define whether the comparator is:

* First observed price.
* Recommendation-time price.
* Decision-time price.
* Final pre-kickoff price.
* Midpoint.
* Executable ask or bid.
* The price on the recommended side.

The answer should align with the price semantics resolved in Pitch 4 and the later sizing requirements, which use executable price net of fees.

### 6. What exactly is displayed “alongside” the baselines?

The PRD requires Brier score and both baselines to be displayed, while the Product Brief describes the backtest gate as lower error than season-average and trailing-five baselines.

The source documents do not establish whether the baselines provide:

* Point-estimate error only.
* Threshold probabilities suitable for Brier comparison.
* Both.
* A separate comparison panel with metric-specific labels.

The pitch must avoid presenting unlike metrics as though they were directly interchangeable.

### 7. What is the eligible population for the reliability curve?

The Product Brief defines calibration across every prediction, not merely traded recommendations. Later recalibration is fitted against the contract-like population, and live market comparison exists only where Kalshi listed a contract.

The surface may need clearly separated populations:

* All eligible projections.
* Contract-like projections.
* Projections with live Kalshi markets.
* Recommended contracts.
* Contracts William acted on.

The design stage must not choose a favorable denominator silently.

### 8. How are multiple thresholds for one projection counted?

One player distribution may produce probabilities for several listed thresholds. Counting each threshold as an independent forecast increases the displayed sample size even though the outcomes are strongly related.

The product must decide whether this is acceptable for the general reliability surface, disclosed as correlated observations, or handled through a more specific evaluative population.

### 9. What constitutes insufficient data?

The PRD requires honest empty states and sample sizes but gives no threshold for:

* Drawing a reliability bucket.
* Displaying a rate.
* Comparing stat types.
* Comparing model versions.
* Showing override performance.
* Evaluating market-relative performance.

The design document needs approved small-sample behavior without pretending that one universal threshold fits every metric.

### 10. How is override performance defined?

“Took,” “faded,” and “skipped” are intentionally distinct, but the PRD does not define the exact derived metrics.

Questions include:

* Whether took and fade are scored only against contract settlement.
* Whether a skip is classified as avoided loss, missed win, or simply no action.
* Whether performance compares William with the model on all recommendations or only contracts he marked.
* How changed decisions are represented.
* Whether multiple decisions on one contract are valid.
* Whether the comparison is descriptive or framed as William adding or subtracting value.

The surface should not imply stronger causal evidence than the selected data supports.

### 11. How is timing cost signed and interpreted?

The PRD defines timing cost as the difference between decision-time and final pre-kickoff snapshots but does not define its sign, unit, or display language.

The product must settle:

* Which edge is subtracted from which.
* Whether positive means acting early helped or hurt.
* Whether the metric is expressed in probability points, price points, expected value, or another unit.
* How fades are oriented.
* How missing final snapshots are handled.
* Which decision snapshot is used after an edit.

### 12. Are confidence intervals required?

The Product Brief says positive edge against Kalshi should never be reported without uncertainty attached. The PRD explicitly requires sample sizes but does not require confidence or uncertainty intervals on reliability, baseline, or market-comparison figures.

The design stage needs to determine whether sample sizes alone satisfy the intended honesty requirement or whether interval estimates are necessary.

### 13. How are backtest and live accuracy presented together?

Pitch 2 stores historical backtest results and calibration bins. Pitch 6 adds graded live production predictions.

The product must decide whether the accuracy surface:

* Separates backtest and live results.
* Allows explicit comparison.
* Combines them only in selected contexts.
* Uses backtest as prior context while preserving live results as a separate record.

Combining them without labels would obscure the distinction between reconstructed historical evaluation and actual deployed performance.

### 14. Are weather eras visible in the accuracy surface?

Pitch 2 requires backtest results broken out by weather era because older seasons use reanalysis with acknowledged look-ahead limitations. Pitch 6’s PRD filters mention only stat type and time period.

The roadmap should clarify whether Pitch 6 must preserve weather-era visibility or whether that analysis remains available only in stored backtest details.

### 15. What does “suggestion outcomes are derivable” require before Pitch 10?

The **Outcome Ingest and Scoring** acceptance criteria say suggestion outcomes are derivable from stored data. The feature that creates suggestions and shadow projections arrives later.

Pitch 6 can establish grading behavior that later suggestion records reuse, but it cannot demonstrate complete suggestion grading before such records exist. The Definition of Done should distinguish capability readiness from unavailable source data rather than requiring fabricated test history.

### 16. Which pitch actually owns suggestion reliability analytics?

Pitch 6’s roadmap row says suggestion reliability analytics are deferred to Pitch 8. In the current roadmap:

* Pitch 8 is **Autonomous Execution & Circuit Breakers**.
* Pitch 10 is **Adjustment Suggestions & Source Reliability**.

The feature boundary is clear, but the numeric reference is stale and should be corrected before downstream dependencies use pitch numbers.

### 17. What taxonomy of unresolved outcomes is needed?

“One explicit unresolvable state” may be too broad for meaningful operation. Relevant cases include:

* Missing official result.
* Unresolved player identity.
* Unsupported stat type.
* Cancelled game.
* Voided contract.
* Settlement disagreement.
* Missing final snapshot.
* Projection-record corruption.
* Source outage still awaiting retry.

The pitch requires honest disclosure, but the design document should define the smallest useful taxonomy without creating an elaborate case-management system.

### 18. Does grading freshness join the Pitch 5 health surface?

The Architecture Doc says failures in scheduled jobs are otherwise silent. Pitch 5 surfaces ingest, recompute, and price-refresh health, but not grading health.

Pitch 6 must decide whether to add:

* Last successful outcome ingest.
* Last successful grading cycle.
* Count of completed games still awaiting grades.
* A simpler “accuracy pending recent games” state.

The answer should make stale accuracy visible without turning the product into an observability console.