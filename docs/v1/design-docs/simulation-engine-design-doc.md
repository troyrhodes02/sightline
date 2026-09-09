# Simulation Engine — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Simulation Engine
**Focus:** The thin user-facing footprint of an otherwise Python-side pitch — per-contract model provenance on the slate and contract detail, the "insufficient evidence to project" state, and the per-model-version split on the Accuracy & Calibration Surface.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

## Scope note — why this pitch has a design doc at all

The `sightline-design-doc` skill lists Simulation Engine among the pitches that "ship no interface." That default is correct for the *engine* — the three predictive layers, the joint simulation, and the validation harness are Python modelling with no screen. But three product decisions in this pitch's run instruction do change what the user sees, and each is small, load-bearing, and easy to get wrong if left to implementation:

1. **Model provenance becomes visible.** Because model selection is per stat type (Resolved Decision 1), two contracts on the same slate may be priced by different models. The user must be able to see which system produced the number in front of him. This is a new indicator on the slate and contract detail.
2. **"Insufficient evidence to project" becomes a first-class state** (Resolved Decision 4). Zero relevant history declines to project rather than fabricating a number. That decline needs a designed appearance, not a blank cell.
3. **The Accuracy surface splits by model version** (Resolved Decision 3). Baseline and Simulation Engine are separate, independently browsable records, with an optional clearly-labelled combined view that is never the default.

Everything else in the pitch — distributions, joint outcomes, per-layer validation, reproducibility, the backtest — is specified in `docs/v1/specs/simulation-engine-spec.md` and has no design surface. This document is deliberately confined to the three items above. It does not invent screens for the engine.

## Decisions settled for this document

These are the run-instruction Resolved Decisions this document depends on; the authoritative table lives in the spec. Restated here only where they touch the interface:

- **RD-1** — model selection is per stat type; every projection carries the id of the model that produced it; the slate and contract detail show it.
- **RD-3** — Accuracy reports Baseline and Simulation Engine as separate records; a "Sightline lifetime" combined view exists, is clearly labelled, and is never the default; live-readiness always reads the active model's own record.
- **RD-4** — zero relevant history → explicit "insufficient evidence to project"; sparse history → a wide, low-confidence distribution that the existing confidence display already handles, with no new decline gate.
- **RD-5** — continuous stats stored as an empirical quantile grid, low-count discrete stats as an explicit PMF; both drive the same distribution rendering the detail view already has.

## 1. Vision

The Simulation Engine changes the number under almost every contract, and it does so unevenly — passing yards may come from the new model while touchdowns stay on the baseline for another month. The interface's whole job here is to keep that honest: to show *which* model produced each number, to admit when the model cannot responsibly produce one at all, and to let the user read the two models' track records without ever blending them into a single flattering average.

**North star: the model changed underneath, and the instrument says so out loud rather than pretending nothing happened.**

## 2. Design principles

### 1. Provenance is a number's second half

A probability from the Simulation Engine and a probability from the baseline are not interchangeable, even when they read `0.62`. Every model-derived value that appears on a row or a detail view is accompanied by a compact, legible indicator of the model that produced it. The indicator is quiet — it is not a badge celebrating the new model — but it is never absent.

### 2. Cannot-project is an answer, not a gap

When the model declines for lack of evidence, the contract does not show an empty cell, a zero, or a dash that reads like a loading state. It shows the words *insufficient evidence to project*, in the warning register, and it stays rankable at the bottom rather than vanishing. A fabricated number is worse than an admitted absence, and the two must never look alike.

### 3. Unlike records never share a frame

Baseline calibration and Simulation Engine calibration are two measurements of two different models. They occupy separate, separately-labelled records with their own curves, Brier scores, and sample counts. The combined "Sightline lifetime" view exists for historical interest, is labelled as spanning model versions, and is never what loads first. Nothing in layout or copy invites reading one model's record as the other's.

### 4. Confidence still travels with the probability

