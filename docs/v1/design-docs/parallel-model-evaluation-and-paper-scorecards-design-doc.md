# Parallel Model Evaluation & Paper Scorecards — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Parallel Model Evaluation & Paper Scorecards
**Focus:** The two admin surfaces that answer *which prediction engine should Sightline trust, and why* — a plain-language **Model Performance** experience (Summary → Breakdown → Advanced) that replaces the analytics-first Accuracy surface, and a **Paper Bot** experience (Performance · Activity · Settings) that replaces the Autonomy sprawl, retires Dry Run, and runs three continuous paper portfolios side by side — plus the small viewer-facing model track-record context on a contract.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

---

## Decisions settled for this document

Decisions **D1–D8** are the run instruction's pre-resolved decisions, treated as approved-doc authority; they are restated here so a reader of the design doc alone knows the ground it stands on, and again in the technical spec with the same numbers. Decisions **D9–D22** are resolved here at the design layer.

**D1. Leader and evidence thresholds reuse the Simulation Engine promotion bar, with a separate live minimum.** A leader — overall or by stat type — requires one model to beat the other by an **absolute Brier margin ≥ 0.01** in the relevant population. Below the margin renders as **too close to call**. Sample minimums differ by source: **Historical Backtest ≥ 500** graded predictions (the Simulation Engine's own backtest bar); **Live Performance ≥ 50** graded predictions (new to this pitch, lower because live evidence accrues one NFL week at a time). Below the applicable minimum renders as **not enough evidence**, regardless of the observed margin. *Overall* pools all stat types into one contract-like population before applying the rule; *by stat type* applies it independently within each stat type's own population.

**D2. Readiness always evaluates the currently-active configuration's own portfolio, and switching resets its clock.** The two-complete-NFL-weeks requirement evaluates whichever configuration — Baseline-only, Simulation-only, or Hybrid — is currently active, against **that configuration's own** continuous paper portfolio, never borrowing another's record. Changing the active configuration **resets the readiness clock** against the newly active configuration's portfolio; the prior configuration's accumulated weeks do not transfer.

**D3. Repeated pre-kickoff recomputes count once.** A contract's live-evidence sample counts **exactly one observation per model** — the latest projection generated **before the kickoff freeze boundary** (the same kickoff-timestamp concept Adjustment Suggestions established). Earlier recomputes are retained as superseded snapshots for audit and excluded from every comparison count.

**D4. Recalibration fairness is structural.** Every comparison reads each model's Brier and calibration using **that model's own fitted Probability Recalibration state, keyed by model version**. The comparison read is built so it is structurally incapable of scoring one model's projections against another model's correction — the model-version key is threaded through, with no shared or default correction object two models could resolve to.

**D5. Every scorecard shows its own opportunity count.** Alongside P&L, return, and drawdown, each paper scorecard displays the **count of candidates that portfolio evaluated** and the **count it sized a position on**. Baseline and Simulation need not see the same opportunity set; bankroll figures are never shown side by side without this context.

**D6. Hybrid sources per-stat probabilities from the current selection going forward; historical positions keep their originating model.** Going forward, Hybrid takes each stat type's probability from whichever model is selected for that stat type at decision time. A Hybrid position already opened permanently retains the model that produced its driving probability; later selection changes never relabel it.

**D7. Dry Run's user-facing gate is removed; the internal preview function survives as a non-navigable utility.** The Dry Run route, its navigation entry, and its role as a prerequisite are removed. The underlying decision-path-without-writing-a-position function remains callable by tests and internal diagnostics, reachable by no user action and in no navigation. It is **not** renamed "Preview" with the gate preserved.

**D8. One product-wide bucket-display floor: 30 observations.** Every surface that displays a rate for a probability bucket — admin Breakdown and Advanced calibration views, and the viewer track-record indicator — requires **≥ 30 observations** before showing a numeric rate (reusing the calibration circuit breaker's minimum). Below 30, the surface states plainly that not enough evidence exists in that bucket.

**D9. `Accuracy` becomes `Model Performance` — admin-only, three levels as a secondary tab row.** Nav label and route rename to **Model Performance** (`/model-performance`), staying in the admin nav group exactly as `/accuracy` is today (`requireAdmin()`, `adminGroup` in `NavSections`); `/accuracy` 308-redirects to it so old deep links survive. Three levels — **Summary** (default), **Breakdown**, **Advanced** — are a secondary tab row inside the section, deep-linked as `?level=`, mirroring how Autonomy carried seven surfaces under one nav item. Advanced *is* the prior Accuracy surface preserved intact (calibration panel, error-vs-baselines, market comparison, reliability curve, bucket table, exclusions, and the Overrides entry). Nothing statistical is deleted; it moves down a level. The pitch frames Model Performance as "the main admin model-quality experience"; a viewer's only model-quality evidence is the contract-detail track-record block (Screen 4, D18), which is the *shared* surface. This resolves the PRD's open "viewer calibration visibility" question by giving viewers the simplified form, not the full surface, and matches the current admin-only implementation.

**D10. `Autonomy` becomes `Paper Bot`, collapsing seven surfaces to three.** Nav label renames to **Paper Bot**; the route base stays `/autonomy` (the build invariant banning `/bankroll` still holds, and this is still an autonomous paper system, not portfolio management). Three surfaces: **Performance** (`/autonomy`), **Activity** (`/autonomy/activity`), **Settings** (`/autonomy/settings`). Cycles, Positions, Review, and Readiness are absorbed (Positions + Cycles → Activity; Review + Readiness → Performance). Configuration → Settings. `/autonomy/dry-run` is removed; `/autonomy/cycles`, `/positions`, `/review`, `/readiness`, `/configuration` 308-redirect to their absorbing surface so bookmarks survive. Force Override remains a route (`/autonomy/override`) reached only from the Performance banner.

**D11. Three portfolios render as three equal columns, never merged, never one bankroll figure alone.** Performance shows Baseline, Simulation, and (when a Hybrid selection exists) Hybrid as side-by-side scorecards under identical starting bankroll and risk assumptions. Each carries its own opportunity counts (D5). A Hybrid column is absent — not zeroed — when no Hybrid selection exists.

**D12. The overall/leader/recommendation surface is read-only with respect to production configuration.** No card, chip, or link on any Model Performance or Paper Bot surface writes the active model selection, the Hybrid configuration, or any risk/trading setting. "Sightline recommends Simulation" is text and a link to Settings; applying it is a distinct human action taken in Settings. There is no "apply recommendation" button anywhere.

**D13. Model selection lives in Paper Bot → Settings, per stat type, human-only.** A per-stat-type selector sets the active production model for that stat (Baseline / Simulation, where Simulation supports the stat). The current selection is always visible; Sightline's recommendation renders beside each row as advisory text; changing one stat type never changes another; saving requires an explicit confirmation restating the outgoing and incoming selection.

**D14. Leader/evidence states are one closed vocabulary, four values, everywhere.** `simulation_leads`, `baseline_leads`, `too_close_to_call`, `not_enough_evidence` — rendered as words, reinforced by a neutral/model-accent treatment, never colour alone, and every non-`not_enough_evidence` state carries its Brier margin and both sample counts. The same four values describe the overall comparison and each stat-type row.

**D15. Live and Backtest are two labelled records that never share a frame.** Every comparison names its record. A summary sentence may interpret both ("historically Simulation is stronger; live evidence is still limited") but the two counts and two Brier figures are always separately labelled, reusing the accuracy surface's Live / Backtest / Compare wall. There is no blended metric.

**D16. Confidence and predicted probability are visually and lexically distinct.** Confidence performance uses the words *low / medium / high confidence* and never a percentage; probability-range performance uses percentages and never a confidence word. The two are never adjacent without a label distinguishing them, per the pitch's confidence-terminology rabbit hole.

**D17. Paper P&L is never the headline of model quality.** On every surface where a portfolio's financial result appears near a model-quality verdict, the standing sentence separating the two renders alongside it: financial result is a supplement over a small number of positions, not proof. The overall-leader determination is driven by probability quality (D1), not by which portfolio made more fake money.

**D18. The viewer receives a track-record indicator and a range interpretation, and nothing else.** On a contract detail, a viewer sees a concise stat-type track-record label (strong / moderate / limited) and a sample-size-aware interpretation of the displayed probability's bucket, derived from the same graded record as the admin surface, subject to the 30-observation floor (D8). Viewers see no leader comparison, no model-selection control, no paper bankroll, no advanced diagnostics — absent, not disabled.

**D19. Money stays neutral-toned; only its sign takes colour.** Inherited from the paper-trading design doc: ledger dollars render in `text.primary`, not market mint; a signed P&L takes `primary.main` positive / `error.main` negative with a non-chromatic sign glyph. Model-derived figures (probability, Brier, confidence) wear the model accent; market-derived figures wear mint.

**D20. Every paper figure says "paper", permanently.** The paper-mode subtitle persists on all three Paper Bot surfaces. Paper and any future live ledger are never aggregable, and no surface offers to convert, activate, or fund anything.

**D21. Readiness remains a summary state with its detail one click away, never removed.** Performance shows the plain-language readiness summary (state, weeks complete against the active configuration's portfolio per D2, paper result, model-quality health, operational health, remaining requirement). The underlying criterion-by-criterion evidence remains available via an expandable "readiness detail" region; nothing safety-relevant is deleted, per the pitch's "removing readiness detail entirely" rabbit hole.

**D22. Shadow evaluation is invisible on shared surfaces and unambiguous in the admin data.** The slate and contract detail continue to show only the active production projection for a stat; a viewer cannot infer that a second engine is running. The admin comparison surfaces label every figure with the model version that produced it, so active and shadow output have an unambiguous boundary (the pitch's "shadow models accidentally becoming trading inputs" rabbit hole).

---

## 1. Vision

Model Performance is the screen William opens to answer a single question he now asks constantly: *is Simulation actually better than Baseline, and can I trust it enough to keep it in production?* It has to answer that without asking him to read a reliability curve — a leader, an evidence strength, a plain-language recommendation — while keeping every Brier score and calibration bin one tab away for when he, or the AI, needs to know *why*. Paper Bot answers the money-shaped version of the same question: *if each engine had run the same fake $1,000 under the same rules, which one would be ahead, and by enough to matter?* — while refusing to let two good Sundays masquerade as proof.

**North star: two engines on the same track, graded in plain language, with the ugly evidence never more than one click away — and the verdict never touching the throttle.**

---

## 2. Design principles

### 1. The verdict is legible; the machinery is reachable

Summary states a leader, an evidence strength, and a recommendation in words a non-statistician reads in one glance. Breakdown and Advanced hold the comparisons and the raw calibration that justify it. A developer choosing where a number goes asks: *does William need this to decide, or does he need this to audit?* Decide goes to Summary; audit goes down a level. Nothing is deleted to simplify — it is relocated.

### 2. A difference is not a decision

Two models always produce different numbers. The interface only says "leads" when the margin clears the bar **and** the sample clears the floor (D1); otherwise it says *too close to call* or *not enough evidence*, in those words, with the margin and both counts visible. The surface's credibility rests on it being unable to declare a winner it cannot support.

### 3. The recommendation is decision support, never control

Every recommendation surface is read-only with respect to production configuration (D12). Sightline may say *use Simulation for receiving yards*; changing receiving yards to Simulation is a separate act William takes in Settings. There is no button that closes that gap, in any state, framed any way.

### 4. Live and backtest are different questions with different answers

A model can be historically dominant across 220,000 backtested observations and still have only 41 live predictions this season. Those are two records, labelled, never averaged (D15). The summary may interpret both; it never blends them into one score that hides which evidence it rests on.

### 5. Financial result supplements, never substitutes

Paper P&L answers whether the system can grow money; it does not answer whether a model is well-calibrated. The two live side by side with the sentence that separates them (D17), and the overall verdict is driven by probability quality, not by the fatter bankroll. A green two-week scorecard grants no permission and settles no argument on its own.

### 6. Each model is graded under its own correction

A comparison that scored Simulation's projections against Baseline's fitted recalibration would look like a working comparison and be silently wrong (D4). The read threads a model-version key through every figure; there is no default correction two models could both land on. This is the one place where getting the plumbing wrong makes every screen above it confidently misleading rather than obviously broken.

---

## 3. Visual language

### 3.1 Palette used by this feature

Feature-scoped subset; the full palette lives in `sightline-ui-design`.

| Token / theme path | Usage here | Notes |
| ------------------ | ---------- | ----- |
| `palette.primary.main` | Model-derived values: model probability, Brier, confidence, projection age; the Simulation series and Simulation-favouring states | The model accent. Both engines are the model, so both wear it — engines are distinguished by label and series identity, never by giving one the market colour. |
| `palette.primary.soft` | Selected model-selection card, active model-version chip, the leader chip's ground when a model leads | |
| `palette.market.main` / `market.fill` | Kalshi-derived values: executable price, settlement, market-implied Brier in the market comparison | Nothing model-derived wears mint; a bankroll dollar is not a market value (D19). |
| `palette.text.primary` | Ledger money — bankroll, stake, fill, P&L magnitude, withdrawals; leader Brier margins | Money is neutral; only its sign takes colour. |
| `palette.text.secondary` / `.muted` | Denominators, sample counts, timestamps, the diagonal reference line, backtest series when overlaid, recommendation rationale | |
| `palette.warning.main` / `warning.soft` | `not_enough_evidence` and `too_close_to_call` states, provisional/below-floor buckets, limited track record, drawdown warning, partial fill, force-override record | Caution only. Never "bad score", never "loss". |
| `palette.error.main` / `error.soft` | Negative P&L, tripped breaker, killed state, drawdown-halt threshold line | Desaturated; encoding, not payout. |

**Distinguishing two engines that share the model accent.** Baseline and Simulation are both Sightline's model, so neither is mint and neither is rose. They are told apart by their **series identity** (Baseline uses `primary.main` at reduced opacity / a dashed stroke; Simulation uses `primary.main` solid) and, decisively, by their **always-present text label**. Colour never carries which engine a figure belongs to — the label does.

### 3.2 State colours used in this feature

Exact enum values the data model carries; nothing invented. Inherited states (`took`/`faded`/`skipped`, position/fill/breach/readiness states, risk modes) keep their treatment from the paper-trading design doc.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| Leader `simulation_leads` | Model-accent outlined chip `Simulation leads` | Carries the Brier margin + both counts |
| Leader `baseline_leads` | Model-accent outlined chip `Baseline leads` | As above |
| Leader `too_close_to_call` | Neutral outlined chip `Too close to call` | Margin below 0.01; counts still shown |
| Leader `not_enough_evidence` | Warning outlined chip `Not enough evidence` | Sample below the applicable floor (D1) |
| Evidence `strong` / `moderate` / `limited` | Three-step indicator (filled / half / outlined), always with its count | Applies to both admin evidence strength and the viewer track-record label |
| Record `live` / `backtest` | Text label on every figure; live solid, backtest muted | Never merged (D15) |
| Confidence `low` / `medium` / `high` | Confidence indicator, three steps, word-labelled | Never a percentage (D16) |
| Model-version chip | Neutral outlined, monospace version | Every comparison figure carries the version that produced it (D22) |
| Portfolio `baseline` / `simulation` / `hybrid` | Column header chip; baseline dashed accent, simulation solid accent, hybrid `primary.soft` ground | Three equal columns (D11) |
| provisional bucket | Hollow point, dashed segment, warning count | Below the 30-observation floor (D8) |
| Active-selection `active` | Model-accent filled dot + `Active` | The production model for a stat type |
| Active-selection `shadow` | Neutral outlined `Shadow` | Runs and is graded, does not drive production (D22) |

Colour is always reinforcement: every leader chip carries its words and its margin, every bucket its count, every P&L its sign, every engine its label.

### 3.3 Typography

Per the brand system: monospace numeric variants with tabular figures for every computed value — probabilities, Brier scores, margins, counts, bankroll, P&L, drawdown, timestamps. `numericLg` reserved for the four headline paper figures per scorecard and the headline Brier; `numericMd` for table figures; `numericSm` for denominators, sample counts, and per-row timestamps. Sample-size annotations use `caption`. No data value is ever bolded to signal importance; the leader and the headline earn their place by position and size, not weight.

### 3.4 Appearance

Light, dark, and system via theme tokens. Feature-specific notes:

- The **comparison bar charts and reliability overlays** (Recharts) read every colour, font, and stroke from `useTheme()`. The Baseline series (reduced-opacity / dashed accent) must stay distinguishable from the Simulation series (solid accent) in both modes and in greyscale — the dashing carries it, not the opacity alone.
- The **three-portfolio scorecards** render money in `text.primary` in both modes; the P&L sign colour must clear contrast on both grounds. The Hybrid column's `primary.soft` ground must remain distinct from the neutral Baseline/Simulation grounds in dark mode (use `border.strong`).
- Provisional (below-floor) buckets stay distinct from settled ones by shape (hollow, dashed) in both modes, never by colour alone.

---

## 4. Information architecture

```text
Sightline
├── Slate                          (shared)  ← default landing; contract detail
│   └── Contract detail            (shared)    gains a viewer track-record block
├── Model Performance              (ADMIN ONLY) ← RENAMED from Accuracy (/model-performance)
│   ├── Summary                    (admin)    ← default; leader, recommendation, scorecards
│   ├── Breakdown                  (admin)    ← by stat type / confidence / prob range / live-vs-backtest / financial
│   └── Advanced                   (admin)    ← the prior Accuracy surface, preserved
│       └── Overrides              (admin only) ← /model-performance/overrides (unchanged gate)
├── Paper Bot                      (ADMIN ONLY) ← RENAMED from Autonomy (/autonomy)
│   ├── Performance                /autonomy              ← three-portfolio scorecards + readiness summary
│   ├── Activity                   /autonomy/activity     ← positions + cycle diagnostics
│   │   └── Cycle detail           /autonomy/activity/[cycleId]  ← candidate-by-candidate audit (retained)
│   ├── Settings                   /autonomy/settings     ← bankroll, risk, withdrawal, model selection
│   └── Force override             /autonomy/override     ← from Performance banner only
├── Backtests                      (shared)  ← unchanged
├── Health                         (admin only) ← autonomy + grading signals unchanged
├── Settings                       (shared)  ← appearance
└── Users                          (admin only)

REMOVED as navigable surfaces (308-redirect to absorber; underlying records retained):
  /accuracy            → /model-performance
  /autonomy/cycles     → /autonomy/activity
  /autonomy/positions  → /autonomy/activity
  /autonomy/review     → /autonomy            (Performance)
  /autonomy/readiness  → /autonomy            (Performance, readiness summary + detail)
  /autonomy/configuration → /autonomy/settings
  /autonomy/dry-run    → REMOVED (410/redirect to /autonomy); underlying preview fn retained, non-navigable
```

`Model Performance` and `Paper Bot` both sit in the **admin nav group** (as `Accuracy` and `Autonomy` do today) and reject a viewer server-side before any shell renders; each carries its levels as a secondary tab row. The slate and contract detail stay shared and untouched except for the viewer track-record block on contract detail (Screen 4) — the one and only model-quality surface a viewer sees.

---

## 5. Screen specifications

## Screen 1: Model Performance — Summary

### Purpose

Let William determine, without reading a statistic, which engine currently leads (overall and per stat type), how strong the evidence is, how the three paper portfolios compare financially, and what Sightline recommends — and get him to the justifying detail in one click.

### URL pattern

`/model-performance` — the `Summary` level. Scope query params shared across all three levels: `?level=summary|breakdown|advanced&record=live|backtest|compare&version=<modelVersion>|all&stat=<statType>|all&season=<year>|all`. Defaults: `level=summary`, `record=live`, latest deployed version, `stat=all`, `season=all`.

### Trigger

Admin nav link `Model Performance`; deep links; the `/accuracy` redirect. Admin-only: a viewer deep-linking receives the server-side 403 in place before any shell renders.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Model Performance                                                        │
│ [ Summary | Breakdown | Advanced ]   Record [Live|Backtest|Compare]      │
│ Graded through Wk 9 · last grading cycle Sun 11:40p ET                   │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─ Overall leader ──────────────────────┐ ┌─ Sightline recommends ─────┐ │
│ │ [ Simulation leads ]                  │ │ Use Simulation overall.    │ │
│ │ Brier 0.211 vs 0.224  · margin 0.013  │ │ Baseline remains stronger  │ │
│ │ Live 96 obs · Backtest 4,812 obs      │ │ for touchdowns.            │ │
│ │ contract-like population              │ │ Live evidence still limited│ │
│ │ Live: Simulation leads (limited)      │ │ for receptions.            │ │
│ │ Backtest: Simulation leads (strong)   │ │ [ Review selection → ]     │ │
│ └───────────────────────────────────────┘ └────────────────────────────┘ │
│  Paper P&L is a financial result, not proof of model quality on its own.  │
├──────────────────────────────────────────────────────────────────────────┤
│ Best model by stat type                                    record: Live  │
│  Stat type        Leader              Margin   Live n   Evidence          │
│  Passing yards    Simulation          0.018    58       moderate          │
│  Receiving yards  Simulation          0.021    61       moderate          │
│  Rushing yards    Baseline            0.014    52       moderate          │
│  Receptions       Too close to call   0.004    47       limited (n<50)    │
│  Touchdowns       Not enough evidence —        18       limited (n<50)    │
│  (backtest leaders shown under the Backtest record)                       │
├──────────────────────────────────────────────────────────────────────────┤
│ Paper portfolios · $1,000 start · conservative · this campaign           │
│ ┌─ Baseline ──────────┐ ┌─ Simulation ────────┐ ┌─ Hybrid ────────────┐  │
│ │ Total value $1,043  │ │ Total value $1,061  │ │ Total value $1,052  │  │
│ │ active $1,043       │ │ active $1,011       │ │ active $1,052       │  │
│ │ withdrawn $0        │ │ withdrawn $50       │ │ withdrawn $0        │  │
│ │ P&L +$43  +4.3%     │ │ P&L +$61  +6.1%     │ │ P&L +$52  +5.2%     │  │
│ │ max DD 3.1%         │ │ max DD 6.8%         │ │ max DD 4.0%         │  │
│ │ evaluated 74        │ │ evaluated 71        │ │ evaluated 74        │  │
│ │ sized 22 · 22 pos   │ │ sized 19 · 19 pos   │ │ sized 24 · 24 pos   │  │
│ └─────────────────────┘ └─────────────────────┘ └─────────────────────┘  │
│  Portfolios may evaluate different opportunity sets — counts shown above. │
│  [ Open Paper Bot → ]  (admin only)                                       │
├──────────────────────────────────────────────────────────────────────────┤
│ Real-money readiness  [ paper evidence building ]  1 of 2 weeks (Hybrid)  │
├──────────────────────────────────────────────────────────────────────────┤
│ Excluded: 12 unresolvable · shown, never silently dropped                 │
└──────────────────────────────────────────────────────────────────────────┘
```

At `xs`, blocks stack in order: level+record bar (wraps), freshness, overall leader, recommendation, stat-type table (rows wrap to two lines), the three scorecards (stack full width, one per row), readiness strip, exclusions. Nothing scrolls horizontally.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Level tabs** | `Tabs` (secondary row) | Summary / Breakdown / Advanced; updates `?level=` and swaps the level body without leaving the page. |
| **Record toggle** | `ToggleButtonGroup` | Live / Backtest / Compare; updates `?record=`. Governs the stat-type table's leaders and the overall figures' emphasis. |
| **Overall leader card** | Bordered `Box`; `LeaderChip` + `numericLg` margin | The `LeaderChip` renders one of the four D14 states. Below it: model-vs-model Brier, the margin, both sample counts, the population name, and a two-line live/backtest split so a historically-strong / live-limited disagreement is visible (D15). Never a button (D12). |
| **Recommendation card** | Bordered `Box`, `body2` prose + text link | Plain-language recommendation derived from stored evidence. The only affordance is `Review selection →` linking to Paper Bot Settings; there is no apply control (D12). Renders the standing financial-vs-quality sentence beneath the pair. |
| **Stat-type table** | `Table size="small"` | One row per supported stat type: leader (`LeaderChip`), margin, sample count for the selected record, evidence strength. Rows below the floor render `limited (n<50)` / `Not enough evidence` honestly (D1). Row → Breakdown level, that stat expanded. |
| **Portfolio scorecards** | Three `PortfolioScorecard` in a `Stack direction={{xs:"column",md:"row"}}` | Baseline, Simulation, Hybrid (Hybrid absent if no selection). Each shows total value / active / withdrawn / P&L (signed, coloured) / max DD / evaluated / sized + position count (D5). Money neutral (D19). Standing opportunity-set caption beneath. `Open Paper Bot →` only in the admin payload. |
| **Readiness strip** | `Chip` + fraction + text link | Summarised state; the fraction names the active configuration's portfolio (D2). Never a button. Links to Performance's readiness detail. |
| **Exclusions line** | `caption` with per-reason counts | Present whenever records in scope are unresolvable; each reason named, never silently dropped. |

### Code reference

```tsx
// /model-performance — admin-only server component (same gate as today's /accuracy)
export default async function ModelPerformancePage({ searchParams }: Props) {
  await requireAdmin(); // forbidden() renders 403 in place for viewers, no shell first
  const scope = parseModelPerfScope(await searchParams);
  // The read is keyed by model version per series so each model is scored
  // under its OWN recalibration (D4). There is no shared correction object.
  const data = await readModelPerformance(scope);
  return <ModelPerformanceScreen data={data} scope={scope} />;
}
```

### Fields

No form fields — scope controls only (level, record, version, stat, season), as Advanced/Accuracy.

### Validation

Unrecognized query values fall back to that control's default silently (the URL is user-editable). No scope combination is invalid; it may have no data, which renders the no-data state.

### Empty state

```text
┌─ Overall leader ───────────────────────────────┐
│ Not enough evidence to compare the engines yet. │
│ Live grading began Wk 1 2026 · 8 obs.           │
│ [ View backtest record ]                        │
└─────────────────────────────────────────────────┘
```

Each block empties independently: with no Hybrid selection the Hybrid scorecard is absent (not zeroed); with no paper campaign the scorecards read `No paper campaign yet` with a link to Settings; the June state is the same page with historical/backtest records fully available.

### Loading state

Skeleton blocks at final heights: two cards at ~120px, stat table 6 rows at 40px, three scorecards at 150px. The level and record bars render immediately from the URL. This page reads stored aggregates only and never waits on a model run, a grading cycle, or a paper cycle.

### Error state

One `Alert severity="error"` ("Model performance is temporarily unavailable — the last completed results could not be read.") with retry. A delayed grading cycle is a freshness disclosure on the freshness line, not an error. A scope with no data is a designed no-data state.

### Behavior

- Level and record changes update the URL (`router.replace`) and refetch; every figure and denominator updates in the same paint (no state where the leader reflects the new record and the counts the old).
- The overall leader never declares a winner the margin/floor rule (D1) does not support; it renders `too close to call` or `not enough evidence` with the counts instead.
- The recommendation card is text + one navigational link. No state of this page mutates production configuration (D12).

---

## Screen 2: Model Performance — Breakdown

### Purpose

Let William compare the engines along the axes that actually inform a per-stat selection — by stat type, by the model's own confidence level, by predicted-probability range, by live-versus-backtest, and financially — each in plain language with its sample size attached.

### URL pattern

`/model-performance?level=breakdown` — plus a `?facet=stat|confidence|probability|period|financial` sub-selector and the shared scope params. Default `facet=stat`.

### Trigger

The `Breakdown` level tab; a stat-type row on Summary (opens `facet=stat` with that stat expanded).

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Model Performance   [ Summary | Breakdown | Advanced ]                    │
│ Facet [ Stat type | Confidence | Probability range | Live vs backtest |   │
│         Financial ]                          Record [Live|Backtest|Compare]│
├──────────────────────────────────────────────────────────────────────────┤
│ ── Facet: Stat type ──                                                    │
│  Receiving yards                                    [ Simulation leads ]   │
│   Brier   Baseline 0.238   Simulation 0.217   margin 0.021                │
│   Live 61 obs · 24 proj   Backtest 4,812 obs · 1,203 proj                 │
│   ┌──────────────────────────────────────────────────────────┐            │
│   │ grouped bar: Baseline ▓ (dashed)  Simulation █ (solid)    │            │
│   └──────────────────────────────────────────────────────────┘            │
│  Rushing yards                                      [ Baseline leads ]     │
│   ...                                                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ ── Facet: Confidence ── (the model's own confidence, not a probability)   │
│  Confidence   Baseline hit / Brier      Simulation hit / Brier   n        │
│  high         78% · 0.171               81% · 0.158              120      │
│  medium       —  (n<30)                 —  (n<30)                22       │
│  low          not enough evidence in this group                 9        │
│  Higher-confidence predictions should be more reliable; this shows        │
│  whether they are.                                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ ── Facet: Probability range ──                                            │
│  When a model says this likely, how often does it happen?                 │
│  Range      Baseline (obs%)   Simulation (obs%)   n (B / S)               │
│  70–80%     74% of the time   72% of the time     88 / 61                 │
│  80–90%     67% ⚠ overconfident 79%               41 / 33                 │
│  90–100%    not enough evidence (n<30)            18 / 12                 │
└──────────────────────────────────────────────────────────────────────────┘
```

At `xs`, the facet selector becomes a full-width `Select`; each comparison renders as a stacked pair of labelled rows rather than side-by-side columns; charts keep full width at 180px with the legend beneath.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Facet selector** | `ToggleButtonGroup` (md+) / `Select` (xs), deep-linked `?facet=` | Five facets. Each renders both engines side by side under the selected record. |
| **Stat-type facet** | One `StatComparison` block per stat type | Leader chip, both Briers, the margin, both records' counts, and a `ComparisonBarChart` (Baseline dashed, Simulation solid). Expandable to show that stat's probability-range table inline. |
| **Confidence facet** | `Table size="small"` | Rows: high / medium / low. Cells show each engine's hit rate and Brier with the group's n. A group below 30 renders `— (n<30)` (D8). Standing caption distinguishes confidence from probability (D16). |
| **Probability-range facet** | `Table size="small"` | Fixed ten-bucket ranges collapsed into the readable bands; each cell is the observed frequency in plain language with the band's n per engine. Below 30 → `not enough evidence` (D8). Material over/under-confidence flagged in words with a warning glyph, never colour alone. |
| **Live-vs-backtest facet** | Two labelled `StatComparison` columns | The same stat comparisons under Live and Backtest side by side, never merged (D15). |
| **Financial facet** | The three `PortfolioScorecard`s plus a risk sub-table | Reuses Screen 1's scorecards with drawdown and fill-quality detail; carries the financial-vs-quality sentence (D17) and the opportunity-set caption (D5). Read-only mirror of Paper Bot Performance; the editable version lives in Paper Bot. |

### Empty / loading / error states

Each facet empties independently with an honest sentence (`Not enough graded predictions in this facet for the selected record`). A bucket or confidence group below its floor is a labelled insufficient-evidence cell, not a blank. Skeleton tables at final height; one `Alert` with retry on read failure. No mutations, no notifications.

### Behavior

- Facet and record are deep-linked so any comparison is shareable and returnable.
- Every rate carries its n; no rate renders below the 30-observation floor (D8).
- Nothing here writes configuration; the financial facet is a read-only mirror of Paper Bot.

---

## Screen 3: Model Performance — Advanced

### Purpose

Preserve, intact, the full statistical evidence the prior Accuracy surface exposed — reliability curve, Brier, calibration bins, error-vs-baselines, market comparison, model-version detail — so the AI and an expert user can diagnose *why* a Summary conclusion was reached. Nothing is deleted; it lives here.

### URL pattern

`/model-performance?level=advanced` — plus the prior accuracy scope params (`population`, `version`, etc.) and the shared scope. This level *is* the former `/accuracy` page body.

### Trigger

The `Advanced` level tab; a "see the evidence" link from Summary's leader card; deep links (including the `/accuracy` redirect landing here when `?level=advanced` is present).

### Layout

The former Accuracy surface, unchanged in substance, rendered inside the level: the calibration panel (headline Brier with both denominators, reliability curve, bucket table), the error-vs-baselines panel (MAE/RMSE, mean headline, median disclosed), the market-comparison panel (market-linked population, interval), the exclusions line, and — in the admin payload only — the Overrides entry row to `/model-performance/overrides`.

One addition specific to this pitch: a **model-version selector** that can pin the panels to a single engine's version, and a **two-model overlay** in the reliability curve (Baseline dashed, Simulation solid) so an expert can read both calibration curves on one axis. Each series is scored under its own recalibration (D4); the panel states, in text, which version and which correction each series used.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Calibration panel** | Reused `ReliabilityCurve` + bucket `Table` | Now supports two model series overlaid, each labelled with its version and correction. Provisional buckets hollow/dashed below the 30-observation floor for the display (D8), matching the stored floor semantics. |
| **Error / market panels** | Reused, unchanged | As the prior accuracy surface. Market comparison stays pinned to the market-linked population. |
| **Model-version selector** | `Select`, deep-linked | Pins panels to one engine's version, or `all (deployed system)`. |
| **Overrides entry** | `ButtonBase` row, admin payload only | Navigates to `/model-performance/overrides`. Absent (not disabled) for viewers. |

### Empty / loading / error states

Inherited from the Accuracy surface unchanged: per-panel empty states, skeletons at final height, one `Alert` with retry, delayed grading as a freshness disclosure.

### Behavior

Unchanged from the Accuracy surface, with the two additions above. This level never blends Live and Backtest into one curve; Compare overlays two labelled series. The reliability curve always renders its bucket table as the text equivalent.

---

## Screen 4: Contract detail — viewer track-record block (delta)

### Purpose

Give a viewer (and the admin) a small, honest piece of model-quality context on the contract they are looking at — how the model's stated probability in this range has actually resolved, and how strong the model's track record is for this stat type — without exposing any admin comparison, selection, or bankroll.

### URL pattern

`/slate/[contractId]` — existing shared route. The block renders for all authenticated users.

### Trigger

Opening a contract detail whose stat type has graded model evidence.

### Layout

```text
┌─ Model track record ─────────────────────────────┐
│ Sightline probability   74%   conf high          │
│ Predictions in the 70–80% range have occurred     │
│ 72% of the time across 184 graded observations.   │
│ Receiving yards track record:  [ Strong ]         │
└───────────────────────────────────────────────────┘
```

Below the floor:

```text
┌─ Model track record ─────────────────────────────┐
│ Sightline probability   74%   conf high          │
│ Not enough graded predictions in this range yet   │
│ to report how often they've occurred (18 so far). │
│ Receiving yards track record:  [ Limited ]        │
└───────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Probability + confidence** | `numericMd` model-accent probability + confidence indicator | The active production model's projection for this contract; confidence is a word, never conflated with the probability (D16). |
| **Range interpretation** | `body2` prose + `numericSm` count | The observed frequency for the displayed probability's bucket, from the same graded record as the admin surface, with its n. Below 30 observations it states plainly that there is not enough evidence yet, with the running count (D8, D18). |
| **Track-record label** | `EvidenceChip` (`strong`/`moderate`/`limited`) | Stat-type track record derived from graded live+backtest evidence. `limited` in warning tone. A `limited` label never implies profitability (viewer-overinterpretation rabbit hole). |

The block derives from the **active production model** for the stat; it shows no comparison between engines, no shadow model, no leader, no paper figure. For the admin, the same block renders identically — the richer comparison lives on Model Performance, not on the shared contract surface (D22).

### Empty / loading / error states

Before any graded evidence exists for the stat type, the block renders `Model track record: building` with the count so far, never absent-without-explanation and never a fabricated rate. Skeleton at ~90px while the detail loads. A read failure hides the block rather than erroring the whole detail view (it is supplementary context, not the contract).

### Behavior

- Read-only; no controls. The block never links to admin surfaces from a viewer payload.
- The rate always carries its sample size; no rate renders below 30 observations (D8).

---

## Screen 5: Paper Bot — Performance

### Purpose

Tell William, in one screen, how the three paper portfolios compare financially under identical assumptions, which is leading, what the drawdowns were, and how close the system is to real-money readiness — folding in the old Overview, Review, and Readiness without their sprawl.

### URL pattern

`/autonomy` — the Performance surface, Paper Bot's landing. Period filter deep-linked `?period=current_week|previous_week|two_week|campaign`. Default `campaign`.

### Trigger

The `Paper Bot` nav item; the Summary scorecards' `Open Paper Bot →` link.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Paper Bot   [ Performance | Activity | Settings ]     [ Kill autonomy ]   │
│ Paper mode · all figures simulated                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ ⚠ Simulation portfolio halted — drawdown 11.2% vs 10.0% (conservative)    │
│   Tripped Sun 26 Oct 1:47p · [Resume] [Force override →]  (per portfolio) │
├──────────────────────────────────────────────────────────────────────────┤
│ Period [ Campaign ▾ ]   $1,000 start · conservative · began Wk 7          │
│ ┌─ Baseline ──────────┐ ┌─ Simulation ────────┐ ┌─ Hybrid ────────────┐  │
│ │ [ baseline ]        │ │ [ simulation ]      │ │ [ hybrid ]  active  │  │
│ │ Total value $1,043  │ │ Total value $1,061  │ │ Total value $1,052  │  │
│ │ active $1,043       │ │ active $1,011       │ │ active $1,052       │  │
│ │ withdrawn $0.00     │ │ withdrawn $50.00    │ │ withdrawn $0.00     │  │
│ │ Net P&L +$43.00     │ │ Net P&L +$61.00     │ │ Net P&L +$52.00     │  │
│ │ Return +4.3%        │ │ Return +6.1%        │ │ Return +5.2%        │  │
│ │ Max drawdown 3.1%   │ │ Max drawdown 6.8%   │ │ Max drawdown 4.0%   │  │
│ │ evaluated 74        │ │ evaluated 71        │ │ evaluated 74        │  │
│ │ sized 22 · 22 pos   │ │ sized 19 · 19 pos   │ │ sized 24 · 24 pos   │  │
│ │ risk conservative   │ │ risk conservative   │ │ risk conservative   │  │
│ │ 1 breaker trip      │ │ 1 halt (overridden) │ │ 0 breaker events    │  │
│ └─────────────────────┘ └─────────────────────┘ └─────────────────────┘  │
│  Leading by paper P&L: Simulation (+$61). This is a financial result over │
│  a small number of positions, not proof of model quality. See Model       │
│  Performance for calibration evidence. → Model Performance                │
│  Portfolios may evaluate different opportunity sets — counts shown above.  │
├──────────────────────────────────────────────────────────────────────────┤
│ Bankroll history                                    [ per portfolio ▾ ]   │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │ three lines: Baseline ▓  Simulation █  Hybrid ·  high-water, halt │    │
│  └──────────────────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────┤
│ Real-money readiness   [ paper evidence building ]                        │
│  Evaluating the active configuration: Hybrid                              │
│  1 of 2 required NFL weeks complete   ·   Paper result: Positive          │
│  Model quality: Healthy   ·   Operational record: Healthy                 │
│  Remaining: one additional complete week                                  │
│  Switching the active configuration resets this clock against the new     │
│  configuration's own portfolio.                          [ Detail ⌄ ]     │
│  Readiness never enables real-money trading. That is a separate human act │
│  in the later Kalshi Live Trading capability.                             │
└──────────────────────────────────────────────────────────────────────────┘
```

The `[ Detail ⌄ ]` expander reveals the criterion-by-criterion readiness evidence (the former Readiness screen's rows) inline, keeping the safety detail one click away (D21).

### Layout — `xs`

Kill switch moves to a fixed bottom bar, always reachable. The three scorecards stack full width, one per row. The chart keeps full width at 180px with the legend beneath. Readiness summary stacks its lines; the detail expander opens inline.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Paper-mode subtitle** | `caption` in `text.muted` under the `h1` | On all three Paper Bot surfaces; never dismissible (D20). |
| **Level tabs** | `Tabs` (secondary row) | Performance / Activity / Settings. |
| **Kill autonomy** | `Button variant="outlined" color="error"` | Unchanged from the paper-trading design doc: no confirmation, immediate, always reachable. Kills all portfolios' new-position creation. |
| **State banner** | `Alert` per active breach | Breaches are **per portfolio** — the banner names which portfolio halted. Resume / Force override act on that portfolio. |
| **Period filter** | `Select`, deep-linked `?period=` | Current week / previous week / required two-week / campaign. Selecting a shorter period reports the portion of the ongoing campaign; it never resets a bankroll (campaign-restart rabbit hole). |
| **Portfolio scorecards** | Three `PortfolioScorecard`, side by side (D11) | Baseline, Simulation, Hybrid (Hybrid absent if no selection). All required paper figures (D5): start, active, withdrawn, net P&L, return, max DD, evaluated, sized, positions, risk mode, breaker events. Money neutral; sign coloured (D19). |
| **Leading line + standing sentence** | `body2` | Names which portfolio leads by paper P&L and immediately carries the financial-vs-quality sentence with a link to Model Performance (D17). Never presents P&L as the model verdict. |
| **Opportunity caption** | `caption` | The D5 different-opportunity-sets disclosure, always present with the scorecards. |
| **Bankroll chart** | `BankrollChart` extended to three series | Baseline / Simulation / Hybrid lines, theme-driven, with high-water and halt reference lines; per-portfolio selector to isolate one. Text-equivalent summary in a `visuallyHidden` block. |
| **Readiness summary** | `ReadinessSummary` | Plain-language state naming the **active configuration** and its own portfolio (D2), with the reset-on-switch sentence and the never-auto-enable sentence. `[ Detail ⌄ ]` expands the criterion rows (D21). |

### Empty / loading / error states

- **No campaign yet:** the scorecards are replaced by `No paper campaign configured. Set a starting bankroll and risk mode in Settings.` with a link; readiness reads `not ready — no campaign`.
- **No Hybrid selection:** the Hybrid column is absent (not zeroed); the leading line compares Baseline and Simulation only.
- **Offseason / no cycles this period:** scorecards render real figures with the period's start=end where nothing traded, and a `No cycles ran in this period` note rather than an empty chart.
- **Mark-to-market unavailable:** the "active" component and drawdown for affected portfolios render `unavailable` with a last-fetch timestamp and one info banner; settled figures stay exact (drawdown never falls back to a different basis than the breaker uses).
- **Loading:** skeletons at final heights; the kill switch, subtitle, and banner severity render from the first byte and never skeleton.
- **Error:** one `Alert` with retry replaces the body; the kill switch stays rendered and functional above it.

### Behavior

- Kill, Resume, and Force Override retain their paper-trading-design-doc shapes and separations (Principle 4 there); breaches and the three controls are now scoped **per portfolio**, and the banner always names the portfolio.
- The period filter never resets bankroll history; it windows the running campaign.
- Nothing on Performance writes model selection or risk configuration; readiness never enables live trading (D12, D21).
- The readiness fraction always reflects the active configuration's own portfolio, and the copy states the reset-on-switch rule (D2) so a configuration switch right before a check cannot read as "the evidence already counts".

---

## Screen 6: Paper Bot — Activity

### Purpose

Keep the full simulated-position ledger and the candidate-by-candidate cycle diagnostics available for inspection and audit, without making scheduler internals a primary workflow.

### URL pattern

`/autonomy/activity` — filters deep-linked `?portfolio=baseline|simulation|hybrid|all&view=positions|cycles&status=open|settled|all&week=<n>`. Defaults `portfolio=all`, `view=positions`, `status=open` when any are open.

### Trigger

The `Activity` level tab; a portfolio scorecard's position count linking through with that portfolio pre-selected.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Paper Bot   [ Performance | Activity | Settings ]                         │
│ Paper mode · all positions simulated · never live                         │
├──────────────────────────────────────────────────────────────────────────┤
│ Portfolio [ All ▾ ]  View [ Positions | Cycles ]  Status [open|settled|all]│
├──────────────────────────────────────────────────────────────────────────┤
│ ── Positions ──                                                           │
│ Portfolio  Contract               Side Qty Cost  Mark  Result    P&L      │
│ simulation Chase rec yds ≥74.5    yes  32 $17.60 $19.20 open       —       │
│  opened Sun 26 Oct · intended $17.75 · filled complete · model sim v3     │
│ hybrid     Chase rec yds ≥74.5    yes  30 $16.50 $18.00 open       —       │
│  opened Sun 26 Oct · sourced from Simulation (hybrid receiving = sim)     │
│ baseline   Najee rush yds ≥54.5   yes  28 $15.40   —   settled yes +$12.60 │
│  opened Sun 19 Oct · settled Sun 19 Oct · model baseline v7               │
├──────────────────────────────────────────────────────────────────────────┤
│ (View: Cycles) rows → cycle detail, retained candidate-by-candidate audit │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Portfolio filter** | `Select`, deep-linked | Baseline / Simulation / Hybrid / All. Every row carries its portfolio so `All` stays legible. |
| **View toggle** | `ToggleButtonGroup` | Positions (the ledger) / Cycles (diagnostics). |
| **Positions table** | Reused `PositionsTable`, plus a portfolio column and a **model-attribution** sub-line | Each row's second line names the model version that produced the driving probability. For a Hybrid position it names which engine supplied the stat and **retains that attribution permanently** (D6) — a later selection change never rewrites it. Intended-vs-filled always both shown. |
| **Cycles table** | Reused `CyclesTable` + portfolio column | Every cycle (including no-candidate, halted, skipped, failed) with its outcome and reason; row → cycle detail. This is the former Cycles surface, now a diagnostic view rather than a nav destination. Underlying records are retained in full (cycle-deletion rabbit hole). |
| **Cycle detail** | Reused `CandidateCard` audit at `/autonomy/activity/[cycleId]` | Unchanged candidate-by-candidate audit with `bound by:` reasons; now also names the portfolio and model version. |

### Empty / loading / error states

- No positions: `No paper positions. Positions appear once a cycle fills one.` with a link to Cycles view.
- Filter with none matching: honest count + a link to widen the filter.
- Offseason: the last cycle date and next scheduled window.
- Skeleton rows at two-line height; one `Alert` with retry on read failure. Mark-to-market unavailable renders per-row `unavailable` with one banner; the table stays usable.

### Behavior

- Deep-linked filters; a failed cycle is a row with a reason, not an error state.
- Hybrid position attribution is permanent (D6); the sub-line is read from the stored originating model, never recomputed from the current selection.
- No reset/clear/delete control exists (paper history is a record).

---

## Screen 7: Paper Bot — Settings

### Purpose

Let William configure the paper campaign — starting bankroll, risk mode, withdrawal behaviour, continuous-evaluation state — and set the active production model per stat type, with Sightline's recommendation shown but never applied automatically.

### URL pattern

`/autonomy/settings`

### Trigger

The `Settings` level tab; the Summary recommendation card's `Review selection →`; Performance's `Configure` affordances.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Paper Bot   [ Performance | Activity | Settings ]                         │
│ Paper mode · all settings apply to simulated trading only                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Active model by stat type                                                 │
│  Sightline recommends a selection. It never applies one — you do.         │
│  Stat type        Active        Recommended        Evidence               │
│  Passing yards    ( ) Baseline  (•) Simulation ★   Simulation (moderate)  │
│  Receiving yards  ( ) Baseline  (•) Simulation ★   Simulation (moderate)  │
│  Rushing yards    (•) Baseline  ( ) Simulation     Baseline  (moderate)   │
│  Receptions       (•) Baseline  ( ) Simulation ★   too close to call      │
│  Touchdowns       (•) Baseline  ( ) [Sim n/a]      not enough evidence    │
│  ★ = Sightline's current recommendation                                   │
│  Changing a stat type changes only that stat type. Switching a stat's     │
│  model resets the readiness clock against the newly active configuration. │
│                                            [ Cancel ]  [ Save selection ] │
├──────────────────────────────────────────────────────────────────────────┤
│ Risk mode   [ conservative ● | moderate | aggressive | custom ]           │
│  (unchanged from the paper-trading configuration: Kelly fraction, caps,   │
│   drawdown halt, probability ceiling independent of mode)                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Bankroll                                                                  │
│  Starting bankroll  [ 1000.00 ] $   locked once the first position fills  │
│  Withdrawal ceiling [ 1.5 ] ×  of starting = $1,500.00                    │
│  Applies identically to Baseline, Simulation, and Hybrid portfolios.      │
├──────────────────────────────────────────────────────────────────────────┤
│ Continuous paper evaluation                                               │
│  [ ● ] Enabled — cycles run automatically for eligible game windows       │
│  Both engines run every eligible window; the non-active engine runs in    │
│  shadow. No Dry Run is required.                                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                          [ Cancel ]  [ Save configuration ]│
└──────────────────────────────────────────────────────────────────────────┘
```

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Active model per stat type | radio per stat (Baseline / Simulation) | yes | current selection | Simulation disabled with `Sim n/a` where the engine does not support the stat. Changing one stat never changes another (D13). Recommendation (`★`) is advisory only. |
| Risk mode | enum | yes | `conservative` | Unchanged from paper-trading config; custom parameters as before. |
| Starting bankroll | currency | yes | `1000.00` | > 0; **locked once any position fills** (applies to all three portfolios' shared basis). |
| Withdrawal ceiling | decimal ×| yes | `1.5` | ≥ 1.0; resolved dollar shown live. |
| Continuous paper evaluation | switch | yes | off | Turning on runs both engines every eligible window (shadow + active); no Dry Run gate (D7). |

### Validation

- Inline errors beneath the offending field; `Save` disabled while invalid or unchanged, with the reason in helper text.
- **Saving a model-selection change opens a confirmation `Dialog`** restating the outgoing and incoming model for the changed stat type(s) and the sentence: *This changes production for {stat} to {model}. It resets the readiness clock against the newly active configuration's own paper portfolio.* (D2, D13). This is the human action the whole recommendation surface refuses to take on its own (D12).
- Changing risk mode keeps its existing confirmation restating outgoing/incoming parameters.
- Starting-bankroll changes are closed once positions exist (disabled with helper text), not guarded — the destructive path stays shut.

### Empty / loading / error states

No empty state — settings always have values (defaults). Skeleton cards while loading. Save failure → `Alert` above the actions with the reason, all field values preserved, nothing partially applied.

### Behavior

- **Model selection is the only place production configuration changes, and only on an explicit, confirmed human save** (D12, D13). No recommendation, leader, or readiness state anywhere writes here automatically — the radios reflect the stored selection until William saves a change.
- Switching a stat's active model resets that configuration's readiness clock (D2); the confirmation states it so the reset is never a surprise.
- Enabling continuous evaluation starts both engines running (active + shadow) without a Dry Run (D7); disabling stops new cycles but never deletes history.

---

## 6. Navigation flows

```text
Nav "Model Performance" → /model-performance (Summary)
  → level tab → ?level=breakdown | advanced (in place, scope preserved)
  → Summary stat row → Breakdown, facet=stat, that stat expanded
  → Summary leader "see the evidence" → Advanced calibration
  → Summary recommendation "Review selection →" → /autonomy/settings (admin) [READ-ONLY link; no apply]
  → [admin] Advanced Overrides row → /model-performance/overrides
  → /accuracy (legacy) → 308 → /model-performance (?level=advanced when present)

Nav "Paper Bot" (admin) → /autonomy (Performance)
  → level tab → /autonomy/activity | /autonomy/settings
  → scorecard position count → /autonomy/activity?portfolio=<p>&view=positions
  → Activity cycle row → /autonomy/activity/[cycleId] → [player] → /slate/[contractId] (shared)
  → Performance banner [Force override →] → /autonomy/override (per portfolio) → back
  → Performance readiness [Detail ⌄] → inline expand (no navigation)
  → Settings [Save selection] → confirmation Dialog → in place; readiness clock resets
  legacy /autonomy/{cycles,positions,review,readiness,configuration} → 308 → absorber
  legacy /autonomy/dry-run → redirect to /autonomy (feature removed)

Contract detail (shared) → model track-record block renders inline; no outbound admin links on viewer payload

Any Paper Bot route reached by a viewer → server-side 403 in place; no chrome first
```

Scope (level, record, version, stat, season, facet) carries in query params on Model Performance; portfolio/view/status/period carry on Paper Bot. Every filtered view is shareable and returnable. The only production-configuration mutation in the whole feature is the confirmed Save in Paper Bot Settings.

---

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Level / facet tabs | `Tab` / arrows | Standard MUI tab navigation |
| Stat-type / comparison tables | `Tab` | Row links reachable in document order |
| Summary stat row | `Enter` | Open Breakdown for that stat |
| Activity list | `↑` / `↓` / `Enter` | Move rows / open cycle detail |
| Cycle detail | `Esc` | Back to Activity, focus returns to the row |
| Settings model radios | arrows within a stat's group | Move Baseline↔Simulation for that stat only |
| Settings | `Enter` in a field | Does **not** submit; Save is explicit |
| Kill / Resume / Force override | — | No keyboard shortcut submits any of these (unchanged) |

No shortcut anywhere applies a recommendation, switches a model, kills, resumes, overrides, or saves. Model selection and every safety control require explicit pointer/`Enter`-on-focused-button activation.

### Loading states

`Skeleton` at final heights on every list and panel. On Paper Bot, the kill switch, paper-mode subtitle, and banner severity render from the first byte and never skeleton. Model Performance reads stored aggregates only and never waits on a model run, grading, or a paper cycle.

### Error states

One `Alert` per surface with plain-English cause and retry where retry helps. A delayed grading cycle, a scope/facet with no data, a bucket below the floor, and Kalshi-unavailable mark-to-market are all designed disclosures, not errors. A failed cycle is a row with a reason on Activity, not an error state.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Model selection saved | `Selection saved. {stat} now uses {model} in production. Readiness clock reset against the active configuration.` | success | persistent until dismissed |
| Configuration saved | `Configuration saved. Applies to the next sizing decision.` | success | 4s |
| Continuous evaluation enabled | `Continuous paper evaluation enabled. Both engines run each eligible window.` | success | 4s |
| Kill / Resume / Force override | (unchanged from paper-trading design doc) | — | — |
| Any read on Model Performance | none — this feature's shared surfaces have no mutations | — | — |

A model-selection change is a **persistent** notification, deliberately: it changes what production does, and a vanishing toast is not an adequate record of that.

### Destructive / consequential actions

| Action | Pattern |
| ------ | ------- |
| Save model selection | Confirmation `Dialog` restating outgoing/incoming model per changed stat and the readiness-reset sentence (D13, D2) |
| Change risk mode | Confirmation `Dialog` with outgoing/incoming parameters (unchanged) |
| Kill / Disengage kill / Resume / Force override | Unchanged shapes and separations from the paper-trading design doc |
| Enable continuous evaluation | Confirmation `Dialog`: `Enable continuous paper evaluation? Both engines run before each eligible game window without further approval. All figures are simulated.` |

There is no "apply recommendation", no "auto-select best", no "sync config to summary", and no reset/clear/delete of paper history anywhere in the feature (D12).

---

## 8. Responsive behavior

| Breakpoint | Behavior |
| ---------- | -------- |
| `xs` 0–599 | Level/facet bars wrap or become `Select`s. Overall-leader and recommendation cards stack. Stat-type and comparison tables wrap each row to two lines. The three portfolio scorecards stack full width, one per row, each keeping all its figures. Charts full width at 180px with legend beneath. Paper Bot kill switch fixed to a bottom bar, always reachable. Settings model-selection rows stack (stat label, then the two radios, then recommendation). Nothing scrolls horizontally. |
| `sm` 600–899 | Scorecards go two-up then wrap; comparison tables return to side-by-side where width allows. |
| `md` 900–1199 | Full layout as wireframed; three scorecards in a row; level tabs horizontal. |
| `lg` 1200–1535 | All table columns visible without truncation; reliability curve and comparison charts do not stretch. |
| `xl` 1536+ | Content max-width applies; scorecards and tables do not stretch to arbitrary width. |

Every control and figure is reachable at `xs`, including all three scorecards, the readiness detail expander, and every Settings field. Scorecard height is identical across Baseline / Simulation / Hybrid at every breakpoint so the columns scan.

---

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `LeaderChip` | Summary, Breakdown, Settings | new | Four-state closed vocabulary (D14); always carries margin + counts; never a button. |
| `EvidenceChip` | Summary, Breakdown, contract detail | new | `strong` / `moderate` / `limited` with its count; shared by admin evidence strength and the viewer track record. |
| `PortfolioScorecard` | Summary, Breakdown (financial), Performance | new | One column per portfolio; all D5 figures; money neutral, sign coloured; opportunity counts mandatory. |
| `ComparisonBarChart` | Breakdown | new | Recharts, theme-fed; Baseline dashed / Simulation solid; text-equivalent table adjacent. |
| `ModelTrackRecordBlock` | Contract detail | new | Viewer-safe; range interpretation + track-record label; 30-obs floor; no admin links on viewer payload (D18). |
| `RecommendationCard` | Summary | new | Prose + one navigational link; no apply control (D12). |
| `ReadinessSummary` | Performance, Summary strip | new | Plain-language state naming the active configuration's portfolio (D2); expandable detail (D21). |
| `ModelSelectionTable` | Settings | new | Per-stat radios (Baseline/Simulation); recommendation advisory; confirmed save is the only production mutation (D13). |
| `ReliabilityCurve` | Advanced | **reused** | Extended to overlay two model series, each labelled with version + correction (D4). |
| `AccuracyScopeBar` / panels | Advanced | **reused** | The prior Accuracy surface intact. |
| `BankrollChart` | Performance | **reused** | Extended to three portfolio series. |
| `PositionsTable` / `CyclesTable` / `CandidateCard` | Activity | **reused** | Gain a portfolio column and model-version attribution; Hybrid attribution permanent (D6). |
| `KillSwitchButton` / `AutonomyStateBanner` / `BreachRow` | Performance, Force override | **reused** | Now scoped per portfolio. |
| `RiskModeChip` / risk fields | Settings | **reused** | Unchanged. |
| `SampleSizePair` / `NumericText` / `EmptyState` / `DispositionChip` | everywhere | **reused** | Two-denominator primitive, tabular numerics, no-data states. |

`LeaderChip`, `PortfolioScorecard`, and `ModelSelectionTable` are the three worth getting exactly right: the first must be unable to declare a winner it can't support, the second must never show a bankroll without its opportunity counts, and the third must be the *only* thing in the feature that can change production — and only on a confirmed human action.

---

## 10. Accessibility, privacy, and data sensitivity

### Accessibility

- Every chip, glyph, and series has a text equivalent. `LeaderChip` states its word and carries margin + counts; the three-step `EvidenceChip` carries its word and n; the confidence indicator carries its word (never a bare bar).
- **No state relies on colour alone.** Which engine a figure belongs to is carried by its label, not its stroke; leader states by words; over/under-confidence by an explicit word and glyph; provisional buckets by shape.
- `ComparisonBarChart`, `ReliabilityCurve`, and `BankrollChart` each render a `visuallyHidden` text summary and (for calibration) an adjacent bucket table as the primary accessible representation — the curve is decoration over the table.
- Settings radios are grouped per stat type with a group label; the confirmation dialog traps focus and returns it to the trigger; the model-selection change announces via `role="status"`.
- The Paper Bot kill switch's accessible name states its effect.

### Privacy and data sensitivity

- **The entire Model Performance surface (Summary, Breakdown, Advanced) and the entire Paper Bot surface are admin-only**, rejected server-side before any shell renders, and absent from a viewer's navigation (not disabled, not blurred). This matches the current `/accuracy` and `/autonomy` gates and the pitch's framing of Model Performance as the admin model-quality experience. A viewer sees no leader comparison, no scorecards, no recommendation card, no selection control, and no bankroll.
- The **viewer track-record block** on contract detail is the *only* model-quality surface a viewer sees. It is derived from the same graded record as the admin surface but exposes only the active model's probability-range interpretation and a strong/moderate/limited label. It contains no leader comparison, no shadow-model figure, no paper bankroll, and no admin link. A viewer cannot infer from any shared surface that a second engine runs, that portfolios exist, or that a bankroll exists (D22).
- Every Paper Bot route rejects a viewer server-side before any shell renders; the Paper Bot nav item is absent for viewers.
- No surface exposes the Kalshi signing key, a credential field, an order control, or any "connect account" affordance. Paper figures are never described as real money; nothing offers to convert, fund, or activate. The Kalshi key never appears on Settings, Health, or in any error message.
- Open-Meteo attribution is unaffected (this feature displays no new weather data).

---

## 11. Out of scope

### Deferred to a later pitch — the design must not preclude these

- **Kalshi Live Trading and any real-money mode.** No order placement, no real fills, no paper→live switch, no funding affordance. Every surface is paper, permanently (D20). Live trading renumbers to Pitch 12.
- **What-if Replay / arbitrary bankroll replay.** The period filter windows the actual running campaign only; it never recomputes an alternative history from a different starting bankroll. The counterfactual risk-mode replay from the paper-trading pitch is *not* reintroduced here.
- **Additional suggestion sources, additional stat types, NBA/WNBA.** The comparison and selection surfaces are stat-type-generic so a new stat slots in, but none is added here.
- **Automatic promotion, auto-selection, or auto-Hybrid.** Permanently a human action (D12); listed here to mark that the design deliberately builds no path toward it.

### Permanent non-goals — not to be relitigated

- Sportsbook or DFS model evaluation of any kind.
- Public or commercial access; these surfaces are for one admin and a few viewers.
- Live in-game evaluation; shadow projections are pre-kickoff only (temporal integrity, backfilling form).
- Viewers trading through Sightline, viewer bankrolls, viewer-specific model selection, or any viewer paper portfolio.
- Sightline authorising itself to change production configuration or to risk real money. No control in this feature, in any state, framed any way, does either.
- A generic experimentation platform, a composite "model score" without defensible meaning, or any framing that turns uncertainty into false certainty.

---

## 12. Open questions

None blocking design. Every question this document faced was resolvable from the pitch, the run instruction's pre-resolved decisions (D1–D8), the approved planning docs, or the two predecessor design docs (Accuracy Surface, Paper Trading), and each resolution is recorded in the Decisions section (D9–D22). Questions of arithmetic — how the leader margin is computed across a pooled versus per-stat population, how the recommendation sentence is generated, how a Hybrid position's originating model is stored — are implementation questions resolved in the technical spec, not here.
