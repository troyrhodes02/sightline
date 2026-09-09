# Sightline — Pitch: Simulation Engine

## Summary

This pitch replaces Sightline's simple baseline projection model with the full V1 Simulation Engine.

Instead of projecting players primarily from trailing production, Sightline models how much offensive opportunity a game will contain, how that opportunity will be distributed among players, and how efficiently each player will convert his opportunities into statistical production. Those pieces are combined through simulation to produce complete probability distributions and joint outcomes across players in the same game.

When this pitch ships, every existing Sightline surface continues working as before, but the probabilities underneath the slate, recommendations, sizing system, paper-trading bot, calibration surface, and contract detail views come from the new model.

The baseline model remains permanently available as a benchmark so Sightline can prove whether the more sophisticated model is actually better rather than merely more impressive-looking.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L — The user-facing change is conceptually simple, "replace the baseline with the real model," but the capability contains three interacting predictive layers, joint simulation, distribution storage, explainable drivers, model-version integration, reproducibility requirements, performance constraints, and a full historical validation cycle.

This remains one pitch rather than three separate modelling pitches.

Game environment, usage allocation, and efficiency do not independently solve the user's problem. They only become valuable when combined into one projection distribution that the rest of Sightline can price, grade, size, and trade against.

If one layer turns into open-ended research rather than implementation and validation, that is a scope warning. The answer should be to constrain that layer to a defensible V1 model rather than allowing Pitch 8 to become an indefinite football-modelling research project.

## Problem

The baseline model gives Sightline a valid probability distribution and lets the entire product architecture function, but it is deliberately simple.

It relies heavily on trailing production and assumed distribution shapes. It does not fully model the football process that creates a player's final stat line.

That means it has limited ability to reason about situations such as:

* A game expected to produce unusually high or low offensive volume.
* A starting player becoming unavailable.
* A backup inheriting a larger role.
* A receiver's target share changing because another receiver is absent.
* A team playing from an unusual game environment.
* Weather affecting offensive efficiency.
* Rest, travel, venue, or situational context changing expected production.
* Multiple contracts in the same game depending on the same underlying football events.

These are important because Kalshi does not ask Sightline merely to predict whether a player is generally good.

It asks questions such as:

> What is the probability this player exceeds this exact threshold in this specific game?

A useful answer requires a distribution that responds to the conditions of that game.

There is also a portfolio problem.

Before this pitch, Sightline protects against correlated same-game positions primarily through conservative exposure caps because the baseline model does not provide a principled representation of joint outcomes.

Once Sightline can simulate an entire game together, it can know that several contracts may be strongly related rather than pretending each player exists in his own private universe.

Finally, complexity creates its own risk.

A three-layer model can be wrong in several different ways. A bad final projection might come from predicting the wrong number of plays, allocating those plays to the wrong players, estimating player efficiency badly, or some combination of all three.

If Sightline validates only the final stat prediction, it may know that the model is wrong without knowing why.

Pitch 8 therefore needs to make the model both more realistic and more diagnosable.

## Solution Shape

### The football process becomes the model

Sightline models player production as the result of several related stages rather than directly guessing the final stat line from recent results.

The high-level shape is:

**game environment → player usage → player efficiency → simulated game outcomes → player distributions**

The exact features, algorithms, training procedure, model parameters, and implementation contracts belong in the design document.

This pitch defines what each layer is responsible for and what the resulting product must be able to demonstrate.

### Game environment

The first layer estimates the overall opportunity available in the game.

Conceptually, this answers questions such as:

* How many offensive plays are likely?
* How much passing and rushing opportunity should exist?
* What kind of game environment should the players be operating inside?

The model can use the point-in-time contextual information already available through Sightline's historical corpus, including relevant schedule and situational information.

This layer establishes the total opportunity that downstream player usage must divide.

It should not independently generate final player stat lines.

### Usage allocation

The second layer estimates how the available opportunity is distributed among players.

