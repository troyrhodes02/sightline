# Run progress — Kalshi Sync, The Slate & Decision Log

Autonomous pipeline run under the Autonomous Pipeline Policy (`.claude/CLAUDE.md`).
Slug: `kalshi-sync-the-slate-and-decision-log`. Linear project: **Sightline V1**.

A fresh session resuming this run should read this file, the pitch at
`docs/v1/pitches/kalshi-sync-the-slate-and-decision-log.md`, and (once they exist)
the design doc, UI preview, and spec listed below, then continue from **Current step**.

## Current step

Step 11 — full verification suite on the feature branch.

Feature branch: `feature/kalshi-sync-the-slate-and-decision-log`. Feature PR: https://github.com/troyrhodes02/sightline/pull/34 (base `main`). All seven tickets are squash-merged onto the feature branch in order (`53f02fa`, `0655749`, `7b2a354`, `c0cb876`, `0f044e1`, `de9eb56`, `4290fe2`, plus fix `a02c8c9`); the tree is byte-identical to the fully verified stack tip (`git diff feat/SIG-45-decision-log` empty at merge time).

**Merge incident, resolved:** PR #35 was merged via GitHub with `--delete-branch`; deleting its branch CLOSED stacked PR #36 instead of retargeting it, and GitHub refuses to reopen a PR whose base was deleted. The remaining stack (#36–#41) was therefore squash-merged locally in order and each PR closed with a comment naming its squash commit. A scripted conflict resolution during those merges briefly committed conflict markers to `src/env.ts` and the detail page; caught by tree comparison against the stack tip and fixed in `a02c8c9`.

## Pipeline steps

1. [x] Pull pitch doc from Linear → `docs/v1/pitches/kalshi-sync-the-slate-and-decision-log.md` (Linear doc `133b353a-1b81-4f36-a521-84a44b91da1c`)
2. [x] Design doc → `docs/v1/design-docs/kalshi-sync-the-slate-and-decision-log-design-doc.md`
3. [x] UI preview → `docs/v1/ui/kalshi-sync-the-slate-and-decision-log-ui-preview.html`
4. [x] Spec → `docs/v1/specs/kalshi-sync-the-slate-and-decision-log-spec.md`
5. [x] Resolve all open questions as Resolved Decisions in the spec (RD-1 … RD-18)
6. [x] Milestone + Linear issues chained with blockedBy; identifiers recorded below
7. [x] Feature PR into `main`: #34, branch `feature/kalshi-sync-the-slate-and-decision-log`
8. [x] Work every ticket in order via `/sightline-ticket-worker`; PR per ticket
9. [x] Runbook → `docs/v1/runbooks/kalshi-market-sync.md` (Kalshi API access, env vars; note CI-secret reuse)
10. [x] Squash-merge ticket PRs into feature branch in order
11. [ ] Full verification suite on feature branch (lint, typecheck, format, tests, build, e2e)
12. [ ] `/review` feature branch vs `main`; findings as inline comments on feature PR
13. [ ] `/sightline-review-audit` the findings; implement/defer/discuss/skip
14. [ ] Re-verify; squash-merge feature branch into `main` if green
15. [ ] Run report → `docs/v1/runs/kalshi-sync-the-slate-and-decision-log-report.md`

## Tickets

Milestone: **Pitch 4: Kalshi Sync, The Slate & Decision Log** (`d6d3cfb4-c7b4-4804-b50b-7a771140f138`) in project Sightline V1, team Sightline. Work in this order (each blockedBy the previous):

| # | ID | Title | Status | Branch | PR |
| - | -- | ----- | ------ | ------ | -- |
| 1 | SIG-39 | Pitch 4 schema: market, projection, and decision tables | merged (Done) | `feat/SIG-39-pitch-4-schema` | #35 |
| 2 | SIG-40 | Kalshi client, market sync, and contract resolution | merged (Done) | `feat/SIG-40-kalshi-market-sync` | #36 |
| 3 | SIG-41 | Python projection persistence: sightline-model project CLI | merged (Done) | `feat/SIG-41-projection-persist` | #37 |
| 4 | SIG-42 | Slate read model: edge, ranking, recommendation snapshots, DTOs | merged (Done) | `feat/SIG-42-slate-read-model` | #38 |
| 5 | SIG-43 | The slate UI: ranked list, states, and price polling | merged (Done) | `feat/SIG-43-slate-ui` | #39 |
| 6 | SIG-44 | Contract detail: reasoning view, distribution summary, unresolved flow | merged (Done) | `feat/SIG-44-contract-detail` | #40 |
| 7 | SIG-45 | Decision log: capture, snapshots, privacy, and e2e | merged (Done) | `feat/SIG-45-decision-log` | #41 |

