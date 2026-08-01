# Live Pipeline & Staleness — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Live Pipeline & Staleness
**Focus:** Projection currency made visible — age, information cutoff, and two distinct staleness states on every slate row and contract detail — plus the admin-only pipeline health surface that makes a silently skipped scheduled job visible inside the product.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

## Decisions settled for this document

These resolve the pitch's design-level open questions. Each is restated as a Resolved Decision in the technical spec; this section exists so a reader of the design doc alone knows the ground it stands on.

1. **Staleness is two states, never one.** *Stale* (clearable): information Sightline can ingest exists for a game — final injury designations, weather updates, roster moves, completed prior results — and the displayed projection's information cutoff predates it; it clears only when a recomputed projection's information cutoff demonstrates the information was incorporated. *Predates inactives* (not clearable in this pitch): the game has passed the point at which official inactives publish, and Sightline has no inactives source yet, so every projection for that game permanently carries the disclosure that it was computed before them. The first is an amber caution; the second is a neutral disclosure that must never read as a malfunction. A row can carry both simultaneously. Adjustment Suggestions later converts *predates inactives* into a clearable state; nothing in this design may preclude that.
2. **Staleness lives on the row, not in a banner.** The slate is a flat list ranked by confidence-adjusted edge with no game grouping, and the banner region is already owned by Kalshi refresh outcomes (one banner maximum, a settled Pitch 4 decision). Both staleness states render as chips in each affected row's chip region — the slot the Pitch 4 design reserved for them — so per-game scoping is inherent: only rows of the affected game carry the chip.
3. **Projection age joins the timestamps line.** Every resolved row with a projection already shows `proj Thu 9:12a`; this pitch appends the age in parentheses — `proj Thu 9:12a (2d 4h)` — so age is readable without mental arithmetic. Price age is appended the same way and the two never merge into one freshness indicator.
4. **Operational health is admin-only; currency is shared.** Projection age, information cutoff, and both staleness states are visible to every authenticated user on the slate and detail — a viewer deciding whether to trust a recommendation needs them. The pipeline health surface (last successful ingest, recomputation, price refresh; delay and failure states; per-source and per-game detail) is admin-only at `/health`, matching the existing navigation gating. Viewers see no trace of it.
5. **Health is three global signals plus honest detail — not per-game monitoring.** One last-success signal per job category (ingest, projection recomputation, price refresh), each in exactly one of six states: `ok`, `running`, `late`, `failed`, `never run`, `not expected`. Ingest expands per source (required versus optional; the aggregate is green only when every required source succeeded). Recomputation expands to per-game completeness for the current slate. A specific game's trustworthiness lives in the slate's staleness chips, not in health.
6. **The health surface reports; it never operates.** No retry button, no run-now control, no workflow console. Recovery is command-line only, documented in the runbook. The only interactive element on the health screen is navigation.
7. **Offseason readiness is part of the `not expected` design.** When signals are dormant for the offseason, the health surface shows an offseason block: when schedules resume, and the keepalive's last activity — because "not expected" must not conceal that the keepalive died and next season's schedules have been disabled. This is a health signal, not a repository dashboard: one line, one timestamp, one caution state if the keepalive is overdue.

## 1. Vision

On a Sunday morning the slate must answer not only *where does Sightline disagree with the market* but *is this disagreement current enough to act on*. Every projection now says how old it is and what it knew; a game whose window has arrived says plainly that the projection predates today's inactives; and when the pipeline that maintains all of this quietly stops, the admin finds out from the product, not from a September surprise.

**North star: an instrument that timestamps its own readings — and says when the needle is old.**

## 2. Design principles

### 1. Disclose, don't race

Sightline is structurally the slowest participant near kickoff and cannot win that race. Its honest advantage is stating exactly what a projection did and did not include. "Computed against Friday's final injury report; predates today's inactives" is accurate and useful; silently implying currency is neither. Every treatment in this pitch is disclosure, not apology.

### 2. Two staleness states, two meanings, two treatments

*Stale* means Sightline is behind information it could have ingested — amber, actionable by the pipeline, clears when a recompute demonstrates incorporation. *Predates inactives* means Sightline has no source for a thing it knows exists — neutral, permanent this version, not a failure. Collapsing them would either alarm the user about designed behavior or hide a real lag. When a developer is unsure which treatment a new condition gets, the test is: can the current pipeline clear it? Amber if yes, neutral disclosure if no.

