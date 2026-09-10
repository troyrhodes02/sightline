# Adjustment Suggestions & Source Reliability — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Adjustment Suggestions & Source Reliability
**Focus:** How late-breaking ESPN inactives reach William as a reviewable proposed change to a projection, how he accepts or declines it in one action, how viewers see the effect of an accepted change, and how the private reliability surface reports — separately — whether the source was right and whether reacting to it helped.

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

---

## 1. Vision

Twenty minutes before the early window, ESPN reports a starting receiver inactive. Sightline already computed today's slate assuming he plays. This feature is how that late fact reaches William without an unproven feed silently rewriting the numbers his bot trades on: Sightline computes what the projection *would* be, shows him plainly what changed and why, and lets him accept or decline in one tap. Every such proposal is graded later whether he acted on it or not, so a private surface can eventually answer two different questions — *was ESPN right?* and *when it was right, did reacting help?* — without ever collapsing them into one flattering number.

**North star: a proposal the operator can trust because the instrument refuses to trust it for him.**

---

## 2. Design principles

### 1. The proposal is visible; the trust is manual

A suggestion is a *proposal*, never an applied fact until William says so. The pending state must read as "there is unresolved late information here," never as an ordinary current projection and never as a change that already happened. Nothing in the interface auto-accepts, counts down to acceptance, or nudges toward it.

### 2. Two questions, two numbers, never one

Source Accuracy (was the claim factually right?) and Adjustment Accuracy (did reacting improve the forecast?) are distinct figures on distinct rows with distinct denominators. There is no combined "reliability score," no single percentage, no summary card that picks one. A surface that blends them has destroyed the entire reason the feature exists.

### 3. Small samples look small

Neither rate shows a numeric percentage below its minimum sample. `3 of 3` is shown as a count with an explicit "not enough evidence yet" treatment, never as `100.0%`. The count travels with every rate, always, exactly as sample size travels with every accuracy figure elsewhere in Sightline.

### 4. Base and shadow are both real, and both graded

The base projection and the shadow-adjusted projection both exist and are both graded, regardless of what William clicked. The UI never implies that declining discards the shadow, that accepting destroys the base, or that grading follows William's choice. History can always show both sides.

### 5. Uncertainty and provenance travel with the number

A proposed value carries its proposed interval and proposed confidence in the same glance — a suggestion that moves the number without showing what it does to the range and confidence is incomplete. Every reason line names its source ("via ESPN") so a changed projection is never mistaken for the model changing its mind.

---

## 3. Visual language

### 3.1 Palette used by this feature

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | The proposed (shadow-adjusted) projected value, interval, threshold-probability, and confidence; the "accepted" state | Model accent. The adjustment is model-derived, so it wears the model accent. |
| `palette.text.secondary` / `palette.text.muted` | The base projection shown alongside a proposal (the "from" value); declined/superseded states | The prior value is present but de-emphasised against the proposal. |
| `palette.warning.main` | Pending suggestion badge; conflicting-reports state; insufficient-sample treatment; post-kickoff non-actionable flag | Caution and unresolved-information only. Never "bad." |
| `palette.error.main` | A proposal that *lowers* a projection (negative delta), and only as sign+glyph reinforcement | Direction is carried by sign and arrow first, colour second. |
| `palette.market.main` | Never used by suggestion values | Suggestions are model-derived; no suggestion value may wear the market accent. |

### 3.2 State colours used in this pitch

Suggestion status enum values are the exact data-model values — do not invent names.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| `pending` | Warning tone, outlined chip, list-visible (admin only) | Suggestion awaiting William; contract's affected projection may not be current |
| `accepted` | Model accent, outlined chip | Adjustment applied to the displayed projection |
| `declined` | Neutral, outlined chip | Not applied; shadow still stored and graded |
| `superseded` | Neutral/muted, outlined, "reversed" or "updated" label | An earlier suggestion replaced by a newer event on the same `(source, player, claim type)` identity |
| `conflicting` | Warning tone, names both claims | Two contradictory unconfirmed events within the conflict window; neither treated as current |
| `post_kickoff` | Warning tone, "after kickoff — not applied" label | Retained for source grading; never edits the frozen pre-game record |
| `insufficient_evidence` | Warning tone, "can't estimate a change" | Source claim valid but the model declines a numeric adjustment (evidence floor) |

