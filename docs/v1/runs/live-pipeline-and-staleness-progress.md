# Live Pipeline & Staleness — Run Progress

Autonomous pipeline run under CLAUDE.md Autonomous Pipeline Policy.
Slug: `live-pipeline-and-staleness`. Linear project: Sightline V1.

## Current step

**Steps 4–5 complete** — spec written (`docs/v1/specs/live-pipeline-and-staleness-spec.md`) with Resolved Decisions RD-1..RD-29 (all open questions resolved; none outstanding). Key spec shapes: `PipelineRun` + `PipelineRunGame` models (unique `(category, invocationId)`), `IngestRun.pipelineRunId` linkage, `SnapshotTrigger.final_pre_kickoff` + partial unique index (one final snapshot per contract), price-refresh health derives from existing `MarketSyncRun`; routes `POST /api/pipeline/price-refresh` + `POST /api/pipeline/keepalive` authed by `PIPELINE_SCHEDULER_TOKEN` bearer (constant-time compare, 401 mismatch, 503 unset); no GET /api/health route (server-component read only); Python `sightline-ingest cycle --scope in-week --invocation-id` (required sources schedule|pbp|stats|context, optional weather) and `sightline-model project --games` per-game recording; workflows pipeline-nightly.yml (daily 09:00 UTC), pipeline-gameday.yml (30-min dispatcher), pipeline-prices.yml (15-min curl), keepalive.yml (monthly marker commit via GITHUB_TOKEN, then self-report). Snapshot capture is TS-side in the price-refresh route (RD-19). Predates-inactives boundary = kickoff−90m (RD-23). Six-state precedence + 120-min running timeout (RD-25).
**Step 3 complete** — UI preview written (`docs/v1/ui/live-pipeline-and-staleness-ui-preview.html`). Frames: slate mixed states (desktop+phone), contract detail Currency block ×3 cases (+phone), health all-healthy/degraded/never-run/running/offseason-ok/offseason-overdue (+phone), states section (skeletons, empty offseason, Kalshi-degraded, viewer nav with Health absent), legend + footer.
Preview rendering decisions the spec must honor: phone rows put chips+ages on a third line; `running` renders as `current attempt · started <t>` under last-success; overdue keepalive = `overdue` chip on readiness block + inline caution alert; Kalshi-degraded rows keep price age from last successful fetch (two clocks never merge).
**Next: Step 4** — `/sightline-spec` → `docs/v1/specs/live-pipeline-and-staleness-spec.md`.

Design doc key decisions (later steps must honor):
- Three surfaces only: Slate (delta), Contract detail (delta), Pipeline Health at `/health` (admin-only; replaces Pitch 3 placeholder). No new routes/nav items.
- Two staleness states as row chips via existing `StatusChip`: `stale` = caution tone + warning icon; `predates inactives` = neutral tone, no icon, never reads as failure. Can co-occur; render on row and detail; never dropped at `xs`. Row chips, not banners (banner region stays owned by Kalshi refresh outcomes).
- Projection age appended to row timestamps line as `proj Thu 9:12a (2d 4h)`; ages-only at `xs`; price age and projection age never merge.
- Detail Provenance block → **Currency block**: computed-at + age, information cutoff, model version, one explanatory sentence per active staleness state.
- Health: three signal blocks fixed order (Ingest, Projection recomputation, Price refresh); six states ok/running/late/failed/never run/not expected; `not_yet_implemented` state retires. Per-source detail (failed required ⇒ parent failed; degraded optional ⇒ parent ok w/ visible detail); per-game completeness ("12 of 14 games current"); Offseason readiness block (keepalive last-acted, next-required-by, amber when overdue).
- No mutations/notifications/polling on health; staleness server-computed (client does no clock math); recompute landing clears chips in place via existing poll, no toast.
- Components: new `CurrencyBlock`, `HealthSignalBlock`, `SourceDetail`, `GameCompleteness`, `OffseasonReadiness`; extended `RowTimestamps`/`RelativeTimestamp`, `HealthStateChip`. `HealthSignalState` union in src/lib/health/types.ts changes at spec level.
- Noted inconsistencies for run report: Pitch 4 design doc IA marks Health "(shared)" but shipped nav gates it adminOnly (matches this pitch); ui-design skill's slate example uses a staleness banner which conflicts with settled row-chip approach; SlateRowDto carries informationCutoff unused today — spec adds staleness object + age fields.

