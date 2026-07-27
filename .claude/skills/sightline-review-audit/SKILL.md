---
name: sightline-review-audit
description: >
  Audit PR review feedback for technical validity and scope alignment against
  Sightline Linear tickets, acceptance criteria, and roadmap boundaries. Use this
  skill whenever the user asks to evaluate, audit, triage, or assess review
  comments on a pull request — including phrases like "check this review", "audit
  the feedback", "is this review valid", "should I implement this feedback",
  "scope check this review", "did the reviewer have a point", or any situation
  where PR review comments need to be validated against a Linear ticket's
  acceptance criteria, the Sightline PRD, the pitch roadmap, or current
  architecture decisions. Also trigger when the user pastes or references review
  comments and asks whether they should act on them. Requires Linear access and,
  when reviewing a PR directly, GitHub access or the GitHub CLI.
---

# Sightline Review Audit

Evaluate PR review feedback along two dimensions before recommending action:

1. **Technical validity** — is the reviewer correct about the code?
2. **Scope alignment** — does the feedback belong in this ticket, another planned ticket, a new ticket, or not at all?

This skill is for analysis only. **Do not implement the feedback.** The goal is to help the user decide what to act on without turning every PR review into a scope-creep buffet.

## Prerequisites

- Linear access via MCP, connector, or equivalent integration
- GitHub access or `gh` CLI when fetching PR comments directly
- A Linear ticket ID present or implied in the branch, PR title, PR body, or pasted context
- Planning docs at `docs/planning/` — brief, PRD, architecture, pitch roadmap
- `CLAUDE.md` for technical ground truth
- The controlling expanded pitch, design doc, and technical spec where relevant

## Technical ground truth

`CLAUDE.md` is authoritative for stack, invariants, security rules, and product boundaries. Where anything in this skill conflicts with it, **`CLAUDE.md` wins** — and the conflict is itself worth surfacing to the user, because a stale check here does something worse than drift: it confidently classifies correct feedback as OUT_OF_SCOPE, citing a boundary that no longer exists.

## Sightline context anchors

Scope narrows as you move right:

```text
Product Brief → PRD → Pitch Roadmap → Pitch → Design Doc → Technical Spec → Linear Ticket → PR
```

- **`docs/planning/product-brief.md`** — permanent product boundaries, core job, non-goals, riskiest assumption.
- **`docs/planning/prd.md`** — MVP features, acceptance criteria, edge cases, deferred features.
- **`docs/planning/architecture.md`** — technical ground truth, stack decisions, security model, consistency model.
- **`docs/planning/pitch-roadmap.md`** — pitch sequence, dependencies, what each pitch includes and defers.
- **Expanded pitch** — slice-specific problem, scope, boundaries, no-gos, definition of done.
- **Design doc** — UI/UX behavior, screen states, component expectations. See `sightline-design-doc`.
- **Technical spec** — data shape, server behavior, validation, tests, implementation constraints. See `sightline-spec`.
- **Linear ticket** — the actual unit of work being reviewed.

If these disagree, do not quietly pick a favorite. Surface the conflict.

## Step 1: Gather context

### 1. Identify the ticket ID

```bash
git branch --show-current
```

Example: `feat/SIGHT-42-as-of-query-layer` → `SIGHT-42`.

If the branch has no ticket ID, check the PR title, PR body, commit messages, pasted context, and ticket references in code comments. If none can be found, ask for the ticket ID or text before making scope claims.

### 2. Fetch the Linear ticket

Capture: ID, title, description, acceptance criteria, status, parent project or initiative, linked issues, related documents, labels, and any comments that clarify scope.

### 3. Fetch roadmap and planning context

At minimum identify: which of the nine pitches this ticket belongs to; which PRD feature or acceptance criterion it maps to; what is deferred to later pitches; what is Post-MVP; and any architectural decision that constrains the implementation.

Worked classifications for this product:

