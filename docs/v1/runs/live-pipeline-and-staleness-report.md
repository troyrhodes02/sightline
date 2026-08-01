# Live Pipeline & Staleness — Run Report

Autonomous pipeline run under the CLAUDE.md Autonomous Pipeline Policy. Completed without halting; no stop condition was triggered.

## What shipped

Sightline now maintains its own serving data through the NFL week and discloses exactly how current it is.

- **Scheduled pipeline** — nightly in-week ingest + recompute (`pipeline-nightly.yml`, 09:00 UTC), a 30-minute game-day dispatcher (`pipeline-gameday.yml` → `sightline-model gameday`) that selects in-window games at run time from stored kickoffs, a 15-minute price cron (`pipeline-prices.yml`) calling the token-authed app route, and a monthly keepalive (`keepalive.yml`) that commits a marker and self-reports. All have `workflow_dispatch` and concurrency groups.
- **Pipeline run recording** — `PipelineRun` / `PipelineRunGame` models (unique `(category, invocationId)` dedup), `IngestRun.pipelineRunId` linkage, per-source and per-game outcomes; Python `sightline-ingest cycle` orchestrator with required (`schedule|pbp|stats|context`) vs optional (`weather`) sources.
- **Staleness Disclosure** — two distinct states computed on read, per game, from the stored kickoff: **stale** (clearable; game-scoped facts with `known_at` past the displayed projection's `information_cutoff`) and **predates inactives** (kickoff−90m boundary; a permanent disclosure this feature — no inactives source exists yet and the product does not pretend otherwise). Projection age and information cutoff on every slate row and in the contract detail Currency block; price age and projection age never merge; no stored staleness column, no background job.
- **Pipeline health** — admin-only `/health`: three per-category last-success signals across six states (`ok|running|late|failed|never_run|not_expected`), per-source ingest detail, per-game recompute completeness, offseason keepalive readiness. Health reports; it never operates.
- **Scheduler routes** — `POST /api/pipeline/price-refresh` and `POST /api/pipeline/keepalive`, bearer-authed via `PIPELINE_SCHEDULER_TOKEN` (constant-time compare; 401 mismatch / 503 unset), reusing the existing Kalshi integration — no second client, no credentials outside the app.
- **Final pre-kickoff snapshot capture** — TS-side capture pass in the price-refresh route (`SnapshotTrigger.final_pre_kickoff`, one per contract via partial unique index). Capture only; grading and timing cost belong to Outcome Scoring & Accuracy Surface.
- **Runbook** — `docs/v1/runbooks/live-pipeline.md`: secrets, keepalive permissions, command-line-only recovery, pre-Week-1 readiness check.

## Tickets and PRs

| Ticket | PR | State |
| --- | --- | --- |
| SIG-46 pipeline run recording + Python cycle orchestration | #45 | squash-merged into feature branch |
| SIG-47 two-state staleness + slate/detail currency UI | #46 | squash-merged |
| SIG-48 six-state health derivation + /health surface | #47 | squash-merged |
| SIG-49 scheduler routes + final snapshot capture + keepalive | #48 | squash-merged |
| SIG-50 GitHub Actions workflows + runbook + e2e | #49 | squash-merged |
| Feature PR | #44 | merged into main at end of run |

Linear: milestone "Live Pipeline & Staleness" in Sightline V1; all five issues carry their PR links. The Sightline team has no "In Review" workflow state (Backlog/Todo/In Progress/Done) — tickets were tracked as In Progress with PR attached; consider adding an In Review state.

## Decisions made on the user's behalf

Eight decisions were pre-resolved in the run instruction (two-state staleness; SIG-25 dependency satisfied; final snapshot captured here; scheduled price jobs invoke the app; health visibility split; per-category health + per-game currency; honest partial success; command-line recovery). The rest, resolved autonomously (full list with rationale in the spec's Resolved Decisions section, RD-1..RD-29):

- **"News-driven" means news-cadence-aligned, not event-triggered** — fixed nightly + game-day cadence; the pitch excludes real-time reaction. (OQ 4)
- **Operating windows** — ingest/recompute late past 26h (24h cadence + 2h scheduler allowance); price refresh hourly in-week / 15-min on game days, late past 2× active cadence; `not_expected` derived from the stored schedule, never hardcoded dates; empty-data success is success; all bounds in one config module. (OQ 5)
- **Keepalive readiness** — monthly marker commit via `GITHUB_TOKEN` (`contents: write`; such commits cannot trigger workflows), then a self-report through the scheduler route so `/health` can render last-acted and next-required-by (+60d); pre-Week-1 check is a runbook step. (OQ 11)
- **Kickoff changes** — discovered by nightly schedule re-ingest; all staleness boundaries and game-day selection evaluate the stored kickoff at run time; no cached job plan. (OQ 12)
- **Snapshot capture lives in TypeScript** (price-refresh route) because `RecommendationSnapshot` is price-derived and the Python runtime must never touch it. (RD-19)
- **Predates-inactives boundary = kickoff−90m**, config `INACTIVES_LEAD_MINUTES`, time-based and permanent this pitch. (RD-23)
- **Final-snapshot window = 45 minutes** — ~3 cron attempts under common scheduler delay. Capture also runs on the coalesced branch (structural no-op) so the once-per-contract guarantee is structural.
- **Kalshi outage during the capture window freezes the last stored book** rather than a null price — the honest final state.
- **`MarketSyncStatus.partial` counts as a failed attempt** for health (spec was silent; a books-missed sync must not read green).
- **Invocation ids** — GitHub runs use `gh:{run_id}:{run_attempt}` (bare `run_id` would silently no-op the documented re-run recovery); manual runs use `manual:<uuid>` (a fixed literal would collide on the unique key).
- **Gameday recompute proceeds after a failed required source** with an honest cutoff, and the tick still records failure — near kickoff, a recompute from the last good facts beats none.
- **Cross-runtime constants pinned by tests** — `GAMEDAY_WINDOW_MINUTES=360` and lookahead 7 days are asserted equal across Python and TS so the runtimes cannot drift silently.
- **Never-recorded keepalive renders em dashes, not amber** — avoids a permanently-amber first month; the runbook's pre-Week-1 check covers the true never-run risk.

## Review findings and dispositions

Adversarial review of the feature branch vs main posted 4 inline findings on PR #44 (review 4835649795); none was an invariant breach. Audited per the review-audit skill, then dispositioned:

1. **Cross-runtime lookahead mismatch (8 vs 7 days)** — valid, in scope → **implemented**: aligned to 7 + cross-runtime pin test.
2. **Postponed game cannot be re-captured after final snapshot** — valid question → **documented known limitation** at the capture site; re-capture semantics assigned to Outcome Scoring & Accuracy Surface. No schema change.
3. **Game-day cutoff captured at tick start** — upgraded from the reviewer's nit after verification: facts ingested during a tick would wait a tick that may never come before kickoff → **implemented** the stronger fix: cutoff read post-ingest (temporal-honesty improvement — those facts are genuinely known then), plus test.
4. **Fatal-path `finish_pipeline_run` could mask the original exception** — valid → **implemented**: guarded in both `cycle.py` and `project_live.py`; abandoned rows resolve via the 120-min health timeout; plus test.

Fixes: commit `5443005`. Audit summary posted on PR #44.

## Deferred

- **Predates-inactives → clearable** when the Adjustment Suggestions feature lands its inactives source (recorded in spec + SIG-47 ticket).
- **Postponed-game final-snapshot re-capture semantics** → Outcome Scoring & Accuracy Surface (code comment at capture site).
- **Weather refresh frequency in game-day selection** — ships as every-selection (cheap, idempotent); noted in spec as non-blocking open question.
- Inherited open questions unchanged: edge vs ask/midpoint; grading truth (Kalshi settlement vs official line); superseded-model-version calibration treatment; RLS on user-scoped tables (remains not enabled per the Kalshi Sync feature's RD-16).

## PRD traceability gaps (for PRD amendment)

The roadmap requires these, but the PRD lacks direct acceptance criteria for them (pitch OQ 14; proceeded per run instruction): recurring in-week ingest and recomputation; game-day recomputation per kickoff window; per-game recompute scoping; non-blocking slate behavior as an operational property; last-success health signals and out-of-bounds warnings; duplicate/interrupted run behavior; offseason schedule survival (keepalive); scheduled price-maintenance ownership. Also worth amending: PRD "stale until inactives are ingested" should read "ingested **and reflected in the projection's information cutoff**", and the roadmap's stale pitch-number references (Adjustment Suggestions is no longer pitch 8).

Other doc drift found during the run: the Kalshi Sync design doc's IA diagram marks Health "(shared)" but the shipped nav and this feature gate it admin-only; the `sightline-ui-design` skill's slate example shows staleness as a top banner, which conflicts with the settled row-chip approach.

## Anything requiring a non-autonomous decision

None. No stop condition arose. (Scope note honored: scheduled jobs are data-only; nothing sizes, stakes, or orders.)

## Verification results

All on the merged feature branch (final state, commit `5443005`):

| Check | Command | Result |
| --- | --- | --- |
| TS lint | `npm run lint` | clean |
| TS types | `npm run typecheck` | clean |
| Format | `npm run format` | clean |
| TS unit/integration | `npm test` | 311 passed / 34 suites |
| Python | `uv run pytest` | 343 passed |
| Build | `npm run build` | succeeded |
| E2E | `npm run test:e2e` | 44 passed / 28 skipped (provisioned-account suites skip without seeded `E2E_*` env — suite convention) |
| Prisma migration replay | fresh scratch DB during review | `prisma migrate deploy` succeeds |

Python lint/format/typecheck are not configured in `pyproject.toml` and were not run (reported honestly, not skipped silently). No backtest re-run was required: no change touched feature computation, the as-of layer semantics, or historical `known_at` handling — the post-ingest cutoff change affects only the live game-day path, which has no stored prior run to compare.

Idempotence readiness (pre-resolved decision 2) was verified at run start: 31 ingest idempotence tests passed before any work began.

## Operational follow-ups (outside the codebase)

Per `docs/v1/runbooks/live-pipeline.md`: set GitHub Actions secrets (production direct-connection DB URL, `APP_BASE_URL`, `PIPELINE_SCHEDULER_TOKEN` — also set in Vercel), confirm Actions is enabled with `contents: write` available to the keepalive workflow, and run the pre-Week-1 readiness check.
