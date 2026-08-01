# Kalshi Sync, The Slate & Decision Log — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch 4: Kalshi Sync, The Slate & Decision Log
**Focus:** The rolling pre-kickoff slate, the contract detail view, and the admin's take/fade/skip decision capture — the first complete user-facing product loop.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

## Decisions settled for this document

These resolve the pitch's design-level open questions. Each is restated as a Resolved Decision in the technical spec; this section exists so a reader of the design doc alone knows the ground it stands on.

1. **The executable ask drives edge, ranking, and recommendation.** The slate's primary market number is the ask of the side Sightline's probability favours — the price actually payable. The midpoint is displayed on the contract detail view as secondary context, never as the ranking input. Buying costs the ask; a midpoint edge that disappears at the ask is not an edge. Both sides of the book are stored, so this display rule can be revisited without re-ingesting anything.
2. **One row shape from six contracts to sixty.** The slate is a flat list ranked by confidence-adjusted edge, with the game and kickoff carried inside each row rather than as group headers. Row height is identical for every variant. Density is handled by the row design, not by switching layouts at some slate size.
3. **Baseline drivers exist and are displayed.** Verified against the Pitch 2 engine: `sightline_model/projection.py` produces deterministic, ordered driver sentences per projection. The detail view presents them as-is. No narrative invention in the application layer.
4. **A decision can be changed but never cleared.** Before kickoff, the admin may switch a contract among took, faded, and skipped; each change captures a fresh server-side snapshot and the prior state is preserved. There is no control to return a marked contract to unmarked — unmarked means "never decided," and erasing a considered decision would falsify the record.
5. **Kickoff is the actionability boundary.** A contract is actionable until its game's scheduled kickoff, enforced server-side. Games whose kickoff has passed leave the upcoming slate on the next read. Market status can close a contract earlier (Kalshi closed the market); it never extends one later.
6. **Unresolved contracts are visible to both roles; diagnostics are admin-only.** Viewers see an unresolved contract's market name and a designed "not yet mapped" state. The admin additionally sees the resolution failure reason and a minimal correction control. Mapping corrections apply to future reads; history already recorded stays as it was observed.
7. **Kalshi state is disclosed per refresh outcome.** Complete refresh: the timestamp is the only feedback. Partial refresh: an amber banner names what is missing. Outage: one banner at the top, price cells show their last-observed value and age, or an em-dash where none exists. Empty-but-valid: the designed empty state. These are four different screens, not one error.

## 1. Vision

The slate is the screen William opens on a Sunday morning with twenty minutes before the early window. It must answer *which of these contracts is worth a second look* without him reading every detail view, show him exactly where Sightline's belief and Kalshi's price disagree, and let him record what he did about it in one tap. It must be equally honest when the answer is: nothing here has an edge today.

**North star: a ranked disagreement list that admits what it does not know, and remembers what he decided.**

## 2. Design principles

### 1. Uncertainty travels with the number

Every probability carries its confidence, every price carries its observed-at time, every projection carries its computed-at time. A row that shows `61.4%` against `54¢` without saying the projection is from Thursday and the price is from nine seconds ago is lying by omission. There is no simplified variant that drops these.

### 2. Two sources, visibly distinct

Every number on the slate came from Sightline's model or from Kalshi's book, and the palette says which without a label: model accent for probability, confidence, and projection values; market mint for prices, book sides, and spread. Edge — the disagreement itself — renders in the model accent when positive, rose when negative, always with sign and arrow glyph.

### 3. Nothing is a legitimate answer

A slate where no contract clears the recommendation threshold, a contract with a price but no projection, a projection with no market, an empty Tuesday in March — all are designed answers, not failures. The interface never fabricates a number to fill a cell: a missing edge is an em-dash, never a zero.

### 4. The decision is private and unforced

Take, fade, and skip controls exist only for the admin, and no visual state ever pressures a decision. Viewers see a slate with no trace — no blank column, no disabled control, no count — of decision capture. Absence is indistinguishable from non-existence.

### 5. Degrade, never collapse

Kalshi being unreachable removes prices, edges, and recommendations from the display — nothing else. Projections and their reasoning stay fully readable. One banner explains the mode; per-row noise is forbidden.

## 3. Information architecture