- *"We should add a nightly job that denormalises edge onto the contract so the slate query is one read."* — conflicts with the derived-state posture in `architecture.md` → Consistency & State and `CLAUDE.md` → Business logic. Edge is computed on read; there is no column and no job. **OUT_OF_SCOPE**, and likely **INVALID** as a performance argument at fourteen games a slate.
- *"Add an in-app notification when a game goes stale."* — a real product idea, but in-app messaging was considered and set aside in the PRD, and delivery mechanisms are not in any current pitch. **OUT_OF_SCOPE**, citing `prd.md` → Post-MVP.
- *"Just use Tailwind for this one component, the MUI override is ugly."* — conflicts with the single sanctioned styling system in `architecture.md` → Tech Stack. **OUT_OF_SCOPE** and **INVALID**.
- *"The suggestion accept handler should skip computing the shadow projection when the admin declines — saves a simulation."* — conflicts with `prd.md` → Adjustment Suggestions and `CLAUDE.md`. The shadow exists precisely so grading is not confounded by the admin's choices. **INVALID**, and worth explaining rather than merely rejecting.
- *"This model reads the last price to sanity-check its output."* — violates the second invariant. **VALID and IN_SCOPE regardless of the acceptance criteria**, because it is a correctness regression the PR introduced.
- *"Suggestion sources should be a Prisma enum so the UI can map them."* — plausible, but the spec conventions say open sets that grow without a migration stay validated strings. **DISCUSS** if the spec is silent for this feature; **SKIP** if it is not.

### 4. Search Linear for related tickets

Search the same project and feature family across Planned, Backlog, In Progress, Todo, Draft, and Blocked, to determine whether valid feedback is already tracked.

Useful search terms for this product: as-of query layer, `knownAt`, leakage, backtest, calibration, reliability curve, slate, contract resolution, price observation, edge, staleness, inactives, adjustment suggestion, shadow projection, decision log, timing cost, override performance, settlement, grading, stat correction, keepalive, order placement, exposure cap, reconciliation, invitation, revoke.

### 5. Get the review comments

**A. Pasted directly** — use them as the source. If file paths or line numbers are included, inspect those sections.

**B. PR number given:**

```bash
gh pr view <PR_NUMBER> --json title,body,headRefName,baseRefName,reviews,reviewRequests,comments,files
gh api repos/:owner/:repo/pulls/<PR_NUMBER>/comments
```

**C. Current branch has an open PR:**

```bash
gh pr view --json title,body,headRefName,baseRefName,reviews,reviewRequests,comments,files
gh api repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)/comments
```

### 6. Read the actual code

For every comment, inspect the code being commented on — the lines, surrounding code, the related component or function, nearby patterns, tests, types, validation, error handling, and existing design-system usage.

Do not evaluate a reviewer's claim in the abstract. Reviewers are capable of being correct, confused, and overconfident, sometimes in the same sentence.

## Step 2: Evaluate each comment

### A. Technical validity

Ask: is the reviewer's understanding of the code correct? Does the code behave as claimed? Would the suggestion fix a real issue or improve correctness, security, accessibility, performance, maintainability, or readability? Does it introduce regressions or conflict with existing patterns? Does it align with the approved architecture? Or is it a stylistic preference wearing an engineering hat?

Rate as:

- **VALID** — identifies a real issue or meaningful improvement.
- **INVALID** — wrong, irrelevant, already handled, or would make the code worse.
- **UNCERTAIN** — needs more context or a product decision.

#### Sightline-specific technical checks

**Temporal integrity — check first**

- Any comment touching a read that feeds a projection is about the top invariant. A read that does not thread an explicit as-of cutoff, or that filters by date *after* fetching rather than being unable to see the row, is a **real bug**, not a style nit. Rate it VALID and IN_SCOPE even if no acceptance criterion mentions it.
- Watch for the subtle direction too: a reviewer objecting to the as-of layer as "unnecessary indirection" or proposing a direct table read for convenience is **INVALID**, and the reason is worth stating — the indirection is the enforcement mechanism, and a leak improves the numbers rather than breaking a test.
- Season-level aggregates joined to mid-season games, current roster state joined to historical games, corrected stats treated as known at game time, and reconstructed `knownAt` values resolved early rather than late are all blocking regardless of what the ticket asked for.
- **The two sanctioned exceptions are stat corrections in grading, and pre-2021 reanalysis weather with its era recorded.** Anything outside those two is blocking. A reviewer citing the weather exception to justify a different leak is wrong.
- Treat ambiguity here as urgent. If it is unclear whether a code path respects the cutoff, that is DISCUSS at minimum, never SKIP.

**Prices never feed projections**

- Any modelling, feature, or simulation code reaching `PriceObservation` or `RecommendationSnapshot` is a regression. So is grading against recommendation profitability rather than against `Outcome`.
- A reviewer suggesting the model blend market-implied probabilities, shrink toward the price, or use price movement to infer player status is proposing something that would destroy the product's primary success metric. **INVALID**, and explain why rather than just declining.

