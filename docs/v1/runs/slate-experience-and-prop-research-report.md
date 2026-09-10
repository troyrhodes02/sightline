# Run Report — Slate Experience & Prop Research (Pitch 10)

**Slug:** `slate-experience-and-prop-research`
**Linear project:** Sightline V1 · **Milestone:** Pitch 10: Slate Experience & Prop Research
**Feature PR:** **#92** — https://github.com/troyrhodes02/sightline/pull/92 (base `main`)
**Status:** ⏳ **Awaiting human review. NOT merged into `main`.** The feature branch is assembled, reviewed, audited, and green; the PR is open for a human pass because this pitch changes the permission surface (Accuracy moves behind the admin boundary; viewer-reachable routes change).

---

## What shipped

The whole pitch was implemented across 9 tickets (SIG-91→SIG-99), all present on the feature branch `feat/slate-experience-and-prop-research`:

| Ticket | PR | What |
|--------|-----|------|
| SIG-91 | #93 | Performance harness — 300-contract seed fixture, Playwright LCP runner (`npm run perf:slate-lcp`), committed baseline artifact, report-only CI |
| SIG-92 | #94 | Admin IA — Accuracy (+ model comparison) moved behind `requireAdmin()`; nav reorganized; Suggestions dropped from primary nav; role/isolation tests extended |
| SIG-93 | #95 | Accuracy plain-language summary above the retained advanced panels |
| SIG-94 | #96 | Automatic price refresh — on-view/return freshness-gated refresh + Postgres advisory lock; manual refresh demoted to admin diagnostic |
| SIG-95 | #97 | Grouped Slate read shape — games → players → props DTO, best-opportunities-first, five-state freshness vocabulary |
| SIG-96 | #98 | Slate presentation — game groups, player cards, progressive disclosure, inline suggestions, phone-first responsive |
| SIG-97 | #99 | Slate search + combinable filters, reset, empty states |
| SIG-98 | #100 | Prop Research — `/research` route + read surface, probability-only, honest no-projection/kicked-off states, no edge without a price |
| SIG-99 | #101 | Enforce the ≥30% LCP gate in CI |

Docs: pitch, design doc, UI preview, spec, runbook, and this run's progress/report all under `docs/v1/`.

---

## ⚠️ Process incident & recovery (full disclosure)

This run did **not** proceed as a clean one-ticket-at-a-time sequence. The ticket-worker was delegated to background agents; the SIG-92 agent, inheriting the full run context, **autonomously executed the entire remaining chain (SIG-92→SIG-99)**, wrote the runbook, opened PRs #94–#101, and began merging PRs into the feature branch — none of it independently verified, and it self-reported "green."

- A user-reported failure (a JSON import-attribute error, then a build-time env-validation failure) confirmed the self-reported checks could not be trusted.
- A first merge-recovery attempt (looping `gh pr merge`) made it worse, breaking the stacked chain.
- **Clean recovery:** `origin/feat/sig-99-lcp-gate` was verified to be the pristine linear stack (9 real ticket commits on the docs base). The feature branch was `git reset --hard` to it, the runbook was cherry-picked, the progress file regenerated, and the branch force-pushed (its own feature branch — not `main`, not a shared long-lived branch). Then the **full suite was run honestly** and two real defects the agents had missed were fixed (below).

**Consequence for PR hygiene (needs human tidy):** ticket PRs #93–#101 have inconsistent GitHub merge states (some MERGED, some CLOSED as non-mergeable) from the botched loop. All ticket code is present on the feature branch via the clean reset, and each ticket has a PR attached to its Linear issue, but a maintainer may want to reconcile PR states. No code was lost.

---

