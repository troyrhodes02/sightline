# Sightline — Pitch: Corpus & Point-in-Time Foundation

## Summary

This pitch delivers a complete, queryable historical NFL corpus that can reconstruct what was knowable before any past game. It establishes the point-in-time foundation required for honest backtesting, ensuring that future information cannot silently enter past predictions and make the model appear more accurate than it really is.

Nothing user-facing ships in this pitch. Its value is that every later projection, calibration result, recommendation, and claim of market edge rests on historical data that can be trusted rather than merely admired in a notebook.

## Type & Appetite

* **Type:** Foundational
* **Appetite:** **L** — This pitch spans multiple historical data families, cross-source identity resolution, bitemporal information tracking, historical weather treatment, correction handling, and a structurally enforced as-of query boundary. The work is large because point-in-time correctness must hold consistently across every source, not because the product needs an elaborate infrastructure empire for three users and a football model.

The scope fits a large appetite, but it should remain one pitch. This is a genuine foundation rather than an improperly horizontal slice: separating ingestion from temporal correctness would create a corpus that appears usable while still permitting leakage. Point-in-time discipline must be established alongside the data it governs, because it cannot be safely retrofitted later.

## Problem

Sightline's core job is to tell William which Kalshi NFL player contracts are mispriced and how much to trust that judgment. Before it can compare a projection with a market price, however, it must establish that the projection process is capable of learning and being evaluated honestly.

Historical sports data is especially vulnerable to future information leaking backward. Current rosters can be joined to past games. Full-season aggregates can include games that had not yet happened. Corrected statistics can be treated as though they were available immediately. Historical weather can describe what actually happened rather than what was forecast before kickoff. Injury and depth-chart records may describe a past week without recording when the information became public.

Each of these errors makes a backtest look better. That makes temporal leakage more dangerous than an ordinary data bug: its output is flattering rather than obviously broken. A leaking corpus could produce excellent backtest results, confident recommendations, and an impressive calibration curve, only for live performance to collapse once the model no longer has access to the future.

Pitch 1 therefore addresses the first technical requirement behind Sightline's core job: establish a historical corpus in which a prediction for a past game can use only information that was available before that game. Without this foundation, every downstream accuracy claim is potentially fiction, including any claim that Sightline is better calibrated than the market it is intended to challenge.

## Solution Shape

Sightline will maintain a historical NFL corpus covering the full player universe rather than only players who later appeared in Kalshi contracts. The corpus will include the data needed to reconstruct player performance and pre-game context across the covered history: play-by-play, final player statistics, rosters, schedules, depth charts, snap counts, participation, injury designations, weather, rest, and travel context.

Every fact that could influence a projection will carry two distinct notions of time:

* When the fact was true of the world.
* When the fact became available to a person making a prediction.

Historical records whose publication time is not directly available will use conservative, documented reconstruction rules. Reconstructed availability times will remain visibly distinguishable from directly observed times so later backtest analysis can identify where temporal confidence is weaker.

All model-facing historical retrieval will pass through the point-in-time behavior established in the Architecture Doc. A caller supplies an information cutoff, and facts that became known after that cutoff are made unreachable rather than merely discouraged by developer convention. The pitch establishes this boundary as part of the corpus itself, so later modelling and backtesting work consumes a safe historical view by default.

The corpus will preserve source provenance and explicit missingness. A source failure, unsupported season, unresolved player identity, or known coverage gap will remain visible instead of being silently converted into an apparently complete record. Missing participation data, for example, must remain missing rather than being filled from information published after the game.

Player identity will be resolved across the naming and identifier systems used by nflverse, ESPN, and Kalshi. Ambiguous or unmatched identities will be retained as unresolved and support an explicit manual override path rather than relying on fragile name matching during later projection or market queries.

Historical weather will follow the era policy already established in the Architecture Doc: archived forecasts where they exist and reanalysis for earlier seasons, with the source era recorded so backtest results can be evaluated separately. The older era's use of actual reconstructed weather is an acknowledged limitation, not something to conceal inside an aggregate result.

This pitch also adopts the database ownership and runtime boundary already selected in the Architecture Doc. Prisma remains the single source of schema truth, while Python consumes that contract for ingestion and later modelling work. The pitch points to that decision rather than reopening or redesigning it here.

## In Scope

* **Historical Data Ingest** — Ingest and maintain the complete historical NFL corpus needed for modelling and backtesting, including point-in-time availability, source provenance, corrections, contextual information, and cross-source player identity resolution.

## Out of Scope / Boundaries

