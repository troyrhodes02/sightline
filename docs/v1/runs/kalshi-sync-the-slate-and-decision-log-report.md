# Run report — Kalshi Sync, The Slate & Decision Log

Autonomous pipeline run under the Autonomous Pipeline Policy. Started and completed 2026-08-01. **Outcome: completed and merged to `main`** (PR #34, squash commit on `main`; no stop condition was hit).

## What shipped

Pitch 4 end to end — the first complete user-facing product loop:

- **Kalshi Market Sync (discovery + live pricing):** read-only Kalshi client with optional RSA-PSS signing; discovery over the four live-verified NFL player-prop series; deterministic parsing; contract resolution through the Pitch 1 `PlayerExternalId` mechanism with exact normalized-name matching and admin manual correction; append-only both-sides price observations (change + 15-min heartbeat); `MarketSyncRun` completeness accounting; coalesced `POST /api/prices/refresh`.
- **Edge Calculation and Recommendation:** read-time join of freshest projection × freshest observation; threshold probability rehydrated in TypeScript with golden-file parity (1e-9) against the Python engine; executable-ask edge with better-side selection; confidence-adjusted deterministic ranking; configurable threshold; `RecommendationSnapshot` history at appeared/state_changed/decision transitions.
- **Decision Log:** append-only `Decision` rows with server-read snapshots, `supersedesDecisionId` chains, server-enforced kickoff boundary, admin-only end to end; viewer payloads structurally carry no decision keys.
- **Surfaces:** the ranked slate (replacing the Pitch 3 placeholder) with every designed empty/degraded/partial state and the RD-12 polling island; contract detail with distribution summary (themed Recharts), verbatim drivers, both books, provenance, unresolved variants, and the take/fade/skip control.
- **Python:** `sightline-model project` CLI persisting projections + drivers through the as-of layer, idempotently, for contract-listed players only.
- **Docs:** pitch (from Linear), design doc, UI preview, spec, runbook (`docs/v1/runbooks/kalshi-market-sync.md`), progress file, this report.

## Tickets and PRs

Milestone **Pitch 4: Kalshi Sync, The Slate & Decision Log** in Sightline V1. All seven tickets **Done**; all PRs closed with their content on `main` via the feature branch.

| Ticket | Title | PR | Squash commit on feature branch |
| ------ | ----- | -- | ------------------------------- |
| SIG-39 | Pitch 4 schema | #35 (merged) | `53f02fa` |
| SIG-40 | Kalshi client, market sync, resolution | #36 (closed→local squash) | `0655749` |
| SIG-41 | Python projection persistence | #37 (closed→local squash) | `7b2a354` |
| SIG-42 | Slate read model | #38 (closed→local squash) | `c0cb876` |
| SIG-43 | Slate UI | #39 (closed→local squash) | `0f044e1` |
| SIG-44 | Contract detail | #40 (closed→local squash) | `de9eb56` |
| SIG-45 | Decision log (+runbook) | #41 (closed→local squash) | `4290fe2` |

Feature PR **#34** squash-merged into `main` 2026-08-01T09:11:58Z.

**Merge-mechanics incident (resolved, no content impact):** merging #35 with branch deletion caused GitHub to close stacked PR #36 (unreopenable once its base was deleted). The remaining stack was squash-merged locally in order and each PR closed with a comment naming its squash commit. A scripted conflict resolution during those merges briefly committed conflict markers to two files; caught immediately by comparing the merged tree against the fully-verified stack tip and fixed in `a02c8c9`. The final tree was byte-identical to the stack tip before verification ran.

## Decisions made on the user's behalf

Twenty Resolved Decisions, RD-1…RD-18 in the spec (`docs/v1/specs/kalshi-sync-the-slate-and-decision-log-spec.md`) with rationales, RD-19/RD-20 in the progress file. Highlights:

- **RD-1:** the executable ask of the better side drives edge, ranking, and recommendation; midpoint is labelled context on detail. (Resolves the pitch's open question 1 conservatively; revisited with fees in Pitch 7.)
- **RD-4:** snapshots persist at transitions only (appeared, state_changed, decision) — no per-refresh snapshot noise, no final pre-kickoff capture (Pitch 6).
- **RD-5/6:** decisions are append-only with per-row server snapshots, no un-mark, and a server-enforced kickoff boundary that **blocks** post-kickoff writes — deliberately diverging from the api-conventions reference's "warn" posture because the pitch's definition of done outranks the reference.
- **RD-11–14:** threshold/weights/polling/coalescing/heartbeat as env config with documented defaults; polling is a bare interval, no new dependency.
- **RD-15:** Python projects contract-listed players only, reading contract identity columns exclusively; the import-graph guard extends over the new tables.
- **RD-16:** RLS not enabled (would be inert through Prisma's connection role); the upstream open question remains open rather than silently resolved.
- **RD-19:** live-verified series taxonomy; Kalshi's combined-TD series map to no Sightline stat type and are not discovered.
- **RD-20:** contract detail is a URL-addressed page at all widths rather than drawer/panel overlays — content and states per spec, presentation polish deferred.
- **Guard boundary moved with the pitch:** Pitch 3's "no Kalshi credential variable exists" tests were replaced with the sharper current boundary (key pair optional, client-invisible, exactly two reader modules, structurally write-free) rather than deleted or weakened.

## Review findings and dispositions

`/review` of the feature branch vs `main` left five inline findings on PR #34; `/sightline-review-audit` dispositioned them (4 implement, 1 skip), applied in `be5b868`:

1. **Implemented (medium):** a recommendation whose inputs vanish now records its `state_changed` snapshot instead of leaving a stale "recommended" for Pitch 6 grading.
2. **Implemented:** snapshot-dedup docstring now states the real (best-effort) concurrency guarantee.
3. **Implemented:** the delist pass requires a complete **and non-empty** discovery — zero markets is indistinguishable from taxonomy drift and no longer mass-delists.
4. **Implemented:** a no-game contract must be `active` to be decidable, closing the ghost-market case; the game boundary stays primary.
5. **Skipped:** detail page's second contract read — immaterial at scale, not worth widening the DTO.

## Deferred

- **Full take→fade browser e2e flow** — no contract-seeding path exists in the e2e environment (contracts come only from live discovery). Covered at component + structural level; noted in SIG-45's PR as a natural follow-up once Pitch 5's scheduled sync exists. *(Code-comment/PR-note level; no ticket created — Pitch 5 work will naturally create the seam.)*
- **Drawer/side-panel presentation for contract detail** (RD-20) — deferred polish, nothing precludes it.
- **Snapshot dedup constraint** — only if Pitch 6 grading turns out to care about duplicate identical snapshots.

## Requiring a decision that could not be made autonomously

None. Every open question was resolvable inside the authority order; the four upstream open questions that remain open (grading truth, model-version treatment, RLS, ask-vs-mid revisit at Pitch 7) are recorded in the spec rather than silently answered.

## Verification results (final, on the merged head `be5b868`)

| Check | Command | Result |
| ----- | ------- | ------ |
| Lint | `npm run lint` | pass (0 problems) |
| Typecheck | `npm run typecheck` | pass |
| Format | `npm run format` | pass |
| Unit/integration | `npm test` | 26 suites, **217 passed**, 0 failed |
| Schema guard | `npm run test:schema` | **16 passed**, 0 failed |
| Build | `npm run build` | pass |
| Python | `uv run pytest` | **314 passed**, 0 failed (includes DB-marked leakage + idempotence) |
| E2E | `npm run test:e2e` | **42 passed, 20 skipped** — the credentialed specs are env-gated by design (`E2E_*` unset locally) and report as skipped, never as passed |

Python lint/format/type-check: no such tools are configured in `pyproject.toml`; none were run and none are claimed.

Backtest comparison: not required — no feature computation, `known_at` handling, or as-of-layer code changed; the new Python module is a consumer of the existing as-of layer, and its leakage property is covered by a new adversarial DB test (post-cutoff fact → byte-identical parameters).

## Notes for the operator

- Read `docs/v1/runbooks/kalshi-market-sync.md` before the first in-season slate: Kalshi access, env vars (also future CI secrets), the manual `sightline-model project` step, and the first-slate workflow.
- The dev-environment fix `core.autocrlf=false` (repo-local) is recorded in memory; a few pre-existing files were EOL-normalised in SIG-39's commit.
