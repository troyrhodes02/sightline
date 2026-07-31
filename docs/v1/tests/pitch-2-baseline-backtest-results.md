# Pitch 2 — Baseline Model Backtest Results (SIG-27, citable)

**Run date:** 2026-07-31 · **Run id:** `d8a1e3f1-2144-48fd-b01f-19b854d74e39` · **Model version:** `baseline-zil-0.1.0`

> **This supersedes the 2021 diagnostic** (`code_dirty`, single era, pre-corpus-correction). That run was a diagnostic, not a citable result. This one is the first **citable** baseline: it passes `verify --strict` from a clean tree, spans both weather eras, and runs on the corrected corpus (SIG-25/26). Use these numbers; discard the diagnostic's.

---

## Provenance and integrity

| | |
|---|---|
| Corpus | `PlayerGameStat`, seasons 2010–2021 (nflverse), null-vs-zero corrected (SIG-25) |
| Backtest scope | 2019–2021 regular season, all six stat types |
| Cutoff policy | `kickoff_minus_90m/v1` · Grading target | `official_corrected` |
| Code version | `be113e2d…` · **`code_dirty = false`** (clean tree) |
| Corpus digest | `57d1149246d60f37…` |
| Predictions digest | `24339871bd02ee3b…` · Aggregate `9d7f5f24…` · Calibration `62dd455b…` |
| Populations | 139,913 candidates · 52,610 projected · 48,878 in comparison |

`sightline-backtest verify --strict` — **22 of 22 checks passed**, including recomputation of every digest from the Parquet on disk, `information_cutoff` strictly before every kickoff, `rngDraws == 0`, population reconciliation, **code version recorded**, and **working tree was clean**. This run is attributable to its commit; no prediction could see the game it predicted.

---

## Point estimates — mean (headline) and median (displayed), per stat (MAE)

| stat type | n | model **mean** | season-avg | trailing-5 | model **median** |
|---|---|---|---|---|---|
| passing_yards | 1,576 | 71.12 | 69.38 | **68.69** | 68.23 |
| rushing_yards | 5,738 | 18.65 | 17.93 | **17.89** | **17.32** |
| receiving_yards | 11,942 | 20.44 | 20.06 | **19.82** | **18.79** |
| receptions | 11,942 | **1.459** | 1.483 | 1.470 | **1.407** |
| rushing_tds | 5,738 | 0.326 | **0.319** | 0.322 | **0.234** |
| receiving_tds | 11,942 | 0.290 | 0.286 | **0.282** | **0.194** |

The picture from the diagnostic holds on the corrected corpus:

- **On the headline mean-vs-mean comparison**, the baseline loses narrowly to the better naive baseline on all three yardage stats and on rushing TDs, and wins on receptions. The deficit is a consistent over-projection, not a capability ceiling.
- **The median beats the better baseline on five of six stat types** (and ties passing), several decisively (rushing/receiving TDs by ~25–30%). MAE is minimised by the median *by definition*, so this is not a free win against mean baselines — but it confirms the deficit is an interaction between the specified point estimate (the mean of a right-skewed distribution) and the reported metric, not a weaker model. The slate displays the median (SIG-28); the mean stays the headline comparator.
- **The baseline wins on RMSE where it loses on MAE** for four of six stats (receiving_yards 27.68 vs 27.71, receptions 1.92 vs 1.97, both TDs) — fewer catastrophic misses, more mid-sized ones: a distribution correctly shaped but slightly wrongly centred.

None of this drives pricing. Contracts are priced from `P(X ≥ threshold)` over the full distribution; the point estimate is a display value. **Calibration is what matters.**

---

## Calibration — the contract-like population (SIG-26, stored & verified)

The decision-relevant curve, now a **durable, `verify`-able** `CalibrationBin` segment rather than ad-hoc Parquet. Contract-like = a per-stat volume floor on the projected value (pre-cutoff, leak-safe). **Brier 0.1261, log loss 0.3965** (223,671 threshold observations from 28,852 projections), against the diluted full-population Brier of 0.0935.