### 3. Currency is a property of the projection, not the scheduler

A green job tile proves a workflow ran; it does not prove the displayed number reflects the world. Age and cutoff attach to the projection wherever it renders, and no health state ever upgrades a projection's displayed currency. The reverse also holds: a failed job never erases or restyles the last completed projection beyond its honest age and staleness.

### 4. Health reflects outcomes, not attempts

The last-success timestamps move only on completed successful runs. A run that started and died does not move them; a successful run that found no new data does. Partial success is shown as partial: per-source for ingest, per-game for recomputation, never one green aggregate over a red detail.

### 5. Quiet in June

An offseason of red warnings trains the admin to ignore the one that matters. Dormant jobs read as `not expected` in neutral tones — while the offseason block still discloses the one thing that can genuinely break in June: the keepalive that keeps next season's schedules alive.

## 3. Information architecture

```text
Sightline
├── Slate                          (shared)  ← rows gain age + two staleness chips
│   ├── Ranked contract list       (shared)
│   ├── Unresolved contracts       (shared list; admin diagnostics)
│   └── Contract detail            (shared)  ← Provenance becomes Currency: age,
│        └── Take / Fade / Skip      (admin)   cutoff, staleness disclosures
├── Health                         (admin only)  ← this pitch replaces the
│                                     Pitch 3 placeholder with live signals
├── Settings                       (shared)
└── Users                          (admin only)
```

No new routes. The slate and contract detail are the Pitch 4 surfaces gaining currency states; Health is the existing admin-only route gaining real content. Accuracy, Backtests, and Decisions remain absent from navigation — they belong to later pitches.

## 4. Visual language

### 4.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.warning.main` / `warning.soft` | The `stale` chip, the `late` and `failed` health states, a required source that failed, an overdue keepalive | Caution only. The loudest thing on the slate is a stale badge — by design. |
| `palette.text.secondary` / `border.strong` | The `predates inactives` chip, `not expected` health states, dormant offseason copy | Neutral disclosure. Deliberately **not** amber: this state is designed behavior, not a fault. |
| `palette.primary.main` | Projection-side values and timestamps' association with the model | Unchanged from Pitch 4. |
| `palette.market.main` | Price values and price timestamps | Unchanged; price age never merges with projection age. |
| `palette.error.main` | Nothing new in this pitch | `failed` health state uses amber caution, not rose — rose stays reserved for negative edge and destructive actions. |

### 4.2 State colours used in this pitch

Exact state names as the data model will carry them; no invented states.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| stale | Amber outlined chip `stale`, warning icon, on the row and detail | Ingestable information exists that the displayed projection predates |
| predates inactives | Neutral outlined chip `predates inactives`, no icon | Game past its inactives-publication point; no inactives source exists this version |
| `ok` | No chip — healthy renders as absence, timestamp only | Health signal inside expected bounds |
| `running` | Neutral outlined chip `running` | A cycle started and has not finished; last success still displayed |
| `late` | Amber outlined chip `late`, warning icon | Last success older than the expected operating window |
| `failed` | Amber outlined chip `failed`, warning icon | Most recent run completed unsuccessfully or incompletely |
| `never run` | Neutral outlined chip `never run` | Implemented, no successful run recorded — honest, not healthy |
| `not expected` | Neutral outlined chip `not expected` | Offseason or outside the scheduled window — distinct from late/broken |
| source `degraded` | Amber word `degraded` in the per-source row | An optional source failed; distinct from a failed required source |

Colour is reinforcement, never the only channel: both staleness chips carry their words, amber states carry the warning icon, and every health state chip carries its label.

### 4.3 Typography

Per the brand system: all timestamps and ages are `numericSm`/`numericMd` with tabular figures. Ages render compactly (`38m`, `6h`, `2d 4h`) and never as vague words ("recently"). No data value is bolded; the staleness chips gain emphasis from tone, not weight.

### 4.4 Appearance

All states are theme-token driven and work in light, dark, and system. The amber `stale` treatment must be checked in both modes against the row's de-emphasised text variant — a stale, below-threshold row keeps `text.secondary` body text with a fully saturated chip, in both modes. Health state chips reuse the same soft-background tokens in both modes.

## 5. Screen specifications

## Screen 1: The Slate (currency delta)

### Purpose