- Colour is always reinforced by text and, for value deltas, by an explicit sign and arrow glyph (`↑` / `↓`), so the encoding survives greyscale.
- `pending`, `conflicting`, `post_kickoff`, and `insufficient_evidence` are all warning-toned but each carries distinct text — they are not interchangeable.

### 3.3 Typography

Per `sightline-ui-design`: every computed numeric (projected value, interval bounds, threshold probability, reliability rates, sample counts) uses the monospace family with tabular figures. No data value is bolded to signal importance. Reason sentences are body text, not monospace. Reliability percentages and their `n of m` counts are monospace so columns of them align.

### 3.4 Appearance

Every surface is theme-aware (light / dark / system) through theme tokens. The reliability charts follow the accuracy surface's existing pattern — colours read from `theme.palette` via `useTheme()`, never hardcoded. The pending/warning treatments use `palette.warning.main` and its `soft` background in both modes; note in the reliability chart that the two accuracy series must remain distinguishable in dark mode by shape as well as hue.

---

## 4. Information architecture

```text
Sightline
├── Slate                          (shared)   ← default landing
│   └── Contract detail            (shared)   ← drawer on mobile, page on desktop
│         ├── Pending suggestion panel        (ADMIN ONLY) accept / decline
│         └── "Adjusted after …" reason line  (shared, only when accepted)
├── Accuracy                       (shared)
│   └── Overrides                  (admin only)
├── Autonomy                       (admin only)
├── Suggestions                    (ADMIN ONLY)  ← new top-level section, one nav entry
│   ├── Pending                    ← the accept/decline queue (default tab)
│   ├── History                    ← every suggestion raised, with base/adjusted/outcome
│   └── Reliability                ← Source Accuracy + Adjustment Accuracy, per source, sample-gated
├── Health                         (shared)      ← ESPN source freshness/outage row added here
├── Settings                       (shared)
└── Users                          (admin only)
```

- **Suggestions** is a single admin-only nav entry, revealed by role, rejected server-side at every route regardless of nav — matching how Autonomy already behaves. Internals are a secondary tab row (`Pending | History | Reliability`), not three peers of the Slate.
- Nothing here is a viewer surface. The only viewer-facing effect of this feature is the accepted-adjustment reason line on the shared slate/contract-detail surfaces.
- The Slate remains the default landing surface; Suggestions is secondary to it.

---

## 5. Screen specifications

## Screen 1: Contract detail — pending suggestion panel (admin)

### Purpose
Let William understand, in one glance, what ESPN reported, what Sightline proposes changing to this projection, and accept or decline it in one action — without leaving the contract.

### URL pattern
`/slate/[contractId]` (existing route; a new panel appears when a pending suggestion targets this projection). Deep-link `?suggestion=<id>` scrolls to and focuses the panel.

### Trigger
Opening a contract whose current projection has a pending (or conflicting / insufficient-evidence) suggestion against it. Admin only — the panel is absent for viewers, not disabled.

### Layout — `md` and above

