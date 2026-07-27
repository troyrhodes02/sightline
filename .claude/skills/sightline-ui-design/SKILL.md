---
name: sightline-ui-design
description: >
  UI design guidance for Sightline, an invite-only NFL player-prop analysis tool with
  one admin and a handful of view-only friends. Use when generating any Sightline UI —
  the slate list, contract detail, accuracy and calibration surface, backtest runs,
  decision log, health, settings, admin user management, invite acceptance, or login —
  or when restyling an existing screen, applying the brand, building an empty or error
  state, or theming a chart. Produces dense, quiet, instrument-grade UI in Sightline's
  brand system. Trigger whenever building or restyling a Sightline screen, whenever a
  ticket touches a component's appearance, and whenever a design doc calls for brand
  or visual language.
---

# Sightline UI Design

Design guidance for Sightline's interface. Sightline projects NFL player performance, compares those projections against live Kalshi contract prices, and reports where the two disagree — plus how well-calibrated it has been historically. Access is invite-only with two roles: one admin who sees everything and logs decisions, and viewers who see the shared analytical surfaces and nothing personal. This skill governs how every Sightline screen should look and feel.

## Design direction: instrument, not sportsbook

Sightline's approved design direction is **instrument, not sportsbook**: dense, quiet, numeric, provisional, legible, unflattering. Prioritize putting a number and its uncertainty in the same glance, because the core job is not "here is a pick" — it is "here is a disagreement with the market, and here is how much to trust it." Never drift toward the aesthetics listed under Avoid below.

Sightline must be able to say *nothing here has an edge today* and have that read as a legitimate, well-designed answer rather than a failure. Any visual treatment that makes an empty recommendation list feel like an error is wrong.

Copy is flat and declarative. No coaching language, no second person exhortation, no exclamation marks, no "Nice call!" — the product has no opinion about how the user is doing. Numbers carry their own sample size and the interface does not editorialize on top of them.

## Output format

- Code in TypeScript/React using Material UI components and MUI's `sx` prop and theme system, in a single code block. Material UI is Sightline's only component and styling system — do not introduce Tailwind, styled-components, CSS modules, hand-authored stylesheets, utility classes, or a second component library.
- Start with a brief response, then the code, then a brief closing response.
- Do not mention the implementation format, styling framework, or markup language in the response text.
- Use `@mui/icons-material` at one size scale per context (20px inline, 24px in navigation and toolbars). No filled/outlined mixing within a screen; no decorative icons on data rows.
- Charts: **Recharts**, always wrapped in a Sightline chart component that reads every colour, font family, font size, and stroke width from `useTheme()`. Recharts knows nothing about the MUI theme, so a hardcoded hex in a chart is the single most likely way this product ends up with two visual systems. There are no exceptions to this rule, including for reference lines and tooltip surfaces.
- Prefer MUI's built-in transitions and `sx`-based hover/focus/outline interactions over custom animation code. No entrance animations on data. A slate row does not fade in.
- Responsive by default via MUI breakpoints; phone is the primary reading context for the slate and must be designed first, not adapted down.

## Aesthetic direction

Design in the style of professional analysis tools and scientific readouts: Linear's restraint, Bloomberg-terminal information density without its 1990s chrome, a lab instrument's display, a well-made research notebook. Draw from the visual language of measurement — reference lines, error bars, sample-size annotations, timestamps sitting next to the values they qualify.

Core qualities for Sightline:

- **Two sources, visibly distinct.** Every number on screen came either from Sightline's model or from the Kalshi market, and the palette says which. This is the organizing idea of the whole interface.
- **Scannable at density.** The slate may be six contracts or sixty; the row design must work at both without changing shape. Numerics are monospaced and column-aligned so a user reads down a column, not across a card.
- **Uncertainty is never stripped.** A probability without its confidence, a rate without its sample size, or a projection without its timestamp is an incomplete display. There is no "clean" version of a number that drops these.
- **Staleness is loud.** A stale projection paired with a live price is the most dangerous state in the product. It must be visible in the list view, not discovered on a detail view.