**Stack and styling**

- Material UI is the only component and styling system, with Recharts for charts wrapped so colours come from `useTheme()`. Do not accept suggestions introducing Tailwind, styled-components, CSS modules, hand-authored stylesheets, or a second component library unless the planning docs have changed.
- An inlined hex value is a valid finding. The correct fix is a theme token, not a constant.
- On the Python side: `nflreadpy`, never `nfl_data_py`. A reviewer suggesting the deprecated package — or suggesting pandas across the codebase instead of Polars — is INVALID.

**Auth and privacy**

- Supabase Auth, email and password, **public signup disabled**, invite-only with admin and viewer roles. There is no self-serve signup, no social auth, no magic links, and no specified password-reset flow. A reviewer asking why registration is missing is describing the product working correctly.
- Role enforcement is server-side. A comment pointing out that an admin surface is hidden client-side rather than rejected server-side is **VALID and IN_SCOPE**.
- User-scoped resources return `not_found` rather than `forbidden` so existence is not confirmable. A reviewer "fixing" this to return 403 is introducing an information leak.
- The Kalshi signing key is server-side only and must never appear in a response, a log, or an error. Any comment finding it exposed is IN_SCOPE and urgent.
- **No surface anywhere may accept, store, or transmit a viewer's Kalshi credential.** A reviewer proposing one is proposing a permanent non-goal violation, not a feature.

**Product logic**

- `took`, `faded`, and `skipped` are three states; unmarked is the absence of a row. A suggestion to collapse fade and skip into "passed" is INVALID.
- Base and shadow projections both exist and are both graded regardless of acceptance.
- Source accuracy and adjustment accuracy are two figures and must not be combined.
- Kalshi settlement and the official stat line are stored separately, not reconciled.
- Edge, staleness, confidence-adjusted edge, and recommendation status are computed on read. No column, no job.
- **Warn rather than block** where the PRD treats an unusual state as legitimate: a second decision on a contract, a decision on a contract with no projection, a decision logged after kickoff, a contradictory suggestion. A reviewer proposing a hard block on any of these is proposing friction the PRD deliberately rejected.
- **Block** on money and invariants: an order over the per-slate cap, an order without explicit confirmation, client-supplied snapshot values.
- Terminal and exceptional states — voided market, unresolvable grading, revoked user — must be handled distinctly, not folded into a generic error.

**UI/UX**

- The slate ranks by confidence-adjusted edge, and below-threshold contracts stay visible and de-emphasised. A suggestion to filter them out is OUT_OF_SCOPE against the PRD.
- The slate renders from stored data and must never wait on a model run. Anything that would block it is a valid finding.
- Row height must be identical for recommended and non-recommended rows.
- Model-derived and market-derived values stay visually distinguishable by source.
- Empty, loading, and error states matter when the pitch or design doc includes them — and the empty slate is the most-viewed state of the year, so "the empty state is unpolished" is usually VALID.
- Accessibility improvements are usually valid if they do not contradict the design or blow up scope. Colour-only state encoding is always a valid finding here, since edge direction must carry a sign and a glyph.

### B. Scope alignment

Classify using the ticket, acceptance criteria, pitch boundaries, PRD, roadmap, design doc, and spec.

**IN_SCOPE** — directly matches the ticket's acceptance criteria or definition of done, or fixes a bug or regression this PR introduced. **Also use for security, data-loss, privacy, temporal-leakage, and correctness bugs introduced by the PR, even when no acceptance criterion names them.** Scope is not an excuse to ignore a regression the PR introduced.

**ALREADY_PLANNED** — valid, but owned by another existing ticket or a later pitch. Always cite the ticket ID, its title, and why it owns the work.

**NEW_TICKET** — valid and worth tracking, not part of this ticket, and not already captured. Recommend a concise title and acceptance criteria.

**OUT_OF_SCOPE** — conflicts with the spec, architecture, brief, PRD, pitch boundaries, or non-goals; pulls in Post-MVP work early; adds unrelated features; expands past the ticket's appetite; or changes UX the design doc deliberately chose.

## Step 3: Recommend action