## Pipeline steps

1. [x] Pull pitch doc from Linear → `docs/v1/pitches/live-pipeline-and-staleness.md`
2. [ ] Design doc → `docs/v1/design-docs/live-pipeline-and-staleness-design-doc.md`
3. [ ] UI preview → `docs/v1/ui/live-pipeline-and-staleness-ui-preview.html`
4. [ ] Spec → `docs/v1/specs/live-pipeline-and-staleness-spec.md`
5. [ ] Resolve remaining open questions as Resolved Decisions
6. [ ] Milestone + Linear issues chained with blockedBy; identifiers recorded below
7. [ ] Feature PR into main
8. [ ] Work every ticket in order (branch chaining; PR per ticket)
9. [ ] Runbook
10. [ ] Squash-merge ticket PRs into feature branch in order
11. [ ] Full verification suite on feature branch
12. [ ] /review feature branch vs main; findings as inline comments on feature PR
13. [ ] /sightline-review-audit; disposition each finding
14. [ ] Re-verify; squash-merge feature branch into main
15. [ ] Run report → `docs/v1/runs/live-pipeline-and-staleness-report.md`

## Pre-resolved decisions (from run instruction — treat as approved-doc authority)

1. Staleness splits into two distinct states: **stale (clearable)** vs **predates inactives (not clearable this pitch; permanent disclosure)**. Forward dependency: Adjustment Suggestions converts predates-inactives to clearable. (Resolves OQ 1 + 6.)
2. Cleanup sprint dependency resolved: SIG-25 merged; verify overlapping-window ingest idempotence holds (zero writes, zero corrections, no error) — halt if regressed. (OQ 2.)
3. This pitch captures the final pre-kickoff snapshot as pipeline infrastructure; no grading/scoring/timing-cost. (OQ 10.)
4. Scheduled price jobs invoke an authenticated route in the TS app, reusing existing Kalshi integration; no second client; no creds in Python. (OQ 3.)
5. Health visibility: currency disclosure shared with all authenticated users; operational diagnostics admin-only. (OQ 8.)
6. Health unit: three global per-job-category last-success signals + per-game currency via staleness. No per-game health monitoring. (OQ 7.)
7. Partial success honest: per-source ingest success (green only if all required sources succeed; degraded optional ≠ failed required); per-game recompute success; no single pipeline timestamp. (OQ 9.)
8. Recovery is command-line only, documented in runbook. No admin retry control. (OQ 13.)
- OQ 15: reference dependencies by feature name, never pitch number.
- OQ 14: proceed; record PRD traceability gaps in run report.

## Remaining open questions — resolved (to be restated in spec as Resolved Decisions)

- **OQ 4 (resolved):** "News-driven" means news-cadence-aligned, not event-triggered. The schedule is fixed: nightly in-week ingest+recompute, plus game-day recompute per kickoff window. No event-triggered recomputation exists in this pitch. Rationale: roadmap DoD specifies nightly + morning-of mechanics; the pitch excludes real-time reaction.
- **OQ 5 (resolved):** Expected operating windows are configuration with these defaults: ingest and recompute signals are late when last success exceeds 26h (24h cadence + 2h scheduler-delay allowance); scheduled price refresh runs hourly in-week and every 15 min on game days (first kickoff −6h through last kickoff), late when last success exceeds 2× the active cadence. Game-day recompute lateness surfaces per game through staleness/per-game completeness, not through the global signal. Empty-data success is a valid success. "Not expected" derives from the stored schedule (no upcoming games in lookahead window), never from hardcoded dates. All bounds live in one config module.
- **OQ 11 (resolved):** Keepalive: scheduled workflow (monthly) commits a trivial marker file to the default branch with minimum `contents: write` permission, then reports its action through the same authenticated scheduler-reporting path other jobs use, so the app can render last-acted and next-required-by (last action + 60d, amber when within safety margin of overdue or past it). Pre-Week-1 readiness check is a runbook step (gh: verify workflows still enabled), not product UI.
- **OQ 12 (resolved):** Kickoff changes are discovered by the nightly schedule re-ingest (existing schedule source). Staleness boundaries and game-day job selection always evaluate against the currently stored kickoff at evaluation time — the scheduled dispatcher selects in-window games per invocation from the DB; no precomputed job plan is cached. A flexed/postponed game follows its updated kickoff within one ingest cycle.