Avoid:

- **Sportsbook and DFS app aesthetic** (DraftKings, PrizePicks, Underdog) — neon green, "LOCK OF THE DAY", parlay cards, hype typography, odds in oversized pill badges. This is permanently out by product non-goal, and it is the default a generative model reaches for when it sees the words "player prop."
- **Crypto trading dashboard** — glow effects, animated tickers, pulsing price cells, dark-navy-on-black, oversized percentage deltas in saturated red and green. Sightline is checked once on a Sunday morning, not watched.
- **Gamified productivity app** — streaks, confetti, badges, progress rings, encouraging empty states, daily quotes. The product grades the user's decisions and must be able to report that they were bad.
- **Marketing landing page** — hero sections, gradient CTAs, testimonial cards, feature grids, illustrated spot graphics. There is no acquisition surface; every user was invited by name.
- **Fantasy football social app** — avatars, activity feeds, reactions, leaderboards, presence indicators. Sightline has three users, no social features, and none planned.

## Brand system

- The product name is **Sightline** in the shell, titles, and metadata. Rendered lowercase in the wordmark, sentence case everywhere else.
- A defined primary/secondary palette (see Appearance below) and a single typography family (IBM Plex), used as consistent tokens throughout.
- Consistent iconography via `@mui/icons-material`, used at one stroke and size scale per context.
- No screen should retain an un-themed default Material UI appearance. Stock MUI reads as stock MUI; the theme is a named deliverable, not an emergent property.
- **The logo is supplied and must not be redesigned.** Sightline's mark is a circular reticle — a stroked circle with four tick marks, a mint quarter-arc from twelve to three o'clock, and a mint centre dot — shipped as SVG. A separate 16px variant drops the tick marks and keeps the arc. A monochrome variant using `currentColor` covers both appearance modes from one file. Do not ideate alternatives, do not add a wordmark to the mark where the mark is used alone, and do not recolour the arc.

Kalshi is the only third-party brand that appears in this product. Represent it with its name in text, never with a reproduced Kalshi logo, and never with a letter tile or monogram standing in for one. Team identity in mock data uses three-letter abbreviations (CIN, ATL, KC) as text — no team logos, no helmet marks, no league imagery. Sightline has no licence for any of it and no reason to want one.

## Typography

- **IBM Plex Sans** is the approved application font for all interface text. **IBM Plex Mono** is the approved font for every numeric value the product computes or displays — probability, price, edge, confidence, threshold, sample size, Brier score, timestamps. Do not leave typography unspecified and do not substitute Inter, Roboto, or the MUI default.
- Weight posture is restrained: 400 for body and all data values, 500 for column headers, labels, and emphasis, 600 reserved for screen titles only. Never bold a data value to signal importance — importance is carried by position and colour, not weight.
- Set `font-variant-numeric: tabular-nums` on every numeric. Column alignment down sixty slate rows is the entire reason IBM Plex Mono is here; proportional figures defeat it.
- Tracking: `-0.01em` on titles at 20px and above, default elsewhere. Never letter-space uppercase labels — there are no uppercase labels.

## Appearance: light, dark, and system

Sightline supports light, dark, and system — **system is the default** when the user has not made a manual selection. Appearance selection lives in **Settings** only.

- **Never** place a theme toggle, sun/moon icon, or appearance menu in the app bar, the slate header, a user avatar menu, or a floating control. It belongs in Settings.
- Dark mode is near-black, not navy. Surfaces are neutral greys stepping up from `#0A0A0B`; elevation is carried by borders and small lightness steps, never by blue tinting and never by drop shadows. If a dark surface has a hue, it is wrong.
- Design every screen theme-aware using theme tokens, not hardcoded colours. This includes Recharts.

