# Runbook — Live Pipeline & Staleness

Everything the scheduled pipeline needs that lives outside the codebase: GitHub
Actions secrets, keepalive permissions, manual re-runs, and the pre-season
readiness check. Recovery is **command-line only** by design (spec RD-P8): the
`/health` surface reports, it does not operate, and no in-product retry exists.

## The four workflows

| Workflow | Schedule (UTC) | What it does | Fails when |
| -------- | -------------- | ------------ | ---------- |
| `pipeline-nightly.yml` | daily 09:00 | `sightline-ingest cycle --scope in-week`, then `sightline-model project`. Offseason ticks record nothing. | A required source (schedule, pbp, stats, context) fails, or any game's recompute fails. |
| `pipeline-gameday.yml` | every 30 min | `sightline-model gameday`: selects games with kickoff inside the next 6 hours from the **stored** schedule, then game-scoped ingest (schedule + context, weather optional) and `project --games`. Selects nothing → writes nothing, exits green. | Required game-day source fails or a selected game's recompute fails. |
| `pipeline-prices.yml` | every 15 min | `curl POST /api/pipeline/price-refresh`. The route decides not-expected / in-week / game-day cadence server-side and runs the final pre-kickoff snapshot capture. | Non-2xx from the route (`curl --fail`): bad/missing token (401), token unset in the deployment (503), or an unexpected route failure. A Kalshi outage is **not** a failure — it records a degraded sync and answers 200. |
| `keepalive.yml` | monthly, 1st 08:00 | Commits `.github/keepalive` (date stamp) to `main` with `GITHUB_TOKEN`, then self-reports to `POST /api/pipeline/keepalive`. | The push is rejected (branch protection — see below) or the self-report gets a non-2xx. |

All four have `workflow_dispatch` for manual runs and per-workflow
`concurrency` groups (`cancel-in-progress: false`) so a delayed run and its
successor serialize instead of overlapping. Duplicate delivery is safe
end-to-end: every phase deduplicates on `(category, invocation_id)`, ingest is
idempotent, projections upsert on their natural key, and final snapshots are
unique per contract.

## Required GitHub Actions secrets

Set under **Settings → Secrets and variables → Actions**:

| Secret | Value | Used by |
| ------ | ----- | ------- |
| `PIPELINE_DATABASE_URL` | The production **direct** (non-pooled, port 5432) service-role connection string — the `DIRECT_URL` value from the production environment, *not* the pooled `DATABASE_URL`. | nightly, gameday |
| `APP_BASE_URL` | The production application origin, e.g. `https://sightline.example.vercel.app`. No trailing-slash requirement (the workflows strip one). | prices, keepalive |
| `PIPELINE_SCHEDULER_TOKEN` | The scheduler bearer token. Generate with `openssl rand -hex 32` (min 32 chars). The **same value** must be set as the `PIPELINE_SCHEDULER_TOKEN` environment variable in Vercel (production), or the route answers 503 and the price/keepalive jobs stay red. | prices, keepalive |

Rotation: generate a new value, update Vercel first, then the GitHub secret.
The token grants exactly two actions (trigger a price refresh, record a
keepalive) and cannot read or write anything else.

## Keepalive permissions

- The workflow declares `permissions: contents: write` — the minimum needed to
  push the marker commit. No PAT, no deploy key: the ephemeral `GITHUB_TOKEN`
  is deliberate, because commits it makes **cannot trigger other workflows**
  (no keepalive→CI→keepalive loops, and no CI minutes burned monthly).
- **Branch-protection caveat:** if `main` ever gains a protection rule
  requiring PRs or blocking pushes, the keepalive push will be rejected and
  every schedule will die the following offseason. Either exempt the
  `github-actions[bot]` actor via a bypass list, or revisit the mechanism
  *before* enabling the rule. The failed run is visible in Actions and, once
  the self-report stops arriving, as an overdue keepalive on `/health`.
- The marker file is `.github/keepalive`, read by nothing. A keepalive commit
  must never touch anything else.

## Manual re-runs (recovery)

Failed runs re-run from the GitHub UI (**Actions → workflow → Re-run failed
jobs**) or the CLI. A re-run is a new run attempt, so it records a fresh
logical cycle rather than being deduplicated against the failed one.

```sh
# From the repo, with gh authenticated:
gh workflow run pipeline-nightly.yml
gh workflow run pipeline-gameday.yml
gh workflow run pipeline-prices.yml
gh workflow run keepalive.yml
```

Local command-line equivalents (repo checkout, production env configured —
`INGEST_DATABASE_URL` set to the direct production DSN):

```sh
# Nightly cycle by hand:
cd python
uv run sightline-ingest cycle --scope in-week
uv run sightline-model project

# Game-day dispatch by hand:
uv run sightline-model gameday

# Price refresh / keepalive report by hand (any shell with the token):
curl --fail -X POST "$APP_BASE_URL/api/pipeline/price-refresh" \
  -H "Authorization: Bearer $PIPELINE_SCHEDULER_TOKEN"
```

Manual CLI runs without `--invocation-id` self-assign a unique
`manual:<uuid>` id — they never collide with scheduled cycles and never
dedupe against each other.

A failed run leaves the last completed projections serving with honest age
and staleness; there is nothing to clean up before re-running. Ingest and
recompute are idempotent over overlapping windows, so re-running "too much"
is safe by construction.

## Pre-Week-1 readiness check (each September)

Run before the first Thursday kickoff:

1. `gh workflow list` — all four workflows show **active**. GitHub disables
   schedules after 60 days without a default-branch commit; if any show
   *disabled*, re-enable (`gh workflow enable <name>`) and investigate why the
   keepalive lapsed.
2. `git log --oneline -5 -- .github/keepalive` — the newest marker commit is
   less than 60 days old.
3. `/health` (as admin) — the Offseason readiness block shows the keepalive's
   last action and a next-required-by in the future. **Note:** if no keepalive
   self-report has ever been recorded (fresh database), this block shows em
   dashes rather than a warning; treat step 2 as authoritative until the first
   monthly run lands.
4. Confirm the three secrets above still exist and the Vercel
   `PIPELINE_SCHEDULER_TOKEN` still matches (a mismatch shows up as red
   `pipeline-prices` runs answering 401).
5. Optionally trigger `gh workflow run pipeline-nightly.yml` once and confirm
   `/health` shows a fresh ingest and recompute success.

## What the health surface can and cannot tell you

`/health` (admin-only) derives ingest and recompute signals from recorded
`PipelineRun` cycles, and the price signal from `MarketSyncRun` — completed
successful runs only. A workflow that never starts (disabled schedule, dead
repository) records nothing, which surfaces as a **late** signal once the
expected window passes, not as a failure event. GitHub Actions run history is
the diagnostic layer underneath; the product deliberately does not mirror it
(no logs, no traces, no retry controls — spec Explicit non-goals).