```text
┌───────────────────────────────────────────────────────────────┐
│ ← Slate      Ja'Marr Chase · CIN · rec yds ≥ 74.5     ●REC     │
│ Cincinnati @ Baltimore · Sun 1:00p ET                          │
├───────────────────────────────────────────────────────────────┤
│ ⚠ PENDING SUGGESTION · via ESPN · 11:38a                       │
│                                                                │
│ ESPN reports Tee Higgins inactive. Sightline estimates         │
│ Chase's receiving usage rises, moving this projection:         │
│                                                                │
│            base            →   proposed                        │
│  value     58.1  yds           67.4  yds   ↑ +9.3              │
│  range     41 – 78             48 – 91     wider               │
│  P(≥74.5)  41.0 %              53.8 %      ↑ +12.8 pp          │
│  conf      medium              medium                          │
│                                                                │
│  Drivers (proposed):                                           │
│   • Higgins out → Chase target share 27% → 34%                 │
│   • Vacated air yards redistributed to WR1                     │
│                                                                │
│        [ Accept ]   [ Decline ]      material · +12.8 pp       │
├───────────────────────────────────────────────────────────────┤
│ (base projection distribution, drivers, prices, provenance …)  │
└───────────────────────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Panel container | `Paper` variant outlined, `borderColor: warning.main`, `bgcolor: warning.soft` | Only rendered for admin; absent for viewers |
| Status line | `Chip` (warning, outlined) + source + `formatAge` timestamp | "PENDING", "CONFLICTING", "AFTER KICKOFF", or "CAN'T ESTIMATE" per state |
| Reason sentence | `Typography variant="body2"` | Plain language, generated server-side from actual model state; never browser-invented |
| base→proposed table | `Table` dense; base column `text.secondary`, proposed column `primary.main`, delta with sign+arrow | Value, range, threshold-probability, confidence rows |
| Proposed drivers | `List` dense | The shadow projection's own drivers, not the base's |
| Accept / Decline | two `Button`s, equal weight; neither visually dominant | One action each; POST to route handler; optimistic in-place update |
| Materiality note | `Typography variant="caption" color="text.muted"` | e.g. `material · +12.8 pp` or `material · +10% proj (no listed contract)` |

### Code reference
```tsx
{isAdmin && suggestion?.status === "pending" && (
  <Paper variant="outlined" sx={{ borderColor: "warning.main", bgcolor: "warning.soft", p: 2 }}>
    <Stack direction="row" spacing={1} alignItems="center">
      <Chip label="Pending" color="warning" variant="outlined" size="small" />
      <Typography variant="caption" color="text.secondary">
        via {suggestion.sourceLabel} · {formatAge(suggestion.raisedAt, now)}
      </Typography>
    </Stack>
    <Typography variant="body2" sx={{ mt: 1 }}>{suggestion.reason}</Typography>
    <ProposedChangeTable base={suggestion.base} proposed={suggestion.proposed} />
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      <Button onClick={onAccept}>Accept</Button>
      <Button onClick={onDecline} color="inherit">Decline</Button>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.muted">{suggestion.materialityLabel}</Typography>
    </Stack>
  </Paper>
)}
```

### Fields
| Field | Type | Notes |
| ----- | ---- | ----- |
| suggestion.status | enum | pending / accepted / declined / superseded / conflicting / post_kickoff / insufficient_evidence |
| suggestion.reason | string | Server-generated, plain language |
| base / proposed | projection summaries | value, interval, thresholdProbability, confidence |
| materialityLabel | string | pp delta on listed contract, or relative % on projected value |

### Validation
- Accept/Decline buttons are enabled only while `status === "pending"`. On a `conflicting` or `post_kickoff` state, no Accept/Decline is offered (see Behavior).
- The action carries only the suggestion id; the server reads all snapshot state itself and never trusts client-supplied numbers.
- If the game passes actual kickoff while the panel is open, the buttons disable and the panel switches to the post-kickoff treatment on next read.

### Empty state
No pending suggestion → the panel is simply absent (not an empty box). If a suggestion was previously accepted, the reason line (Screen 4) shows instead.

### Loading state
Contract detail renders from stored projection data immediately; the suggestion panel renders with it (same read). No spinner — the suggestion is part of the detail payload, not a separate fetch.

### Error state
Accept/Decline failure → inline `Alert severity="error"` inside the panel: `Couldn't apply — try again.` The buttons re-enable; no navigation; the base projection remains active (safe default). A suggestion already resolved by another session (409) → the panel refreshes to the resolved state with an info note, rather than erroring.

