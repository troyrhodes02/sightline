# Sightline — Pitch: Parallel Model Evaluation & Paper Scorecards

> Source of truth: Linear document `Sightline — Pitch: Parallel Model Evaluation & Paper Scorecards`
> (https://linear.app/sightline-pilot/document/sightline-pitch-parallel-model-evaluation-and-paper-scorecards-d6575e25360f). Mirrored here for the autonomous pipeline run (slug `parallel-model-evaluation-and-paper-scorecards`).

## Summary

This pitch gives Sightline a continuous, understandable way to determine which prediction engine should be trusted.

The Baseline and Simulation Engine both run against the same live NFL slates, both preserve their own projections, both are graded automatically, and both accumulate independent hypothetical paper-bankroll results under the same bankroll and risk assumptions. Only the explicitly selected model controls the normal production recommendation/trading path; running a model for evaluation never promotes it automatically.

The existing Accuracy and Autonomy experiences are simplified around the questions William actually needs answered:

* Which model is better overall?
* Which model is better for each stat type?
* When a model says something is 70%, 80%, or 90% likely, how often is it actually right?
* How does performance differ between historical backtests and current live games?
* If each model had managed the same fake bankroll, which one would have produced more money and less risk?
* Which model does Sightline currently recommend using?

Detailed statistical and operational records remain stored for AI analysis, debugging, and audit, but they no longer dominate the normal admin experience.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L — This pitch changes live model execution, automatic grading, model selection, paper evaluation, Accuracy presentation, Autonomy presentation, viewer-facing trust information, and several existing workflow assumptions.

The pitch is intentionally large because these pieces answer one coherent question:

**Which prediction engine should Sightline currently trust, and why?**

Running both models without presenting a usable comparison would be an incomplete technical layer.

Simplifying the analytics without generating comparable live evidence would produce a nicer interface around the same information gap.

Maintaining paper portfolios without probability-quality measurements could reward a lucky two-week stretch.

All three belong together.

This pitch does **not** add real-money execution. Kalshi Live Trading remains deferred.

## Problem

Sightline now has two prediction engines:

* The permanent Baseline.
* The newer Simulation Engine.

The existing live pipeline selects one engine per stat type and runs only that model. As a result, whichever engine is not active stops accumulating comparable live projection history for that stat.

That creates a bad evaluation loop.

If the Baseline remains active, Sightline cannot learn how the Simulation Engine would have performed against the exact same live games and market conditions.

If Simulation is promoted, Baseline stops accumulating the live evidence needed to determine whether the promotion remains justified.

Backtests provide much larger samples, but historical performance and current live performance answer different questions.

Sightline needs both.

There is also an information-design problem.

The existing Accuracy surface exposes important measurements such as:

* Brier score.
* Calibration buckets.
* Reliability curves.
* Observation counts.
* Baseline comparison.
* Market comparison.

Those measurements are valuable to the system and to AI analysis, but William does not intend to personally perform statistical diagnosis from raw calibration tables.

His actual questions are simpler:

> Is this model doing well?

> Can I trust it when it says something is highly likely?

> Is Simulation better than Baseline?

> Is one model better for passing while another is better for touchdowns?

> How strong is the evidence?

> Which one should I use?

The existing Autonomy area has a similar issue.

Its separate Overview, Cycles, Positions, Review, Readiness, Dry Run, and Configuration workflows expose implementation and operational structure that William does not need during ordinary use.

Most importantly, **Dry Run no longer matches the intended NFL evaluation workflow.**

Sightline is not a fifteen-minute crypto bot where William needs to manually inspect one imminent decision cycle before enabling the next one.

For football, William intends to let the models accumulate evidence across actual game windows for roughly two weeks and then judge the results.

A manually triggered Dry Run adds ceremony while continuous paper evaluation answers the more useful question.

Finally, financial performance matters to William even though it cannot replace probability-quality measurement.

He wants to know:

> If I had started each model with the same fake bankroll and left it alone, which model would have made more simulated money, how much could have been swept out as profit, and how much drawdown would I have endured?

Sightline currently has pieces of this machinery, but not as a clean parallel model-evaluation experience.

## Solution Shape

### Both engines run live

For every supported live game and stat type where both models are available, Sightline generates projections from:

* Baseline.
* Simulation Engine.

Both projections remain distinct through their model version and provenance.

The currently selected production model still determines what the normal Slate treats as the active projection.

The other model runs in **shadow evaluation**.

Shadow means:

* It generates a real point-in-time projection.
* It is stored.
* It is later graded.
* It contributes to model-comparison analytics.
* It can maintain a hypothetical paper portfolio.
* It does not automatically change what the user sees as the active recommendation.
* It does not automatically change which model controls any future real-money behavior.

There is no automatic promotion.

### Historical and live evidence remain separate

Sightline evaluates models through two clearly distinct evidence sets.

**Historical Backtest**

This comes from the existing Backtesting Harness and provides the larger multi-season evaluation record. The harness already requires chronological, point-in-time evaluation, reproducibility, stat-type breakdowns, and calibration/error measurements.

**Live Performance**

This comes from projections actually generated before real upcoming games and later graded automatically.

Sightline never quietly blends the two into one ambiguous record.

The summary may interpret them together, but the evidence remains labeled separately.

For example:

> **Historical:** Simulation stronger across multiple seasons.

> **2026 Live:** Simulation currently leads, but sample remains limited.

> **Recommendation:** Continue using Simulation for receiving yards.

### Overall model leader

Sightline provides an understandable overall comparison between Baseline and Simulation.

The UI does not pretend that the winner can always be known.

Possible states include concepts such as:

* Simulation leading.
* Baseline leading.
* Too close to call.
* Not enough evidence.

The conclusion is based on underlying probability-quality evidence rather than one vanity statistic.

The detailed methodology remains available to the analytical layer and AI, but the user-facing summary explains the result.

### Best model by stat type

An overall winner does not require every stat type to use the same engine.

Sightline compares the models independently for supported stat types.

The simplified experience can tell William something equivalent to:

| Stat type | Current leader | Evidence |
| -- | -- | -- |
| Passing yards | Simulation | Strong |
| Receiving yards | Simulation | Strong |
| Rushing yards | Baseline | Moderate |
| Receptions | Simulation | Moderate |
| Touchdowns | Baseline | Too early |

This creates the evidence required for a **hybrid production selection**.

### Hybrid model selection

William can select the active model independently by stat type.

For example:

* Passing yards → Simulation.
* Receiving yards → Simulation.
* Rushing yards → Baseline.
* Receptions → Simulation.
* Touchdowns → Baseline.

Sightline may recommend this configuration.

It never applies the recommendation automatically.

Model selection remains an explicit human-controlled decision.

A shadow model continues running after losing active status so William can determine whether the selection remains justified as more live evidence accumulates.

### Sightline recommendation

Sightline translates its stored evidence into a plain-language recommendation.

Examples:

> **Use Simulation overall. Baseline currently remains stronger for touchdowns.**

or:

> **Keep the current hybrid selection. Live evidence still agrees with the historical result.**

or:

> **Do not switch yet. Simulation leads historically, but current live evidence is too limited.**

The recommendation is decision support.

It does not perform model promotion.

### Model Performance replaces analytics-first Accuracy

The main admin model-quality experience becomes **Model Performance** rather than a statistics-first Accuracy page.

The default view answers:

* Which model is leading?
* How much evidence exists?
* What is each model best at?
* Where is each model weak?
* How trustworthy are its stated probabilities?
* What does Sightline recommend?

The existing Brier score, calibration curve, bucket counts, baseline errors, and market comparison remain available in deeper analysis because they remain important evidence and are required by the existing accuracy system.

They no longer constitute the first explanation of model quality.

### Three levels of analytical detail

Admin model analysis is organized into three conceptual levels.

**Summary**

This is the normal admin experience.

It contains the plain-language model scorecards, current leader, recommendation, live/backtest status, paper results, and evidence strength.

**Breakdown**

This provides useful comparisons such as:

* By stat type.
* By model confidence.
* By predicted probability range.
* By live versus backtest period.
* Financial/risk comparison.

**Advanced**

This retains the detailed statistical evidence needed for AI-assisted analysis, diagnostics, and expert inspection:

* Brier score.
* Reliability curve.
* Calibration bins.
* Sample counts.
* Baseline error measures.
* Market-relative comparison.
* Model-version detail.
* Other existing diagnostic measurements.

The product does not discard difficult information simply because William does not want to stare at it.

It changes where that information lives.

### Probability ranges become understandable

Calibration is translated into the question users naturally ask:

> When the model says something has this probability, how often does it actually happen?

A scorecard can communicate:

> **Predictions rated 70–80% occurred 74% of the time.**

or:

> **Predictions rated 80–90% occurred only 67% of the time. This model has been overconfident in this range.**

This interpretation is backed by the same observed-hit-rate versus stated-probability data already required by the Accuracy and Calibration Surface.

Sample size remains visible enough that 3 observations do not receive the same authority as 300.

### Confidence performance

Sightline also summarizes outcomes by its own projection-confidence categories.

For example:

* Low confidence.
* Medium confidence.
* High confidence.

The purpose is not merely to report raw hit rate.

It is to answer whether the model's confidence label is meaningfully associated with stronger or more reliable predictions.

The exact statistical presentation belongs to design.

The user-facing result should be understandable without needing to know how the confidence value is internally derived.

### Limited viewer model evidence

Viewer accounts receive a small amount of model-quality context where it helps them interpret a prop.

They do not receive the full admin evaluation system.

Useful viewer-facing context may include:

* Number of relevant graded predictions.
* Whether the model currently has strong/moderate/limited evidence.
* Whether predictions in the displayed probability range have historically been close to their stated probabilities.
* A concise stat-type track-record indicator.

For example:

> **Sightline probability: 74%**

> Predictions in the 70–80% range have occurred 72% of the time across 184 graded observations.

or:

> **Model track record for receiving yards: Strong**

This fulfills the earlier unresolved PRD question about whether viewers should receive model-calibration evidence by choosing a simplified form rather than exposing the complete admin surface. The original PRD explicitly identifies viewer calibration visibility as unresolved.

Viewers do not receive:

* Model promotion controls.
* Model configuration.
* Paper bankrolls.
* Detailed Brier/calibration analysis.
* Private administrative diagnostics.

### Continuous paper evaluation

Dry Run is removed from the normal product workflow.

Instead, Sightline continuously evaluates the prediction engines using simulated bankrolls.

William configures a paper-evaluation campaign once with settings such as:

* Starting fake bankroll.
* Risk mode.
* Simulated withdrawal policy.
* Whether continuous paper evaluation is enabled.

The evaluation then runs automatically for eligible game windows.

William does not manually approve individual paper cycles.

### Equal model portfolios

Baseline and Simulation each maintain their own independent hypothetical paper portfolio.

They begin with the same configured fake starting bankroll and use the same risk configuration.

For example:

* Baseline starts with $1,000 Conservative.
* Simulation starts with $1,000 Conservative.

Both are exposed to the same available game windows and market conditions.

The meaningful experimental variable is the model probability driving the decisions.

Paper ledgers remain hypothetical and remain isolated from any eventual live-money ledger, consistent with the architecture's existing separation requirement.

### Paper results

For each evaluated model, Sightline summarizes:

* Starting bankroll.
* Current active bankroll.
* Net simulated P&L.
* Percentage return.
* Simulated withdrawals.
* Total simulated value.
* Maximum drawdown.
* Number of simulated positions.
* Breaker activity where applicable.
* Current risk mode.

This allows William to answer:

> If each engine had been given the same $1,000 and the same risk rules, which one would have produced the better financial result so far?

### Simulated withdrawals remain part of paper evaluation

The approved Pitch 7 paper behavior remains.

When the paper bankroll crosses the configured withdrawal rule, the evaluation can simulate sweeping excess funds from the active bankroll.

The scorecard therefore distinguishes:

* Money still active in the strategy.
* Simulated money withdrawn.
* Combined total value.

No actual money moves.

### Financial performance does not decide model quality alone

Paper P&L is an important model-comparison signal because William ultimately cares whether the system can grow money.

It does not replace calibration, Brier scoring, sample size, or historical/live model comparison.

A model can outperform financially over a short period through favorable variance.

Sightline therefore presents financial performance alongside probability quality rather than allowing either to impersonate the other.

The PRD already recognizes that a small number of paper positions gives weak statistical evidence compared with grading probability forecasts across the full contract population.

### Current campaign, not arbitrary replay

This pitch supports continuous paper evaluation from the point a campaign begins.

William can inspect portions of the resulting record by useful periods such as:

* Current week.
* Previous week.
* Required two-week evaluation period.
* Full campaign.

These filters describe portions of the actual continuously running campaign.

They do not recalculate hypothetical alternative histories from arbitrary starting bankrolls.

**What-if Replay is explicitly excluded from this pitch.**

### Hybrid portfolio

When William creates a hybrid active model configuration by stat type, Sightline may also evaluate that exact configuration as a paper portfolio.

For example:

**Hybrid**

* Passing: Simulation.
* Receiving: Simulation.
* Rushing: Baseline.
* Receptions: Simulation.
* TD: Baseline.

The Hybrid portfolio receives the same configured starting bankroll and risk mode used for comparison.

This lets the system eventually compare:

* Baseline-only.
* Simulation-only.
* Current Hybrid.

The purpose is to determine whether selecting the strongest model by stat type actually improves the combined strategy rather than assuming that individually better components automatically form a better portfolio.

### Paper Bot replaces Autonomy sprawl

The current Autonomy experience is simplified.

The normal administrative paper workflow becomes conceptually:

* **Performance**
* **Activity**
* **Settings**

The exact navigation design belongs to the design stage.

The behavioral distinction is what matters.

#### Performance

The primary paper screen answers:

* How much fake money did each model start with?
* How much is it worth now?
* How much has been simulated as withdrawn?
* Which model is leading?
* What was maximum drawdown?
* How much of the required evaluation period is complete?
* Is model quality healthy?
* Is the system approaching real-money readiness?

#### Activity

Detailed simulated position history remains available when William or AI needs to inspect what happened.

The user does not need cycle-level scheduler internals as a primary workflow.

#### Settings

The admin can configure:

* Starting paper bankroll.
* Conservative / Moderate / Aggressive / Custom risk mode.
* Simulated withdrawal behavior.
* Continuous paper evaluation.
* Active model selection by stat type where supported.

### Cycles become diagnostics

Autonomous cycle records can remain stored because they are useful for:

* AI analysis.
* Auditing.
* Debugging.
* Reconstructing paper decisions.
* Determining whether scheduled execution failed.

They no longer require a dedicated primary admin destination.

Operational implementation details belong in deeper diagnostics rather than defining the user experience.

### Review is absorbed into Performance

The current Review concept becomes redundant.

Performance itself is the review.

William can change the time scope of the displayed campaign results without entering a separate review workflow.

### Readiness becomes a summary state

The dedicated Live Readiness checklist is simplified.

The underlying gate evidence remains stored and enforceable.

The normal Performance experience summarizes it in plain language, such as:

> **Real-money readiness: Not ready**

> 1 of 2 required NFL weeks complete

> Paper result: Positive

> Model quality: Healthy

> Operational record: Healthy

> Remaining requirement: One additional complete week

William can inspect more detailed evidence if needed, but he does not need to navigate a checklist of internal requirements during ordinary monitoring.

Sightline still never enables real-money trading automatically.

### Dry Run is removed

The user-facing **Dry Run** feature and required Dry Run gate are removed from the revised product workflow.

The continuous paper campaign becomes the primary operational validation system.

A new model version may begin shadow evaluation without a manually triggered Dry Run.

Changing which model is active remains a human-controlled action.

Real-money activation remains a separate human-controlled action in the later Kalshi Live Trading pitch.

Any low-level execution-preview capability needed for automated tests or developer diagnostics may exist internally, but it is not a user-facing product feature or prerequisite for paper evaluation.

### Configuration remains

Removing Dry Run does not remove risk configuration.

William continues to control how paper evaluation behaves through:

* Starting bankroll.
* Risk mode.
* Exposure limits inherited from the chosen mode.
* Withdrawal behavior.
* Continuous evaluation state.

Conservative remains the default posture unless explicitly changed.

### No automatic model switching

Sightline may say:

> Simulation is the recommended model for receiving yards.

It does not silently change receiving yards to Simulation.

Sightline may say:

> The Hybrid configuration has outperformed either single model during the current live period.

It does not activate Hybrid automatically.

Every production model-selection change requires William.

This is analogous to the established principle that Sightline may determine that live trading is eligible but may never authorize itself to begin risking real money.

## In Scope

* Parallel live execution of Baseline and Simulation Engine for supported projections.
* Shadow evaluation of whichever engine is not active.
* Automatic grading of both engines.
* Separate model-version live records.
* Historical Backtest versus Live Performance separation.
* Overall model leader.
* Best model by stat type.
* Evidence-strength/insufficient-evidence states.
* Human-readable Sightline model recommendation.
* Human-controlled model selection.
* Per-stat-type model selection.
* Hybrid active-model configuration.
* Continued shadow evaluation after model selection changes.
* **Accuracy and Calibration Surface** redesign into plain-language Model Performance.
* Summary, Breakdown, and Advanced analytical layers.
* Probability-range calibration summaries.
* Confidence-level performance summaries.
* Existing detailed statistical records retained.
* Limited viewer-facing track-record/calibration context.
* Parallel continuous simulated paper portfolios.
* Same starting bankroll and risk assumptions across model comparisons.
* Baseline paper portfolio.
* Simulation paper portfolio.
* Current Hybrid paper portfolio when a hybrid configuration exists.
* Active bankroll, P&L, return, simulated withdrawals, total value, and drawdown comparison.
* Time filtering over the actual running campaign.
* Simplification of the current Autonomy experience.
* Performance-oriented paper home.
* Simulated-position Activity history.
* Simplified Settings.
* Readiness summary.
* Removal of Dry Run as a user-facing feature and workflow gate.
* Removal of Cycles as a primary user-facing destination.
* Removal of Review as a separate primary workflow.
* Underlying cycle/diagnostic records retained for system/AI use.
* Explicit human approval for any active-model change.
* Explicit human approval for any eventual real-money activation.

## Out of Scope / Boundaries

* **Kalshi Live Trading** is excluded.
* No real orders are placed.
* No real-money mode is activated by this pitch.
* No model promotes itself automatically.
* No stat type switches engines automatically.
* No Hybrid configuration activates itself.
* No risk mode changes automatically because another setting performed better.
* No What-if Replay.
* No arbitrary historical starting bankroll simulation.
* No retrospective "what if I started with $5,000 last month?" feature.
* No reprocessing today's model against old games and labeling it historical live evidence.
* No blending Live and Backtest evidence into one unlabeled metric.
* No single paper-P&L figure is treated as proof that a model is superior.
* No single Brier score is treated as the complete user-facing definition of model quality.
* No removal of detailed model-quality data from storage.
* No deletion of calibration bins, Brier measurements, error metrics, or model-version evidence merely because the UI is simplified.
* No requirement that William personally interpret advanced statistics.
* No viewer access to paper bankrolls.
* No viewer access to model-selection controls.
* No viewer access to detailed advanced analytics.
* No viewer access to private operational failure history.
* No viewer access to risk configuration.
* No viewer access to simulated withdrawals.
* No viewer-specific model selection.
* No independent viewer paper portfolios.
* No redesign of the Baseline model.
* No redesign of the Simulation Engine.
* No new model-training strategy.
* No change to point-in-time Backtesting Harness rules.
* No market prices fed into either Projection Engine.
* No elimination of hard bankroll/exposure safety controls.
* No general-purpose experimentation platform.
* No manual per-prop model selection in the normal Slate.
* No user-facing scheduler/cycle administration.
* No reintroduction of Dry Run under another name merely because existing code already implements it.
* No real-money readiness decision based solely on which model has made the most fake money.

## Definition of Done

### Parallel model evaluation

* Baseline and Simulation Engine can both generate live projections for the same supported game/stat opportunity.
* Both model outputs retain distinct model identity.
* Running a shadow model does not change the active production model.
* Both models' live projections can reach graded or explicitly unresolvable states through the existing automatic grading process.
* A stat type remains evaluable for both models after one engine becomes active.
* Changing the active model does not stop the former active model from accumulating shadow evidence.
* Missing Simulation support for a stat type does not prevent Baseline from continuing normally.
* A failure of one evaluation model does not cause the other model's valid stored projection to be relabeled as its output.

### Live versus Backtest

* Historical Backtest evidence is clearly labeled as historical.
* Live evidence is clearly labeled as live.
* Live counts reflect only projections generated before the real game using the applicable information cutoff.
* Historical results are not mixed into the live sample count.
* A summary can interpret both evidence sources without obscuring which evidence came from which source.
* An engine can be historically stronger while live evidence remains explicitly inconclusive.
* Small live samples render as limited evidence rather than a definitive winner.

### Overall comparison

* The admin experience identifies the current overall leader when evidence supports one.
* The admin experience can communicate that evidence is too close or too limited to declare a leader.
* The model comparison includes sample size/evidence strength.
* Sightline provides a plain-language explanation for its conclusion.
* Sightline can recommend an engine without activating it.

### Stat-type comparison

* Baseline and Simulation can be compared independently for each supported stat type.
* Each stat-type comparison identifies the current leader when evidence supports one.
* Insufficient evidence is represented honestly.
* An overall model leader does not hide stat types where the other model currently performs better.
* Stat-type comparison remains available across both Live and Backtest contexts.

### Hybrid selection

* William can explicitly select the active model independently by supported stat type.
* The current selection is clearly visible.
* Sightline can recommend a hybrid configuration.
* A recommendation never changes the configuration automatically.
* Changing one stat type does not silently change another.
* Historical projections retain the model that actually produced them rather than being relabeled after selection changes.

### Model Performance Summary

* The default admin model-performance view can be understood without interpreting a reliability curve or Brier formula.
* It communicates overall model status.
* It communicates current leader.
* It communicates evidence strength.
* It communicates strongest and weakest stat types.
* It communicates Sightline's current recommendation.
* It separates Historical Backtest and Live Performance.
* It surfaces paper-performance context without presenting it as the sole proof of model quality.

### Probability-range performance

* The admin can see how stated probability ranges have performed.
* A range reports both the model's typical stated probability and the observed outcome frequency in understandable language.
* Sample size accompanies the interpretation.
* A range with insufficient observations is labeled as such.
* Material overconfidence or underconfidence can be explained in plain language.
* The existing underlying calibration measurements remain available in Advanced analysis.

### Confidence performance

* Model performance can be inspected by the product's confidence level.
* The result communicates whether higher-confidence predictions are actually demonstrating stronger or more reliable behavior.
* Sample sizes remain visible.
* Sparse confidence groups do not receive definitive labels unsupported by evidence.

### Advanced evidence

* Brier score remains available.
* Reliability/calibration curves remain available.
* Calibration-bin records remain available.
* Relevant point-estimate error comparisons remain available.
* Market-relative comparison remains available when sufficient comparable market observations exist.
* Model-version filtering remains possible where required for correct interpretation.
* Advanced information no longer has to be understood to use the Summary experience.
* AI or an expert user can still access enough evidence to diagnose why a summary conclusion was reached.

### Viewer trust information

* A viewer can see a concise model track-record indicator where relevant to a projection.
* A viewer can see a useful sample-size-aware interpretation of the displayed probability range.
* A viewer does not receive admin model-selection controls.
* A viewer does not receive detailed model-comparison diagnostics.
* A viewer does not receive paper-bankroll information.
* Viewer evidence is derived from the same graded model record rather than a separate marketing metric.
* An insufficient viewer-facing sample is described honestly.

### Continuous paper evaluation

* William can configure a starting fake bankroll for continuous paper evaluation.
* The configured risk mode applies consistently across the compared model portfolios.
* Baseline receives its own simulated portfolio.
* Simulation receives its own simulated portfolio.
* Both begin from the same configured starting bankroll for a fair campaign comparison.
* Both operate across the same eligible game windows and available market conditions.
* A model does not need to be the active production model to maintain its paper-evaluation record.
* Paper operation requires no manual Dry Run action.
* Paper evaluation can continue across game windows without William approving individual cycles.

### Paper-performance scorecards

* Each model's scorecard includes starting bankroll.
* Each includes current active bankroll.
* Each includes net simulated P&L.
* Each includes percentage return.
* Each includes cumulative simulated withdrawals.
* Each includes total simulated value.
* Each includes maximum drawdown.
* Each includes position count.
* Relevant breaker/operational events remain attributable to the portfolio.
* Financial comparison uses equivalent risk assumptions.
* A profitable short period is not labeled conclusive model-quality evidence by itself.

### Hybrid paper portfolio

* When a current Hybrid selection exists, Sightline can maintain a distinct simulated portfolio representing that configuration.
* Hybrid performance remains distinct from Baseline-only and Simulation-only.
* Hybrid uses the same configured evaluation bankroll/risk basis for comparison.
* Hybrid history records which model supplied each stat type during the evaluated period.
* Later model-selection changes do not silently rewrite what the historical Hybrid portfolio actually used.

### Campaign periods

* Paper evaluation has a clear campaign start.
* William can view performance for the current week.
* William can view completed weeks.
* William can view the required two-week evaluation period once enough time exists.
* William can view the full campaign.
* Selecting a shorter period reports the portion of the ongoing campaign rather than pretending the bankroll restarted at the beginning of that filtered period.
* No arbitrary bankroll replay is performed.

### Simulated withdrawals

* Existing approved simulated-withdrawal behavior remains supported.
* Simulated withdrawn funds are distinct from active bankroll.
* Total simulated value accounts for both.
* Withdrawal events do not falsely appear as trading losses/drawdown.
* No real money moves.

### Simplified paper administration

* Dry Run is no longer a primary user-facing feature.
* Dry Run is no longer required before continuous paper evaluation.
* Cycles are no longer required as a primary navigation destination.
* Review is no longer required as a separate navigation destination.
* Performance provides the normal review experience.
* Detailed simulated positions remain inspectable through Activity.
* Campaign/risk configuration remains accessible through Settings.
* Operational cycle records remain available to system diagnostics and AI analysis.
* Removing a navigation surface does not delete the underlying audit evidence required to explain a paper position.

### Readiness

* The current real-money-readiness state is visible from the simplified Performance experience.
* Progress toward the required paper-evaluation period is understandable.
* Positive/negative paper result is understandable.
* Model-quality health is understandable.
* Operational health is understandable.
* Detailed gate evidence remains stored.
* Readiness never enables real-money trading automatically.
* Real-money operation continues to require the later Kalshi Live Trading capability and explicit human action.

### Dry Run retirement

* The normal user workflow contains no requirement to run a Dry Run.
* Continuous paper evaluation replaces Dry Run as the operational evidence-gathering mechanism.
* Existing user-facing Dry Run navigation/control can be removed.
* Removing Dry Run does not remove automated testing or internal validation of the sizing/execution path.
* A newly introduced model can enter shadow evaluation without manual Dry Run approval.
* A new model cannot make itself active.
* A new model cannot authorize real-money use.

## Rabbit Holes

* **Declaring a winner too early.** Two models will always produce different numbers. Difference does not imply enough evidence to decide which is better.
* **Paper P&L seduction.** A model can win financially over two Sundays because several large positions happened to land.
* **Calibration purity becoming the opposite problem.** A perfectly calibrated model with no useful market differentiation is not automatically the financially best engine either.
* **One master score.** Collapsing model quality, financial result, calibration, error, and sample size into one unexplained number would simplify the screen by destroying meaning.
* **AI recommendation becoming automatic control.** "Sightline recommends Simulation" must remain different from "Sightline switched to Simulation."
* **Per-stat overfitting.** With enough tiny categories, some model will appear better somewhere through chance alone.
* **Hybrid selection from tiny samples.** Choosing an engine independently for every stat after one week can turn ordinary variance into a permanent routing policy.
* **Hybrid financial interaction.** The individually best model for each stat does not guarantee the combined portfolio has the best risk/return behavior.
* **Shadow models accidentally becoming trading inputs.** Evaluation output and active output need an unambiguous boundary.
* **Different opportunity sets.** If one engine cannot produce a defensible projection for a candidate, its paper portfolio may encounter fewer opportunities; comparison must not pretend the portfolios saw identical model outputs when they did not.
* **Recalibration fairness.** Each model version's probabilities need to be evaluated under the appropriate correction state rather than accidentally giving one engine another engine's fitted recalibration.
* **Live result contamination.** A shadow prediction must exist before the game to count as live evidence.
* **Backfilling fake live predictions.** Running Simulation after the final score is known and inserting the output into Live would invalidate the entire comparison.
* **Repeated projection snapshots.** Multiple recomputes before kickoff need a consistent evaluation population so one model does not gain hundreds of extra "observations" from repeatedly predicting the same contract.
* **Probability buckets without sample context.** "90% predictions hit 100%" is mostly comedy if there were three of them.
* **Confidence terminology.** Users may confuse projection confidence with predicted probability unless the interface distinguishes them clearly.
* **Viewer overinterpretation.** A simplified "Strong" label cannot imply guaranteed profitability.
* **Burying bad performance.** Simplification should explain weak results, not hide them.
* **Advanced analysis disappearing.** AI needs the ugly data precisely because it can uncover why a simple scorecard changed.
* **Cycle deletion.** Removing Cycles from navigation must not mean removing the execution/audit records needed to reconstruct failures.
* **Dry Run code removal versus workflow removal.** Internal execution-preview/test behavior may still be valuable even though the product concept is retired.
* **Campaign restart temptation.** Changing a filter should not reset bankroll history.
* **Changing starting bankroll mid-campaign.** A continuously evolving bankroll cannot remain comparable if its starting assumptions are silently edited halfway through.
* **Changing risk mode mid-campaign.** The resulting period may span different risk policies and needs to remain interpretable.
* **Simulated withdrawal distortion.** Comparing active balances while ignoring withdrawn fake profit will make the better-performing portfolio sometimes appear worse.
* **Paper-fill fidelity.** The financial comparison is only as useful as the realistic fill assumptions both models share.
* **Correlated portfolios.** A model that discovers more opportunities may also accumulate greater same-game dependence; raw profit does not describe that additional risk.
* **Removing readiness detail entirely.** William wants less interface, not less safety evidence.
* **Premature live trading pressure.** A beautiful green scorecard after two weeks still does not grant the system permission to fund itself.
* **What-if Replay sneaking back in.** Replaying arbitrary bankrolls and time periods is useful someday, but it creates another historical simulation product and is intentionally excluded now.

## No-Gos

* Do not run only the active model if the other model is available for shadow evaluation.
* Do not stop collecting Baseline live evidence after Simulation becomes active.
* Do not stop collecting Simulation live evidence when Baseline remains active.
* Do not automatically promote a shadow model.
* Do not automatically change per-stat model selections.
* Do not automatically activate Hybrid.
* Do not allow an AI recommendation to mutate production configuration without William.
* Do not blend Historical Backtest and Live Performance into one unlabeled dataset.
* Do not call backfilled post-game projections "live."
* Do not declare a model superior without sample/evidence context.
* Do not use paper P&L alone to select a model.
* Do not use raw hit rate alone to select a model.
* Do not remove Brier/calibration data from storage.
* Do not require William to interpret Brier/calibration detail before understanding the summary.
* Do not expose the full admin analytics suite to viewers.
* Do not expose bankroll comparisons to viewers.
* Do not expose model switching to viewers.
* Do not create viewer-specific model configurations.
* Do not merge Baseline, Simulation, and Hybrid paper portfolios.
* Do not merge paper results with any future live-money ledger.
* Do not silently give model portfolios different risk settings in a comparison.
* Do not hide simulated withdrawals when comparing portfolio outcomes.
* Do not reset bankroll because William selects a date filter.
* Do not add arbitrary retrospective What-if Replay.
* Do not rewrite historical paper results when model selection changes.
* Do not retain Dry Run as a required user workflow.
* Do not rename Dry Run to "Preview" and preserve the same unnecessary gate.
* Do not delete internal audit records merely because Cycles disappears from navigation.
* Do not make a new model version active merely because it can now run in shadow.
* Do not allow real trading merely because Readiness displays green.
* Do not place real Kalshi orders.
* Do not add sportsbook/DFS evaluation.
* Do not rebuild the Simulation Engine inside this pitch.
* Do not rebuild the Baseline inside this pitch.
* Do not redesign model training through UI work.
* Do not create a universal composite "model score" unless its meaning is defensible and plainly explainable.
* Do not let simplification turn uncertainty into false certainty.

## Dependencies

* **Pitch 2: Backtest Harness & Baseline Model** supplies the permanent Baseline and historical Backtesting Harness used as one side of the comparison. The roadmap explicitly defines the Baseline as permanent comparison infrastructure rather than throwaway work.
* **Pitch 5: Live Pipeline & Staleness** supplies scheduled live recompute behavior and point-in-time production projections. Shadow evaluation must accumulate from real pre-kickoff runs rather than post-game reconstruction.
* **Pitch 6: Outcome Scoring & Accuracy Surface** supplies automatic grading and the underlying Accuracy and Calibration Surface this pitch simplifies. Every projection already reaches a graded or explicitly unresolvable state, and displayed rates already require sample size.
* **Pitch 7: Bankroll, Sizing & Autonomous Paper Trading**, as revised, supplies Position Sizing, bankroll accounting, risk configuration, realistic paper fills, simulated withdrawal behavior, and the continuous autonomous paper machinery reused for each evaluation portfolio.
* **Pitch 8: Simulation Engine** supplies the second Projection Engine whose live performance is evaluated against the Baseline.
* **Pitch 10: Slate Experience & Prop Research** supplies the simplified Admin information architecture and viewer-facing model-context surfaces into which this pitch fits.
* The existing model-version identity on projections is required so live results remain attributable to the engine that actually generated them.
* Each evaluated model needs its own appropriate Probability Recalibration state where recalibration applies; one model's correction cannot be silently reused as another's.
* Automatic grading must grade stored shadow projections, not only whichever projection is currently active.
* The live production environment must be able to load the fitted Simulation Engine artifacts so Simulation can run automatically rather than only during local historical backtests.

## Open Questions

No major user-behavior questions remain before design.

The approved product decisions for this pitch are:

* Baseline and Simulation both run continuously where supported.
* Sightline shows both an overall leader and a leader by stat type.
* Sightline recommends which model to use but never changes the active selection itself.
* Hybrid model selection is allowed by stat type.
* Historical Backtest and Live Performance remain separate.
* Admin analytics use Summary → Breakdown → Advanced.
* Regular viewers receive limited plain-language model track-record context.
* Baseline, Simulation, and an active Hybrid configuration can each accumulate separate continuous paper results.
* Compared paper portfolios use the same configured bankroll and risk assumptions.
* Financial results supplement rather than replace model-quality measurements.
* Dry Run is removed from the user-facing workflow.
* Cycles and Review are removed as primary workflows while their underlying records remain available for analysis.
* Readiness becomes a summarized state rather than a dedicated analytical chore.
* What-if Replay is explicitly deferred.
* Real-money trading remains a later pitch and always requires explicit human activation.

Before this pitch enters the design-doc stage, the upstream planning documents need to be synchronized because the current PRD and Roadmap still state that **Dry Run requires Position Sizing and Autonomous Execution requires Dry Run**. That dependency is intentionally superseded by the continuous-paper-evaluation model established here.

The roadmap should also now treat **Pitch 12: Kalshi Live Trading** as the remaining real-money pitch rather than using the original Pitch 11 numbering.
