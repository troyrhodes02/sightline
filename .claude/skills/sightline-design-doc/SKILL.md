---
name: sightline-design-doc
description: >
  Generate design documents for Sightline features. Use when creating UI/UX
  specifications, screen-by-screen designs, wireframes, or state definitions, or
  when the user mentions "design doc", "design document", "UX spec", "screen
  spec", "wireframe the slate", or needs to document how a Sightline feature
  should look and behave before it is specced. Design docs define the visual and
  interaction layer — what the user sees, how they interact, what states exist,
  and how screens connect. Requires an expanded pitch document as input for scope
  and problem context; this skill does not generate pitches. Trigger before any
  Sightline UI work is specced or built.
---

# Sightline Design Document Generator

Generate design documents that specify the UI/UX experience for Sightline features. Design docs sit between pitch documents and technical specs. They define what the user sees, how they interact, what states exist, and how the screens connect.

Sightline tells its admin which of today's Kalshi NFL player-prop contracts are mispriced, and how much to trust that judgment. Access is invite-only: one admin who sees everything and logs decisions, and viewer accounts who see the shared analytical surfaces and nothing personal. Every screen exists to help answer one question — *is this price wrong, and how much should I trust that?* — so the priority on every surface is putting a number and its uncertainty in the same glance.

Per Sightline's approved **instrument, not sportsbook** direction (dense, quiet, numeric, provisional, legible, unflattering), the interface must read as a measurement tool and must never read as a picks product. The user is a CS-trained engineer who reads reliability curves and wants the model's reasoning exposed rather than hidden behind a verdict, which rules out simplifying away confidence, sample size, or timestamps in the name of cleanliness.

See the `sightline-ui-design` skill for full brand and visual-language detail — palette, typography, appearance modes, mock-data vocabulary, and per-surface guidance. Do not reproduce those here.

## Scope: which pitches get a design doc

Design docs apply to pitches that ship user-facing surfaces: App Shell, Brand & Access; Kalshi Sync, The Slate & Decision Log; Live Pipeline & Staleness; Outcome Scoring & Accuracy Surface; Adjustment Suggestions & Source Reliability; and Kalshi Trading.

Corpus & Point-in-Time Foundation, Backtest Harness & Baseline Model, and Simulation Engine ship no interface. They do not get a design doc, and a request to produce one for them is a signal that the pitch scope was misread. Say so rather than inventing screens.

## Where design docs fit

```text
Pitch Document → Design Document → Technical Spec → Tickets → Build
(why + scope)    (what users see)   (how it's built)  (work units)
```

- **Pitch** answers: why are we building this? What is in scope? What is out of scope?
- **Design Doc** answers: what does the user see? How do they interact? What are the states?
- **Spec** answers: what is the data model? What are the route handler contracts? How do we test it?
- **Tickets** answer: what specific implementation tasks need to be completed?

Design docs must stay in the UI/UX layer. Do not define Prisma schemas, route handler request and response contracts, transaction boundaries, or implementation tasks. Do not specify how edge is computed — only how it is displayed. That belongs to the technical spec and ticketing stages, and a design doc that eats the spec's job produces a spec that either contradicts it or rubber-stamps it.

## Prerequisites

Before writing a design doc, ensure you have:

1. **Expanded pitch document** — feature scope, problem, appetite, no-gos, definition of done. **This is a required input supplied by the user.** This skill does not generate pitches and never should; pitches are drafted outside this pipeline and moved into the codebase as context.
2. **`docs/planning/prd.md`** — feature inventory, user journeys, acceptance criteria, edge cases.
3. **`docs/planning/architecture.md`** — technical ground truth, especially the data model's enum values.
4. **`docs/planning/product-brief.md`** — core job, success definition, non-goals, riskiest assumption.
5. **`CLAUDE.md`** — repo engineering context and invariants.
6. **`sightline-ui-design`** — brand system, palette, typography, appearance modes.
7. **The Material UI theme in the codebase** — reference it. Do not invent a second styling system.
8. **Workflow context** — reference the real moments from the PRD journeys: opening the slate some hours before the early window on a phone; noticing a game marked stale because inactives dropped and have not been ingested; marking took, faded, or skipped with one tap; opening the accuracy surface in June when no games are scheduled.

## File conventions

- **Filename:** `feature-name-design-doc.md`
- **Location:** the pitch folder, or as specified by the user
- **Format:** Markdown, with TypeScript/React code blocks for component specifications and ASCII wireframes for layout

## Required sections