### Behavior
- **Accept** → adjusted projection becomes the active displayed projection in place; panel collapses to the accepted reason line; toast `Projection updated`. Downstream edge/recommendation reflect the new active projection on next read.
- **Decline** → base stays active; panel collapses to a muted "declined" note; toast `Suggestion declined`. Shadow remains stored and graded.
- **Conflicting** → no accept/decline; panel names both claims ("ESPN reported OUT 11:32a, then ACTIVE 11:35a — unconfirmed") and states Sightline is treating neither as current. Resolves when a stable confirmed event arrives.
- **Insufficient evidence** → no numeric proposal; panel states "ESPN reports X inactive; Sightline can't defensibly estimate the redistribution (too little history for the inheriting player). This contract is held out of autonomous trading." No Accept.
- **After kickoff** → panel shows the claim, flags it non-actionable, states the pre-game record is frozen; retained for source grading only.
- Focus moves to the panel heading on deep-link; Accept/Decline reachable by keyboard.

---

## Screen 2: Slate row — pending marker (admin)

### Purpose
Tell William at a glance, while scanning the slate, which contracts have unresolved late information he hasn't acted on — without opening each detail view.

### URL pattern
`/slate` (existing).

### Trigger
A slate read where an affected contract has a pending/conflicting/insufficient-evidence suggestion. Admin only; viewers never see the pending marker.

### Layout — `xs`

```text
┌────────────────────────────────────────────┐
│ Ja'Marr Chase  CIN · rec yds ≥ 74.5   ●REC │
│ model 41.0%  mkt 44¢  edge −3.0  conf md    │
│ ⚠ suggestion pending · via ESPN             │  ← admin only
├────────────────────────────────────────────┤
│ Tee Higgins    CIN · rec yds ≥ 49.5  ⚠HELD  │  ← insufficient evidence
│ model 52.2%  mkt 50¢  edge +2.2  conf lo    │
└────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Pending marker | third line, `Chip` size small warning outlined, or inline `⚠ suggestion pending` text | Admin only; row height unchanged for viewers |
| HELD badge | `Chip` warning, "HELD" | Insufficient-evidence contract blocked from autonomous trading |

- Row height must remain identical to a non-flagged row for viewers (the marker line is admin-only and does not exist in the viewer payload). For the admin, the marker occupies the existing third metadata line rather than adding height where possible.

### Empty / loading / error states
Inherit the slate's existing states. A pending marker never turns a populated slate into an empty one. If the suggestion read fails, the slate still renders projections and prices; the marker is simply omitted (fail-open to the honest base view), and Health surfaces the ESPN source problem.

### Behavior
The marker is a disclosure, not a link target of its own; tapping the row opens contract detail where Accept/Decline lives. The pending marker coexists with the existing stale/predates-inactives badges — a contract can be both stale and have a pending suggestion.

---

## Screen 3: Suggestions — Pending tab (admin)

### Purpose
A single queue of everything awaiting William's decision, so he can clear late information across the whole slate without hunting contract by contract.

### URL pattern
`/suggestions` (default tab) — admin only, rejected server-side for viewers.

### Layout — `md` and above

```text
┌───────────────────────────────────────────────────────────────┐
│ Suggestions          [ Pending ]  History   Reliability        │
├───────────────────────────────────────────────────────────────┤
│ 3 pending · 1 conflicting · 1 held                             │
├───────────────────────────────────────────────────────────────┤
│ Ja'Marr Chase · rec yds ≥ 74.5   CIN@BAL 1:00p                 │
│ ESPN: Tee Higgins OUT · 11:38a                                 │
│ P(≥74.5) 41.0% → 53.8%  ↑+12.8pp     [Accept] [Decline] [Open] │
├───────────────────────────────────────────────────────────────┤
│ Chase Brown · rush yds ≥ 46.5    CIN@BAL 1:00p                 │
│ ESPN: Zack Moss OUT · 11:38a                                   │
│ P(≥46.5) 49.1% → 58.0%  ↑+8.9pp      [Accept] [Decline] [Open] │
├───────────────────────────────────────────────────────────────┤
│ ⚠ CONFLICTING · Puka Nacua · LAR                               │
│ ESPN reported OUT 11:32a, then ACTIVE 11:35a — unconfirmed     │
│ Neither treated as current.                            [Open]  │
├───────────────────────────────────────────────────────────────┤
│ ⚠ HELD · Tee Higgins · rec yds ≥ 49.5                          │
│ Can't estimate redistribution — inheriting player has too      │
│ little history. Held out of autonomous trading.        [Open]  │
└───────────────────────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Secondary tab row | `Tabs` | Pending / History / Reliability |
| Summary counts | `Typography` + warning tones | pending / conflicting / held counts |
| Suggestion card | `Paper` outlined per row | Player, contract, source claim, threshold-prob delta, actions |
| Accept / Decline / Open | `Button`s | Accept/Decline act in place; Open goes to contract detail |

