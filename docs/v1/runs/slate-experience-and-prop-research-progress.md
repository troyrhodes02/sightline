# Run Progress — Slate Experience & Prop Research

**Slug:** `slate-experience-and-prop-research`
**Linear project:** Sightline V1 (`ee9590bc-2cf0-4ca1-9e19-9a7d9c26b084`)
**Pitch doc:** `c1892ecb-4731-4d97-ac66-61c197897e51` (Linear)
**Mode:** Autonomous Pipeline Policy. Ends with feature branch verified, reviewed, audited, green, PR open. **DOES NOT MERGE into `main`.**

## Current step

Steps 5-6 — Milestone + Linear issues (in progress). Steps 1-4 complete (pitch, design doc, UI preview, spec all written to docs/v1/).

## Pipeline steps

1. [x] Pull pitch → `docs/v1/pitches/slate-experience-and-prop-research.md`
2. [ ] Design doc → `docs/v1/design-docs/slate-experience-and-prop-research-design-doc.md`
3. [ ] UI preview → `docs/v1/ui/slate-experience-and-prop-research-ui-preview.html`
4. [ ] Spec → `docs/v1/specs/slate-experience-and-prop-research-spec.md`
5. [ ] Resolve remaining open questions (record as Resolved Decisions)
6. [ ] Milestone + Linear issues chained blockedBy; capture identifiers here
7. [ ] Open feature PR into main
8. [ ] Work every ticket in order (ticket-worker)
9. [ ] Runbook → `docs/v1/runbooks/slate-experience-and-prop-research-runbook.md`
10. [ ] Squash-merge ticket PRs into feature branch in order
11. [ ] Full verification suite green (+ pitch-specific tests)
12. [ ] /review feature branch vs main → inline comments on feature PR
13. [ ] /sightline-review-audit comments; implement/defer/discuss/skip
14. [ ] Commit, push, re-run full suite. STOP (no merge to main)
15. [ ] Run report → `docs/v1/runs/slate-experience-and-prop-research-report.md`

## Tickets (Milestone: Pitch 10 — Slate Experience & Prop Research, id 50c5ce2e-6f21-45cd-9ed7-17e92ef27631)

Build order = 91 → 92 → 93 → 94 → 95 → 96 → 97 → 98 → 99 (respects blockedBy chain).

| # | ID | Title | blockedBy | Branch | Ticket PR | Done? |
|---|-----|-------|-----------|--------|-----------|-------|
| T1 | SIG-91 | Perf harness: 300-contract fixture, Lighthouse LCP runner, baseline, report-only CI | — | | | ☐ |
| T2 | SIG-92 | Admin IA: Accuracy+model-comparison behind admin, nav reorg, drop Suggestions from primary nav | SIG-91 | | | ☐ |
| T3 | SIG-93 | Accuracy plain-language summary above retained advanced panels | SIG-92 | | | ☐ |
| T4 | SIG-94 | Automatic price refresh: on-view/return + pg advisory lock, demote manual to admin | SIG-92 | | | ☐ |
| T5 | SIG-95 | Grouped Slate read shape (games→players→props DTO, best-first, freshness vocab) | SIG-91 | | | ☐ |
| T6 | SIG-96 | Slate presentation: game groups, player cards, progressive disclosure, inline suggestions, responsive | SIG-95, SIG-94 | | | ☐ |
| T7 | SIG-97 | Slate search & combinable filters + reset + empty states | SIG-96 | | | ☐ |
| T8 | SIG-98 | Prop Research: /research route, read surface, probability-only, no-projection/no-edge states | SIG-95 | | | ☐ |
| T9 | SIG-99 | Enable LCP gate: enforce ≥30% improvement, record measured number | SIG-96, SIG-97, SIG-98 | | | ☐ |

Feature branch: (created in step 7) — `feat/slate-experience-and-prop-research`
Feature PR: (created in step 7)

