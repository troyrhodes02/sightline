# Pitch 2 — Baseline Model Backtest Results

**Run date:** 2026-07-29 · **Run id:** `73fc08b3-9493-422e-b6fa-a0b62a41685f` · **Model version:** `baseline-zil-0.1.0`

The first backtest of the Pitch 2 baseline model against a real corpus. It answers one question: **does the baseline beat the naive baselines, and is it calibrated?** That determines whether the Simulation Engine (Pitch 7) is urgent or optional.

---

## The short answer

**On the headline metric the baseline model loses to both naive baselines on all three yardage stat types and wins narrowly on two of three count types.** Taken at face value, that means the model does not clear the bar Pitch 2 set for itself.

Taken at face value is the wrong way to take it. Three findings, in ascending order of importance, change what the numbers mean:

1. The corpus does not distinguish "did not participate" from "produced zero," so **96% of the evaluation population is trivial zero-prediction rows** and every pooled metric is diluted beyond interpretation.
2. Restricted to contract-like players, the model's deficit is real but small (1.5–6.3% MAE) and **entirely explained by a systematic +11–39% over-projection**.
3. That over-projection traces to a single specified choice — `projected value = distribution mean` — and **substituting the median flips the verdict on five of six stat types**, several decisively.

So: the distributional machinery is sound and the calibration is respectable. What loses to a naive average is the point estimate read off it. **The Simulation Engine is not urgent. Two much cheaper fixes come first.**

---

## Provenance and integrity

| | |
|---|---|
| Corpus | 387,038 `PlayerGameStat` rows, seasons 2002–2023 (nflverse) |
| Backtest scope | 2021 regular season, all six stat types |
| Cutoff policy | `kickoff_minus_90m/v1` |
| Grading target | `official_corrected` |
| Corpus digest | `c4041bc1ff0d084e…` |
| Predictions digest | `b390e6fa79007a61…` |
| Code version | `303b897a…` **(dirty — see caveats)** |
| Wall clock | 74 minutes |

`sightline-backtest verify` — **20 of 20 checks passed**, including recomputation of the predictions digest from the Parquet on disk, `information_cutoff` strictly before every kickoff, `rngDraws == 0`, population reconciliation, and stored aggregates matching a recomputation. No prediction could see the game it predicted.

**Populations**

| | count |
|---|---|
| Candidates | 238,374 |
| Projected | 102,318 |
| Excluded — `no_actual_stat_line` | 136,056 (57.1%) |
| In comparison population | 95,694 |
| Model-only population | 102,318 |
| `baseline_unavailable` (projected, model-only) | 6,624 |
| Threshold observations | 733,279 |

---

## Finding 1 — The corpus cannot express "did not participate"

This is the finding that most affects everything else, and it is a data-layer defect, not a modelling one.

```
passing_yards      rows=387,038  non-null=387,038  zero=373,335  null=0
receiving_yards    rows=387,038  non-null=387,038  zero=304,546  null=0
```

**Every stat column is non-null in all 387,038 rows.** The ingest zero-fills where nflverse reports no production.

The spec's eligibility rule depends on exactly the distinction that has been erased:

> A prior game is **eligible** … if the stat's source column is non-null. A null column is absence, never zero — a quarterback's `receiving_yards` of `NULL` is not a zero-yard receiving performance.

Because `season_participants` filters on `column is not null`, it now matches **every player for every stat type**. Consequences visible in the output:

- Identical `n = 15,949` for all six stat types — the candidate universe is the same set of players regardless of stat.
- 96.4% of `passing_yards` predictions have `actual = 0`; mean actual passing yards is **7.57**, because the population is overwhelmingly non-quarterbacks.
- Pooled MAE of **1.90** across six stat types with incommensurable units, dominated by rows where predicting ≈0 is trivially correct.
- Reported Brier of **0.0164** — flattered roughly 8× by threshold events nobody would ever list a contract on.

| stat type | n | actual == 0 | mean actual | mean projected |
|---|---|---|---|---|
| passing_yards | 15,949 | 96.4% | 7.57 | 8.43 |
| receiving_tds | 15,949 | 95.8% | 0.05 | 0.05 |
| receiving_yards | 15,949 | 77.7% | 7.63 | 8.49 |
| receptions | 15,949 | 77.5% | 0.70 | 0.72 |
| rushing_tds | 15,949 | 97.5% | 0.03 | 0.03 |
| rushing_yards | 15,949 | 87.5% | 3.65 | 3.94 |

This also explains the run's cost: the harness carries ~500 candidates per game per stat type where a dozen or two are real.

**Every headline number in this report is provisional until this is fixed.** Filed as **SIG-25**.

---

## Finding 2 — On contract-like players, the deficit is real but small

To get an interpretable comparison, predictions are restricted to players the model itself projects as having meaningful volume. The filter uses `projected_value`, which is derived entirely from pre-cutoff information — **it never conditions on the outcome**. This mirrors the real product boundary: Kalshi only lists contracts for players with expected volume.

Floors: passing 100 yds · rushing 20 yds · receiving 20 yds · receptions 2 · TDs 0.2.

