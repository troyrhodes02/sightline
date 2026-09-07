# Bankroll, Sizing & Autonomous Paper Trading — Design Document

**Version:** 1.0
**Pitch Source:** Sightline — Pitch: Bankroll, Sizing & Autonomous Paper Trading
**Focus:** The private admin surfaces through which William configures, watches, halts, reviews, and second-guesses a bot that trades fake money on his behalf.

---

## 1. Vision

Sightline already says which contracts it disagrees with the market about. This feature is where it acts on that — with fake money, alone, before kickoff, and then has to account for itself afterward. The screens exist so William can answer two questions without trusting a summary: *what did the bot do last Sunday, and would I have been comfortable if that had been real?*

Every surface here is an audit trail wearing a dashboard's clothes. The bankroll figure is the least interesting number on the page; the interesting numbers are the ones explaining why a stake was $14 and not $50, and why three candidates got nothing at all.

**North star: a ledger that can testify against itself.**

---

## 2. Design principles

### 1. The stake is the conclusion, the reasoning is the screen

A dollar amount with no visible derivation is unreviewable. Every simulated stake renders alongside its corrected probability, the executable price it was measured against, the fee, the Kelly edge that ranked it, the fraction applied, and — most importantly — the constraint that actually bound it. When the per-game cap cut a $62 stake to $40, the screen says *per-game cap* on that row, not merely `$40`.

### 2. Intended and filled are two numbers, always both

The pitch's central rabbit hole is the ledger quietly recording what the sizing formula wished for. Wherever a position appears, the intended stake and the simulated fill appear together, with the shortfall named. A complete fill is not the absence of a second number; it is the two numbers agreeing.

### 3. Nothing happened is a result, not a gap

A cycle that took no positions, a Sunday where every candidate sat above the probability ceiling, an offseason with no cycles at all — each renders as a finished statement with its reason, never as an empty list or a spinner. The bot is not expected to manufacture action.

### 4. Safety controls are never one tap away from each other

Kill (no confirmation, always available), Resume (confirmation, only when clear), and Force Override (multi-step, only when still breached) are three different shapes of control in three different places, and no two of them are adjacent. A control that halts trading and a control that overrides a halt must never be mistaken for one another under time pressure.

### 5. Paper says paper, everywhere, permanently

Every figure on every one of these surfaces is simulated, and every surface says so in its own chrome rather than relying on the user remembering which section they are in. This is not a temporary label pending live mode — a paper position stays visibly paper forever, including after live trading eventually exists.

### 6. The instrument does not flatter its operator

A losing paper campaign, a breaker William overrode that turned out to be right, a mode he switched away from that would have done better — all of these render as plainly as a good week. There is no encouraging copy, no streak, and no "you're up!"

---

## 3. Visual language

All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

### Colour palette

Only the tokens this feature uses. The full palette lives in `sightline-ui-design`.

| Token / theme path | Usage here | Notes |
| ------------------ | ---------- | ----- |
| `palette.primary.main` | Model-derived values: raw probability, corrected probability, Kelly edge, confidence, projection age | The model accent. Positive net edge also uses it. |
| `palette.primary.soft` | Selected risk-mode card, active recalibration version chip | |
| `palette.market.main` | Kalshi-derived values: executable price, book sides, top-of-book size, settlement result, mark-to-market value | Nothing model-derived wears mint. Bankroll dollars are **not** market values — see below. |
| `palette.warning.main` | Breaker warning state (5% drawdown), stale-refusal reasons, insufficient-sample notices, partial fill, unfilled remainder, force-override record | Caution only; a partial fill is a caution, not a loss. |
| `palette.warning.soft` | Warning banner ground, force-override confirmation panel ground | |
| `palette.error.main` | Tripped breaker, kill switch engaged, negative P&L, negative Kelly edge, drawdown below the halt threshold | Desaturated; reads as encoding, not payout. |
| `palette.error.soft` | Halted-state banner ground | |
| `palette.text.primary` | Bankroll, exposure, stake, fill, and P&L magnitudes | **Money is neutral by default.** It is neither model-derived nor market-derived; it is account state. Only its *sign* takes colour. |
| `palette.text.secondary` / `.muted` | Constraint names, denominators, timestamps, run reasons | |
| `palette.divider` / `palette.border.strong` | Card borders, table rules, the exposure-bar track | |

**One new rule this feature introduces.** Ledger money — bankroll, stake, fill, exposure, withdrawals, P&L — renders in `text.primary`, not in the market mint, even though it is denominated in the same dollars as a Kalshi price. Mint means *Kalshi told us this*. The paper bankroll is Sightline's own fiction and must never borrow the market's colour. A signed P&L takes `primary.main` when positive and `error.main` when negative; its magnitude glyph (`+` / `−`) carries the direction non-chromatically.

### State colours

Exact enum values from the data model. Nothing invented.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| Risk mode `conservative` | Neutral outlined chip | Default for a new campaign |
| Risk mode `moderate` | Neutral outlined chip | |
| Risk mode `aggressive` | Warning outlined chip | Higher permitted risk is a caution, not an achievement |
| Risk mode `custom` | Model-accent outlined chip | Deliberately tuned; the chip carries the Kelly fraction inline (`custom · 0.85×`) |
| Autonomy `active` | Model accent, filled dot + label `Autonomous` | New positions permitted |
| Autonomy `halted` | Error tone, filled | One or more breakers tripped; existing positions still settle |
| Autonomy `killed` | Error tone, filled, distinct label `Killed` | Kill switch engaged; distinct from a breaker halt because it is a human act |
| Autonomy `disabled` | Neutral outlined | Autonomy never enabled, or turned off deliberately. The resting state |
| Breach `drawdown_warning` | Warning tone, outlined | 5% from high-water mark; does not halt |
| Breach `drawdown_halt` | Error tone, filled | Mode-dependent 10 / 15 / 20% |
| Breach `calibration` | Error tone, filled | Rolling Brier degraded or behind the market |
| Breach `exposure` | Error tone, filled | Open exposure beyond the slate cap |
| Breach `kill_switch` | Error tone, filled | |
| Breach resolution `cleared` | Neutral outlined, past tense | Condition went away and William resumed |
| Breach resolution `force_overridden` | **Warning tone, filled, permanent** | Never fades to neutral. The record that the bot wanted to stop and was overruled |
| Fill `complete` | Neutral; the two numbers simply agree | Not a success chip. A complete fill is unremarkable |
| Fill `partial` | Warning tone, outlined, with the shortfall | |
| Fill `none` | Neutral outlined, with the reason | Refusing to fill is correct behaviour, not a failure |
| Position `open` | Neutral | |
| Position `settled_won` / `settled_lost` | Model accent / error tone on the P&L only | The row is not tinted; the number carries it |
| Position `voided` | Neutral outlined, terminal treatment | Distinct from lost. Cost basis and fees returned |
| Readiness `not_ready` | Neutral outlined | |
| Readiness `paper_evidence_building` | Warning outlined | The honest majority state |
| Readiness `eligible_for_live_trading` | Model accent outlined — **outlined, never filled, never a call to action** | Eligibility is a report, not a button. Nothing on this chip is clickable |

Colour never carries a state alone. Every chip has a word; every signed number has a sign; every constraint has a name.

### Typography, spacing, radius, elevation

Per `sightline-ui-design`: Space Grotesk throughout, `font-variant-numeric: tabular-nums` on every computed figure, weight 400 for all data values, 500 for headers and labels, 600 for screen titles only. Chips at 4px radius. Cards bordered, never floated.

Feature-specific usage:

- `numericLg` (22/30) for the four headline bankroll figures and nothing else.
- `numericMd` (15/22) for stakes, fills, prices, probabilities, and exposure in tables.
- `numericSm` (13/18) for denominators, shortfalls, fee amounts, and per-row timestamps.
- Currency renders with an explicit `$` and two decimals throughout (`$1,043.50`). Contract counts render as bare integers with the unit spelled (`38 contracts`). Never mix the two in one column.
- Probabilities to one decimal with `%`. Prices as whole cents with `¢`. Kelly edge as a signed decimal fraction to three places (`+0.084`), because it is a fraction of bankroll, not points — deliberately different in shape from the slate's `+7.4 pts` so the two are never confused.