## Resolved Decisions

### Pre-resolved by the run instruction (treat as approved doc authority)

- **RD-1 Threshold semantics:** "above/clearing" reports `P(stat ≥ threshold)`; "below" reports `P(stat < threshold)`. Complementary, sum to exactly 100%. No third bucket, no separate "exactly N" mass. For continuous stats via quantile-grid interpolation `≥`/`>` are numerically identical (zero point mass); only discrete stats + whole-number thresholds have visible teeth.
- **RD-2 Automatic price refresh reuses Pitch 7's scheduler.** No second scheduling path, no second Kalshi client. Primary mechanism = on-view lazy refresh (opening/returning to Slate checks freshness, triggers server-side refresh if stale). Scheduler is the backstop. Duplicate-refresh prevention = short-lived advisory lock (30s TTL) keyed by affected market set; concurrent staleness check that finds a held lock skips and reads whatever price lands.
- **RD-3 Performance bar:** seed 300-contract slate fixture; measure LCP via automated Lighthouse; baseline captured on pre-change commit, feature branch must show ≥30% LCP reduction against same fixture under same conditions. CI check, not one-time manual.
- **RD-4 Prop Research availability:** available for a player/stat/game combo whenever a current stored distribution exists, regardless of Kalshi listing. Only boundary = game must not have reached actual kickoff (reuse Adjustment Suggestions kickoff-instant concept, NOT the staking 10-min trading cutoff).
- **RD-5 Recommendation ranking unchanged.** Best-opportunities-first continues to use existing confidence-adjusted edge ranking from Kalshi Sync pitch, unmodified. No ranking tweaks.
- **RD-6 Relocated Accuracy routes get same server-side admin check** as existing admin routes; extend cross-role isolation test suite with a case for every relocated route (viewer deep-link rejected server-side).

### Document-synchronization items (record in report; do NOT apply during run)

- PRD/Architecture: general Accuracy moves from shared viewer surface to admin-only.
- Pitch Roadmap: this becomes Pitch 10; Parallel Model Shadow Evaluation → Pitch 11; Kalshi Live Trading → Pitch 12.
- PRD: automatic price refresh becomes normal behavior; manual Refresh Prices demoted to admin recovery action.

### Numeric defaults chosen this run (flag for human review in report)

- 300-contract performance fixture size.
- 30% LCP improvement bar.
- 30-second refresh advisory-lock TTL.

## Stop conditions specific to this pitch

- SC2 (invariant breach) applies to the Kalshi integration boundary: no second Kalshi client, no client-side polling loop hitting Kalshi, no credential relocation. Reuse RD-2 path.
- Prop Research must never imply economic edge without a real market price.
- Hidden navigation is not authorization — every relocated admin surface needs a server-side check.

## Key codebase findings (for design doc / spec)

### Scheduler reality vs RD-2 framing — RESOLVED (RD-7)
The "Pitch 7 scheduler" is **GitHub Actions cron**, not a TypeScript-native scheduler:
- `.github/workflows/pipeline-prices.yml` — POSTs `/api/pipeline/price-refresh` every **15 min** (from Pitch 5).
- `.github/workflows/pipeline-autonomy.yml` — paper-cycle every 10 min, settlement hourly (Pitch 7).
- Server-side cadence gating lives in `src/lib/pipeline/cadence.ts` (`decidePriceRefreshAction`) and `src/lib/paper/cadence.ts`. Constants in `src/lib/health/config.ts`: `PRICE_IN_WEEK_CADENCE_MINUTES=60`, `PRICE_GAMEDAY_CADENCE_MINUTES=15`, `GAMEDAY_PRICE_WINDOW_HOURS=6`, `SEASON_LOOKAHEAD_DAYS=7`.
- Pipeline routes auth = bearer token `PIPELINE_SCHEDULER_TOKEN` (`src/lib/pipeline/auth.ts`, `verifyPipelineToken`, timing-safe).
- Kalshi client: `src/lib/kalshi/client.ts` (`"server-only"`, market-data GETs only, RSA-PSS signing). Sync entry: `runMarketSync()` in `src/lib/kalshi/sync.ts` with in-process `inFlight` gate + DB min-interval coalescing (`KALSHI_SYNC_MIN_INTERVAL_SECONDS`).
- Manual refresh route: `src/app/api/prices/refresh/route.ts` (POST, requireSession — currently shared, calls `runMarketSync()`).
- `PriceObservation` model stores both sides + `observedAt`; batch `createMany`.

