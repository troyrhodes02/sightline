# Sightline — Pitch: Bankroll, Sizing & Autonomous Paper Trading

> Pulled verbatim from Linear (project **Sightline V1**), document
> `sightline-pitch-bankroll-sizing-and-autonomous-paper-trading-9aacac36b1b1`,
> as of 2026-09-07. This file is the pipeline's frozen copy of the approved
> pitch; the Linear document remains the source of record.

## Summary

This pitch turns Sightline into an autonomous paper-trading system.

William chooses a fake starting bankroll and a risk mode, then Sightline independently evaluates current Kalshi opportunities, corrects model probabilities for measured calibration error, decides how much simulated money to risk, realistically simulates what could have filled, maintains the paper bankroll, stops itself when safety limits are breached, and records enough information to explain every action afterward.

Paper mode is designed to answer a practical question: **if this had been real money and Sightline had been left alone, what realistically would have happened?**

The paper system therefore follows the same decision and safety path intended for eventual live operation. Fake capital is the principal difference. It does not receive flattering fills, unlimited liquidity, relaxed circuit breakers, or different staking logic merely because nothing real is being lost.

After each paper run and over time, William can review bankroll growth, realized profit, drawdown, simulated withdrawals, breaker activity, and how Conservative, Moderate, and Aggressive risk settings would each have performed against the same historical opportunities.

Sightline may eventually determine that the system has satisfied the requirements for live trading, but it can **never move itself from fake money to real money**. That transition always requires an explicit human decision from William.

## Type & Appetite

* **Type:** Feature
* **Appetite:** L — This combines the former Bankroll, Sizing & Paper Trading and Autonomous Execution & Circuit Breakers pitches into one complete user capability. It spans recalibration, bankroll state, risk configuration, portfolio allocation, realistic paper execution, safety controls, automated operation, performance review, and live-readiness evaluation.

The size is justified because these pieces are inseparable from the user's actual goal.

A sizing calculator without autonomous paper execution cannot establish whether the system can safely operate alone. Autonomous execution without realistic bankroll and sizing behavior tests the wrong thing. A paper account without realistic fills produces an encouraging fiction rather than evidence.

The pitch remains bounded by excluding the Simulation Engine itself and all real Kalshi order submission.

## Problem

By the end of Pitch 6, Sightline can identify Kalshi contracts where its probability differs from the market, maintain those projections, record decisions, grade outcomes, and show whether the model has historically been well calibrated.

That still leaves three questions unanswered:

1. **How much money should actually be risked on an opportunity?**
2. **Can the system make those decisions responsibly without William supervising it?**
3. **Would those decisions have produced worthwhile bankroll growth under realistic trading conditions?**

The first is more dangerous than simply calculating edge.

A model may believe an event is 80% likely while Kalshi prices it at 70%, but if Sightline is systematically overconfident in that probability range, an apparently excellent opportunity can produce an irresponsibly large stake. Kelly-family sizing magnifies probability errors, particularly at high market prices.

Raw model probability therefore cannot directly determine stake size.

Even a trustworthy probability cannot be sized independently from the rest of the slate. Several contracts within the same game may represent nearly the same underlying risk. A quarterback passing-yard contract and his receiver's receiving-yard contract are not independent simply because Kalshi lists them separately.

The second problem is operational.

The stated product goal is for Sightline eventually to operate without William manually reviewing every candidate. An autonomous system must know when not to trade: when projections are stale, prices are unavailable, the scheduler is late, exposure is already excessive, calibration has degraded, or bankroll losses have crossed a safety threshold.

The third problem is evidentiary.

A simplistic paper system that assumes every desired position fills at the displayed price can dramatically overstate performance, particularly in the thin markets where large apparent edges are most likely to appear.

Paper trading must therefore behave as realistically as the available market evidence permits. If a desired position would probably have filled only partially, Sightline should simulate only the realistic fill and reconsider how to allocate the unused bankroll elsewhere.

The purpose is not to produce the prettiest fake P&L chart.

The purpose is to establish whether William could responsibly trust the same system with actual capital.

## Solution Shape

### One autonomous decision path

Sightline operates one staking decision process.

For each upcoming game window, the system evaluates current resolvable Kalshi contracts using current projections and current market information.

The path is conceptually:

**current projection → corrected probability → executable market economics → opportunity ranking → stake sizing → exposure constraints → realistic fill → position → settlement → bankroll update**

Dry Run, autonomous paper trading, and later live execution use this same decision logic.

They differ in whether an actual ledger position is created and, later, whether the order is hypothetical or submitted to Kalshi.

The system does not maintain a "fake simplified paper strategy" and a separate "real strategy."

### Probability Recalibration