**Dark foundation:** app background `#0A0A0B`, main surface `#131315`, elevated surface `#1A1A1D`, divider `#26262A`, border strong `#35353B`, text primary `#ECECEE`, text secondary `#9B9BA3`, text muted `#6B6B73`. Model accent `#7C74FF` (hover `#8F88FF`, pressed `#6A61F0`, soft `#1E1C3A`). Market mint `#4DE4B2` (soft `#12332A`). Caution amber `#E8A33D` (soft `#33260F`). Negative edge rose `#E06C8A` (soft `#3A1C25`).

**Light foundation:** app background `#FAFAFA`, main surface `#FFFFFF`, elevated surface `#FFFFFF` with a `#E4E4E7` border, divider `#E4E4E7`, border strong `#C9C9CF`, text primary `#131316`, text secondary `#5C5C66`, text muted `#8A8A93`. Model accent `#5B51E8` (hover `#4A40D6`, pressed `#3F35C4`, soft `#EFEDFF`). Market mint `#0F9C6E` for text and small elements, `#4DE4B2` permitted for fills, chart strokes, and elements above 24px (soft `#E6FAF3`). Caution amber `#B57414` (soft `#FDF3E2`). Negative edge rose `#C4425F` (soft `#FCEBEF`).

### Colour carries source, not sentiment

This is the rule that most often gets broken by accident, so it is stated separately:

- **Model accent (indigo)** marks anything Sightline computed: projected value, interval, threshold probability, confidence, drivers, distribution.
- **Market mint** marks anything Kalshi supplied: price, both sides of the book, spread, settlement. Kalshi's own brand colour is used deliberately here so the provenance of a number is readable without a label. Nothing model-derived ever wears mint.
- **Amber** is caution only: staleness, Kalshi-degraded mode, low confidence, insufficient sample, a failed scheduled job. It never means "bad price" and never means "loss."
- **Rose** marks negative edge and destructive actions (revoke access, cancel order). It is desaturated deliberately so it reads as a data encoding rather than a payout.

Positive edge renders in the model accent, which deliberately overloads indigo: a positive edge means the model's number is the one worth acting on. Edge direction must also be carried non-chromatically — an explicit sign and an arrow glyph — so the encoding survives colourblindness and greyscale.

Mint at `#4DE4B2` fails contrast for body-size text on white. In light mode, use `#0F9C6E` for any market value at 16px or below. This is not a suggestion; it is the reason two mint tokens exist.

## Visual detailing

- Elevation is carried by 1px borders and background lightness steps. No drop shadows anywhere except MUI's default menu and dialog surfaces, which stay as MUI ships them. Cards are bordered, not floated.
- Contrast posture is quiet: secondary text sits close to muted, borders are hairlines, and emphasis comes from the accent colours rather than from heavier weights or larger sizes. The loudest thing on the slate should be a stale badge.
- Custom controls only where MUI has no equivalent: the take/fade/skip decision control, the distribution summary, and the reliability curve. Everything else — tables, dialogs, menus, form fields, snackbars — uses MUI components themed, not rebuilt.
- No photography, no illustration, no spot graphics, no empty-state artwork. Placeholder imagery in this product is a chart with no data in it, rendered honestly. If a screen feels bare, the answer is better information hierarchy, not a picture.

## Mock data vocabulary

Use realistic NFL and Kalshi mock data. Generated screens populated with `Player 1 / Stat A / 50%` look like a component gallery; the same layout with the vocabulary below looks like Sightline.

