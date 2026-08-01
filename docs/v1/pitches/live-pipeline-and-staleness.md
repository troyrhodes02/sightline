# Sightline — Pitch: Live Pipeline & Staleness

## Summary

This pitch turns Sightline from an application that depends on manually produced projections into one that maintains its serving data throughout the NFL week. Scheduled ingest, projection recomputation, and price-refresh work keep the slate supplied with current information without requiring William to operate the pipeline by hand.

The pitch also makes currency explicit rather than implied. Every contract exposes the age and information cutoff of its projection, contracts become visibly stale when known pre-kickoff information has not yet reached the model, and the application surfaces delayed or failed pipeline activity instead of quietly presenting old numbers as current ones.

## Type & Appetite

* **Type:** Foundational
* **Appetite:** M — The pitch coordinates several existing capabilities rather than introducing a new modelling or market domain: scheduled ingest, scheduled recomputation, scheduled price maintenance, per-game timing, staleness evaluation, offseason schedule survival, and application health disclosure. The integration and failure-state surface are meaningful, but the scope remains bounded because it does not add new data sources, alter the projection model, grade outcomes, or execute positions.

The appetite assumes the pitch reuses the ingest, projection, market-sync, application-shell, and health foundations already established by earlier work. If it requires a second Kalshi integration, a new real-time inactives source, a generalized workflow engine, or substantial reconstruction of the frozen ingest path, the scope has escaped M and must be corrected rather than quietly absorbed.

## Problem

Pitch 4 gives Sightline its first complete user-facing loop: the slate joins stored projections to current Kalshi contracts and prices, ranks opportunities, explains each projection, and records William's decisions. That loop is only trustworthy when the projection being compared with the market reflects the information that should have been known at that point in the week.

NFL information changes continuously before kickoff. Practice participation, injury designations, roster status, schedule changes, weather, and completed-game results can all alter the inputs available to a projection. A projection computed earlier in the week may remain technically valid as a historical artifact while being inappropriate for a Sunday-morning decision.

Without a maintained live pipeline, William must remember when to ingest new information, decide which games need recomputation, run the projection path correctly, and verify that every job completed. That turns the product into an operations checklist. It also creates the most dangerous interface state in Sightline: a current Kalshi price displayed beside an old projection with nothing making the mismatch obvious.

A scheduler alone does not solve this. Scheduled systems run late, fail silently, execute twice, miss unusual kickoff windows, and go dormant during the offseason. GitHub Actions provides no timing guarantee, and scheduled workflows can become disabled after prolonged repository inactivity. A pipeline that exists only in configuration can therefore fail while the application continues rendering plausible numbers.

Sightline cannot win a speed race against traders reacting immediately to late-breaking news. Its honest advantage is different: it can show exactly when a projection was computed, which information it included, and when the application no longer considers that projection current enough to rely on.

This pitch solves the operational-currency problem. It keeps the serving data moving on a predictable football-week cadence and ensures that missed, delayed, or incomplete movement is visible inside the product.

## Solution Shape

Sightline operates an in-season maintenance cycle around each game's own kickoff time.

During the week, the system runs recurring ingest and projection recomputation so that newly available structured information reaches the stored projection set without manual intervention. On game day, it runs additional recomputations aligned to upcoming kickoff windows, narrowing work to the games whose decision window is approaching.

The schedule is game-relative rather than calendar-label-relative. A Thursday night game, Sunday morning international game, Sunday afternoon game, late-season Saturday game, Sunday night game, and Monday night game all follow the same behavioral rule: relevant jobs are measured backward from that game's recorded kickoff rather than hardcoded as special weekday cases.

Recomputation is scoped by game. Information becoming relevant to an early game causes that game's projections to be refreshed without needlessly recomputing every later game on the slate. A stale early window does not make the Sunday night or Monday night windows stale merely because they appear on the same slate.

The pitch preserves Sightline's two-clock architecture:

* Projection inputs are ingested and projections are recomputed out of band.
* Kalshi prices continue to refresh independently.
* The application joins the freshest stored projection with the freshest stored or currently retrieved market observation.
* Opening the slate remains a read path and never waits for ingest or model computation to finish.

Every projection displayed through the Pitch 4 slate carries visible currency information:

* When the projection was computed.
* The information cutoff used to compute it.
* A human-readable indication of its age.
* Whether Sightline currently considers it stale for the associated game.