Before sizing sees a probability, the raw projection probability passes through **Probability Recalibration**.

The correction is fitted from the stored, verifiable contract-like backtest calibration record.

Live results begin contributing as they accumulate, but early results receive little weight. The backtest remains the dominant prior until enough live evidence exists for production outcomes to become meaningfully informative.

This gives Sightline the responsible middle ground:

* It does not completely ignore useful live evidence.
* It does not chase noise after a handful of games.
* Live influence grows gradually as the sample becomes credible.

Raw and corrected probabilities remain separately visible and historically preserved.

Sizing consumes only the corrected probability.

Market prices do not influence the correction itself.

### Probability ceiling

Sightline initially refuses to size any contract whose **corrected probability exceeds 0.75**.

This ceiling is a safety boundary against the model's known risk of top-end overconfidence.

The ceiling does not automatically rise when William changes from Conservative to Moderate or Aggressive mode.

It may be raised later only when calibration evidence demonstrates that Sightline is sufficiently reliable above the current boundary.

Risk mode controls **how much to risk on acceptable opportunities**. It does not redefine what probabilities Sightline considers trustworthy enough to stake.

### Opportunity priority

When available opportunities compete for limited bankroll or exposure capacity, Sightline prioritizes the opportunities with the strongest **risk-adjusted expected value**, not simply the highest probability of winning.

A 90% probability is not automatically attractive if the market requires paying a price that implies 95%.

Conversely, a lower-probability contract may be considerably more valuable if the executable price understates its corrected probability.

Priority therefore considers the relationship among:

* Corrected probability.
* Executable market price.
* Fees.
* Projection confidence.
* Expected edge.
* The amount of risk required to capture that edge.

The result should naturally favor opportunities combining substantial mispricing with strong confidence rather than either characteristic alone.

### Risk modes

William does not need to configure every individual risk parameter manually to begin paper trading.

Sightline provides four risk settings:

* **Conservative**
* **Moderate**
* **Aggressive**
* **Custom**

**Conservative is the default and the starting recommendation.**

The preset modes use the same projections, recalibration, candidate ranking, and execution logic. They differ only in the amount of bankroll risk Sightline is permitted to take, primarily through the Kelly fraction and exposure limits.

Changing risk mode does not make the model itself more optimistic.

It changes how aggressively the system acts on the same evidence.

The progression is deliberately intuitive:

**Conservative < Moderate < Aggressive**

William can move between them through the admin interface, while Custom exposes the underlying permitted configuration for deliberate tuning.

The probability ceiling remains an independent safety control.

### Initial drawdown posture

The starting safety posture is:

* **5% drawdown:** prominent warning.
* **10% drawdown in Conservative mode:** automatic trading halt.
* **15% drawdown in Moderate mode:** automatic trading halt.
* **20% drawdown in Aggressive mode:** automatic trading halt.

Drawdown is measured relative to the relevant bankroll high-water mark according to the approved bankroll definition.

These are initial operating defaults intended to be tested in paper mode, not claims that those percentages are mathematically optimal.

Aggressive mode remains bounded. It does not disable bankroll protection.

### Bankroll

William configures the paper account's starting balance.

For example, he might give Sightline a hypothetical $1,000 bankroll.

From that point forward, the autonomous system treats those fake funds as though they matter:

* Stakes consume available paper bankroll.
* Open positions count toward exposure.
* Settlements change the balance.
* Losses create drawdown.
* Profits increase the bankroll.
* High-water mark changes as the bankroll grows.
* Risk limits continue to apply to the evolving bankroll rather than the original starting amount.

The paper bankroll is reconstructible throughout its history.

William can see not just the current balance but how it got there.

### Paper and live remain separate

Paper and live accounting remain permanently separate.

A paper position never becomes a live position.

A paper bankroll never becomes the funded bankroll.

Paper P&L is never merged into live P&L.

Existing paper positions may continue settling after William later activates live mode, but they remain visibly and permanently paper positions.

Starting live operation does not require waiting for every paper position to settle as long as the interface and accounting keep the two modes unmistakably separate.

### Position sizing

For an eligible contract, Sightline calculates stake from:

* Corrected probability.
* Executable price.
* Trading fees.
* William's selected risk mode or Custom Kelly setting.
* Projection confidence.
* Current bankroll.
* Existing game exposure.
* Existing slate exposure.

Lower-confidence projections receive smaller stakes than otherwise equivalent high-confidence projections.

A contract whose apparent edge disappears after fees receives no stake.

Per-game and per-slate exposure caps always bind regardless of what Kelly sizing proposes.

Until the Simulation Engine supplies joint player outcomes, the per-game cap remains the conservative defense against heavily correlated positions.

### Joint slate allocation

Sightline does not independently calculate every contract's desired stake and assume all of them can be funded.