**RD-7 reconciliation:** The ≈5-minute target is the **on-view freshness interval**, not the scheduler cadence. Primary path = on-view lazy refresh (Slate open/return checks stored-price age vs freshness interval → server-side `runMarketSync()`), honoring RD-2's "a page nobody is looking at doesn't need Kalshi hit every five minutes." The existing GitHub Actions `pipeline-prices.yml` stays as the backstop at its current cadence — NOT cranked to 5 min (avoids the pitch's "GitHub Actions as a price ticker" rabbit hole and CLAUDE.md's warning). No second scheduler, no second Kalshi client, no credential relocation. Dedup upgraded from in-process gate to a **Postgres advisory lock (`pg_try_advisory_lock`, 30s TTL semantics) keyed by the affected market set**, because serverless runs multiple instances and the in-process gate can't dedup across them. Manual refresh demoted to admin recovery. This fully satisfies RD-2 intent; the "TypeScript-side scheduler" phrasing maps to the server-side cadence-decision logic we reuse. Not a stop condition.

### Additional codebase findings

- **Slate:** `src/app/(app)/slate/page.tsx` → `readSlate(role)` → `SlateDto{rows,unresolved}`. Flat ranked list; `compareSlateRows`/`computeEdge` in `src/lib/slate/edge.ts` (confidence weights high 1.0/med 0.7/low 0.4). Admin fields absent (not null) in viewer payloads. `src/lib/dto/slate.ts` DTOs. Contract detail `[contractId]/page.tsx` → `readContractDetail` → `ContractDetailDto` (quantiles/pmf, drivers, outcomeBlock, midCents).
- **Prop Research reuse:** `probAtLeast(distribution, threshold)` in `src/lib/slate/probability.ts` — ZIL closed-form, NB pmf-sum, empirical quantiles interpolation, empirical pmf. `P(<t) = 1 - probAtLeast` (RD-1 holds exactly; NB below=sum pmf[0..ceil(t)-1]). Golden parity fixture `src/lib/slate/__fixtures__/probability-golden.json`.
- **Projection model:** distributionKind, params, quantiles, pmf, projectedValue/Median, intervalLow/High, confidence, nEff, computedAt, informationCutoff, provenance(base|adjustment_shadow), drivers. `ProjectionDecline` + `ProjectionDeclineReason.insufficient_evidence` = honest "no projection" state. `Game.kickoffAt` = kickoff boundary. StatType enum: passing_yards, rushing_yards, receiving_yards, receptions, rushing_tds, receiving_tds.
- **Existing client refresh:** `src/components/slate/SlatePoller.tsx` already polls `/api/prices/refresh` on interval (paused when tab hidden) — the sanctioned client→Sightline fetch (RD-12), NOT client→Kalshi. Server route calls `runMarketSync()`. So automatic refresh largely already exists; pitch work = freshness-gated on-view/return check + pg advisory lock + demote manual button to admin.
- **Accuracy/nav:** `src/components/shell/NavSections.ts` (`SECTIONS`, `visibleSections`). `requireAdmin()`/`requireSession()` in `src/lib/auth/session.ts`; denial via `forbidden()` (in-place 403). Accuracy currently shared (`requireSession`); `/accuracy/overrides` admin-only. Suggestions already admin-only. Role tests: `NavSections.test.ts`, `session-structure.test.ts`, `e2e/authenticated.spec.ts`.
- **Suggestions:** `AdjustmentSuggestion` model, `acceptSuggestion`/`declineSuggestion` (`src/lib/suggestions/actions.ts`, admin-only routes `/api/suggestions/[id]/accept|decline`), `acceptedShadowProjectionIds`/`blockedSuggestionKeys` (`src/lib/suggestions/active-projection.ts`). Slate read already resolves accepted shadow as active projection. Materiality config `src/lib/suggestions/config.ts`.