This is the layer that lets Sightline reason about roles rather than simply projecting everyone from his recent box scores.

For example, if a player's expected role increases, his share of the team opportunity can increase while another player's share falls.

The important property is that usage is allocated within the context of the team and game rather than generated independently for each player.

This allows player projections within the same offense to interact naturally.

When one player receives more opportunity, that opportunity must come from somewhere.

This is the foundation for later handling of absences and redistribution without manually narrating a projection adjustment on top of an otherwise unchanged model.

### Efficiency

The third layer estimates what each player is likely to produce from the opportunities allocated to him.

Usage and efficiency remain separate concepts.

A player can receive a large share of opportunity while converting it inefficiently, or receive fewer opportunities while producing efficiently.

Keeping these concepts separate makes the model more diagnosable and allows its drivers to explain whether a projection is high because Sightline expects more opportunity, stronger conversion, a favorable game environment, or some combination.

### Game-level simulation

The layers feed a game simulation that produces the participating players' outcomes together.

Sightline runs many possible versions of the game rather than calculating only one expected stat line.

Each simulated game represents one plausible outcome given the information available before kickoff.

Across those simulations, Sightline obtains the full range of outcomes for each player and relationships among players in the same game.

The Architecture Doc's vectorized-simulation approach remains the governing technical decision.

The simulation must operate across runs efficiently enough that normal production inference remains fast.

### Full probability distributions

Sightline continues to store a distribution rather than only a point estimate.

For continuous statistics such as yardage, the stored result is a compact distribution representation.

For naturally low-count statistics such as touchdowns, the representation preserves explicit outcome probabilities appropriate to that kind of statistic.

The product does not persist thousands of raw simulated outcomes simply because they existed during computation.

It keeps the compact representation necessary for future threshold queries.

That means Kalshi can list a new threshold after the model has already run and Sightline can calculate:

**P(player ≥ new threshold)**

without re-simulating the game merely because the market chose a different number.

### Joint player outcomes

The simulation also preserves enough information for relationships among players within the same game to be derived.

Sightline should be able to recognize, for example, that two player contracts may behave as highly related exposures.

This does not remove the hard per-game exposure cap established in Pitch 7.

The cap remains a safety boundary even after the model becomes smarter.

The Simulation Engine simply gives the staking system better information about what sits underneath that cap.

### Projection value

The existing slate continues presenting the approved projected-value estimator established by the cleanup work.

The user does not suddenly receive several competing "official projections" merely because the simulation internally contains a richer distribution.

The full distribution remains available for probability calculations, expected ranges, confidence, and inspection.

### Confidence

The existing Projection Engine requirement remains intact: every projection carries a confidence value.

The Simulation Engine's confidence should reflect the uncertainty visible in its distribution and the amount and relevance of historical evidence supporting the player's current role.

A rookie, a player in a dramatically changed role, or a player with little comparable history should not receive false precision merely because Monte Carlo generated ten thousand numerical outcomes.

Simulation volume is not evidence volume.

### Drivers

Projection drivers are produced from the model's actual structure.

Sightline should be able to explain, in readable language, the major reasons a projection moved or differs from the obvious baseline.

Those drivers can arise from concepts such as:

* Expected game volume.
* Expected player usage.
* Expected efficiency.
* Relevant situational context.
* Material differences from the player's recent role.

The exact driver-generation technique belongs to design.

The product requirement is that the explanation reflects what the model actually did.

Sightline must not invent a persuasive-sounding story after producing the number.

### Existing user surfaces remain intact

Pitch 8 does not create a separate "simulation app."

The new engine replaces the active model beneath existing capabilities.

The following surfaces continue behaving as the user already understands them:

* Slate.
* Contract detail.
* Edge Calculation and Recommendation.
* Accuracy and Calibration Surface.
* Position Sizing.
* Dry Run.
* Autonomous paper trading.
* Paper-performance review.
* Risk-mode comparison.