It considers the slate as a portfolio of competing opportunities.

If the available bankroll or an exposure cap means not every desirable position can receive its ideal stake, allocation favors the strongest risk-adjusted opportunities first.

This remains deterministic and explainable so William can later understand why one opportunity received money while another did not.

### Realistic paper execution

Paper mode should answer:

> What most likely would have happened if these had been real orders?

It therefore uses the same executable market economics intended for live trading, including fees and available liquidity information.

It does **not** assume that every desired position fills completely at the best visible price.

Where market conditions imply a realistic partial fill, Sightline records the smaller simulated position.

Where a desired position realistically could not fill, the paper system can record no fill.

The fill assumptions should be conservative rather than favorable.

This is particularly important because thin markets may simultaneously produce the largest apparent model edge and the poorest available liquidity.

### Reallocate after partial fills

A partial fill changes the remaining bankroll and exposure state.

Sightline therefore reassesses the remaining slate rather than simply leaving unused capital idle or blindly trying to complete the original order.

Example:

* Sightline wants $50 of simulated exposure on Contract A.
* Realistic paper-fill logic indicates only $20 could fill.
* The remaining $30 becomes available again.
* Sightline reevaluates whether adding more later to Contract A or allocating some or all of that capacity to Contract B now produces the stronger portfolio.

Any additional exposure is calculated from the **current total position**.

The system never accidentally applies the original full stake again and doubles its intended position.

### Never accidentally duplicate a position

An autonomous execution retry, duplicated scheduled run, or repeated request cannot recreate the same intended exposure accidentally.

If the system already holds the intended amount, repeating the cycle creates no second position.

There is one legitimate reason to add to an existing position:

**new information changes the desired total exposure.**

If Sightline previously wanted $20 and later concludes the appropriate total position is $30, it may consider adding only the incremental $10.

It does not run the $30 instruction again and turn the position into $50.

### Dry Run

Before autonomous paper trading begins, William performs a **Dry Run**.

Dry Run executes the same opportunity selection, recalibration, sizing, exposure, breaker, and realistic-fill logic the paper bot would use.

It displays what the bot intends to do without creating any position or altering any ledger.

William can inspect:

* Which contracts it selected.
* Corrected probabilities.
* Market prices.
* Intended stakes.
* Expected realistic fills.
* Exposure concentrations.
* Which limits changed or rejected positions.

Dry Run remains useful later whenever the operating assumptions materially change.

For the initial V1 launch, the plan is to have the Simulation Engine completed before Week 1 paper trading begins. Therefore the first real autonomous paper run should use the finished V1 model rather than starting on the baseline and swapping models during an active paper campaign.

A fresh Dry Run is required after the Simulation Engine is connected and before Week 1 autonomous paper trading begins.

Future material model changes also require a new Dry Run before autonomy resumes.

### Autonomous Paper Trading

Once the system passes the dry-run inspection, William can enable autonomous paper trading.

Sightline then operates before each relevant kickoff window without requiring William to approve every position.

For every cycle it:

 1. Reads the current eligible projections.
 2. Refuses stale projections.
 3. Reads current Kalshi market conditions.
 4. Applies Probability Recalibration.
 5. Excludes contracts above the probability ceiling.
 6. Calculates net edge after fees.
 7. Ranks opportunities by risk-adjusted expected value.
 8. Sizes according to the active risk mode.
 9. Applies game and slate exposure limits.
10. Simulates realistic fills.
11. Reassesses remaining opportunities after partial fills.
12. Writes simulated positions to the paper ledger.
13. Later settles those positions against Kalshi settlement.
14. Updates bankroll, exposure, P&L, high-water mark, withdrawals, and breaker state.

A cycle taking no positions is a successful cycle.

The bot is not expected to manufacture action because Sunday feels more entertaining that way.

### Ten-minute hard cutoff

Autonomous execution will not create a new position inside **10 minutes of scheduled kickoff**.

If the scheduling system runs late and the cycle reaches that boundary, Sightline skips rather than rushing through orders.

The cutoff applies regardless of selected risk mode.

Aggressive means accepting more controlled bankroll risk. It does not mean ignoring timing safeguards.

### Circuit breakers

Autonomous trading can stop itself for:

* Excessive bankroll drawdown.
* Deteriorating calibration.
* Excessive open exposure.
* The kill switch.

Breaker trips are recorded and surfaced prominently.

Existing open positions continue settling normally.

If a breaker trips halfway through an autonomous cycle:

* Positions legitimately created before the trip remain.
* No further blocked positions are created.
* Remaining candidates are recorded as blocked by the breaker.

The entire cycle is not retroactively erased.

### Manual resume and Force Override

A normal breaker never resumes automatically.

