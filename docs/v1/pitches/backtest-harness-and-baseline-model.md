# Sightline — Pitch: Backtest Harness & Baseline Model

## Summary

This pitch delivers the first complete, testable projection loop for Sightline: a simple distributional model, a chronological backtesting harness, permanent naive baselines, and a temporary local inspection interface used to verify that the system behaves correctly before the work is finalized.

When this pitch ships, Sightline can answer a foundational question with evidence: does its projection approach outperform basic season-average and trailing-five-game estimates when evaluated only on information available before each game?

The temporary inspection interface is a development aid, not a product surface. It exists so the model's distributions, calibration, temporal cutoffs, exclusions, and individual predictions can be reviewed visually. After the owner verifies the implementation, the interface must be removed from the final pull-request branch while the underlying CLI, automated tests, stored results, and runbook remain.

This pitch does not yet answer whether Sightline beats Kalshi's market prices, because sufficient historical market-price data does not exist. It establishes the model-quality floor that must be cleared before the market-facing product is worth building.

## Type & Appetite

* **Type:** Foundational
* **Appetite:** **L** — The pitch combines a reproducible chronological evaluation system, a distribution-producing baseline projection model, two comparison baselines, calibration analysis, persisted aggregate results, raw run artifacts, interruption safety, executable documentation, and a disposable visual inspection surface.

The temporary inspection interface increases implementation scope slightly but does not change the pitch's fundamental appetite. It is deliberately constrained to reading already-produced backtest artifacts and presenting them for manual verification. It does not create a production UI, an application workflow, or another permanent subsystem.

The large appetite is justified because this is a complete validation capability rather than merely "train a model." The model, harness, metrics, storage of results, visual inspection, and runbook form one coherent foundation.

Separating the harness from the model would leave one pitch unable to prove anything and the other unable to run, a remarkably efficient way to manufacture two incomplete systems instead of one useful one.

## Problem

Sightline's core job is to tell William which Kalshi NFL player contracts are mispriced and how much to trust that judgment. Before it can compare its beliefs with market prices, it must establish that those beliefs are meaningful on their own.

A point estimate is not sufficient for Sightline's decision. Kalshi contracts ask binary threshold questions: whether a player reaches a specific yardage or touchdown threshold. Sightline therefore needs a probability distribution over possible outcomes, not merely an expected stat line. Without a distribution, it cannot derive the probability that a player clears an arbitrary contract threshold or meaningfully compare its estimate with a market price.

The product also needs a way to distinguish genuine model skill from ordinary football continuity. A model may look accurate simply because players tend to perform near their recent averages. Unless Sightline is compared against season-average and trailing-five-game baselines, a seemingly impressive projection system may add no value beyond arithmetic that could be done in a spreadsheet.

Most importantly, the model must be evaluated chronologically. It must predict each historical game using only information available beforehand, just as it will operate in production. A random train-test split or season-complete feature set would violate the point-in-time discipline established in Pitch 1 and produce a misleading estimate of live performance.

Automated metrics alone are also insufficient during development. A run can complete successfully while still containing behavior that is visibly unreasonable: narrow confidence for a rookie, future information appearing in a cutoff, impossible distribution shapes, unexplained exclusions, or one stat type carrying the entire aggregate result.

Pitch 2 therefore needs both machine-verifiable execution and a temporary human inspection surface. The terminal, automated tests, and stored artifacts remain authoritative. The visual interface makes suspicious model behavior easier to detect before the work is approved.

The purpose is not to produce the most sophisticated football model possible. It is to create a trustworthy measuring instrument and establish a baseline that future complexity must earn the right to replace.

## Solution Shape

Sightline will gain an offline backtesting workflow that moves chronologically through configurable historical seasons and stat types. For each game, it will retrieve only information that was available before the prediction cutoff, produce player-level probability distributions, compare those distributions with actual outcomes, and store both detailed run artifacts and aggregate evaluation results.

The first implementation of the **Projection Engine** will be intentionally simple. It will use recent player form and an assumed distributional shape appropriate to each stat type to produce a full outcome distribution for each player-stat-game.