Unchanged from Pitch 4 — rank every upcoming contract by confidence-adjusted edge — with one addition: the reader can now tell, without opening anything, how old each projection is and whether Sightline considers it behind known information.

### URL pattern

`/slate` — same route, same landing behavior.

### Trigger

Sign-in lands here; nav lockup links here.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Slate                                       prices as of 11:42:09 AM ET      │
│ Sun, Nov 8 · 14 games                       [Refresh prices]                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ (banner region — Kalshi refresh outcomes only, unchanged from Pitch 4)       │
├──────────────────────────────────────────────────────────────────────────────┤
│   PLAYER / CONTRACT              GAME · KICKOFF   MODEL  ASK   EDGE    CONF  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▎ Ja'Marr Chase · rec yds ≥ 74.5 CIN@BAL · 1:00p  61.4%  54¢  ▲+7.4  high   │
│   recommended · [took] · ⚠ stale · predates inactives                        │
│   proj Thu 9:12a (2d 4h) · price 11:42a (0m)                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▎ Jahmyr Gibbs · rush yds ≥ 54.5 DET@GB · 4:25p   63.0%  57¢  ▲+6.0  high   │
│   recommended                    proj Sun 7:05a (4h) · price 11:42a (0m)     │
├──────────────────────────────────────────────────────────────────────────────┤
│   Puka Nacua · rec yds ≥ 89.5    LAR@SEA · 4:05p  41.0%  44¢  ▼−3.0  low    │
│                                  proj Sun 7:05a (4h) · price 11:41a (1m)     │
├──────────────────────────────────────────────────────────────────────────────┤
│   Tucker Kraft · rec yds ≥ 40.5  DET@GB · 4:25p    —     38¢    —      —    │
│   no projection                  price 11:42a (0m)                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

The Chase row shows the maximal chip load: recommendation, disposition (admin), `stale`, `predates inactives`. Row height is unchanged and identical across variants — the chip line already exists in the Pitch 4 row anatomy; chips wrap within it at narrow widths without changing row height relative to other two-line rows at that breakpoint. Per-game scoping is inherent: the 1:00p CIN@BAL row carries staleness; the 4:25p DET@GB rows do not.

### Layout — `xs`

```text
┌────────────────────────────────────────────┐
│ Slate · Sun Nov 8         prices 11:42a ⟳ │
├────────────────────────────────────────────┤
│ ▎Ja'Marr Chase · rec yds ≥ 74.5   CIN@BAL │
│  61.4% · 54¢ · ▲+7.4 · high    1:00p [took]│
│  ⚠ stale · predates inactives · proj 2d 4h │
├────────────────────────────────────────────┤
│ ▎Jahmyr Gibbs · rush yds ≥ 54.5   DET@GB  │
│  63.0% · 57¢ · ▲+6.0 · high        4:25p  │
│  proj 4h · price 0m                        │
└────────────────────────────────────────────┘
```

At `xs` the timestamps line compresses to ages only (`proj 2d 4h`); the absolute computed-at time lives on the detail view. Staleness chips are never dropped at any width — if anything else must yield space, the chips stay.

### Component sections (delta over Pitch 4)

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Stale chip** | `StatusChip` label `stale`, tone caution, icon | Present when the game's clearable-stale condition holds; both roles; list-visible always |
| **Predates-inactives chip** | `StatusChip` label `predates inactives`, tone neutral | Present when the game is past its inactives-publication point; both roles; never amber, never iconed |
| **Timestamps line** | `RelativeTimestamp` gains age suffix: `proj Thu 9:12a (2d 4h)` / `price 11:42a (0m)` | Ages update on render and on the existing background poll; no per-second ticking, no countdowns |
| **No-projection rows** | Unchanged | A missing projection has no age and carries neither staleness chip — `no projection` is a different state and keeps its Pitch 4 treatment |

### Code reference

```tsx
{/* chip line of a resolved slate row — order fixed: recommendation,
    disposition (admin), staleness states, then timestamps */}
<Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: 0.5, flexWrap: "wrap" }}>
  {row.isRecommended ? <StatusChip label={`recommended · ${row.side}`} tone="accent" /> : null}
  {row.currentDisposition ? <DispositionChip disposition={row.currentDisposition} /> : null}
  {row.staleness.isStale ? <StatusChip label="stale" tone="caution" icon /> : null}
  {row.staleness.predatesInactives ? <StatusChip label="predates inactives" tone="neutral" /> : null}
  <RowTimestamps
    projectionComputedAt={row.projectionComputedAt}
    projectionAge={row.projectionAge}
    priceObservedAt={row.priceObservedAt}
    priceAge={row.priceAge}
  />
</Stack>
```