### First-ticket summary (SIG-39)

The foundation the rest stack on. PR #35 (base: feature branch) adds the full Pitch 4 schema — `Contract` (identity = kalshiTicker, never deleted), `MarketSyncRun` (refresh completeness as a recorded fact), append-only `PriceObservation` (both book sides, integer cents), `Projection` + `ProjectionDriver` (compact distribution + both clocks + idempotent persist key), `RecommendationSnapshot` (RD-4 trigger history), and append-only user-scoped `Decision` with the full server-read snapshot column set. Schema-invariant guard extended with five Pitch 4 tests (non-fact classification, no derived-state columns, snapshot completeness, append-only posture, projection clocks/key). Migration `20260801075834_pitch4_market_projection_decision_tables` applied to the local dev DB. Full verification green: schema tests (16), jest (106), lint, typecheck, format, build.

Environment fix made en route: this Windows checkout had `core.autocrlf=true`, which put CRLF in the working copy and failed prettier (`endOfLine: lf`) on 84 files. Fixed repo-locally (`git config core.autocrlf false` + LF normalization); `schema-invariants.test.mjs` was EOL-normalised in the SIG-39 commit. No content changes outside the ticket.

Linear note: the Sightline team has no "In Review" state (Backlog/Todo/In Progress/Done). Tickets are set to **In Progress** when their PR opens and **Done** when squash-merged into the feature branch at step 10.

Branching: SIG-39 branches off the feature branch; each subsequent ticket branches off the previous ticket's branch. Each ticket gets its own PR (base = previous branch / feature branch for the first), attached to its Linear issue. Ticket PRs are squash-merged into the feature branch in order (step 10).

## Resolved Decisions

All recorded in the spec (`docs/v1/specs/kalshi-sync-the-slate-and-decision-log-spec.md` → "Resolved Decisions", RD-1 through RD-18). Summary:

- RD-1: executable ask drives edge/ranking/recommendation; mid is detail context.
- RD-2: one flat ranked list, one row shape, no slate pagination.
- RD-3: Pitch 2 baseline drivers exist (verified in `projection.py`); displayed verbatim.
- RD-4: snapshot triggers = appeared, state_changed, decision. No per-refresh snapshots.
- RD-5: decisions append-only with per-row server snapshots; no un-mark.
- RD-6: scheduled kickoff is the server-enforced actionability boundary (post-kickoff writes BLOCK, diverging from api-conventions "warn" — pitch outranks reference).
- RD-7: unresolved contracts visible to both roles; diagnostics/resolve admin-only.
- RD-8: `MarketSyncRun` records complete/partial/failed/empty per sync.
- RD-9: mapping corrections future-only, via existing `PlayerExternalId` manual_override.
- RD-10: no accuracy cues on detail; provenance block reserved for Pitch 6.
- RD-11: threshold via `RECOMMENDATION_THRESHOLD_POINTS` env (default 5); confidence weights high 1.0 / med 0.7 / low 0.4 in one exported constant.
- RD-12: polling = bare setInterval island → POST /api/prices/refresh + router.refresh(); no data-fetching library.
- RD-13: server-side refresh coalescing (`KALSHI_SYNC_MIN_INTERVAL_SECONDS`, default 30).
- RD-14: price observations written on change + 15-minute heartbeat.
- RD-15: Python projects contract-listed players only; contracts identity columns only; import-graph test extended.
- RD-16: RLS not enabled this pitch; server-side checks are the mechanism.
- RD-17: contract identity = kalshiTicker; relisting = new contract; delisted never deleted.
- RD-18: Kalshi client optional signing for market data; no order/portfolio endpoint wrapped.
- RD-19 (implementation, SIG-40): Kalshi's live NFL player-prop taxonomy (verified against the exchange 2026-08-01) maps four series to Sightline stat types — KXNFLPASSYDS, KXNFLRSHYDS, KXNFLRECYDS, KXNFLREC. Combined-touchdown series (KXNFLTD/KXNFLANYTD/…) split neither rushing nor receiving TDs, map to no StatType, and are not discovered.
- RD-20 (implementation, SIG-44): contract detail renders as a URL-addressed page at all widths with a back link, rather than the design doc's xs-drawer/md-side-panel overlay presentation. Content, states, focus, and deep-linking follow the spec; overlay presentation is deferred polish nothing precludes.

## Deferred

Nothing yet.

## Scope guardrails for this run

- Reading Kalshi market data (discovery, prices, both book sides) is IN scope and not a halt.
- Order placement, position sizing, bankroll/ledger work, or storing signing credentials
  beyond what read access requires WOULD be a halt (stop condition 3).