Continuous statistics such as passing, rushing, and receiving yards will produce distributions from which arbitrary threshold probabilities can be derived. Low-count statistics will use representations that respect their discrete nature rather than treating events such as touchdowns as smooth yardage-shaped outcomes wearing a novelty hat.

Each projection will carry the provenance needed for reproducibility and interpretation:

* When it was computed.
* The information cutoff used.
* The model version that produced it.
* A confidence value.
* The historical evidence available for the player and role.

The model will remain independent of Kalshi prices. It is evaluated against football outcomes, not trained to imitate the market it will later attempt to challenge.

The backtest will compare model performance against two permanent naive baselines:

* A season-average baseline representing the player's established performance within the season up to that point.
* A trailing-five-game baseline representing recent form without a richer model.

These baselines are not disposable scaffolding. They remain part of Sightline's long-term accuracy reporting so that every future model must demonstrate measurable improvement over simple alternatives.

Evaluation will include prediction error against actual player outcomes and probability calibration across threshold events. Results will be segmented by stat type, season, and weather era so that model behavior is not hidden inside one aggregate score.

The weather-era split follows the Architecture Doc's distinction between archived forecasts and older reanalysis data, since the latter carries acknowledged look-ahead limitations.

Aggregate run results and calibration bins will be stored for later application display. Raw per-prediction output will be written to local analytical artifacts rather than loading millions of detailed rows into the application database.

The exact storage and execution design belongs to the Architecture Doc and subsequent design stage. This pitch establishes the behavioral division between durable summary results and local detailed output.

Runs will be reproducible from their stored configuration, model version, code version, and deterministic random seed where randomness is used. An interrupted or failed run will never appear as complete.

### Temporary verification interface

During development, the pitch will include a temporary local inspection interface that reads completed backtest results and raw prediction artifacts.

The interface may be implemented as a generated static HTML report, a local Python inspection application, or another lightweight local-only viewer selected during design. It must not require production deployment, application authentication, permanent APIs, or changes to the production user journeys.

The interface will allow the owner to visually inspect:

* Run status and configuration.
* Model and baseline comparisons.
* Calibration buckets and their sample sizes.
* Individual prediction distributions.
* Threshold probabilities derived from those distributions.
* Projection confidence.
* Information cutoffs and excluded future records.
* Failed, skipped, and unprojectable cases.
* Weather-era segmentation.
* Repeat-run reproducibility.

The temporary interface exists only for development review. Once the owner verifies the pitch, all code and routes used solely for this inspection UI must be removed from the final PR branch.

Screenshots or generated report artifacts may be retained in review documentation if useful, but the executable inspection interface itself must not merge as part of the production codebase.

Written runbook documentation will ship with the permanent capability so a later operator can execute, configure, and interpret the backtest without reconstructing the ritual from shell history and vague memories.

## In Scope

* **Projection Engine** — Ship the first distributional implementation, producing a full outcome distribution, projected value, expected range, confidence, information cutoff, model version, and reproducible output for each supported player-stat-game.
* **Backtesting Harness** — Execute the Projection Engine chronologically across configurable historical periods using only point-in-time-eligible information, compare results with actual outcomes and permanent baselines, and persist reproducible run results.
* **Season-average baseline** — Produce a simple point-in-time baseline using the player's season performance available before each game.
* **Trailing-five baseline** — Produce a simple recent-form baseline using up to the player's five preceding eligible games.
* **Calibration computation** — Measure how stated probabilities align with observed outcomes across probability buckets, with sufficient data retained for later reliability-curve display.
* **Temporary Backtest Inspection UI** — Provide a local, development-only visual interface over completed backtest artifacts so the owner can verify distributions, calibration, temporal cutoffs, exclusions, and individual predictions.
* **Runbook documentation** — Document how to execute a backtest, configure its scope, identify the resulting artifacts, interpret its core metrics, and launch the temporary inspection interface during development.
* **Verification cleanup** — Remove the Temporary Backtest Inspection UI from the final PR branch after owner verification, while retaining the permanent backtesting capability and test coverage.

The **Temporary Backtest Inspection UI** and **Verification cleanup** are explicit owner-added requirements for this pitch. They extend the upstream scope as development-verification constraints rather than permanent product features.

