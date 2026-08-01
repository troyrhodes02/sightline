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

1. [ ] **SIG-46** — Pipeline run recording: PipelineRun/PipelineRunGame schema + Python cycle orchestration with per-game scoping
2. [ ] **SIG-47** — Staleness Disclosure: two-state staleness computation on read + slate/detail currency UI (blocked by 46)
3. [ ] **SIG-48** — Pipeline health: six-state derivation + admin /health surface (blocked by 46, 47)
4. [ ] **SIG-49** — Scheduler routes: token-authed price refresh + final pre-kickoff snapshot capture + keepalive report (blocked by 46, 48)
5. [ ] **SIG-50** — GitHub Actions workflows + runbook + e2e (blocked by 47, 48, 49)

## Branches / PRs

(feature branch/PR not yet opened)

## Deferred

(none yet)