### Appearance

Light, dark, and system via theme tokens. Two feature-specific notes:

- The **exposure meter** (a horizontal bar of used-versus-cap) draws its track from `palette.divider` and its fill from `palette.primary.main`, switching to `palette.error.main` at 100%. In dark mode the track needs `border.strong` rather than `divider` to remain visible against the elevated surface.
- The **bankroll history chart** (Recharts) reads every colour, font, and stroke from `useTheme()`. Its high-water-mark reference line uses `palette.text.muted` at 1px dashed in both modes; the drawdown-halt threshold line uses `palette.error.main` at 1px dashed. Neither is a gradient and neither is filled.

---

## 4. Information architecture

```text
Sightline
├── Slate                        (shared)  ← default landing, untouched by this feature
│   └── Contract detail          (shared)
├── Accuracy                     (shared)
│   ├── Reliability & baselines
│   └── Override performance     (admin only)
├── Autonomy                     (ADMIN ONLY)  ← everything this feature adds
│   ├── Overview                 /autonomy              ← the Sunday-morning screen
│   ├── Cycles                   /autonomy/cycles       ← run history
│   │   └── Cycle detail         /autonomy/cycles/[id]  ← candidate-by-candidate audit
│   ├── Positions                /autonomy/positions    ← the paper ledger
│   ├── Review                   /autonomy/review       ← period performance + counterfactual replay
│   ├── Readiness                /autonomy/readiness    ← live-readiness evidence
│   ├── Dry Run                  /autonomy/dry-run      ← the same path, writing nothing
│   └── Configuration            /autonomy/configuration ← risk mode, bankroll, ceilings
├── Health                       (admin only)  ← gains three autonomy signals
├── Settings                     (shared)
└── Users                        (admin only)
```

**Navigation.** One new top-level section, `Autonomy`, `adminOnly: true`, sitting between Accuracy and Health. Its seven surfaces are reached by a secondary tab row inside the section, not by seven nav entries. A viewer sees no Autonomy tab, and every one of the seven routes rejects a viewer server-side before rendering any shell.

**Why `/autonomy` and not `/bankroll`.** The codebase's build invariants forbid a `/bankroll` route, guarding against the deferred V2 bankroll-and-portfolio-management product. That guard stays. This feature is not portfolio management; it is an autonomous paper-trading system that happens to keep a bankroll, and `/autonomy` names what it actually is.

**Relationship to the Slate.** None, deliberately. The slate stays exactly as it is — shared, viewer-visible, and free of any hint that a bot is trading against it. A paper position is never annotated onto a contract row or a contract detail view in this feature, because that surface is shared and the risk of leaking private trading state onto a viewer screen outweighs the convenience.

**Relationship to Accuracy.** One-directional and read-only: Readiness quotes calibration, Brier, market-relative, and baseline evidence from the accuracy surface, links to it, and never restates a number the accuracy surface would compute differently.

---

## 5. Screen 1: Autonomy Overview

### Purpose

Tell William, in one glance on a Sunday morning, whether the bot is running, what it is holding, how much it has lost from its peak, and whether anything has stopped it.

### URL pattern

`/autonomy`

### Trigger

