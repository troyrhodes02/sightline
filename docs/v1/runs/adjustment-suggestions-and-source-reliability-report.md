# Run Report — Adjustment Suggestions & Source Reliability

Slug: `adjustment-suggestions-and-source-reliability`
Linear project: Sightline V1 · Milestone: **Adjustment Suggestions & Source Reliability**
Mode: Autonomous Pipeline Policy (`CLAUDE.md`)

## ⚠️ Status: awaiting human review — NOT merged

The feature branch `feat/adjustment-suggestions-and-source-reliability` is verified,
reviewed, audited, and green. **It has not been merged into `main`.** The feature PR is
open for a line-by-line human read, exactly as the run instruction required (this pitch
decides how an unvalidated third-party feed touches the projections the paper bot trades
on, so it gets read before it lands).

- **Feature PR:** [#72 — Adjustment Suggestions & Source Reliability (SIG-74…SIG-80)](https://github.com/troyrhodes02/sightline/pull/72)
- **Branch:** `feat/adjustment-suggestions-and-source-reliability` → base `main`
- All seven ticket PRs (#73–#79) were squash-merged into the feature branch, in order.

## What shipped

ESPN inactives as the first Adjustment Suggestions source: a late report becomes a
reviewable proposed change to a projection, accepted/declined in one admin action and
**graded either way**, without the unproven feed ever changing a projection automatically.
Source Accuracy and Adjustment Accuracy are reported as two independent, sample-gated
figures that are never combined.

### Tickets (all done; each own PR merged into the feature branch)

| Ticket | PR | Scope | State |
| ------ | -- | ----- | ----- |
| SIG-74 | #73 | Schema foundation — `AdjustmentSourceEvent`, `AdjustmentSuggestion`, `Projection.provenance`, `pending_suggestion`, position annotation, mirrored constants, import-graph guard | merged→feature; Linear In Progress |
| SIG-75 | #74 | Suggestion engine (Python) — state machine, materiality, shadow via `simulate_game_adjusted`, evidence-floor decline | merged→feature; In Progress |
| SIG-76 | #75 | ESPN inactives ingest (Python) — optional cycle source, resolution, honest outage | merged→feature; In Progress |
| SIG-77 | #76 | Grading extensions (Python) — shadow grading + source-claim grading vs participation; empirical-distribution grading | merged→feature; In Progress |
| SIG-78 | #77 | Active-projection resolver + autonomous pending block (TS) | merged→feature; In Progress |
| SIG-79 | #78 | Accept/decline routes + reads + reliability (TS) | merged→feature; In Progress |
| SIG-80 | #79 | Suggestions UI — admin section (Pending/History/Reliability) + nav | merged→feature; In Progress |
| SIG-81 | — | **Follow-up (backlog):** unify the active-projection resolver, de-dup `buildCandidates`, batch two N+1 reads (from the review audit) | Backlog |

_(Linear has no "In Review" state; ticket PRs open + branch awaiting human read are recorded as "In Progress" with the PR linked.)_

### Pipeline artifacts

- Pitch `docs/v1/pitches/…`, Design doc `docs/v1/design-docs/…`, UI preview `docs/v1/ui/…`,
  Spec `docs/v1/specs/…` (Resolved Decisions in §18), Runbook `docs/v1/runbooks/…`, this report,
  and the progress file.

## Decisions made on the user's behalf

The ten pre-resolved decisions from the run instruction were adopted verbatim and recorded
in the spec's Resolved Decisions (§18) with rationale. Implementation resolutions made
during the run:

- **RD-AS-1** — Introduced `AdjustmentSourceEvent` as a claim-level entity distinct from the
  per-projection `AdjustmentSuggestion` (the Architecture Doc names only the latter). A single
  ESPN claim moves several teammates, and the dedup identity / reversal chain / Source Accuracy
  grade are claim-level. *Requires an Architecture Doc amendment (below).*
- **RD-AS-2** — Shadow = a `Projection` row discriminated by a new `provenance` enum, graded
  through the existing job (base pass restricted to `provenance='base'`; a second pass grades
  every shadow). Keeps `model_version` semantically pure.
- **RD-AS-3** — An accepted shadow becomes active via a shared resolver, never by mutating rows;
  every freshest-projection site filters `provenance='base'`.
- **RD-AS-4** — Adjustment outcome (improved/hurt/neutral) computed on read from base vs shadow
  `ProjectionGrade.absErrorMean`; not stored.
- **RD-AS-5** — ESPN reports live only on `AdjustmentSourceEvent`, never `PlayerGameContext`, so
  the feed never reaches the as-of feature path.
- **RD-AS-6** — `insufficient_evidence` suggestions keep `base_projection_id` non-nullable; a
  contract with no defensible base projection is already held from autonomous trading by the
  existing `ProjectionDecline`/staleness path.
- **Empirical-distribution grading** (SIG-77) — added to grade shadows; also makes ordinary
  simulation *base* projections gradable for completed games for the first time (previously a
  latent gap, since simulation projections only existed for upcoming games). Correct and necessary.
- **Run-chosen numeric defaults** (not specified upstream — flagged for human review): the
  **5-minute conflict window** and the **15-observation reliability minimum**.

No stop condition was hit. Every open question was resolved, not deferred to the user.

## Review findings and disposition (`/review` on PR #72 → `/sightline-review-audit`)

The review ran 8 finder angles; the conventions pass came back **clean** (prices never reach
the suggestion path; shadow computed through `AsOfCorpus` at the claim's `known_at`; accept is
transactional; the two accuracies are never combined; MUI/theme-compliant; Python never migrates;
the shadow-contamination `provenance='base'` guard present at all three selection sites).

**Implemented (5 + 1):**
1. Grade-transaction blast radius — shadows now grade in a separate pass so a malformed shadow can't roll back a game's base grades.
2. Accept/decline TOCTOU — conditional `updateMany … where status='pending'` inside the transaction.
3. `_subject_stat_version` returns `None` (not 0) for an absent stat row, preserving correction-driven re-grade.
4. `_SHADOW_ELIGIBLE_SQL` adds the `information_cutoff <= kickoff_at` guard (defence-in-depth temporal integrity).
5. Engine no longer silently drops a listed target with a base but no shadow projection — it raises an `insufficient_evidence` hold (closes a decision-1 gap).
6. `projectionKey` deduped (imported from `active-projection`).

**Deferred → SIG-81 (backlog) + code comments:** unify the active-projection resolver / de-dup
`buildCandidates` (touches the live trading cycle — its own careful change), and batch two N+1
reads (perf only, batch jobs, low priority at 3-user/14-game scale). No correctness impact.

**Skipped:** none. **Conventions:** clean.

## Verification results (per check, on the feature branch, after audit fixes)

| Check | Result |
| ----- | ------ |
| `npx prisma validate` | ✅ valid |
| `npx prisma migrate deploy` (dev + disposable test DB) | ✅ applies cleanly |
| `npm run test:schema` | ✅ 30 passed |
| `npm test` (jest, unit + component) | ✅ **851 passed** |
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ succeeds |
| `npx eslint` (tracked files) / `prettier` (scope) | ✅ clean |
| `uv run pytest -q` (Python, incl. leakage + import-graph) | ✅ **489 passed** |
| Playwright e2e (`e2e/suggestions.spec.ts`) | ⚠️ compiles; **skipped** — requires provisioned Supabase + seeded `E2E_*` accounts (per the suite's standing convention; same as the existing decisions e2e) |

### Pitch-required tests (step 11) — all present and green

- Declining a suggestion still results in a graded shadow at outcome time — `test_grade_suggestions.py`.
- An accepted suggestion's base projection remains separately queryable and gradable — `test_grade_suggestions.py`.
- Dedup/reversal/conflict — three outcomes from one rule — `test_suggestion_state_machine.py`.
- A post-kickoff suggestion never alters the frozen pre-game record, using the **kickoff timestamp** (not the 10-min cutoff) — `test_suggestion_engine.py` + `test_suggestion_state_machine.py`.
- A pending material suggestion blocks only the affected player's contracts; an unrelated contract in the same game/slate still trades — `src/lib/paper/plan.test.ts`.
- Import-graph/behavioral: no suggestion/shadow/materiality path reads `PriceObservation` — `test_import_graph.py`.
- Source Accuracy and Adjustment Accuracy are two independent, independently sample-gated values, never combined — `src/lib/suggestions/reliability.test.ts` + `Suggestions.test.tsx`.

## Deferred / follow-ups

- **SIG-81** (backlog): resolver unification, `buildCandidates` de-dup, N+1 batching.
- **Shared-surface rendering (fast-follow):** the viewer-facing accepted-adjustment reason line
  and the slate pending marker (decision 7's shared artifact) are not yet rendered. The data
  layer supports them (the active-projection resolver returns the accepted shadow); only the
  serializer + component wiring remain. Kept out of SIG-80 to land it green late in the run;
  the admin Suggestions section (accept/decline, reliability) is complete. **Recommend a small
  fast-follow ticket.**

## Required upstream doc amendments (for human action)

1. **PRD / Pitch Roadmap** — record the **per-player (not per-game or per-slate)** scope of a pending-suggestion trading block (decision 1).
2. **PRD** — record that automatic source trust is explicitly deferred to a future, separately-designed pitch — **no toggle or disabled flag exists** in this codebase (decision 2).
3. **PRD** — record the `(source, player, claim_type)` identity model as the approved dedup/reversal/conflict mechanism (decision 3).
4. **Architecture Doc** — record the **kickoff-timestamp freeze boundary as distinct from the staking pitch's 10-minute trading cutoff** — two different checks against two different timestamps (decision 4). Also **name `AdjustmentSourceEvent`** as the claim-level entity distinct from `AdjustmentSuggestion` (RD-AS-1).
5. **PRD** — record the **3-percentage-point / 10%-relative** materiality thresholds as the approved suggestion-triggering rule (decision 5).
6. **PRD** — record that the evidence floor for "cannot calculate an adjustment" is the **same floor the Simulation Engine established** (`EVIDENCE_FLOOR_OPPORTUNITIES` / `insufficient_evidence`), not an independent threshold (decision 6).
7. **Human review of this run's numeric defaults** — the **5-minute conflict window** and the **15-observation reliability minimum**, neither specified upstream (mirrored in `src/lib/suggestions/config.ts` and `python/src/sightline_model/suggestions/constants.py`).

Also note the pre-existing doc numbering inconsistency: the pitch author calls this "Pitch 9" while `docs/planning/sightline-pitch-roadmap.md` numbers it "Pitch 10." Not a stop condition; worth reconciling.

## Note on local environment (not a branch issue)

`npm run lint` over the whole tree reports 4 `no-console` errors in `prisma/seed-dev-game.ts`.
That file is **untracked** (present in the working tree at session start, `?? prisma/seed-dev-game.ts`),
is **not on this branch**, and is invisible to CI (which checks out the branch). It is unrelated
to this feature and was left untouched.