- **Players and teams:** Ja'Marr Chase (CIN), Bijan Robinson (ATL), Puka Nacua (LAR), Jahmyr Gibbs (DET), Amon-Ra St. Brown (DET), Sam LaPorta (DET), Brock Bowers (LV), Garrett Wilson (NYJ), Rome Odunze (CHI), De'Von Achane (MIA), Jaxon Smith-Njigba (SEA), Tucker Kraft (GB), Rachaad White (TB), Khalil Shakir (BUF)
- **Stat types:** receiving yards, rushing yards, passing yards, receptions, touchdowns
- **Thresholds and prices:** thresholds at 40.5, 54.5, 74.5, 89.5, 249.5, 274.5; prices as whole cents 1–99; probabilities to one decimal (61.4%); edges as signed percentage points (+6.4 pts, −3.1 pts)
- **Kickoff windows:** 1:00 PM ET, 4:05 PM ET, 4:25 PM ET, 8:20 PM ET, plus 9:30 AM ET for a London game and Thursday and Monday night slots
- **Decision states:** took, faded, skipped, unmarked
- **Suggestion states:** pending, accepted, declined
- **Confidence levels:** high, medium, low
- **Attention states:** stale, unresolved contract, no projection, prices unavailable, insufficient sample, degraded weather
- **Actions:** Take, Fade, Skip, Accept suggestion, Decline suggestion, Refresh prices, View drivers, Invite viewer, Revoke access
- **Driver phrasing (full sentences, not fragments):** "Target share up 8 points over last three games." "Opponent allows 6.1 yards per target to slot receivers." "Projected game total 12 points above season average." "Limited practice participation Wednesday and Thursday." "Wind 18 mph, outdoor venue."
- **Suggestion evidence:** "ESPN inactives: listed OUT, 11:31 AM ET." "ESPN inactives: listed QUESTIONABLE, downgraded from PROBABLE."

For the accuracy and backtest surfaces, use plausible aggregate mock data — Brier score 0.213, 1,847 graded predictions, buckets from 0–10% through 90–100% with per-bucket counts ranging from 12 to 340, seasons 2019 through 2025. For admin user management, rows show display name, email, role, invited date, and last active only — never a password field, never a Kalshi credential, never a viewer's positions, because viewers do not have any.

## Per-screen guidance

### Shared surfaces (admin and viewer)

- **Slate list** — the product's front door and the screen that gets the most design attention. Ranked by confidence-adjusted edge, descending. Each row shows player and team, stat type and threshold, Sightline's probability, Kalshi's price, signed edge, confidence, and staleness. Recommended contracts are marked; contracts below threshold stay in the list, de-emphasised through text colour rather than removed or collapsed. Row height must be identical for recommended and non-recommended rows — a taller "highlighted" row breaks column scanning. On phone the row wraps to two lines rather than becoming a card.
- **Contract detail** — projected value with its interval first, then threshold probability against the market price with the edge between them, then confidence and what drives it, then the ordered drivers as sentences, then provenance: computed-at, information cutoff, model version. A pending adjustment suggestion appears above the drivers with its evidence and proposed change. The distribution summary shows the quantile grid with the Kalshi threshold marked and the mass above it filled — that filled area *is* the probability, and it is the most important graphic in the product.
- **Accuracy and calibration** — reliability curve with the diagonal reference line always drawn, points weighted by bucket sample size, Brier score alongside, and both baselines plotted for comparison. Filterable by stat type and time period. Buckets with too few observations render as visibly provisional rather than as precise points. This surface is available to viewers and must work year-round with no games scheduled.
- **Backtest runs** — a list of stored runs with period, configuration, code version, and aggregate results; a detail view breaking calibration out by stat type, season, and weather era. Nothing on this surface triggers a run. If a stored run's configuration no longer matches the current engine, say so on the row.
- **Health** — last successful ingest, recompute, and price refresh, each with its timestamp and an amber treatment when it falls outside expected bounds. This is the screen that makes a silently skipped GitHub Actions job visible, so it must be reachable in two taps, not buried.
- **Settings** — appearance selection lives here and nowhere else, alongside account basics.

### Admin-only surfaces