## Out of Scope / Boundaries

* **Historical Data Ingest** is owned by Pitch 1. Pitch 2 consumes the leakage-safe corpus and its as-of behavior but does not redesign source ingestion, temporal reconstruction policy, identity resolution, or historical weather acquisition.
* **Kalshi Market Sync** is deferred to Pitch 4. No live contracts, price observations, settlement feeds, spreads, executable prices, or market discovery are part of this pitch.
* **Edge Calculation and Recommendation** is deferred to Pitch 4. The pitch produces threshold probabilities but does not compare them with prices, rank contracts, or recommend positions.
* **Brand and Responsive Interface** and **Authentication and Invite** are deferred to Pitch 3. The temporary inspection UI does not establish production navigation, authentication, visual branding, or responsive product surfaces.
* **Accuracy and Calibration Surface** is deferred to Pitch 6. Pitch 2 calculates and stores calibration results, but the temporary inspection UI is not the production reliability surface and must not evolve into it.
* **Simulation Engine** is deferred to Pitch 7. No game-level joint simulation, play-volume model, usage-allocation model, teammate interaction, vectorized Monte Carlo production model, or layer-level calibration work belongs here.
* **Usage redistribution** is deferred to Pitch 7 and Pitch 8. The baseline model does not attempt sophisticated reallocation when a teammate is inactive.
* **Adjustment Suggestions** and source-reliability analysis are deferred to Pitch 8.
* **Scheduled live recomputation** and production staleness behavior are deferred to Pitch 5. Backtests run offline and outside the user request path.
* **Trading** is deferred to Pitch 9 and remains gated on a stored accuracy record from this capability.
* **Model selection through the production application** is out of scope. Backtests are executed outside the product UI.
* **Permanent internal analytics tooling** is out of scope. The temporary UI must not become a maintained internal dashboard.
* **Production deployment of the temporary UI** is out of scope.
* **Production authentication or authorization for the temporary UI** is out of scope.
* **Permanent Next.js routes for triggering backtests** are out of scope.
* **Hyperparameter optimization as a product feature** is out of scope.
* **Market-edge claims** are out of scope. Historical outcome accuracy does not establish that the model can beat Kalshi, and this pitch must not present it as though it does.

## Definition of Done

### Backtest execution

* A backtest can be executed from the terminal across a configurable range of historical seasons.
* A backtest can be restricted to one or more supported stat types without requiring code changes.
* The terminal output identifies the run configuration, current progress, exclusions, failures, and final completion status.
* Games are processed in chronological order rather than through a random split that allows later-season information to influence earlier predictions.
* Every model-facing read uses the point-in-time access behavior established in Pitch 1.
* No fact whose availability timestamp occurs after the game's prediction cutoff is eligible for use in that projection.
* A run that repeats against the same stored corpus state, configuration, information-cutoff policy, model version, code version, and seed produces the same results.

### Projection output

* The first **Projection Engine** implementation outputs a probability distribution for every successfully projected player-stat-game rather than only a point estimate.
* The probability of clearing any supported threshold can be derived from the stored or emitted distribution without refitting the model.
* Every projection includes a projected value and an expected range derived from the same distribution used for threshold probability.
* Every projection records its computation time.
* Every projection records the information cutoff against which it was computed.
* Every projection records the model version that produced it.
* Every projection includes a confidence value based on the uncertainty represented by the projection and the relevant historical evidence available for the player in that role.
* Re-running a projection against the same inputs and cutoff yields the same output.
* Kalshi prices are not read or used by the model, its features, its baselines, or the backtesting harness.
* Adding a supported threshold for an existing stat type does not require the model to be rerun merely to calculate that threshold probability.

### Baselines and evaluation

* A season-average baseline is produced for every eligible projection using only games and statistics available before the predicted game.
* A trailing-five baseline is produced using no more than the five eligible prior games available before the predicted game.
* Baseline behavior is defined for early-season cases where fewer than five prior games exist.
* The model's outcome error is calculated and reported against actual results.
* The season-average baseline's error is calculated using the same eligible prediction population and evaluation rules as the model.
* The trailing-five baseline's error is calculated using the same eligible prediction population and evaluation rules as the model.
* Model and baseline results are broken out by stat type.
* Model and baseline results are broken out by season.
* Model and baseline results are broken out by historical weather era.
* Calibration results compare stated threshold probabilities with observed binary outcomes across probability buckets.
* Calibration output retains the observation count for every probability bucket.
* A Brier score or equivalent binary-probability error result is computable from the stored per-prediction outcomes and probabilities for later presentation.