The Simulation Engine's ten thousand — here, five thousand — draws do not buy precision. A sparse-history projection is wide and low-confidence, and the existing three-step confidence indicator carries that exactly as it did for the baseline. The interface adds no new "shaky bet" ornament; the honest confidence value is the disclosure.

### 5. The engine is invisible; its consequences are not

No screen exposes layers, seeds, draw counts, correlation matrices, or any modelling internal. The user sees a probability, a confidence, a provenance indicator, drivers written from the model's actual structure, and — on the accuracy surface — how each model has done. The sophistication stays under the waterline.

## 3. Information architecture

Nothing moves in the navigation. Three existing surfaces gain elements; no route is added.

```text
Sightline
├── Slate                          (shared)  ← rows gain a model-provenance indicator
│   └── Contract detail            (shared)    and the "insufficient evidence" row state;
│                                              detail gains provenance + insufficient-evidence block
├── Accuracy                       (shared)  ← Version selector now spans two real model
│   ├── Calibration panel          (shared)    families (Baseline · Simulation Engine),
│   ├── Error vs baselines panel   (shared)    with an explicit, non-default "Sightline
│   ├── Market comparison panel    (shared)    lifetime" combined option
│   └── Overrides                  (admin only) unchanged
├── Health                         (admin only) unchanged
├── Settings                       (shared)      unchanged
└── Users                          (admin only)  unchanged
```

The `Accuracy` surface already carries a `version=<modelVersion>|all` scope axis and a `record=live|backtest|compare` axis from the Outcome Scoring pitch; this pitch populates that axis with a second real model and formalises the combined view rather than adding structure.

## 4. Visual language

### 4.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | Model-derived values: threshold probability, confidence, projected value/interval, the Simulation Engine's calibration curve | The model accent. Both models' outputs wear it; provenance is carried by the indicator, not by hue. |
| `palette.text.secondary` | The model-provenance indicator's text, the baseline's calibration curve when shown as the neutral reference, the combined-view "spans versions" caption | Provenance and reference lines are quiet neutrals, never a competing accent. |
| `palette.market.main` | Kalshi price and the market's implied-probability curve in the comparison panel | Unchanged; nothing model-derived wears it. |
| `palette.warning.main` / `warning.soft` | The "insufficient evidence to project" state, low-confidence indicator, provisional-bucket outlines | Caution only. "Insufficient evidence" is a disclosure, not an error. |

The Simulation Engine and the baseline both render their probabilities in `primary.main`. Provenance is **never** encoded by colour — a viewer must be able to tell the models apart in greyscale, from the indicator's text. This mirrors the surface's existing rule that edge direction carries a sign and a glyph, not just a hue.

### 4.2 Model-provenance indicator

A single compact element, used identically on the slate row and the contract detail.

| Model | Indicator text | Treatment |
| ----- | -------------- | --------- |
| Simulation Engine (`simulation-v1`) | `SIM` | `Chip`, `size="small"`, `variant="outlined"`, `text.secondary`; monospace label |
| Baseline (`baseline-zil-0.1.0`) | `BASE` | Identical chip treatment; no visual demotion — the baseline is a legitimate active model per stat type, not a fallback |

- The indicator is a two-to-four-character monospace label, never a colour-only dot, never an icon alone.
- It sits adjacent to the confidence indicator, so provenance and trust read in one glance.
- On hover / focus (desktop) and on the detail view, the label expands to the full human name — `Simulation Engine` or `Baseline` — via `Tooltip`. The raw `model_version` string is never shown to the user; it is developer vocabulary.
- Both models use the same neutral treatment. The interface must not make the Simulation Engine look "better" by styling — that judgement belongs to the accuracy surface and its data.

### 4.3 State colours used in this pitch