Every design doc must include these sections in order.

### 1. Title & metadata

```markdown
# Feature Name — Design Document

**Version:** X.Y
**Pitch Source:** Sightline — Pitch N: Feature Name
**Focus:** One-line description of what this design doc covers
```

- Use the exact pitch name from `docs/planning/pitch-roadmap.md` and the exact feature names from `docs/planning/prd.md`.
- Do not rename PRD features. Names are load-bearing across pitch, design doc, spec, and ticket.
- Keep the focus line user-facing, not implementation-facing.

### 2. Vision

Two to three sentences maximum. Frame the feature from the user's perspective: what question does this screen answer, and what decision does it help him make?

End with a **design north star**: a short phrase capturing the aesthetic and interaction philosophy for this feature.

Worked example, in Sightline's voice:

> The slate is the screen William opens on a Sunday morning with twenty minutes before the early window. It has to answer *which of these fourteen contracts is worth a second look* without him reading fourteen detail views, and it has to be honest when the answer is none of them. **North star: a ranked list that admits what it does not know.**

Frame around real questions:

- Which contracts does Sightline disagree with the market about, and by how much?
- How much should I trust this particular projection?
- Is this number current, or does it predate something I already know?
- How well has the model actually done, and on how many predictions?
- What did I decide, and was I right?

### 3. Design principles

Include three to five numbered principles. Each gets a short name and a one-to-two sentence explanation. These must be specific to the feature and usable as tiebreakers by a developer making a decision mid-implementation, not motivational wallpaper.

```markdown
### 1. Principle Name

What it means and how it affects design decisions for this feature.
```

Sightline-specific principle themes worth drawing from:

- **Uncertainty travels with the number** — resolves the tension between a clean display and an honest one. A probability without confidence, a rate without sample size, or a projection without a timestamp is incomplete, and there is no "simplified" version that drops them.
- **Nothing is a legitimate answer** — resolves the tension between an interface that always has something to show and one that tells the truth. A slate where nothing clears the recommendation threshold, a bucket with too few observations, and an empty June slate must all read as designed answers rather than failures.
- **Provenance is visible** — resolves the tension between a unified display and a two-source one. Every number came from either Sightline's model or the Kalshi market, and the interface says which without requiring a label.
- **Disclose, don't race** — resolves the tension between appearing current and being current. Sightline is structurally the slowest participant in the market; a projection that admits it predates inactives is more useful than one that silently pretends otherwise.
- **Density over drill-down** — resolves the tension between scannable rows and complete rows. The primary reading context is a phone, and a design that requires opening a detail view to learn whether a row matters has failed at its job.
- **The instrument does not flatter its operator** — resolves the tension between an encouraging interface and an accurate one. The product grades the admin's own decisions and must be able to display that they were bad.

### 4. Visual language

Sightline uses **Material UI** as the single component and styling system. Design docs must specify visual behavior in terms of MUI components, theme tokens, and `sx` patterns.

Do **not** introduce Tailwind, styled-components, CSS modules, hand-authored stylesheets, utility CSS conventions, or a second component library. Charts use Recharts, always wrapped in a component that reads its colours and typography from the MUI theme.

Always include this sentence in the generated design doc:

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

#### Color palette

Document **only the theme tokens this feature uses.** Use semantic references first. See `sightline-ui-design` for the canonical palette — do not reproduce the full theme here. A feature-scoped subset is scoping, not duplication; reproducing the whole theme in every design doc is how seven copies diverge.

| Token / theme path | Usage | Notes |
| ------------------ | ----- | ----- |
| `palette.primary.main` | Model-derived values: projection, interval, threshold probability, confidence | The model accent. Never applied to market values. |
| `palette.market.main` | Kalshi-derived values: price, book sides, spread, settlement | Nothing model-derived wears this. |
| `palette.warning.main` | Staleness, degraded mode, low confidence, insufficient sample | Caution only. Never means "bad price" or "loss". |
| `palette.error.main` | Negative edge, destructive actions | Desaturated deliberately; reads as encoding, not payout. |

#### State colors

