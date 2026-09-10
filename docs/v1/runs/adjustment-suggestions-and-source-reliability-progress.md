# Run Progress — Adjustment Suggestions & Source Reliability

Slug: `adjustment-suggestions-and-source-reliability`
Linear project: Sightline V1
Mode: Autonomous Pipeline Policy (CLAUDE.md)

**This run does not merge into `main`.** It ends with the feature branch verified,
reviewed, audited, green, and its PR left open for human review.

## Current step

**Step 8 in progress — SIG-74 DONE, SIG-75 next.** Steps 1–7 complete: pitch, design doc,
UI preview, spec (with Resolved Decisions §18), milestone + tickets SIG-74…SIG-80 chained,
feature branch `feat/adjustment-suggestions-and-source-reliability` + feature PR #72 open.
`progress.md` is edited ONLY on the feature branch (never ticket branches) to avoid
squash-merge conflicts; each ticket branch chains off the previous.

### Ticket status
- **SIG-74 DONE** — branch `feat/SIG-74-adjustment-suggestions-schema` (off feature branch),
  PR [#73](https://github.com/troyrhodes02/sightline/pull/73). Schema foundation:
  AdjustmentSourceEvent + AdjustmentSuggestion models, Projection `provenance` discriminator
  (joined into persist key), `pending_suggestion` constraint, PaperPosition annotation fields,
  mirrored TS/Python constants, import-graph guard extended, projection persist ON CONFLICT
  updated for provenance. GREEN: prisma validate; migrate deploy (dev + test DB); test:schema 30;
  jest 824; tsc; eslint(changed); prettier(changed); build; pytest 463. Linear In Progress + PR linked.
- **SIG-75 DONE** — branch `feat/SIG-75-suggestion-engine-core` (off SIG-74), PR
  [#74](https://github.com/troyrhodes02/sightline/pull/74). Python engine: state machine
  (`state_machine.py`), materiality (`materiality.py`), shadow computation via new
  `live.simulate_game_adjusted()` (subject forced unavailable), persistence (`db.py`,
  `engine.py`). RD-AS-6: insufficient_evidence keeps base_projection_id non-nullable;
  no-base contracts held via existing decline/stale path. GREEN: state machine 6,
  materiality 4, engine integration 3, import-graph 12; full pytest 476. Linear In Progress + PR linked.
- **SIG-76 DONE** — branch `feat/SIG-76-espn-inactives-ingest` (off SIG-75), PR
  [#75](https://github.com/troyrhodes02/sightline/pull/75). ESPN inactives OPTIONAL cycle
  source (`espn_inactives.py`): schema-tolerant parser, env client, resolution, team→game
  mapping, feeds engine; cycle + gameday tests updated for the new source. GREEN: espn 9,
  cycle+gameday+espn 33 together, full pytest 485. Linear In Progress + PR linked.
  NIT for review: cycle.py module docstring still says "Optional sources: weather" — update to name espn_inactives.
- **SIG-77 DONE** — branch `feat/SIG-77-grading-extensions` (off SIG-76), PR [#76](https://github.com/troyrhodes02/sightline/pull/76). Shadow grading pass + source-claim grading vs participation; added empirical-distribution grading (closes latent sim-grading gap). GREEN: grade-suggestions 4, grade-job 15, import-graph 12, full pytest 489. Linear In Progress + PR linked.
- **SIG-78 DONE** — branch `feat/SIG-78-resolver-and-block` (off SIG-77), PR [#77](https://github.com/troyrhodes02/sightline/pull/77). Active-projection resolver (accepted-shadow overlay + provenance=base guard across freshestProjections/cycle/dry-run) + pending_suggestion refusal in plan.ts + accept-time position annotation. GREEN: jest 831, plan+active-projection tests, schema 30, tsc, build. Linear In Progress + PR linked.
- **SIG-79 DONE** — branch `feat/SIG-79-routes-and-reads` (off SIG-78), PR [#78](https://github.com/troyrhodes02/sightline/pull/78). Accept/decline routes (admin, idempotent, session user, position annotation), reliability compute (two independent sample-gated figures, no combined field), pending/history/reliability reads. GREEN: jest 847, reliability+actions tests, tsc, build. Linear In Progress + PR linked.
  NOTE: slate/detail DTO plumbing for pending marker + accepted-reason line folded into SIG-80 (UI, where rendered).
- SIG-80 — pending (final ticket: UI).

Key design decisions taken (from codebase mapping):
- Shadow = Projection row with new `provenance` enum {base, adjustment_shadow} + FK
  `adjustmentSuggestionId`. Grade job grades every shadow in addition to freshest base.
- Slate/cycle active-projection selection filters provenance=base; accepted shadow becomes
  active via resolver, never by mutating rows.
- Autonomous block reuses `BindingConstraint`; add `pending_suggestion`.
- Suggestions = new admin-only nav section w/ tabs Pending | History | Reliability.
- Evidence floor reuses simulation `insufficient_evidence` decline reason.
- ESPN = new OPTIONAL ingest dataset (outage → stale, not cycle failure).

## Precondition check (from run instruction)

Simulation Engine constants required by this pitch ARE present in the repo — run does
NOT halt under stop condition 1:

- Evidence floor: `MIN_ELIGIBLE_GAMES = 1` in `python/src/sightline_model/constants.py`
  ("Zero eligible games is not a wide projection, it is no projection."). Decision 6
  reuses this floor.
- Confidence representation: `CONFIDENCE_BANDS` + ordinal `low/medium/high` labels
  (same file, lines 39–72).
- Cutoff policy: `kickoff_minus_90m/v1` (`CUTOFF_MINUTES_BEFORE_KICKOFF = 90`), distinct
  from the staking pitch's 10-minute trading cutoff (decision 4).

## Pipeline steps

1. [x] Pull pitch → `docs/v1/pitches/adjustment-suggestions-and-source-reliability.md`
2. [x] Design doc → `docs/v1/design-docs/...-design-doc.md`
3. [x] UI preview → `docs/v1/ui/...-ui-preview.html`
4. [ ] Spec → `docs/v1/specs/...-spec.md` (in progress)
5. [x] Resolve remaining open questions (recorded as Resolved Decisions in spec §18)
6. [x] Milestone + Linear issues chained with blockedBy; identifiers SIG-74…SIG-80 captured below
7. [x] Feature PR into main → PR #72 (https://github.com/troyrhodes02/sightline/pull/72)
8. [ ] Ticket worker — every ticket in order (SIG-74 in progress)
9. [ ] Runbook → `docs/v1/runbooks/...-runbook.md`
10. [ ] Squash-merge every ticket PR into feature branch
11. [ ] Full verification suite (+ pitch-specific required tests)
12. [ ] /review feature branch vs main → inline comments on feature PR
13. [ ] /sightline-review-audit those comments
14. [ ] Commit, push, re-run full suite. STOP — do not merge to main.
15. [ ] Run report → `docs/v1/runs/...-report.md`

## Pre-resolved decisions (from run instruction — approved-doc authority)

1. Pending material suggestion blocks only the affected player's contracts (reuse
   stale-projection refusal path; tag reason `pending_suggestion` vs `stale_projection`).
2. No automatic-trust setting — not even a disabled toggle.
3. Dedup/reversal/conflict identity = `(source, player, claim_type)`. Identical repeat →
   update last-confirmed timestamp only. Changed value → supersede prior + evaluate fresh.
   Two conflicting values within 5 min unconfirmed → `conflicting_reports` state.
4. Kickoff timestamp freezes the pre-game record (distinct check from the 10-min trading
   cutoff). Post-kickoff suggestion retained, flagged non-actionable, never edits frozen record.
5. Materiality: ≥3 pp threshold-probability shift on ≥1 listed contract, OR (no listed
   contract) ≥10% relative shift to projected value.
6. "Cannot calculate adjustment" evidence floor = Simulation Engine's zero-evidence floor
   (`MIN_ELIGIBLE_GAMES`); insufficient → block affected contract like a pending suggestion.
7. Viewers see reason for ACCEPTED adjustments only; never pending/declined/controls.
8. Existing positions frozen in place, annotated; no auto-exit (not even disabled flag).
9. Reliability minimum sample = 15, independently per metric, count always shown.
10. Source accuracy graded against official participation data, never Kalshi settlement.

Run-chosen numeric defaults flagged for human review: 5-minute conflict window,
15-observation reliability minimum.

## Resolved Decisions (accumulated during run)

_(recorded in spec; mirrored here as they are made)_

## Tickets (milestone: Adjustment Suggestions & Source Reliability)

Chained linearly with `blockedBy`; work in this order. Each branch off the previous.

1. **SIG-74** — Schema foundation (models, provenance, pending_suggestion, constants). No blocker.
2. **SIG-75** — Suggestion engine core (Python): state machine, materiality, shadow, evidence floor. blockedBy SIG-74.
3. **SIG-76** — ESPN inactives ingest (Python): optional dataset, resolution, cycle wiring, outage. blockedBy SIG-75.
4. **SIG-77** — Grading extensions (Python): shadow grading + source-claim grading vs participation. blockedBy SIG-76.
5. **SIG-78** — Active-projection resolver + autonomous pending block (TS). blockedBy SIG-77.
6. **SIG-79** — Accept/decline routes + suggestion reads/DTOs + reliability (TS). blockedBy SIG-78.
7. **SIG-80** — UI: pending panel, slate marker, accepted reason, Suggestions section, nav. blockedBy SIG-79.

Feature branch: `feat/adjustment-suggestions-and-source-reliability`. Ticket branches chain off it in order.

## Notes for a resuming session

- Feature branch name (planned): `feat/adjustment-suggestions-and-source-reliability`
- Do NOT build any auto-approve/auto-trust path — that is a halt (see scope note).
- Kalshi price never a status signal — halt.
- Source vs Adjustment accuracy never collapsed into one number — halt.
- Never delete/overwrite base projection on accept, or shadow on decline — halt.