The difference is that their underlying projections come from the Simulation Engine once it has passed validation and activation.

### Baseline remains permanent

The Pitch 2 baseline is not deleted.

It remains a permanent comparator.

Sightline must continue answering:

> Did the more complicated model actually improve on the simple one?

The Simulation Engine earns its place through measured performance rather than architecture diagrams containing more boxes.

Backtesting compares the simulation with the Pitch 2 baseline by stat type and season, using the same point-in-time discipline already established by the Backtesting Harness.

### Per-layer validation

The model is not accepted based only on final player-stat error.

The layers are evaluated independently enough to determine where error originates.

At minimum:

* Predicted game/play volume is evaluated against observed game/play volume.
* Predicted usage allocation is evaluated against observed player usage.

The final player output is then evaluated for:

* Point-estimate error.
* Distribution quality.
* Calibration.
* Performance relative to the Pitch 2 baseline.

This gives Sightline a diagnostic path when final projections disappoint.

Instead of learning merely:

> receiving yards are bad,

the product-development process can identify whether the problem is:

> the game-volume layer predicts too many opportunities,

or:

> opportunity is correct but allocated to the wrong players,

or:

> usage is reasonable but the efficiency estimate is too optimistic.

### Historical backtest

Before the Simulation Engine becomes the active V1 projection model, it runs through the existing chronological Backtesting Harness.

The test continues to obey Sightline's point-in-time rules:

* A historical prediction may use only information known before the game.
* Future injury, roster, result, weather, or season information cannot leak backward.
* Reconstructed historical availability timestamps retain their documented limitations.
* Results remain reproducible from stored configuration and code version.

The resulting analysis demonstrates performance per stat type and season.

Existing weather-era distinctions remain available so results produced with historical reanalysis are not quietly treated as identical to the more reliable archived-forecast era.

### Kalshi remains outside the model

Kalshi prices remain the opponent, not an input.

No Simulation Engine layer may use:

* Current Kalshi price.
* Historical Kalshi price.
* Kalshi price movement.
* Market-implied injury information.
* Recommendation status.
* Sightline edge.

The model must generate its football probability independently.

Only afterward does the application compare that probability against Kalshi.

Otherwise Sightline could become better at predicting the market by copying the market and then congratulate itself for beating the thing it secretly used as an answer key. A majestic achievement in circular reasoning.

### Reproducibility

Simulation is seeded.

Running the model again with the same inputs, same model version, same information cutoff, and same seed produces the same result.

That applies both to production projections and historical evaluation.

Randomness is part of the simulated football world, not permission for Sightline's stored probability to drift because someone reran the command.

### Performance

Production simulation remains outside the user request path.

The target behavior from the approved roadmap and Architecture Doc remains:

* A full slate recompute completes **well under one minute**.
* A single-game recompute completes in **seconds**.

The slate never waits for a simulation.

Users continue seeing the latest completed stored projection while a newer run is processing.

### Model activation and Pitch 7 integration

Under the revised launch sequence, the intended Week 1 autonomous paper campaign does not start on the temporary baseline and later swap models.

The V1 sequence is now:

1. Build the Simulation Engine.
2. Run its historical validation.
3. Establish its calibration record.
4. Update the existing Probability Recalibration fit for the new model version without confusing model improvement with calibration correction.
5. Make the Simulation Engine the intended active V1 model.
6. Run a fresh Pitch 7 Dry Run using that exact model and risk configuration.
7. Inspect the resulting slate allocation and simulated fills.
8. Enable autonomous paper trading only after that final Dry Run passes.

This means the Week 1 paper record reflects the V1 system William may eventually consider funding.

Future material Simulation Engine changes follow the same principle: a new model version does not silently take over an already-running autonomous strategy without a new Dry Run.

## In Scope