### Empty state
```text
┌───────────────────────────────────────────────────────────────┐
│ Suggestions          [ Pending ]  History   Reliability        │
├───────────────────────────────────────────────────────────────┤
│   Nothing pending.                                             │
│   ESPN inactives last checked 11:42a — no material changes.    │
└───────────────────────────────────────────────────────────────┘
```
This is the common state and reads as a designed answer, showing last-checked time so "nothing pending" is distinguishable from "not checked."

### Loading state
`Skeleton` cards matching card height. No spinner.

### Error state
If the suggestions read fails: `Alert severity="warning"` — `Couldn't load pending suggestions. The slate is unaffected.` with retry. If ESPN is unavailable, a top `Alert severity="info"` explains suggestions are paused and affected games show as stale (links to Health).

### Behavior
Accept/Decline update the card in place and decrement the count; the card animates out. Bulk actions are **not** offered — each suggestion is a deliberate one-action decision. Keyboard: `↑`/`↓` between cards, `A`/`D` accept/decline the focused card, `Enter` opens it.

---

## Screen 4: Contract detail / slate — accepted-adjustment reason (shared, viewers included)

### Purpose
Tell everyone — William and viewers alike — *why* a shared projection changed, so a jump from 58 to 67 yards never looks like the model randomly changing its mind.

### URL pattern
`/slate` and `/slate/[contractId]` (existing, shared surfaces).

### Trigger
A projection whose active version is an accepted adjustment. Shown to all roles. Pending, declined, superseded, and the accept/decline controls are **never** shown to viewers.

### Layout