Sightline displays several enums. Define the mapping using the **exact values from the data model** — do not invent state names.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| `took` | Model accent, filled | Position taken on the contract |
| `faded` | Error tone, filled | Position taken on the other side — not the same as passing |
| `skipped` | Neutral, outlined | Passed entirely |
| unmarked | No indicator at all | The absence of a decision row; never rendered as a fourth chip |
| `pending` | Warning tone, outlined | Adjustment suggestion awaiting the admin |
| `accepted` | Model accent, outlined | Suggestion applied to the displayed projection |
| `declined` | Neutral, outlined | Suggestion not applied; shadow still graded |
| `high` / `medium` / `low` | Confidence indicator, three steps | Always displayed alongside the probability it qualifies |
| stale | Warning tone, list-visible badge | Game passed the inactives boundary without ingest |
| unresolved | Warning tone, distinct from stale | Contract Sightline could not map to a player |
| prices unavailable | Neutral with timestamp | Kalshi degraded mode — a designed state, not an error |

- Use color as reinforcement, never as the only indicator. Edge direction must also carry an explicit sign and an arrow glyph so the encoding survives greyscale and colourblindness.
- Always pair state color with readable text.
- Terminal and exceptional states — voided market, unresolvable grading, revoked user — must be visually distinct from active ones.

#### Typography, spacing, radius, elevation

Reference `sightline-ui-design` for the scale. In the design doc, document only the variants this feature uses and any feature-specific deviation with its justification. Two rules recur often enough to restate: every computed numeric uses the monospace family with tabular figures, and no data value is bolded to signal importance.

#### Appearance

Sightline supports light, dark, and system, with system as the default and selection living in Settings only. Design every screen theme-aware via theme tokens rather than hardcoded colours. Where a screen looks meaningfully different between modes — most often charts and the staleness treatment — note it in that screen's Layout or Behavior subsection.

### 5. Information architecture

Include an ASCII diagram showing page hierarchy and navigation relationships, so a reader gets a birds-eye view before individual screens.

```text
Sightline
├── Slate                        (shared)  ← default landing
│   └── Contract detail          (shared)  ← drawer on mobile, page on desktop
├── Accuracy                     (shared)
│   ├── Reliability & baselines
│   └── Override performance     (admin only)
├── Backtests                    (shared)
│   └── Run detail
├── Decisions                    (admin only)
├── Health                       (shared)
├── Settings                     (shared)  ← appearance selection lives here
└── Users                        (admin only)
```

- Show where this feature lives in Sightline's navigation.
- Show how its screens relate to the Slate, which is the default landing surface and the one every other surface is secondary to.
- Indicate primary vs. secondary content hierarchy, and mark admin-only surfaces explicitly.
- Keep it simple. This is orientation, not detailed wireframing.

### 6. Screen specifications

This is the core of the design doc. Each screen gets its own section with the same structure.

````markdown
## Screen N: Screen Name

### Purpose
One sentence: what does this screen help the user accomplish?

### URL pattern
`/route/pattern`

### Trigger
What user action opens this screen, modal, drawer, or state?

### Layout
ASCII wireframe showing the spatial arrangement of elements.

### Component sections
| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Element** | component, props, sx notes | interaction notes |

### Code reference
TypeScript/React snippet showing component structure.

### Fields
| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |

### Validation
- Required field behavior
- Inline error messages
- Submit enabled/disabled behavior
- Non-blocking warnings
- Draft preservation behavior

### Empty state
Wireframe and code example for when there is no data.

### Loading state
Skeletons, disabled controls, progressive loading behavior.

### Error state
Recoverable errors, retry behavior, destructive-action safeguards.

### Behavior
- What happens on success and on error
- Notification messages
- Focus management
- Keyboard behavior
- Navigation after save/cancel
````

Screen specification guidelines:

- Every screen needs a **Purpose**. If you cannot explain it in one sentence, the screen is doing too much.
- Use ASCII wireframes before code. The wireframe communicates layout intent; the code communicates implementation shape.
- Use real component names and theme references, not "make it amber."
- **Empty, loading, and error states are required for every list, block, section, and area that can have no data.** This is the most common gap in design docs and the reason features ship looking broken the first time a query returns nothing. In Sightline it is worse than usual, because the empty slate is the most-viewed state of the year.
- Interactions must be explicit: hover, click, keyboard, focus, disabled, confirmation, cancellation.
- Form screens need fields tables with type, required/optional, validation, and defaults.
- Avoid implementation internals that belong in the technical spec.

### 7. Navigation flows

Document how screens connect, using ASCII flow diagrams. Include what triggers navigation; whether it is full-page, modal, drawer, or inline; what state carries between screens; query params, highlighted rows, return paths; and deep-linking behavior.

Sightline-specific flows worth documenting when in scope:

- Slate row → contract detail → take/fade/skip → return to slate with the row's disposition reflected in place, scroll position preserved.
- Contract detail → pending adjustment suggestion → accept or decline → displayed projection updates in place without navigation.
- Accuracy → filter by stat type or period → deep-linkable state, so a filtered view can be returned to.
- Contract detail → trading order entry → explicit confirmation step → result reported in place, never as a redirect to a success page.
- Any admin route reached by a viewer → server-side rejection, not a client-side redirect after a partial render.

### 8. Interaction specifications

#### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Slate list | `↑` / `↓` | Move between rows |
| Slate list | `Enter` | Open contract detail |
| Contract detail | `Esc` | Close drawer, return focus to the originating row |
| Decision control | `T` / `F` / `S` | Took / faded / skipped, only when a row or detail has focus |
| Any dialog | `Tab` | Cycles within the dialog; focus is trapped |

- Do not invent shortcuts unless they serve the feature and are documented visibly in the interface.
- Slate review and decision logging are the high-frequency flows and must be fully keyboard-operable on desktop.
- Focus moves into modals and drawers when opened and returns to the trigger when closed.
- No shortcut may submit a Kalshi order. Order confirmation is always an explicit pointer or `Enter`-on-focused-button action.

#### Loading states

Document loading behavior per screen or major component using MUI's `Skeleton`. Skeleton rows must match final row height so the layout does not shift. The slate renders from stored data and must **never** show a spinner waiting on a model run; price cells may resolve after their row, and the row does not wait for them.

#### Error states

Use MUI `Alert` and inline field errors with retry actions where retry could help.

- Errors are plain-English and action-oriented.
- Preserve user input whenever possible.
- Destructive errors must never silently remove user data.
- **Kalshi unavailable is not an error.** It is a designed degraded mode: projections still render, price and edge show as unavailable with the timestamp of the last successful fetch, and one banner explains it at the top rather than repeating per row.
- A stale projection is not an error either. It is a disclosure, and it belongs in the row rather than in an alert.

#### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Decision logged | `Marked as took` | success | 3s |
| Decision changed | `Changed to faded` | success | 3s |
| Suggestion accepted | `Projection updated` | success | 3s |
| Suggestion declined | `Suggestion declined` | info | 3s |
| Prices refreshed | none — the timestamp updating is the feedback | — | — |
| Order rejected | `Order rejected: {reason from Kalshi}` | error | persistent until dismissed |
| Access revoked | `Access revoked for {email}` | success | 4s |

- Do not use notifications as the only place for validation errors. Inline errors belong next to the field or action that caused them.
- Never use a notification to report an order result. Fill, partial fill, and rejection are reported in place on the order surface, because a dismissed toast is not an acceptable record of a money movement.

#### Destructive actions

Document confirmation patterns for: revoking a user's access, placing a Kalshi order, and changing a decision that has already been logged.

- Use confirmation dialogs only when the action is destructive or meaningfully irreversible.
- Order placement always requires an explicit confirmation step showing size, the price actually payable, and total cost. It is never a single tap, and the confirm control is not the visually dominant element on the screen.
- Keep confirmation copy specific. `Revoke access for dana@example.com? They will be signed out immediately.` — not `Are you sure?`

### 9. Responsive behavior

Sightline is **mobile-first**, with desktop as the fuller expression. The slate is read on a phone on a Sunday morning; that is the design target, not a fallback.

| Breakpoint | Width | Behavior |
| ---------- | ----- | -------- |
| `xs` | 0–599 | Single column. Slate rows wrap to two lines rather than becoming cards. Contract detail is a full-height drawer. Primary actions sit within thumb reach at the bottom. |
| `sm` | 600–899 | Single column with wider gutters; slate rows return to one line. |
| `md` | 900–1199 | Slate list with contract detail as a side panel. Navigation moves from drawer to persistent. |
| `lg` | 1200–1535 | Full column set visible on the slate without truncation. |
| `xl` | 1536+ | Content max-width applies; the slate does not stretch to arbitrary width. |

For each screen, specify what stacks first, what collapses, what becomes a drawer or dialog, what remains visible, what is hidden, and whether every action remains available at `xs`. Nothing horizontally scrolls at any breakpoint. Slate row height must be identical for recommended and non-recommended rows at every breakpoint — a taller highlighted row breaks column scanning, which is the entire point of the list.

### 10. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `SlateRow` | Slate | new | Variants: recommended, below-threshold, stale, unresolved, no-projection |
| `ProbabilityValue` | Slate, detail, accuracy | reused | Monospace, tabular, always paired with confidence |
| `StaleBadge` | Slate, detail | reused | Must be legible in list view, not only detail |