* **Projection Engine** — second implementation using game environment, usage allocation, player efficiency, and game-level simulation.
* Full probability distributions per supported player/stat/game.
* Joint player outcomes within each simulated game.
* Usage redistribution that arises from the model's structure.
* Compact persisted distributions suitable for arbitrary Kalshi thresholds.
* Confidence derived from distribution uncertainty and relevant evidence.
* Human-readable Projection Drivers grounded in the model's actual structure.
* Game-environment validation.
* Usage-allocation validation.
* End-to-end calibration validation.
* End-to-end point-estimate validation.
* Comparison against the permanent Pitch 2 baseline.
* Historical Backtesting Harness integration.
* Per-stat-type and per-season analysis.
* Existing weather-era backtest distinction.
* Seeded reproducibility.
* Production full-slate and single-game performance requirements.
* Existing slate, recommendation, sizing, paper-trading, and accuracy surfaces consuming the new model.
* New model-version calibration handoff into the existing Probability Recalibration feature.
* Required fresh Dry Run before the initial V1 autonomous paper campaign.
* Required fresh Dry Run after future material model changes before autonomous operation resumes.

## Out of Scope / Boundaries

* **Adjustment Suggestions** are excluded.
* ESPN inactives as a suggestion source are excluded.
* Suggestion acceptance and decline controls are excluded.
* Suggestion Reliability Analytics are excluded.
* The model may use structured information already available to the projection path, but Pitch 8 does not build a new late-news ingestion product.
* Real Kalshi order placement is excluded.
* Kalshi fills and live reconciliation are excluded.
* The bankroll and Position Sizing system are not redesigned in this pitch.
* Risk modes are not redesigned.
* The Kelly fraction does not become adaptive.
* The probability ceiling is not automatically raised because the model is more sophisticated.
* Hard game and slate exposure caps remain in force.
* Probability Recalibration remains a separate feature; this pitch supplies the model-specific evidence needed to refit it.
* Market prices never become prediction features.
* No in-game projection model is introduced.
* No live in-game trading is introduced.
* No sportsbook or DFS information enters the model.
* No film, tape, computer-vision, or manually charted film features are introduced.
* The pitch does not create a general football-analysis dashboard.
* The pitch does not create controls that let William manually tune modelling parameters from the app.
* The web app does not trigger full backtests.
* Raw simulation draws are not persisted indefinitely.
* A new stat type is not required as part of this pitch solely to prove extensibility.
* The existing baseline model is not deleted.
* Historical baseline results are not rewritten to make the Simulation Engine appear comparatively stronger.
* Existing live/paper projection history is not silently backfilled as though the new model produced those predictions at the time.

## Definition of Done