### Fields

Not a form screen; no new inputs. Sort order is unchanged — staleness does not re-rank the slate. A stale recommended contract remains ranked exactly where its confidence-adjusted edge puts it, wearing its chip there.

### Validation

None client-side; unchanged.

### Empty state

Unchanged from Pitch 4 (four designed empties). Staleness chips cannot appear in an empty slate; no new empty variant exists.

### Loading state

Unchanged: skeleton rows at exact final height. Staleness state arrives with the row payload — chips never pop in after render.

### Error state

Unchanged. Staleness computation failing server-side is a slate read failure, not a per-row state — the row never renders with silently missing staleness.

### Behavior

- Both chips derive from server-computed state delivered with the slate payload; the client never computes staleness from clock math.
- The existing background poll refreshes prices; when a poll response carries updated projection state (a recompute landed while the slate was open), rows update in place — the stale chip clears without a page reload, the same way price cells update. No animation, no highlight flash.
- Ages displayed are as-of the last successful data refresh; the page never fakes a live-ticking age.
- Viewer payloads carry identical currency and staleness state — this is shared disclosure, per settled decision 4.

## Screen 2: Contract detail (currency delta)

### Purpose

Unchanged — expose the full reasoning behind one contract — with the provenance block promoted to a Currency block that states age, cutoff, and exactly what the projection did and did not include.

### URL pattern

`/slate/[contractId]` — unchanged; drawer at `xs`/`sm`, side panel at `md+`.

### Trigger

Slate row click; deep link.

### Layout — `md+` (currency block detail; other sections unchanged from Pitch 4)

```text
┌──────────────────────────────────────────────────┐
│ Ja'Marr Chase · CIN @ BAL · Sun 1:00p ET     [×] │
│ receiving yards ≥ 74.5   recommended  ⚠ stale    │
│                          predates inactives      │
├──────────────────────────────────────────────────┤
│ … comparison / projection / drivers / market …   │
├──────────────────────────────────────────────────┤
│ Currency                                         │
│   computed  Thu 9:12 AM ET   (2d 4h ago)         │
│   information cutoff  Thu 9:00 AM ET             │
│   model baseline-v1.2                            │
│                                                  │
│   ⚠ stale — information Sightline can ingest     │
│   has arrived for this game since this           │
│   projection was computed. A scheduled           │
│   recompute clears this when the cutoff          │
│   reflects it.                                   │
│                                                  │
│   predates inactives — official inactives for    │
│   this game are expected as of Sun 11:30 AM ET.  │
│   Sightline has no inactives source in this      │
│   version; this projection was computed before   │
│   them.                                          │
├──────────────────────────────────────────────────┤
│ Decision                       (admin only)      │
│   [ Take ]   [ Fade ]   [ Skip ]                 │
└──────────────────────────────────────────────────┘
```

### Component sections (delta over Pitch 4)

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header staleness chips** | Same `StatusChip` pair as the row | Chips in the header, beside/below `recommended`; wrap at drawer width |
| **Currency block** | Renamed from Provenance; `numericSm`/`numericMd` values, `caption` explanatory sentences | Computed-at with age in parentheses; information cutoff; model version. Explanatory sentence per active staleness state, in the state's tone colour for its lead word only — body text stays `text.secondary` |
| **Stale explanation** | `caption`, amber lead word `stale` | Names the mechanism that clears it (a recompute reflecting the information) without promising a time |
| **Predates-inactives explanation** | `caption`, neutral lead word | States the expected inactives time for this game (from its kickoff) and that no inactives source exists this version — a statement of what Sightline does not know, not an error |

### Fields

Unchanged — the decision control is untouched by this pitch. A decision on a stale contract is legal and unremarked; the snapshot already captures the projection's cutoff, so the record is honest without any extra ceremony.

### Validation

Unchanged.

### Empty / variant states

- **No projection:** the Currency block is absent along with the projection sections (nothing to date). Staleness chips do not render — they qualify a projection, and there is none. Unchanged `no projection` treatment.
- **No price / Kalshi degraded:** unchanged; price age and projection age remain independently displayed.
- **Unresolved contract:** unchanged (Screen 3 of the Pitch 4 design); no staleness states — resolution failure is a different condition from projection staleness and keeps its own treatment.