## Resolved Decisions so far

(recorded in spec as made; none yet beyond pre-resolved list)

## Verifications

- 2026-08-01: SIG-25 ingest idempotence verified — `uv run pytest tests/test_core_fact_ingest.py tests/test_context_ingest.py tests/test_weather_ingest.py tests/test_reference_ingest.py tests/test_identities_ingest.py tests/test_provenance.py` → 31 passed. Idempotent re-run/overlap tests included (test_pbp_ingest_reconstructs_known_at_and_is_idempotent, test_stats_ingest_records_line_and_is_idempotent, test_reingesting_same_snapshot_is_idempotent, etc.). Pre-resolved decision 2's readiness condition holds.

## Linear identifiers

- Team "Sightline": 3f4b8d71-c375-4309-92a2-e7fa7cb3c11b
- Project "Sightline V1": ee9590bc-2cf0-4ca1-9e19-9a7d9c26b084
- Pitch doc: ade03680-7ae2-4cac-b95e-74c9c5347fd8

## Tickets

Milestone "Live Pipeline & Staleness" (47d2e95e-96fa-4104-a238-4b3984124828) in Sightline V1. Work in this order (blockedBy chain 46←47←48←49←50; 50 also blocked by 47, 48):

1. [x] **SIG-46** — DONE. PR #45 (base feature branch): https://github.com/troyrhodes02/sightline/pull/45, branch `wtrhodesdev/sig-46-pipeline-run-recording-pipelinerunpipelinerungame-schema`. Migration `20260801184005_pipeline_run_recording` (PipelineRun, PipelineRunGame, IngestRun.pipeline_run_id, SnapshotTrigger.final_pre_kickoff, partial unique idx one-final-snapshot-per-contract; applied to :54332 and :5433). New python pipeline.py + cycle.py + CLI `sightline-ingest cycle`; project_live.py `--games`/`--invocation-id` per-game transactions. Verification: pytest 331 passed; lint/typecheck/format clean; jest 217 passed; build ok; test:schema 16/16. Python lint/format/typecheck not configured in pyproject — not run (honest report). Deviations: manual invocation ids are `manual:<uuid>` (fixed literal would collide on unique key); Linear team has NO "In Review" state — convention: In Progress + PR attached = in review.
2. [x] **SIG-47** — DONE. PR #46 (base SIG-46 branch): https://github.com/troyrhodes02/sightline/pull/46, branch `wtrhodesdev/sig-47-staleness-disclosure-two-state-staleness-computation-on-read`. New src/lib/slate/staleness.ts (evaluateStaleness/formatAge/inactivesExpectedAt), staleness-read.ts (batched RD-22 fact-group reads, no N+1), env INACTIVES_LEAD_MINUTES (default 90), StalenessDto + ages on SlateRowDto (null iff no projection), read.ts wiring, SlateRow chips + RowTimestamps ages, ContractDetail Currency block. 246 jest tests passed; lint/typecheck/format/build clean. No spec deviations.
3. [x] **SIG-48** — DONE. PR #47 (base SIG-47 branch): https://github.com/troyrhodes02/sightline/pull/47, branch `wtrhodesdev/sig-48-pipeline-health-six-state-derivation-admin-health-surface`. New health/config.ts (all bounds one module), derive.ts (RD-25 precedence, keepalive readiness), rewritten read.ts (PipelineRun + MarketSyncRun; per-source from cycle-linked IngestRun only; per-game completeness; offseason object), Health.tsx full design-doc layout, six-state HealthSignalState (`not_yet_implemented` retired). 273 jest passed; lint/typecheck/format/build clean. Deviations (run-report): MarketSyncStatus.partial ⇒ failed attempt (spec silent; RD-P7); ingest_runs structural guard narrowed to pipelineRunId-filtered reads; readHealthSignals() removed in favor of readHealth(); never-recorded keepalive shows em dashes not amber (SIG-50 runbook covers pre-Week-1 check).
4. [x] **SIG-49** — DONE. PR #48 (base SIG-48 branch): https://github.com/troyrhodes02/sightline/pull/48, branch `wtrhodesdev/sig-49-scheduler-routes-token-authed-price-refresh-with-final-pre`. New pipeline/auth.ts (constant-time token verify, ok|unauthorized|unconfigured → 401/503 split), cadence.ts (not_expected|coalesced|sync from stored schedule), final-snapshot.ts (RD-19 capture, FINAL_SNAPSHOT_WINDOW_MINUTES=45, idempotent via partial unique idx + P2002 tolerance, freshest stored state), keepalive.ts (zod, upsert per {workflowRunId}:{sha}), two routes, PIPELINE_SCHEDULER_TOKEN env. 311 jest passed; lint/typecheck/format/build clean. Resolved-Decision additions for run report: 45-min capture window (≈3 cron attempts); capture pass also runs on coalesced branch (structural no-op); Kalshi outage during window freezes last stored book (honest final state).
5. [x] **SIG-50** — DONE. PR #49 (base SIG-49 branch): https://github.com/troyrhodes02/sightline/pull/49, branch `wtrhodesdev/sig-50-github-actions-workflows-nightly-game-day-dispatcher-price`. Four workflows (pipeline-nightly 09:00 UTC, pipeline-gameday 30-min via new `sightline-model gameday`, pipeline-prices 15-min curl --fail, keepalive monthly marker + self-report; all workflow_dispatch + concurrency groups; invocation ids `gh:{run_id}:{run_attempt}`), python gameday.py (RD-24/RD-Q12), runbook docs/v1/runbooks/live-pipeline.md, e2e/pipeline.spec.ts. Verification: pytest 340 passed; lint/typecheck/format clean; jest 311; build ok; e2e 44 passed / 28 skipped (provisioned-account suites skip without seeded E2E_* env — suite convention). Deviations (run report): invocation ids include run_attempt (bare run_id would no-op documented re-run recovery); gameday recompute proceeds after failed required source with honest cutoff + recorded failure; stale-chip e2e limited to payload shape (no e2e seeding path — jsdom suites cover rendering); GAMEDAY_WINDOW_MINUTES=360 pinned cross-runtime by unit test.