```text
Sightline
├── Slate                          (shared)  ← default landing; this pitch replaces the placeholder
│   ├── Ranked contract list       (shared)
│   ├── Unresolved contracts       (shared list; admin diagnostics)
│   └── Contract detail            (shared)  ← full-height drawer at xs/sm, side panel at md+
│        └── Take / Fade / Skip    (admin only, invisible to viewers)
├── Health                         (shared)  ← exists from Pitch 3; gains price-refresh recency
├── Settings                       (shared)
└── Users                          (admin only)
```

Accuracy, Backtests, and Decisions surfaces do **not** appear in navigation in this pitch — they belong to later pitches, and a nav item implying an absent feature is a broken promise. Decision capture lives inline on the slate and detail views; there is no decision-log listing page in this pitch (deferred to Pitch 6 alongside timing cost and grading, which are what make a log worth reading).

## 4. Visual language

### 4.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | Threshold probability, projected value, interval, confidence, drivers, positive edge, recommendation marker | The model accent. Never applied to market values. |
| `palette.market.main` | Ask, bid, midpoint, spread, price timestamps' values | Kalshi provenance. Nothing model-derived wears mint. In light mode, market text at ≤16px uses the dark mint text token. |
| `palette.warning.main` | Partial refresh, unresolved contract, no-projection state, Kalshi degraded banner | Caution only — never "bad price", never "loss". |
| `palette.error.main` | Negative edge, faded disposition | Desaturated rose; data encoding, not payout. |
| `palette.text.secondary` / `disabled` | Below-threshold row de-emphasis, timestamps, qualifiers | De-emphasis is text colour, never row height or removal. |

### 4.2 State colours used in this pitch

Exact data-model values; no invented state names.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| recommended | Model-accent left edge marker + `Chip` label `recommended`, outlined, 4px radius | Contract meets the configured threshold |
| below threshold | Row text drops to `text.secondary`; no chip | Visible, ranked, de-emphasised |
| `took` | Model accent, filled chip | Admin-only, on slate row and detail |
| `faded` | Rose, filled chip | Position on the other side — not passing |
| `skipped` | Neutral, outlined chip | Considered and passed |
| unmarked | No indicator at all | Absence of a row, never a fourth chip |
| `unresolved` / `ambiguous` | Amber outlined chip `unresolved`, row in unresolved section | Contract not mapped to a player |
| no projection | Amber outlined chip `no projection`; probability, edge, confidence cells show `—` | Player mapped, model declined or absent |
| prices unavailable | Neutral; price cell shows last value with age, or `—`; one banner at top | Kalshi degraded mode — designed state |
| `high` / `medium` / `low` | Confidence word, three-step indicator | Always beside the probability it qualifies |

Colour is reinforcement, never the only channel: edge carries an explicit `+`/`−` sign and `▲`/`▼` glyph; every chip carries its word.

### 4.3 Typography

Per the brand system: every computed numeric — probability, price, edge, threshold, timestamps — uses tabular figures (`numericMd` in rows, `numericLg` for detail headline figures, `numericSm` for dense qualifiers). No data value is ever bolded; emphasis is position and colour. Column headers are `label` (13/18, 500).

### 4.4 Appearance

All surfaces are theme-token driven and work in light, dark, and system. The distribution summary on the detail view is the one graphic that differs meaningfully by mode: the filled mass above threshold uses the model-accent soft token in both modes, and its stroke reads from the theme — no hardcoded hex, including in Recharts.

## 5. Screen specifications

## Screen 1: The Slate

### Purpose

Rank every upcoming Kalshi NFL player-prop contract by confidence-adjusted edge so the user can find the contracts worth a second look in one scan — and see at a glance what is recommended, what is de-emphasised, what could not be priced, and (admin only) what he already decided.

### URL pattern

`/slate` — the post-sign-in landing for both roles. Replaces the Pitch 3 placeholder state at the same route.

### Trigger