Exact state names as the data model will carry them; no invented states.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| `insufficient_evidence` | Amber outlined chip `insufficient evidence` in the row's probability slot; row de-emphasised, ranked last, still selectable | Zero relevant historical opportunity as of the cutoff (RD-4). Distinct from "no projection yet". |
| no projection (yet) | Neutral, existing "—" with the existing "no projection" treatment | The contract simply has no computed projection; unchanged from the Slate pitch. Must not be confused with `insufficient_evidence`. |
| `high` / `medium` / `low` confidence | Existing three-step indicator | Unchanged; carries the sparse-history width honestly. |
| `SIM` / `BASE` provenance | Neutral outlined chip, monospace | The model-provenance indicator above. |

`insufficient_evidence` and "no projection" must be visually and textually distinct: the first is a decision the model made and states in words; the second is the ordinary absence of a computed row. Colour is reinforcement — the amber chip always carries its words.

### 4.4 Typography

Per the brand system: every computed value uses the monospace numeric variants with tabular figures. The provenance and confidence indicators use the small monospace label style already used for chips. No data value is bolded to signal importance. The "insufficient evidence" chip uses `caption` weight — it is a disclosure, not a headline.

### 4.5 Appearance

All states are theme-token driven and work in light, dark, and system. The one screen that looks meaningfully different between modes is the Accuracy calibration chart when two model curves are shown together (§ Screen 3): both models use `primary.main`, distinguished by stroke style (solid Simulation, dashed Baseline) and a legend, so the distinction survives greyscale and does not rely on the two curves being different colours.

## 5. Screen specifications

## Screen 1: Slate (provenance + insufficient-evidence)

### Purpose
Let the user scan the ranked slate and see, per contract, which model produced the number and whether the model declined to produce one at all — without opening a detail view.

### URL pattern
`/slate` — unchanged.

### Trigger
Default landing surface; unchanged.

