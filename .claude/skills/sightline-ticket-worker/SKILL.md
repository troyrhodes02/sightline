---
name: sightline-ticket-worker
description: >
  End-to-end engineering workflow for taking a Sightline Linear ticket from
  assignment through implementation, verification, PR creation, and review
  handoff. Reads the Linear ticket, finds the referenced pitch, design doc, and
  spec, follows repo coding conventions, plans the work, writes tests, implements
  against the spec, runs verification, commits, opens a PR, and moves the ticket
  to In Review when tool access allows. Handles both Sightline runtimes — the
  TypeScript application and the Python modelling and ingest side. Use this skill
  whenever the user says things like "work on SIGHT-123", "pick up this ticket",
  "implement this Linear issue", "build this ticket", "finish this ticket",
  "start on [ticket ID]", or pastes a Linear URL and wants the ticket
  implemented. Also use when the user assigns a Sightline ticket and expects
  engineering execution rather than planning.
---

# Sightline Ticket Worker

Take a Sightline Linear ticket end-to-end:

```text
Linear Ticket → Planning Docs → Work Plan → Tests → Implementation → Verification → PR → Review Handoff
```

This skill is for implementation work, not analysis. It must still protect scope, because otherwise every ticket becomes a swamp with a login screen.

## Core rule

Build exactly what the ticket and upstream docs require.

Do not pull in Post-MVP work, adjacent pitches, architectural rewrites, UI redesigns, or "while I'm in here" cleanup unless the ticket explicitly includes it or the user approves it.

Sightline is an invite-only tool that tells its admin which Kalshi NFL player-prop contracts are mispriced and how much to trust that judgment, with one admin and a handful of view-only friends. It is **not** a sportsbook or DFS product, **not** a public or commercial product, **not** a live in-game trading tool, and **not** a general sports data browser. **No fact whose `knownAt` postdates a projection's information cutoff may ever reach that projection** — that is the constraint every implementation decision is measured against.

## Which runtime is this ticket in?

Sightline is two runtimes sharing one Postgres database. Determine which one the ticket lives in **before** planning, because the toolchain, test runner, and verification gates differ. The workflow spine below — read the ticket, plan, test, implement, verify, PR, move to In Review — is identical either way.

**TypeScript tickets** touch `app/`, `components/`, route handlers, Prisma schema and migrations, the MUI theme, or anything a user sees. Typical areas: App Shell, Brand & Access; Kalshi Sync, The Slate & Decision Log; the accuracy and backtest surfaces; Kalshi Trading.

- Package manager: **detect from the lockfile** — `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lockb` or `bun.lock` → bun. Use it consistently; do not assume npm.
- Tests: **Jest** for unit and integration, **Playwright** for end-to-end.
- Migrations: Prisma, from this side only.
- Verification includes a build and a Vercel preview check.

**Python tickets** touch ingest, the as-of query layer, feature engineering, the projection engine, the simulation, the backtest harness, or grading. Typical areas: Corpus & Point-in-Time Foundation; Backtest Harness & Baseline Model; Simulation Engine.

- Environment and dependencies: **`uv`**. Not pip, not poetry, not conda.
- Tests: **pytest**.
- **Never write a migration.** Prisma owns the schema; Python reads and writes these tables but does not alter them. A ticket that appears to need a schema change on the Python side needs a Prisma migration first, which is a TypeScript-side change and may be a separate ticket.
- There is no preview deployment. Verification is the test suite plus, where feature or as-of code changed, a backtest re-run compared against the prior stored run.
- **`nflreadpy`, never `nfl_data_py`.** The dead package has a decade of tutorials behind it and is what gets reached for by reflex.

**Cross-runtime tickets** exist and should be flagged in the plan. Live Pipeline & Staleness spans GitHub Actions workflows and the health surfacing in the app; Outcome Scoring & Accuracy Surface grades in Python and displays in TypeScript; Adjustment Suggestions spans both. When a ticket spans runtimes, sequence the Python side first if it produces data the TypeScript side reads, and say so in the Implementation Sequence.

For Python commands, read `pyproject.toml` for the configured lint, format, and type-check tools rather than assuming a stack. If a command is not configured, say so — do not invent one and do not report success for a check that was never run.

## Technical ground truth