* The active Simulation Engine produces a probability distribution for every supported player/stat/game it can defensibly project.
* The probability of clearing an arbitrary supported threshold is derivable from the stored distribution without re-running the simulation.
* Continuous statistics are retained in the approved compact distribution form rather than as thousands of raw draws.
* Low-count discrete statistics retain an appropriate explicit probability representation.
* The simulation produces player outcomes jointly within each game.
* Relationships among player outcomes within the same game are derivable from the simulated output.
* The Simulation Engine models game environment separately from player usage.
* Player usage is allocated within team/game context rather than independently generating unlimited opportunity for every player.
* Player efficiency is represented separately from player usage.
* A material change to a player's expected role can change usage without requiring a hand-authored final-stat override.
* A material usage increase for one player can interact with the opportunity available to teammates rather than pretending every player's opportunity increases independently.
* Every projection continues carrying `computed_at`.
* Every projection continues carrying `information_cutoff`.
* Every projection continues carrying `model_version`.
* Every projection continues carrying confidence.
* Every projection continues exposing human-readable drivers.
* Drivers reflect actual model structure rather than generated post-hoc narration disconnected from the calculation.
* A player with little relevant history produces appropriately high uncertainty or an explicit inability to project rather than a confident fabricated number.
* The model remains capable of representing low-base-rate outcomes dominated by zero.
* Extreme or historically unusual game context produces uncertainty rather than artificial confidence.
* Kalshi prices are not read by any Simulation Engine layer.
* Kalshi price movement is not used as an indirect injury or player-status feature.
* The simulation is seeded.
* Re-running against identical inputs, information cutoff, model version, and seed reproduces the same output.
* Adding a later stat type does not require redesigning the fundamental simulation structure.
* Predicted game/play volume is validated separately from final player results.
* Predicted player usage is validated separately from final player results.
* The backtest can identify whether major model error originates primarily from game volume, usage, efficiency, or final-distribution behavior rather than producing only one opaque aggregate score.
* The Simulation Engine is run chronologically through the existing Backtesting Harness using only information available before each historical game.
* Historical backtesting preserves the point-in-time protections established by Pitch 1.
* Backtest results include calibration for the Simulation Engine.
* Backtest results include point-estimate error for the Simulation Engine.
* Backtest results compare the Simulation Engine against the Pitch 2 baseline.
* Comparisons are available by stat type.
* Comparisons are available by season.
* Existing weather-era reporting remains available where relevant.
* The baseline remains accessible as a permanent comparator after the Simulation Engine becomes active.
* The new model is assigned a distinct model version rather than overwriting baseline identity.
* Historical production projections created by the baseline remain attributable to the baseline.
* Model-version change and Probability Recalibration change remain analytically distinguishable.
* The existing recalibration process can be refitted against the Simulation Engine's stored calibration evidence before the model is used for autonomous staking.
* A full production slate recompute completes well under one minute under the approved production workload.
* A single-game recompute completes in seconds.
* The application never waits for simulation completion before rendering the current slate.
* Existing slate and contract-detail surfaces can consume Simulation Engine projections without a parallel replacement interface.
* Existing Edge Calculation and Recommendation can consume Simulation Engine threshold probabilities.
* Existing Accuracy and Calibration Surface can distinguish the Simulation Engine's results from historical baseline performance.
* Existing Position Sizing can consume the properly recalibrated probabilities originating from the Simulation Engine.
* A fresh Dry Run using the completed Simulation Engine occurs before the intended Week 1 autonomous paper campaign begins.
* Autonomous paper operation is not resumed after a future material model-version change until the required fresh Dry Run has been completed.

## Rabbit Holes