### Loading state

Unchanged skeletons; the Currency block renders from the same read as the projection sections.

### Error state

Unchanged.

### Behavior

- Chips and the Currency block reflect the same server-computed staleness state the slate row showed — the two surfaces can never disagree, because neither computes locally.
- When a recompute lands while the detail is open, the existing poll updates the payload: the stale chip clears, computed-at and cutoff advance, and the explanation disappears. No notification — the timestamps changing is the feedback.

## Screen 3: Pipeline health (admin only)

### Purpose

Let the admin verify in one glance that the three scheduled job categories are operating inside their expected windows — and when they are not, see which one, how it failed, and what portion completed — without leaving the product or reading CI logs.

### URL pattern

`/health` — existing admin-only route; this pitch replaces the Pitch 3 placeholder content.

### Trigger

Health item in admin navigation.

### Layout — `md` and above, in season, mixed states

```text
┌──────────────────────────────────────────────────────────────────┐
│ System health                                                    │
├──────────────────────────────────────────────────────────────────┤
│ Ingest                                              ⚠ failed     │
│   last successful run   Sun 6:02 AM ET   (5h 40m ago)            │
│   expected within       24h of last                              │
│   last attempt          Sun 11:00 AM ET · failed                 │
│   ┌────────────────────────────────────────────────────────┐     │
│   │ sources — latest cycle                                 │     │
│   │   schedule            ok      Sun 11:02a               │     │
│   │   weekly stats        ok      Sun 11:02a               │     │
│   │   injuries            failed  Sun 11:03a   required    │     │
│   │   weather             degraded Sun 11:03a  optional    │     │
│   └────────────────────────────────────────────────────────┘     │
├──────────────────────────────────────────────────────────────────┤
│ Projection recomputation                            ⚠ late       │
│   last successful cycle  Sun 7:05 AM ET   (4h 37m ago)           │
│   expected within        90m before each kickoff window          │
│   ┌────────────────────────────────────────────────────────┐     │
│   │ games — current slate                                  │     │
│   │   12 of 14 games current                               │     │
│   │   CIN @ BAL   1:00p   ⚠ not recomputed this cycle      │     │
│   │   MIA @ NYJ   1:00p   ⚠ not recomputed this cycle      │     │
│   └────────────────────────────────────────────────────────┘     │
├──────────────────────────────────────────────────────────────────┤
│ Price refresh                                        (ok)        │
│   last successful run    Sun 11:42 AM ET  (0m ago)               │
│   expected within        15m while games are upcoming            │
└──────────────────────────────────────────────────────────────────┘
```

Healthy signals show no chip — absence of caution is the healthy state, per the existing `HealthStateChip` behavior. The per-source and per-game detail blocks render only when they carry information (a failure, a degraded source, an incomplete cycle); a fully green cycle collapses to the three summary lines.

### Layout — offseason (`not expected`)

```text
┌──────────────────────────────────────────────────────────────────┐
│ System health                                                    │
├──────────────────────────────────────────────────────────────────┤
│ Offseason. Scheduled jobs resume with the season schedule.       │
│                                                                  │
│ Ingest                     not expected                          │
│   last successful run      Feb 8, 6:02 AM ET  (4mo ago)          │
│ Projection recomputation   not expected                          │
│   last successful cycle    Feb 8, 7:05 AM ET  (4mo ago)          │
│ Price refresh              not expected                          │
│   last successful run      Feb 8, 11:58 PM ET (4mo ago)          │
├──────────────────────────────────────────────────────────────────┤
│ Offseason readiness                                              │
│   keepalive last acted     Jun 12  (19d ago)                     │
│   next required by         Aug 10                                │
└──────────────────────────────────────────────────────────────────┘
```