**Read `CLAUDE.md` before writing code.** It is authoritative for stack, invariants, security rules, and product boundaries; where anything here conflicts with it, `CLAUDE.md` wins. Read `docs/planning/architecture.md` when a ticket requires understanding *why* a decision was made.

Inlined here because implementation applies them constantly:

- **Styling and components:** Material UI, with Recharts for charts wrapped so every colour and font comes from `useTheme()`. Do not introduce Tailwind, styled-components, CSS modules, hand-authored stylesheets, or a second component library.
- **Data access:** read application data through Prisma in server-side code; run mutations through route handlers. Never fetch application data with client-side `fetch()` and never query the database from the browser. The one sanctioned client-side fetch is the slate polling Sightline's own price-refresh route.
- **Temporal integrity, in full, because implementation is where it breaks:** every read that feeds a projection goes through the as-of query layer with an explicit cutoff. **Filtering after the fact is not the same as being unable to see the row** — a helper that pulls a player's season stats and then trims by date is the exact wrong approach, and it is what an implementer writes by default. Never compute a feature over a full season and join it to a mid-season game. Never join current roster or team state to a historical game. Never treat a corrected stat as though it were known at game time. Reconstructed `knownAt` values resolve late, never early, and carry the reconstruction flag. Treat any code path that is unclear about the cutoff as a blocking issue, not a detail.
- **Prices never feed projections.** No modelling, feature, or simulation code reads `PriceObservation` or `RecommendationSnapshot`, directly or indirectly. Grade against `Outcome`, never against whether a recommendation was profitable.

Do not introduce libraries, background jobs, queues, realtime sync, or external integrations unless the ticket and `CLAUDE.md` support it. Sightline deliberately has no message queue, no worker service, no WebSocket connection to Kalshi, and no caching layer.

## Prerequisites

- Linear access via MCP, connector, CLI, or pasted ticket text
- GitHub access via MCP, connector, or `gh`
- Repo-local engineering instructions: `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `README.md`
- Planning docs at `docs/planning/` — brief, PRD, architecture, pitch roadmap
- The controlling expanded pitch, design doc, and technical spec for this ticket
- Package scripts for test, lint, type-check, build, and format on whichever runtime applies

If a tool is unavailable, continue as far as possible and provide the exact manual command the user needs to run. **Do not pretend a PR was opened or a ticket was moved if the tool did not do it.**

## Phase 1: Gather context

### 1. Identify the Linear ticket

Extract the ticket ID from whatever the user provides: direct ID, Linear URL, branch name, PR title or body, or pasted text.

```bash
git branch --show-current
```

Example: `feat/SIGHT-42-as-of-query-layer` → `SIGHT-42`.

If no ticket ID can be found, ask before making scope decisions.

### 2. Fetch and read the ticket

Read: ID, title, description, acceptance criteria, status, priority, parent, blocking and blocked-by relationships, linked PRs and docs, comments that clarify scope, and project or initiative.

If Linear access is unavailable, use pasted text and ask for any missing acceptance criteria before implementing.

### 3. Find the controlling docs

Search the ticket for referenced paths. Preferred source order:

1. Ticket acceptance criteria
2. Technical spec
3. Design doc, for UI behavior
4. Expanded pitch
5. `docs/planning/prd.md` feature section
6. `docs/planning/architecture.md`
7. `docs/planning/product-brief.md`

If a required spec is not referenced, search the likely docs directories, fuzzy-match the ticket title, and search for the ticket ID. If still ambiguous, ask which spec controls the work. Do not guess.

### 4. Read repo instructions

Read `CLAUDE.md` first, then any other repo-local instructions, `package.json`, `pyproject.toml`, and the test, lint, and type configs for the relevant runtime.

Capture: test framework, formatting rules, naming conventions, commit and branch conventions, PR body requirements, verification commands, migration conventions.

If instructions conflict, prefer the most specific repo-local instruction, then the technical spec, then the planning docs. Surface serious conflicts rather than choosing silently.

### 5. Determine whether this is frontend work

Treat as frontend if it touches: MUI components, the theme, App Router routes, forms, dialogs and drawers, the slate list, contract detail, the accuracy and calibration surface, backtest run views, the decision log, health, settings, user management, login, invite acceptance, or any empty, loading, or error state; or accessibility and responsive behavior.

For frontend work, locate the design source: ticket links, spec references, the design doc, existing component patterns, theme files. See `sightline-design-doc` for what a design doc contains and `sightline-ui-design` for brand and visual language.

Do not block frontend implementation solely because a visual preview is missing, unless the ticket explicitly requires pixel-perfect implementation from one.

### 6. Determine the base branch

Default base is `main`. Before branching, check whether this ticket depends on another in-progress ticket via Linear parent or blocked-by relationships, related comments, or open PRs.

```bash
git fetch --all --prune
git branch -r | grep SIGHT-120
```

- No parent or blocker → `main`.
- Depends on a ticket with an open branch → base on that branch.
- Depends on a ticket with no branch → `main` only if this ticket can be developed independently.
- Multiple candidates → present the options and ask.

```bash
git checkout <base-branch> && git pull
git checkout -b feat/SIGHT-123-short-description
```

## Phase 2: Plan the work

Before editing code, produce a short implementation plan.

```markdown
# Implementation Plan — SIGHT-123: Ticket Title