| stat type | n | model MAE | season-avg | trailing-5 | model RMSE | season-avg | trailing-5 | winner |
|---|---|---|---|---|---|---|---|---|
| passing_yards | 542 | 73.18 | 69.62 | **69.16** | 96.09 | 88.83 | **86.40** | trailing-5 |
| rushing_yards | 1,132 | 25.51 | **24.17** | 24.54 | 32.39 | 32.11 | **32.05** | season-avg |
| receiving_yards | 2,629 | 24.78 | 24.19 | **24.15** | 31.57 | 31.78 | **31.49** | trailing-5 |
| receptions | 2,457 | **1.72** | 1.77 | 1.76 | **2.17** | 2.27 | 2.21 | **model** |
| rushing_tds | 840 | 0.51 | **0.51** | 0.53 | **0.62** | 0.66 | 0.65 | season-avg |
| receiving_tds | 1,508 | **0.47** | 0.49 | 0.48 | **0.56** | 0.61 | 0.58 | **model** |

**The verdict is robust to where the floor is set.** At 0.5×, 1×, and 2× the floors above, the model's MAE deficit on yardage stays within a narrow band (passing +5.8 to +6.3%, rushing +2.7 to +6.3%, receiving +1.5 to +3.1%) and its edge on receptions and receiving TDs persists. This is a stable result, not an artifact of threshold choice.

Note the pattern: **the model wins on RMSE for four of six stat types while losing on MAE.** It is not simply worse — it makes fewer catastrophic misses and more mid-sized ones, which is the signature of a distribution that is correctly shaped but wrongly centred.

---

## Finding 3 — The deficit is the point estimate, not the model

The model over-projects on **every** stat type:

| stat type | mean(projected − actual) | mean actual | over-projection |
|---|---|---|---|
| passing_yards | +26.28 | 216.62 | +12.1% |
| rushing_yards | +4.55 | 41.76 | +10.9% |
| receiving_yards | +5.66 | 37.52 | +15.1% |
| receptions | +0.12 | 3.41 | +3.5% |
| rushing_tds | +0.09 | 0.35 | +26% |
| receiving_tds | +0.11 | 0.28 | +39% |

A consistent one-directional bias of this size is a specification artifact, not noise. SIG-16 specifies **`projected value` = the distribution mean**, and for a right-skewed zero-inflated log-normal the mean sits well above the median — inflated by `exp(σ²/2)`, which `SIGMA_FLOOR = 0.35` gives a floor of about +6% before any real dispersion is added.

Substituting the stored `q50` (median) as the point estimate, changing nothing else:

| stat type | MAE (mean) | MAE (median) | best baseline | median beats baseline? |
|---|---|---|---|---|
| passing_yards | 73.18 | 69.19 | 69.16 | dead heat |
| rushing_yards | 25.51 | **23.96** | 24.17 | **yes** |
| receiving_yards | 24.78 | **22.50** | 24.15 | **yes, by 6.8%** |
| receptions | 1.72 | **1.68** | 1.76 | **yes** |
| rushing_tds | 0.51 | **0.35** | 0.51 | **yes, by 31%** |
| receiving_tds | 0.47 | **0.31** | 0.48 | **yes, by 35%** |

**The honest caveat:** MAE is minimised by the median *by mathematical definition*, so this is not a free win. Both naive baselines are means of past values, so model-mean vs baseline-mean is the apples-to-apples comparison, and model-median vs baseline-mean is not. The correct reading is narrower but still decisive: **the reported deficit is largely an interaction between the specified point estimate and the reported metric, and is not evidence that the distributional model is weaker than a naive average.**

It also barely matters for the product. Sightline prices contracts from `P(X ≥ threshold)`, computed from the full distribution — the point estimate is a display value. What matters is calibration.

---

## Calibration — what actually matters for pricing

Calibration on the contract-like population (70,601 threshold observations from 9,108 projections). **Brier 0.1252, log loss 0.3945** — the honest figures, against the diluted 0.0164 / 0.0554 reported for the full population.

| bin | predicted | observed | obs | projections | gap |
|---|---|---|---|---|---|
| 0.0–0.1 | 0.046 | 0.036 | 24,993 | 7,179 | −0.010 |
| 0.1–0.2 | 0.147 | 0.123 | 13,733 | 7,124 | −0.023 |
| 0.2–0.3 | 0.246 | 0.235 | 9,023 | 6,829 | −0.011 |
| 0.3–0.4 | 0.348 | 0.345 | 6,305 | 5,641 | −0.002 |
| 0.4–0.5 | 0.447 | 0.457 | 4,320 | 4,145 | +0.009 |
| 0.5–0.6 | 0.549 | 0.559 | 3,383 | 3,329 | +0.011 |
| 0.6–0.7 | 0.648 | 0.644 | 2,820 | 2,795 | −0.004 |
| 0.7–0.8 | 0.748 | 0.722 | 2,360 | 2,336 | −0.026 |
| 0.8–0.9 | 0.849 | 0.819 | 1,999 | 1,925 | −0.030 |
| 0.9–1.0 | 0.946 | 0.900 | 1,665 | 1,127 | −0.045 |