These indicators appear in both the slate list and the contract detail view. The user does not need to open every contract to discover that an entire game window is based on outdated information.

Staleness is determined per game. Once a game reaches the point at which required pre-kickoff information should be available, contracts for that game remain stale until the necessary information has been ingested and the displayed projection's information cutoff demonstrates that it was computed against the required state.

The interface does not imply that a projection is current merely because a scheduled job ran. Currency is tied to the projection and its information cutoff, not to a generic green scheduler indicator.

The product also exposes operational health. The application shows the latest successful ingest, projection recomputation, and price-refresh activity, together with a visible warning when any of those signals falls outside its expected operating window. A skipped or failed job must therefore become visible to William without requiring him to inspect GitHub Actions logs.

The health surface distinguishes at least these product-level conditions:

* Healthy and operating within expected bounds.
* Running or recently started, without blocking slate reads.
* Delayed beyond the expected window.
* Failed or incomplete.
* Never run or not yet available.
* Not currently expected, such as an appropriate offseason state.

The precise job-state representation and storage belong to the design document. The pitch defines the behavior: the application must not show silent green health when no recent successful work supports that claim.

A keepalive process preserves scheduled workflow operation across the NFL offseason. It acts early enough that the repository's scheduled workflows do not cross the inactivity boundary and disappear before the following season. This is operational scaffolding, not a user-facing activity feed.

The solution follows the runtime boundary established by the Architecture Doc. Python continues to own ingest and projection work upstream of stored projections. TypeScript continues to own the application and the Kalshi-facing behavior downstream of them. Both communicate through Postgres rather than through a new RPC layer, queue, or shared runtime.

This pitch does not define workflow files, database schemas, job endpoints, cron expressions, locking mechanics, or status-table structures. Those decisions belong to the design document. It defines what must run, how its scope is understood by users, how failures become visible, and where the work must stop.

## In Scope

* **Staleness Disclosure** — Display projection age and information cutoff on contract rows and detail views, mark contracts stale once required game information is expected but not reflected in the projection, and scope that status independently per game.
* **Scheduled in-season ingest** — Run the existing ingest path without manual intervention on a recurring in-week cadence so newly available structured information reaches the serving corpus.
* **Scheduled projection recomputation** — Run the existing projection path after relevant ingest activity, including recurring in-week updates and additional game-day recomputations before each kickoff window.
* **Per-game recompute scoping** — Select recomputation work according to each game's own kickoff and relevant information window rather than treating the entire weekly slate as one indivisible batch.
* **Scheduled price maintenance** — Maintain market observations on the roadmap's scheduled path in addition to the view-driven and background refresh behavior introduced in Pitch 4, without changing the product's projection-versus-market separation.
* **Pipeline health surfacing** — Expose the last successful ingest, recomputation, and price refresh in the application and make out-of-bounds freshness visible.
* **Keepalive workflow** — Prevent the scheduled workflows from being disabled during prolonged repository inactivity over the offseason.
* **Failure and delay disclosure** — Distinguish late, failed, incomplete, never-run, and not-currently-expected operational states rather than presenting all of them as healthy or as one generic error.
* **Game-relative scheduling behavior** — Treat Thursday, international Sunday morning, standard Sunday, Saturday, Sunday night, and Monday games through one kickoff-relative product rule.
* **Non-blocking slate behavior** — Ensure that the Pitch 4 slate and contract detail surfaces continue reading the latest completed stored state while pipeline work runs separately.

The scheduled pipeline uses the existing **Historical Data Ingest**, **Projection Engine**, **Kalshi Market Sync**, and **Brand and Responsive Interface** capabilities. Those features are not renamed or redefined here. Pitch 5 adds operational maintenance and currency disclosure around them.

## Out of Scope / Boundaries