## Runtime
TypeScript / Python / both, and why

## Scope
## Out of Scope
## Acceptance Criteria Mapping
- AC #1 → planned change
## Files / Areas
## Test Plan
## Implementation Sequence
## Risks / Questions
## Verification Commands
```

### Scope checkpoint

If the ticket is small, clear, and directly implementable, proceed after presenting the plan. If it is large, ambiguous, or touches risky areas, **get approval before writing code.**

Large-ticket warning signs: multiple unrelated features; a Prisma migration plus substantial UI work; anything touching the as-of query layer or `knownAt` handling; feature engineering that changes what the model can see; the Kalshi credential path or order placement; grading and re-grading logic; derived-state logic for edge or staleness; cross-runtime work; cross-pitch dependencies; a missing spec or absent acceptance criteria.

The first four of those are the ones where a wrong decision is silent rather than loud. Treat them as approval-required by default.

## Phase 3: Execute

### 1. Handle sequential prerequisites

Do these first if they unblock the rest: Prisma migrations and generated types; shared TypeScript types and validation schemas; test factories; the as-of query layer and its helpers; route structure; theme tokens; data-access helpers.

### 2. Write tests

Base them on the ticket's acceptance criteria, the spec's testing section, the design doc's states, and the PRD's edge cases. See `sightline-spec` → `references/testing-patterns.md` for the full category list and factory conventions.

Concrete assertions in this product's vocabulary, covering the rules an implementer would otherwise get wrong:

- A query at an as-of cutoff cannot return a row whose `knownAt` postdates that cutoff — the row is absent from the result, not filtered afterward.
- A projection for a past game is byte-identical whether computed then or now, given a seeded simulation.
- A test factory never defaults `knownAt` to `now()`.
- Weather for a pre-2021 season is recorded with its era, and calibration is reportable split across the two eras.
- No modelling or feature module imports `PriceObservation` or `RecommendationSnapshot`.
- A decision request carrying client-supplied snapshot values is rejected, not silently trusted.
- Changing a decision's disposition leaves the original decision-time snapshot untouched.
- Accepting an adjustment suggestion updates the displayed projection and leaves the shadow projection byte-identical.
- Declining a suggestion still leaves both base and shadow projections queued for grading.
- A slate where nothing clears the recommendation threshold returns all rows with `isRecommended` false, not an empty collection.
- A contract with a price but no projection returns `modelProbability` null, distinguishable from zero.
- Kalshi unreachable returns a success response with `degraded` true and projections intact.
- A viewer requesting any admin route is rejected server-side, and a foreign-owned user-scoped resource returns `not_found` rather than `forbidden`.
- Re-running ingest, projection, or grading over a processed period produces no duplicates and no changes.
- A stat correction re-grades affected records, and re-running the correction is idempotent.

**If a test implied by an acceptance criterion cannot be satisfied without contradicting the spec, stop and surface the conflict.** Do not delete the test, loosen the assertion, or mark it skipped to get a green build. A green checkmark obtained that way is a false report about the state of the system, and in this product it is specifically the failure mode that hides a leak.

### 3. Implement

Follow existing patterns for route handlers, the Prisma data-access layer, MUI component composition, the as-of query layer, ingest modules, and feature functions.

Frontend rules:

- Use Material UI and the project theme. Do not introduce a competing styling system, and do not inline a hex value — if no token exists, say the theme is incomplete rather than working around it.
- Match the design doc.
- Include empty, loading, and error states when the design or spec requires them. The empty slate is the most-viewed state of the year and is never an error.
- The slate renders from stored data and must never wait on a model run. Price cells may resolve after their row; the row does not wait for them.
- Model-derived and market-derived values must remain visually distinguishable by source. Never apply the model accent to a Kalshi price.
- Edge direction carries a sign and a glyph, not colour alone.

Backend and data rules:

- Read application data through Prisma in server-side code; mutate through route handlers. No client-side data fetching except the price-refresh poll.
- Every read that feeds a projection goes through the as-of query layer with an explicit cutoff. Filtering after the fact is not equivalent.
- Snapshot values on a decision are read server-side. Never accept a user identifier or a snapshot number from a request body.
- The Kalshi signing key is server-side only and never appears in a response body, a log line, or an error message. No route accepts a viewer credential.
- Route ownership through `userId` on `Decision` and `Position` directly — never inherit ownership by joining through the shared `Contract`.
- Multi-step dependent writes run inside a Prisma `$transaction`, with an optional transaction client so functions compose.
- Do not add background jobs, queues, or infrastructure `CLAUDE.md` does not sanction. Edge and staleness are computed on read; a job that denormalises either is wrong even when it is faster.

Python rules:

- Vectorise simulation across runs. A Python loop over simulation iterations passes correctness tests and fails the performance constraint by two orders of magnitude, which is the whole point of the constraint.
- Polars is the DataFrame library. Convert to pandas only at a boundary, and note why.
- Never migrate the schema.
- An unavailable named source produces an explicit ingest failure, never a silent gap.

### 4. Iterate until local tests pass

Use the runtime's detected toolchain. Do not switch package managers mid-ticket.

## Phase 4: Verification

Run the full suite before committing. Check `package.json`, `pyproject.toml`, and repo instructions for exact commands.

Required categories, every one the repo supports: unit tests, component tests, integration tests, end-to-end if available, linter, type-checker, build, formatter, migration validation if the schema changed, accessibility checks if supported, and a manual UI check for frontend work.

**If the repo does not define a command, do not invent success — report that the command is unavailable.**

**Frontend visual verification:** compare against the design doc; check phone, tablet, and desktop widths; check loading, empty, error, and success states; check keyboard navigation and focus behavior in dialogs and drawers; check both light and dark appearance; confirm no competing styling system was introduced and no hex value was inlined.

**Data and security verification:** migrations apply cleanly and generated types are updated; the as-of query layer is still the only model-facing read path; the leakage test suite passes; role enforcement is intact and admin-only routes reject viewers server-side; no credential or key material appears in any response, log, or error.

**Python feature verification:** where a ticket changed feature computation, `knownAt` handling, or the as-of layer, re-run the backtest and compare against the prior stored run. **A leak makes the numbers improve.** An unexplained improvement in calibration or error is a signal to investigate, not to celebrate — state the comparison in the PR body either way.

**Do not proceed until green.** Do not commit, push, open a PR, or move the ticket until verification passes. If a check fails: fix straightforward failures, re-run, and if the failure reveals a scope or spec conflict, stop and report it.

## Phase 5: Commit

```bash
git status && git diff
```

Confirm: no unrelated files, no secrets or key material, no generated junk, no debug logging, no stray TODOs, tests reflect the acceptance criteria, and scope stayed inside the ticket.

```bash
git add . && git commit -m "SIGHT-123 add as-of cutoff enforcement to player context reads"
```

## Phase 6: Push and open PR

```bash
git push -u origin feat/SIGHT-123-short-description

