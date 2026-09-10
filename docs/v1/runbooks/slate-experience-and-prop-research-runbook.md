# Runbook — Slate Experience & Prop Research (Pitch 10)

Everything needed outside the codebase to operate this feature: how automatic price
refresh is scheduled, the advisory-lock and freshness configuration, how to seed the
300-contract performance fixture, and how to run the LCP comparison manually if the CI
gate needs re-verification.

This pitch adds **no new infrastructure, no new scheduler, no second Kalshi client, and
no new credential location.** It reuses the existing server-side Kalshi integration and
the existing GitHub Actions schedule.

---

## 1. Automatic Kalshi price refresh

Routine price freshness no longer depends on anyone pressing a button. There are two
paths, and they are deliberately different tools for different jobs.

### 1.1 Primary path — on-view lazy refresh (no scheduler)

- Opening or returning to the Slate triggers a **freshness-gated** refresh from the
  browser to Sightline's own route `POST /api/prices/refresh` (the one sanctioned
  client→Sightline fetch — the browser never talks to Kalshi).
- The client island (`src/components/slate/SlatePoller.tsx`) fires on mount and on
  `visibilitychange → visible`, but **only if** the freshest stored price is older than
  `PRICE_ONVIEW_FRESHNESS_SECONDS`. A page nobody is looking at is never refreshed on its
  behalf. A bare interval remains as a while-open backstop; both pause while the tab is
  hidden.
- The "~5 minutes" target from the pitch is expressed as this **freshness interval**, not
  as a scheduler cadence.

**Configuration (`src/env.ts`):**

| Env var | Default | Meaning |
| ------- | ------- | ------- |
| `PRICE_ONVIEW_FRESHNESS_SECONDS` | `300` | On-view "should we bother refreshing?" threshold (≈5 min). |
| `SLATE_REFRESH_INTERVAL_SECONDS` | `60` | While-open backstop poll interval. |
| `KALSHI_SYNC_MIN_INTERVAL_SECONDS` | (existing) | Server-side coalescing window: a completed sync inside this window answers for a new request without contacting Kalshi. |

Tuning: to make prices refresh more/less eagerly for viewers, change
`PRICE_ONVIEW_FRESHNESS_SECONDS`. This does not change any Kalshi rate-limit exposure
because the server still coalesces and holds the advisory lock (below).

### 1.2 Backstop path — the existing GitHub Actions schedule (UNCHANGED)

The scheduled price refresh predates this pitch and is **not modified** by it:

- Workflow: `.github/workflows/pipeline-prices.yml` → `POST /api/pipeline/price-refresh`
  on its existing cron (every 15 min), authenticated with the machine bearer token
  `PIPELINE_SCHEDULER_TOKEN` (`src/lib/pipeline/auth.ts`).
- Server-side cadence gating: `src/lib/pipeline/cadence.ts` (`decidePriceRefreshAction`)
  with constants in `src/lib/health/config.ts` (`PRICE_IN_WEEK_CADENCE_MINUTES=60`,
  `PRICE_GAMEDAY_CADENCE_MINUTES=15`, `GAMEDAY_PRICE_WINDOW_HOURS=6`,
  `SEASON_LOOKAHEAD_DAYS=7`).

