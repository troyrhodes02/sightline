# Outcome Scoring & Accuracy Surface — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Outcome Scoring & Accuracy Surface
**Focus:** The measurement loop made visible — a shared accuracy surface presenting model calibration, error against baselines, and market-relative performance with every denominator attached, plus the admin-only record of how William's takes, fades, skips, and decision timing actually performed.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

## Decisions settled for this document

These resolve the pitch's design-level open questions. Each is restated as a Resolved Decision in the technical spec; this section exists so a reader of the design doc alone knows the ground it stands on. Decisions 1–11 were resolved by approved instruction before this document; 12–18 are resolved here.

1. **Grading truth splits by what is being graded.** Official statistics grade the model (threshold accuracy, point-estimate error, calibration, Brier). Kalshi settlement grades anything contract-facing (recommendation correctness, took/faded/skipped outcomes, later positions). Both values are always stored; neither overwrites the other; a disagreement between them is a displayable fact carried on the affected rows, not an inconsistency to reconcile.
2. **The final pre-kickoff snapshot is owned by Live Pipeline & Staleness.** It exists in the codebase today — a `final_pre_kickoff` recommendation snapshot captured on the price-refresh schedule inside a 45-minute pre-kickoff window. This pitch grades it and never fabricates it: a decision with no valid final snapshot is marked unavailable for timing-cost analysis, never assigned zero.
3. **Model calibration is visible to viewers.** Calibration, Brier, baseline comparison, and market comparison describe the model and are shared reads. Unambiguously private, unchanged: decision log, override performance, timing cost, positions, ledgers, bankroll.
4. **Every calibration figure reports two denominators.** Threshold observations and distinct projections, always displayed together ("1,847 obs · 412 projections"). Several thresholds from one player distribution are correlated observations; the display discloses the structure rather than statistically correcting for it.
5. **The population is explicit and selectable, never silently chosen.** Three populations: *Contract-like* (default; the decision-relevant population later recalibration fits against), *All projections* (the Brief's calibration-across-every-prediction measure), *Market-linked* (projections where a Kalshi contract existed — the only valid population for market comparison). The selector's state is unmistakable and travels in the URL.
6. **Baselines and Brier live in separate panels.** The error panel compares model point estimates against the season-average and trailing-five baselines using MAE and RMSE, mean-versus-mean as the headline (the median shown for visibility per the SIG-28 amendment, never as a head-to-head). The calibration panel carries the reliability curve and Brier for the model and, where available, the market. Baselines never appear in the calibration panel — they produce no probabilities.
7. **Market comparison is contemporaneous, executable, and carries uncertainty.** Sightline's probability is compared against the executable price on the relevant side observed contemporaneously with the graded recommendation snapshot. Midpoint is a clearly labelled secondary figure. The market-relative edge is never displayed without its uncertainty interval; elsewhere on the surface, sample size alone suffices.
8. **Model versions are separated by default and never backfilled.** The default view reports one model version. An explicitly labelled "All versions (deployed system)" view is permitted. Historical projections are never regenerated with a newer model.
9. **Backtest and live are always separately labelled records.** The surface offers Live, Backtest, and an explicit Compare view that overlays both, labelled. They are never combined into one curve or one score.
10. **Timing cost is signed so positive means acting early cost value.** Expressed in probability points. Positive: the final pre-kickoff edge exceeded the decision-time edge — waiting would have been better. Fades are oriented to the side actually preferred. Where a decision was edited, the acted-on snapshot governs.
11. **Grading freshness extends the health surface with exactly three signals.** Last successful outcome ingest, last successful grading cycle, and a count of completed games still awaiting grades — reusing the existing health-state conventions. No run history, no per-game grading status, no retry controls.
12. **The reliability curve uses ten fixed-width buckets, matching the stored backtest bins.** The backtest harness stores `binIndex` 0–9 over fixed tenths; live calibration renders on the same axes so the Compare view is a like-for-like overlay. Adaptive or quantile binning is rejected — it would make backtest and live curves incomparable.
13. **Insufficient data reuses the established reporting floor where one exists.** A calibration bucket below 1,000 threshold observations renders as provisional — hollow point, dashed connection, its counts still shown — and is excluded from any summary sentence, exactly matching the stored `below_floor` semantics from the Backtesting Harness. Market comparison requires 30 graded observations before the headline edge renders; below that it shows its honest insufficient-sample state with the running count. Override performance has no suppression floor — it is the admin's own record, every rate always carries its n, and a small n is itself the information.
14. **Time period means NFL season.** The period filter offers each season with graded data plus "All seasons". Rolling windows, calendar years, and custom ranges are rejected for this version — the backtest side is organised by season, and a second period vocabulary would make the Compare view incoherent. Postseason weeks belong to their season.
15. **Weather-era visibility stays on the backtest record.** Live production grading is entirely in the archived-forecast era, so era is not a filter on the accuracy surface. When the Backtest record is displayed, its calibration summary carries the era split disclosure (reanalysis-era figures visibly separated), preserving the invariant that the accepted pre-2021 leak is reported, never averaged away.
16. **The graded recommendation is the final pre-kickoff snapshot.** Recommendation correctness evaluates the system's completed pre-kickoff statement — the `final_pre_kickoff` snapshot. A contract with no final snapshot has its recommendation outcome explicitly unavailable (a disclosed state), never graded against a substitute snapshot. Decisions are always graded against their own stored decision-time snapshot and disposition.
17. **The unresolvable taxonomy is seven reasons, one enum.** `missing_official_result`, `unresolved_identity`, `unsupported_stat_type`, `game_never_completed`, `contract_voided`, `missing_final_snapshot`, `source_conflict`. Each renders with its reason; counts of unresolvable records are displayed beside every population so exclusion is never silent. Anything not in the taxonomy stays honestly pending.
18. **Suggestion grading readiness is structural, not displayed.** Grading keys off projection, snapshot, and decision identities generically, so shadow projections will grade through the same machinery when Adjustment Suggestions produces them. No suggestion-reliability surface, chart, or placeholder appears in this version.

## 1. Vision

The accuracy surface is the screen that answers the product's founding question about itself: when Sightline said 60%, did the world comply about 60% of the time? It is open to every user in any month of the year, and it must be equally legible when the answer is "yes, across 220,000 backtested observations" and when it is "too early to say — 41 graded predictions so far." Privately, it also answers the question only William can act on: whether his own takes, fades, and skips have added anything to the model's record, and what acting early has cost him.

**North star: the instrument that grades itself in public and its operator in private.**

## 2. Design principles

### 1. Two denominators, always

Every calibration figure carries both counts — threshold observations and distinct projections — because several thresholds on one player distribution are one opinion, not several. A developer choosing between a clean single count and a cluttered pair chooses the pair. "1,847 obs · 412 projections" is the atom of this surface.

### 2. Populations are named, never implied

No number on this surface is "accuracy." It is accuracy *of a population*: contract-like, all projections, or market-linked. The population selector is always visible, its state always legible, and changing any filter updates every denominator on screen. If a panel cannot be computed for the selected population, it says which population it needs rather than silently switching.

### 3. Unlike metrics never share a frame

Point-estimate error (baselines) and probability calibration (Brier, reliability) are different measurements. They sit in separate panels with metric-specific labels, and nothing in layout, colour, or copy invites reading one as the other. The same wall stands between backtest and live records, and between model versions.

### 4. Small samples look small

A bucket with 40 observations renders as visibly provisional — hollow, dashed, counted — not as a confident point. A market edge without enough observations shows its running count instead of a number. The surface's credibility rests on it being unable to look better than its data.

### 5. The private layer is absent, not hidden

Override performance and timing cost do not exist in viewer responses — no keys, no counts, no disabled tabs, no blurred panels. A viewer's accuracy surface is complete in itself. Absence must be indistinguishable from non-existence, which means server-side serializers, not client-side hiding.

## 3. Information architecture

```text
Sightline
├── Slate                          (shared)  ← unchanged; contract detail gains
│   └── Contract detail            (shared)    an Outcome block after settlement
├── Accuracy                       (shared)  ← NEW route, this pitch
│   ├── Calibration panel          (shared)   reliability curve, Brier, two denominators
│   ├── Error vs baselines panel   (shared)   MAE/RMSE, mean headline, median disclosed
│   ├── Market comparison panel    (shared)   market-linked population only, with interval
│   └── Overrides                  (admin only) ← /accuracy/overrides
│       ├── Disposition record     took · faded · skipped, settlement-graded
│       └── Timing cost            decision-time vs final pre-kickoff edge
├── Health                         (admin only) ← gains 3 grading signals
├── Settings                       (shared)
└── Users                          (admin only)
```

`Accuracy` joins the primary navigation for every authenticated user. `Overrides` is reachable only from within the accuracy surface and only for the admin; a viewer's navigation, page payloads, and route responses contain no trace of it. Backtest calibration renders *inside* the accuracy surface as a labelled record — there is still no general backtest-run browser in this pitch.

## 4. Visual language

### 4.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | The model's reliability curve, Brier score, model probability in comparisons, model error series | The model accent. Every curve or figure the model produced. |
| `palette.market.main` / `market.fill` | The market's implied-probability curve and Brier, settlement values, executable price figures | Kalshi provenance. `fill` for chart strokes, `main` for small text. |
| `palette.text.secondary` | Baseline error series, the diagonal reference line, provisional-bucket outlines, the backtest record when overlaid with live | Baselines are naive references, not a third actor — they stay neutral. |
| `palette.warning.main` / `warning.soft` | Insufficient-sample states, provisional buckets' count labels, awaiting-grades health signal, source-disagreement chip | Caution only. Never means "bad score." |
| `palette.error.main` | Negative timing cost… **no.** Rose marks nothing on this surface except destructive actions, which it has none of | Timing cost is signed by glyph and sign, not colour — a positive cost is information, not an alarm. |

Won/lost grading of decisions uses text and glyphs (`won`, `lost`, `voided`), never green/red fills. The instrument does not celebrate.

### 4.2 State colours used in this pitch

Exact state names as the data model will carry them; no invented states.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| `graded` | No chip — a graded row simply shows its result | The ordinary completed state renders as content, not status |
| `pending` | Neutral outlined chip `pending` | Outcome not yet ingested or graded; expected, not alarming |
| `missing_official_result` | Amber outlined chip `no official result` | Unresolvable: no trustworthy stat line to grade against |
| `unresolved_identity` | Amber outlined chip `unresolved player` | Unresolvable: contract never mapped to a player |
| `unsupported_stat_type` | Neutral outlined chip `unsupported stat` | Unresolvable: outside the six supported stat types |
| `game_never_completed` | Neutral outlined chip `game not completed` | Unresolvable: cancelled/abandoned game; terminal |
| `contract_voided` | Neutral outlined chip `voided` | Distinct non-standard outcome; never in a win/loss denominator |
| `missing_final_snapshot` | Neutral outlined chip `no final snapshot` | Timing cost / recommendation grade unavailable for this record |
| `source_conflict` | Amber outlined chip `sources disagree` | Official result and Kalshi settlement imply different outcomes; both shown |
| `won` / `lost` | Plain text with `✓` / `✗` glyph, `text.primary` | Settlement-graded decision and recommendation outcomes |
| provisional bucket | Hollow point, dashed segment, amber count | Reliability bucket below the 1,000-observation floor |

Colour is reinforcement, never the only channel: every chip carries its words, every provisional bucket carries its count, and edge and timing figures carry explicit signs.

### 4.3 Typography

Per the brand system: every computed value — probabilities, Brier scores, error figures, counts, timing costs, timestamps — uses the monospace numeric variants (`numericLg` for headline figures, `numericMd`/`numericSm` elsewhere) with tabular figures. Sample-size annotations use `caption`. No data value is ever bolded; the headline Brier score earns its place by position and size, not weight.

### 4.4 Appearance

All states are theme-token driven and work in light, dark, and system. The reliability chart must be checked in both modes: the diagonal reference line and baseline series use `text.secondary` at reduced opacity in both; the market curve uses `market.fill` in dark and must not drop below contrast on white in light (use `market.main` for its labels). Provisional buckets must remain visibly distinct from settled ones in both modes — hollowness carries the distinction, not colour alone.

## 5. Screen specifications

## Screen 1: Accuracy

### Purpose

Let any authenticated user determine whether Sightline's stated probabilities have matched observed outcomes, whether the model improves on the naive baselines, and how it has performed against the market where a market existed — without any number appearing without its population, record, and sample sizes.

### URL pattern

`/accuracy` — query params carry scope: `?record=live|backtest|compare&version=<modelVersion>|all&population=contract_like|all|market_linked&stat=<statType>|all&season=<year>|all`. Every scope combination is deep-linkable; the defaults are `record=live`, the latest deployed model version, `population=contract_like`, `stat=all`, `season=all`.

### Trigger

Navigation link `Accuracy`, visible to every authenticated user; the empty slate's "View accuracy" route; deep links.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Accuracy                                                             │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Record [Live|Backtest|Compare]  Version [v2026.1 ▾]              │ │
│ │ Population [Contract-like ▾]  Stat [All ▾]  Season [All ▾]       │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ Graded through Wk 17 · last grading cycle Sun 11:40p ET              │
│                                                                      │
│ ┌─ Calibration ───────────────────────────┐ ┌─ Error vs baselines ─┐ │
│ │ Brier 0.213    1,847 obs · 412 proj     │ │ point estimate (mean)│ │
│ │ ┌─────────────────────────────────────┐ │ │        MAE    RMSE   │ │
│ │ │  reliability curve                  │ │ │ model  18.4   24.1   │ │
│ │ │  · diagonal reference               │ │ │ season 21.2   27.9   │ │
│ │ │  · model curve (indigo)             │ │ │ trail5 20.6   27.0   │ │
│ │ │  ○ provisional buckets hollow       │ │ │ 412 projections      │ │
│ │ └─────────────────────────────────────┘ │ │ median MAE 17.9 —    │ │
│ │ bucket table: range · pred · obs ·      │ │ shown for visibility,│ │
│ │ obs count · proj count · floor flag     │ │ not a baseline race  │ │
│ └─────────────────────────────────────────┘ └──────────────────────┘ │
│ ┌─ Against the market (market-linked population) ──────────────────┐ │
│ │ Brier: model 0.213 · market 0.221    n = 214 obs · 118 proj      │ │
│ │ mean edge at final snapshot +1.8 pts (95% CI −0.4 … +4.0)        │ │
│ │ vs executable price on recommended side · midpoint +2.6 (aside)  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ (admin only) Overrides → /accuracy/overrides ───────────────────┐ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ Excluded from this view: 23 unresolvable (14 no official result,     │
│ 6 voided, 3 unresolved player) · shown, never silently dropped       │
└──────────────────────────────────────────────────────────────────────┘
```

At `xs` the panels stack in the same order: scope bar (wraps to two lines), freshness line, calibration, error, market, exclusions. The bucket table scrolls vertically as part of the page, never horizontally.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Scope bar** | `ToggleButtonGroup` for record; `Select` (small) for version, population, stat, season | Every change updates the URL query and refetches. Scope is one region, visually distinct from data panels. Compare disables the version "all" option only if fewer than two records share axes. |
| **Freshness line** | `Typography caption` + `numericSm` timestamps | "Graded through Wk 17 · last grading cycle Sun 11:40p ET". Server-rendered; shared-safe (it is model metadata, not operational health). When grading is delayed, appends "— results may trail recent games" in `warning.main`. |
| **Calibration panel** | Bordered `Box`; `ReliabilityCurve` chart component; bucket `Table` | Headline Brier with both denominators beside it. Curve: x = stated probability, y = observed hit rate, ten fixed buckets, diagonal reference always drawn, points sized by observation count, provisional buckets hollow with dashed connection. Compare mode overlays live (solid) and backtest (muted) with a legend. |
| **Bucket table** | `Table size="small"`, `numericSm` cells | One row per bucket: range, mean predicted, observed rate, obs count, projection count, `below floor` amber annotation where applicable. This is the chart's text equivalent and is always rendered, not collapsed. |
| **Error panel** | Bordered `Box`, `Table size="small"` | MAE and RMSE for model, season-average, trailing-five — mean-vs-mean headline rows. One `caption` row discloses median MAE "shown for visibility; baselines are mean-based". Projection count shown once for the panel. |
| **Market panel** | Bordered `Box` | Pinned to the market-linked population regardless of selector; states so in its subtitle. Model Brier vs market Brier; mean edge at the final pre-kickoff observation with 95% interval; executable-side labelling; midpoint as labelled aside. Below 30 observations, renders the insufficient-sample state. |
| **Exclusions line** | `Typography caption` with per-reason counts | Always present when any record in scope is unresolvable or pending; each reason named with its count. |
| **Overrides entry** | `ButtonBase` row, admin payload only | Rendered only when the server payload contains the admin section. Navigates to `/accuracy/overrides`. Never rendered disabled — for viewers it does not exist. |

### Code reference

```tsx
// /accuracy — server component; role decides the serializer, not the view
export default async function AccuracyPage({ searchParams }: Props) {
  const session = await requireSession();
  const scope = parseAccuracyScope(await searchParams);
  const accuracy = await readAccuracy(scope, session.user.role);
  return <AccuracyScreen accuracy={accuracy} scope={scope} isAdmin={session.user.role === "admin"} />;
}

// ReliabilityCurve mirrors DistributionSummary's contract: theme-fed, no animation,
// text equivalent always adjacent (the bucket table), degenerate data renders prose.
<ReliabilityCurve
  buckets={panel.buckets}          // ten fixed bins; hollow when belowFloor
  series={panel.series}            // [{ kind: "live" | "backtest" | "market", ... }]
  ariaSummaryId={bucketTableId}    // the table is the accessible description
/>
```

### Fields

No form fields. Scope controls:

| Control | Type | Default | Values |
| ------- | ---- | ------- | ------ |
| record | toggle | `live` | `live`, `backtest`, `compare` |
| version | select | latest deployed | each model version with graded data; `all` labelled "All versions (deployed system)" |
| population | select | `contract_like` | `contract_like` "Contract-like", `all` "All projections", `market_linked` "Market-linked" |
| stat | select | `all` | six `StatType` values + all |
| season | select | `all` | seasons with graded data + all |

### Validation

An unrecognized query value falls back to that control's default silently (the URL is user-editable input, not a form). Scope combinations are never invalid — they may simply have no data, which renders the no-data state.

### Empty state

```text
┌─ Calibration ───────────────────────────────┐
│ No graded predictions for this scope.       │
│ Live grading began Wk 1 2026. 0 obs.        │
│ [View backtest record]                      │
└─────────────────────────────────────────────┘
```

Each panel empties independently — a season with no settled markets empties the market panel without touching calibration. The page never fails wholesale for a scope with no data. The overall June state is simply the same page: historical records remain fully available; nothing about an empty slate empties this surface.

### Loading state

Skeleton panels matching final panel heights; the scope bar renders immediately from the URL. No spinner longer than the read — this page reads stored aggregates only and must never wait on grading, backtests, or recomputation.

### Error state

A read failure renders one `Alert` ("Accuracy is temporarily unavailable — the last completed results could not be read.") with a retry. A delayed grading cycle is not an error: the last completed results render with the freshness line carrying the disclosure.

### Behavior

- Scope changes update the URL (`router.replace`) so every view is shareable and returnable; back restores the prior scope.
- Every scope change updates every denominator on screen in the same paint — no state where a curve reflects the new scope and its counts the old.
- Compare mode never merges: two labelled series, two Brier scores ("Live 0.241 · 214 obs" / "Backtest 0.126 · 223,671 obs"), one set of axes. When the backtest record renders (alone or in compare), its era-split disclosure line appears beneath the Brier: "reanalysis era (pre-2021) reported separately: 0.118 — accepted look-ahead leak, see Backtesting Harness."
- The market panel's population pin overrides the selector visibly, not silently: subtitle "market-linked population (the only population with a market to compare against)".

## Screen 2: Overrides (admin only)

### Purpose

Show William, descriptively and without causal framing, how his took, faded, and skipped decisions performed against settlement and against what Sightline recommended — and what acting at his chosen moments cost or captured relative to the final pre-kickoff state.

### URL pattern

`/accuracy/overrides` — query params `?season=<year>|all&stat=<statType>|all`. Admin-only: a viewer deep-linking receives the server-side 403, rendered in place, before any shell of this page exists.

### Trigger

The Overrides entry row on `/accuracy` (admin payload only); direct link.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Overrides                                    Stat [All ▾] Season [▾] │
│ William selects which contracts to mark. This record reflects those  │
│ choices, not a head-to-head against the model's full population.     │
│                                                                      │
│ ┌─ took ──────────────┐ ┌─ faded ─────────────┐ ┌─ skipped ────────┐ │
│ │ 34 decisions        │ │ 11 decisions        │ │ 21 decisions     │ │
│ │ settled: 31         │ │ settled: 10         │ │ no action taken  │ │
│ │ won 19 · lost 12    │ │ won 4 · lost 6      │ │ settled yes 9    │ │
│ │ voided 1 · pending 2│ │ (side he preferred) │ │ settled no 10    │ │
│ └─────────────────────┘ └─────────────────────┘ │ voided 2         │ │
│                                                 └──────────────────┘ │
│ ┌─ Against the recommendation ─────────────────────────────────────┐ │
│ │                 recommended    not recommended                   │ │
│ │ took            27 (won 17)    7 (won 2)                         │ │
│ │ faded           8 (won 3)      3 (won 1)                         │ │
│ │ skipped         12             9                                 │ │
│ │ per final pre-kickoff state · unmarked contracts excluded        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─ Timing cost ────────────────────────────────────────────────────┐ │
│ │ median +0.4 pts · mean +0.7 pts · 38 of 45 decisions measurable  │ │
│ │ positive = the final pre-kickoff edge exceeded the edge he acted │ │
│ │ on — waiting would have been better                              │ │
│ │ 7 unavailable: 5 no final snapshot · 2 voided                    │ │
│ │ ┌ per-decision table ─────────────────────────────────────────┐  │ │
│ │ │ date · player/stat/thr · disp · edge@decision · edge@final  │  │ │
│ │ │        · timing cost · outcome · [sources disagree]         │  │ │
│ │ └─────────────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

At `xs` the three disposition tiles stack, the agreement table renders as one card per disposition, and the per-decision table wraps each decision to a two-line row (identity line, then figures line) — nothing scrolls horizontally.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Selection-bias statement** | `Typography body2`, `text.secondary`, directly under the title | Fixed copy, always rendered, not dismissible. The surface's honesty contract. |
| **Disposition tiles** | Three bordered `Box`es, `numericLg` counts | Took and faded show settlement-graded won/lost with voided and pending separated. Fades are graded on the side actually preferred — stated in the faded tile's caption. Skipped shows what settlement did, with no win/loss language: a skip is no action, not an avoided loss or missed win. Every figure carries its n. |
| **Agreement table** | `Table size="small"` | Disposition × final-recommendation state. Cells carry count and settled-won count. Caption states the recommendation state is the final pre-kickoff snapshot's and that unmarked contracts are excluded entirely. |
| **Timing cost summary** | `numericLg` median and mean with explicit signs | The sign-convention sentence renders beside the figures, always. Unavailable decisions counted by reason, never zero-filled. |
| **Per-decision table** | `Table size="small"`, rows link to contract detail | Columns: decided date, player · stat · threshold, disposition chip, edge at decision, edge at final snapshot, signed timing cost, settlement outcome (`won ✓` / `lost ✗` / `voided`), and the `sources disagree` chip where official result and settlement imply different outcomes. Superseded decisions do not appear — only the acted-on decision state. |

### Code reference

```tsx
// /accuracy/overrides — page-level admin gate, then an admin-only read
export default async function OverridesPage({ searchParams }: Props) {
  await requireAdmin(); // forbidden() renders 403 in place for viewers
  const scope = parseOverridesScope(await searchParams);
  const overrides = await readOverridePerformance(scope);
  return <OverridesScreen overrides={overrides} scope={scope} />;
}
```

### Fields

Scope controls only: stat (six + all), season (seasons with decisions + all).

### Validation

As Screen 1: unrecognized query values fall back to defaults.

### Empty state

```text
┌──────────────────────────────────────────────┐
│ No decisions logged for this scope.          │
│ Decisions are marked from the slate; graded  │
│ results appear here after settlement.        │
└──────────────────────────────────────────────┘
```

If decisions exist but none are graded yet, the tiles render with their counts and `pending` chips — the page does not pretend to be empty.

### Loading state

Skeleton tiles and table rows at final heights.

### Error state

Single `Alert` with retry, as Screen 1. Never a partial render where tiles show and tables error separately.

### Behavior

- All figures derive from stored decision snapshots and stored final snapshots — the page never recomputes edge from current prices or projections, and a regrade updates it only through the stored grading results.
- Rows navigate to `/slate/[contractId]` for the full contract context.
- The `sources disagree` chip opens no reconciliation control — the disagreement is displayed, both values visible on the contract's outcome block, and preserved.

## Screen 3: Health (grading delta)

### Purpose

Extend the existing admin health surface so a silent failure in outcome ingest or grading is visible in the product — three signals, nothing more.

### URL pattern

`/health` — existing route, existing admin gate.

### Trigger

Existing navigation.

### Layout

Two rows join the existing signal list, and one count joins as a sub-line:

```text
│ outcome ingest      ok        last success Sun 11:20p ET (2h)    │
│ grading             late ⚠    last success Sun 3:40a ET (20h)    │
│                     3 completed games awaiting grades            │
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Outcome ingest signal** | Existing signal row pattern + `HealthStateChip` | Same six-state vocabulary (`ok`, `running`, `late`, `failed`, `never run`, `not expected`). Not expected during offseason, matching existing dormancy rules. |
| **Grading signal** | Existing signal row pattern | Same states. `late` derives from completed games whose outcomes have been ingested but whose grading cycle has not succeeded within the expected window. |
| **Awaiting-grades count** | `caption` + `numericSm` sub-line under the grading signal | Count of completed games not yet fully graded. Zero renders nothing — absence is the healthy state, per the existing convention. Non-zero renders neutrally; it turns amber only when the grading signal itself is `late` or `failed`. |

### Empty / loading / error states

Inherited from the existing health surface unchanged. `never run` covers the period before the first outcome ingest ships to production — honest, not alarming.

### Behavior

No retry controls, no run history, no per-game grading status. Recovery is command-line, documented in the runbook. The health surface reports; it never operates.

## Screen 4: Contract detail (outcome delta)

### Purpose

After a contract's game completes, its detail view states what happened — the official line, the settlement, the grades — and preserves any disagreement between the two truths visibly.

### URL pattern

`/slate/[contractId]` — existing route.

### Trigger

Row links from the slate (while listed) and from the overrides per-decision table (after settlement).

### Layout

A new block renders below the existing projection provenance once outcome data exists:

```text
┌─ Outcome ────────────────────────────────────┐
│ official result   87 receiving yards (final) │
│                   corrected Wed 2:10p ET     │
│ settlement        yes · settled Mon 1:04a ET │
│ projection grade  over 74.5: hit (p 61.4%)   │
│ recommendation    correct (final snapshot)   │
│ ⚠ sources disagree — official 87, market     │
│   settled no · both retained                 │
└──────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Official result line** | `numericMd`, neutral `text.primary` | The stat line from official results — neither model accent nor mint; it is the world, not either source's claim about it. A correction shows its correction date; the original grading basis is never silently replaced on this display. |
| **Settlement line** | `numericMd` in `market.main` | Kalshi's settlement and its time. Voided renders the `voided` chip. |
| **Grade lines** | `body2` with result glyphs | Projection grade against the official result; recommendation grade against settlement per the final snapshot; each names its truth source. Absent grades render their taxonomy chip (`pending`, `no final snapshot`, …), never blank. |
| **Disagreement notice** | Amber `source_conflict` treatment | Rendered only when the two truths imply different outcomes. Both values stay displayed. No control reconciles them. |

Decision-related lines (William's disposition and its grade) render only in the admin payload, following the existing role-serializer pattern on this route.

### Empty / loading / error states

Before the game completes the block is absent entirely — absence is the pre-outcome state, and the existing detail view is unchanged. `pending` renders once the game is complete but outcomes have not arrived.

## 6. Navigation flows

```text
Nav "Accuracy" → /accuracy (scope defaults)
  → scope change → URL updates in place, panels + denominators refetch together
  → [admin] Overrides row → /accuracy/overrides
      → per-decision row → /slate/[contractId] (outcome block visible)
      → back → /accuracy/overrides with scope preserved
  → empty-slate "View accuracy" → /accuracy

Viewer deep-links /accuracy/overrides → server-side 403 in place; no shell renders first
Health (existing nav, admin) → two new signal rows, no new navigation
```

Scope state carries in query params on both accuracy routes, so any filtered view is shareable and returnable. There are no modals or drawers in this feature; everything is page-level.

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Scope bar | `Tab` / arrows | Standard MUI toggle/select navigation; no custom shortcuts |
| Bucket table / per-decision table | `Tab` | Row links reachable in document order |
| Per-decision table | `Enter` on focused row | Open contract detail |

No new global shortcuts. This surface is read on no deadline; the slate's decision shortcuts do not apply here.

### Loading states

Every panel skeleton matches final height. The page reads stored aggregates only; if the read is slow the skeletons persist — nothing on this surface ever triggers grading, a backtest, or recomputation.

### Error states

One `Alert` per page, plain copy, retry where a retry could help. A delayed grading cycle is a freshness disclosure, not an error. A scope with no data is a designed no-data state, not an error.

### Notifications

None. This feature has no mutations and therefore no toasts. The freshness line updating on navigation is the only feedback.

### Destructive actions

None on any of these surfaces.

## 8. Responsive behavior

| Breakpoint | Behavior |
| ---------- | -------- |
| `xs` (0–599) | Single column. Scope bar wraps to two lines; panels stack (calibration → error → market → exclusions). Bucket table renders all columns at `numericSm` — it fits because its cells are short numerics. Per-decision rows wrap to two lines: identity, then figures. Disposition tiles stack. Nothing scrolls horizontally. |
| `sm` (600–899) | Disposition tiles go two-up; accuracy panels remain stacked with wider gutters. |
| `md` (900–1199) | Calibration and error panels sit side by side; market panel full width below. Agreement table and timing cost side by side where width allows. |
| `lg`+ | Content max-width applies; the reliability chart does not stretch to arbitrary width. |

Every control and every figure available at `xs`; the chart's bucket table is the guarantee that the curve's information survives any width.

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `ReliabilityCurve` | Accuracy | new | Second Recharts wrapper in the codebase; copies `DistributionSummary`'s contract: theme-fed, `isAnimationActive={false}`, `role="img"` + text equivalent, degenerate-data prose fallback. Series: live, backtest, market; hollow provisional points. |
| `AccuracyScopeBar` | Accuracy, Overrides (subset) | new | URL-backed scope controls; renders only the controls its page supports. |
| `SampleSizePair` | Accuracy (everywhere) | new | "1,847 obs · 412 projections" as one primitive so the two-denominator rule cannot be half-applied. |
| `GradeStatusChip` | Overrides, contract detail | new | The taxonomy chips (`pending`, `voided`, `sources disagree`, …) over the existing `StatusChip` primitive. |
| `DispositionChip` | Overrides | reused | Existing took/faded/skipped treatment from the slate. |
| `HealthStateChip` | Health | reused | Unchanged; the two new signals reuse it. |
| `EmptyState` | all | reused | Existing primitive for no-data states. |
| `NumericText` | all | reused | Tabular numerics everywhere. |

## 10. Accessibility, privacy, and data sensitivity

- The reliability curve always renders with its bucket table adjacent as the text equivalent, linked by `aria-labelledby`/`aria-describedby`. The chart is decoration over the table, not the other way around — the product's primary success metric must be readable by a screen reader.
- Provisional buckets are distinguished by shape (hollow, dashed) and an explicit `below floor` annotation, never by colour alone. Timing-cost direction carries an explicit sign; grades carry words and glyphs.
- Scope selects have visible labels; the market panel's population pin is stated in text.
- **Viewer payloads structurally exclude the private layer.** The accuracy read has role-selected serializers, per the established slate pattern: the viewer serializer never queries decisions, so override keys, counts, and the Overrides entry are absent from the response — not nulled, not hidden. `/accuracy/overrides` and its read reject viewers server-side before rendering anything.
- The freshness line is shared deliberately (it qualifies the shared metrics); operational health detail (signals, failures, awaiting-grades counts) remains admin-only on `/health`.
- No viewer surface implies viewers can trade, decide, or compare themselves to William. There are no rankings and no social framing anywhere on these screens.
- Nothing on any of these surfaces exposes the Kalshi signing key, raw Parquet artefacts, or any credential; the accuracy read consumes stored aggregates and grading results only.

## 11. Out of scope

**Deferred to a later pitch — the design must not preclude:**

- Suggestion-source reliability and shadow-projection analytics (Adjustment Suggestions & Source Reliability). Grading is built so shadow projections grade through the same machinery; no surface for them exists yet.
- Probability recalibration, position sizing, bankroll, ledgers, and paper-trading analytics (Bankroll, Sizing & Paper Trading). This surface produces the evidence those features consume; it fits nothing and stakes nothing.
- The paper-to-live gate evaluation view (Autonomous Execution & Circuit Breakers).
- A general backtest-run browser with run configuration detail; this pitch renders backtest calibration as a labelled record inside the accuracy surface only.
- Viewer decision logging and friend pick sharing.

**Permanent non-goals — never:**

- Win-rate leaderboards, social comparison, or any framing of override performance as a competition.
- A generic analytics workstation: no cohort builders, custom formulas, exports, notebooks, or parameter tuning.
- Sportsbook or DFS comparisons; in-game or post-kickoff grading displays; live win-probability tracking.
- Manual editing of official results or settlements through the product interface.
- Any surface that lets displayed performance alter the model, thresholds, or any staking parameter.