### More Resolved Decisions (this run)

- **RD-8 Prop Research is probability-only; never renders an edge number.** When the entered threshold exactly matches a currently-listed Kalshi contract with a fresh price, Prop Research offers a link to that contract's detail (where edge already lives). Rationale: strictly satisfies "no edge without price" and the required test, avoids a second edge computation path, keeps the honesty invariant maximally safe. Model-favored side (which of above/below is >50%) may be indicated; no profitability language.
- **RD-9 Freshness vocabulary mapping.** Simple states map to existing stored signals: **Current** = fresh projection, price within on-view interval; **Updated recently** = price refreshed within interval, projection not stale; **New information pending** = a material pending AdjustmentSuggestion exists OR projection `predatesInactives`; **Stale** = `isStale` (fact ingested after projection cutoff) or projection predates inactives past the boundary; **Unavailable** = no projection / Kalshi degraded. Detail view retains raw timestamps; nothing removes `computedAt`/`informationCutoff`. Price freshness and projection freshness stay distinct.
- **RD-10 Performance harness timing.** First ticket adds the 300-contract seed fixture, the Lighthouse LCP runner, captures the pre-redesign baseline LCP (committed as a baseline artifact), and adds a CI job in report-only mode. The final ticket flips the CI job to enforce ≥30% reduction against the committed baseline + records the measured number for the report. Reason: baseline must reflect the pre-change Slate, which only exists cleanly at the start of the branch chain.

## Ticket plan (PR-sized chunks, build order)

1. **T1 Performance harness + baseline** — 300-contract seed fixture, Lighthouse LCP runner script, capture+commit pre-redesign baseline, CI job (report-only).
2. **T2 Admin IA + Accuracy/Suggestions relocation** — move Accuracy (+ model comparison) behind `requireAdmin`; nav reorg into admin area; remove Suggestions from primary nav; update `NavSections`, role/e2e tests incl. deep-link rejection for every relocated route. **(permission-surface change — the human-review focus)**
3. **T3 Accuracy plain-language summary** — summary-first layer (model-quality state, sample sufficiency, calibration status, Brier interpretation, baseline/market comparison in plain language) with advanced analysis retained underneath.
4. **T4 Automatic price refresh** — freshness-gated on-view/return refresh, pg advisory lock (30s TTL) keyed by market set, demote manual refresh to admin diagnostic, freshness-interval constant, backstop scheduler unchanged. Dup-refresh-lock test.
5. **T5 Slate grouped data shape** — games→players→props grouped `SlateDto`, best-opportunities-first preserved (RD-5), threshold/stat selection support, freshness vocabulary (RD-9).
6. **T6 Slate presentation** — game grouping, player cards, progressive disclosure into detail, inline accepted-adjustment context + admin inline pending accept/decline, simplified freshness, responsive phone-first.
7. **T7 Slate search + filters** — player search + game/team/date/stat-type/recommendation/confidence filters, combinable, reset, empty states.
8. **T8 Prop Research** — route + read path (reuse `probAtLeast`), player search reuse, threshold entry, above/below (RD-1), no-projection state, no-edge invariant (RD-8), viewer-accessible, kickoff boundary (RD-4).
9. **T9 Enable LCP gate + final perf comparison** — flip CI gate to enforce ≥30%, record measured improvement.

## Deferred / notes

(none yet)
