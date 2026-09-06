# Run Report — Outcome Scoring & Accuracy Surface

Slug: `outcome-scoring-and-accuracy-surface`
Linear project: Sightline V1 · Milestone: Outcome Scoring & Accuracy Surface
Merged to `main` as `4a89893` (squash of PR [#50](https://github.com/troyrhodes02/sightline/pull/50)).

**Status: complete.** No stop condition was hit.

---

## What shipped

Sightline can now grade what it predicted against what actually happened, and
show the record. Before this pitch the product could state a probability and
compute an edge; it had no way to say whether either had ever been right.

The two outcome truths stay separate by design, per the pre-resolved decision
that opened the run: the official corrected stat line grades the model, and
Kalshi's settlement grades everything contract-facing. They can disagree, and
when they do the disagreement is displayed rather than reconciled away.

| Ticket | Title | Status | PR |
| --- | --- | --- | --- |
| SIG-51 | Outcome schema & Kalshi settlement ingest | Done | [#51](https://github.com/troyrhodes02/sightline/pull/51) |
| SIG-52 | Python grading job: projection & threshold grades | Done | [#52](https://github.com/troyrhodes02/sightline/pull/52) |
| SIG-53 | Accuracy surface: shared calibration, error & market panels | Done | [#53](https://github.com/troyrhodes02/sightline/pull/53) |
| SIG-54 | Overrides surface & contract detail outcome block | Done | [#54](https://github.com/troyrhodes02/sightline/pull/54) |
| SIG-55 | Grading health signals, freshness & e2e closure | Done | [#55](https://github.com/troyrhodes02/sightline/pull/55) |

Ticket PRs were stacked onto the feature branch and squash-merged in order at
step 10; the feature branch then squash-merged into `main`.

Also carried: a runbook at `docs/v1/runbooks/outcome-scoring-and-grading.md`,
and a Prisma configuration fix described under **Out-of-band fixes** below.

---

## Decisions made on the user's behalf

Eleven decisions arrived pre-resolved with the run instruction and were treated
as approved-doc authority; seven more (12–18) were settled during the design
doc and restated in the spec. All eighteen are recorded in full in
`outcome-scoring-and-accuracy-surface-progress.md`, and the per-ticket
implementation decisions are recorded there too. The ones with consequences
beyond this pitch:

**Model calibration is visible to viewers.** The Architecture Doc and the PRD
disagreed; the Architecture Doc won. Positions, the decision log, override
performance, timing cost, and ledgers stay admin-only. **This means the PRD
needs amending** — see *Requires a human decision* below.

**Calibration always reports two denominators.** Threshold observations and
distinct projections, side by side, with no statistical correction for the
correlation between thresholds drawn from the same projection. The correlation
is disclosed rather than corrected, because a correction would be a modelling
claim inside a surface whose job is to report.

**The graded recommendation unit is the `final_pre_kickoff` snapshot.** Where
no final snapshot exists, the recommendation outcome is explicitly unavailable
(`missing_final_snapshot`) rather than graded against a substitute. This was
the hidden dependency flagged at the start of the run: the snapshot is owned by
Live Pipeline & Staleness and merely graded here. It was verified to exist and
be wired (`src/lib/pipeline/final-snapshot.ts`, 45-minute window, partial
unique index enforcing one per contract) before any work depended on it.

**Timing cost is signed, in probability points, and never zero-filled.**
Positive means acting early cost you. A missing snapshot reads unavailable; a
skip is not-applicable, which is a different thing again. Skips sit outside the
timing denominator entirely, because a skip has no acted-on moment to cost.

**Backtest and live records are never combined.** Both are labelled, comparison
is permitted, a single merged curve or score is not.

**Ten fixed-width calibration buckets**, matching the stored backtest
`binIndex` 0–9 so overlays are like-for-like. Adaptive and quantile binning
were rejected for that reason.

**Insufficient-data thresholds:** calibration buckets below the established
1,000-observation floor render provisional and are excluded from summaries;
market comparison needs at least 30 graded observations for a headline; override
performance has no suppression floor at all, since it is the admin's own record
and n is always shown.

**Time period means NFL season**, plus "all seasons". No rolling windows, no
calendar years, no custom ranges. Postseason weeks belong to their season.

---

## Review findings and dispositions

A high-effort review of the feature branch against `main` produced six
findings, posted as inline comments on #50 and audited against each ticket's
acceptance criteria before any of them were acted on.

### Fixed before merge (`f6e8ab5`)

**1 · Settlement ingest re-selected unresolvable contracts forever**
(`src/lib/pipeline/outcome-ingest.ts`). The awaiting-settlement branch had no
lower time bound, while both unavailable paths — Kalshi not returning a ticker,
and an unmappable `result` string — deliberately write no `Outcome` row. A
contract Kalshi never reports therefore kept `outcome: null` permanently and
was re-selected on every cycle, an accumulating set that never shrinks.

That defeated this pitch's own dormancy design twice over: `runOutcomeIngest`
could never return `not_expected` again, so a `PipelineRun` row plus a Kalshi
call happened hourly year-round; and SIG-55's health surface derives
`outcome_ingest` expectedness from this same selection, with `offseason`
requiring every signal to be `not_expected` — so that state became permanently
unreachable. Fixed with a `SETTLEMENT_ABANDON_AFTER_DAYS = 30` floor on both
arms, measured from the game's own kickoff or the contract's close time. The
contracts are retained, never deleted; they simply stop being polled.

**2 · Regrades never deleted superseded threshold rows**
(`python/src/sightline_ingest/grade_job.py`). `_write_intent` upserted the
threshold rows an intent claims and never deleted the ones it stopped claiming,
and there was no `DELETE` anywhere in the module. Every non-graded status
carries an empty threshold tuple, so a unit moving out of `graded` — a stat
correction nulling the stat column, a game reclassified cancelled — kept its
old rows with a stale `outcome` and a stale `graded_stat_version`. Those
observations keep feeding the live reliability curve and Brier score, which is
the number this product exists to be trusted on. It contradicted both
CLAUDE.md's stat-correction rule and the module's own docstring.

Fixed with a scoped delete inside the caller's per-game transaction, so a
regrade is never visible half-applied. The gap was broader than the correction
case: a policy-version change or a delisted market threshold orphaned rows the
same way. Both new pytest cases were verified to fail without the fix — twelve
stale rows survive, including `market`-source rows carrying a `contract_id`,
which are precisely the observations behind the market comparison panel.

### Deferred, with reasons

**3 · Terminal grade statuses are never reselected** → **SIG-56**. Valid, but
SIG-52's acceptance criteria call `game_never_completed` terminal explicitly, so
reversing it is a spec change. The practical impact is also narrower than it
reads: `GameStatus` carries `postponed` as its own value, so the ordinary
reschedule path already works and only a literal `cancelled → completed`
transition is affected.

**4 · `decisionCount` and the overrides table count different things** →
**SIG-57**. Valid but latent. SIG-53's Resolved Decision defines the field as a
doorway count rather than a metric, and divergence requires a second
decision-writing account — friend pick sharing, which the roadmap defers.

**5 · React key collision on overrides rows** → **SIG-57**, same ticket. Same
latent condition; a real fix needs a DTO change to carry the user id.

**6 · Five files committed with CRLF** → **SIG-58**. Real, and mostly
pre-existing: three of the four source files were already CRLF on `main`, and
this pitch flipped exactly one, `python/tests/test_import_graph.py`. That one
matters more than the others because it is the guard enforcing "prices never
feed projections", so its content was reviewed under `--ignore-cr-at-eol` and
verified sound before merge — the settlement tokens are correctly SQL-shaped
(`from|join|into|update outcomes`, bare and quoted), avoiding the
false positives a bare `outcome` match would hit on `RunOutcome` and the
threshold `outcome` fields, and a planted-reference self-test was added.

The durable fix is repo-wide and would have buried the feature diff; a
single-file fix is not durable without `.gitattributes`, since the next tool to
write it flips it straight back.

---

## Out-of-band fixes

**Prisma 7 config datasource** (`691ea3c`). Found while running the suite, not
part of any ticket, and fixed on the branch because it silently breaks every
migration in the repo.

Prisma 7's `defineConfig` datasource block accepts `url` and
`shadowDatabaseUrl` only — `directUrl` was Prisma 6's *schema*-level field, and
an unrecognised key here is dropped without warning. The configuration was
therefore pointing Migrate's `url` at the transaction pooler, where Migrate's
session-scoped advisory lock can never resolve: `prisma migrate` hangs
indefinitely with no error message.

The datasource has exactly one consumer, the CLI; the application client builds
its own pooled connection from `DATABASE_URL` in `src/lib/prisma.ts`. Pointing
it at `DIRECT_URL` restores the documented split — CLI and Python direct, app
traffic pooled — rather than changing it. `tsconfig.json` gained
`prisma.config.ts` in `include`, since the file sat outside the project graph,
which is why the unknown key never surfaced as a type error in the first place.

---

## Deferred

Four follow-up tickets, all in Sightline V1, all Backlog:

- **SIG-56** — Regrade units stranded in terminal grade statuses.
- **SIG-57** — Overrides surface assumes a single decision-writer (findings 4
  and 5 together; pick up alongside whatever pitch introduces a second
  decision-writer).
- **SIG-58** — Add `.gitattributes` and renormalise line endings repo-wide.
- **SIG-59** — `verifyPipelineToken`'s unset-token test depends on the
  developer's `.env`. Pre-existing, shipped with SIG-49; see below.

Nothing was deferred as a bare code comment.

---

## Requires a human decision

**The PRD needs amending to record that model calibration is viewer-visible.**
The run resolved the Architecture Doc / PRD conflict in the Architecture Doc's
favour and built accordingly, but the PRD still says otherwise. This is a
documentation correction, not a behaviour change.

For completeness, two amendments already noted in CLAUDE.md remain outstanding
and were not touched by this run: `Invitation` is still named in the
Architecture Doc and PRD after the access model changed to request-and-approve,
and `architecture.md` → Tech Stack still does not name a charting library
despite Recharts being in use.

Three inherited open questions were noted as non-blocking in spec §16 and
remain open: edge against ask versus midpoint, and the two others recorded
there.

---

## Verification results

Every check below was run and its actual outcome recorded. Nothing was skipped,
disabled, or marked as an expected failure.

### Final local run, on the merged tree

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | pass |
| Types | `npm run typecheck` | pass |
| Format | `npm run format` | pass |
| Prisma schema | `npm run prisma:validate` | pass |
| Schema invariants | `npm run test:schema` | 20/20, 0 failed |
| Unit / integration | `npx jest` | **477/477** (474 before, +3) |
| Build | `npm run build` | pass |
| Python | `uv run pytest -q` | **360/360** (358 before, +2), `db`-marked included |

Python `db`-marked tests ran against the local `sightline-db` container on
:5433, which was already migrated with this pitch's tables. There is no Python
lint or format step in this repo — CI runs `uv run pytest -q` and nothing else
for that runtime.

### CI on the merged commit

All required checks green on PR #50 before merge: Prisma schema invariants,
Python ingest (unit + DB integration), Web app (lint, types, unit, build, e2e
— including the credentialed suites that skip locally), and the Vercel preview
deployment.

### One failure, diagnosed and not a regression

`src/lib/pipeline/auth.test.ts` → "reports an unset server token as
unconfigured, not unauthorized" failed on the first local run.

`verifyPipelineToken`'s second parameter defaults to
`serverEnv().PIPELINE_SCHEDULER_TOKEN`, and JavaScript applies a default
parameter when the argument is explicitly `undefined` — so the test's
`undefined` reads the developer's real `.env` token instead of exercising the
unset case. Verified green 5/5 with the key absent, and `git diff
origin/main...HEAD` on both `auth.ts` and `auth.test.ts` is empty, so the file
came in with SIG-49 in the previous pitch and fails on `main` too. It passes in
CI only because CI has no `.env`.

Out of this pitch's scope; filed as **SIG-59**.

---

## Notes for the next run

- The `sightline-db` container on :5433 is the local Python test database
  (`TEST_DATABASE_URL`). It is long-lived and was simply stopped — start it,
  do not compose a duplicate.
- Ticket branches for this pitch remain on the remote. The feature branch
  `pitch/outcome-scoring-and-accuracy-surface` was not deleted on merge.
- With grading and a stored accuracy record now in place, the gate on the
  Kalshi Trading pitch — "cannot be enabled before a stored `BacktestRun`
  demonstrating accuracy exists" — has its measurement surface, though the
  gate itself is unchanged and still enforced there.