### Layout — row-level additions only

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Player · stat · threshold        model P     conf  prov   price   edge      │
│ ─────────────────────────────────────────────────────────────────────────  │
│ J. Jefferson · rec yds ≥ 74.5     0.61       high  SIM    52¢    +9  ▲       │
│ K. Cousins  · pass yds ≥ 249.5    0.55       med   SIM    49¢    +6  ▲       │
│ T. Hockenson · rec TDs ≥ 0.5      0.38       med   BASE   41¢    −3  ▽       │
│ Rookie WR   · rec yds ≥ 39.5    insufficient evidence  —  BASE?  47¢   —     │
└───────────────────────────────────────────────────────────────────────────┘
```

- The `prov` column is new: a `SIM` / `BASE` chip per row, adjacent to `conf`.
- A row in the `insufficient_evidence` state replaces its probability, confidence, and edge with the `insufficient evidence` chip and neutral dashes; it sorts to the bottom of its group and remains selectable (opening it explains why).

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Provenance chip** | `Chip size="small" variant="outlined"`, `text.secondary`, monospace label | `SIM` / `BASE`; tooltip expands to full model name on hover/focus. Present on every row that has a projection. |
| **Insufficient-evidence cell** | `Chip size="small" variant="outlined"` warning tone, text `insufficient evidence` | Occupies the probability slot; confidence and edge render as neutral `—`. Row `sx` opacity reduced per the existing de-emphasis pattern. |
| **Confidence indicator** | Existing three-step control | Unchanged; sits beside the provenance chip. |

### Code reference
```tsx
// SlateRow — new provenance + decline handling. Distribution/edge logic unchanged.
{row.projectionState === "insufficient_evidence" ? (
  <Chip size="small" variant="outlined" color="warning" label="insufficient evidence" />
) : (
  <>
    <ModelProbabilityCell value={row.modelProbability} />
    <ConfidenceIndicator level={row.confidence} />
  </>
)}
{row.modelVersion && <ProvenanceChip modelVersion={row.modelVersion} />}
```

### Fields
| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| `modelVersion` | `string \| null` | new on `SlateRowDto` | — | Drives the provenance chip; `null` only when there is genuinely no projection. |
| `projectionState` | `"projected" \| "insufficient_evidence" \| "none"` | new | `"none"` | `"none"` = no computed projection (existing "—"); `"insufficient_evidence"` = model declined (RD-4). |

### Empty state
Unchanged — the empty slate (no contracts, or none clearing the threshold) renders exactly as the Slate pitch defines it. A slate composed entirely of `insufficient_evidence` rows is a legitimate, fully-populated slate that happens to recommend nothing, and reads as such.

### Loading state
Unchanged — the slate renders from stored projections and never waits on a model run. The provenance chip and insufficient-evidence chip are part of the stored row and appear with it; no chip resolves after its row.

### Error state
Unchanged. A contract with no projection is not an error; an `insufficient_evidence` contract is not an error. Both are content.

### Behavior
- Sorting/filtering unchanged, except `insufficient_evidence` rows rank last within their group (they carry no edge, so the existing confidence-adjusted-edge sort already floats them down; the state makes it explicit and stable).
- Selecting an `insufficient_evidence` row opens the detail view, which explains the decline.

## Screen 2: Contract detail (provenance + insufficient-evidence + distribution)

### Purpose
Give the user the full projection for one contract — its distribution, drivers, confidence, and which model produced it — or, when the model declined, a plain-English statement of why.

### URL pattern
`/slate/[contractId]` — unchanged.

### Trigger
Selecting a slate row; deep link.

### Layout — projected state

```text
┌──────────────────────────────────────────────────────────────┐
│ J. Jefferson — receiving yards                                 │
│ Simulation Engine · computed Sun 11:40a · cutoff Sun 11:30a    │
│                                                                │
│ P(≥ 74.5)  0.61      confidence  high      SIM                 │
│ projected 71.3   ·   interval  38 – 108  (P10–P90)             │
│                                                                │
│ ┌─ distribution ───────────────────────────────────────────┐ │
│ │  quantile-grid curve (P1…P99), threshold marker at 74.5   │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                                │
│ Why                                                            │
│ • Expected game volume above this team's season median        │
│ • Target share up on WR2 absence                              │
│ • Efficiency near his trailing form                           │
└──────────────────────────────────────────────────────────────┘
```

### Layout — insufficient-evidence state

```text
┌──────────────────────────────────────────────────────────────┐
│ Rookie WR — receiving yards                                    │
│ Simulation Engine · evaluated Sun 11:40a · cutoff Sun 11:30a   │
│                                                                │
│ ┌────────────────────────────────────────────────────────┐   │
│ │  ⚠  Insufficient evidence to project                     │   │
│ │                                                          │   │
│ │  No recorded snaps, targets, or carries establish this   │   │
│ │  player in this role as of the information cutoff.       │   │
│ │  Sightline declines to project rather than fabricate a   │   │
│ │  distribution from zero opportunity.                     │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                                │
│ Price 47¢ · no edge shown — Sightline has no projection here   │
└──────────────────────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Provenance line** | Text, `text.secondary`; `SIM`/`BASE` chip + full model name inline | The detail view spells out the model name in full, unlike the row's chip. |
| **Distribution chart** | Recharts, theme-wrapped | Renders from the stored representation regardless of kind: an empirical quantile-grid curve for continuous stats (P1–P99, monotone piecewise-linear), or a PMF bar chart for low-count discrete stats (0,1,2,3,4,5+). The threshold is marked. |
| **Drivers** | Ordered list, `text.primary` | Rendered from `ProjectionDriver` rows, ordered by rank. Copy is produced from the model's actual structure (game volume / usage / efficiency / context), never post-hoc narration. |
| **Insufficient-evidence block** | `Alert severity="warning" variant="outlined"` | Replaces the probability/distribution/drivers block entirely. States the reason in plain English. Price still shows; edge shows the existing "no projection → no edge" treatment. |

### Code reference
```tsx
{detail.projectionState === "insufficient_evidence" ? (
  <InsufficientEvidenceBlock reason={detail.declineReason} cutoff={detail.informationCutoff} />
) : (
  <>
    <ProvenanceLine modelVersion={detail.modelVersion} computedAt={detail.projectionComputedAt} />
    <ProbabilityHeadline p={detail.modelProbability} confidence={detail.confidence} />
    <DistributionChart
      kind={detail.distributionKind}
      quantiles={detail.quantiles}
      pmf={detail.pmf}
      threshold={detail.threshold}
    />
    <Drivers items={detail.drivers} />
  </>
)}
```