| Technical validity | Scope alignment | Recommendation |
| ------------------ | --------------- | -------------- |
| VALID | IN_SCOPE | **IMPLEMENT** — do it now |
| VALID | ALREADY_PLANNED | **DEFER** — cite the existing ticket |
| VALID | NEW_TICKET | **DEFER** — suggest creating a new ticket |
| VALID | OUT_OF_SCOPE | **DEFER** — explain the spec or architecture conflict |
| INVALID | Any | **SKIP** — explain why the reviewer is wrong |
| UNCERTAIN | Any | **DISCUSS** — identify the decision or missing context needed |

**IMPLEMENT** — state what to change, why it is required, and which acceptance criterion or bug it maps to.

**DEFER** — state why it is valid, why it is not part of this ticket, the existing ticket reference or suggested new ticket, and whether the PR should add a note, a TODO, or nothing.

**SKIP** — state why the claim does not hold, with evidence from the actual code and the supporting pattern or spec.

**DISCUSS** — state what is uncertain, what decision is needed, who should decide if clear, and the safe default until resolved.

## Step 4: Present the audit

```markdown
# PR Review Audit — SIGHT-123: Ticket Title

## Context

- **Ticket:** SIGHT-123 — Ticket Title
- **PR:** #45 — PR title
- **Branch:** `feat/SIGHT-123-feature-name`
- **Pitch / Scope Area:** Pitch 4: Kalshi Sync, The Slate & Decision Log
- **Primary acceptance criteria checked:**
  - AC #1: ...
```

Then, per comment:

```markdown
## [RECOMMENDATION] — One-line summary

📎 `path/to/file:L42`

**Reviewer said:** "Brief quote or paraphrase."

**Technical assessment:** VALID / INVALID / UNCERTAIN

One or two sentences on whether the reviewer is correct, referencing actual code behavior, existing patterns, or tradeoffs.

**Scope assessment:** IN_SCOPE / ALREADY_PLANNED / NEW_TICKET / OUT_OF_SCOPE

One or two sentences mapping this to the acceptance criteria, another ticket, a roadmap boundary, the PRD, the design doc, or an architecture decision.

**Recommendation:** IMPLEMENT / DEFER / SKIP / DISCUSS

Exactly what to do and why.
```

Worked examples, one per recommendation type:

```markdown
## [IMPLEMENT] — Decision handler trusts client-supplied edge

📎 `app/api/decisions/route.ts:L31`

**Reviewer said:** "You're reading snapshotEdgePoints straight off the request body."

**Technical assessment:** VALID

Confirmed at L31 — the handler spreads the parsed body into the Prisma create. The spec requires the snapshot be read server-side from the freshest projection and price, and decisions are the one dataset in this system that cannot be reconstructed.

**Scope assessment:** IN_SCOPE

Matches AC #3: "The decision snapshot is captured server-side, never from client-supplied numbers." It is also a correctness regression introduced by this PR.

**Recommendation:** IMPLEMENT

Read the freshest projection and price inside the transaction and drop the snapshot fields from the input schema entirely, so a future caller cannot supply them.
```

```markdown
## [DEFER] — Suggest adding suggestion-source reliability to this screen

**Technical assessment:** VALID

The analytics would fit naturally alongside the accuracy surface.

**Scope assessment:** ALREADY_PLANNED

Owned by Pitch 8: Adjustment Suggestions & Source Reliability, which also requires Pitch 6's grading to exist. Tracked in SIGHT-91: Suggestion reliability analytics.

**Recommendation:** DEFER

No change in this PR. No TODO needed — the roadmap already carries it.
```

```markdown
## [SKIP] — Use a Float for probability instead of Decimal

📎 `prisma/schema.prisma:L88`

**Reviewer said:** "Decimal is overkill for a probability, Float is faster."

**Technical assessment:** INVALID

The schema conventions require Decimal with explicit precision for anything a person reads as a number. Float introduces representation drift into the values that feed calibration bins, which is the product's primary success metric. The performance argument does not apply at a few thousand projections a week.

**Scope assessment:** OUT_OF_SCOPE

Conflicts with `sightline-spec` → Schema conventions and `architecture.md` → Tech Stack.

**Recommendation:** SKIP

No change. Worth a one-line reply so the convention is visible to the reviewer.
```