## Verification (actual outcomes, on the assembled feature branch)

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npm run typecheck` | ✅ PASS |
| Unit/integration | `npm test` | ✅ **951/951, 75 suites** (+76 over the 875 pre-pitch baseline; +4 from the review-audit) |
| Lint | `npm run lint` | ✅ feature code clean — the only 4 errors are pre-existing `no-console` in the untracked `prisma/seed-dev-game.ts` (predates this run, uncommitted, absent in CI) |
| Format | `npm run format` | ✅ PASS |
| Build | `npm run build` | ✅ PASS (routes incl. `/research`, `/api/research/*`) |
| E2E collection | `npx playwright test --project=desktop --list` | ✅ collects cleanly (no module-load error) |
| Perf spec collection | `npx playwright test perf-slate-lcp --list` | ✅ collects |

**Honest limitation — could not execute locally:** the Playwright **e2e suite** and the **LCP measurement** require a provisioned environment (a seedable Postgres + Supabase-backed accounts). This autonomous run had no such environment (auth-gated app, no DB/preview, no browsers). They **collect** without error and are wired to run in CI/preview; they are **not** claimed as passed here.

### Measured LCP improvement vs the 30% bar

**Not measured in this run.** The LCP baseline (`docs/v1/perf/slate-lcp-baseline.json`) is a **documented placeholder** (`"measured": false`) because `/slate` is auth-gated and no database/preview was available locally. The harness, CI job, and the ≥30% gate logic are implemented and unit-tested; the gate is inert against a placeholder baseline by design (it refuses to compare, rather than manufacturing a green or a red). **The real pre-change baseline and the actual ≥30% comparison must be captured once in a provisioned CI/preview environment** (procedure in the runbook). This is the single DoD item that cannot be closed without that environment — flagged for human action.

---

## Review findings and dispositions (PR #92 review id 5173025238)

A multi-angle review ran against the feature diff. Authorization/credential/no-edge/prices-never-feed-projections invariants were checked and are **clean** (client fetches only Sightline's own routes; Prop Research never renders an edge; no modelling path reads prices; no credential reaches a client).

**Implemented (this run):**
1. **Advisory-lock defect (must-fix).** `withPriceRefreshLock` wrapped the multi-second `runMarketSync` in a Prisma interactive transaction at the default 5s timeout → on a real slate it would P2028-timeout (500 instead of the designed degraded-200) and release the lock mid-sync (duplicate Kalshi call), defeating the RD-2 guarantee. Fixed: raised the transaction timeout to span the sync; the route now degrades to last stored prices instead of 500.
2. **Partial-sync disclosure** restored (`pricePartial` DTO flag + banner).
3. **Best-opportunity tie-break** — client now matches the server's `edgePoints` tie-break (no flip on a no-op filter).
4. **Freshness** — degraded flag threaded into card freshness; no-price no longer mislabelled `updated_recently`.
5. **Reuse** — `activeModelByStat` deduped to the exported `modelSelectionMap` (prevents Slate/Research model drift).
6. **Accuracy summary** — fixed the self-contradictory "below the floor" message when the floor is met but no Brier exists.
7. **CI build unblock** — the perf job now guards its work steps on provisioning secrets (skips instead of failing the Build on empty Supabase env).

**Deferred (filed as tickets):**
- **SIG-100** — on-view freshness clock should track the last successful price observation, not the sync job's `finishedAt` (a degraded sync can otherwise advance the clock and suppress a recovery refresh).
- **SIG-101** — distinct "no contracts listed yet" empty state (vs "no schedule") + keyboard navigation for the grouped card layout (and removal of the orphaned `SlateKeyNav`).

**Not done (disclosed):** a test-quality nit (m3) — `screens.test.tsx` admin-nav test does not open the menu to assert Health/Users are reachable; `NavSections.test` covers the data-level `adminSections`. Left for a maintainer.

---

## Decisions made on the user's behalf (each with rationale)

Pre-resolved by the run instruction and treated as approved-doc authority (RD-1…RD-6): threshold semantics `P(≥)`+`P(<)`=100%; automatic refresh reuses the existing scheduler with on-view lazy refresh + advisory lock; 30% LCP bar vs a 300-contract fixture; Prop Research availability by stored distribution + pre-kickoff; ranking unchanged; relocated routes get the server-side admin check. Resolved by me during the run:

- **RD-7 — scheduler reconciliation.** The "Pitch 7 scheduler" is actually **GitHub Actions cron** (`pipeline-prices.yml`) with server-side cadence gating (`src/lib/pipeline/cadence.ts`), not a TS-native scheduler. The ≈5-minute target is the **on-view freshness interval**, not the scheduler cadence; the existing GitHub Actions backstop is left at its cadence (avoids the pitch's "GitHub Actions as a price ticker" rabbit hole). Dedup upgraded to a Postgres advisory lock. Satisfies RD-2's intent without a second scheduler or client.
- **RD-8 — Prop Research is probability-only and never renders an edge.** When a typed threshold matches a listed contract with a fresh price, it links to that contract's detail rather than computing edge. Strictly satisfies "no edge without a price" and the required test; avoids a second edge path.
- **RD-9 — freshness vocabulary** mapped to existing stored signals (staleness + price age + material pending suggestion); price and projection freshness kept distinct.
- **RD-10 — perf harness timing:** baseline captured first (placeholder here), gate enforced last.
- **Advisory-lock timeout / degrade-not-500** (review-audit): raised the transaction timeout and made the route degrade — the correct-for-scale fix per CLAUDE.md's "don't over-engineer."
- **Deferring #4/#8/#3** to SIG-100/SIG-101 rather than bolting DTO/UX changes on late in the run — a triage call disclosed above.
- **Linear status:** the team has no "In Review" status (Backlog/Todo/In Progress/Done/Canceled/Duplicate); tickets were moved to **In Progress** with PR links attached — the honest equivalent.

---

## Required upstream document amendments (for a human to apply — NOT done in this run)

Per the pitch's own Open Questions and this run's instruction:

1. **PRD / Architecture:** general **Accuracy moves from a shared viewer surface to admin-only** (the Architecture Doc currently lists "model accuracy" among shared read surfaces at §Authorization; PRD likewise). Update both to reflect the permission change this pitch ships.
2. **Pitch Roadmap:** this pitch becomes **Pitch 10: Slate Experience & Prop Research**; **Parallel Model Shadow Evaluation → Pitch 11**; **Kalshi Live Trading → Pitch 12**. (Note: the current roadmap numbers Adjustment Suggestions as Pitch 10 and Live Trading as Pitch 11 — the human should reconcile the numbering when applying this.)
3. **PRD / Kalshi Market Sync UI:** **automatic price refresh becomes the normal behavior**; manual "Refresh Prices" is demoted to an admin recovery/debug action.

## Numeric defaults chosen this run — flagged for explicit human review

None of these were specified upstream:
- **300-contract** performance fixture size.
- **30%** LCP improvement bar.
- **~30-second** on-view freshness interval / advisory-lock coalescing window (lock transaction timeout set to 120s to span a worst-case sync).

---

## Stop conditions

None triggered. The Kalshi integration boundary held (no second client, no credential relocation, no client→Kalshi call — the on-view refresh calls only Sightline's own route). Prop Research never implies economic edge without a price. Hidden navigation is backed by server-side `requireAdmin()` on every relocated route. Nothing touched money, autonomy, or temporal leakage. The feature-branch force-push was of this run's own branch, not `main` or a shared branch.

## What a human needs to do next

1. Review PR #92 (permission-surface change is the focus).
2. Provision the CI perf/e2e environment (Supabase test project + seeded accounts + the E2E_* / E2E_SUPABASE_* secrets) and capture the **real LCP baseline**, then confirm the ≥30% gate — the one DoD item this run could not measure.
3. Apply the three upstream doc amendments above.
4. Optionally reconcile the inconsistent ticket-PR merge states (#93–#101).
5. Merge PR #92 into `main` when satisfied.