* **Making the model complicated instead of better.** Three predictive layers and Monte Carlo can produce a sophisticated explanation for worse probabilities. The baseline comparison prevents complexity from receiving participation trophies.
* **Error compounding across layers.** Slightly excessive play volume plus slightly excessive target share plus slightly optimistic efficiency can create a dramatically overconfident final distribution.
* **Validating only the final result.** Without layer-level evaluation, model improvement turns into guessing which internal layer caused a regression.
* **Usage totals that do not make football sense.** Independently predicted player usage can accidentally allocate more opportunity than the team has.
* **Role changes with little history.** The most valuable market situations may also be the least historically supported.
* **Rookies and backups.** The model must broaden uncertainty rather than treating weak evidence as precise because enough simulations were generated.
* **Confusing simulation count with confidence.** Ten thousand draws from a bad assumption produce a precisely simulated bad assumption.
* **Correlation being available but ignored.** Once joint outcomes exist, same-game portfolio decisions have information they previously lacked.
* **Removing hard exposure caps because correlation is modelled.** The joint model improves risk information but does not eliminate model risk.
* **Low-count outcomes.** Touchdowns and similar statistics need distributions that respect their large zero mass rather than being treated like yardage.
* **Tail behavior.** Sizing is especially sensitive to probability error near the high end, so a model that improves average error while remaining overconfident in the tails may still be dangerous.
* **Weather-era leakage.** Older reanalysis weather remains a known historical limitation and cannot suddenly become cleaner because the Simulation Engine uses it more effectively.
* **Reconstructed historical knowledge.** Injury and role information without precise publication timestamps remains vulnerable to temporal leakage.
* **Season-level features.** Any full-season statistic accidentally used before the season ended can make the backtest beautifully fraudulent.
* **Roster leakage.** Current player/team state cannot be joined backward into historical games.
* **Stat corrections.** Final corrected results may be correct grading truth without having been information available before the historical game.
* **Model-version contamination.** New Simulation Engine results must not overwrite or blend invisibly with baseline production history.
* **Recalibration hiding model weakness.** A strong correction layer should not be used to claim that the underlying Simulation Engine is well calibrated when it is not.
* **Model improvement and correction improvement changing simultaneously.** Those effects need to remain distinguishable.
* **Driver theater.** Human-readable explanations must come from model structure rather than being generated because the interface has a box labeled "Why."
* **Persisting raw draws.** Storing every simulation result would dramatically increase data without improving the user experience the architecture calls for.
* **Premature optimization.** Production simulation must be fast, but replacing clear vectorized numerical work with exotic distributed infrastructure would violate the product's actual scale.
* **Non-vectorized loops.** A conceptually correct simulation implemented as Python iteration across every run can turn an acceptable production and backtest workload into an unnecessarily slow one.
* **Research scope explosion.** Game environment, usage, and efficiency can each support years of modelling research. Pitch 8 needs a validated V1, not tenure.
* **Chasing backtest results.** Repeatedly altering the model until it looks excellent on the same historical periods can turn the backtest into training by another name.
* **One stat type dominating optimization.** Improvements in passing yards should not conceal regressions in receiving, rushing, or low-count markets.
* **Assuming better point estimates mean better probabilities.** Sightline ultimately trades threshold probabilities, so calibration and distribution quality matter independently from mean/median error.
* **Automatically trusting the new model because it is "the real model."** Promotion should depend on actual validation evidence.
* **Starting Week 1 paper trading before final model validation.** Under the revised launch plan, the paper record should represent the intended V1 projection system rather than an interim model.
* **Skipping the final Dry Run because the staking system itself did not change.** New probabilities can radically change which positions Pitch 7 chooses and how much it sizes.

## No-Gos

* Do not feed Kalshi prices into the model.
* Do not infer injuries from Kalshi price movement.
* Do not use recommendation status as a model feature.
* Do not use paper-trading results directly as a training target.
* Do not remove the Pitch 2 baseline.
* Do not overwrite historical baseline projections with Simulation Engine output.
* Do not silently combine model versions in validation.
* Do not declare the Simulation Engine better based only on model complexity.
* Do not judge success from point-estimate error alone.
* Do not judge success from one aggregate stat category alone.
* Do not skip per-layer validation.
* Do not let simulated usage exceed coherent team opportunity merely because component predictions were generated independently.
* Do not represent a rookie or unprecedented role with artificial confidence.
* Do not treat more Monte Carlo runs as a substitute for better evidence.
* Do not persist raw simulation draws indefinitely.
* Do not block slate rendering on model computation.
* Do not run full historical backtests from the user interface.
* Do not introduce distributed compute merely because the feature is called a Simulation Engine.
* Do not replace the established Python modelling runtime with TypeScript.
* Do not add a second source of schema migrations from Python.
* Do not bypass the point-in-time query discipline in the interest of backtest speed.
* Do not use post-game information in historical feature generation.
* Do not erase weather-era distinctions.
* Do not build Adjustment Suggestions in this pitch.
* Do not build ESPN source-reliability logic in this pitch.
* Do not place real Kalshi orders.
* Do not change the Kelly fraction automatically based on Simulation Engine results.
* Do not remove the Pitch 7 probability ceiling solely because the model is more sophisticated.
* Do not remove game/slate exposure caps solely because joint distributions now exist.
* Do not enable autonomous paper trading with the new model before its required final Dry Run.
* Do not make future model upgrades silently take over an active autonomous system.
* Do not expand the pitch into open-ended model research if a bounded V1 layer satisfies the acceptance criteria.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** — provides the historical NFL corpus, bitemporal information model, as-of discipline, player identity, context, and leakage protections required for honest feature generation and backtesting.
* **Pitch 2: Backtest Harness & Baseline Model** — provides the permanent baseline, historical evaluation framework, reproducibility conventions, and comparison target that the Simulation Engine must beat or meaningfully improve upon.
* **Pitch 4: Kalshi Sync, The Slate & Decision Log** — existing slate and contract-detail surfaces consume the resulting distributions, probabilities, confidence, and drivers.
* **Pitch 5: Live Pipeline & Staleness** — supplies the production recompute path and current information cutoffs through which the new model operates during the season.
* **Pitch 6: Outcome Scoring & Accuracy Surface** — supplies the existing measurement surfaces into which Simulation Engine results are graded and compared.
* **Pitch 7: Bankroll, Sizing & Autonomous Paper Trading** — consumes the Simulation Engine's probabilities after the approved Probability Recalibration layer and must run a fresh Dry Run before the initial V1 paper campaign.
* The cleaned historical corpus and performance improvements from the cleanup work must remain available.
* Existing point-estimate policy remains authoritative rather than being re-decided here.
* The stored calibration infrastructure must support a distinct fit for the new model version.
* Production Python execution must support the approved vectorized workload.
* The intended Week 1 autonomous paper campaign depends on Pitch 8 completing historical validation and the final Pitch 7 Dry Run.