gh pr create \
  --base <base-branch> \
  --head feat/SIGHT-123-short-description \
  --title "SIGHT-123: Ticket title" \
  --body-file /tmp/pr-body.md
```

```markdown
## Summary
## Linear
- SIGHT-123
## Runtime
TypeScript / Python / both
## Scope
This PR covers:
Out of scope:
## Acceptance Criteria
- [x] AC #1: ...
## Tests / Verification
- [x] `<test command actually run>`
- [x] `<lint command actually run>`
- [x] `<typecheck command actually run>`
- [x] `<build command actually run>`
## Backtest Comparison
Required when feature computation, `knownAt` handling, or the as-of layer changed.
State the prior run, the new run, and the delta in calibration and error.
## Screenshots / UI Notes
## Migrations / Setup
## Notes for Reviewer
```

Use the actual commands that were run, not the ones the template suggests.

## Phase 7: Move the ticket to In Review

Move the ticket only after the PR exists, verification passed or its limitations are documented in the PR body, and the PR link is ready to attach. If Linear access is unavailable, tell the user to move it manually and provide the PR link.

That is the end of the workflow. There is no reviewer handoff step beyond this.

## When things go wrong

For each case, output the specific text rather than a vague apology.

**Spec not found** — list every location checked and ask for the controlling spec path.

**Design source not found for frontend work** — offer to continue from the ticket and spec, noting that visual fidelity may be weaker. If the ticket requires pixel-perfect implementation from a preview, stop and ask for it.

**Tests cannot be satisfied** — state the ticket's requirement, the conflicting document's requirement, and recommend resolving the conflict before implementation continues. Never resolve it by weakening the test.

**Tooling unavailable** — be specific about which tool, what could not be done, and the exact manual command to run. Never claim a PR was opened, a ticket was moved, a check passed, or a build succeeded when it did not. Say plainly what did not happen.

**Large ticket** — propose a split into named sub-tickets with the reason, and continue only if the user wants the larger scope.

**Scope conflict** — state what the ticket asks for, what the upstream doc says, the risk, and recommend resolving before implementing.

**Safety or privacy issue** — if implementation would weaken Sightline's posture, stop and propose a safer approach. The real ways it gets broken here: a feature computed over a full season and joined to a mid-season game; a reconstructed `knownAt` resolved to the game date; a modelling module reaching for a price to sanity-check an output; a snapshot value accepted from a request body; the Kalshi key logged in an error path; an admin surface rendered client-side and hidden with a conditional; a field added anywhere that would hold a viewer's Kalshi credential.

## Final response format

```markdown
## Done — SIGHT-123: Ticket Title