Sign-in lands here; the nav lockup links here; every back-path from detail returns here.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Slate                                       prices as of 11:42:09 AM ET      │
│ Sun, Nov 8 · 14 games                       [Refresh prices]                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ (banner region — rendered only in partial/degraded/error modes)              │
├──────────────────────────────────────────────────────────────────────────────┤
│   PLAYER / CONTRACT              GAME · KICKOFF   MODEL  ASK   EDGE    CONF  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▎ Ja'Marr Chase · rec yds ≥ 74.5 CIN@BAL · 1:00p  61.4%  54¢  ▲+7.4  high   │
│   recommended · [took]           proj Thu 9:12a · price 11:42a               │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▎ Jahmyr Gibbs · rush yds ≥ 54.5 DET@GB · 4:25p   63.0%  57¢  ▲+6.0  high   │
│   recommended                    proj Sat 8:40p · price 11:42a               │
├──────────────────────────────────────────────────────────────────────────────┤
│   Puka Nacua · rec yds ≥ 89.5    LAR@SEA · 4:05p  41.0%  44¢  ▼−3.0  low    │
│                                  proj Sat 8:40p · price 11:41a               │
├──────────────────────────────────────────────────────────────────────────────┤
│   Tucker Kraft · rec yds ≥ 40.5  DET@GB · 4:25p    —     38¢    —      —    │
│   no projection                  price 11:42a                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Unresolved contracts (2)                                                     │
│   "J. Smith-Njigba receiving yards above 74.5" · KXNFLPROP-… ⚠ unresolved   │
│   "T. Etienne Jr rushing yards above 54.5" · KXNFLPROP-…     ⚠ unresolved   │
└──────────────────────────────────────────────────────────────────────────────┘
```

The `▎` is the model-accent recommendation marker: a 3px left-edge bar plus the outlined `recommended` chip. De-emphasis for below-threshold rows is `text.secondary` text; row height never changes. The `[took]` chip renders **only for the admin** — the viewer payload contains no decision fields at all.

### Layout — `xs`

Rows wrap to two lines; identical height across variants; nothing scrolls horizontally.

```text
┌────────────────────────────────────────────┐
│ Slate · Sun Nov 8         prices 11:42a ⟳ │
├────────────────────────────────────────────┤
│ ▎Ja'Marr Chase · rec yds ≥ 74.5   CIN@BAL │
│  61.4% · 54¢ · ▲+7.4 · high    1:00p [took]│
├────────────────────────────────────────────┤
│ ▎Jahmyr Gibbs · rush yds ≥ 54.5   DET@GB  │
│  63.0% · 57¢ · ▲+6.0 · high        4:25p  │
├────────────────────────────────────────────┤
│  Puka Nacua · rec yds ≥ 89.5      LAR@SEA │
│  41.0% · 44¢ · ▼−3.0 · low         4:05p  │
└────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header** | `Stack` with `Typography h1` "Slate", date + game count `body2 text.secondary`, price-age `numericSm` | Price-age updates on every successful refresh; no snackbar for routine refreshes — the timestamp is the feedback |
| **Refresh control** | `Button` variant `text` with refresh icon, `aria-label="Refresh prices"` | Triggers the server refresh route; disabled while a refresh is in flight; never blocks row rendering |
| **Banner region** | `Alert severity="warning"` (partial/degraded) or `severity="error"` (load failure) | One banner max; see states below |
| **Slate row** | `SlateRow` — themed `ButtonBase` row, CSS grid columns, `divider` hairlines | Click/`Enter` opens contract detail; full row is the target |
| **Recommendation marker** | 3px `borderLeft` in `primary.main` + outlined `Chip` | Present only when the contract meets the configured threshold |
| **Disposition chip** | `Chip` filled (`took` accent / `faded` rose) or outlined (`skipped`) | Admin only; absent entirely for viewers |
| **Unresolved section** | `Typography h2` + rows with amber `unresolved` chip | Both roles see the section; opening one shows the unresolved detail (Screen 3) |
| **Timestamps line** | `numericSm text.secondary`: `proj <relative>` in model context, `price <relative>` | Both always present on resolved rows; separate values, never merged |

### Code reference

```tsx
<ButtonBase
  component="li"
  onClick={() => openContract(contract.id)}
  sx={(theme) => ({
    display: "grid",
    width: "100%",
    gridTemplateColumns: { xs: "1fr auto", md: "minmax(0,2fr) auto auto auto auto auto" },
    alignItems: "baseline",
    px: 2,
    py: 1.25,
    borderBottom: `1px solid ${theme.palette.divider}`,
    borderLeft: contract.recommended
      ? `3px solid ${theme.palette.primary.main}`
      : "3px solid transparent",
    color: contract.recommended ? "text.primary" : "text.secondary",
    "&:hover": { backgroundColor: theme.palette.action.hover },
    "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
  })}
>
  {/* player · stat ≥ threshold | game · kickoff | model % | ask ¢ | edge | confidence */}
</ButtonBase>
```