### Stored results and reproducibility

* Aggregate backtest results are written to the application's durable data store for later use by the Accuracy and Calibration Surface.
* Calibration-bin results are written to the durable data store in a form later surfaces can consume without rerunning the backtest.
* Raw per-prediction results are written to local analytical artifacts rather than placing the full detailed history in the application database.
* Every stored run records the configuration needed to identify what period, stat types, model version, and evaluation policy produced it.
* Every stored run records the relevant code version.
* A seeded stochastic operation produces deterministic results for the same run configuration.
* An interrupted or failed run is visibly incomplete and is never returned or displayed as a completed backtest.
* A completed run can be distinguished from a running, failed, or interrupted run.

### Failure and sparse-data behavior

* Missing required historical data causes an explicit failure or documented exclusion rather than silently entering the evaluation population as fabricated values.
* A player with insufficient history receives a wide, low-confidence projection or an explicit unprojectable result rather than an unsupported high-confidence estimate.
* A rookie, role-change player, or player returning from an extended absence is handled through the same explicit uncertainty or decline behavior.
* A stat type with a high probability of zero uses a distributional treatment that can represent that zero mass rather than forcing an inappropriate continuous approximation.
* Failed, skipped, and unprojectable cases retain explicit reason codes or explanations that can be inspected in the raw output and temporary UI.
* Model and baseline comparisons use compatible evaluation populations, with any differences clearly reported.

### Temporary Backtest Inspection UI

* A local development-only interface can be launched after a completed backtest.
* The interface reads completed run summaries and raw per-prediction artifacts without modifying model results.
* The interface clearly identifies the run being inspected, including model version, code version, seed, seasons, stat types, and information-cutoff policy.
* The interface displays run status and distinguishes completed runs from interrupted or failed runs.
* The interface displays model error alongside season-average and trailing-five baseline error.
* Baseline comparisons can be viewed by stat type.
* Baseline comparisons can be viewed by season.
* Baseline comparisons can be viewed by weather era.
* The interface displays calibration buckets with predicted probability, observed hit rate, and sample size.
* The interface makes model overconfidence or underconfidence visually inspectable.
* The interface provides an individual prediction explorer.
* An inspected prediction displays the player, game, stat type, projected value, expected range, confidence, actual result, and model version.
* An inspected prediction displays its full or summarized distribution.
* The interface displays multiple threshold probabilities derived from the same distribution.
* The interface displays the prediction's information cutoff and game kickoff time.
* The interface displays the latest eligible source records used for an inspected prediction.
* The interface displays examples of future-dated records excluded by the cutoff where such records exist.
* The interface identifies whether availability timestamps were observed or reconstructed where that distinction is relevant.
* The interface displays failed, skipped, and unprojectable predictions grouped by reason.
* The interface allows representative sparse-history cases, rookies, role changes, and return-from-absence cases to be inspected.
* The interface makes negative or otherwise impossible distribution output detectable for stat types where those values are invalid.
* The interface is local-only and does not require Vercel deployment, production authentication, or permanent application routes.
* The interface does not trigger production model runs from the browser.
* The interface is sufficient for the owner to verify the behavior of the model, harness, calibration, cutoff discipline, and exclusion handling.

### Verification and removal

* The owner is given a documented command or procedure to launch the temporary interface against a selected completed run.
* The owner can verify the implementation before the pitch is finalized.
* Any issues identified during visual inspection are addressed in the permanent model, harness, tests, or artifacts rather than patched only in the temporary UI.
* After owner verification, all code, routes, dependencies, and configuration used solely by the Temporary Backtest Inspection UI are removed from the final PR branch.
* Removing the temporary UI does not remove or weaken the CLI, backtesting harness, automated tests, stored aggregate results, raw artifacts, or runbook.
* Automated tests confirm that the permanent backtest behavior still passes after the temporary UI is removed.
* The final PR diff contains no production-accessible temporary inspection route or undeclared development server.
* Screenshots or static review evidence may remain in PR documentation, but no executable temporary UI remains in the merged code.