```text
┌───────────────────────────────────────────────────────────────┐
│ Ja'Marr Chase · CIN · rec yds ≥ 74.5                           │
│ model 53.8%   conf medium                                      │
│ ✎ Adjusted after Tee Higgins was ruled inactive · via ESPN     │  ← shared
└───────────────────────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Reason line | `Typography variant="caption"`, `primary.main` accent glyph | One line, plain language, names the source |

### Empty / loading / error states
Absent when the active projection is the base (no accepted adjustment). No separate loading/error — it rides on the projection read.

### Behavior
Static disclosure. On a viewer's screen it is read-only context. It reflects the *currently active accepted* adjustment; if William later declines a subsequent suggestion, this line reflects only what is active. The base projection remains queryable/gradable behind the scenes but is not shown to viewers here.

---

## Screen 5: Suggestions — Reliability tab (admin)

### Purpose
Answer, per source, two separate questions with their sample sizes: was the source factually right, and when it was right did reacting improve the projection?

### URL pattern
`/suggestions/reliability` (tab) — admin only.

### Layout — `md` and above

```text
┌───────────────────────────────────────────────────────────────┐
│ Suggestions          Pending   History   [ Reliability ]       │
├───────────────────────────────────────────────────────────────┤
│ Source: ESPN inactives                                         │
│                                                                │
│  ┌─────────────────────────┐   ┌─────────────────────────┐    │
│  │ SOURCE ACCURACY         │   │ ADJUSTMENT ACCURACY     │    │
│  │ was the claim correct?  │   │ did reacting help?      │    │
│  │                         │   │                         │    │
│  │   92.0 %                │   │   61.0 %                │    │
│  │   46 of 50 reports      │   │   19 of 31 gradable     │    │
│  └─────────────────────────┘   └─────────────────────────┘    │
│                                                                │
│  Adjustment breakdown (shadow vs base, 31 gradable):           │
│   improved 19 · hurt 9 · neutral 3                             │
│                                                                │
│  ⓘ Two different measures. A correct report can still lead to  │
│    a worse projection if the redistribution was wrong.         │
├───────────────────────────────────────────────────────────────┤
│ Source: (future sources appear here, each with its own record) │
└───────────────────────────────────────────────────────────────┘
```

### Limited-data state (below the 15-observation minimum)

```text
│  ┌─────────────────────────┐   ┌─────────────────────────┐    │
│  │ SOURCE ACCURACY         │   │ ADJUSTMENT ACCURACY     │    │
│  │ not enough evidence yet │   │ not enough evidence yet │    │
│  │ 3 of 3 reports          │   │ 1 of 2 gradable         │    │
│  └─────────────────────────┘   └─────────────────────────┘    │
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Source group | `Stack` per source, source name heading | Per-source; ESPN is the only one initially |
| Two metric tiles | two `Paper` tiles, never merged into one figure | Left = Source Accuracy, right = Adjustment Accuracy |
| Rate + count | monospace; rate hidden below min sample, count always shown | 15-observation minimum, independent per tile |
| Breakdown | `Typography` improved/hurt/neutral counts | Shadow vs base grading outcomes |
| Explainer | `Alert severity="info"` | States the two are different measures |

### Code reference
```tsx
<Stack direction={{ xs: "column", md: "row" }} spacing={2}>
  <ReliabilityTile
    title="Source accuracy" caption="was the claim correct?"
    numerator={s.sourceCorrect} denominator={s.sourceVerifiable}
    minSample={RELIABILITY_MIN_SAMPLE} />
  <ReliabilityTile
    title="Adjustment accuracy" caption="did reacting help?"
    numerator={s.adjustmentImproved} denominator={s.adjustmentGradable}
    minSample={RELIABILITY_MIN_SAMPLE} />
</Stack>
```
`ReliabilityTile` renders the count always and the percentage only when `denominator >= minSample`; the two tiles never share a container that could sum or average them.

### Empty state
No suggestions ever graded for a source → `not enough evidence yet · 0 of 0`. The source still appears so its record can begin accumulating.

### Loading / error states
`Skeleton` tiles. Read failure → `Alert severity="error"` with retry; the rest of the app is unaffected.

### Behavior
Read-only analytics. No control here changes trust, risk, or trading — those are permanent non-goals for this pitch. A future source appears as an additional group with the identical two-tile shape; adding it requires no redesign.

---

## Screen 6: Suggestions — History tab (admin)

### Purpose
Give the reliability numbers their context: every suggestion ever raised, what it proposed, what William did, and how base and adjusted each turned out.

### URL pattern
`/suggestions/history` (tab) — admin only.