### Fields

Not a form screen. The one input is the refresh control; sort order is fixed (confidence-adjusted edge, descending; deterministic tiebreak so the list never reshuffles between refreshes — final ordering key documented in the spec).

### Validation

None client-side. The refresh route is rate-limit-governed server-side; hammering the button cannot exceed Kalshi's budget because the server coalesces refreshes.

### Empty states

Four distinct empties, each designed:

**No upcoming games** (June, most weekdays):

```text
┌────────────────────────────────────────────┐
│ Slate                                      │
├────────────────────────────────────────────┤
│   No upcoming games.                       │
│   Next kickoff: Thu Nov 12, 8:15p ET       │
│                                            │
└────────────────────────────────────────────┘
```

(If no future game exists in the schedule — deep offseason — the second line reads "The season schedule has not been published." Links out to other surfaces arrive with the pitches that build them.)

**Games but no listed contracts:** `No Kalshi player-prop contracts are listed yet for these games. Last checked 11:42 AM ET.` — with the game list rendered so the user can see what Sightline knows about.

**Nothing above threshold:** the full ranked list renders normally; a quiet `body2 text.secondary` line above the list reads `No contracts meet the recommendation threshold today.` This is a legitimate answer and must not use warning styling.

**Everything unresolved:** the unresolved section renders with an amber banner: `No listed contract could be matched to a player yet.`

### Loading state

Skeleton rows (`Skeleton variant="rectangular"`) matching exact final row height, six of them. The slate reads from stored data and never waits on a model run. Price cells may resolve after rows render; a price cell awaiting first observation shows `—` with no spinner.

### Error state

If the slate read itself fails (database error): `Alert severity="error"` — `The slate could not be loaded. Retry.` with a retry action. Kalshi being unreachable is **not** this state — see Behavior.

### Behavior

- Opening the slate triggers a server-side price refresh (coalesced; never exceeds rate limits) and renders immediately from stored observations — rows never wait for the refresh round-trip.
- A background interval re-polls Sightline's own refresh route while the slate is visible; the interval pauses when the tab is hidden.
- **Refresh outcomes:** complete → timestamp updates, nothing else; partial → amber banner `Some markets could not be refreshed; showing last observed prices where current ones are unavailable.`; outage → amber banner `Kalshi is unreachable. Prices, edges, and recommendations show last-observed state as of 11:38 AM ET.`; empty-valid → designed empty state.
- Rows sort by confidence-adjusted edge descending; contracts without a computable edge (no projection, no price) rank after all ranked rows, before the unresolved section.
- Games whose kickoff has passed are absent from the next read. No countdowns, no live-updating clocks.
- Viewer payloads contain no decision data — not nulls, not empty arrays; the fields are absent.

## Screen 2: Contract detail

### Purpose

Expose the full reasoning behind one contract's comparison — projection, distribution, confidence, drivers, provenance, current book — so the admin can judge whether the apparent edge is trustworthy, and record his decision.

### URL pattern

`/slate/[contractId]` — deep-linkable for both roles. At `xs`/`sm` it presents as a full-height drawer over the slate; at `md+` as a side panel beside the list. The URL is the state either way.

### Trigger

Clicking/entering a slate row; direct deep link.

### Layout — `md+` side panel (resolved contract with projection and price)

```text
┌──────────────────────────────────────────────────┐
│ Ja'Marr Chase · CIN @ BAL · Sun 1:00p ET     [×] │
│ receiving yards ≥ 74.5          recommended      │
├──────────────────────────────────────────────────┤
│ model P(≥ 74.5)   market ask      edge           │
│    61.4%             54¢         ▲ +7.4 pts      │
│ confidence high                                  │
├──────────────────────────────────────────────────┤
│ Projection                                       │
│   projected 78.3 yds   median 76.1               │
│   80% interval 41 – 118                          │
│   ┌────────────────────────────────┐             │
│   │ distribution, mass ≥ 74.5      │             │
│   │ filled in model accent         │             │
│   └────────────────────────────────┘             │
├──────────────────────────────────────────────────┤
│ Drivers                                          │
│   · 14 eligible prior games; exponentially-      │
│     weighted form 81.2 receiving yards.          │
│   · Shrunk 22% toward the WR prior for 2025…     │
│   · Form window crosses a season boundary.       │
├──────────────────────────────────────────────────┤
│ Market                                           │
│   bid 52¢ · ask 54¢ · spread 2¢ · mid 53¢        │
│   observed 11:42:09 AM ET                        │
├──────────────────────────────────────────────────┤
│ Provenance                                       │
│   computed Thu 9:12 AM ET · cutoff Thu 9:00 AM   │
│   model baseline-v1.2                            │
├──────────────────────────────────────────────────┤
│ Decision                       (admin only)      │
│   [ Take ]   [ Fade ]   [ Skip ]                 │
│   marked took · Sun 11:44 AM ET                  │
└──────────────────────────────────────────────────┘
```