William must take action.

Sightline provides two different concepts:

**Resume**
Used after the condition that caused the breaker has cleared.

**Force Override**
Allows William, as the admin, to deliberately resume operation even when the triggering condition still exists.

Force Override must be visually and behaviorally distinct from ordinary Resume.

Before completing the override, Sightline clearly presents:

* Which safety condition remains breached.
* The current measured value.
* The configured safety threshold.
* That autonomous trading will resume despite the active warning.

The action requires explicit confirmation.

The override itself is recorded with the condition and time.

A force override does not permanently disable the breaker.

The breaker remains active for future evaluation rather than becoming a hidden "ignore this forever" setting.

### Kill switch

William always retains one immediate control that halts autonomous trading.

The kill switch has no confirmation flow.

Its purpose is to stop first and ask questions later.

It prevents new autonomous positions but does not delete or corrupt existing positions.

### Simulated withdrawals

The withdrawal behavior intentionally differs between paper and real money.

In **paper mode**, Sightline automatically performs a simulated withdrawal when the configured working-bankroll rule is satisfied.

The fake amount is removed from the active paper bankroll and recorded separately as **simulated withdrawn profit**.

This allows the paper system to model a real operating strategy in which profits are periodically removed rather than endlessly compounding every dollar.

William can therefore review:

* Active bankroll.
* Cumulative simulated withdrawals.
* Combined paper wealth.
* Net profit.
* Maximum drawdown.
* Withdrawal history.

This answers a more useful question than ending balance alone:

> If this had actually been real money, approximately how much would have remained working in the strategy and how much would have been swept back out?

In **live mode**, Sightline never moves real money out of the Kalshi account autonomously.

It may recommend a withdrawal, but William performs the actual transfer.

### Paper performance review

William can review autonomous paper performance after each game window, week, or broader period.

The review emphasizes both return and risk.

At minimum, the experience communicates:

* Starting bankroll.
* Ending active bankroll.
* Realized paper P&L.
* Cumulative simulated withdrawals.
* Total simulated wealth.
* Maximum drawdown.
* Positions taken.
* Partial and unfilled simulated orders.
* Exposure levels.
* Breaker events.
* Force overrides.
* Risk mode used.
* Calibration and model-quality context supplied by Pitch 6.

Paper profit is important because William intends to use real capital only if the bot demonstrates that it can produce worthwhile results.

It is not treated as the only evidence that the model has an actual edge.

### Risk-mode counterfactual replay

Sightline retains the information necessary to answer a second question after a paper period:

> What would have happened if I had used a different risk mode?

After a paper run using Conservative, for example, William can compare the same historical period under:

* Conservative.
* Moderate.
* Aggressive.

Each replay uses the same information available at the original decision times:

* Same model projections.
* Same corrected probabilities appropriate to that historical state.
* Same observed Kalshi market conditions.
* Same realistic paper-fill policy.
* Same selected starting-bankroll basis.
* Same settlement outcomes.

Only the risk configuration changes.

The comparison can show outcomes such as:

* Ending active bankroll.
* Simulated withdrawals.
* Total net profit.
* Maximum drawdown.
* Number of positions.
* Exposure.
* Breaker activity.

These comparisons are saved over time so William can evaluate whether another mode is consistently improving outcomes rather than changing risk settings because of one unusually profitable weekend.

This is decision support.

Sightline does **not** automatically change the live or paper risk mode because a counterfactual replay performed better.

William remains responsible for changing risk mode.

### Live Readiness

Sightline evaluates whether the system has accumulated enough evidence to be considered **eligible for live trading**.

For William, one required condition is now explicit:

**At least two complete NFL weeks of autonomous paper trading must have produced positive cumulative net paper P&L after realistic fill assumptions and fees.**

A profitable two-week paper period is necessary but not sufficient.

The readiness view also considers the stronger model and safety evidence already established elsewhere in the product:

* Model calibration remains acceptable.
* Brier performance remains healthy.
* Performance relative to Kalshi remains acceptable on the relevant comparable population.
* The model continues to satisfy the approved baseline requirements.
* Drawdown remains within acceptable bounds.
* The paper system has not demonstrated unresolved operational failures.
* Sizing and exposure behavior has remained responsible.
* Circuit breakers have behaved as expected.

This lets William see both:

**Did the bot actually make simulated money?**

and

**Is there evidence that the result came from a functioning probabilistic system rather than one lucky two-week stretch?**

Sightline can then display a state such as:

* **Not Ready**
* **Paper Evidence Building**
* **Eligible for Live Trading**

The exact copy belongs to design.

### Human control over real money

Passing the live-readiness gate never activates real trading.

Sightline can report that the requirements have been satisfied.