- **Decision log** — every logged decision with its decision-time snapshot, the final pre-kickoff state, and the timing cost between them. Grouped by slate date. Must never be reachable by a viewer, including by deep link; the server rejects it and the client does not render a partial shell first.
- **Override performance** — how takes, fades, and skips performed against what the model recommended, with sample sizes attached to every rate. This screen exists to tell the admin his reads are not adding value, if that is what the data says. Design it so that reading badly is legible.
- **Suggestion reliability** — source accuracy and adjustment accuracy as two separate figures per source, never combined into one number, each with its sample size.
- **User management** — invite by email, assign role, revoke. Revocation is a rose destructive action with confirmation.
- **Trading** — order entry with size, the price actually payable, total cost, and the per-slate cap remaining. Confirmation is a discrete second step, never a single tap, and the confirm control is not the visually dominant element on the screen. Fills, partial fills, and rejections are reported plainly in place.

### Entry and error surfaces

- **Login** — email and password only. No signup link, no "create an account", no social auth buttons, no marketing copy. The absence of a signup path is a product commitment and the screen should look deliberate about it, not like a signup link went missing.
- **Invite acceptance** — token valid (set password, land on slate), token expired, token already used, token revoked. Four states, each with its own copy, each named here because an agent given "invite acceptance" will build one.
- **Access denied** — a viewer reaching an admin route. Plain, brief, routes back to the slate. No humour.
- **Not found** and **application error** — plain, routes back to the slate, no illustration.

### States

- **Empty states** — the slate is empty from February to September and on most weekdays, which is the majority of the calendar. This is Sightline's most-seen screen and must be designed, not defaulted: state when the next games are, and route to accuracy and backtest runs, which remain live year-round. Other empty states: no contracts cleared the recommendation threshold (a legitimate answer, not a failure), no decisions logged yet, insufficient data to draw a reliability curve, no stored backtest runs.
- **Error states** — Kalshi unavailable is a designed degraded mode, not an error: projections still render, price and edge columns show as unavailable with a timestamp of the last successful fetch, and a banner explains it once at the top rather than repeating per row. Genuine errors are plain text, state what failed, and offer a retry where a retry could help.
- **Loading states** — the slate renders from stored data and must never show a spinner waiting on a model run. Use skeleton rows matching final row height so the layout does not shift. Price cells may load after the row; the row does not wait for them.
- **Mobile** — the slate is read on a phone on a Sunday morning, so phone is the design target rather than a fallback. Primary actions sit within thumb reach at the bottom of the contract detail view. Nothing horizontally scrolls. The take/fade/skip control is a single tap at phone width.

## Complete UI coverage for full-surface redesign work

When the task is a comprehensive visual or brand redesign — the App Shell, Brand & Access pitch, or any later "apply the brand" work — the approved direction applies to **every** existing user-facing page and UI state, not just the primary app screens. That includes: slate list; slate list empty; slate list Kalshi-degraded; contract detail; contract detail with pending suggestion; contract detail with no projection; unresolved contract row and its detail; accuracy and calibration; accuracy with insufficient data; backtest run list; backtest run detail; backtest run with configuration drift; decision log; decision log empty; override performance; override performance with insufficient sample; suggestion reliability; health; health with a stale job; settings; user management; invite creation dialog; revoke confirmation dialog; trading order entry; trading confirmation step; trading fill, partial fill, and rejection results; login; invite acceptance valid, expired, used, and revoked; access denied; not found; application error; every navigation surface at phone, tablet, and desktop widths; the app bar and its mobile drawer; every snackbar and toast; every skeleton loading state; and both light and dark foundations for all of the above.

Full-surface redesign work does **not** include: designing an alternative logo; any sportsbook, DFS, or PrizePicks-style integration surface; any public marketing, signup, or pricing page; in-app messaging or notification centre; a friend pick-sharing feed; bankroll or portfolio surfaces; or any NBA or WNBA surface. Those are permanent non-goals or explicitly deferred past V1.

## Respecting provided input

If the user provides design, code, or markup, respect its original design, fonts, colours, spacing, and style as much as possible — extend rather than override.