* New projection-model logic is excluded. The pitch schedules the current Pitch 2 baseline model; it does not improve that model or introduce simulation.
* Game environment, usage allocation, efficiency modelling, teammate interaction, joint distributions, and vectorized Monte Carlo belong to **Simulation Engine**.
* Adjustment suggestions are excluded. No source proposes a human-reviewable change to a projection in this pitch.
* The ESPN inactives integration is excluded according to the roadmap's stated deferral, pending correction of the roadmap's stale pitch-number reference.
* Automatic acceptance of injury, inactive, depth-chart, or other adjustment suggestions is excluded.
* Suggestion reliability analytics are excluded.
* Outcome ingest, Kalshi settlement ingest for grading, official-result reconciliation, stat-correction regrading, recommendation scoring, and decision scoring belong to **Outcome Scoring & Accuracy Surface**.
* Reliability curves, Brier score, baseline comparison, override performance, and timing-cost calculations are excluded.
* Probability recalibration is excluded.
* Bankroll tracking, ledgers, open exposure, high-water marks, position sizing, dry-run intents, and paper positions are excluded.
* Autonomous trading decisions and scheduled order execution are excluded. This pitch schedules data maintenance, not staking activity.
* Circuit breakers, withdrawal notifications, kill-switch behavior, and the gated paper-to-live switch are excluded.
* Live or demo Kalshi order placement is excluded.
* The pipeline does not trade, recommend a stake, move money, or create a position.
* In-game updating is excluded. Sightline remains a pre-game product, and a game that has kicked off leaves the actionable slate.
* Real-time streaming infrastructure is excluded. The product does not attempt to react within seconds to breaking news or market movement.
* A generalized job orchestration platform is excluded. Sightline has a bounded set of known scheduled jobs.
* A message broker, worker fleet, persistent queue, or microservice decomposition is excluded.
* A second Python or TypeScript implementation of the same upstream integration is excluded.
* A public-facing status page is excluded. Health is surfaced inside the authenticated application.
* Email, SMS, push, Slack, or other outbound pipeline-failure notifications are excluded unless separately approved later. This pitch requires in-product visibility.
* Manual editing of projection timestamps, information cutoffs, staleness state, or job-success timestamps is excluded.
* Manual override that marks a stale projection current without ingest and recomputation is excluded.
* A user-facing "run the model now" operations console is excluded unless an upstream requirement is added.
* Detailed scheduler logs, stack traces, raw workflow output, and CI administration are excluded from the product interface.
* Price movement remains a comparison target and never becomes a projection input.
* Final pre-kickoff recommendation capture for timing-cost analysis is not silently pulled into this pitch. Its ownership must be resolved with Pitch 6.
* The keepalive process exists only to preserve required schedules. It is not a mechanism for manufacturing repository activity or hiding project dormancy.

## Definition of Done

* A recurring in-week ingest runs without William manually starting it.
* A recurring in-week projection recomputation runs after or against the newly maintained serving data.
* At least one additional game-day recomputation is scheduled for each relevant upcoming kickoff window.
* Game-day work is derived from each game's recorded kickoff rather than from a fixed assumption that all games occur in the standard Sunday afternoon windows.
* Thursday night games follow the same kickoff-relative behavior as Sunday games.
* Sunday morning international games follow the same kickoff-relative behavior as domestic games.
* Late-season Saturday games follow the same kickoff-relative behavior as Sunday games.
* Sunday night and Monday night games follow the same kickoff-relative behavior as earlier windows.
* A change affecting one game can cause that game's projections to be recomputed without requiring unrelated later games to be recomputed.
* A game in an earlier window becoming stale does not mark contracts for later games stale.
* Re-running an overlapping ingest period does not create duplicate source records or silently change already-ingested facts outside documented correction behavior.
* Re-running projection work for the same game and information state does not leave conflicting results presented as equally current.
* A source failure causes the associated ingest run to report failure rather than completing with an undisclosed data gap.
* An interrupted ingest or recomputation does not produce a partial state represented to users as a completed successful run.
* Every resolved contract row with a projection displays the projection's age.
* Every resolved contract row with a projection exposes or makes accessible the projection's information cutoff.
* Every resolved contract detail view displays the projection's computed-at time and information cutoff.
* Projection age and information cutoff remain visible independently of market-price age.
* Once a game passes the point at which required pre-kickoff information should be available, its contracts display a stale state until the required information is reflected in the projection's information cutoff.
* Staleness is visible directly in the slate list and does not require opening the contract detail view.
* A stale contract remains viewable. Sightline discloses the limitation rather than deleting the projection or crashing the slate.
* A stale projection is not silently rendered with the same treatment as a projection Sightline considers current.
* Ingesting information for an early game does not automatically clear stale state for another game.
* Recomputing an early game does not alter the displayed currency of unrelated later games.
* A postponed game or changed kickoff causes future schedule and staleness behavior to follow the updated kickoff rather than the obsolete one.
* The slate renders from the latest completed stored projection state while ingest or recomputation is running.
* Opening or refreshing the slate never waits for a model run to finish.
* A delayed scheduled recomputation leaves the last completed projection visible with its accurate age and stale state.
* A failed recomputation does not erase the last completed projection merely to make failure more dramatic. Humans already provide sufficient drama.
* The application exposes the last successful ingest.
* The application exposes the last successful projection recomputation.
* The application exposes the last successful price refresh.
* Each health signal reflects a completed successful run rather than merely the most recent attempted start.
* The application visibly warns when a required health signal is older than its expected operating window.
* A failed or silently skipped scheduled cycle becomes visible in the authenticated product.
* A never-run signal is represented honestly and is not displayed as healthy.
* An offseason signal that is not expected to run is distinguishable from an in-season job that is late or broken.
* A successful run that performs no changes because no new data exists is treated as a valid successful run rather than a failure.
* Duplicate scheduled invocation does not create duplicate ingest records, conflicting projections, or multiple success states for one logical cycle.
* Scheduled price maintenance respects the existing market integration's rate-limit and degraded-mode boundaries.
* A Kalshi price-refresh failure does not prevent stored projections from rendering.
* A keepalive action occurs before the scheduler's inactivity cutoff can disable required workflows.
* The offseason keepalive behavior itself is visible enough operationally that its failure can be detected before the season resumes.
* Pipeline operation does not introduce a second model runtime, a second Kalshi credential path, or a direct Python-to-TypeScript RPC dependency.
* Kalshi prices do not enter the projection input path during scheduled processing.
* The same authenticated slate surfaces built in Pitch 4 continue to work at phone, tablet, and desktop widths with the added age, cutoff, stale, and health states.