## Open Questions

These are the remaining choices that affect what **you** would actually see or how Sightline would actually use the model.

### 1. What if the new model is better for some bets but worse for others?

Imagine the Simulation Engine is clearly better for passing and receiving yards, but the simple baseline is still better at touchdowns.

You have two practical choices:

* **Use the new model everywhere** because it is the official V1 model.
* **Use whichever model has proven better for each stat type**, so passing might use Simulation while touchdowns temporarily stay on the baseline.

**Effect on you:** this determines whether Sightline always uses one consistent model or is allowed to keep the simpler model where it still appears more profitable/accurate.

**Recommendation:** use the best validated model by stat type. Do not force the sophisticated model onto a market where the baseline still proves better. Keep the active model clearly identified so you know what generated each probability.

### 2. Now that Sightline understands bets in the same game are related, should the bot use that when deciding stakes?

Before this pitch, Sightline mainly protects you with a hard per-game cap.

After this pitch it can know, for example, that a quarterback-yardage bet and one of his receiver-yardage bets may effectively be two versions of the same football bet.

**Effect on you:** without using that information, the bot might technically stay under its game limit while still placing too much money on one underlying game script.

**Recommendation:** yes. Let Pitch 7 use the Simulation Engine's joint outcomes to reduce or reprioritize heavily correlated positions, while **keeping the hard per-game cap anyway** as a second safety layer.

### 3. After we upgrade the model, how should the Accuracy page show its record?

Suppose the baseline had months of results and then the Simulation Engine starts.

Should your headline accuracy numbers:

* Mix everything together into one lifetime Sightline result, or
* Clearly separate **Baseline** performance from **Simulation Engine** performance?

**Effect on you:** mixing them gives you a bigger sample but can hide whether the model currently making your bets is actually good.

**Recommendation:** keep them separate by model version, with an optional overall "Sightline lifetime" view. When deciding whether to risk real money, emphasize the model currently being used, supported by its historical backtest and current live record.

### 4. What should Sightline do when it technically can make a projection but barely has enough evidence?

Example: a rookie, backup suddenly becoming a starter, or someone entering a role with almost no useful history.

Would you rather Sightline:

* Still show the projection but make it very clear that confidence is extremely low, or
* Refuse to recommend/trade that player until enough evidence exists?

**Effect on you:** the first option gives you more opportunities but includes shakier bets. The second means passing on potentially valuable situations exactly when the market might also be uncertain.

**Recommendation:** still show the projection and its wide uncertainty, but allow the existing confidence/risk system to drive the stake toward zero. For situations below a defensible minimum evidence level, decline to size a position entirely rather than pretending there is useful precision.