### Fields
| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| `modelVersion` | `string \| null` | existing | — | Already on `ContractDetailDto`; now drives the provenance line. |
| `projectionState` | as Screen 1 | new | `"none"` | Selects projected vs insufficient-evidence layout. |
| `declineReason` | `string \| null` | new | `null` | Human-readable reason; only set when `insufficient_evidence`. |
| `distributionKind` | `string` | existing | — | Now also carries the Simulation Engine's empirical kinds; the chart branches on it. |

### Empty / loading / error states
- **Empty:** a contract with no projection at all shows the existing "no projection for this contract" state — distinct from insufficient-evidence.
- **Loading:** skeleton matching the projected layout; the insufficient-evidence block is server-rendered, never a loading artefact.
- **Error:** Kalshi-unavailable renders price as unavailable with a timestamp per the existing degraded-mode design; the projection block is unaffected.

### Behavior
- Opening an `insufficient_evidence` contract is the primary way the user learns *why* a slate row declined; the block is the explanation Screen 1 promises.
- Distribution chart, drivers, and outcome block (post-settlement) behave as in prior pitches; only the distribution *kind* set is broader.

## Screen 3: Accuracy (per-model-version split)

### Purpose
Let any authenticated user read the Baseline's and the Simulation Engine's track records as separate, non-blended records — and, only on explicit request, a clearly-labelled combined lifetime view.

### URL pattern
`/accuracy?record=live|backtest|compare&version=<modelVersion>|all|lifetime&population=…&stat=…&season=…` — the `version` axis already exists; this pitch adds the `lifetime` sentinel and populates the axis with two real models.

### Trigger
`Accuracy` nav link; the empty slate's "View accuracy" route; deep links.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Accuracy                                                              │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Record [Live|Backtest|Compare]                                    │ │
│ │ Model  [Simulation Engine ▾]   ← default: active model            │ │
│ │        · Simulation Engine                                        │ │
│ │        · Baseline                                                 │ │
│ │        · Sightline lifetime (spans model versions)                │ │
│ │ Population [Contract-like ▾]  Stat [All ▾]  Season [All ▾]        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ Showing Simulation Engine · graded through Wk 6 · 1,204 obs · 402 proj│
│                                                                        │
│ ┌─ Calibration (Simulation Engine) ───────┐ ┌─ Error vs baselines ─┐ │
│ │ Brier 0.207   1,204 obs · 402 proj      │ │ (unchanged panel)     │ │
│ │ reliability curve (solid, indigo)       │ │                       │ │
│ └─────────────────────────────────────────┘ └───────────────────────┘ │
│                                                                        │
│  — Compare mode overlays both models: —                                │
│ ┌─ Calibration (Compare) ─────────────────────────────────────────┐   │
│ │ Simulation Engine (solid)  Brier 0.207   1,204 obs · 402 proj    │   │
│ │ Baseline          (dashed) Brier 0.221   6,880 obs · 1,910 proj  │   │
│ │ reliability curves overlaid, each labelled with its own n        │   │
│ └──────────────────────────────────────────────────────────────────┘   │
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Model selector** | `Select`, replaces the raw version dropdown | Lists human names — `Simulation Engine`, `Baseline`, `Sightline lifetime (spans model versions)`. Default is the **active** model, never lifetime. |
| **Record toggle** | Existing `ToggleButtonGroup` Live/Backtest/Compare | Unchanged mechanism; `Compare` now overlays the two models rather than model-vs-market only. |
| **Calibration panel** | Existing panel, `primary.main` curve | Titled with the selected model's name. In Compare, two curves: Simulation solid, Baseline dashed, each with its own Brier and both denominators. |
| **Lifetime caption** | `caption`, `text.secondary` | When `version=lifetime`, a persistent caption reads `Combined across Baseline and Simulation Engine — spans model versions`. Never shown for a single-model view. |