It can recommend that William review live activation.

It can show which requirements passed.

It can never decide on its own to move from paper money to real money.

The transition requires an explicit action from William.

Real order submission itself remains in the later **Kalshi Trading** pitch.

This is a permanent safety principle:

**Sightline may autonomously manage an already-authorized mode, but Sightline may never authorize itself to begin risking real money.**

## In Scope

* **Probability Recalibration** — Correct raw model probabilities using stored calibration evidence before any probability reaches Position Sizing.
* **Bankroll & Ledger** — Maintain configurable and reconstructible paper/live bankroll histories with open exposure, high-water marks, P&L, and strict mode separation.
* **Position Sizing** — Determine explainable stakes from corrected probability, executable price, fees, confidence, bankroll, and hard exposure limits.
* **Dry Run** — Run the autonomous decision path without creating a position or changing a ledger.
* **Autonomous Execution** — Operate the complete staking cycle automatically against the paper ledger before each game window.
* **Circuit Breakers & Withdrawal** — Halt unsafe autonomous operation, provide kill and override controls, and exercise bankroll-withdrawal policy.

Also included as approved extensions of those features:

* Conservative, Moderate, Aggressive, and Custom risk modes.
* Conservative as the default starting mode.
* Initial 5% drawdown warning.
* Initial 10% / 15% / 20% hard drawdown levels for Conservative / Moderate / Aggressive.
* Risk-adjusted opportunity priority.
* Conservative realistic paper fills.
* Partial paper fills.
* Reallocation after partial fills.
* Duplicate-position prevention.
* Incremental additions only when newly desired total exposure increases.
* Ten-minute hard pre-kickoff cutoff.
* Explicit breaker Force Override.
* Automatic simulated withdrawals in paper mode.
* Paper performance review.
* Saved counterfactual risk-mode replay.
* At least two complete profitable NFL paper weeks as a required live-readiness criterion.
* Human-only activation of real-money mode.

## Out of Scope / Boundaries

* **Simulation Engine** is not built in this pitch. It is the next model pitch.
* The initial Week 1 paper campaign will nevertheless wait until the Simulation Engine is finished and a new Dry Run using that model has passed.
* Real Kalshi order placement is excluded.
* Real fills, partial fills, rejections, and reconciliation are owned by **Kalshi Trading**.
* Passing Live Readiness does not itself enable funded execution.
* Sightline never autonomously changes from paper to live.
* Sightline never autonomously withdraws real funds.
* Adjustment Suggestions and source-reliability analytics remain later work.
* Risk modes do not alter the Projection Engine.
* Risk modes do not alter Probability Recalibration.
* Risk modes do not raise the probability ceiling automatically.
* Risk modes do not change what constitutes stale data.
* Aggressive mode does not disable exposure caps, timing cutoffs, or circuit breakers.
* Counterfactual risk replay does not refit the model using future outcomes.
* Counterfactual replay does not change the historical projections that were actually available at the time.
* The system does not automatically switch risk modes based on what a replay says would have made more money.
* Paper trading does not assume infinite liquidity.
* Paper trading does not assume every desired order fills.
* Paper trading does not receive more favorable prices than would plausibly have been executable.
* The system does not use paper win rate alone to decide that the model is trustworthy.
* No viewer can see bankroll, positions, risk settings, simulated withdrawals, breaker state, or private paper-performance analytics.
* Viewers do not receive their own autonomous bankrolls.
* No sportsbook or DFS support is introduced.
* No live in-game trading is introduced.
* No generalized portfolio-management product is introduced.
* No automated bankroll funding or bank-account connection is introduced.
* No generalized exchange abstraction is introduced merely to anticipate venues outside Kalshi.

## Definition of Done

### Probability Recalibration

* Recalibration is fitted from the stored, verifiable contract-like backtest calibration record.
* Raw and corrected probabilities remain separately available.
* Sizing uses corrected probability only.
* Market price never enters the recalibration calculation.
* Early live results have limited influence through shrinkage toward the backtest prior.
* Insufficient live evidence falls back toward the established prior rather than producing an unstable correction.
* Historical corrected probabilities are not silently rewritten when recalibration changes.
* The active correction is versioned.
* Recalibration and model-version changes remain distinguishable.

### Risk Modes

* William can choose Conservative, Moderate, Aggressive, or Custom from the private admin interface.
* Conservative is the default for a new paper campaign.
* Changing mode changes staking risk rather than changing the underlying model probability.
* Conservative permits less bankroll exposure than Moderate.
* Moderate permits less bankroll exposure than Aggressive.
* The probability ceiling remains an independent safety limit.
* Selecting Aggressive does not disable the cutoff or circuit breakers.
* The active risk mode is clearly visible wherever autonomous paper state is reviewed.