The `Autonomy` nav item; the default landing within the section.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Autonomy                                              [ Kill autonomy ]      │
│ Paper mode · all figures simulated                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Halted — drawdown 11.2% of high-water mark, threshold 10.0% (conservative) │
│   Tripped Sun 26 Oct 1:47p ET · 2 candidates blocked  [Resume] [Force overrideâ†’]│
├──────────────────────────────────────────────────────────────────────────────┤
│  Active bankroll     Total paper wealth    Net paper P&L     Max drawdown    │
│  $912.40             $1,062.40             −$87.60           11.2%           │
│  settled $874.10     withdrawn $150.00     −8.8% of start    peak $1,027.90  │
│  + open $38.30                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Risk mode  [conservative]  0.25× Kelly · game 5% · slate 15%   [Configure →] │
│ Ceiling    corrected probability ≤ 0.750 (independent of mode)               │
├──────────────────────────────────────────────────────────────────────────────┤
│ Open exposure                                                                │
│  Slate   ████████░░░░░░░░░░░░  $38.30 / $136.86 (15% of $912.40)             │
│  DET@GB  ███░░░░░░░░░░░░░░░░░  $22.10 / $45.62  (5%)                          │
│  CIN@PIT ██░░░░░░░░░░░░░░░░░░  $16.20 / $45.62  (5%)                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Bankroll history                          [ week ][ campaign ]               │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │ ·············································· high-water $1,027.90│      │
│  │      ╱‾‾╲                                                          │      │
│  │  ╱‾‾╯    ╲___                                                      │      │
│  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ halt threshold $925.11 ─ ─ ─ ─ ─│      │
│  └────────────────────────────────────────────────────────────────────┘      │
│  Settled balance ——— · mark-to-market ·······                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Recent cycles                                              [ All cycles → ]  │
│  Sun 26 Oct 12:20p  DET@GB 1:00p   3 candidates · 2 filled · $22.10  ok       │
│  Sun 26 Oct 12:20p  CIN@PIT 1:00p  5 candidates · 1 filled · $16.20  partial  │
│  Sun 26 Oct 1:47p   LAR@SEA 4:05p  4 candidates · 0 filled           halted   │
│  Sun 26 Oct 3:55p   KC@BUF 8:20p   —                                 skipped  │
│                                    reached the 10-minute cutoff              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Live readiness      [ paper evidence building ]      1 of 2 NFL weeks  [ → ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Layout — `xs`

The four headline figures become a 2×2 grid, each keeping its sub-line. The exposure meters stack full width. The chart keeps full width at 180px height with the legend beneath. Recent cycles wrap to two lines per row exactly as slate rows do. `Kill autonomy` moves from the header to a fixed bottom bar within thumb reach, and stays visible while the page scrolls — it is the one control that must never require scrolling to reach.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Paper-mode subtitle** | `Typography variant="caption"` in `text.muted`, directly under the `h1` | Present on all seven Autonomy surfaces. Never dismissible |
| **Kill autonomy** | `Button variant="outlined" color="error"` | **No confirmation dialog.** Single activation, immediate. Disabled with the label `Killed` and a `Disengage kill switch` sibling once engaged |
| **State banner** | `Alert` — `severity="error"` halted/killed, `severity="warning"` drawdown warning, absent when active | Lists every simultaneously active breach as its own line. Carries `Resume` and `Force override` where applicable |
| **Headline figures** | `Stack direction={{xs:"column",md:"row"}}` of four bordered `Box`es | `Typography variant="numericLg"`; sub-line `numericSm` in `text.secondary`. Active bankroll's sub-line always decomposes into settled + open |
| **Risk-mode row** | `Chip` + inline parameter summary + text `Button` to Configuration | The chip's colour follows the mode table. The parameters render as read-only text here — this row explains, it does not set |
| **Ceiling row** | `Typography variant="body2"` | Always states that the ceiling is independent of mode, in words. This is a No-Go the interface actively asserts |
| **Exposure meters** | Custom `ExposureMeter` — bordered track `Box`, filled `Box`, label row | One slate meter plus one per game with open exposure. Fill turns `error.main` at ≥100%. The cap's dollar value and its percentage both render — a percentage alone is unauditable |
| **Bankroll chart** | `BankrollChart` wrapping Recharts `LineChart` | Two series (settled solid, mark-to-market dotted), two `ReferenceLine`s (high-water, halt threshold). All colours from `useTheme()`. Text-equivalent summary in a `visuallyHidden` `<p>` |
| **Recent cycles** | `Table size="small"`, four most recent | Row → `/autonomy/cycles/[id]`. A skipped or failed row renders its reason on a second line in `text.secondary` |
| **Readiness strip** | `Chip` + progress fraction + text link | Never a button. Reaching `eligible_for_live_trading` changes the chip and nothing else |

### Code reference

```tsx
<Stack spacing={3}>
  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
    <Box>
      <Typography variant="h1">Autonomy</Typography>
      <Typography variant="caption" sx={{ color: "text.muted" }}>
        Paper mode · all figures simulated
      </Typography>
    </Box>
    <KillSwitchButton engaged={state.killSwitchEngaged} />
  </Stack>

  {state.breaches.length > 0 && (
    <Alert
      severity={state.status === "halted" || state.status === "killed" ? "error" : "warning"}
      action={<BreakerActions breaches={state.breaches} status={state.status} />}
    >
      <AlertTitle>{state.status === "killed" ? "Killed" : "Halted"}</AlertTitle>
      <Stack spacing={0.5}>
        {state.breaches.map((b) => (
          <Typography key={b.id} variant="body2">
            {b.label} — measured {b.measuredDisplay}, threshold {b.thresholdDisplay}
          </Typography>
        ))}
      </Stack>
    </Alert>
  )}

  <BankrollHeadline figures={state.figures} />
  <RiskModeSummary mode={state.mode} ceiling={state.probabilityCeiling} />
  <ExposurePanel slate={state.slateExposure} games={state.gameExposure} />
  <BankrollChart series={state.history} highWaterMark={state.highWaterMark} haltAt={state.haltThreshold} />
  <RecentCyclesTable cycles={state.recentCycles} />
  <ReadinessStrip readiness={state.readiness} />
</Stack>
```

### Empty state — autonomy never enabled

```text
┌──────────────────────────────────────────────────────────────────┐
│ Autonomy                                                         │
│ Paper mode · all figures simulated                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Autonomous paper trading is not enabled.                       │
│                                                                  │
│   Starting bankroll  $1,000.00      Risk mode  conservative      │
│                                                                  │
│   Run a Dry Run against an upcoming game window to see what       │
│   the bot would do before it does anything.                       │
│                                                                  │
│   [ Open Dry Run ]   [ Configuration ]                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

No chart, no exposure meters, no cycle table — a zeroed dashboard would read as a loss.

### Empty state — enabled, offseason

The full dashboard renders with real bankroll figures and history. The cycles table shows the offseason line rather than an empty table:

```text
│ Recent cycles                                                     │
│  Offseason. Autonomous cycles resume with the season schedule.    │
│  Last cycle: Sun 4 Jan, 3:55p ET                                  │
```

### Empty state — enabled, in season, no cycles yet this week

```text
│ Recent cycles                                                     │
│  No cycles yet this week. Next eligible window opens Sun 2 Nov,   │
│  7:00a ET (6 hours before the 1:00p kickoffs).                    │
```

### Loading state

`Skeleton` blocks matching final heights: four headline cards at 76px, exposure panel at 120px, chart at 200px, four cycle rows at 44px. The `h1`, the paper-mode subtitle, and the kill switch render immediately from static content and never skeleton — the control that stops the bot must not be unavailable while a chart loads.

### Error state

If the overview read fails, an `Alert severity="error"` replaces the body: `Could not load autonomy state.` with a `Retry` action. **The kill switch remains rendered and functional above it.** If the kill-switch route itself fails, the button shows an inline error beneath it — `Kill did not take effect. Retry.` — and does not clear its pressed appearance, because a control that looks like it worked and did not is the worst possible failure here.

If mark-to-market cannot be computed (Kalshi degraded, no recent price for one or more open positions), the mark-to-market series and the "+ open" component render as `unavailable` with a last-fetch timestamp, and a `severity="info"` banner explains once at the top. The settled figures remain exact. **Drawdown then reports as unavailable rather than falling back to settled-only** — a drawdown number computed on a different basis than the breaker uses would be a lie about the safety state.

### Behavior

- Kill takes effect immediately, with no dialog. The button's label changes to `Killed`, the state banner appears, and the page re-reads state. Notification: `Autonomy killed. No new positions will be created.` — severity `warning`, persistent until dismissed.
- Resume is present only when every active breach has cleared. It opens a small confirmation `Dialog` restating which conditions cleared.
- Force override is present only when at least one breach is still active, and navigates to the override flow (Screen 8) rather than opening a dialog in place — see Principle 4.
- Focus after kill returns to the kill button, now labelled `Killed`.

---

## 6. Screen 2: Cycles

### Purpose

Show every autonomous evaluation the system has performed, including the ones that did nothing, so a skipped or failed cycle is visible rather than silent.

### URL pattern

`/autonomy/cycles`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Cycles                                          Season [2026 ▾]  Week [9 ▾]  │
│ Paper mode · all figures simulated                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Started        Game window        Cand.  Sized  Filled  Staked   Outcome     │
├──────────────────────────────────────────────────────────────────────────────┤
│ 26 Oct 12:20p  DET@GB   1:00p ET    3      2      2     $22.10   ok          │
│ 26 Oct 12:20p  CIN@PIT  1:00p ET    5      2      1     $16.20   partial fill│
│ 26 Oct 12:22p  NYJ@NE   1:00p ET    4      0      0     —        no candidate│
│                                    all 4 above the 0.750 ceiling             │
│ 26 Oct 1:47p   LAR@SEA  4:05p ET    4      2      0     —        halted      │
│                                    drawdown breaker tripped mid-cycle        │
│ 26 Oct 3:55p   KC@BUF   8:20p ET    —      —      —     —        skipped     │
│                                    reached the 10-minute cutoff              │
│ 26 Oct 3:55p   MIA@LV   8:20p ET    —      —      —     —        failed      │
│                                    Kalshi unavailable                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

At `xs`, each cycle becomes a two-line row: line one is game window plus outcome chip; line two is the counts and the staked total.

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Season / week selectors** | Two `Select`s, deep-linked as `?season=&week=` | Weeks list only those with cycles. Default: the most recent week with cycles |
| **Table** | `Table size="small"`, dense | Row click → cycle detail. Whole row is the target; `Enter` on a focused row opens it |
| **Outcome cell** | Text label, not a chip — six values: `ok`, `partial fill`, `no candidate`, `halted`, `skipped`, `failed` | `halted` and `failed` in `error.main`; `partial fill` and `skipped` in `warning.main`; `ok` and `no candidate` in `text.primary`. Each non-`ok` outcome renders its reason on the second line |
| **Counts** | `numericMd`, tabular | `Cand.` = candidates evaluated, `Sized` = received a positive stake, `Filled` = produced a position. These three narrowing numbers are the cycle's story |

### Empty state

```text
│  No autonomous cycles recorded.                                   │
│  Cycles begin once autonomy is enabled and a game window opens.   │
│  [ Configuration ]                                                │
```

Offseason variant states the last cycle date and next scheduled window.

### Loading / error states

Eight skeleton rows at 44px. On read failure, `Alert severity="error"` with `Retry`, table hidden.

---

## 7. Screen 3: Cycle detail

### Purpose

Explain, candidate by candidate, exactly why each contract got the stake it got — or nothing.

### URL pattern

`/autonomy/cycles/[cycleId]`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Cycles                                                                     │
│ CIN@PIT · 1:00p ET · Sun 26 Oct                                              │
│ Paper mode · all figures simulated                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Started 12:20:14p · finished 12:20:19p · outcome partial fill                │
│ Risk mode conservative (0.25× Kelly, game 5%, slate 15%)                     │
│ Recalibration v3 (backtest 2019–2024 contract-like + 412 live obs)           │
│ Bankroll at evaluation $999.80 · slate capacity $149.97 · game capacity $49.99│
├──────────────────────────────────────────────────────────────────────────────┤
│ Candidates                                     ranked by Kelly edge, desc    │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1  Ja'Marr Chase CIN · rec yds ≥ 74.5                          FILLED        │
│    raw 61.4% → corrected 58.9%   conf high (×1.00)                           │
│    yes ask 54¢ · fee 1¢ · net price 55¢ · top-of-book 40 contracts           │
│    Kelly edge +0.071   fraction 0.25×   intended $17.75 (32 contracts)       │
│    bound by: none              filled 32 @ 54¢ + $0.32 fee = $17.60          │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2  Tee Higgins CIN · receptions ≥ 4.5                          PARTIAL       │
│    raw 57.0% → corrected 55.1%   conf medium (×0.70)                         │
│    yes ask 49¢ · fee 1¢ · net price 50¢ · top-of-book 12 contracts           │
│    Kelly edge +0.051   fraction 0.25×   intended $12.25 (25 contracts)       │
│    bound by: top-of-book size   filled 12 @ 49¢ + $0.12 fee = $ 6.00         │
│                                 unfilled $6.25 returned to available bankroll│
├──────────────────────────────────────────────────────────────────────────────┤
│ 3  Najee Harris PIT · rush yds ≥ 54.5                          NO STAKE      │
│    raw 78.2% → corrected 76.4%   conf high                                   │
│    bound by: probability ceiling (0.750)                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ 4  George Pickens PIT · rec yds ≥ 49.5                         NO STAKE      │
│    raw 53.1% → corrected 51.2%   conf low (×0.40)                            │
│    yes ask 51¢ · fee 1¢ · net price 52¢                                      │
│    Kelly edge −0.017              bound by: no edge after fees               │
├──────────────────────────────────────────────────────────────────────────────┤
│ 5  Pat Freiermuth PIT · receptions ≥ 2.5                       REFUSED       │
│    bound by: stale projection — predates today's inactives                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Reallocation                                                                 │
│  Pass 1  allocated $17.75 → Chase, $12.25 → Higgins                          │
│  Pass 2  $6.25 returned from Higgins. Higgins' top-of-book was consumed and  │
│          is not retried this cycle. No remaining candidate had positive       │
│          Kelly edge. $6.25 left unallocated.                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Header block** | `Stack` of `body2` lines in a bordered `Box` | Everything needed to reproduce the decision: mode and its parameters, recalibration version, bankroll and capacities at evaluation time. These are the values **as they were**, never re-read |
| **Candidate card** | Bordered `Box`, one per candidate, ordered by Kelly edge descending; refused candidates last | Four-line structure: identity + outcome; model economics; market economics; sizing and binding constraint |
| **Outcome word** | `FILLED` / `PARTIAL` / `NO STAKE` / `REFUSED` / `BLOCKED` as `label`-variant text, right-aligned | `BLOCKED` = a breaker tripped before this candidate was reached |
| **`bound by:`** | Always present, always the last line of the sizing block | The single most important field on the screen. Values: `none`, `top-of-book size`, `per-game cap`, `per-slate cap`, `available bankroll`, `probability ceiling`, `no edge after fees`, `stale projection`, `price unavailable`, `10-minute cutoff`, `breaker: <condition>`. Never blank, never `—` |
| **Reallocation trace** | Bordered `Box` at the foot, one line per pass | Present whenever more than one pass ran. States in words why the loop stopped |
| **Contract link** | Player name links to `/slate/[contractId]` | Opens in the same tab; the slate is shared, so this is a safe outbound link |

### Empty / degenerate states

- **No candidates at all** (offseason cycle, or every contract unresolved): the candidate list is replaced by `No resolvable contracts in this game window.` with the count of contracts considered and rejected upstream.
- **Cycle failed before evaluation** (Kalshi unavailable): header block renders, candidate list replaced by `Cycle failed before candidates were evaluated: Kalshi unavailable. No positions were created.` in `error.main`.
- **Cycle skipped at the cutoff**: `Skipped. The cycle reached the 10-minute pre-kickoff cutoff before evaluating candidates. No positions were created.`

### Loading / error

Skeleton header block plus three candidate cards at 120px. Read failure → `Alert severity="error"` with `Retry` and a back link.

---

## 8. Screen 4: Positions

### Purpose

The paper ledger: every simulated position, what it cost, what it is worth, and what it settled to.

### URL pattern

`/autonomy/positions`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Positions                        [ open ][ settled ][ all ]   Week [9 ▾]     │
│ Paper mode · all positions simulated · never live                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Contract                     Side  Qty  Cost   Mark   Result     P&L         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Ja'Marr Chase rec yds ≥74.5  yes    32  $17.60 $19.20  open        —          │
│  opened Sun 26 Oct 12:20p · intended $17.75 · filled complete                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tee Higgins receptions ≥4.5  yes    12  $ 6.00 $ 5.40  open        —          │
│  opened Sun 26 Oct 12:20p · intended $12.25 · ⚠ partial, $6.25 unfilled       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Bijan Robinson rush yds≥54.5 yes    28  $15.40   —     settled yes  +$12.60   │
│  opened Sun 19 Oct 12:18p · settled Sun 19 Oct 7:42p                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Puka Nacua rec yds ≥89.5     no     20  $ 9.00   —     settled yes  −$ 9.00   │
│  opened Sun 19 Oct 12:18p · settled Sun 19 Oct 11:58p                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Brock Bowers receptions ≥3.5 yes    15  $ 8.25   —     voided       $ 0.00    │
│  opened Sun 12 Oct · market voided Mon 13 Oct · cost and fees returned        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Filter** | `ToggleButtonGroup` — open / settled / all | Deep-linked `?status=`. Default `open` when any are open, else `settled` |
| **Row, line 1** | Contract, side, quantity, cost basis, mark, result, P&L | Mark renders `—` for settled and voided rows. P&L renders `—` while open — an unrealised P&L in the ledger's P&L column would blur realised and unrealised |
| **Row, line 2** | `numericSm` in `text.secondary` | Always carries the intended stake alongside the fill. A partial fill gets a `warning.main` fragment naming the unfilled amount |
| **Voided row** | Neutral outlined treatment across the whole row, `$0.00` P&L | Visually distinct from `settled lost`; the copy says cost and fees were returned |
| **Settlement source** | Footnote beneath the table | `Positions settle against Kalshi's settlement result. Where Kalshi's settlement and the official stat line disagree, the position follows Kalshi and the model's grade follows the official line — the two are recorded separately and never reconciled.` |

### Empty states

- No positions ever: `No paper positions. Positions appear once an autonomous cycle fills one.` with a link to Cycles.
- Filter `open` with none open: `No open positions. 14 settled positions this campaign.` and a link switching the filter.

### Loading / error

Six skeleton rows at 56px (two-line height). Read failure → `Alert` with `Retry`.

If mark-to-market is unavailable, the Mark column renders `unavailable` per row with one banner explaining, and the table remains fully usable — cost, result, and realised P&L are unaffected.

---

## 9. Screen 5: Review

### Purpose

Answer "how did the bot do over this period, and how much of that is signal?" — and, beneath it, "what would a different risk mode have done with the same weekend?"

### URL pattern

`/autonomy/review`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Review              Period [ week 9 ▾ ]   [ game window ][ week ][ campaign ]│
│ Paper mode · all figures simulated                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Week 9 · 26 Oct – 30 Oct · risk mode conservative throughout                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  Starting bankroll   Ending active     Net paper P&L    Withdrawals          │
│  $1,000.00           $912.40           −$87.60          $150.00              │
│                                                                              │
│  Total paper wealth  Max drawdown      Positions        Fill quality         │
│  $1,062.40           11.2%             8 (6 settled)    5 complete           │
│                      mark-to-market                     2 partial, 1 unfilled│
├──────────────────────────────────────────────────────────────────────────────┤
│ Safety events                                                                │
│  Sun 26 Oct 1:47p  drawdown halt  measured 11.2%, threshold 10.0%            │
│                    resolved: force overridden by admin Sun 26 Oct 2:05p      │
│  Sun 26 Oct 12:04p drawdown warning  measured 5.3%                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Model quality this period                                  [ Accuracy → ]    │
│  Rolling Brier 0.229 over 118 graded contract-like predictions               │
│  Backtest reference 0.213 · market 0.221 over the same contracts             │
│  Paper P&L is a financial result over 8 positions. It is not evidence of      │
│  model quality on its own.                                                    │
├══════════════════════════════════════════════════════════════════════════════┤
│ Counterfactual risk-mode replay                          [ Run replay ]      │
│                                                                              │
│  Mode          Ending active  Net P&L   Withdrawn  Max DD  Pos  Breakers     │
│  conservative* $912.40        −$87.60   $150.00    11.2%    8   1 halt       │
│  moderate      $868.10        −$131.90  $150.00    16.8%   11   1 halt       │
│  aggressive    $791.40        −$208.60  $150.00    24.1%   14   2 halts      │
│  * the mode actually used                                                    │
│                                                                              │
│  Replayed 2 Nov 9:12a from the state available at each original decision      │
│  time. Same projections, same corrected probabilities, same observed books,    │
│  same fill policy, same settlements. Only the risk configuration differs.      │
│                                                                              │
│  Replays are decision support. Sightline does not change risk mode from a     │
│  replay result; you do, in Configuration.                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Period granularity** | `ToggleButtonGroup` — game window / week / campaign | Deep-linked. The `Period` select's contents change with granularity |
| **Eight-figure grid** | 4×2 at `md`, 2×4 at `xs`, bordered cells | Every one of the pitch's required review figures has a cell. None is behind a disclosure |
| **Fill quality cell** | Counts of complete / partial / unfilled | This is where the pitch's honesty requirement about fills lands in the summary layer |
| **Safety events** | `Table size="small"`, one row per breach with its resolution | A `force_overridden` resolution renders in `warning.main` **permanently** and states who and when. It never renders as `cleared` |
| **Model quality block** | Bordered `Box` with a link to `/accuracy` | Quotes rolling Brier, the backtest reference, and the market comparison. Carries the standing sentence separating financial from model evidence. Numbers are read from the same source the accuracy surface uses; nothing is recomputed here |
| **Replay table** | `Table size="small"`, one row per mode, actual mode marked with `*` and a footnote | Never sorted by profit. Fixed order conservative → moderate → aggressive so the risk ordering reads as the ordering |
| **`Run replay`** | `Button variant="outlined"` | Only enabled when every position in the period has settled or voided. Disabled tooltip: `Replay runs once the period's positions have all settled — 2 still open.` |

### Empty states

- **No completed period yet**: `No completed period to review. Week 9 is in progress; review becomes available once its positions settle.`
- **Period with no cycles**: full figure grid renders with the starting and ending bankroll equal, `Positions 0`, and `No cycles ran in this period.` in place of the safety-events table.
- **Replay never run**: the replay section renders its heading, the explanation paragraph, and the enabled/disabled `Run replay` button — never an empty table.
- **Replay unavailable because positions are open**: the section explains the condition rather than hiding.

### Loading / error

Figure grid skeletons at final height; replay section renders its static explanation immediately. A replay in progress disables the button and shows `Replaying…` with a `LinearProgress` beneath the section heading; the rest of the page stays interactive.

If a replay fails: `Alert severity="error"` inside the replay section — `Replay could not complete: <reason>. No stored replay was changed.` The previously stored replay table, if any, remains rendered.

### Behavior — the boundary this screen must not cross

The replay writes to its own stored replay records and nothing else. It never touches the paper bankroll, never contributes to readiness, never changes the active mode, and never appears in the eight-figure grid above it. The visual separation (a double rule, a distinct section heading, its own explanatory paragraph) exists to make that boundary legible, not decorative.

---

## 10. Screen 6: Readiness

### Purpose

Report whether the evidence for live trading exists yet, category by category, and make unmistakably clear that reporting it changes nothing.

### URL pattern

`/autonomy/readiness`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Live readiness                                                               │
│ Paper mode · all figures simulated                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│  [ paper evidence building ]                                                 │
│                                                                              │
│  Reaching every criterion does not enable live trading and does not create    │
│  a control that would. Real-money operation requires the later Kalshi Trading │
│  capability and an explicit decision by you.                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Paper evidence                                                               │
│  ✗ Two complete NFL weeks of autonomous paper trading                        │
│      1 of 2 complete. Week 9 in progress (3 positions unsettled).            │
│  ✗ Positive cumulative net paper P&L across those weeks                      │
│      −$87.60 across 1 complete week, after fills and fees.                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Model quality                                              [ Accuracy → ]    │
│  ✓ Calibration within the approved range                                     │
│      Rolling Brier 0.229 vs backtest 0.213 (tolerance +0.030).               │
│  ✗ Performance relative to Kalshi                                            │
│      Model 0.229 vs market 0.221 over 118 shared contracts (tolerance +0.020)│
│  ✓ Approved baseline requirements satisfied                                  │
│      Stored backtest run 2019–2024 holdout beats both baselines.             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Safety and operations                                                        │
│  ✗ Drawdown within acceptable bounds                                         │
│      Max drawdown 11.2%, bound 10.0% (conservative).                         │
│  ✓ Breakers behaved as expected                                              │
│      1 trip, 1 force override, 0 failures to trip.                           │
│  ✓ No unresolved operational failures                                        │
│      0 failed cycles in the last 14 days.                                    │
│  ✓ Sizing and exposure behaviour responsible                                 │
│      0 cap breaches across 24 cycles.                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Evaluated 2 Nov 9:14a · re-evaluated on each page load                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **State chip** | `Chip variant="outlined"`, one of three | `not_ready` neutral, `paper_evidence_building` warning, `eligible_for_live_trading` model accent. **Never a button, never adjacent to one** |
| **Standing disclaimer** | `Typography variant="body2"` directly beneath the chip | Renders in all three states, including `eligible_for_live_trading`. Its wording is stronger, not weaker, when eligible |
| **Criterion row** | `✓` / `✗` glyph + `body2` label + `numericSm` evidence line | Glyph, not colour, carries pass/fail; the glyph has an accessible label (`met` / `not met`). Every row's evidence line names the measured value and the bound, so no criterion is a bare verdict |
| **Category grouping** | Three sections with `h2` headings | Paper evidence, model quality, safety and operations — kept separate so financial evidence never blends into model evidence |
| **`Accuracy →`** | Text `Button` | Model-quality figures link out rather than being restated with independent arithmetic |

### The state when eligible

```text
│  [ eligible for live trading ]                                               │
│                                                                              │
│  Every criterion is met. This is a report, not an action.                    │
│  Sightline cannot move itself to real money and no control on this page       │
│  will. Real-money operation requires the later Kalshi Trading capability      │
│  and an explicit decision by you.                                            │
```

No button appears. No "activate" affordance exists anywhere in this feature.

### Empty state

Before any autonomous week completes, every criterion renders with `✗` and the honest evidence line (`0 of 2 complete`, `no graded live predictions yet`). The screen is never blank — an unevaluable criterion states that it cannot be evaluated and why, rather than defaulting to pass or being omitted.

### Loading / error

Skeleton rows per criterion at 44px. A criterion whose evidence read fails renders as `✗` with `Could not evaluate: <reason>.` — **a criterion that cannot be evaluated never counts as met.**

---

## 11. Screen 7: Dry Run

### Purpose

Show exactly what the bot would do against a real upcoming window, writing nothing.

### URL pattern

`/autonomy/dry-run`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Dry Run                                                                      │
│ Paper mode · all figures simulated · this run writes nothing                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Game window   [ DET@GB · Sun 2 Nov 1:00p ET ▾ ]              [ Run dry run ] │
│                                                                              │
│ Uses the active risk mode, the active recalibration, the current bankroll     │
│ state, the same exposure caps, the same breaker evaluation, and the same      │
│ fill policy as an autonomous cycle. Creates no position and changes no        │
│ bankroll.                                                                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Result · run 2 Nov 9:20a · would not have executed                           │
│                                                                              │
│ ⚠ A breaker would block this cycle: drawdown halt (11.2% vs 10.0%).          │
│   Candidates below are what the cycle would have evaluated before the block.  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ the same candidate cards as Cycle detail, with WOULD FILL / WOULD PARTIAL / │
│   NO STAKE / REFUSED / WOULD BE BLOCKED in place of the past-tense words ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Would have staked $0.00 of $149.97 slate capacity across 0 positions.         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Window select** | `Select` of eligible upcoming game windows | Lists windows with resolvable contracts inside the execution window or later today. Disabled with an explanation when none exist |
| **`Run dry run`** | `Button variant="contained"` | The one contained button in this feature. Safe by construction — it writes nothing |
| **Standing explanation** | Always visible, above the result, not a tooltip | States both what Dry Run shares with a real cycle and what it does not do |
| **Candidate cards** | Identical component to Cycle detail, conditional verb tense | Sharing the component is the point: a divergence between what Dry Run shows and what a cycle does would defeat the feature |
| **Breaker preview** | `Alert severity="warning"` | Dry Run explicitly reports that a breaker would block, per the pitch's Definition of Done — it does not silently show an empty candidate list |
| **Footer total** | `body2` | Restates capacity used versus available so the exposure story is legible without the meters |

### Empty states

- **No eligible window**: `No upcoming game window has resolvable contracts. Dry Run becomes available once the slate has contracts for a scheduled game.` Select and button disabled.
- **Window with no candidates**: `No resolvable contracts in this window.` — a legitimate result, reported as a completed run.
- **Every candidate refused**: candidate cards render with their `bound by:` reasons and the footer reads `Would have staked $0.00 across 0 positions.` This is a finished dry run, not an empty state.

### Loading / error

While running: button disabled with `Running…`, `LinearProgress` beneath the header, previous result (if any) dimmed but not removed. On failure: `Alert severity="error"` — `Dry run could not complete: <reason>. Nothing was written.` The last sentence is required copy; the whole value of Dry Run is that a failure is inert.

---

## 12. Screen 8: Configuration

### Purpose

Set the risk mode, the starting bankroll, and the withdrawal ceiling — and make the consequences of each visible before they are saved.

### URL pattern

`/autonomy/configuration`

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Configuration                                                                │
│ Paper mode · all settings apply to simulated trading only                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Risk mode                                                                    │
│  ┌───────────────┬───────────────┬───────────────┬───────────────┐           │
│  │ conservative ●│ moderate      │ aggressive    │ custom        │           │
│  │ 0.25× Kelly   │ 0.50× Kelly   │ 0.75× Kelly   │ set your own  │           │
│  │ game 5%       │ game 8%       │ game 12%      │               │           │
│  │ slate 15%     │ slate 25%     │ slate 35%     │               │           │
│  │ halt at 10%   │ halt at 15%   │ halt at 20%   │               │           │
│  └───────────────┴───────────────┴───────────────┴───────────────┘           │
│                                                                              │
│  Changing mode applies to the next sizing decision. Open positions keep the   │
│  mode and limits they were created under.                                    │
│                                                                              │
│  The probability ceiling (0.750) does not change with mode.                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Custom parameters                            [ shown only when custom ]      │
│  Kelly fraction     [ 0.85 ]  ×      0 to 1.0                                │
│   ⚠ Above 0.75×, Kelly sizing is highly sensitive to probability error.      │
│     Full Kelly assumes the probability is exactly right.                     │
│  Per-game cap       [ 12 ]   %       1 to 50, % of current active bankroll    │
│  Per-slate cap      [ 30 ]   %       1 to 50, must be ≥ per-game cap          │
│  Drawdown halt      [ 20 ]   %       1 to 50                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Bankroll                                                                     │
│  Starting bankroll  [ 1000.00 ] $     locked once the first position fills    │
│  Withdrawal ceiling [ 1.5 ]     ×     of starting bankroll = $1,500.00        │
│   When active bankroll exceeds the ceiling, the excess is withdrawn to        │
│   simulated withdrawn profit and active bankroll returns to $1,500.00.        │
│   This repeats each time the ceiling is exceeded.                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Autonomous execution                                                         │
│  [ ● ] Enabled — cycles run automatically before each game window            │
│  Cutoff: no new position inside 10 minutes of kickoff (not configurable)      │
├──────────────────────────────────────────────────────────────────────────────┤
│                                          [ Cancel ]  [ Save configuration ]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Risk mode | enum | yes | `conservative` | One of four. Selecting a preset clears any custom values from the form but does not delete stored ones |
| Kelly fraction | decimal | when `custom` | current preset's value | 0 ≤ x ≤ 1.0, two decimals. Above 0.75 shows a **persistent inline warning**, never blocks |
| Per-game cap % | integer | when `custom` | current preset's value | 1–50 |
| Per-slate cap % | integer | when `custom` | current preset's value | 1–50, must be ≥ per-game cap. Inline error otherwise |
| Drawdown halt % | integer | when `custom` | current preset's value | 1–50 |
| Starting bankroll | currency | yes | `1000.00` | > 0. **Disabled once any position has filled**, with helper text `Locked — the campaign has positions. Starting bankroll defines the historical record.` |
| Withdrawal ceiling | decimal multiple | yes | `1.5` | ≥ 1.0. Renders its resolved dollar value live as it is typed |
| Autonomous execution | switch | yes | off | Turning on while a breaker is active is refused with an inline message pointing at the Overview |

### Validation

- Errors render inline beneath the field, in `error.main`, with the field outlined in error. No error is reported only in a notification.
- `Save configuration` is disabled while any field is invalid and while nothing has changed. The disabled reason renders as helper text beside the button.
- A Kelly fraction above 0.75 is **valid**. Its warning is `warning.main`, persistent, non-blocking, and re-renders on the confirmation step.
- Cancel restores the stored values and clears errors, without a confirmation prompt when nothing changed; with one when something did.
- Changing the risk mode requires a small confirmation `Dialog` stating the outgoing and incoming parameters and the sentence about open positions keeping their original limits.

### Empty / loading / error

No empty state — configuration always has values, defaulting to the presets. Loading: skeleton cards matching the mode grid. Save failure: `Alert severity="error"` above the actions with the reason, form values preserved, nothing partially applied.

---

## 13. Screen 9: Force Override

### Purpose

Let William deliberately resume autonomous trading while a safety condition is still breached — with enough friction, and enough stated fact, that it cannot happen by momentum.

### URL pattern

`/autonomy/override`

Reached only from the Overview's state banner, only while at least one breach is active. Direct navigation with no active breach renders `No active breach to override.` and a link back.

### Why a route and not a dialog

Principle 4: a control that overrides a halt must not live adjacent to the control that clears one. A dialog opened from the same banner as `Resume` would be one mis-tap away. A route makes the override a place you go.

### Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Autonomy                                                                   │
│ Force override                                                               │
│ Paper mode · all figures simulated                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Force override resumes autonomous trading while a safety condition is still   │
│ breached. Ordinary Resume is not available because the condition has not      │
│ cleared. The breaker remains active and will evaluate again on the next       │
│ cycle — this does not disable it.                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ Active breaches — select each one you are overriding                          │
│                                                                              │
│  [ ] drawdown halt                                                           │
│        condition   active bankroll below high-water mark by more than the     │
│                    mode's halt threshold, measured mark-to-market             │
│        measured    11.2%   ($912.40 against a high-water mark of $1,027.90)   │
│        threshold   10.0%   (conservative)                                     │
│        tripped     Sun 26 Oct 1:47p ET                                        │
│                                                                              │
│  [ ] calibration                                                             │
│        condition   rolling Brier behind the market by more than the tolerance │
│        measured    0.229 model vs 0.221 market  (+0.008 over the +0.020 bound;│
│                    118 of a 100-prediction window, minimum 30)                │
│        threshold   +0.020                                                     │
│        tripped     Sun 26 Oct 1:47p ET                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Autonomous trading will resume with these conditions still breached. Each      │
│ override is recorded permanently against this campaign and appears in review.  │
│                                                                              │
│                        [ Cancel ]   [ Force override and resume ]  (disabled) │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Explanatory block** | `Alert severity="warning"` at the top | States what override does, why Resume is unavailable, and that the breaker is not disabled. Not dismissible |
| **Breach selector** | One `FormControlLabel` + `Checkbox` per active breach, inside a `warning.soft` bordered `Box` | **Per-condition acknowledgement, not a single "I understand".** Each unchecked breach keeps the action disabled. This is the structural distinction from Resume required by the pitch |
| **Breach facts** | Four labelled lines per breach — condition, measured, threshold, tripped | Rendered *before* the button is enabled, per the pitch's Definition of Done. Measured values carry their full derivation, not just a percentage |
| **Action** | `Button variant="outlined" color="warning"` labelled `Force override and resume` | Outlined, warning-toned, right-most, and **not** the visually dominant element. Enabled only when every active breach is checked. Never labelled `Resume` |
| **Cancel** | `Button variant="text"` | Returns to Overview, nothing recorded |

### Behavior

- On success: return to `/autonomy`, state banner changes from `Halted` to `Autonomous — resumed over an active breach`, and a persistent `warning` notification reads `Force override recorded. Autonomous trading resumed with 2 conditions still breached.`
- The override record is permanent and appears in Review's safety-events table with `force_overridden` resolution, the acting user, and the timestamp — and never subsequently renders as `cleared`, even after the condition later clears on its own.
- If a breach clears between page load and submit, the submit is refused with an inline message: `The drawdown halt has cleared. Use Resume instead.` and a link. Overriding a condition that is no longer breached would put a false record in the audit trail.
- If the kill switch is engaged, force override is unavailable entirely: `The kill switch is engaged. Disengage it before resuming.` A human halt outranks a breaker override.

---

## 14. Health surface additions

Three signals join the existing Health screen (admin-only, already), following its established shape — last success, timestamp, amber outside bounds:

| Signal | Bound | Amber when |
| ------ | ----- | ---------- |
| Last successful autonomous cycle | game-relative | A game window has passed its execution window with no cycle recorded |
| Last successful paper settlement pass | 3 hours while positions await settlement | Older than the bound with open positions on completed games |
| Autonomy state | — | `halted` or `killed` renders amber/red with the breach count; `disabled` renders neutral, not amber, because being off is a decision, not a fault |

`disabled` deliberately does not raise an alarm. Health reports failures, and choosing not to run the bot is not one.

---

## 15. Navigation flows

```text
Autonomy overview ──[row click]──→ Cycle detail ──[player name]──→ Contract detail (shared)
        │                                │
        │                                └──[← Cycles]──→ Cycles list
        │
        ├──[Kill autonomy]──→ (in place, no navigation, no dialog) → state banner appears
        │
        ├──[Resume]──→ confirmation Dialog ──[confirm]──→ (in place) → banner clears
        │
        ├──[Force override →]──→ /autonomy/override ──[confirm]──→ back to /autonomy
        │                                            └──[Cancel]──→ back to /autonomy
        │
        ├──[Configure →]──→ /autonomy/configuration ──[Save]──→ back to /autonomy
        │
        └──[readiness →]──→ /autonomy/readiness ──[Accuracy →]──→ /accuracy (shared)

Review ──[Run replay]──→ (in place, section-scoped progress) → replay table populates
       └── never navigates on completion; the result belongs beside the actual result

Any Autonomy route reached by a viewer ──→ server-side 403 rendered in place,
                                            no autonomy chrome drawn first
```

**State carried between screens.** Cycles' season/week selection is deep-linked and preserved when returning from a cycle detail. Positions' status filter is deep-linked. Review's granularity and period are deep-linked, so a specific week's review is a shareable-with-nobody but bookmarkable URL. Returning from a cycle detail to the cycles list preserves scroll position.

---

## 16. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Cycles list | `↑` / `↓` | Move between rows |
| Cycles list | `Enter` | Open cycle detail |
| Cycle detail | `Esc` | Back to cycles, focus returns to the originating row |
| Positions | `↑` / `↓` | Move between rows |
| Any dialog | `Tab` | Trapped within the dialog |
| Configuration | `Enter` in a field | Does **not** submit. Save is an explicit click or `Enter` on the focused Save button |
| Force override | — | **No keyboard shortcut, no `Enter`-to-submit from a checkbox.** The action requires focusing and activating the button |

No shortcut anywhere in this feature kills, resumes, overrides, or saves configuration. The kill switch is a large, always-visible button rather than a keystroke, because a keystroke that halts trading is also a keystroke that halts trading by accident.

### Loading states

`Skeleton` at final row heights on every list. Two rules specific here:

- The kill switch, the paper-mode subtitle, and the state banner's severity are rendered from the first byte and never skeleton.
- Dry Run and Replay show scoped progress (`LinearProgress` under their own section heading) rather than replacing the page, because both are user-initiated computations with a visible duration and the surrounding context stays useful.

### Error states

MUI `Alert` with plain-English causes and a `Retry` where retry could help. Feature-specific:

- **Kalshi unavailable** is a designed degraded mode on Positions and Overview: mark-to-market reports `unavailable` with a last-fetch timestamp; cost basis, realised P&L, and settled figures are unaffected; one banner explains it at the top. It is **not** a designed degraded mode for an autonomous cycle — a cycle that cannot read prices records itself as `failed` and creates nothing, which is a visible outcome rather than an error state on a screen.
- **A failed cycle is not an error state on the Cycles screen.** It is a row with an outcome and a reason. The screen only enters an error state when the *read* fails.
- Destructive errors never silently discard input: a failed configuration save preserves every field including the invalid one.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Kill engaged | `Autonomy killed. No new positions will be created.` | warning | persistent until dismissed |
| Kill disengaged | `Kill switch disengaged. Breakers still apply.` | info | 4s |
| Resume | `Autonomous trading resumed.` | success | 3s |
| Force override | `Force override recorded. Autonomous trading resumed with N conditions still breached.` | warning | persistent until dismissed |
| Configuration saved | `Configuration saved. Applies to the next sizing decision.` | success | 4s |
| Risk mode changed | `Risk mode changed to moderate. Open positions keep their original limits.` | success | 4s |
| Dry run complete | none — the result panel is the feedback | — | — |
| Replay complete | none — the table populating is the feedback | — | — |
| Autonomy enabled | `Autonomous paper trading enabled.` | success | 4s |

Kill and force override are the two persistent notifications in this feature, deliberately: both change whether a bot is trading, and a toast that vanishes is not an adequate record of either.

### Destructive and irreversible actions

| Action | Pattern |
| ------ | ------- |
| Kill | **No confirmation.** Immediate. The pitch requires this — the kill switch stops first and asks questions later |
| Disengage kill | Confirmation `Dialog`: `Disengage the kill switch? Autonomous trading resumes if no breaker is active.` |
| Resume after a breaker | Confirmation `Dialog` listing the cleared conditions |
| Force override | Full route with per-condition acknowledgement (Screen 8) |
| Change risk mode | Confirmation `Dialog` with outgoing/incoming parameters |
| Change starting bankroll | Disabled once positions exist; no confirmation needed because the destructive path is closed rather than guarded |
| Enable autonomy | Confirmation `Dialog`: `Enable autonomous paper trading? Cycles will run before each game window without further approval. Positions are simulated.` |

There is no "reset campaign", no "clear positions", and no "delete bankroll history" control anywhere in this feature. Paper history is a record; the interface offers no way to erase it.

---

## 17. Responsive behavior

| Breakpoint | Behavior |
| ---------- | -------- |
| `xs` 0–599 | Headline figures 2×2. Exposure meters stack. Chart 180px tall, legend beneath. Cycles, positions, and candidate cards wrap to two lines — never become cards. Kill switch fixed to a bottom bar, always reachable. Configuration's four mode cards stack vertically with their parameter lists intact. Replay table scrolls **within its own container** with the mode column pinned — the page never scrolls horizontally |
| `sm` 600–899 | Headline figures in a row of four. Cycles return to one line. Mode cards 2×2 |
| `md` 900–1199 | Full layout as wireframed. Secondary tab row becomes horizontal. Chart 220px |
| `lg` 1200–1535 | All table columns visible without truncation |
| `xl` 1536+ | Content max-width applies; tables do not stretch |

Every action is reachable at `xs`, including force override (its checkboxes and facts stack) and every configuration field. Candidate-card row height is identical for filled, partial, no-stake, and refused candidates at every breakpoint — a taller "interesting" card breaks the scan down the `bound by:` column, which is the reason the column exists.

---

## 18. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `KillSwitchButton` | Overview (all Autonomy surfaces at `xs`) | new | Two states: armed, engaged. No confirmation on engage |
| `AutonomyStateBanner` | Overview | new | Variants: active (absent), warning, halted, killed. Renders every simultaneous breach |
| `BankrollHeadline` | Overview, Review | new | Four figures with decomposition sub-lines |
| `ExposureMeter` | Overview, Dry Run footer | new | Bordered track, cap value and percentage both labelled |
| `BankrollChart` | Overview, Review | new | Recharts, theme-driven, two series, two reference lines, text-equivalent summary |
| `CandidateCard` | Cycle detail, Dry Run | new | Shared deliberately; verb tense is the only difference. Variants: filled, partial, no stake, refused, blocked |
| `BoundByLabel` | Candidate card | new | The eleven constraint values as a closed set; never renders blank |
| `RiskModeChip` | Overview, Cycles header, Review, Configuration | new | Four modes; `custom` carries its fraction inline |
| `BreachRow` | Overview banner, Review safety events, Force override | new | Condition, measured, threshold, tripped-at. One shape everywhere so the same facts always appear |
| `ReadinessCriterion` | Readiness | new | Glyph + label + evidence line. Unevaluable renders as not-met |
| `PaperModeSubtitle` | All seven surfaces | new | The permanent "simulated" disclosure |
| `NumericText` | everywhere | **reused** | Existing primitive; tabular figures |
| `StatusChip` | Positions, Cycles | **reused** | Existing primitive, extended with the position and cycle-outcome variants |
| `EmptyState` | every list | **reused** | Existing primitive |
| `HealthStateChip` | Health additions | **reused** | Existing primitive |

`CandidateCard` and `BoundByLabel` are the two components most worth getting right: they are the audit trail, and every other screen in this feature is a summary of what they say.

---

## 19. Accessibility, privacy, and data sensitivity

### Accessibility

- Every chip, glyph, and meter has a text equivalent. The readiness `✓`/`✗` glyphs carry `aria-label` of `met` / `not met`; the exposure meter is an ARIA `meter` with `aria-valuenow`, `aria-valuemax`, and a label naming the game or slate.
- The bankroll chart carries a `visuallyHidden` text summary: starting value, ending value, high-water mark, halt threshold, direction, and the number of points — a chart that exists only as an SVG is unreadable, and this one carries the drawdown story.
- **No state relies on colour alone.** Every breach has a word; every P&L has a sign; every fill state has a label; every constraint has a name; the halt threshold line on the chart is dashed as well as coloured.
- The state banner uses `role="alert"` so a breaker trip discovered on page load is announced.
- The kill switch has an accessible name that states its effect, not just `Kill` — `Kill autonomy: stop creating new simulated positions`.
- Configuration fields have labels, helper text, and error text associated by `aria-describedby`. The Kelly-fraction warning is `aria-live="polite"` so it announces when crossing 0.75.
- Force override's checkboxes are individually labelled with their condition name, and the submit button's disabled state has a described reason.
- Focus moves into dialogs and returns to the trigger on close. Force override's route places focus on its heading.

### Privacy

- **Every surface in this feature is admin-only and rejected server-side.** A viewer deep-linking to any of the seven routes gets a 403 rendered in place with no autonomy chrome drawn first — no shell, no nav highlight, no skeleton.
- The Autonomy nav item is **absent** for viewers, never disabled or locked. Absence must be indistinguishable from non-existence.
- No autonomy state appears on any shared surface. The slate, contract detail, and the accuracy surface are unchanged by this feature; a viewer cannot infer from any shared screen that a bot exists, that positions exist, or that a bankroll exists.
- **Nothing in this feature accepts, stores, transmits, or displays a Kalshi credential**, and no surface implies one could be supplied. There is no account-connection affordance, no balance read, no order control, and no field of any kind that could hold key material. The Kalshi signing key does not appear on Configuration, Health, or in any error message on any of these screens.
- Error messages from the Kalshi client render their sanitized message only. A cycle that failed shows `Kalshi unavailable`, never a URL, never a header, never a response body.
- Paper figures are never described as real money, and no surface offers to convert, transfer, or activate anything.

---

## 20. Decisions settled for this document

Numbered continuing from the twelve pre-resolved in the run instruction; each is restated in the spec with the same number.

**13. Route namespace is `/autonomy`, admin-only, one nav section.** The build invariants' existing ban on a `/bankroll` route stays, because it guards the deferred V2 portfolio-management product, which this is not. Seven surfaces under one nav item with a secondary tab row, rather than seven nav items.

**14. Readiness states use the pitch's three words verbatim** — `Not Ready`, `Paper Evidence Building`, `Eligible for Live Trading` — rendered lowercase in the chip per house style. `Eligible` is an outlined chip, never filled, never adjacent to a button, and its standing disclaimer is *stronger* when eligible than when not.

**15. Review periods are game window, NFL week, and campaign-to-date.** No rolling windows, no calendar months, no custom ranges — matching the accuracy surface's decision that the season and its weeks are the product's time vocabulary.

**16. Confidence enters sizing by multiplying the Kelly fraction by the existing `CONFIDENCE_WEIGHTS`** (`high 1.0`, `medium 0.7`, `low 0.4`) already exported from `src/lib/slate/edge.ts`. Reusing the constant means the weight the slate ranks by and the weight the bot stakes by cannot drift apart; inventing a second confidence scale for money would be the drift.

**17. Money is neutral-toned, not mint.** Ledger dollars are Sightline's own fiction and must not borrow the market's provenance colour. Only a P&L's sign takes colour.

**18. The candidate card is one component shared by Cycle detail and Dry Run**, differing only in verb tense. Any divergence between what Dry Run shows and what a cycle does would defeat the point of Dry Run.

**19. `bound by:` is a required, closed-set field on every candidate**, never blank and never `—`. Eleven values: `none`, `top-of-book size`, `per-game cap`, `per-slate cap`, `available bankroll`, `probability ceiling`, `no edge after fees`, `stale projection`, `price unavailable`, `10-minute cutoff`, `breaker: <condition>`.

**20. Force Override is a route, not a dialog, with per-condition acknowledgement.** Structural distinction from Resume, per pre-resolved decision 11: a separate place, a checkbox per breached condition rather than one generic acknowledgement, all four facts rendered before the button enables, and an outlined warning-toned button that is never the dominant element.

**21. Mark-to-market unavailable means drawdown reports unavailable**, not a settled-only fallback. A drawdown figure computed on a different basis than the breaker's would misrepresent the safety state.

**22. A `force_overridden` breach resolution never ages into `cleared`.** It renders permanently in warning tone in Review, with actor and timestamp, even after the underlying condition clears.

**23. Autonomy `disabled` is neutral on Health, not amber.** Choosing not to run the bot is a decision, not a fault; Health reports failures.

**24. The slate and contract detail are untouched.** No paper-position annotation on a shared surface, even admin-conditionally — the leak risk on a viewer-visible screen outweighs the convenience, and Positions already answers the question.

**25. There is no reset, clear, or delete control anywhere in this feature.** Paper history is a record. Overwriting it when settings change is a No-Go, and the interface offers no path to it.

---

## 21. Out of scope

### Deferred to a later pitch — the design must not preclude these

- **Real order placement, real fills, and reconciliation** — the Kalshi Trading pitch. The candidate card, the position row, and the ledger shapes are built so a live counterpart can sit beside them, but nothing here submits an order or reads a portfolio.
- **A paper→live mode switch.** This pitch has no operating-mode toggle at all; the only mode it changes is risk mode. The switch belongs to Kalshi Trading and is a human action there.
- **Real withdrawal execution or notification.** Paper withdrawals are automatic and simulated; the real-money counterpart is notification-only and lives in a later pitch.
- **Joint-distribution correlation modelling.** Until the Simulation Engine ships, the per-game cap is the correlation defence, and the interface says so on Configuration rather than implying a correlation model exists.
- **Bankroll and portfolio management as a product** (V2) — multiple bankrolls, allocation across strategies, tax lots. This feature keeps exactly one paper bankroll.
- **Adjustment suggestions feeding sizing.** Shadow-adjusted projections are graded elsewhere; sizing consumes the base projection's corrected probability in this pitch.

### Permanent non-goals — not to be relitigated

- Sportsbook or DFS integration of any kind.
- Public or commercial access. These surfaces are for one admin.
- Live in-game trading. Every cycle stops ten minutes before kickoff.
- Viewers trading through Sightline, viewer bankrolls, or any surface that accepts a viewer's Kalshi credential.
- Sightline authorising itself to risk real money. No control in this feature, in any state, moves the system from paper to live.
- General portfolio management, a trading cockpit of tunable sliders, or a generalized exchange abstraction.

---

## 22. Open questions

None. Every question this document faced was resolvable from the pitch, the run instruction's pre-resolved numeric defaults, the approved planning docs, or existing codebase patterns, and each resolution is recorded in §20. Questions of arithmetic — the recalibration fit, the fee formula, the mark-to-market basis, the reallocation bound — are implementation questions and are resolved in the technical spec, not here.