- **PR:** URL
- **Branch:** `feat/SIGHT-123-short-description`
- **Base:** `main` or stacked branch
- **Linear:** URL
- **Status:** Moved to In Review / manual action needed

## What Changed
## Verification
## Notes
```

If the work is partial: state what was completed, what is blocked, why, and the exact next manual action.

## Important guidelines

- Read the ticket, the controlling spec, and repo conventions before coding.
- Determine the runtime before planning.
- Plan before editing.
- Keep work scoped to the ticket.
- Do not implement deferred work unless explicitly scoped.
- Do not introduce a second styling system.
- Do not weaken temporal integrity, the prices-never-feed-projections rule, or the role and credential posture.
- Do not skip verification.
- Do not open a PR with failing checks unless the user asks and the PR body documents the failure.
- Do not move the ticket to review if no PR exists.
- Do not pretend unavailable tools worked.
- Do not let a ticket become a full-product redesign because one acceptance criterion had ambition issues.

## Common Sightline ticket patterns

### Corpus & Point-in-Time Foundation tickets

Likely touches: Python ingest modules, the as-of query layer, `PlayByPlay`, `PlayerGameStat`, `PlayerGameContext`, player identity resolution across nflverse, ESPN, and Kalshi naming, weather ingest, Prisma schema for the fact tables.

Watch for:

- A read path that bypasses the as-of layer and filters afterward.
- A reconstructed `knownAt` resolved to the game date rather than the source's documented publication window.
- `nfl_data_py` imported by reflex instead of `nflreadpy`.
- Open-Meteo's `/v1/archive` reanalysis endpoint used for a season where archived forecasts exist.
- A weather record stored without its era, making split calibration reporting impossible later.
- Player identity matched by name at query time instead of through the explicit mapping table.
- An ingest gap swallowed silently instead of raising an explicit failure.

### Backtest Harness & Baseline Model tickets

Likely touches: the harness runner, chronological iteration, `BacktestRun`, `CalibrationBin`, Parquet output, baseline model implementations, runbook documentation.

Watch for:

- A season-level aggregate computed once and joined across the whole season.
- Raw per-prediction rows written to Postgres instead of local Parquet.
- An interrupted run leaving partial results that read as complete.
- A run whose stored configuration cannot be compared against the current engine version.
- The runbook deferred to a follow-up ticket — the pitch requires it ships with the harness.
- An unseeded simulation making a run irreproducible.

### App Shell, Brand & Access tickets

Likely touches: the MUI theme, navigation, Supabase Auth wiring, invitation and revocation flows, empty states, the health read, responsive layout.

Watch for:

- A screen built on stock MUI defaults instead of the theme.
- A theme toggle placed in the app bar rather than Settings.
- Dark mode drifting to navy instead of near-black.
- A signup route, a social auth button, or a password-reset flow appearing because they felt like table stakes — none of these exist in Sightline.
- Role checks implemented by hiding navigation rather than rejecting server-side.
- Empty states rendered as errors.

### Kalshi Sync, The Slate & Decision Log tickets

Likely touches: the Kalshi client, contract resolution, `PriceObservation`, `RecommendationSnapshot`, the slate read, the decision route handler, the take/fade/skip control.

Watch for:

- An unresolved contract dropped instead of retained and surfaced.
- Only a midpoint stored instead of both sides of the book.
- Edge or staleness persisted to a column, or a job added to maintain one.
- Below-threshold contracts filtered out of the slate response.
- The recommendation threshold hardcoded instead of configuration.
- A decision anchored to a recommendation rather than to a contract.
- Snapshot values taken from the request body.
- `faded` and `skipped` collapsed into a single "passed" state.
- Kalshi unavailability treated as an error rather than a degraded mode.

### Live Pipeline & Staleness tickets

Likely touches: GitHub Actions workflows, per-game recompute scoping, the keepalive workflow, staleness computation, health surfacing.

Watch for:

- Staleness or recompute measured from a calendar day instead of each game's own kickoff, which breaks Thursday, Saturday, Monday, and the 9:30am London game.
- Staleness scoped per slate rather than per game, marking later games because an early one went stale.
- The keepalive workflow omitted, which kills every schedule during the February-to-September offseason and surfaces in September.
- A skipped scheduled run treated as success because nothing errored.
- Staleness surfaced only on the detail view and not in the list.

### Outcome Scoring & Accuracy Surface tickets

Likely touches: settlement and results ingest, grading across projections, recommendations, decisions and suggestions, `Outcome`, `CalibrationBin`, the reliability curve, override performance, timing cost.

Watch for:

- Grading that is not idempotent, so a re-run double-counts.
- A stat correction leaving a stale grade instead of re-grading downstream.
- Kalshi settlement and the official stat line reconciled into one number instead of stored separately.
- A rate displayed without its sample size.
- A thin calibration bucket rendered as a precise-looking point.
- Override performance or timing cost leaking onto a viewer surface.

### Simulation Engine tickets

Likely touches: the game environment, usage allocation and efficiency models, the vectorised Monte Carlo core, compact distribution storage, driver generation, per-layer calibration validation.

Watch for:

- A Python loop over simulation runs instead of array operations.
- Ten thousand raw draws persisted instead of the compact representation.
- Drivers narrated on top of the model rather than produced from its structure.
- A price used anywhere as an input, including as a sanity check.
- Layers validated only in aggregate, so a badly calibrated result is visible without being diagnosable.
- A new stat type requiring structural change to the engine.

### Adjustment Suggestions & Source Reliability tickets

Likely touches: the suggestion mechanism, ESPN inactives ingest, shadow projection computation, accept and decline handlers, source and adjustment accuracy analytics.

Watch for:

- The shadow projection computed only when a suggestion is accepted.
- Grading made conditional on acceptance, which measures the admin's choices rather than the source.
- Source accuracy and adjustment accuracy combined into one figure.
- A new source requiring changes to the suggestion, display, or grading mechanism.
- ESPN unavailability failing a request rather than stopping suggestions and surfacing staleness.
- A viewer given accept or decline controls.

### Kalshi Trading tickets

Likely touches: order placement, the confirmation step, per-slate cap enforcement, fill handling, `Position`, reconciliation.

Watch for:

- An order submittable without an explicit confirmation showing size, executable price, and total cost.
- The confirm control styled as the dominant element on the screen.
- Live account access enabled before the demo environment has been exercised.
- The feature enabled with no stored `BacktestRun` — that gate is explicit in the pitch.
- A missing idempotency key, so a retry creates a second position.
- An order that succeeded remotely but failed to record locally left undetectable, with no reconciliation path.
- Any field, anywhere, capable of holding a viewer's Kalshi credential.