### Documentation

* The runbook explains how to execute a run.
* The runbook explains how to choose seasons and stat types.
* The runbook explains how the information cutoff is applied.
* The runbook identifies the durable summaries and local raw artifacts produced.
* The runbook explains the season-average and trailing-five baselines.
* The runbook explains the calibration output and its sample-size limitations.
* The runbook explains how to launch and use the temporary inspection interface during owner verification.
* The runbook or PR checklist explains the required removal of the temporary interface after verification.
* The runbook explains that beating naive baselines is necessary but does not prove an edge over Kalshi's market prices.

## Rabbit Holes

* **Temporary UI becoming permanent.** A disposable inspection page can easily acquire filters, navigation, authentication, and emotional support animals until it becomes an undocumented production surface. It must remain a reader of existing artifacts and be removed after verification.
* **UI-driven model execution.** Adding a convenient "Run Backtest" button may pull process management, logs, cancellation, concurrency, and authorization into the browser. The terminal remains the authoritative execution surface.
* **Testing presentation instead of behavior.** The interface can make a broken model look tidy. Verification must still rely on automated tests, deterministic runs, point-in-time checks, and artifact comparisons.
* **Hardcoded demo data.** The inspection interface must display actual completed run artifacts rather than curated examples that prove only that HTML can arrange numbers into rectangles.
* **UI-specific transformations.** Metrics, buckets, and threshold probabilities should be computed by the permanent backtest logic. The temporary interface must not contain a second implementation of evaluation formulas.
* **Cleanup drift.** Removing the UI after verification may leave unused dependencies, scripts, routes, configuration, or documentation references. Cleanup must cover the entire temporary surface.
* **Chronological leakage outside the query layer.** Pitch 1 can make future rows unreachable, but Pitch 2 can still leak through feature construction that aggregates across an entire season, precomputes present-day summaries, or reuses fitted state from later games.
* **Training-window semantics.** The documents require chronological backtesting but do not specify whether the baseline model is refit before every game, periodically, per season, or using a fixed historical training window.
* **Baseline definitions.** "Season average" and "trailing five" appear simple until early-season games, byes, team changes, injuries, postseason games, partial games, and role changes arrive.
* **Distribution choice by stat type.** Yardage, receptions, attempts, and touchdowns have materially different shapes. A convenient normal distribution may assign impossible negative outcomes or understate zero-heavy behavior.
* **Confidence definition.** The PRD ties confidence to interval width and the amount of relevant history for the player in the role. Combining those signals without producing arbitrary or misleading confidence scores requires a clear design decision.
* **Role relevance.** A player may have extensive career history but almost no history in the current role. Treating all prior games as equally relevant can make the confidence measure look strongest when the situation is least stable.
* **Rookies and sparse histories.** The model must choose between population-level fallback behavior, wide uncertainty, and declining to project.
* **Weather-era comparison.** Older reanalysis-era features contain acknowledged look-ahead information. Aggregate backtest performance can appear stronger in older seasons unless era results remain visibly separated.
* **Stat corrections.** The harness must be clear whether it grades against the eventual corrected official result or the result first published after the game.
* **Repeated thresholds from one projection.** A single distribution may be evaluated against several thresholds for the same player-game. Treating those threshold events as independent observations can overstate effective calibration sample size.
* **Calibration with sparse buckets.** Small samples can create dramatic-looking reliability results. The harness must preserve counts and avoid allowing visually precise conclusions from a handful of observations.
* **Metric selection.** Error for continuous player statistics and calibration for binary threshold events answer different questions.
* **Model selection leakage.** Repeatedly trying models against the same historical evaluation period and choosing the best one turns the backtest into a training set, even when every individual run is temporally clean.
* **Version comparability.** A stored run must remain interpretable after the model code changes.
* **Interrupted runs.** A long backtest may fail after producing millions of rows and several partial aggregates.
* **Raw artifact growth.** Per-prediction outputs across many seasons, models, and reruns can multiply quickly.
* **Unsupported data periods.** Different stat types and contextual features may have different valid historical ranges.
* **Compute optimization too early.** The final simulation engine requires strong vectorization, but the first baseline model does not justify building an elaborate distributed backtesting platform.
* **Tuning for benchmark victory.** The baseline model exists to establish a credible floor and validate the harness. Excessive feature experimentation here risks turning a simple benchmark into an unacknowledged first version of Pitch 7.