**Steps 12–15 complete.** Review posted 4 inline findings on PR #44 (review 4835649795; 0 blocking, no invariant breaches). Audit: findings 1/3/4 implemented (commit 5443005 — lookahead pinned to 7 cross-runtime, game-day cutoff read post-ingest, fatal-path exception masking guarded), finding 2 documented as known limitation (postponed-game re-capture → Outcome Scoring & Accuracy Surface). Post-fix verification all green: pytest 343, jest 311, lint/typecheck/format clean, build ok, e2e 44 passed/28 skipped. Run report: `docs/v1/runs/live-pipeline-and-staleness-report.md`. Feature PR #44 squash-merged into main as the final action of the run.

**Steps 8–11 complete.** Ticket PRs #45–#49 squash-merged into `feature/live-pipeline-and-staleness` in order (each later branch rebased onto updated feature before merge; feature log: f0e0390 SIG-46, 67cf64e SIG-47, 6a5f7c7 SIG-48, 39ffb1d SIG-49, b24b444 SIG-50). Full suite on merged feature branch, all green: eslint clean, tsc clean, prettier clean, jest 311/311 (34 suites), pytest 340/340, next build ok, playwright 44 passed / 28 skipped (provisioned-account suites skip without seeded E2E_* env — convention). Next: step 12 — /review feature branch vs main, findings as inline comments on PR #44; then step 13 audit, step 14 merge, step 15 report.

## Branches / PRs

- Feature branch: `feature/live-pipeline-and-staleness` — PR #44 into main: https://github.com/troyrhodes02/sightline/pull/44 (docs committed: pitch, design doc, preview, spec, progress)
- Ticket branch convention: SIG-46 branches off `feature/live-pipeline-and-staleness`; each subsequent ticket branches off the previous ticket's branch. Ticket PR base = the branch it forked from (so each PR diff shows only its own ticket). At step 10, squash-merge in order into the feature branch, rebasing each subsequent ticket branch onto the updated feature branch before its merge.

## Deferred

(none yet)