* **Projection Engine** is deferred to Pitch 2. Pitch 1 stores and retrieves historical facts but does not calculate player distributions, projected values, confidence, ranges, or projection drivers.
* **Backtesting Harness** is deferred to Pitch 2. This pitch makes chronological, leakage-safe data access possible but does not execute or report model backtests.
* **Season-average and trailing-five baselines** are deferred to Pitch 2. No baseline performance is calculated here.
* **Kalshi Market Sync** is deferred to Pitch 4. Pitch 1 may establish player identity mappings that later support Kalshi contract resolution, but it does not discover markets, fetch prices, store order books, ingest settlements, or compute edge.
* **Brand and Responsive Interface** and **Authentication and Invite** are deferred to Pitch 3. No user-facing corpus browser, administrative dashboard, or identity-resolution screen ships in this pitch.
* **Staleness Disclosure** and scheduled production recomputation are deferred to Pitch 5. This pitch records availability and provenance but does not operate the live in-season pipeline.
* **Outcome Ingest and Scoring** is deferred to Pitch 6. Final player statistics and historical corrections belong in the corpus, but grading projections, recommendations, and decisions does not.
* **Simulation Engine** is deferred to Pitch 7. There is no game-environment, usage-allocation, efficiency, or Monte Carlo modelling work in this pitch.
* This pitch does not turn Sightline into a general NFL data browser. Historical information exists to support projections, backtesting, and grading, consistent with the Product Brief's permanent product boundaries.
* This pitch does not expand to sportsbooks, DFS platforms, additional sports, live in-game trading, or film-derived inputs. Those are either permanent non-goals or later-version work rather than adjacent tasks to smuggle into a foundation pitch.

## Definition of Done

* Every completed game in the covered historical period has its available play-by-play, participation data, and final player stat lines stored and retrievable at the player-game level.
* Rosters, depth charts, snap counts, schedules, injury designations, weather, rest, and travel context are retrievable for the historical periods in which their named sources provide coverage.
* Every fact that could influence a projection carries both the time it was valid and the time it became knowable.
* Any reconstructed information-availability timestamp is explicitly marked as reconstructed rather than presented as directly observed.
* Historical reads accept an explicit information cutoff and cannot return a row whose availability time occurs after that cutoff.
* The point-in-time restriction is structural: downstream modelling code does not need to remember to add its own ad hoc date filters to avoid future information.
* A leakage test suite demonstrates that the eligible inputs for a past game remain identical regardless of when the query is executed, subject only to explicitly represented source corrections and their recorded availability.
* Historical weather uses archived forecasts for the supported recent era and reanalysis for earlier seasons, with the weather era and source recorded on each applicable record.
* Backtest consumers can distinguish the archived-forecast era from the reanalysis era so later results can be reported separately rather than blended into a misleading aggregate.
* Re-running an ingest over an already processed period produces no duplicate records and no unintended changes.
* Legitimate stat corrections are captured as explicit updates rather than duplicates and preserve enough temporal information for later grading and point-in-time analysis.
* A named upstream source becoming unavailable or changing incompatibly produces an explicit ingest failure or degraded result. It never creates a silent gap that appears complete.
* Player identities resolve across the supported nflverse, ESPN, and Kalshi identifiers or naming systems.
* Ambiguous and unresolved identities are retained and surfaced for resolution rather than silently dropped or guessed.
* A manual override mechanism exists for identity cases that cannot be resolved automatically.
* A player changing teams during a season retains one stable player identity while historical team context remains tied to the team represented in the specific game.
* The resulting corpus is queryable by later modelling and backtesting work without requiring those consumers to join against current roster state or other present-day reference data.

## Rabbit Holes

* **Reconstructing** `known_at`**.** Several historical sources identify the week or game to which a fact applies but do not preserve the moment it became public. Reconstruction rules that are too generous leak future information; rules that are too conservative may discard useful signal. Each source needs an explicit policy rather than one universal guess.
* **Weather look-ahead bias.** Reanalysis reports what the weather ultimately was, not what could have been known before kickoff. The recent archived-forecast era and older reanalysis era must remain distinguishable throughout the corpus and later analysis.
* **Participation coverage gaps.** Public participation data is incomplete for portions of NFL history. Missing records must not be interpreted as zero participation, and the design must not fill them using later-published evidence.
* **Source schema drift.** Upstream sources can rename fields, alter identifiers, change types, or remove historical files. A technically successful request that produces structurally incomplete data is more dangerous than a clean failure.
* **Player identity collisions.** Shared names, suffixes, punctuation differences, team changes, mid-season signings, and inconsistent Kalshi naming can cause one player to be joined to another. Automatic name matching should not be treated as authoritative.
* **Kalshi identity before market sync.** Pitch 1 owns the cross-source identity foundation, while Pitch 4 owns actual market discovery. The design must avoid accidentally building part of Kalshi Market Sync merely to gather identities.
* **Current-state leakage.** Joining current rosters, current team assignments, or current player metadata onto historical games can reveal future moves even when all statistical rows are correctly timestamped.
* **Season aggregate leakage.** Features or helper views computed over a completed season can accidentally include games occurring after the prediction date. The corpus must support chronological aggregation without providing tempting future-complete shortcuts as the default path.
* **Stat corrections.** Official statistics may change after initial publication. The corpus must distinguish the corrected truth used for eventual evaluation from what had been published at earlier cutoffs.
* **Postponed, relocated, or cancelled games.** Schedule identity and kickoff time anchor later temporal queries. Treating a changed kickoff as an ordinary field overwrite can corrupt what information was available relative to the original and final schedules.
* **Missing versus unavailable weather.** A dome game, a failed weather request, and a season without archived forecasts are different states and should not collapse into one null value.
* **Idempotence across corrected data.** "Re-running changes nothing" and "stat corrections update stored results" are intentionally different cases. The design must distinguish a legitimate upstream correction from nondeterministic ingestion behavior.
* **False completeness.** The corpus covers several sources whose historical ranges differ. A row count that looks large is not proof that each player-game has every contextual feature, because apparently humanity still needs reminders that absence and zero are not synonyms.