**Do not** raise this cron toward a 5-minute ticker — the GitHub Actions schedule has no
timing SLA and finite private-repo minutes (see the pitch's rabbit hole). The on-view
path is what keeps a viewer's prices fresh; the schedule is only a backstop for windows
when nobody is looking.

### 1.3 Duplicate-refresh prevention — Postgres advisory lock

`src/lib/kalshi/refresh-lock.ts` → `withPriceRefreshLock(marketSetKey, acquired, onBusy)`.

- Uses a **transaction-scoped** `pg_try_advisory_xact_lock(hashtext(key))`, key
  `PRICE_REFRESH_LOCK_KEY = "price-refresh:v1"`.
- The single lock-holder runs `runMarketSync` (the one upstream Kalshi call). A concurrent
  caller that cannot acquire the lock runs `latestCoalescedResult` — **no upstream call**
  — and reads whatever price the in-flight refresh lands.
- The lock **auto-releases at transaction end**, so a crashed request can never leave it
  held. There is no manual TTL to expire or leak.
- This is what guarantees "concurrent viewers produce exactly one upstream Kalshi call."

No configuration is required; it works on the existing Supabase Postgres. If you ever
split refresh per-slate, pass a distinct `marketSetKey`.

### 1.4 Manual refresh — admin diagnostic only

The manual "Refresh prices" control renders only for the admin (gated in
`src/components/screens/Slate.tsx` via the `isAdmin` prop). Viewers never see it and are
never responsible for refreshing. It is a recovery/debug control, unnecessary for normal
operation.

---

## 2. Prop Research

No operational configuration. `/research` reads current stored **base** projections
(`src/lib/research/read.ts`) and evaluates arbitrary thresholds client-side via the pure
`probAtLeast` (`src/lib/slate/probability.ts`) — no model run, no price input, never an
edge. It is available to viewers and admin. Nothing to schedule or provision.

---

## 3. Performance fixture & LCP gate

### 3.1 Seed the 300-contract fixture

```bash
# Requires DATABASE_URL / DIRECT_URL pointing at a disposable Postgres.
npm run db:seed:slate:perf          # → prisma/seed-slate-perf.ts
```

This seeds a realistic full-NFL-Sunday slate (multiple games, players, thresholds per
player/stat) totalling ~300 contracts, deterministically, so LCP is measured against a
production-size surface.

### 3.2 Run the LCP comparison manually

`/slate` is authenticated, so the runner signs in and reads the real LCP web-vital
(the same metric Lighthouse reports) via a Playwright project.

```bash
# 1. Provision a Postgres and point the app at it; run migrations + seed:
npx prisma migrate deploy
npm run db:seed:slate:perf

# 2. Provide the auth + Supabase env the e2e harness uses
#    (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_SUPABASE_* — same as authenticated e2e).

# 3. Run the measurement:
npm run perf:slate-lcp              # → playwright test perf-slate-lcp --project=desktop
#    Without a DB/accounts it SKIPS (never falsely passes).

# 4. Enforce the ≥30% gate (fails if the branch is not ≥30% below the baseline):
PERF_ENFORCE_LCP=1 npm run perf:slate-lcp
```

- Gate math: `src/lib/perf/lcpCompare.ts` (pure, unit-tested). It **refuses to compare**
  against a placeholder baseline (`comparabilityReason`), so the gate cannot manufacture a
  pass or fail from a null baseline.
- Baseline artifact: `docs/v1/perf/slate-lcp-baseline.json`. Full procedure for capturing
  the one-time pre-change baseline in the provisioned CI environment is in
  `docs/v1/perf/README.md`.
- Run artifact: `slate-lcp-latest.json` (baseline → current, % reduction, required bar,
  PASS/FAIL) plus a verdict line in the log.

### 3.3 CI gate

- Job `perf-slate-lcp` in `.github/workflows/ci.yml` stands up a Postgres service, applies
  migrations, seeds the fixture, signs in with the `E2E_ADMIN_*` / `E2E_SUPABASE_*`
  secrets, measures LCP, and — with `PERF_ENFORCE_LCP=1` — fails the build unless the ≥30%
  reduction is met.
- **The gate goes live once a real pre-change baseline is committed** per
  `docs/v1/perf/README.md`. Until then the committed baseline is `"measured": false` and
  the comparison abstains rather than fabricating a verdict.

---

## 4. Admin navigation / authorization (operational note)

Accuracy (and model comparison) and the standalone Suggestions surface are now
admin-only, gathered under the **Admin** menu. Every relocated route is enforced
server-side (`requireAdmin`), so a viewer's stale bookmark or shared link to `/accuracy`,
`/accuracy/overrides`, `/autonomy`, or `/suggestions` is rejected in place with a 403 —
this is authorization, not just hidden navigation. No operational configuration; noted
here because a viewer reporting "I lost access to Accuracy" is expected and correct.