The scheduled ingest, recomputation, health, and keepalive bullets above are explicit Pitch Roadmap requirements. However, the PRD currently provides direct acceptance criteria only for the user-facing **Staleness Disclosure** behavior and for underlying ingest and projection properties. The roadmap-only operational requirements need PRD traceability clarified before the pitch can satisfy the expansion guide's strict "every Definition-of-Done criterion traces to a PRD criterion" rule.

## Rabbit Holes

* **The missing inactives-clearing source.** The pitch requires contracts to become stale when inactives should exist and remain stale until those inactives are ingested. The roadmap simultaneously defers the ESPN inactives feed. Unless another existing source provides the required game-day inactive state, the pitch can identify when projections should be stale but cannot honestly know when that particular state has been incorporated.
* **Treating scheduled execution as timely execution.** GitHub Actions provides a schedule, not a guarantee. A job running twenty minutes late cannot be represented as current merely because its workflow eventually started.
* **Hardcoded Sunday windows.** The NFL schedule includes Thursday, international mornings, Saturday games, flexed times, Sunday night, Monday night, and occasional unusual windows. Calendar-based branching will multiply rapidly and still miss the next exception invented by television executives.
* **Kickoff changes after jobs are scheduled.** Flexing, postponement, relocation, and weather disruption can invalidate previously calculated job windows and stale boundaries.
* **Time-zone and daylight-saving behavior.** Game-relative scheduling must remain anchored to authoritative kickoff instants rather than local wall-clock assumptions.
* **Overlapping ingest windows.** The live pipeline deliberately reprocesses overlapping periods. Existing non-idempotent behavior would create duplicates or inconsistent facts under normal operation, not merely under an unusual retry.
* **Cleanup-sprint dependency conflict.** [SIG-25](https://linear.app/sightline-pilot/issue/SIG-25/corpus-correctness-null-vs-zero-and-idempotent-re-runnable-stats) is described as critical to Pitch 5 because it fixes ingest idempotence, yet the roadmap dependency narrative says the cleanup sprint blocks Pitch 7 and nothing else.
* **Partial source success.** One source may update while another fails. A single green "ingest succeeded" state could conceal a serving corpus missing the exact information needed for a game.
* **Partial recomputation.** Some games or players may recompute successfully while others fail. The product needs an honest concept of completeness rather than one timestamp pretending the entire slate moved together.
* **Concurrent runs.** A delayed nightly job may overlap with the morning-of job, or a retry may overlap with the original invocation. The resulting current projection must remain deterministic and explainable.
* **Old inputs with a new computed-at time.** A recomputation can finish successfully while reading stale upstream data. Fresh computation is not the same as fresh information, which is why the information cutoff remains load-bearing.
* **New inputs without recomputation.** Ingest can succeed while the projection shown to users still predates that ingest. Health must not imply that successful ingest alone makes the slate current.
* **Clearing stale state too early.** A job-start event, ingest completion, or current timestamp is not enough. The displayed projection must actually reflect the necessary information.
* **Never clearing stale state.** If a required source is unavailable or lacks coverage, contracts may remain stale indefinitely. The interface must handle that honestly without making the entire slate unusable.
* **Price-refresh ownership.** Pitch 4 already refreshes prices on view and in a background interval. Pitch 5 adds scheduled price jobs, while the architecture keeps Kalshi behavior in the TypeScript application. Building an unrelated scheduled market client would duplicate rate-limit logic and credential handling.
* **Rate-limit multiplication.** View-driven refresh, browser background refresh, scheduled refresh, and multiple users can unintentionally stack into redundant Kalshi calls.
* **Health based on attempts instead of outcomes.** A job that starts, logs cheerfully, and fails halfway through cannot update the "last successful" signal.
* **One timestamp for a multi-stage pipeline.** Ingest, recomputation, and price refresh are separate clocks. Combining them into a single health indicator hides which layer is actually stale.
* **Generic green health.** A job can be within its expected interval while the specific Sunday game William cares about remains stale. Global health and per-game currency answer different questions.
* **Offseason false alarms.** Jobs that are correctly dormant should not create months of red warnings that train the user to ignore health indicators.
* **Offseason false reassurance.** "Not expected" must not conceal that the keepalive mechanism has failed and future scheduled work has been disabled.
* **Keepalive permissions.** Branch protection, token permissions, or repository policy can prevent an automated commit even when the workflow appears configured correctly.
* **Keepalive feedback loops.** A workflow that commits to preserve schedules can accidentally trigger additional workflows or continually modify the repository.
* **Silent workflow disabling.** The failure may not become visible until the first expected in-season run never happens, unless offseason readiness is explicitly observable.
* **Stale browser state.** A contract may be recomputed while William has an older slate open. Refresh behavior must not leave him believing the old projection is still current.
* **Staleness language.** "Old," "stale," "delayed," "missing inactives," and "pipeline failure" are related but not interchangeable. Careless labels can overstate what the system actually knows.
* **Unresolved contracts.** A game may have current projections generally while an individual Kalshi contract remains unresolved. Contract resolution failure is not the same as projection staleness.
* **Players with no projection.** A missing projection cannot be made less missing by a successful recompute timestamp. The interface must preserve the distinction between unsupported and stale.
* **Weather degradation.** An unavailable weather source may cause the projection path to use documented fallback behavior. "Degraded but computed" differs from both current-normal and stale.
* **Source schema changes.** A provider can return a technically successful response with altered or empty fields. Explicit validation is necessary or the pipeline will write plausible emptiness.
* **Accidental look-ahead in live corrections.** Scheduled ingest must preserve honest `known_at` values and must not overwrite the historical availability record merely because the current truth is now known.
* **Model-version transitions.** If the active model changes, scheduled recomputation may produce a mixture of versions across games unless the product-level rollout behavior is deliberate.
* **Final pre-kickoff snapshot ownership.** Pitch 6 requires a final pre-kickoff state to calculate timing cost. Pitch 5 owns the schedule most naturally positioned to capture it, but the current roadmap does not assign that responsibility here.
* **"News-driven" terminology.** The roadmap calls the projection schedule news-driven, but the specified mechanism is recurring nightly and game-window scheduling. That may mean aligned to expected news cadence rather than triggered by actual news events.
* **Operational recovery.** Health can disclose failure without providing a product mechanism to retry or recover. Whether manual reruns are command-line operations or an admin capability is not presently defined.
* **Unbounded health scope.** It is tempting to evolve three last-success timestamps into logs, traces, run histories, alert rules, dashboards, and an observability platform. That is how one personal NFL tool accidentally becomes a worse Datadog.

## No-Gos

* Do not make the slate wait for ingest or recomputation.
* Do not run the model from a user-facing page request.
* Do not treat a job's scheduled time as proof that it ran.
* Do not treat a job's start as proof that it succeeded.
* Do not mark projections current merely because their `computed_at` value is recent.
* Do not hide the projection's information cutoff.
* Do not collapse projection age and price age into one freshness indicator.
* Do not mark the entire slate stale because one game crossed its information boundary.
* Do not recompute every game merely because one game received new information.
* Do not clear a stale state because the clock advanced or a workflow completed without confirming that the displayed projection reflects the required information.
* Do not delete stale projections from view.
* Do not replace stale projections with fabricated current-looking placeholders.
* Do not silently serve an older projection as though it were the result of the latest completed run.
* Do not allow overlapping scheduled runs to create duplicate data.
* Do not accept non-idempotent ingest as an operational inconvenience. It is a release blocker for this pitch.
* Do not hardcode a single "Sunday morning" workflow and bolt special cases onto it later.
* Do not assume kickoff times never change.
* Do not use local server time as the product's scheduling truth.
* Do not build a streaming or event-bus architecture to compensate for GitHub Actions timing.
* Do not add WebSockets for pipeline maintenance or market updates.
* Do not introduce a message queue, worker service, or generalized orchestration platform.
* Do not build a second Kalshi client solely for scheduled price work.
* Do not place Kalshi credentials in the Python model runtime merely to make scheduling convenient.
* Do not expose credentials, workflow secrets, raw CI logs, or stack traces in the health interface.
* Do not let scheduled price refreshes feed market information into the model.
* Do not infer injuries or player availability from Kalshi price movement.
* Do not introduce ESPN adjustment suggestions before their named feature pitch.
* Do not auto-adjust a projection from an unproven source.
* Do not build outcome grading or reliability analytics in this pitch.
* Do not create positions, dry-run intents, stakes, or simulated fills.
* Do not add autonomous paper execution under the label of "another scheduled job."
* Do not implement circuit breakers or withdrawal behavior.
* Do not create outbound alert infrastructure merely because in-product health exists.
* Do not display every offseason job as failed when it is correctly dormant.
* Do not display offseason health as healthy if the workflows needed for next season have been disabled.
* Do not make keepalive commits alter application behavior, source logic, model versions, or production configuration.
* Do not use keepalive activity to bypass review or branch policy.
* Do not overwrite historical `known_at` values with the time a later live ingest happened.
* Do not present partial recomputation as full-slate success.
* Do not suppress a source failure because some other source succeeded.
* Do not create a fake "all systems operational" state from one global timestamp.
* Do not turn the health surface into a full workflow-control console.
* Do not pull the final pre-kickoff timing-cost implementation forward without resolving ownership with Pitch 6.
* Do not introduce user-configurable cron expressions, arbitrary job creation, or scheduler administration.
* Do not optimize for enterprise-scale scheduling. The product has a small number of known jobs serving a tiny invited audience.

## Dependencies

* **Pitch 1: Corpus & Point-in-Time Foundation** — Supplies the serving corpus, bitemporal information model, as-of query discipline, source-ingest behavior, game identities, kickoff times, and the requirement that ingest remain idempotent and fail explicitly.
* **Pitch 2: Backtest Harness & Baseline Model** — Supplies the projection path and stored projection output, including `computed_at`, `information_cutoff`, model version, confidence, and reproducible distributional results.
* **Pitch 4: Kalshi Sync, The Slate & Decision Log** — Supplies the rolling slate, contract detail surface, contract-to-game resolution, current price behavior, and the application locations where projection age, information cutoff, and stale state are displayed.
* **Pitch 3: App Shell, Brand & Access**, transitively through Pitch 4 — Supplies the application shell and the health-read location originally named in the Pitch 3 roadmap scope.
* [SIG-25](https://linear.app/sightline-pilot/issue/SIG-25/corpus-correctness-null-vs-zero-and-idempotent-re-runnable-stats) **corpus and ingest correction** — The cleanup sprint states that ingest must become idempotent within a batch because the in-season pipeline intentionally reruns overlapping windows. Although the dependency map says the cleanup sprint blocks only Pitch 7, this correction is a practical prerequisite for Pitch 5 and must be reconciled explicitly.
* The production Supabase serving database must be reachable by the scheduled ingest and recomputation paths.
* The required production connection configuration must be persisted in documented secrets rather than depending on interactive shell state.
* GitHub Actions must be enabled for the repository and authorized to run the required scheduled work.
* The keepalive mechanism must have the minimum repository permission needed to perform its bounded action.
* The active game schedule and kickoff times must be available and maintained through the existing source foundation.
* The Pitch 4 Kalshi integration must expose a reusable market-refresh capability so scheduled price work does not create a second market client or credential path.
* The application must have access to completed-run health information through the shared database seam.
* An authoritative source or existing ingest path must exist for the game-day information that clears the inactives-related stale state. The supplied documents do not currently identify this clearly while simultaneously deferring ESPN.
* Expected operating windows for ingest, recomputation, and price refresh must be defined before the health interface can determine whether a last-success value is late.
* Environment behavior must distinguish development, preview, production, in-season operation, and offseason dormancy sufficiently that test jobs do not masquerade as production freshness.

## Open Questions

### 1. What source clears the inactives-related stale state in Pitch 5?

The PRD requires contracts to become stale once inactives should be published and to remain stale until inactives are ingested. The roadmap defers the ESPN inactives feed and adjustment suggestions to a later pitch.

The source documents do not establish which existing Pitch 5 ingest source provides authoritative game-day inactive information before ESPN is introduced.

This must be resolved before the design document because it changes what Pitch 5 can honestly promise:

* If an existing structured source provides inactives, identify it and define what successful ingestion means.
* If Pitch 5 only knows that inactives should exist but cannot retrieve them, contracts may become stale but cannot automatically become current through this pitch.
* If a minimal inactives ingest must move into Pitch 5, the roadmap boundary with **Adjustment Suggestions** must be rewritten so raw status ingestion and suggestion generation remain clearly separate.

The pitch must not invent a source merely to make the acceptance criterion appear complete.

### 2. Does the cleanup sprint partially block Pitch 5?

The roadmap says the cleanup sprint blocks Pitch 7 and nothing else. It also states that SIG-25's ingest-idempotence correction is independently on the critical path because the scheduled live pipeline reruns overlapping windows by design.

Both statements cannot remain true without qualification.

The roadmap should clarify that:

* [SIG-27](https://linear.app/sightline-pilot/issue/SIG-27/re-baseline-on-the-corrected-corpus-the-first-citable-stored-run) blocks Pitch 7 specifically.
* [SIG-25](https://linear.app/sightline-pilot/issue/SIG-25/corpus-correctness-null-vs-zero-and-idempotent-re-runnable-stats) is a prerequisite for Pitch 5's scheduled overlapping ingest.
* The remainder of the cleanup sprint may still proceed independently of Pitches 3 through 6.

Until corrected, Pitch 5 should treat verified ingest idempotence as a hard readiness condition.

### 3. Where do scheduled price jobs run?

Pitch 5's roadmap scope names scheduled ingest, recompute, and price jobs on GitHub Actions. Pitch 4 already owns view-driven and background price refresh. The Architecture Doc places Kalshi-facing application behavior in TypeScript and warns against duplicating clients and credentials across runtimes.

The design document must decide the shape without violating that boundary. At the pitch level, the requirement is:

* Scheduled price maintenance reuses the existing Kalshi integration.
* It does not create a second independent client.
* It does not move Kalshi credentials into the modelling runtime.
* It records honest success and failure for the health surface.

Whether GitHub Actions invokes the existing application path or runs an approved TypeScript job is a design-stage decision.

### 4. What do "news-driven" and "scheduled" mean together?

The roadmap says projections refresh on a news-driven schedule, then specifies nightly in-week and morning-of-game recomputations.

The documents do not say whether any actual event-triggered recomputation exists in Pitch 5. The likely source-supported interpretation is that the fixed cadence is aligned to periods when injury and participation news normally arrives, not that arbitrary news events automatically trigger work.

This terminology should be corrected before design so Pitch 5 is not mistaken for real-time event processing.

### 5. What are the exact expected operating windows?

The health interface must warn when a last-success value falls outside expected bounds. The documents provide broad cadence but not enough precision to evaluate health consistently.

The design document needs approved product rules for:

* Which nights count as in-week processing.
* How far before kickoff game-day recomputation is expected.
* How much scheduler delay remains acceptable.
* Whether the expected bounds differ by job type.
* Whether empty-data success counts as current.
* When each job becomes not expected after the final game of a week or season.

These rules are product behavior, not merely cron syntax, because they control whether the application tells users that its data is trustworthy.

### 6. How is staleness cleared?

The PRD says contracts are stale until inactives are ingested. The Architecture Doc emphasizes projection `computed_at` and `information_cutoff`.

Ingest alone does not make the displayed projection current. If information arrives after the projection was computed, the projection still predates it.

The design document should resolve the user-facing rule, with the strongest source-supported shape being that stale status clears only when the displayed projection's information cutoff demonstrates inclusion of the required game information. The PRD wording may need refinement to say "ingested and reflected in the projection."

### 7. What is the unit of pipeline health?

The roadmap names last successful ingest, recompute, and price refresh. That could mean:

* One global latest-success value per job category.
* One value per scheduled run.
* One value per game.
* One global summary plus per-game details.

A global green recompute can conceal that one specific game failed, while a fully per-game monitoring interface could exceed the appetite.

The design document needs the minimum shape that lets William distinguish overall pipeline operation from a stale individual game.

### 8. Who can see operational health?

Pitch 3 names a health read but does not settle whether it is visible to both roles. Projection age and stale state are clearly relevant to viewers because they affect whether a recommendation should be trusted.

Raw ingest, recompute, and price-refresh operations may belong to the admin's private operator layer.

The access rule should distinguish shared currency disclosure from private operational diagnostics rather than treating all health information as one surface.

### 9. How is partial success represented?

A single scheduled cycle may contain several sources, games, or phases. The documents require explicit failure and honest freshness but do not define completion when only part of the work succeeds.

The design document must decide:

* Whether one failed game prevents the whole recompute from recording success.
* Whether each game can have an independent success state.
* Whether ingest can be successful with one optional source degraded.
* What the health surface shows when the slate is partly current.
* How retries update the visible state.

### 10. Does Pitch 5 capture the final pre-kickoff snapshot?

Pitch 6 computes timing cost from decision-time state and the final pre-kickoff state. Pitch 5 owns the game-relative schedule most naturally positioned to capture that final state, but Pitch 5's listed scope does not mention recommendation snapshots or timing-cost support.

Ownership must be assigned deliberately:

* Pitch 5 captures the final pre-kickoff snapshot as pipeline infrastructure, while Pitch 6 grades and interprets it.
* Pitch 6 introduces its own scheduled capture behavior.
* Pitch 4's recommendation snapshot mechanism already captures it through a rule not yet specified.

Leaving this implicit risks reaching Pitch 6 with no trustworthy final comparison point.

### 11. How does the keepalive prove readiness?

The architecture requires a commit before the inactivity deadline, but the product behavior for verifying that protection is not defined.

The design document should determine what evidence is sufficient before the season begins:

* Last successful keepalive.
* Whether scheduled workflows remain enabled.
* Whether required production schedules are present.
* Whether the keepalive action was blocked by repository permissions.
* Whether an in-season readiness check runs before Week 1.

The answer should remain bounded and avoid becoming a repository-management dashboard.

### 12. How are kickoff changes discovered?

Per-game scheduling and staleness depend on the game's recorded kickoff. The documents establish kickoff as the anchor but do not say how quickly schedule changes enter the serving system or whether changed kickoff times cause pending job windows to be reconsidered.

The design document must ensure that a flexed or postponed game follows the updated schedule rather than retaining stale timing assumptions.

### 13. Is a manual recovery path required?

The pitch requires failed jobs to become visible but does not specify how William restores service. A command-line rerun may be sufficient for this small product; an admin control may be more convenient but expands the surface and security burden.

This should be decided before design so the health interface does not accidentally grow a workflow-control panel.

### 14. Which operational requirements need PRD acceptance criteria?

The PRD directly defines **Staleness Disclosure**, including projection age, information cutoff, game-scoped stale state, and list-view visibility. It does not currently define scheduled ingest, game-relative recomputation, scheduled price maintenance, health thresholds, or the keepalive workflow as separately accepted product behavior.

The roadmap clearly requires them, but the pitch-expansion rules require Definition-of-Done conditions to trace to PRD criteria.

The PRD should gain explicit acceptance criteria for:

* Recurring in-week ingest and recomputation.
* Game-day recomputation per kickoff window.
* Per-game recompute scoping.
* Non-blocking slate behavior.
* Last-success health signals and out-of-bounds warnings.
* Duplicate and interrupted run behavior.
* Offseason schedule survival.
* Scheduled price-maintenance ownership.

Until then, those items remain roadmap-backed requirements with an acknowledged traceability gap.

### 15. Which later pitch owns Adjustment Suggestions?

The Pitch 5 roadmap row says adjustment suggestions and ESPN are deferred to Pitch 8. In the same current roadmap, Pitch 8 is **Autonomous Execution & Circuit Breakers**, while **Adjustment Suggestions & Source Reliability** is Pitch 10.

The feature-name boundary is clear, but the numeric reference is stale. The roadmap should be corrected before downstream design documents use pitch numbers as dependencies.