| bin | predicted | observed | obs | projections | gap |
|---|---|---|---|---|---|
| 0.0–0.1 | 0.045 | 0.034 | 78,305 | 22,586 | −0.011 |
| 0.1–0.2 | 0.147 | 0.125 | 42,922 | 22,512 | −0.022 |
| 0.2–0.3 | 0.246 | 0.237 | 28,718 | 21,654 | −0.009 |
| 0.3–0.4 | 0.347 | 0.349 | 20,254 | 18,016 | +0.002 |
| 0.4–0.5 | 0.447 | 0.458 | 14,157 | 13,485 | +0.011 |
| 0.5–0.6 | 0.548 | 0.556 | 10,887 | 10,686 | +0.008 |
| 0.6–0.7 | 0.648 | 0.644 | 9,213 | 9,122 | −0.004 |
| 0.7–0.8 | 0.748 | 0.729 | 7,469 | 7,411 | −0.019 |
| 0.8–0.9 | 0.849 | 0.817 | 6,404 | 6,167 | −0.032 |
| 0.9–1.0 | 0.947 | 0.896 | 5,342 | 3,658 | **−0.051** |

**Genuinely decent between 0.2 and 0.7 (within ±0.011).** The defect is top-end over-confidence, growing monotonically to −0.051 at 0.9–1.0 — now on a robust sample (3,658 projections, well above the 1,000 floor), not the thin diagnostic figure. This is the most dangerous direction for sizing (Kelly amplifies high-price error ~10×) and is the subject of **SIG-29**; until it reports, sizing uses a 0.75 probability ceiling.

The `contract_like × stat_type` pairing is also stored (SIG-26): miscalibration differs by stat — e.g. `receptions` shows a distinct 0.6–0.8 over-confidence a single global correction would miss — which is why the recalibration layer must correct per stat.

### Weather-era split (leak disclosed, never averaged away)

2019–2020 are `reanalysis` (an accepted look-ahead source); 2021 is `archived_forecast`. Top-bin over-confidence is **not** flattered by the reanalysis era — it is if anything slightly worse there:

| era | top-bin predicted | observed | obs |
|---|---|---|---|
| archived_forecast (2021) | 0.947 | 0.901 | 1,877 |
| reanalysis (2019–20) | 0.947 | 0.894 | 3,465 |

---

## Corpus correction note (SIG-25, why this differs from the diagnostic)

The diagnostic ran on a corpus that zero-filled non-participation, contaminating 96% of the evaluation population. SIG-25 derives absence per phase from the opportunity column, with a role clause so a running back's genuine 0-target receiving game is **kept** (not erased): measured RB receiving genuine-zero erasure fell from **~22% to 0%**. This matters because those games land in the contract-like population the recalibration layer is fitted on; erasing them biased RB pass-catching projections upward.

---

## Caveats

- **Volume floors are provisional** (passing 100 · rushing 20 · receiving 20 · receptions 2 · TDs 0.2, on the projected value). They must be **re-anchored against Kalshi's real listing behaviour before the paper run**, since the floor defines the fitted population. 0.5×/1×/2× sensitivity is re-derivable from the stored projected value.
- **No weather or injury-context features** — the baseline runs on trailing production only. Those datasets are empty by deliberate scope; the Simulation Engine, not the baseline, will consume them.
- **Beating naive baselines is necessary but not sufficient** — it says nothing about beating Kalshi's prices, which no offline backtest can answer.

## Reproduction

```bash
cd python
uv run sightline-backtest run --seasons 2019-2021 --window development \
  --stat-types passing_yards,rushing_yards,receiving_yards,receptions,rushing_tds,receiving_tds \
  --label "SIG-27-rebaseline-2019-2021"
uv run sightline-backtest verify      <run-id> --strict
uv run sightline-backtest calibration <run-id> --population contract_like
uv run sightline-backtest calibration <run-id> --population contract_like --stat receptions
```