At `xs` the same sections stack in a full-height `Drawer`, with the decision control pinned within thumb reach at the bottom.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header** | `Typography h2` player, `body2` game/kickoff, close `IconButton` | `Esc` or `[×]` closes; focus returns to the originating row |
| **Comparison block** | Three `numericLg` figures: probability (model accent), ask (market mint), edge (accent/rose with sign+glyph) | The headline; confidence word directly beneath the probability |
| **Distribution summary** | Recharts area chart wrapped in the themed chart component; threshold reference line; mass above threshold filled with `primary` soft token | The filled area *is* the probability. Text equivalent supplied for screen readers |
| **Drivers** | `List` of `body1` sentences, ordered as stored | Rendered exactly as the model wrote them; no application-side narration |
| **Market block** | `numericMd` mint values: bid, ask, spread, midpoint; observed-at | Midpoint is context, labelled `mid`; ask is the number that ranked the row |
| **Provenance block** | `numericSm text.secondary`: computed-at, information cutoff, model version | Layout reserves this block as the future home of calibration context (Pitch 6); nothing renders for it now |
| **Decision control** | Custom `ToggleButtonGroup`-derived control: Take (accent), Fade (rose), Skip (neutral) | Admin only — component absent from viewer render; see Behavior |

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| disposition | `took \| faded \| skipped` | n/a — never forced | unmarked (no row) | Admin only; server rejects at/after kickoff; server captures the snapshot |

### Validation

The decision write carries the contract id and disposition — nothing else. Every snapshot value is read server-side. A write attempted at/after kickoff returns a plain refusal rendered inline: `This game has started. Decisions are closed.`

### Empty / variant states

- **No projection (player resolved, model declined or absent):** comparison block shows ask only; probability and edge cells show `—`; an amber outlined chip `no projection` sits in the header; a `body2` line explains: `Sightline has no projection for this contract — insufficient eligible history.` (reason from the stored decline). Drivers and distribution sections are absent, not empty-framed. The decision control still renders for the admin — a decision needs no recommendation.
- **No price (projection exists, market missing/closed):** market block shows `No current market. Last observed 9:14 AM ET` or `Never observed`; edge shows `—`; projection sections render fully.
- **Kalshi degraded:** identical to no-price but with the top-level banner language; last-observed values shown with their age.

### Loading state

Skeletons matching each block's final height; the projection blocks render from the database without waiting for any live fetch; the market block may resolve later.

### Error state

Contract id not found → plain `Not found` state routing back to `/slate`. Decision write failure → inline `Alert severity="error"` next to the control: `The decision was not saved. Retry.` — the control keeps its prior visual state until the server confirms.

### Behavior

- Selecting Take/Fade/Skip issues the write; on success the control reflects the new state, a snackbar reads `Marked as took` (etc.), and the slate row chip updates in place on return.
- Changing an existing decision selects a different control state; snackbar `Changed to faded`. The prior state is preserved server-side; the UI shows only the current disposition and its time.
- Re-tapping the active disposition does nothing. There is no unmark control (settled decision 4).
- The three controls are equal-weight — no default, no visual push toward Take.
- Keyboard: `T`/`F`/`S` when the detail has focus; `Esc` closes.
- Viewers receive the identical shared surface minus the decision section and minus any decision data in the payload.

## Screen 3: Unresolved contract detail

### Purpose

Let both roles see that a listed market exists that Sightline could not map — and let the admin see why and correct it with the minimum viable control, without building a mapping operations suite.

### URL pattern