### Position Sizing

* Position sizing uses executable price rather than midpoint.
* Kalshi fees are incorporated before a positive stake is permitted.
* An opportunity whose edge disappears after fees receives no stake.
* Projection confidence reduces stake when uncertainty is higher.
* Corrected probability above the configured ceiling receives no stake.
* The starting probability ceiling is 0.75.
* Per-game exposure limits bind regardless of individual contract sizing.
* Per-slate exposure limits bind regardless of aggregate unconstrained sizing.
* Slate allocation is evaluated jointly.
* When capacity is scarce, higher risk-adjusted expected-value opportunities receive priority.
* Allocation behavior is deterministic enough to explain afterward.
* Every sizing decision retains its important inputs and binding limits.

### Bankroll & Ledger

* William can choose the starting paper bankroll.
* Paper and live ledgers remain permanently separate.
* No analytics view merges paper and live results.
* Bankroll history is reconstructible.
* High-water mark is maintained.
* Open exposure is visible against applicable caps.
* Current operating mode is always obvious.
* A Kalshi settlement disagreement with the official stat line resolves simulated-position accounting according to the approved market-settlement rule.
* A paper position remains paper even if live trading later begins.
* Live activation does not convert or merge existing paper positions.

### Realistic Paper Fills

* Paper execution does not assume every desired stake fills completely.
* Simulated execution uses the realistic executable side of the market.
* Trading fees are reflected.
* Available market conditions can reduce the simulated fill.
* Partial simulated fills are supported.
* A realistically unavailable fill can result in no position.
* The paper ledger records the position actually simulated as filled rather than the larger intended stake.
* Unfilled capital returns to the available paper bankroll.
* Remaining opportunities are reassessed after a partial fill.
* Reallocation does not violate game or slate exposure caps.

### Duplicate Prevention

* Repeated execution of the same logical opportunity cannot accidentally duplicate the same intended position.
* Scheduler retries do not automatically increase exposure.
* If desired total exposure remains unchanged, no incremental position is added.
* If new information legitimately raises desired total exposure, only the incremental difference is eligible to be added.
* The resulting total exposure still respects all applicable caps.

### Dry Run

* Dry Run evaluates the same candidates used by autonomous execution.
* Dry Run uses the same recalibration behavior.
* Dry Run uses the same active risk settings.
* Dry Run uses the same sizing and exposure behavior.
* Dry Run presents realistic intended fill behavior.
* Dry Run creates no paper position.
* Dry Run creates no live position.
* Dry Run alters neither bankroll.
* A no-opportunity slate produces a legitimate empty result.
* Dry Run can still explain that a breaker would block execution.
* A fresh Dry Run is required before the initial Week 1 autonomous paper campaign after the Simulation Engine is connected.
* Future material model changes require a fresh Dry Run before autonomy resumes.

### Autonomous Execution

* Autonomous paper execution runs per game window relative to kickoff.
* The system refuses stale projections.
* The system refuses unavailable required market prices.
* The system refuses opportunities beyond the probability ceiling.
* The system refuses opportunities whose fee-adjusted economics do not support a positive stake.
* The system enforces game and slate exposure limits.
* No new autonomous position can be created inside ten minutes of kickoff.
* A delayed scheduled run that reaches the cutoff skips rather than rushing.
* Every autonomous action is explainable from the state used when it was made.
* A run with zero positions is recorded as a successful run.
* A skipped or failed run is visible rather than silent.
* Paper remains the default mode.

### Circuit Breakers

* Drawdown, calibration, and exposure conditions can halt new autonomous positions.
* Conservative mode initially halts at 10% drawdown from high-water mark.
* Moderate mode initially halts at 15%.
* Aggressive mode initially halts at 20%.
* A 5% drawdown creates a prominent early warning before the Conservative hard halt.
* Existing positions continue settling after a breaker trip.
* If a breaker trips during a run, positions already validly created remain.
* Remaining blocked actions are not executed.
* Multiple breaker conditions can remain visible simultaneously.
* Breakers never automatically recover.
* William can use ordinary Resume after the condition has cleared.
* William can deliberately choose Force Override while a condition remains breached.
* Force Override clearly displays the active breach and threshold before confirmation.
* Force Override requires explicit human confirmation.
* The override is recorded.
* Force Override does not permanently disable future breaker evaluation.
* The kill switch immediately prevents new autonomous actions and requires no confirmation.

### Simulated Withdrawals

* Paper mode supports an automatic simulated withdrawal when the configured working-bankroll rule is met.
* Simulated withdrawal reduces active paper bankroll.
* Simulated withdrawn funds are tracked separately.
* Simulated withdrawal does not create or move real money.
* Paper review displays active bankroll and cumulative withdrawn amount separately.
* Total paper wealth can be understood from the combined amounts.
* Live mode never autonomously moves funds out of the real account.
* Any later real withdrawal remains a human action.