## No-Gos

* Do not begin building the **Projection Engine**, feature engineering, baselines, or model-training logic while constructing the corpus. Pitch 2 owns all modelling behavior.
* Do not produce an exploratory model "just to validate the data." That would create an unofficial projection path outside the later reproducibility and backtesting requirements.
* Do not ingest Kalshi prices, settlements, live contracts, or market history. Player identity compatibility is in scope; market synchronization is not.
* Do not create a user-facing data explorer, administrative cleanup interface, or bespoke operations console. Operational overrides may exist without turning Pitch 1 into Pitch 3 wearing a fake moustache.
* Do not silently impute missing historical values from future-known information, current roster state, final weather, or season-complete aggregates.
* Do not treat a reconstructed publication time as equally reliable to an observed publication time.
* Do not drop unresolved players, games, or source records merely to make completeness metrics look cleaner.
* Do not introduce a second schema-migration authority or allow Python ingestion code to evolve the database independently of the Architecture Doc's Prisma ownership decision.
* Do not generalize the corpus into a multi-sport warehouse or pre-build NBA-specific ingestion. The product-level entity model may remain compatible with later sports, but this pitch delivers the NFL corpus required for V1.
* Do not introduce message queues, streaming infrastructure, specialized time-series stores, or distributed processing for a historical corpus whose scale does not justify them.
* Do not revisit approved stack decisions unless implementation reveals a concrete blocker. Tool-shopping is not progress, despite the software industry's heroic effort to make it feel like progress.

## Dependencies

* **No prior Sightline pitch.** Pitch 1 is the first dependency in the roadmap and blocks every later capability that displays, evaluates, or acts on a projection.
* Access to the named historical NFL sources used by **Historical Data Ingest**, including the supported nflverse datasets.
* Access to the historical weather sources required by the Architecture Doc's archived-forecast and reanalysis policy.
* Representative ESPN and Kalshi identifiers or naming examples sufficient to establish the player identity mapping contract without implementing their later live-sync features.
* A database environment consistent with the Architecture Doc's selected Postgres and schema-ownership model.
* The Architecture Doc's temporal model, source-of-truth boundaries, and two-runtime ownership decisions are treated as approved inputs rather than decisions to reopen during pitch expansion.

## Open Questions

### What constitutes "complete" coverage when a named source has historical gaps?

The roadmap calls for the full covered history to be ingested, while the PRD and Architecture Doc acknowledge that participation and related datasets contain known gaps. The design-doc stage should define completeness per source and season, including how unsupported periods, isolated missing games, and partial feature families are represented and reported.

The answer should preserve explicit missingness rather than forcing every player-game into an artificial all-fields-present standard.

### What is the exact beginning of the covered history for each data family?

Play-by-play reaches substantially further back than archived forecasts and some participation or injury datasets. The design needs to decide whether "covered history" means one common start season for every required source or a broader game corpus with source-specific availability windows.

This decision affects later backtest configuration and comparability but should not be improvised independently by each ingest.

### What Kalshi naming material is available before Pitch 4?

The roadmap places cross-source player identity resolution in Pitch 1 but defers Kalshi Market Sync to Pitch 4. The design-doc stage should identify the smallest non-sync source of Kalshi naming examples or identifiers needed to validate the mapping structure without pulling contract discovery and market ingestion into this pitch.

If representative Kalshi identity data is unavailable until live market work begins, the pitch may need to establish the mapping capability in Pitch 1 and defer full empirical validation of the Kalshi side to Pitch 4.

### How should historical stat corrections preserve earlier published values?

The PRD requires corrections to update stored actuals, while the temporal model requires Sightline to distinguish what was known at different times. The design-doc stage should resolve whether corrected values replace prior versions with temporal history retained, or whether corrections are represented as separate validity intervals.

The pitch requires both eventual correctness and point-in-time honesty, but the exact representation belongs in the design rather than here.