## No-Gos

* Do not merge the Temporary Backtest Inspection UI into the production codebase after owner verification.
* Do not retain a hidden or undocumented production route for the temporary UI.
* Do not deploy the temporary UI to the production Vercel environment.
* Do not add production authentication solely to support the temporary UI.
* Do not add a browser-triggered backtest execution endpoint.
* Do not compute model metrics differently in the UI than in the permanent harness.
* Do not patch incorrect model output only at display time.
* Do not build the full **Accuracy and Calibration Surface** under the label of a temporary report.
* Do not build the full **Simulation Engine** in this pitch.
* Do not add game-level joint distributions, correlated player outcomes, teammate interaction effects, play-volume modelling, usage allocation, or efficiency layers.
* Do not model sophisticated injury-driven workload redistribution.
* Do not use Kalshi prices, price movement, settlement probabilities, or market-derived features as model inputs.
* Do not claim that lower historical outcome error proves the model can beat Kalshi.
* Do not build recommendations, confidence-adjusted edge ranking, or trade-selection logic.
* Do not choose a model based solely on aggregate error while ignoring calibration, stat-type performance, season performance, and weather-era differences.
* Do not use random train-test splits for time-ordered NFL data.
* Do not calculate season-average features using complete-season data.
* Do not use corrected or current player context as though it were available before the historical game.
* Do not silently exclude difficult players or failed projections from model metrics while retaining them in baseline metrics, or vice versa.
* Do not tune repeatedly against the final reporting period without preserving a genuinely untouched evaluation window or otherwise acknowledging the selection bias.
* Do not build a generalized machine-learning experiment platform, model registry product, feature store, distributed scheduler, or interactive notebook service.
* Do not make raw per-prediction backtest results part of the application's ordinary relational query path.
* Do not optimize the baseline until it becomes too complicated to understand.
* Do not treat documentation or temporary-UI cleanup as optional work after the model runs. Apparently "temporary" code remains temporary only when someone physically deletes it.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** must ship first. Pitch 2 depends on the historical corpus, bitemporal facts, conservative availability timestamps, as-of query behavior, source provenance, player identity resolution, weather-era designation, and correction handling established there.
* The historical corpus must contain enough supported seasons and stat types to evaluate the first model and both baselines meaningfully.
* Point-in-time reads must be available to the modelling runtime without requiring direct access to unsafe present-day tables or unrestricted historical views.
* A local modelling environment consistent with the Architecture Doc's Python runtime decisions must be available.
* A durable application database must be available for aggregate run records and calibration summaries.
* Local analytical storage must be available for raw per-prediction artifacts.
* A stable code-version identifier must be available so completed runs can be tied to the implementation that produced them.
* The weather-era labels established in Pitch 1 must be queryable so evaluation can be segmented correctly.
* A local browser environment must be available for owner verification of the temporary interface.
* The owner must complete visual verification before the temporary UI is removed and the PR branch is finalized.
* No user-facing application shell, production authentication system, Kalshi integration, or live production scheduler is required for this pitch.

## Open Questions

### Which temporary UI approach should be used?

The pitch requires a local visual inspection surface but deliberately does not prescribe its implementation.

The design-doc stage should select the smallest approach that can read completed artifacts and display the required verification information. Likely choices include:

* A generated static HTML report.
* A local Python inspection application.
* A development-only web page that is guaranteed to be removed before the PR is finalized.

A generated static report or lightweight Python viewer is preferred because it stays close to the modelling runtime and avoids temporary production application routes.

### At what exact point is the temporary UI removed?

The owner must be able to review the interface before it disappears from the branch intended for merge.

