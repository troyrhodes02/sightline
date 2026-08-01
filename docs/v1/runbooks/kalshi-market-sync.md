# Runbook — Kalshi Market Sync, The Slate & Decision Log (Pitch 4)

Everything needed **outside the codebase** to operate this pitch: Kalshi API
access, environment variables, projection persistence, and the first-slate
workflow. The same environment values configured here are needed again as **CI
secrets when Pitch 5 moves sync and projection onto GitHub Actions** — record
them somewhere durable now rather than re-deriving them then.

## 1. Kalshi API access

Sightline reads Kalshi's **trade API v2 market data**: series, events, markets,
and books. In this pitch it never places an order, never reads a portfolio, and
never needs trading permissions.

- **Unauthenticated works.** Kalshi's market-data GETs are public; Sightline
  runs without any Kalshi credential configured. Start here.
- **An API key raises the market-data rate tier.** If sync volume ever brushes
  the public limits (~10 req/s is the published market-data ceiling):
  1. Log in to Kalshi → Account → API keys → create a key. Kalshi shows an
     **API key ID** and lets you download an **RSA private key** (PEM). The
     key is shown once; store it in a password manager.
  2. Configure `KALSHI_API_KEY_ID` and `KALSHI_PRIVATE_KEY_PEM` (the full PEM,
     newlines included) server-side only — Vercel env config for the deployed
     app, `.env` locally. **Never** in the browser, never in git.
  3. This key should be a **read-scoped** key on an unfunded or demo account
     if Kalshi's console allows scoping. The Pitch 11 trading key will be a
     separate, stricter credential; do not reuse one key for both.

**Verify the taxonomy before the first in-season sync.** The four series
Sightline discovers were verified against the live exchange on 2026-08-01:

```
KXNFLPASSYDS  → passing_yards
KXNFLRSHYDS   → rushing_yards
KXNFLRECYDS   → receiving_yards
KXNFLREC      → receptions
```

Combined-touchdown series (KXNFLTD, KXNFLANYTD, …) split neither rushing nor
receiving touchdowns, map to no Sightline stat type, and are deliberately not
discovered (RD-19). To re-verify in season:

```bash
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXNFLRECYDS&status=open&limit=5"
```

An empty result in-season means the taxonomy moved — update
`SERIES_STAT_TYPES` in `src/lib/kalshi/parse.ts` (one table, fixture-tested)
rather than trusting an empty slate.

## 2. Environment variables

Add to the repo-root `.env` locally and to Vercel project env for deploys.
Names must match `src/env.ts` exactly. **These same values become GitHub
Actions secrets in Pitch 5.**

| Variable | Required | Default | Purpose |
| -------- | -------- | ------- | ------- |
| `KALSHI_API_BASE_URL` | no | `https://api.elections.kalshi.com/trade-api/v2` | Point at Kalshi demo to exercise the integration off the live exchange |
| `KALSHI_API_KEY_ID` | no | — | Market-data key id (rate tier only; read access works without it) |
| `KALSHI_PRIVATE_KEY_PEM` | no | — | The key's RSA private key, full PEM. Server-side only, never logged |
| `KALSHI_SYNC_MIN_INTERVAL_SECONDS` | no | `30` | Server-side refresh coalescing window (RD-13) |
| `PRICE_HEARTBEAT_MINUTES` | no | `15` | Unchanged books re-observe at most this often (RD-14) |
| `RECOMMENDATION_THRESHOLD_POINTS` | no | `5` | Confidence-adjusted-edge recommendation threshold (RD-11) |
| `SLATE_REFRESH_INTERVAL_SECONDS` | no | `60` | In-page slate polling interval (RD-12) |

Nothing in this pitch requires a new **Python-side** variable: the projection
CLI uses the existing `DIRECT_URL` (or `INGEST_DATABASE_URL`) from the Pitch 1
runbook.

## 3. Persisting projections (manual until Pitch 5)

Projections exist only after the model path writes them. After each sync has
discovered contracts (so the candidate list is non-empty):

```bash
cd python
uv run sightline-model project            # cutoff = now
uv run sightline-model project --cutoff 2026-11-08T14:00:00Z
```

- Projects **contract-listed players only** on upcoming scheduled games.
- Idempotent: re-running with the same cutoff writes nothing and changes
  nothing. A new cutoff writes new rows; the slate reads the freshest.
- Unprojectable players are printed with their reason and produce no row —
  their contracts show "no projection" on the slate, which is the honest state.
- Run it against the corpus database the app serves from (Supabase dev/prod
  via `DIRECT_URL`), not the local backtest container, or the app will see
  contracts with no projections.

## 4. First-slate workflow (in season)

1. Open `/slate` as any active user, or `POST /api/prices/refresh`. The first
   sync discovers contracts, attempts resolution, and writes the first book
   observations. The sync outcome (complete / partial / failed / empty) is
   recorded on `market_sync_runs` and drives the slate banner.
2. Review **Unresolved contracts** at the bottom of the slate (admin): open
   each, read the diagnostic, and map the player with the resolve control.
   Corrections apply to future syncs only; the next refresh re-resolves.
3. Run `sightline-model project` (section 3) so resolved contracts get
   probabilities and edges.
4. Refresh the slate. Rows rank by confidence-adjusted edge; contracts at or
   above `RECOMMENDATION_THRESHOLD_POINTS` carry the recommendation marker.

## 5. Operational notes

- **A Kalshi outage is not an incident.** The slate degrades to
  projections-only with a banner and last-observed prices. Check
  `market_sync_runs.error_message` (sanitized) if it persists.
- **Delisting is automatic and conservative:** contracts leave the active set
  only after a COMPLETE discovery no longer returns them. A partial or failed
  sync never delists.
- **Decisions are the data that cannot be reconstructed.** They are
  append-only in the `decisions` table; no cleanup or migration may touch
  them without explicit sign-off (CLAUDE.md).
- **Offseason:** the slate's "No upcoming games" state is expected from
  February to September. Scheduled sync, staleness, and the keepalive
  workflow arrive with Pitch 5.