Neutral tones throughout; old timestamps under `not expected` are not amber — they are correct. The readiness block turns amber on exactly one condition: the keepalive's next required action date has passed without action. Copy: `⚠ keepalive overdue — scheduled workflows may be disabled before the season resumes.`

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Signal block** | Existing `Paper` + `List` structure; label `body1`, `HealthStateChip`, rows of label/`NumericText` pairs | Three blocks, fixed order: Ingest, Projection recomputation, Price refresh. Each shows last successful run + age, expected window, and last attempt with its outcome when it differs from last success |
| **State chip** | `HealthStateChip` extended to the six states | `ok` renders nothing; `running`/`never run`/`not expected` neutral; `late`/`failed` amber with icon |
| **Per-source detail** | Nested bordered block, one row per source: name, state word, timestamp, `required`/`optional` qualifier in `caption` | Renders only when any source is not ok. A failed required source makes the parent signal `failed`; a degraded optional source alone leaves the parent `ok` with the detail block visible |
| **Per-game detail** | Nested bordered block: completeness line (`12 of 14 games current`), then one row per lagging game: matchup, kickoff, reason | Renders only when a cycle is incomplete. Names games, never players — per-contract currency lives on the slate |
| **Offseason block** | `body2` line + the three signals in `not expected` | Replaces expected-window rows with dormant copy |
| **Offseason readiness** | Separate block: keepalive last-acted + age, next-required-by date | Amber only when overdue; otherwise neutral |

### Code reference

```tsx
<ListItem sx={{ display: "block", py: 2.5, px: 2 }}>
  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
    <Typography variant="body1">Ingest</Typography>
    <HealthStateChip state={signal.state} /> {/* renders nothing when ok */}
  </Stack>
  <Row label="Last successful run" value={signal.lastSuccessAt} age={signal.lastSuccessAge} />
  <Row label="Expected within" value={signal.expectedWithin} />
  {signal.lastAttemptAt !== signal.lastSuccessAt ? (
    <Row label="Last attempt" value={`${signal.lastAttemptAt} · ${signal.lastAttemptOutcome}`} />
  ) : null}
  {signal.sources?.some((s) => s.state !== "ok") ? <SourceDetail sources={signal.sources} /> : null}
</ListItem>
```

### Fields

None. The screen has no inputs, no mutations, and no confirmation flows — settled decision 6.

### Empty state

`never run` is the designed empty: a signal with no successful run displays `—` for last success with the `never run` chip, per the existing pattern (an em dash, never a fabricated timestamp). This state renders as honest, not healthy, and not alarmed — a fresh environment before the first scheduled run is expected to look exactly like this.

### Loading state

The existing `/health` loading skeleton: three blocks at final height. Values read on request; no polling, no countdown, no auto-refresh — the admin reloads for fresh state, which is honest about the read's own currency (the page states values as-of load time implicitly through its ages).

### Error state

The existing `/health` error boundary: if the health read itself fails, a plain error with retry. A failed health read must never render as three healthy signals — failure to know is displayed as failure to know.

### Behavior

- Every state derives from completed-run records server-side; the page performs no clock arithmetic beyond formatting ages at read time.
- `running` shows the in-flight attempt alongside the last success — a running cycle never hides or replaces the last completed state.
- A successful run that wrote nothing because no new data existed reads as `ok` with its timestamp — empty success is success.
- The screen carries no links to GitHub Actions, no log excerpts, no stack traces, and no credentials or connection detail in any state, including errors.

## 6. Navigation flows

```text
/slate ──row──→ /slate/[contractId] ──Esc/×──→ /slate   (unchanged)
   │                                            (chips update in place on poll)
   └── (admin nav) ──→ /health  — read, reload, leave; no onward flows
```

- No new navigation. Staleness chips are not links; the explanation lives on the contract detail the row already opens.
- Health is reachable in two taps from anywhere (nav → Health), per the brand system's requirement for this screen.
- A viewer deep-linking `/health` is rejected server-side, unchanged from the existing gating; no partial shell renders first.

## 7. Interaction specifications

### Keyboard navigation

Unchanged from Pitch 4 — this pitch adds no interactive controls. The health screen is fully readable by keyboard scroll; its only focusable elements are the shell's navigation.

### Loading states

Slate: staleness arrives with row data — no chip pop-in. Detail: Currency block loads with the projection sections. Health: skeleton blocks at final height.

### Error states

No new error surfaces. A staleness-evaluation failure is a slate/detail read failure (existing treatment); a health-read failure is the existing `/health` error boundary.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Stale chip clears after a recompute lands | none — the chip clearing and timestamps advancing are the feedback | — | — |
| Projection updates while detail is open | none — same rule | — | — |
| Any health state change | none — health is a read surface with no push | — | — |

No toast, snackbar, or badge anywhere in this pitch. Currency information is ambient, not evented.