### Paper Review

* William can review paper performance by meaningful periods such as game window and week.
* Starting bankroll is visible.
* Ending active bankroll is visible.
* Net paper P&L is visible.
* Simulated withdrawals are visible.
* Total paper wealth is visible.
* Maximum drawdown is visible.
* Position count is visible.
* Partial or unfilled simulated orders are represented honestly.
* Breaker events are visible.
* Force overrides are visible.
* Active risk mode is associated with the reviewed period.

### Counterfactual Risk-Mode Replay

* A completed paper period can be reevaluated under Conservative, Moderate, and Aggressive settings.
* Replay uses the historical information available at the original decision times rather than future information.
* Replay uses the same historical projections.
* Replay uses the same historical market observations.
* Replay applies the same realistic fill policy.
* Only the risk configuration changes.
* Results include enough information to compare profit and risk, not merely ending bankroll.
* Results include maximum drawdown.
* Results include simulated withdrawals.
* Results include position count and breaker behavior.
* Replay results are retained over time for comparison across multiple weeks.
* A superior counterfactual result does not automatically change the active risk mode.

### Live Readiness

* Sightline tracks how many complete NFL weeks the autonomous paper system has operated.
* Live readiness cannot pass before at least two complete NFL weeks have been observed.
* Cumulative paper P&L across those required weeks must be positive after realistic fills and fees.
* Model calibration must remain within the approved healthy range.
* Market-relative model-quality evidence remains part of readiness.
* Required backtest and baseline evidence remains part of readiness.
* Material unresolved operating failures prevent readiness.
* Safety behavior, including breaker operation and exposure control, contributes to readiness.
* Sightline distinguishes profitability evidence from model-quality evidence.
* Sightline can report that live requirements are unmet and explain which categories remain deficient.
* Passing the readiness gate never automatically switches the system to live.
* Sightline never initiates real-money mode itself.
* William must explicitly choose to activate real-money operation after the later Kalshi Trading capability exists.

## Rabbit Holes

* **Paper trading becoming unrealistically flattering.** Assuming perfect top-of-book fills would make the system look most profitable precisely where liquidity is least reliable.
* **Confusing desired stake with fill.** The ledger should represent what realistically would have happened, not what the sizing formula wished had happened.
* **Partial-fill reallocation loops.** Reassessing the slate is valuable, but the system must not repeatedly chase the same unavailable liquidity and manufacture exposure.
* **Accidental position duplication.** Autonomous retries must distinguish "recompute desired total exposure" from "repeat the previous order."
* **Risk mode changing model beliefs.** Conservative versus Aggressive is about bankroll risk, not about convincing the model that a 62% event suddenly became 75%.
* **Making Aggressive secretly reckless.** Risk presets must remain inside the product's hard safety boundaries.
* **Using highest win probability instead of highest value.** Expensive near-certainties can have negative expected value.
* **Overfitting live recalibration.** The first few live games are informative but nowhere near strong enough to replace the historical calibration prior.
* **Two profitable weeks being mistaken for proof.** Positive net paper P&L is now a required live-readiness gate because it matters to William, but it remains a small financial sample.
* **Counterfactual hindsight leakage.** Alternate risk-mode replay must use the state actually available then, not information learned after the games.
* **Counterfactual results creating mode-chasing.** One great Aggressive week should not turn into automatic Aggressive operation the next Sunday.
* **Simulated withdrawals obscuring performance.** Removing fake money from active bankroll must not make it look as though profit vanished.
* **Compounding versus withdrawals.** Risk-mode comparison must remain interpretable when one path generates earlier withdrawals than another.
* **Breaker overrides becoming routine.** A force override exists because William retains ultimate control, not because breakers are expected to be dismissed whenever inconvenient.
* **Override hiding system failure.** Reports must retain the fact that the bot wanted to stop and William deliberately overrode it.
* **Calibration breaker with too little data.** It must not panic based on statistically meaningless samples.
* **Drawdown thresholds interacting with withdrawals.** A simulated withdrawal should not accidentally create an artificial drawdown merely because active bankroll was intentionally reduced.
* **Paper/live simultaneous open positions.** Separation must remain obvious after live mode eventually begins while paper contracts are still settling.
* **Simulation Engine sequencing.** The capability may be built before the Simulation Engine, but the intended Week 1 paper campaign uses the finished V1 simulation model.
* **Model upgrades later in the season.** Future swaps need a new Dry Run without destroying the existing paper track record.
* **Portfolio correlation before joint distributions.** Until the Simulation Engine is active, per-game caps remain the principal conservative defense.
* **Realistic fill data limitations.** Kalshi may not expose enough historical depth to perfectly reconstruct whether every hypothetical order would have filled. When evidence is incomplete, the simulation should err conservative rather than fill optimistically.
* **Too many risk controls.** Presets should simplify Kelly and exposure configuration, not create a trading cockpit requiring fourteen sliders before kickoff.
* **Optimizing purely for paper P&L.** The system is still fundamentally a probability product and should not contort model-quality evaluation to flatter simulated returns.

