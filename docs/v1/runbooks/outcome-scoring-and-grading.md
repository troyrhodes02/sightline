# Runbook — Outcome Scoring & Grading

Everything needed outside the codebase to operate outcome ingest, grading, and the accuracy surface. Companion to `docs/v1/specs/outcome-scoring-and-accuracy-surface-spec.md` and the existing `live-pipeline.md` runbook, whose conventions (secrets, invocation ids, dormancy) this feature reuses.

## What runs, where, and when

| Job | Runtime | Trigger | Workflow | Records |
| --- | ------- | ------- | -------- | ------- |
| Outcome ingest (Kalshi settlements) | TypeScript, `POST /api/pipeline/outcome-ingest` | `cron: 30 * * * *` (hourly at :30) | `.github/workflows/pipeline-outcomes.yml` | `PipelineRun{category: outcome_ingest}`, `Outcome` rows |
| Grading (projections vs official line) | Python, `sightline-ingest grade` | Nightly, after ingest + recompute | `.github/workflows/pipeline-nightly.yml` (grade step) | `PipelineRun{category: grading}` + per-game rows, `ProjectionGrade`, `ThresholdGrade` |

Both jobs are idempotent by comparison: re-running against unchanged inputs writes nothing. Both write no `PipelineRun` row when there is nothing to do (`not_expected` — quiet weeks and the offseason are silent by design, and health judges expectedness from pending work, not from the calendar).

Official results themselves continue to arrive through the existing nightly stats ingest (Historical Data Ingest); no new job ingests them.

## Secrets and configuration

No new secrets. The outcomes workflow reuses the live-pipeline set:

| Secret | Used by | Notes |
| ------ | ------- | ----- |
| `APP_BASE_URL` | `pipeline-outcomes.yml` | Target of the curl POST |
| `PIPELINE_SCHEDULER_TOKEN` | `pipeline-outcomes.yml` → route auth | Unset in Vercel ⇒ route returns 503 and nothing ingests — the same failure mode as price refresh |
| `PIPELINE_DATABASE_URL` | `pipeline-nightly.yml` grade step (as `INGEST_DATABASE_URL`) | Direct connection, not the pooler, per the Python-side rule |

Expected-bounds constants are deliberate code constants, not env vars: `OUTCOME_INGEST_LATE_AFTER_HOURS = 3` and `GRADING_LATE_AFTER_HOURS = 26` in `src/lib/health/config.ts`.

## First deployment checklist

1. Merge to `main`, let Vercel deploy. Run the Prisma migration against production the usual way (`npx prisma migrate deploy` with the direct URL) **before** the first scheduled run needs the new tables.
2. Confirm the two workflows are enabled under Actions (a fork/renamed default branch disables crons).
3. **Verify the Kalshi settlement vocabulary against reality** (spec §16 Q3 — deliberately deferred to deploy). Trigger one manual outcome ingest (below) during a week with freshly settled markets and inspect the response: a high `unavailable` count with settled markets present means Kalshi's `result` strings differ from the conservative mapping (`yes`/`no`/void-family → `voided`; empty string = not settled yet). The stored `Outcome.rawResult` column carries Kalshi's verbatim string for diagnosis. Unmappable strings are never fabricated into results, so a vocabulary surprise degrades honestly — but fix the mapping promptly or nothing contract-facing grades.
4. After the first completed game week: check `/health` shows `outcome ingest` and `grading` with recent successes and an awaiting-grades count of zero, and `/accuracy` shows a graded-through week.

## Manual operations

All recovery is command-line; the health surface reports and never operates.

### Trigger outcome ingest manually

```powershell
$token = "<PIPELINE_SCHEDULER_TOKEN>"
$body = @{ invocationId = "manual:$([guid]::NewGuid())" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://<app-host>/api/pipeline/outcome-ingest" `
  -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body
```

Response fields: `contractsConsidered`, `outcomesWritten`, `outcomesSuperseded`, `unavailable`, `degraded`. `degraded: true` means Kalshi was unreachable mid-run; whatever was fetched is kept and the run is recorded failed, so the health signal will not advance — re-run once Kalshi recovers.

### Run grading manually / regrade after a stat correction

Stat corrections arrive through the ordinary nightly stats ingest (they bump `player_game_stats.version` and append a `player_game_stat_corrections` row). Nothing else needs to happen: the next grading cycle detects version drift and regrades exactly the affected rows. To force it immediately instead of waiting for the nightly run:

```powershell
cd python
$env:INGEST_DATABASE_URL = "<direct-connection-url>"
uv run sightline-ingest grade --invocation-id "manual:$([guid]::NewGuid())"
```

Safe to run any time: unchanged rows are skipped by `gradedStatVersion` comparison; a game's grades commit atomically; a re-run after an interrupt picks up exactly the ungraded games. The same command handles: a missed nightly run, a `missing_official_result` backlog after a stats-source outage (grades upgrade automatically once the line arrives), and any correction-driven regrade. Aggregates need no refresh step — the accuracy surface computes them on read.

### Changed or corrected Kalshi settlement

Nothing manual. The hourly ingest re-checks contracts whose games completed within the last 7 days; a changed result updates the `Outcome` row with supersession provenance (`previousResult`, `previousRecordedAt`, `supersededCount`) and every read-time recommendation/decision grade follows immediately. A settlement changed *later* than 7 days after the game will not be caught automatically — if Kalshi announces one, run a manual ingest within a widened window by temporarily adjusting the window constant, or simply verify the row and update expectations; do not hand-edit the database.

### Workflow-level failures

Same posture as the live pipeline runbook: GitHub Actions cron has no SLA and failures are silent — the health surface is the alarm. `outcome ingest` late (>3h in season) or `grading` late (>26h) with a non-zero awaiting-grades count means a workflow stopped firing: check the Actions tab, re-run the workflow or use the manual commands above. The monthly keepalive workflow protects these crons from the 60-day disablement like every other schedule; nothing new to do.

## What healthy looks like

- `/health` (admin): `outcome ingest` and `grading` rows with recent timestamps and no chips; awaiting-grades sub-line absent (zero).
- `/accuracy` (any user): freshness line current ("Graded through Wk N · last grading cycle …"), no delay disclosure.
- Sunday cadence: settlements begin landing late Sunday night through Monday (hourly ingest); model grades appear after Monday's nightly run (~4–5am ET). Contract-facing outcomes are therefore visible before projection grades — expected, disclosed by design, and not a fault.

## What this feature never does — do not "fix" these

- No stored aggregates: accuracy reads compute from grade rows on every request. There is no cache to warm or refresh job to add.
- No retry buttons or run history in the UI; recovery is this runbook.
- Python never reads `outcomes`, `price_observations`, or `recommendation_snapshots` (enforced by `python/tests/test_import_graph.py`). Contract-facing grading is TypeScript-only.
- Settlements and official results are never reconciled into one number; `sources disagree` on a contract is a fact to display, not a data bug to clean up.
- Grade tables are derivable data — rebuildable from projections + official stats by one full grading run. Decisions and positions remain the only unreconstructible data.