### Layout — `md` and above

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ Suggestions        Pending   [ History ]   Reliability     [source: ESPN ▾]│
├───────────────────────────────────────────────────────────────────────────┤
│ date    player        claim        you       source   base→adj  outcome    │
│ 10/26   T. Higgins    OUT          —          ✓ right  —         —          │
│ 10/26   J. Chase      (Higgins out) accepted  ✓ right  base +9   adj better │
│ 10/19   D. London     OUT          declined   ✗ wrong  base +6   base better│
│ 10/19   K. Pitts      (reversed)   superseded ✓ right  —         —          │
└───────────────────────────────────────────────────────────────────────────┘
```

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| Source filter | `Select` | Filter by source (ESPN only for now) |
| History table | `Table` dense | date, player, claim, disposition, source-correct, base→adj delta, which-was-better |
| Disposition cell | accepted / declined / superseded / — (unmarked) | Accepted, declined, ignored, and superseded remain distinguishable |
| Source-correct cell | ✓ right / ✗ wrong / — (unverifiable) | Graded against official participation, never Kalshi settlement |
| Outcome cell | adj better / base better / tie / pending | From shadow vs base grading; "pending" until the game settles |

### Empty state
```text
│   No suggestions yet this season.                              │
│   ESPN inactives begins producing history once games are live. │
```

### Loading / error states
`Skeleton` rows; read failure → retry `Alert`.

### Behavior
Rows deep-link to the contract detail for that game where still relevant. Reversed/superseded suggestions remain as rows — history never pretends an earlier claim didn't happen. A row whose source claim can't be verified shows `—` in source-correct and is excluded from the Source Accuracy denominator (never fabricated as correct). This surface is not a news feed; it exists to explain projection changes and source quality.

---

## 6. Navigation flows

```text
Slate (admin) ──pending marker──▶ Contract detail ──[Accept]──▶ projection updates in place
     │                                   │                        (reason line replaces panel)
     │                                   └──[Decline]─▶ base stays; shadow still graded
     │
     └──▶ Suggestions ▸ Pending ──[Accept/Decline]──▶ card clears in place
                │
                ├── History  ──row──▶ Contract detail (if relevant)
                └── Reliability (read-only; no navigation out that changes state)

Viewer: Slate / Contract detail ──▶ sees only accepted-adjustment reason line
                                      (no pending, no controls, no Suggestions nav)