### Fields
| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| `version` | `modelVersion \| "all" \| "lifetime"` | existing + `lifetime` | active model | `lifetime` combines; must render its caption and is never the resolved default. |
| `record` | `live \| backtest \| compare` | existing | `live` | Unchanged. |

### Validation
- Selecting `lifetime` is always permitted but always labelled; it can never be the value the surface resolves to when `version` is unspecified.
- If the selected model has no graded data for the chosen population/stat/season, the panel shows the existing insufficient-sample state naming what it needs — it does **not** silently fall back to the other model or to lifetime.

### Empty state
A model with no graded predictions yet (the Simulation Engine on day one of live grading) shows the existing "too early to say — N graded predictions so far" state, scoped to that model. Its backtest record may still be non-empty and is shown under the Backtest record. The two records never borrow each other's counts.

### Loading state
Existing skeletons; the model selector and its resolved default are server-rendered so the first paint already names the active model.

### Error state
Unchanged from the Accuracy pitch.

### Behavior
- Changing the model updates every denominator on screen; nothing on the surface mixes two models' counts unless `lifetime` is explicitly chosen.
- The record used for live-readiness elsewhere (the staking pitch) always reads the active model's own record — this surface's `lifetime` view is for human reading only and is not the readiness input (RD-3).

## 6. Navigation flows

```text
Slate row (SIM/BASE chip, or insufficient-evidence chip)
   └─ select ─▶ Contract detail
                  ├─ projected      ─▶ distribution + drivers + provenance line
                  └─ insufficient   ─▶ plain-English decline block, price only
                                        (return to slate preserves scroll + row)

Accuracy
   ├─ Model selector ─▶ Simulation Engine | Baseline | Sightline lifetime
   │                     (default = active model; lifetime always labelled)
   └─ Record toggle  ─▶ Live | Backtest | Compare (Compare overlays both models)
   All scope combinations deep-linkable, including ?version=lifetime.
```

No flow adds a page, a modal, or a confirmation. Every transition is an existing one carrying a slightly richer payload.

## 7. Interaction specifications

### Keyboard navigation
Unchanged from the Slate and Accuracy pitches. The provenance chip is not independently focusable; its tooltip is available on the row's existing focus. The model selector on Accuracy is a standard `Select` and participates in normal tab order.

### Loading states
The slate never shows a spinner waiting on a model run; this pitch does not change that. Provenance and insufficient-evidence are stored properties of a row and paint with it.

### Error states
"Insufficient evidence to project" is explicitly **not** an error and never uses `Alert severity="error"` — it is a `warning`-tone disclosure. Kalshi-unavailable remains the only degraded mode and is unchanged.

### Notifications
None added. There is no user action in this pitch that produces a notification — model selection is a read, not a mutation.

### Destructive actions
None. This pitch adds no mutation, no order path, and no admin write surface.

## 8. Accessibility

- Provenance is text (`SIM`/`BASE` + tooltip name), never colour-only, satisfying the greyscale/colourblind requirement.
- The two Compare-mode curves are distinguished by stroke style and legend, not solely by colour.
- The insufficient-evidence chip and block carry their full words; the amber tone is reinforcement.
- Every computed value keeps its tabular-figure monospace treatment for alignment and screen-reader legibility.

## 9. Out of design scope (belongs to the spec)

- The three predictive layers, the joint simulation, the seed derivation, the draw count, the empirical distribution derivation, and per-layer validation — all Python, no surface.
- The active-model-per-stat-type registry that decides which `model_version` the slate reads per stat type — a data/config contract in the spec, surfaced here only as the `SIM`/`BASE` chip.
- The storage mechanism for an insufficient-evidence decline (how the decline is persisted so the surface can distinguish it from "no projection") — spec-level.
- The recalibration handoff and model-version promotion mechanics — spec and runbook.