## No-Gos

* Do not size from raw probability.
* Do not allow market price into recalibration.
* Do not let live results immediately overpower the historical prior.
* Do not allow the Kelly fraction to adapt automatically.
* Do not automatically change risk mode from recent performance.
* Do not let Aggressive mode raise the probability ceiling automatically.
* Do not let Aggressive mode disable breakers.
* Do not let Aggressive mode bypass the ten-minute cutoff.
* Do not prioritize nominal win probability over economic value.
* Do not assume perfect paper fills.
* Do not assume unlimited paper liquidity.
* Do not treat a desired $50 order as a $50 position when only $20 could realistically fill.
* Do not discard unused capital after a partial fill without reevaluating remaining opportunities.
* Do not rerun an original stake blindly and accidentally increase total exposure.
* Do not count duplicate scheduler execution as a second trading opportunity.
* Do not let paper and live ledgers aggregate.
* Do not automatically convert paper positions into live positions.
* Do not automatically switch from paper to live.
* Do not let Sightline decide to begin risking real money on William's behalf.
* Do not automatically withdraw real money.
* Do not erase existing positions when a breaker trips.
* Do not automatically recover from a breaker.
* Do not make Force Override visually equivalent to ordinary Resume.
* Do not permanently disable a breaker because it was overridden once.
* Do not require confirmation for the kill switch.
* Do not use two profitable weeks as the sole evidence of model quality.
* Do not omit P&L from live readiness simply because the statistical sample is small; it is a required user decision criterion.
* Do not replay alternative risk modes using hindsight.
* Do not automatically adopt whichever counterfactual mode produced the highest historical profit.
* Do not overwrite historical paper results when settings change.
* Do not build the Simulation Engine in this pitch.
* Do not start the intended Week 1 autonomous campaign on the baseline model if the full V1 Simulation Engine is already scheduled to ship before Week 1.
* Do not place live Kalshi orders.
* Do not add viewer bankrolls.
* Do not expose William's private bankroll or trading controls to viewers.
* Do not introduce generalized portfolio management, sportsbook support, DFS, or in-game trading.

## Dependencies

* **Pitch 4: Kalshi Sync, The Slate & Decision Log** — supplies the contracts, prices, recommendation context, and market-facing application surfaces the staking system operates against.
* **Pitch 5: Live Pipeline & Staleness** — supplies the authoritative freshness state required for autonomous execution to refuse stale projections.
* **Pitch 6: Outcome Scoring & Accuracy Surface** — supplies graded outcomes and calibration evidence needed for live recalibration, performance review, and calibration-based safety checks.
* **Stored contract-like calibration backtest artifact** — required before Probability Recalibration can be fitted.
* **Top-end calibration investigation** — informs whether the initial 0.75 ceiling should ever be raised; absence of stronger evidence leaves the conservative ceiling in place.
* The existing Kalshi integration must provide the executable market information needed for realistic paper execution without creating a second market client.
* The serving database must preserve the historical projection, pricing, sizing, execution, and settlement state needed for audit and counterfactual replay.
* The production scheduling path for autonomous TypeScript-side execution must support the required pre-kickoff cadence.
* **Simulation Engine is not a build dependency for this pitch**, but it is a launch dependency for the intended Week 1 autonomous paper campaign under the clarified V1 plan.
* After Simulation Engine ships, a fresh Dry Run must pass before the initial production paper campaign is enabled.

## Open Questions

No remaining user-behavior questions are required to shape this pitch.

The remaining work before design/spec is **upstream document synchronization**, not product discovery:

* Update the Pitch Roadmap to merge former Pitches 7 and 8 and renumber the remaining pitches.
* Update the PRD to add the approved risk-mode presets and counterfactual replay behavior.
* Update the PRD to distinguish automatic simulated paper withdrawals from notification-only real withdrawals.
* Update the PRD to explicitly permit admin Force Override while preserving breaker auditability.
* Update the PRD live-readiness criteria to require two complete NFL weeks with positive cumulative net paper P&L while retaining calibration, market-relative, baseline, drawdown, and operational gates.
* Update launch sequencing to state that the intended Week 1 paper campaign begins only after the Simulation Engine is complete and a fresh Dry Run has passed.