```

- Accept/Decline are always in-place updates — never a redirect to a success page.
- A viewer deep-linking to `/suggestions*` is rejected server-side (403 in place), not redirected after a partial render.
- Accepting on the Pending queue and accepting on contract detail are the same operation with the same result.

---

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Pending queue | `↑` / `↓` | Move between suggestion cards |
| Pending queue | `A` / `D` | Accept / decline the focused card (only when pending) |
| Pending queue / row | `Enter` | Open the contract detail |
| Contract detail panel | `A` / `D` | Accept / decline the pending suggestion when the panel has focus |
| Contract detail | `Esc` | Close drawer (mobile), return focus to originating row |
| Reliability / History | `Tab` | Standard traversal; tables are not action targets |

- No shortcut ever places a Kalshi order (out of scope here regardless) and no shortcut auto-accepts across multiple suggestions — `A`/`D` act only on the single focused card.

### Loading states
Suggestion data rides on the surface it appears in (slate read, contract-detail read) and never blocks projection rendering. The Suggestions section uses `Skeleton` cards/rows matching final height. No spinner waits on ESPN.

### Error states
- ESPN unavailable is **not** an error: suggestions pause, affected games display as stale via the existing Pitch 5 mechanism, and an `info` banner explains it with a link to Health. No per-row error.
- A failed suggestion read fails open to the honest base view — projections and prices still render.
- Accept/Decline failure preserves the safe default (base active) and shows an inline retry.

### Notifications
| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Suggestion accepted | `Projection updated` | success | 3s |
| Suggestion declined | `Suggestion declined` | info | 3s |
| Accept/Decline failed | inline `Alert`, not a toast | error | until dismissed / retried |
| ESPN unavailable | one banner on Suggestions + a Health row | info | until resolved |

### Destructive actions
Accept and Decline are **not** destructive — neither deletes the base nor the shadow, both remain graded, and either can be understood from History afterward. No confirmation dialog is used; a confirmation step would wrongly imply irreversibility. (There is deliberately no "undo to a different active projection" beyond declining/accepting a live pending suggestion; a resolved suggestion's record is permanent.)

---

## 8. Responsive behavior

| Breakpoint | Behavior |
| ---------- | -------- |
| `xs` 0–599 | Contract-detail suggestion panel is full-width inside the detail drawer; base→proposed table becomes stacked label/value pairs, not a horizontally scrolling table. Pending-queue cards are single column; Accept/Decline are full-width thumb-reachable buttons. Reliability tiles stack vertically (still two separate tiles, never merged). History table collapses to stacked rows (date + player heading, fields beneath) — never horizontal scroll. |
| `sm` 600–899 | Single column, wider gutters; base→proposed returns to a compact table. |
| `md` 900–1199 | Contract detail as side panel with the suggestion panel inline; Suggestions section shows tabs + multi-column tiles/table. |
| `lg`+ | Full width with content max-width; tables show all columns without truncation. |

- Nothing horizontally scrolls at any breakpoint.
- Every action (Accept, Decline, Open, tab switch, source filter) is reachable at `xs`.
- The two reliability tiles never collapse into one figure at any width — stacking is allowed, merging is not.

---

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `PendingSuggestionPanel` | Contract detail | new | Admin only; states: pending, conflicting, post_kickoff, insufficient_evidence |
| `ProposedChangeTable` | Contract detail, Pending queue | new | base→proposed for value, range, threshold-prob, confidence; sign+arrow deltas |
| `AdjustmentReasonLine` | Slate, Contract detail | new | Shared/viewer-visible; only for accepted adjustments |
| `PendingSuggestionMarker` | Slate row | new | Admin only; coexists with stale/unresolved badges; no row-height change for viewers |
| `SuggestionCard` | Pending queue | new | Accept/Decline/Open |
| `ReliabilityTile` | Reliability tab | new | Count always shown; percentage gated at min sample; never merges the two metrics |
| `SuggestionHistoryTable` | History tab | new | disposition, source-correct, base-vs-adj outcome |
| `SampleSizePair` / count formatting | Reliability | reused | Follows the accuracy surface's sample-size disclosure |
| `ProbabilityValue`, `ConfidenceChip` | everywhere | reused | Monospace, tabular, confidence always paired |

---

## 10. Accessibility, privacy, and data sensitivity

Accessibility:
- Accept/Decline and Open have accessible names even when compact; the pending marker carries text ("suggestion pending"), not colour alone.
- Value deltas carry sign and `↑`/`↓` glyph, not just red/green, so direction survives greyscale and colourblindness.
- The two reliability tiles are labelled ("was the claim correct?" / "did reacting help?") so their difference is readable without relying on layout.
- Reliability figures have a text-equivalent summary sentence, not only tiles.
- Dialogs/drawers trap focus and return it to the trigger; the suggestion panel is keyboard-operable.
- Error messages are announced to screen readers.

Privacy:
- **The entire Suggestions section (Pending, History, Reliability) is admin-only and rejected server-side.** A viewer must not be able to infer its existence — absence in the nav, 403 in place at the route, no partial shell rendered before the check.
- Pending, declined, superseded, and conflicting suggestions and all accept/decline controls are never present in a viewer payload — omitted, not hidden with CSS.
- The only viewer-visible artifact is the accepted-adjustment reason line, which contains no private state (it names a public ESPN claim and the resulting shared projection).
- No Kalshi credential, key, or trading affordance appears anywhere in this feature.

---

## 11. Out of scope

Deferred to a later pitch (must not be precluded):
- Automatic source trust / "trusted source" auto-apply — a deliberate future capability, not built here, not even as a disabled toggle.
- Additional suggestion sources (limited-snaps, depth-chart, healthy scratches, return-from-injury) — reuse this mechanism unchanged.
- Automated position exit/offset when information arrives after a position exists — existing positions are frozen and annotated only.
- The later Baseline-vs-Simulation dual-engine shadow evaluation — a different capability.

Permanent non-goals (not to be relitigated):
- Sightline becoming a general NFL breaking-news product or the history becoming a social feed.
- Inferring player status from Kalshi price movement.
- Kalshi prices as a model input.
- Viewers trading through the application or seeing private analytics.
- Combining Source Accuracy and Adjustment Accuracy into one score.

## 12. Open questions

None blocking. All seven pitch Open Questions are resolved as approved-doc authority (see the spec's Resolved Decisions). Two run-chosen numeric defaults are flagged for human review at merge, not design-blocking: the 5-minute conflict window and the 15-observation reliability minimum.