`/slate/[contractId]` — same route; the unresolved variant renders when the contract's resolution status is `unresolved` or `ambiguous`.

### Trigger

Opening a row in the slate's unresolved section.

### Layout — admin

```text
┌──────────────────────────────────────────────────┐
│ Unresolved contract                          [×] │
│ "J. Smith-Njigba receiving yards above 74.5"     │
│ KXNFLPROP-25NOV08-JSN-74.5 ⚠ unresolved          │
├──────────────────────────────────────────────────┤
│ Market                                           │
│   bid 47¢ · ask 50¢ · observed 11:42 AM ET       │
├──────────────────────────────────────────────────┤
│ Why it is unresolved            (admin only)     │
│   Kalshi name "J. Smith-Njigba" matched 0        │
│   players. Parsed: rec yds, threshold 74.5,      │
│   game candidate SEA @ … Sun 4:05p.              │
│                                                  │
│   Resolve to player:                             │
│   [ player search field           ▾ ]            │
│   [ Confirm mapping ]                            │
└──────────────────────────────────────────────────┘
```

Viewers see the header and market block with: `This contract has not been matched to a player yet. Projections are unavailable for it.` — no diagnostics, no controls.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Market name** | `body1`, verbatim Kalshi title + `numericSm` ticker | The source string is evidence; render it untouched |
| **Diagnostic block** | Admin only; `body2` explaining match failure and what was parsed | From stored resolution data; for `ambiguous`, lists the candidate players |
| **Resolve control** | `Autocomplete` over players + confirm `Button` | One mapping action; confirmation states the effect: `Map "J. Smith-Njigba" to Jaxon Smith-Njigba (SEA)? Future contracts with this name will resolve automatically.` |

### Empty / loading / error states

Loading skeletons per block. A failed mapping write shows an inline error and preserves the selection. If the market has no observed price, the market block shows `Never observed`.

### Behavior

- Confirming a mapping writes the identity mapping, marks it manually resolved, and the contract resolves on the next read — the row moves out of the unresolved section with its price history intact.
- Correction affects future reads only; previously recorded observations and snapshots are untouched (settled decision 6).
- No bulk operations, no mapping management page, no delete. One contract, one correction, in place.

## 6. Navigation flows

```text
Sign-in ──→ /slate
              │  row click / Enter
              ▼
        /slate/[contractId]  (drawer xs/sm · panel md+)
              │  Take / Fade / Skip (admin)
              ▼
        snackbar confirms · control updates in place
              │  Esc / × / back
              ▼
        /slate — scroll position preserved, row chip current
```

- Detail is URL-addressed; refresh and deep link land on the same state. A viewer deep-linking is served the shared variant; a viewer deep-linking to anything admin-scoped inside it simply receives a payload with those fields absent.
- Back/`Esc` from detail returns focus to the originating row.
- The slate never navigates on refresh; new prices update cells in place.

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Slate list | `↑` / `↓` | Move row focus |
| Slate list | `Enter` | Open contract detail |
| Contract detail | `Esc` | Close, return focus to originating row |
| Contract detail (admin) | `T` / `F` / `S` | Took / faded / skipped |
| Refresh control | `Enter`/`Space` | Trigger price refresh |

No shortcut exists for the mapping confirmation — it is a deliberate two-step pointer action.

### Loading states

Skeleton rows at exact final height everywhere; no layout shift; no spinner anywhere on the slate path; price cells resolve independently of their rows.

### Error states

Per screen, above. One banner maximum on the slate; Kalshi degradation is amber (designed mode), true failures are error-red with retry.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Decision logged | `Marked as took` / `faded` / `skipped` | success | 3s |
| Decision changed | `Changed to faded` | success | 3s |
| Mapping confirmed | `Contract resolved to Jaxon Smith-Njigba` | success | 4s |
| Prices refreshed | none — the timestamp updating is the feedback | — | — |
| Decision write failed | inline alert, not a toast | error | persistent until addressed |

### Destructive actions

Changing an existing decision is meaningful but reversible before kickoff and gets no confirmation dialog — the snackbar plus visible state change suffice. Confirming a player mapping gets an inline confirmation step (it rewires future resolution). Nothing in this pitch deletes anything.

## 8. Responsive behavior