**This is a genuinely decent reliability curve.** Between 0.2 and 0.7 the model is accurate to within ±0.011 — for a first baseline with no simulation, that is a real result.

**The defect is at the top.** Over-confidence grows monotonically across the last three bins, reaching −0.045 at 0.9–1.0: contracts the model calls 95% resolve true 90% of the time. That is the most dangerous direction for a trading product, because high-probability contracts are where an admin sizes up. Every threshold event is also over-predicted upward at the low end (−0.010, −0.023), consistent with the same upward location bias found above.

Effective sample in the top bin is 1,127 projections — above the 1,000 reporting floor, but thin. Treat the top-bin figure as directional.

---

## Verdict: is the Simulation Engine urgent?

**No. It is currently the wrong thing to build next.**

Pitch 2 set the gate that Pitch 7 must beat this baseline to justify itself. On the raw numbers the baseline does not beat naive averages, which superficially argues for accelerating Pitch 7. That inference does not survive the evidence:

1. **The comparison rests on a broken corpus.** With 96% zero-fill contamination, neither the baseline's failure nor a simulation engine's success could be measured. Building a more sophisticated model to evaluate against an uninterpretable population would produce a confident number that means nothing — the precise failure mode `CLAUDE.md` exists to prevent.
2. **The deficit is a two-line specification question, not a capability ceiling.** A model whose median already beats both baselines on five of six stat types is not a model that needs replacing with simulation.
3. **Calibration — the product's actual success metric — is already respectable**, with one well-localised defect (top-end over-confidence) that points at dispersion estimation, not at model class.

Simulation is the right answer to *"the model's structure cannot capture how football works."* Nothing here shows that. It is the wrong answer to *"the corpus can't tell absence from zero"* and *"we report the mean of a skewed distribution."*

### Recommended order

1. **Fix null-vs-zero in ingest (SIG-25).** Blocks everything. Until it lands, no accuracy claim is meaningful. Also removes most of the harness's cost problem, since the candidate universe shrinks to real participants — which likely subsumes **SIG-21**.
2. **Re-run this backtest** on the corrected corpus over the full development window (2016–2021) and re-baseline. Cheap once (1) is done, and it produces the first trustworthy numbers.
3. **Resolve the point-estimate question** (SIG-16 mandates the mean; the evidence favours the median, or reporting both). Requires a decision, not research.
4. **Investigate top-end over-confidence** — `SIGMA_FLOOR`, shrinkage strength `K0 = 4`, and the log-normal mean estimator are the candidates.
5. **Only then reconsider Pitch 7**, against a baseline that has been measured honestly.

---

## Caveats

- **Single season (2021).** No weather-era split is possible — 2021 is entirely `archived_forecast` — so the era-split reporting `CLAUDE.md` requires is untested here. The full 2016–2021 window spans both eras deliberately and should be used for the re-baseline.
- **No weather or injury-context data ingested.** Those features are absent, not wrong. The model is running on trailing production and rest/travel only.
- **`code_dirty = true`** on this run: the working tree carried uncommitted files, so it would fail `verify --strict` attribution. Correct and honest behaviour by the provenance check added in the Pitch 2 review — but it means this run is a diagnostic, not a citable stored result. The re-baseline must run from a clean tree.
- **Volume floors are a judgment call.** Sensitivity across 0.5×/1×/2× is reported above precisely so the reader can see the conclusion does not depend on them.
- **Baselines get no Brier score**, by design — inventing a distribution for a point estimate would make the calibration comparison meaningless. So calibration is measured against the model alone; the baseline comparison is MAE/RMSE only.
- **Beating naive baselines is necessary but not sufficient.** It says nothing about whether the model beats Kalshi's prices, which is the actual product claim and which no backtest in this pitch can answer.

## Reproduction

```bash
cd python
uv run sightline-backtest run --seasons 2021 \
  --stat-types passing_yards,rushing_yards,receiving_yards,receptions,rushing_tds,receiving_tds \
  --window development --label "pitch2-baseline-2021-REG"

uv run sightline-backtest verify   <run-id>
uv run sightline-backtest show     <run-id> --breakout stat
uv run sightline-backtest calibration <run-id>
uv run sightline-backtest exclusions  <run-id>
```

Conditional analyses (contract-like population, floor sensitivity, median comparison) were computed directly from `predictions/part-00000.parquet` under the run's artefact directory; they are diagnostics, not stored aggregates.

## Related issues

| | |
|---|---|
| **SIG-25** | Ingest zero-fills stat columns, erasing the null-vs-zero distinction the eligibility rule depends on — **blocks all accuracy claims** |
| SIG-23 | Artefact flush crashed on mixed continuous/count stat types — found and fixed during this exercise (PR #19, merged) |
| SIG-24 | Stats ingest is not idempotent; re-running over an ingested period fails on a duplicate key |
| SIG-21 | `assemble_batch` row-loop hot path — likely subsumed by SIG-25 |