The build workflow should define a clear sequence:

1. Complete the model and harness.
2. Generate representative backtest runs.
3. Provide the temporary UI for owner verification.
4. Address verification findings.
5. Receive owner approval.
6. Remove the temporary interface.
7. Re-run permanent automated tests.
8. Finalize the PR branch.

The PR should not be considered ready to merge until the cleanup step is complete.

### Should screenshots be retained?

The executable interface must be removed, but screenshots may be useful as evidence that calibration, cutoff inspection, distribution output, and exclusions were reviewed.

The design or PR process should decide whether screenshots belong in the PR description, temporary review notes, or repository documentation. They should not become permanent product documentation that implies the removed interface remains available.

### What exact stat types belong in the first baseline model?

The PRD defines the Projection Engine generically and names yardage and touchdowns as examples, while the roadmap describes an assumed shape per stat type without enumerating the initial supported set.

The design-doc stage should identify the smallest set that is representative enough to validate the harness and useful enough to feed Pitch 4.

Passing, rushing, and receiving yardage are likely candidates based on the product framing, but the source documents do not formally lock the first set.

### How is the first model trained and refreshed during a chronological run?

The documents require chronological execution and reproducibility but do not specify the fitting cadence or training window.

Material options include:

* Fit using all eligible prior history before each game.
* Fit once per week using data available before that week.
* Fit once per season using prior seasons only.
* Use a fixed parametric form with rolling player statistics and limited fitted parameters.

This is a design-level decision because it affects realism, leakage risk, run duration, and what "same model version" means across a season.

### How should early-season baselines behave?

A trailing-five baseline cannot have five current-season games during the opening weeks. A season-average baseline may have no current-season observations before Week 1.

The sources require both baselines but do not state whether early-season fallbacks should use:

* Prior-season history.
* Fewer available current-season games.
* A position-level prior.
* An explicitly unavailable baseline result.

The choice must be consistent, point-in-time safe, and reported clearly.

### What does confidence mean in the baseline implementation?

The PRD requires confidence to reflect interval width and the volume of relevant history for the player in that role. It does not define the scale, combination rule, or whether confidence is intended to be comparable across stat types.

The design should establish a transparent interpretation suitable for later confidence-adjusted edge ranking while avoiding a false impression that confidence is itself a calibrated probability.

### What thresholds are used to compute calibration during backtesting?

The Projection Engine produces a distribution from which any threshold probability can be derived, but historical Kalshi thresholds are not available across the full backtest period.

The harness therefore needs a threshold-generation policy for calibration. Possibilities include fixed stat-specific grids, historically common market-like thresholds, or thresholds derived from the prediction distribution.

This is material because calibration results can change depending on which threshold events are sampled.

### How should correlated threshold observations affect reported sample size?

A single player-game distribution may generate several threshold predictions. Counting each threshold as an independent observation can make calibration sample sizes look much larger than the number of underlying games and players.

The design should preserve the information needed to report both threshold-observation count and underlying projection count.

### What is the primary continuous-outcome error metric?

The documents require model error against actuals and both baselines but do not name the metric for continuous statistics.

The design-doc stage should select metrics that remain interpretable across stat types and decide whether one standard metric is sufficient or whether results need multiple views.

### How are completed runs selected for later display?

Pitch 2 stores aggregate results for future in-app presentation, but the documents do not state whether every experimental run is treated as displayable or whether runs need an explicit approved, benchmark, or production-candidate status.

The design should preserve experiment history while identifying which runs are authoritative enough for later product surfaces.

### What constitutes sufficient improvement over the baselines?

The Product Brief says the model should beat both naive baselines on backtest, but it does not specify a minimum margin, confidence interval, number of seasons, or required stat-type consistency.

The eventual shipping gate should consider magnitude, uncertainty, and consistency rather than a ceremonial binary victory by 0.01.

### How should model-development selection bias be recorded?

The documents emphasize reproducibility and leakage prevention but do not explicitly address the risk of testing many variants against the same historical period.

The design should decide whether runs distinguish development, validation, and final holdout periods, or otherwise record enough experiment history to prevent the selected model's reported performance from being mistaken for an untouched estimate.
