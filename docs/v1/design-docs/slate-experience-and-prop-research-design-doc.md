# Slate Experience & Prop Research — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch 10: Slate Experience & Prop Research
**Focus:** The Slate re-shaped around games and players instead of individual contracts, progressive disclosure into detail, player search and combinable filters, an admin-only reorganization that moves Accuracy behind the admin boundary, a plain-language Accuracy summary, automatic price freshness, and a new Prop Research probability checker.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

## Decisions settled for this document

These resolve the pitch's design-level open questions and the run's pre-resolved decisions. Each is restated as a Resolved Decision in the technical spec; this section exists so a reader of the design doc alone knows the ground it stands on.

1. **The Slate is grouped game → player, and a player appears once per game.** Games are the top-level structure; within a game a player is a single card carrying their strongest current opportunity. Repeated thresholds and additional stat types live *inside* the player experience, never as sibling rows. (Pitch: game-centered organization, player cards.)
2. **Best-opportunities-first is a re-ordering of the same grouped surface, not a second page.** The default view surfaces the strongest confidence-adjusted-edge opportunities across all games at the top; the full game-by-game browse is the same data below it. Switching between "Best opportunities" and "By game" changes ordering and emphasis, not the underlying set. Ranking is unchanged from Kalshi Sync — confidence-adjusted edge, both directions eligible. (Run RD-5.)
3. **Threshold semantics: above = `P(stat ≥ threshold)`, below = `P(stat < threshold)`, always complementary to 100%.** No third "exactly N" bucket is ever displayed. (Run RD-1.)
4. **Progressive disclosure: the collapsed card shows a summary; distribution graphs and full evidence load only when detail is opened.** A collapsed player card never renders a distribution chart. (Pitch: performance.)
5. **Freshness is expressed in five plain-language states** — Current, Updated recently, New information pending, Stale, Unavailable — derived from existing stored signals, with raw timestamps still inspectable in detail. Price freshness and projection freshness remain two distinct facts. (Run RD-9.)
6. **Automatic price refresh is on-view lazy refresh backed by the existing scheduler.** Opening or returning to the Slate triggers a freshness-gated server-side refresh; a Postgres advisory lock prevents concurrent viewers from duplicating the upstream call. The manual "Refresh Prices" control becomes an admin-only diagnostic. No client ever calls Kalshi. (Run RD-2, RD-7.)
7. **Accuracy and advanced model analytics move behind the admin boundary.** Viewers keep Slate + Prop Research. This is a server-side authorization change, enforced on every relocated route, not a navigation hide. (Pitch; run RD-6.)
8. **Prop Research is probability-only and never renders an edge number.** When a typed threshold exactly matches a currently-listed contract with a fresh price, Prop Research links to that contract's detail rather than computing edge itself. (Run RD-8.)
9. **Prop Research is available for any player/stat/game with a current stored base distribution for a game that has not reached kickoff, regardless of whether Kalshi lists it.** No stored distribution → an honest "no current projection" state, never a season-average fallback. (Run RD-4.)
10. **Suggestions stop being a primary destination.** Pending suggestions surface inline on the affected player for the admin (reusing Pitch 9's accept/decline, not a second mechanism); history and reliability analytics move into the admin area. Viewers never see pending-suggestion actions. (Pitch.)

## 1. Vision

The Slate is the screen William — and every viewer — opens on a Sunday morning with a few minutes before kickoff. Today it hands them a wall of near-identical contract rows and asks them to do the grouping in their head. This redesign makes the screen answer the only question that matters at that moment — *what does Sightline like right now, and for which players* — by organizing the market into games and players, surfacing the strongest opportunities first, and letting a curious user open one player, read the probability and why, and leave. Prop Research extends the same machinery to any line the user encounters anywhere else: type a number, get Sightline's honest probability, with no pretense of economic edge it cannot compute.

**North star: the strongest opportunities in one glance, one player at a time, honest about what it is worth and what it is not.**

## 2. Design principles

### 1. One player, one place

A player who has six receiving-yards thresholds and a receptions market is one person to the reader, not seven rows. Every threshold and stat type for a player in a game collapses into a single card; the card shows the best opportunity and the rest is reachable inside it. A design decision that reintroduces the same player as a sibling row has failed this principle.

### 2. Progressive disclosure, not deletion

Simplification is achieved by revealing evidence in layers, never by dropping it. The collapsed card carries the decision-relevant summary; the distribution, drivers, full market book, and provenance appear when the user opens detail. If a choice removes a number the user needs rather than relocating it one layer down, it is the wrong choice.

### 3. Uncertainty and provenance still travel with the number

Inherited from the Slate that came before and non-negotiable here: every probability carries confidence, every price carries its observed time, every projection carries its computed time, and model values wear the model accent while market values wear market mint. Grouping and simplification never strip these.

### 4. Best does not mean likeliest

"Best opportunity" is confidence-adjusted edge, exactly as Kalshi Sync defined it — a 94%-to-clear contract priced at 96¢ is not an opportunity, and a strong recommendation that an event will *not* happen ranks alongside one that it will. Direction is always explicit; the optimism of an "over" earns it no visual advantage.

### 5. Honest about worth

Probability is what the model believes; edge is what that belief is worth against a real price. Prop Research shows the first and refuses to fabricate the second. A 64% probability is never dressed as a good bet, and a missing projection is said plainly rather than filled with a season average.

### 6. Absence, not a locked door

Moving Accuracy and the operational tools behind the admin boundary means a viewer's interface contains no trace of them — no greyed tab, no lock icon, no partial shell. The server rejects a viewer's deep link to a relocated route exactly as it rejected `/users` before. Hidden navigation is a courtesy; the server check is the boundary.

## 3. Information architecture

```text
Sightline
├── Slate                          (shared)  ← default landing; redesigned
│   ├── Best opportunities         (shared)  ← default ordering
│   ├── By game                    (shared)  ← same data, game-grouped browse
│   │   └── Player card            (shared)  ← one per player per game; expandable
│   │        ├── Stat / threshold selector
│   │        ├── Inline accepted-adjustment context (shared)
│   │        └── Inline pending suggestion → accept / decline (admin only)
│   └── Player / prop detail       (shared)  ← drawer at xs/sm, side panel at md+
│        └── Distribution · drivers · market · provenance · outcome (post-game)
├── Prop Research                  (shared)  ← NEW route, this pitch
│   └── Result (probability, range, confidence, drivers, freshness)
│        └── "Listed on Kalshi" link → contract detail   (when an exact listed match exists)
├── Settings                       (shared)  ← appearance selection
│
└── Admin                          (admin only)  ← NEW grouped area
    ├── Accuracy                   (admin only)  ← MOVED from shared
    │   ├── Summary (plain-language)            ← NEW default layer
    │   ├── Calibration & reliability (advanced)
    │   ├── Error vs baselines (advanced)
    │   ├── Market comparison (advanced)
    │   └── Overrides & timing cost
    ├── Model comparison           (admin only)  ← per-version accuracy
    ├── Suggestions                (admin only)  ← history + reliability analytics
    ├── Autonomy / Dry Run / Bankroll & risk
    ├── Health                     (admin only)  ← retains raw timestamps + refresh diagnostics
    └── Users                      (admin only)
```

- The viewer's primary navigation is exactly two product destinations — **Slate** and **Prop Research** — plus Settings. Everything else lives under **Admin** and is server-guarded.
- The Slate remains the default landing for both roles.
- `Suggestions` leaves primary navigation entirely; its accept/decline action relocates inline onto the Slate, and its history/reliability relocates under Admin.
- Backtest calibration continues to render *inside* Accuracy as a labelled record; there is still no standalone backtest browser.

## 4. Visual language

### 4.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | Model-derived values: threshold probability, projected value, interval, confidence, drivers, positive edge, recommendation marker, Prop Research probability | The model accent. Never applied to market values. |
| `palette.market.main` / `market.fill` | Kalshi-derived values: ask, bid, midpoint, spread, price timestamps; market curve in Accuracy | Kalshi provenance. `fill` for chart strokes, `main` for small text. |
| `palette.warning.main` / `warning.soft` | Stale and "new information pending" states, low confidence, insufficient sample, degraded price mode, pending-suggestion marker | Caution only. Never "bad price" or "loss". |
| `palette.error.main` | Negative edge, `faded` disposition | Desaturated rose; data encoding, not payout. |
| `palette.text.secondary` / `disabled` | Below-threshold de-emphasis, timestamps, qualifiers, game-group headers' secondary metadata | De-emphasis is text colour, never card height or removal. |
| `palette.success.main` | Reserved for Accuracy summary's "calibrated / outperforming" plain-language verdict chip only | Used sparingly and always paired with its sample size; never on the Slate. |

### 4.2 State colours used in this pitch

Exact data-model values; no invented state names.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| recommended | Model-accent left-edge marker + `Chip` `recommended`, outlined | Player's best opportunity meets the configured threshold |
| below threshold | Card/opportunity text drops to `text.secondary`; no chip | Visible, ranked, de-emphasised — never removed |
| `took` / `faded` / `skipped` | Model-accent filled / rose filled / neutral outlined chip | Admin-only, on the player card's selected prop and in detail |
| unmarked | No indicator at all | Absence of a decision row; never a fourth chip |
| `pending` (suggestion) | Warning-tone outlined chip `new information` on the player card | Admin sees accept/decline inline; viewer sees only the status |
| `accepted` (suggestion) | Model-accent outlined chip `adjusted` + inline note | Shadow is the active projection; shown to both roles as context |
| `declined` (suggestion) | No card indicator | Base remains active; shadow still graded (invisible on Slate) |
| `high` / `medium` / `low` (confidence) | Confidence word + three-step indicator | Always beside the probability it qualifies |
| projection `insufficient_evidence` | Warning outlined chip `no projection`; probability/edge cells show `—` | Model explicitly declined; not an empty cell |
| Current / Updated recently | Neutral text with relative time | Fresh price and/or fresh projection |
| New information pending | Warning-tone text + dot | Material pending suggestion or projection predates inactives |
| Stale | Warning-tone badge `stale`, card-visible | Fact ingested after projection cutoff, or predates inactives past boundary |
| Unavailable | Neutral with last-known time or `—` | No projection, or Kalshi degraded |

Colour is reinforcement, never the only channel: edge carries an explicit `+`/`−` sign and `▲`/`▼` glyph; every chip carries its word; freshness carries a text label.

### 4.3 Typography

Per the brand system: every computed numeric — probability, price, edge, threshold, range, timestamps — uses tabular figures (`numericMd` in cards, `numericLg` for detail and Prop Research headline figures, `numericSm` for dense qualifiers). No data value is ever bolded to signal importance; emphasis is position and colour. Game-group headers use `label`; player names use the body scale, not a numeric face.

### 4.4 Appearance

All surfaces are theme-token driven and work in light, dark, and system. The two graphics that differ meaningfully by mode are the distribution summary in player/prop detail and Prop Research (filled mass above threshold uses the model-accent soft token, stroke read from the theme, no hardcoded hex including in Recharts) and the reliability curve in Accuracy's advanced layer.

## 5. Screen specifications

## Screen 1: The Slate (redesigned)

### Purpose

Show every user, in one scan, the strongest current opportunities and let them browse the whole upcoming market organized by game and player — one card per player — without reading a wall of near-duplicate contract rows.

### URL pattern

`/slate` — the post-sign-in landing for both roles. Query params carry view mode and filters so a filtered slate is shareable and returnable: `?view=best|game&game=&team=&stat=&rec=&conf=&market=&q=`.

### Trigger

Sign-in lands here; the nav lockup links here; every back-path from detail and from Prop Research returns here with prior scroll and filter state preserved.

### Layout — `md` and above

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Slate                                          prices updated 11:42:07a │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ 🔍 Search players           [Best opportunities ▾] [Filters (2) ▾]│   │
│ └─────────────────────────────────────────────────────────────────┘   │
│ Filters: [Stat: Receiving ✕] [Rec: Recommended ✕]        [Reset all]   │
├───────────────────────────────────────────────────────────────────────┤
│ BEST OPPORTUNITIES                                                      │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │▍Ja'Marr Chase   CIN vs BAL · Sun 1:00p         ● recommended       │ │
│ │  Rec yds ≥ 74.5   P(≥) 61.4% ·med·   74¢ ask   +8.6▲   [3 more ▾]  │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │▍Saquon Barkley  PHI vs DAL · Sun 4:25p         ● recommended       │ │
│ │  Rush yds < 64.5  P(<) 58.1% ·high·  60¢ ask   +6.1▲   ⚠ new info  │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│ … more best opportunities …                                            │
├───────────────────────────────────────────────────────────────────────┤
│ ALL GAMES                                                               │
│ ▸ Sun 1:00p · CIN vs BAL · Current · 8 players                         │
│ ▾ Sun 4:25p · PHI vs DAL · ⚠ new info pending · 6 players              │
│    ┌────────────────────────────────────────────────────────────────┐ │
│    │  Saquon Barkley  PHI      best: Rush yds < 64.5  58.1%  +6.1▲   │ │
│    │  CeeDee Lamb     DAL      best: Rec yds ≥ 79.5   54.0%  +2.2▲   │ │
│    │  … more players …                                               │ │
│    └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

The best-opportunities block and the game-grouped block are the same rows re-emphasised. In `view=best` the best block is expanded and games are collapsed; in `view=game` games are the primary structure and the best block collapses to a single "Top 5 opportunities" strip.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header** | `AppBar`-adjacent `Box`; price-updated time in `market.main` `numericSm` | Time updates silently after an automatic refresh; no spinner, no toast |
| **Search field** | `TextField` with search adornment, `size="small"` | Debounced client filter over already-loaded player names; narrows both blocks; never triggers a model run |
| **View toggle** | `ToggleButtonGroup` `Best opportunities` / `By game` | Reorders in place; writes `view` param |
| **Filter menu** | `Button` opening a `Popover` with grouped controls; active count badge | Applies combinable filters; writes params; a `Filters (n)` badge shows active count |
| **Active filter chips** | `Chip` row, each removable; `Reset all` `Button` `text` | Each chip clears its own facet; Reset returns to default best view |
| **Game group header** | `ListSubheader`-style `Box`, `label` type; kickoff, teams, freshness chip, player count | Collapsible (`Collapse`); state persists in session |
| **Player card (collapsed)** | new `PlayerCard`; identical height per variant | See Screen 2; shows best opportunity only |

### Code reference

```tsx
// Slate composition (server component streams the grouped DTO; islands handle interaction)
<SlateHeader pricesUpdatedAt={slate.pricesUpdatedAt} degraded={slate.priceDegraded} />
<SlateControls
  view={scope.view}
  filters={scope.filters}
  availableStatTypes={slate.availableStatTypes}  // derived from data, never hardcoded
  availableGames={slate.games.map(g => g.summary)}
/>
{scope.view === "best" && <BestOpportunities rows={slate.bestOpportunities} />}
<GameGroups
  games={slate.games}          // each: summary + players[]; player: bestOpportunity + props[]
  expandedByDefault={scope.view === "game"}
/>
```

### Fields (filter controls)

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Search | text | no | empty | Partial, case/diacritic-insensitive match on player name |
| View | enum `best` \| `game` | no | `best` | Unrecognized → `best` |
| Game | multi-select | no | all | From current slate's games |
| Team | multi-select | no | all | Home/away teams present in the slate |
| Date / window | enum of present windows | no | all | Derived from kickoff windows present |
| Stat type | multi-select `StatType` | no | all | Derived from data; menu never hardcoded |
| Recommendation / direction | enum `recommended` \| `above` \| `below` \| all | no | all | "recommended" = meets threshold; direction filters by favored side |
| Confidence | multi-select `high`/`medium`/`low` | no | all | |
| Market availability | enum `has_market` \| `no_market` \| all | no | all | |

### Validation

- Filters never error; an over-narrow combination yields the empty state, not an alert.
- Filtering and search never mutate a probability or edge — they hide and re-order the same computed rows.

### Empty state

```text
┌───────────────────────────────────────────────┐
│              No players match                  │
│  No players match “chase” with these filters.  │
│              [Clear filters]                    │
└───────────────────────────────────────────────┘
```

Three distinct empty states, not one: (a) filters/search too narrow → "No players match — clear filters"; (b) valid slate but nothing recommended → best block shows "Nothing clears the recommendation threshold today" and the game groups remain browsable below; (c) no upcoming games at all (offseason / midweek) → the designed empty slate ("No upcoming games") that Kalshi Sync already established.

### Loading state

`Skeleton` game-group headers and collapsed player cards at matching heights; the grouped structure renders from stored data and **never** waits on a model run. Price cells within a card may resolve after the card and show a compact `Skeleton` in the price position only.

### Error state

Kalshi unavailable is a designed degraded mode, not an error: one banner at the top ("Prices unavailable — last refreshed 11:12a"), probabilities and cards render fully, price/edge cells show last-known value with age or `—`. A stale projection is a card-level disclosure, never an alert.

### Behavior

- On mount and on tab re-focus (`visibilitychange` → visible), the Slate performs a freshness-gated automatic price refresh (Screen 6 behavior). No manual control for viewers.
- Expanding a player card is inline (Screen 2); opening full detail navigates to the drawer/panel (Screen 3).
- Best/By-game toggle and filter changes are client-side re-emphasis of loaded data plus a shallow URL update; they do not refetch the whole slate.

## Screen 2: Player card (collapsed and expanded)

### Purpose

Represent one player in one game as a single unit that shows their strongest current opportunity at a glance and lets the user step through the player's other thresholds and stat types without leaving the Slate.

### URL pattern

No route of its own; expansion state is card-local. Selecting a specific prop for full analysis opens Screen 3 at `/slate/[contractId]` (or, for an unlisted stored projection surfaced via Prop Research, that flow).

### Trigger

Rendered inside a game group and inside the best-opportunities block. Clicking the card body (or `[n more ▾]`) expands it in place; clicking a specific prop opens detail.

### Layout — collapsed (`md`+)

```text
┌───────────────────────────────────────────────────────────────────┐
│▍Ja'Marr Chase   CIN vs BAL · Sun 1:00p              ● recommended  │
│  Best: Receiving yds ≥ 74.5   P(≥) 61.4% ·med·  74¢  +8.6▲  [4 ▾] │
└───────────────────────────────────────────────────────────────────┘
```

### Layout — expanded

```text
┌───────────────────────────────────────────────────────────────────┐
│▍Ja'Marr Chase   CIN vs BAL · Sun 1:00p     Current   ● recommended │
│  Stat: [Receiving yds ▾]  Receptions  Rushing yds                  │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │ Threshold   Direction   P        Conf   Ask    Edge   Rec      ││
│  │ ≥ 49.5      above       84.2%    med    88¢    −3.8▽           ││
│  │ ≥ 74.5      above       61.4%    med    74¢    +8.6▲   ● rec   ││  ← best, pre-selected
│  │ ≥ 99.5      above       28.0%    low    22¢    +2.1▲           ││
│  │ < 74.5      below       38.6%    med    …                      ││
│  └───────────────────────────────────────────────────────────────┘│
│  Adjusted: ESPN lists CIN active — projection unchanged (accepted) │
│  [Open detail →]                                                   │
└───────────────────────────────────────────────────────────────────┘
```

For the admin, a pending suggestion renders an inline action band instead of the accepted note:

```text
│  ⚠ New information (ESPN): BAL CB questionable → +4.1pp on ≥74.5    │
│     [Review & accept]   [Decline]                                   │
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header row** | `Box`; name (body), context (`text.secondary`), freshness chip, recommendation marker | Constant height across variants |
| **Best line (collapsed)** | model probability (`primary.main`), confidence word, ask (`market.main`), edge with sign+glyph | The single opportunity that ranks the card |
| **Stat selector** | `Tabs` (`variant="scrollable"`) or `ToggleButtonGroup` for available stat types | Derived from stored projections; switching updates the threshold table |
| **Threshold table** | dense `Table`; one row per listed threshold + the complementary below row for the selected/best | Selecting a row sets the active prop; probability/price/edge update from already-loaded data |
| **Adjustment context** | `accepted` → outlined note; `pending` (admin) → warning band with accept/decline | Reuses Pitch 9 accept/decline route; viewer never sees the action band |
| **Open detail** | `Button` `text` | Navigates to Screen 3 for the selected prop |

### Code reference

```tsx
<PlayerCard
  player={player}                      // name, team/opponent, freshness
  best={player.bestOpportunity}        // pre-selected prop
  statTypes={player.statTypes}         // derived; drives the selector
  props={player.props}                 // all thresholds per stat, each with probability/edge precomputed
  adjustment={player.adjustment}       // { kind: "accepted" | "pending" | null, note, suggestionId? }
  role={role}                          // admin sees pending accept/decline; viewer never does
  onOpenDetail={(contractId) => router.push(`/slate/${contractId}`)}
/>
```

### Empty / partial states

- A player with a projection but no listed Kalshi contract for the selected stat shows probability, confidence, and range with `—` in ask/edge and no recommendation marker (a valid, browsable state — the model has an opinion, the market has no line).
- A player whose selected stat projection is `insufficient_evidence` shows the `no projection` chip and `—` across probability/edge; other stat types for that player may still project.

### Behavior

- Changing stat type or threshold updates probability, price, edge, recommendation, and confidence from data already delivered to the client — no refetch, no model run (satisfies the DoD's "selecting a different threshold updates … correctly" without a round trip).
- Accept/decline (admin) posts to the existing Pitch 9 route; on success the card's projection and the note update in place with a `Projection updated` / `Suggestion declined` notification; no navigation.
- Card height is identical for recommended and below-threshold collapsed variants at every breakpoint.

## Screen 3: Player / prop detail

### Purpose

Give the full analysis for one selected prop — distribution, drivers, market book, provenance, freshness, and post-game outcome — without making the user rediscover the player in a list.

### URL pattern

`/slate/[contractId]` (unchanged). Detail is a full-height drawer at `xs`/`sm` and a side panel at `md`+.

### Trigger

`Open detail →` on a player card, a best-opportunity row, or (Screen 5) the "listed on Kalshi" link from Prop Research.

### Layout

Substantially the existing contract-detail surface (headline model P/ask/edge, `DistributionSummary` or `PmfBars`, drivers, four-sided market book + midpoint, currency block with computed/cutoff times and staleness disclosure, outcome block post-settlement), with two changes:

- The distribution graphic and drivers load as part of this view, never on the collapsed card (progressive disclosure).
- The freshness line leads with the plain-language state (Screen 6) and keeps the raw timestamps beneath it.

### Behavior

- `Esc` closes the drawer and returns focus to the originating card.
- Take/Fade/Skip remains admin-only and inline here, unchanged from Kalshi Sync.
- A pending suggestion on this prop shows the admin the same accept/decline action as the card; accepting updates the displayed projection in place.

### States

Loading: skeleton headline + chart placeholder at fixed height. Empty: a `contractId` with no projection shows the `no projection` state with drivers absent and distribution replaced by the decline reason. Error: an unknown `contractId` renders the existing not-found terminal state.

## Screen 4: Admin area & navigation split

### Purpose

Give the admin one clearly-separated place for every operational and analytical capability, and give viewers a two-destination product, without weakening any capability or relying on hidden navigation for security.

### URL pattern

Existing routes are retained (`/accuracy`, `/health`, `/users`, `/autonomy`, `/suggestions`, and their children); they are regrouped under an **Admin** navigation section and every one is server-guarded by `requireAdmin()`. `/accuracy` changes from a shared route to an admin route.

### Layout — navigation

```text
Desktop (viewer):   Slate | Prop Research                        [avatar ▾]
Desktop (admin):    Slate | Prop Research | Admin ▾              [avatar ▾]
                                            └─ Accuracy
                                               Model comparison
                                               Suggestions
                                               Autonomy
                                               Dry Run
                                               Bankroll & risk
                                               Health
                                               Users
Mobile (viewer):    drawer → Slate, Prop Research, Settings
Mobile (admin):     drawer → Slate, Prop Research, Settings, — Admin — …
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Primary tabs** | existing `AppShell` tab set | Viewer: Slate, Prop Research. Admin: adds an `Admin` menu |
| **Admin menu** | `Menu` / nested drawer group under an "Admin" label | Lists admin destinations; a courtesy only |
| **Admin destination pages** | unchanged page components | Each calls `requireAdmin()` server-side before any render |

### Behavior

- A viewer's rendered markup contains **no** Admin entry and **no** relocated-route link.
- A viewer deep-linking to any relocated route (`/accuracy`, `/accuracy/overrides`, model comparison, `/suggestions`, etc.) receives the in-place 403 (`AccessDenied`), not a redirect and not a partial shell — identical to the existing `/users` behavior.
- Moving a feature does not change what it does; only where it is reached and who may reach it.

### Empty / loading / error

Inherited from the existing pages. The only new surface — the Admin menu — has no empty state (its contents are static). Navigating as a viewer never reaches these pages.

## Screen 5: Accuracy — plain-language summary

### Purpose

Answer the admin's real questions first — is the active model doing well, is there enough evidence to say so, is it calibrated, is it beating the baseline and the market, and is it improving — before exposing the measurement machinery.

### URL pattern

`/accuracy` (now admin-only). The summary is the default layer; existing panels become an "Advanced analysis" region below or behind a disclosure, deep-linkable via existing scope params.

### Layout

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Accuracy · Contract-like · 2025 season · simulation-mc-0.1.0           │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │ How is the active model doing?                                    │   │
│ │  ● Calibrated within tolerance     1,847 obs · 412 projections    │   │
│ │  When Sightline says 60%, it happens about 60% of the time.       │   │
│ ├─────────────────────────────────────────────────────────────────┤   │
│ │ Enough evidence yet?   Yes for calibration · market: 41 obs (thin)│   │
│ │ Brier 0.191  — lower is better; 0.25 is a coin flip, 0 is perfect │   │
│ │ vs baseline   Better than season-average and trailing-five (MAE)  │   │
│ │ vs market     Insufficient comparable observations (need 30, have 41 across…)│
│ │ Trend         Stable over the last 3 graded weeks                 │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│ [▾ Advanced analysis — reliability curve, bins, error, market panel]   │
└───────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Scope line** | existing population/season/version selectors | Unchanged; state travels in URL |
| **Verdict chip** | `Chip`; `success.main` calibrated / `warning.main` provisional or drifting | Always paired with its two denominators; never shown without sample size |
| **Plain-language rows** | `Box` rows with a one-line interpretation each | Brier, baseline, market, trend, each with a concise plain-language gloss |
| **Brier interpretation** | inline helper text | "lower is better; 0.25 ≈ coin flip, 0 perfect" — the concise gloss, not a tutorial |
| **Insufficient-evidence copy** | `warning.soft` row | "Insufficient comparable observations" with the running count — framed as not-yet-enough, never as poor performance |
| **Advanced disclosure** | `Accordion` / secondary tab | Reveals the existing calibration curve, bins, error panel, market panel unchanged |

### Behavior

- The summary derives entirely from the same stored reads the advanced panels use; it computes no new metric, it interprets existing ones.
- Every rate shows its denominators; a thin sample reads as "not enough evidence yet," not as a bad score.
- No metric is removed — Brier, calibration, sample sizes, baseline, and market comparison all remain, one layer down.

### States

Empty: an out-of-season / no-graded-data scope shows "Not enough graded predictions yet — N so far," never a fabricated verdict. Loading: skeleton verdict chip + rows. Error: inherited.

## Screen 6: Automatic price freshness (behavior, cross-cutting)

### Purpose

Keep prices reasonably fresh without any manual action, and communicate freshness in plain language, while never letting a fresh price disguise a stale projection.

### Trigger

Opening or returning to the Slate; the background scheduler between visits.

### Behavior

1. On Slate mount and on tab re-focus, an island checks the age of the freshest stored price against the freshness interval. If older, it POSTs Sightline's own refresh route (never Kalshi directly).
2. The server refresh is guarded by a short-lived advisory lock keyed by the market set: a concurrent viewer whose check finds the lock held does not trigger a second upstream call; it simply reads whatever price lands when the in-flight refresh completes.
3. On success the header's "prices updated" timestamp updates silently — the timestamp is the only feedback, no toast.
4. On failure the previous valid price is retained; the freshness line degrades ("Prices unavailable — last refreshed 11:12a") and the top banner appears.
5. The background scheduler remains the backstop for pages nobody is looking at; its cadence is unchanged.

### Freshness vocabulary

| Displayed state | Derived from | Treatment |
| --------------- | ------------ | --------- |
| **Current** | Fresh projection; price within interval | Neutral, relative time in detail |
| **Updated recently** | Price refreshed within interval; projection not stale | Neutral |
| **New information pending** | Material pending suggestion, or projection predates inactives | `warning.main` text + dot |
| **Stale** | `isStale` (fact ingested after projection cutoff), or predates inactives past the boundary | `warning.main` badge, card-visible |
| **Unavailable** | No projection, or Kalshi degraded | Neutral, last-known time or `—` |

- Price freshness and projection freshness are computed and displayed as two facts; a successful price refresh never clears a stale projection, and a projection recompute never claims the price is current.
- The manual "Refresh Prices" control is removed from the viewer Slate and retained only in admin Health diagnostics.

## Screen 7: Prop Research

### Purpose

Let any authenticated user get Sightline's honest probability for an arbitrary player/stat/threshold on an upcoming game, reusing a stored distribution, with no pretense of economic edge.

### URL pattern

`/research` — a primary destination for both roles. Deep-linkable: `?player=&game=&stat=&threshold=`.

### Trigger

The `Prop Research` nav item; also reachable via "research this player" affordances if present on a player card (optional, design-time).

### Layout — input and result (`md`+)

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Prop Research                                                           │
│  1  Player     [🔍 Matthew Stafford            ]                        │
│  2  Game       [LAR vs SF · Sun 4:25p ▾]   (only upcoming w/ projection)│
│  3  Stat       [Passing yards ▾]  Completions?  (only stored stats)     │
│  4  Threshold  [ 225.5 ]                                                │
│ ┌─────────────────────────────────────────────────────────────────┐   │
│ │  Passing yards vs 225.5                              ·medium·     │   │
│ │  ▲ Above 225.5   64.2%          ▼ Below 225.5   35.8%             │   │
│ │  Projected 241.3   ·   range 198–286 (10–90%)                     │   │
│ │  ░░░░░▓▓▓▓▓▓▓▓▓█████│██████▓▓▓▓░░░░   ← 225.5 marker              │   │
│ │  Why: high recent pass volume; SF pass defense rank; dome         │   │
│ │  Projection computed 4:58a today · simulation-mc-0.1.0            │   │
│ │  This line is listed on Kalshi → [View contract]   (if exact match)│   │
│ └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Player search** | reuses the Slate player-search interaction; `Autocomplete` restricted to players with a current stored upcoming base projection | Typing narrows; selecting sets player |
| **Game select** | `Select` of that player's upcoming (kickoff in future) games with a stored projection | Only games not yet kicked off |
| **Stat select** | `Select` of stat types with a stored distribution for the chosen game | Derived from data; never hardcoded |
| **Threshold field** | `TextField` numeric, `inputMode="decimal"` | Accepts arbitrary supported value; recomputes instantly client-side from the delivered distribution |
| **Result — above/below** | two `numericLg` figures in `primary.main`, complementary to 100% | RD-1 semantics; both always shown |
| **Projected value + range** | `numericMd` | Central value and 10–90% interval from stored fields |
| **Distribution marker** | `DistributionSummary` / `PmfBars` with the entered threshold marked | Same component family as detail |
| **Drivers** | ordered list | The stored projection drivers |
| **Freshness + provenance** | plain-language freshness + computed time + model version | Same vocabulary as the Slate |
| **Listed-on-Kalshi link** | `Button` `text`, appears only on an exact listed-threshold match with a fresh price | Navigates to `/slate/[contractId]`; Prop Research itself renders no edge |

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Player | selected player id | yes | none | Must have a current stored upcoming base projection |
| Game | game id | yes | player's soonest upcoming | Kickoff must be in the future |
| Stat | `StatType` | yes | first available | Must have a stored distribution |
| Threshold | number | yes | projected median (prefilled) | Any real number in the stat's support; `.5` and integer both handled per RD-1 |

### Validation

- A non-numeric or empty threshold disables the result computation with inline helper text; prior result is preserved.
- Threshold changes never call the Projection Engine — computation is `probAtLeast` on the already-delivered distribution.

### Empty / no-data state

```text
┌───────────────────────────────────────────────────────────────────┐
│  No current projection                                              │
│  Sightline doesn’t have a current projection for                    │
│  Odell Beckham Jr. · receiving yards · this week.                   │
│  Prop Research only covers players Sightline is already projecting  │
│  for an upcoming game.                                              │
└───────────────────────────────────────────────────────────────────┘
```

- This state appears when the searched player/stat/game has no stored current distribution. It never falls back to a season average or any approximation.
- The search itself only surfaces players who have a current stored upcoming projection, so the no-data state is primarily reached via a deep link or a stat with no stored distribution.

### Loading state

Skeleton result card at fixed height while the selected player's distributions load; the above/below figures never show a spinner once a distribution is present, because recomputation is local arithmetic.

### Error state

A deep link with an invalid or now-kicked-off game shows the no-data state with an explanation that the game has started (Prop Research is pre-game only). No probability is shown for a kicked-off game.

### Behavior

- Selecting player → game → stat progressively enables the next control; the threshold prefills with the projected median so a first result appears immediately.
- Changing the threshold updates both complementary probabilities and the distribution marker instantly.
- No edge, no profitability language, no payout entry — ever, in this screen.

## 6. Navigation flows

```text
Sign in ─▶ /slate (Best opportunities)
   │
   ├─ search / filter ─▶ same slate, re-emphasised (URL updated; probabilities unchanged)
   │
   ├─ expand player card ─▶ inline threshold/stat stepping (no navigation)
   │     └─ admin: accept/decline pending suggestion ─▶ projection updates in place
   │
   ├─ Open detail ─▶ /slate/[contractId] (drawer xs/sm · panel md+)
   │     ├─ admin: take/fade/skip ─▶ returns to slate, disposition reflected, scroll kept
   │     └─ Esc ─▶ close, focus returns to originating card
   │
   ├─ Prop Research ─▶ /research
   │     ├─ player→game→stat→threshold ─▶ probability result (local recompute on threshold change)
   │     ├─ no stored projection ─▶ honest no-data state (never a fallback)
   │     └─ exact listed match ─▶ [View contract] ─▶ /slate/[contractId]
   │
   └─ (admin) Admin ▾ ─▶ Accuracy (summary ▸ advanced) · Model comparison · Suggestions · Autonomy · Health · Users
         └─ (viewer) any relocated route via deep link ─▶ server 403 in place
```

State carried between screens: filter/view/scroll on Slate↔detail; player/game/stat/threshold in Prop Research URL; Accuracy scope in URL. Deep-linking a filtered Slate, a Prop Research query, or a scoped Accuracy view all return the same state.

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Slate | `/` | Focus the player search field |
| Slate best/game list | `↑` / `↓` | Move between player cards |
| Player card | `Enter` | Expand / collapse |
| Player card (expanded) | `←` / `→` | Move between stat types |
| Player card row | `Enter` | Open detail for the selected prop |
| Detail drawer | `Esc` | Close, return focus to the originating card |
| Decision control | `T` / `F` / `S` | Took / faded / skipped, admin, only with a prop focused |
| Suggestion action (admin) | `A` / `D` | Accept / decline, only with a pending suggestion focused |
| Prop Research | `Enter` in threshold | Confirm value (result already live-updates) |
| Any dialog / menu | `Tab` | Focus trapped within |

- No shortcut submits a Kalshi order (none exists on these surfaces) and none accepts a suggestion without the pending item focused.
- Slate review, decision logging, and suggestion accept/decline are fully keyboard-operable on desktop.

### Loading states

Per screen above; the governing rule is unchanged — the Slate renders from stored data and never shows a spinner waiting on a model run. Price cells and distribution charts resolve after their container and never block the first useful paint. This is the visible expression of the performance requirement.

### Error states

`Alert` + inline errors with retry where retry helps. Kalshi unavailable is a designed degraded mode (one banner, last-known prices), not an error. A stale projection is an in-card disclosure. A missing projection in Prop Research is a plain no-data state, never an error dialog.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Prices refreshed | none — the timestamp updating is the feedback | — | — |
| Automatic refresh failed | banner (not toast): `Prices unavailable — last refreshed {time}` | warning | until next success |
| Suggestion accepted (admin) | `Projection updated` | success | 3s |
| Suggestion declined (admin) | `Suggestion declined` | info | 3s |
| Decision logged / changed | `Marked as took` / `Changed to faded` | success | 3s |
| Prop Research threshold change | none — figures update in place | — | — |

### Destructive actions

This pitch introduces none. Suggestion accept/decline are reversible-by-record (declining still grades the shadow); take/fade/skip retain their existing change-but-never-clear semantics. No confirmation dialogs are added.

## 8. Responsive behavior

Sightline is mobile-first; the Slate on a phone before kickoff is the design target.

| Breakpoint | Width | Behavior |
| ---------- | ----- | -------- |
| `xs` | 0–599 | Single column. Player cards stack; the collapsed card wraps to two lines (name/context, then best opportunity) rather than truncating. Filters collapse into a full-width `Drawer` opened by a `Filters` button — never a shrunken desktop filter bar. Search is full-width and sticky. Detail is a full-height drawer. Prop Research controls stack vertically; the result card is full-width. Admin menu is a drawer group. |
| `sm` | 600–899 | Single column, wider gutters; collapsed card returns to one line. |
| `md` | 900–1199 | Game groups with player cards; detail becomes a side panel. Primary nav persistent; Admin as a menu. Prop Research shows input and result side by side. |
| `lg` | 1200–1535 | Full card metadata visible without truncation; best-opportunities block and game groups both comfortably dense. |
| `xl` | 1536+ | Content max-width applies; the slate does not stretch. |

For every screen: nothing scrolls horizontally at any breakpoint; player-card height is identical for recommended and below-threshold collapsed variants at every breakpoint; every action (expand, filter, open detail, accept/decline for admin, run research) remains reachable at `xs` within thumb range.

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `SlateHeader` | Slate | new | Price-updated time, degraded banner; no manual refresh for viewers |
| `SlateControls` | Slate | new | Search, view toggle, filter popover/drawer, active-filter chips, reset |
| `GameGroup` | Slate | new | Collapsible game header + player cards; freshness chip + player count |
| `PlayerCard` | Slate | new | Collapsed/expanded; variants recommended, below-threshold, no-projection, has-adjustment, pending-suggestion (admin) |
| `ThresholdTable` | Slate (card) | new | Per-stat thresholds + complementary below row; selection updates from loaded data |
| `BestOpportunities` | Slate | new | Re-emphasised top slice of the same rows |
| `FreshnessLabel` | Slate, detail, research | new | Maps stored signals → five plain-language states; text + colour + optional dot |
| `ProbabilityValue` | everywhere | reused | Monospace, tabular, always paired with confidence |
| `EdgeValue` | Slate, detail | reused | Sign + arrow glyph + colour |
| `DistributionSummary` / `PmfBars` | detail, research | reused | Threshold-marked; theme-driven, no hardcoded hex |
| `DriversList` | detail, research | reused | Ordered stored driver sentences |
| `SuggestionActionBand` | Slate card, detail | reused (Pitch 9 action) | Admin-only accept/decline; posts to existing route |
| `AutoRefreshIsland` | Slate | new (replaces/extends `SlatePoller`) | Freshness-gated on-view/return refresh; server advisory lock |
| `PropResearchForm` | /research | new | Player→game→stat→threshold; reuses player search |
| `PropResearchResult` | /research | new | Above/below, range, drivers, freshness; no edge |
| `AccuracySummary` | /accuracy | new | Plain-language verdict + interpreted metrics |
| `AdminNav` | shell | new | Admin menu/drawer group; courtesy, not the boundary |

- Numeric primitives and state labels are reused across the Slate, detail, and Prop Research so the three surfaces speak the same visual language.
- Decomposition beyond this belongs to the spec.

## 10. Accessibility, privacy, and data sensitivity

Accessibility:

- All interactive controls have accessible names, including icon-only controls (search, filter, expand/collapse, freshness dot).
- State indicators never rely on colour alone: edge carries sign + arrow, freshness carries a word, confidence carries a word, the recommendation carries a chip label, the suggestion state carries a word.
- Player-card expansion exposes `aria-expanded`; the stat selector is a labelled tablist; the threshold table has header semantics.
- Distribution charts and the reliability curve carry a text-equivalent summary (projected value, range, probability at the marked threshold) so a screen reader gets the number even without the SVG.
- Prop Research controls have labels and helper/error text; the result's above/below figures are announced when they change.
- Dialogs, drawers, and menus trap focus and return it to the trigger on close.

Privacy and data sensitivity:

- **A viewer must never see, or be able to infer, the admin's Accuracy, decisions, positions, bankroll, suggestion analytics, or health internals.** Relocated admin surfaces are absent from viewer markup and rejected server-side; no disabled tab, no blurred panel, no lock icon — absence is indistinguishable from non-existence.
- Prop Research and the Slate carry no per-user data for viewers; projections are shared, not per-user, and viewer simplification must never create a separate model output.
- The Kalshi signing key never appears in any surface, including admin Health diagnostics and error messages; the manual refresh diagnostic triggers server-side logic and never exposes a credential.
- No credential field, order control, or "connect your Kalshi account" affordance appears on any surface for any role — viewers trade on Kalshi directly, and nothing here implies otherwise.
- Open-Meteo attribution remains wherever weather appears in drivers/detail.

## 11. Out of scope

**Deferred to a later pitch — not precluded:**

- Bankroll and portfolio management surfacing beyond the existing admin area; NBA/WNBA; friend pick sharing (which would convert viewers to writers); additional stat types beyond the six the engine supports; additional suggestion sources beyond ESPN inactives.
- A payout/price entry system for Prop Research (so it could compute edge on an external line) — explicitly not built here.

**Permanent non-goals — not to be relitigated:**

- PrizePicks / Underdog / sportsbook / DFS integration or scraping; external betting credentials; a payout calculator for external platforms.
- A general historical NFL research tool, player encyclopedia, fantasy lineup builder, or odds-comparison browser.
- Live in-game trading, film/tape inputs, public or commercial access, viewers trading through the application.
- Any economic-edge claim in Prop Research without a real market price; any model recomputation triggered by typing a threshold; any manufactured projection for a player/stat with no stored distribution.
- A new caching platform, a second Kalshi client, a second scheduler, or a relocated credential to make refresh or the Slate faster.
