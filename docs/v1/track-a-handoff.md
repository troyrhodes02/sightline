# Track A — Handoff

End state of Track A (Python-side corpus correction + citable re-baseline), for a
session on another machine with none of this context. Track B (Pitch 3 onward,
TypeScript) has not started.

## What is merged and what it establishes

Branch `track-a/corpus-and-contract-like-segment` (PR against `main`) delivers:

- **SIG-25** — the corpus can now express non-participation. nflverse zero-fills
  a phase a player did not take part in; the corpus could not tell that from a
  genuine zero, so 96% of the evaluation population was trivial zero rows and
  every pooled metric was diluted past interpretation. Fixed by deriving absence
  per phase from the opportunity column, with a role clause so a back's genuine
  0-target receiving game is kept (RB receiving genuine-zero erasure 22% → 0%).
  Absorbs SIG-24 (idempotent re-runnable ingest).
- **SIG-28** — projections carry both the mean (headline comparator) and median
  (the displayed estimate). `prob_at_least` and calibration are untouched.
- **SIG-26** — the contract-like population is a first-class, `verify`-able
  `CalibrationBin` segment (pooled **and** per stat type), so Pitch 7's
  recalibration layer fits against a durable curve, not ad-hoc Parquet. Absorbs
  SIG-22 (`calibration --season` / `--population`).
- An as-of-layer dtype fix (behaviour-neutral, byte-identical digests) that the
  null-heavy corpus exposed at scale.

## The citable run

- **Run id:** `d8a1e3f1-2144-48fd-b01f-19b854d74e39` · model `baseline-zil-0.1.0`
  · code `be113e2` (clean tree) · 2019–2021 REG, both weather eras.
- **`verify --strict` passes (22/22)** — attributable to its commit; this is the
  gate the earlier 2021 diagnostic failed (`code_dirty`).
- **Contract-like Brier 0.1261**, well-calibrated 0.2–0.7 (±0.011), top-bin
  over-confidence −0.051.
- **Exported to the repo** at `docs/v1/tests/sig27-export/sig27-rebaseline.json`
  (run row + all 184 calibration bins). Reload into any fresh DB with the
  `jsonb_populate_record` snippet in `docs/v1/runbooks/backtest.md` →
  "Reloading a stored run". No corpus rebuild or re-run needed to display it.
- The results narrative is `docs/v1/tests/pitch-2-baseline-backtest-results.md`.

## The corpus (local to the previous machine)

- Scope **2010–2021** (~211k `PlayerGameStat` rows) — a deliberate narrowing from
  2002–2023; covers the 2019–2021 window with prior seasons for walk-forward
  priors. Derived data: **rebuildable by fresh ingest**, and **not required by
  Pitches 3–6** (those need the exported run, not the corpus).
- It lives in the previous machine's local Supabase Postgres. To recreate on a
  new machine: `prisma migrate deploy`, then `sightline-ingest teams / players /
  schedule --seasons 2010-2021 / stats --seasons 2010-2021`. Wrap long ingests in
  `caffeinate` — a lid-close breaks the single-transaction ingest's DB connection.
- **`game_weather` and `player_game_context` are empty by deliberate scope**, not
  oversight. The baseline model reads neither. Their ingest is built and working
  (`weather`, `context` datasets) and will be loaded when the **Simulation Engine**
  (the second Projection Engine implementation) needs game-environment and usage
  inputs.

## Provisional values (must be revisited before paper trading)

- **0.75 probability ceiling for sizing.** It exists because top-end
  over-confidence is real and structural: −0.051 on the citable run, stable
  across three measurements (−0.045 diluted 2021, −0.048 corrected 2021 smoke).
  The ceiling excludes the entire miscalibrated region (both affected bins sit at
  0.849 and 0.947). Provisional pending real slates (SIG-29 closed on this exit).
- **Contract-like volume floors** (passing 100 · rushing 20 · receiving 20 ·
  receptions 2 · TDs 0.2, on the projected value) are a documented default and
  **must be re-anchored against Kalshi's real listing behaviour before paper
  trading**, since the floor defines the population the recalibration layer fits.

## Design note for Pitch 7 (recalibration + sizing)

**The probability ceiling must apply to the probability of the side being
*bought*, not to P(yes).** Buying NO at 85¢ is arithmetically the same
high-probability position as buying YES at 85¢; a ceiling written against P(yes)
alone would let the NO buy straight through. The bottom bins lean safe —
predicted 0.046 vs observed 0.036 means the NO side is *under*-estimated,
consistent with the same upward location bias seen at the top — but the
implementation must be side-aware regardless.

Per-stat corrections diverge meaningfully: `contract_like × receptions` showed
0.749 predicted vs 0.702 observed while the pooled curve looked healthy in that
band. That is the concrete evidence the recalibration layer must correct per
stat type, and why the two-axis segment exists.