| Breakpoint | Slate | Contract detail |
| ---------- | ----- | --------------- |
| `xs` 0–599 | Two-line rows, identical height; header condenses to date + refresh icon; unresolved section stacks | Full-height `Drawer`; decision control pinned bottom within thumb reach |
| `sm` 600–899 | One-line rows return | Full-height drawer persists |
| `md` 900–1199 | List + detail side panel; list column narrows | Side panel ~420px, independently scrollable |
| `lg` 1200–1535 | All columns visible without truncation | Panel fixed width; list gains whitespace, not columns |
| `xl` 1536+ | Content max-width applies; the slate does not stretch | — |

Nothing horizontally scrolls at any breakpoint. Recommended and non-recommended rows share exact height at every breakpoint. Every action available at `xs`.

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `SlateRow` | Slate | new | Variants: recommended, below-threshold, no-projection, price-unavailable; admin adds disposition chip |
| `UnresolvedRow` | Slate | new | Amber chip; verbatim market name |
| `ContractDetail` | Detail | new | Section-composed; drawer/panel presentation split |
| `DecisionControl` | Detail (admin) | new | Custom control (named exception in the brand system); T/F/S keyboard |
| `DispositionChip` | Slate, detail (admin) | new | `took`/`faded`/`skipped`; never a fourth state |
| `DistributionSummary` | Detail | new | Themed Recharts wrapper; threshold line; filled tail mass; text equivalent |
| `EdgeValue` | Slate, detail | new (reusable) | Sign + glyph + colour; `—` when incomputable |
| `ProbabilityValue` | Slate, detail | new (reusable) | Mono tabular, paired confidence |
| `PriceValue` | Slate, detail | new (reusable) | Mint provenance; observed-at pairing |
| `RelativeTimestamp` | Slate, detail | new (reusable) | `proj Thu 9:12a` / `price 11:42a`; absolute on hover/focus |
| `SlateBanner` | Slate | new | One-per-screen refresh-outcome banner |

## 10. Accessibility, privacy, and data sensitivity

- Every interactive control has an accessible name; the decision control announces current state (`Decision: took. Take, fade, or skip.`).
- No state relies on colour alone: edge carries sign and glyph; recommendation carries the chip word, not only the bar; confidence carries its word; provenance is carried by labels as well as palette.
- The distribution summary carries a text equivalent: `61.4% of simulated outcomes clear 74.5 yards. 80% interval 41 to 118.`
- Focus is trapped in the detail drawer while open and returns to the originating row on close. Row focus states are visible.
- Snackbars and inline errors are announced to screen readers.
- **Viewer privacy is structural:** decision data is absent from viewer payloads — not nulled, not hidden by CSS. No count, badge, styling difference, cache artifact, or response shape may differ based on what the admin decided. The decision section of detail does not render a placeholder for viewers.
- Admin-only diagnostics (resolution reasons, mapping controls) are server-gated; a viewer deep-link receives the viewer variant, never a partial admin shell.
- No Kalshi credential, signing material, or key identifier appears on any surface, in any error, or in any payload.
- Links out to Kalshi (contract detail may name the market; it links nowhere in this pitch) — if a later pitch adds them, they are visibly external. No Kalshi logo; the name in text only.
- No weather data is displayed in this pitch; the Open-Meteo attribution requirement does not attach here.

## 11. Out of scope

**Deferred to a later pitch — design must not preclude:**

- Staleness marking and the stale badge (Pitch 5). Timestamps are visible now; the explicit stale state and its list-view badge arrive with the staleness model. The row layout reserves no special slot — the badge will occupy the chip region.
- Scheduled refresh jobs, health-bound recency warnings (Pitch 5).
- Settlement, grading, outcome display, accuracy surfaces, the decision-log listing page, override performance, timing cost (Pitch 6).
- Calibration context on contract detail (Pitch 6) — the provenance block is its reserved home.
- Adjustment suggestions and their detail-view presentation (Pitch 10).
- Order entry, sizing, bankroll, exposure caps (Pitches 7–11). No trade buttons, no size fields, nothing implying execution.
- Recommendation-threshold configuration UI. The threshold is configuration read by the server; editing it in Settings is not part of this pitch.

**Permanent non-goals — never:**

- Sportsbook/DFS surfaces; public signup or marketing; live in-game trading; film-derived inputs; viewers trading through Sightline or supplying credentials; a general Kalshi market browser; social features, watchlists, favorites, comments.