```markdown
## [DISCUSS] — Edge should be computed against the ask, not the midpoint

📎 `lib/edge.ts:L14`

**Technical assessment:** UNCERTAIN

The reviewer is raising a real question rather than a bug. Both sides of the book are stored precisely so either is computable.

**Scope assessment:** IN_SCOPE, pending a product decision

This is a named open question in both `prd.md` and `architecture.md`, explicitly left to be resolved against a real slate during this pitch.

**Recommendation:** DISCUSS

Decide before merge, since the choice drives ranking and recommendation. Safe default until then: display both, and rank by the executable price, which is the conservative option.
```

## Step 5: Summary

```markdown
## Summary

- **Implement:** X
- **Defer:** X
- **Skip:** X
- **Discuss:** X
```

Then a short final judgment naming what belongs in this PR and what does not.

## Important guidelines

- Always read the actual code the reviewer is commenting on.
- Cite specific acceptance criteria when classifying scope. Good: `Matches AC #3: "The decision snapshot is captured server-side, never from client-supplied numbers."` Bad: `Seems in scope.`
- Cite specific ticket IDs when something is already planned. Good: `Tracked in SIGHT-91: Suggestion reliability analytics.` Bad: `Already planned somewhere.`
- Cite specific docs when feedback conflicts with scope — the brief for permanent non-goals, the PRD for MVP boundaries, the architecture for stack and security decisions, the pitch for slice boundaries, the design doc for UX behavior, the spec for implementation constraints.
- Be honest when uncertain. **DISCUSS** is a valid answer, and four open questions are genuinely unresolved in the approved docs: edge against ask or midpoint, grading truth when Kalshi and the official line disagree, how the calibration surface treats superseded model versions, and whether RLS is enabled on the user-scoped tables. A comment landing on one of those is DISCUSS, not SKIP.
- **Do not implement anything.** Do not rewrite the PR unless explicitly asked after the audit.
- Stylistic preferences default to **SKIP** unless they materially affect readability, maintainability, accessibility, or consistency.
- Security, privacy, data-loss, temporal-leakage, and auth issues deserve extra scrutiny and are usually IN_SCOPE when introduced by this PR.
- Scope is not an excuse to ignore a real regression the PR introduced.
- Do not let reviewers drag deferred features into current work.
- Do not let the ticket grow because a comment sounded impressive.
- Do not accept suggestions that conflict with Sightline's approved direction unless the planning docs have changed.

### Approved architecture that resembles a non-goal

Do not flag these every review. Each looks like a boundary violation and is not:

- **Order placement exists** (`POST /api/orders`). Sightline is not a sportsbook and viewers never trade, but the admin trading through the app is Pitch 9, gated on a stored backtest run and a per-slate cap.
- **Invitation and revoke routes exist.** That is closed-group administration, not public signup.
- **The Python runtime bypasses row-level security** with a service-role credential. Sanctioned, because it never serves a user request.
- **Pre-2021 weather uses reanalysis**, which is a known leak. Accepted and reported, with the era recorded per record and calibration split across the two eras.
- **Stat corrections mutate `PlayerGameStat`** and re-grade downstream. That is the one deliberate exception to idempotence.
- **GitHub Actions has no timing SLA and runs can be late.** Tolerated by design, because staleness is disclosed rather than raced.

## Common Sightline review patterns

**Implement:** a read feeding a projection that does not thread the as-of cutoff; a decision handler trusting client-supplied snapshot values; an admin surface hidden client-side rather than rejected server-side; the Kalshi key appearing in an error path; a rate displayed without its sample size; a `user_not_found` returning 403 and confirming existence; a missing empty state on a list the design doc specifies; edge direction encoded by colour alone.

**Defer:** bankroll or P&L attribution during trading work (V2); a second suggestion source while building the first (Pitch 8 defers them explicitly); settlement grading raised during Pitch 4 slate work (Pitch 6 owns it); suggestion reliability analytics during Pitch 6 (Pitch 8 owns it); friend pick sharing; NBA-shaped generalisation raised during NFL work.

**Skip:** a competing styling system; `nfl_data_py` suggested over `nflreadpy`; Float over Decimal for probabilities; blocking a second decision on a contract where the PRD says warn; extracting a reusable abstraction for a three-user product; a nightly job to denormalise edge; adding a WebSocket to Kalshi; collapsing fade and skip.

**Discuss:** edge against ask or midpoint; grading truth when Kalshi settlement and the official stat line disagree; whether the calibration surface reports per model version, blends, or backfills; whether RLS is enabled on user-scoped tables; whether suggestion sources should be an enum or validated strings; whether a calibration bucket's minimum sample size is a config value or a constant.