- Identify components that should be reusable across pitches — the numeric display primitives and the state badges almost always are.
- Do not over-componentize in the design doc. Save implementation decomposition for the spec.
- Note key variants, especially across the recommended/below-threshold, current/stale, and resolved/unresolved dimensions.

### 11. Accessibility, privacy, and data sensitivity

Sightline stores one person's trading decisions, positions, and the reasoning behind them, plus a small set of invited users' account records. The decision log is the only human-generated data in the system and the only thing that cannot be reconstructed. Treat the UI as handling private data, because it is.

Accessibility requirements:

- All interactive controls have accessible names, including icon-only controls.
- **State indicators must not rely on color alone.** Edge direction carries a sign and an arrow; staleness carries a text label, not just an amber tint; confidence carries a word, not just a bar.
- Form fields have labels and helper or error text.
- Dialogs trap focus while open and return focus to the trigger on close.
- Keyboard navigation works for slate review, decision logging, and suggestion accept/decline.
- Error messages are screen-reader accessible and announced when they appear.
- Charts have a text-equivalent summary; a reliability curve that exists only as an SVG is unreadable to a screen reader, and it is the primary success metric of the product.

Privacy requirements:

- **A viewer must never see, and must never be able to infer, the admin's positions, decision log, override performance, or timing cost.** Do not render an admin-only region as a disabled or blurred placeholder — absence must be indistinguishable from non-existence.
- Admin-only surfaces are rejected server-side. The UI must not render a partial shell before discovering the user lacks permission.
- **The UI must never imply that viewers can trade through Sightline.** No order controls, no "connect your Kalshi account" affordance, no credential field of any kind on a viewer surface. Sightline does not custody another person's signing credentials, and the interface should not suggest it might.
- The Kalshi signing key must never appear in any surface, including admin settings, health, or an error message.
- User management rows show display name, email, role, invited date, and last active only.
- Links out to Kalshi open in a new context and are visibly external.
- Open-Meteo data is CC-BY 4.0 and requires a visible attribution link wherever weather data is displayed. This is a user-interface requirement, not a licence-file line.

### 12. Out of scope

Bullet list of what is explicitly not designed in this version. Keep two categories separate, because they behave differently:

- **Deferred to a later pitch** — not yet, and the design must not preclude it. Draw from `pitch-roadmap.md` and the PRD's Post-MVP list: bankroll and portfolio management, NBA, WNBA, friend pick sharing, additional stat types, additional suggestion sources.
- **Permanent non-goals** — never, and not to be relitigated. Draw from `product-brief.md`: sportsbook and DFS integration, public or commercial access, live in-game trading, film or tape-derived inputs, viewers trading through the application, and general sports data browsing.

## Style guidelines

### ASCII wireframes

- Use box-drawing characters: `┌ ─ ┐ │ └ ┘ ├ ┤`.
- Keep wireframes focused on spatial relationships.
- Label interactive elements with `[brackets]`.
- Use `→` for links or navigation.
- Show populated, empty, loading, and error states where relevant.

Worked example — the slate list at `xs`:

```text
┌────────────────────────────────────────────┐
│ Slate · Sun 26 Oct        [Refresh 11:42a] │
├────────────────────────────────────────────┤
│ ⚠ 1:00p games stale — inactives not ingested│
├────────────────────────────────────────────┤
│ Ja'Marr Chase  CIN · rec yds ≥ 74.5   ●REC │
│ model 61.4%   mkt 54¢   edge +7.4   conf hi│
├────────────────────────────────────────────┤
│ Bijan Robinson ATL · rush yds ≥ 54.5  ⚠STALE│
│ model 58.1%   mkt 55¢   edge +3.1   conf md│
├────────────────────────────────────────────┤
│ Puka Nacua     LAR · rec yds ≥ 89.5        │
│ model 41.0%   mkt 44¢   edge −3.0   conf lo│
└────────────────────────────────────────────┘
        ↑ below threshold: visible, de-emphasised
```

Empty state for the same screen:

```text
┌────────────────────────────────────────────┐
│ Slate                                      │
├────────────────────────────────────────────┤
│                                            │
│   No games scheduled.                      │
│   Next kickoff: Thu 30 Oct, 8:15p ET       │
│                                            │
│   [View accuracy]  [View backtests]        │
│                                            │
└────────────────────────────────────────────┘
```

### Code blocks