### Destructive actions

None. This pitch adds no mutations of any kind.

## 8. Responsive behavior

| Breakpoint | Slate | Contract detail | Health |
| ---------- | ----- | --------------- | ------ |
| `xs` 0–599 | Chip line wraps below the numeric line; timestamps compress to ages (`proj 2d 4h`); chips never dropped | Chips wrap in the drawer header; Currency block stacks label-over-value | Blocks stack full-width; per-source and per-game rows stay single-line (name + state word + short time); ages in parentheses drop first if space demands |
| `sm` 600–899 | One-line rows return; full timestamps return | Drawer persists | Same as `xs` with wider gutters |
| `md` 900–1199 | Side-panel layout unchanged | Panel unchanged | Label/value rows align two-column |
| `lg`+ | Unchanged | Unchanged | Content max-width; blocks do not stretch |

Nothing horizontally scrolls at any breakpoint. Row height parity across all slate variants holds at every width — the chip line is part of the fixed row anatomy, not an expansion.

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `StatusChip` | Slate, detail | reused | Two new usages: `stale` (caution, icon), `predates inactives` (neutral). No new chip component |
| `RowTimestamps` | Slate | extended | Gains age suffixes for both timestamps; `xs` compression to ages-only |
| `RelativeTimestamp` | Slate, detail | extended | Age formatting (`38m`, `6h`, `2d 4h`); absolute on hover/focus unchanged |
| `CurrencyBlock` | Contract detail | new (renames Provenance block) | Computed-at + age, cutoff, model version, per-state explanatory sentences |
| `HealthStateChip` | Health | extended | Six states: `ok` (renders nothing), `running`, `late`, `failed`, `never run`, `not expected`; `not_yet_implemented` retires with this pitch |
| `HealthSignalBlock` | Health | new | Signal summary rows + conditional nested detail |
| `SourceDetail` | Health | new | Per-source rows with required/optional qualifier |
| `GameCompleteness` | Health | new | `N of M games current` + lagging-game rows |
| `OffseasonReadiness` | Health | new | Keepalive last-acted, next-required-by, single overdue caution |

## 10. Accessibility, privacy, and data sensitivity

- Neither staleness state relies on colour alone: both chips carry their words; `stale` additionally carries the warning icon. Screen-reader text for the pair on a row: `stale — projection predates ingestable information` / `predates inactives`.
- Health state chips carry their words; amber states carry the icon. The per-game block's completeness line (`12 of 14 games current`) is a sentence, readable without the row list.
- Ages are rendered text, not live regions — no screen-reader chatter from passing time. When a poll updates a row's staleness, the change is announced only if the row has focus.
- **Operational health is admin-only and structurally absent for viewers:** no nav item, no route access (server-rejected), no payload fields, no reference to health from any shared surface. Currency and staleness on the slate are shared by design and carry no operational detail — a viewer sees that a projection is stale, never why a job failed.
- The health surface exposes no credentials, connection strings, workflow names, log excerpts, or stack traces in any state, including its error state. Failure reasons are category-level (`failed`, source name + state), never raw output.
- No weather data is displayed by this pitch's surfaces; the Open-Meteo attribution requirement does not attach here. (Weather appears only as a source name on the admin health screen, which displays no weather data itself.)

## 11. Out of scope

**Deferred to a later pitch — design must not preclude:**

- An inactives source, and with it the conversion of *predates inactives* from a permanent disclosure into a clearable state (Adjustment Suggestions). The chip's neutral treatment and the detail explanation are written so that pitch changes the copy and clearing rule without changing the surface.
- Suggestion display on stale contracts (Adjustment Suggestions).
- Grading, timing cost, and any interpretation of the final pre-kickoff snapshot this pitch's pipeline captures (Outcome Scoring & Accuracy Surface). No UI exists for the snapshot itself.
- Acting on staleness — autonomous execution declining stale projections (Autonomous Execution & Circuit Breakers).
- Any admin retry, run-now, or scheduling control on health. If a later pitch adds an operations affordance, it is a new decision, not an extension of this screen.

**Permanent non-goals — never:**

- A public status page; outbound failure notifications (email, SMS, push, Slack); detailed scheduler logs, traces, or CI administration in the product; user-configurable cron expressions or job creation; a workflow-control console; sportsbook/DFS surfaces; viewers trading through Sightline.
