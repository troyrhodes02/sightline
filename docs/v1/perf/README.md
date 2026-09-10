# Slate LCP performance gate

Pitch 10 (Slate Experience & Prop Research), RD-3 / RD-10. The Slate redesign
must produce a **measurably faster initial paint**: at least a **30% reduction**
in Largest Contentful Paint of `/slate` against a fixed 300-contract fixture,
versus the pre-change Slate.

- **SIG-91** built the harness: the 300-contract fixture (`npm run db:seed:slate:perf`),
  the pure gate math (`src/lib/perf/lcpCompare.ts`, unit-tested without a browser),
  the LCP runner (`e2e/perf-slate-lcp.spec.ts`, `npm run perf:slate-lcp`), and a
  **report-only** CI job. The committed baseline was an honest placeholder.
- **SIG-99** flipped the CI job to **enforcing**: `PERF_ENFORCE_LCP=1` and no
  `continue-on-error`, so a branch that does not clear the ≥30% bar is a red build.

## Files

| File | Role |
| --- | --- |
| `slate-lcp-baseline.json` | The committed **pre-change** baseline. `measured: false` means placeholder. |
| `slate-lcp-latest.json` | Written by each run: the branch's measured LCP and, when a real comparison ran, baseline→current, percent reduction, required bar, and pass/fail. Git-ignored. |
| `../../../src/lib/perf/lcpCompare.ts` | The gate math. `compareLcp` computes the reduction; `comparabilityReason` refuses to compare against a placeholder. |
| `../../../e2e/perf-slate-lcp.spec.ts` | The runner: signs in, loads the seeded `/slate`, reads the real LCP web-vital, compares, and (when enforcing) fails on a miss. |

## Where the number is measured — read this before assuming it is faked

`/slate` is auth-gated and the measurement needs a provisioned database seeded
with the 300-contract fixture plus real accounts to sign in with. Neither the
local dev environment used to write this code nor the default CI job (whose DB
URLs are placeholders) can produce a meaningful LCP. **The real measurement is
produced in the CI `perf-slate-lcp` job**, which stands up a Postgres service,
applies migrations, seeds the fixture, and signs in with the `E2E_ADMIN_*`
secrets. Without those secrets the runner reports **SKIPPED**, never passed.

Consequently, no LCP number was measured while writing SIG-91 or SIG-99, and
none was invented. `slate-lcp-baseline.json` remains `measured: false`.

## Making the gate live: capture the real pre-change baseline

The gate is honest but **inert** while the baseline is a placeholder —
`comparabilityReason` returns "not comparable" and the runner logs the reason
and passes, so enforcement can neither red nor green on a null baseline. To turn
the gate on for real, capture the baseline **once**, on the pre-change commit,
in the same provisioned environment the enforcing job uses:

1. Check out the pre-change commit — the last commit before the Slate redesign
   landed (the parent of the first redesign commit on this pitch's branch).
2. In an environment with the provisioned Postgres + Supabase accounts:
   ```
   npx prisma migrate deploy
   npm run db:seed:slate:perf
   E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run perf:slate-lcp
   ```
3. Take `lcpMs` from `slate-lcp-latest.json` and write it into
   `slate-lcp-baseline.json`: set `measured: true`, `lcpMs`, `commit` (the
   pre-change SHA), and `capturedAt`. Commit that file.

From then on every `perf-slate-lcp` run compares the branch's `/slate` LCP to
that committed baseline and **fails the build** unless it is ≥30% lower.

## What the gate must never do

- Do not lower the 30% bar (`REQUIRED_LCP_REDUCTION_PCT`) to make a branch pass.
- Do not restore `continue-on-error` or unset `PERF_ENFORCE_LCP` to dodge a red.
- Do not set `measured: true` with an invented `lcpMs`. A fabricated baseline is
  worse than a placeholder: it produces a confident, wrong verdict.
- Do not hide Slate data to shrink LCP. Progressive disclosure (charts and the
  distribution live in detail, the background price refresh does not block the
  stored-slate render) is legitimate; permanently withholding data is not.