- Use TypeScript/React for component structure and styling.
- Prefer MUI components: `Stack`, `Box`, `Typography`, `Chip`, `Skeleton`, `Alert`, `Drawer`, `Dialog`, `Table`, `ToggleButtonGroup`.
- Use theme-aware props and `sx` with theme callbacks.
- Do not use Tailwind, styled-components, or CSS modules.
- Avoid raw hex values. If a colour is needed and no token exists, that is a signal the theme is incomplete — say so rather than inlining a hex.
- Include hover, focus, disabled, and selected states when they matter.
- Keep snippets structural, not full implementations.

### Tone

- Write descriptions in plain English.
- Use the domain vocabulary: contract, threshold, edge, confidence, drivers, slate, inactives, settlement — not "item", "record", or "entity".
- Say "predates today's inactives" rather than `informationCutoff < inactivesPublishedAt`.
- Be direct about success, error, edge cases, and what the user can do next.

## Workflow

1. **Receive the expanded pitch document** — read and understand the problem, scope, no-gos, appetite, definition of done.
2. **Cross-check upstream docs** — confirm alignment with `docs/planning/prd.md`, `product-brief.md`, `architecture.md`, and `pitch-roadmap.md`.
3. **Identify screens and surfaces** — pages, drawers, dialogs, panels, empty states, navigation paths, and every failure variant.
4. **Clarify with the user when needed** — only about decisions not already settled by the pitch or upstream docs.
5. **Draft information architecture.**
6. **Design screen-by-screen** — wireframes, component tables, code references, states, behaviors.
7. **Add interaction specs** — keyboard, loading, error, notification, destructive, responsive.
8. **Document component inventory.**
9. **Document accessibility and privacy requirements.**
10. **Confirm scope boundaries** — make sure no Post-MVP or permanently excluded work slipped in.
11. **Finalize** — update version, confirm alignment with the pitch, leave open questions only where genuinely unresolved.

## Interview guidelines

When clarifying with the user:

- Start with flows, not screens: "after he marks a contract as faded, does he expect to stay on the slate or land back where he was?"
- Reference the pitch: "the pitch includes staleness marking. Should a stale row show the age of the projection, or only that it is stale?"
- Provide visual options when useful — sketch two ASCII layouts and ask which matches the mental model.
- Ask about the edges where Sightline's designs actually crack: a slate of six contracts versus sixty; a contract with a price but no projection; a market voided after a decision was logged against it; a calibration bucket with eleven observations; a game whose kickoff moved.
- Surface version boundaries: "the pitch defers settlement grading. Should the outcome column be hidden entirely for this slice, or shown as pending?"
- Capture deferred decisions in **Out of Scope** or **Open Questions**.
- Do not ask questions already answered by the pitch, PRD, Architecture Doc, or Product Brief.

## Sightline-specific design checks

Before finalizing a design doc, verify:

- The feature helps answer whether a Kalshi contract is mispriced and how much to trust that judgment — or it clearly supports a screen that does.
- Every displayed probability is accompanied by its confidence, and every displayed rate by its sample size.
- Every projection surface exposes its age and information cutoff, in the list view and not only on detail.
- A slate where nothing clears the recommendation threshold renders as a legitimate designed answer, not as an empty or error state.
- Contracts below the recommendation threshold remain visible and ranked, de-emphasised rather than filtered out.
- Model-derived and market-derived values are visually distinguishable by their source, and no market value wears the model accent.
- Edge direction is carried by sign and glyph as well as colour.
- Took, faded, and skipped are three distinct states, and unmarked renders as no indicator rather than a fourth chip.
- Base and shadow-adjusted projections are not conflated, and nothing in the UI implies that declining a suggestion stops it being graded.
- Source accuracy and adjustment accuracy are displayed as two separate figures, never combined.
- Kalshi being unavailable renders as a designed degraded mode with a last-fetch timestamp, not as an error.
- No viewer surface exposes, disables, blurs, or otherwise hints at the admin's positions, decision log, override performance, or timing cost.
- Nothing on any surface implies a viewer can trade through Sightline or supply a Kalshi credential.
- Material UI is the only component and styling system present, and every chart reads its colours from the theme.
- Every numeric uses the monospace family with tabular figures, and no data value is bolded to signal importance.
- Every screen works in light and dark via theme tokens, with no hardcoded colours.
- Every list, block, and section has empty, loading, and error states specified.
- The design is usable at `xs` with no horizontal scrolling and every action reachable.
- Where weather data is displayed, the Open-Meteo attribution link is present.
- The design doc stops at UI/UX and does not drift into Prisma schema, route handler contracts, or ticket-level implementation.
