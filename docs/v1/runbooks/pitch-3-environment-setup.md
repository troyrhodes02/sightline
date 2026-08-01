# Pitch 3 — environment setup

Everything outside the codebase that has to exist before App Shell, Brand &
Access works. In order; later sections depend on earlier ones.

One thing in here is a **blocker**, not a chore:

- **§2** — the first admin cannot be created through the product. Sign-up
  produces a *pending* account, and only an admin can approve one, so the first
  account is seeded out of band.

Everything else is ordinary provisioning.

---

## 0. Prisma generation on deploy — already fixed

`generated/` is gitignored, so a fresh checkout has no Prisma client and the
build would fail on the first `@/lib/prisma` import. `package.json` now carries
both:

```json
"postinstall": "prisma generate",
"build": "prisma generate && next build"
```

`postinstall` covers local installs and most CI; the explicit `build` prefix
covers platforms that skip lifecycle scripts or restore a cached
`node_modules`. Generating twice costs ~200ms and is cheaper than a red deploy.

Verify: `rm -rf generated && npm run build` succeeds.

---

## 1. Supabase — two projects

Sightline uses two: **production** and **development**. Vercel Preview points at
development, per the Architecture Doc, which is what gives a review environment
without operating a third tier.

### 1.1 Create the projects

Supabase Dashboard → **New project**, once per environment. Name them so they
cannot be confused at a glance — `sightline-prod` and `sightline-dev`. Record
the database password when it is shown; it is not retrievable later.

Choose a region near you. Three users; latency is not a design constraint here.

### 1.2 Configure auth — the part that actually matters

Apply to **both** projects. Full detail and the verification probe are in
`supabase-auth-configuration.md`; this is the short form.

| Setting | Value |
| ------- | ----- |
| Authentication → Sign In / Providers → **Allow new users to sign up** | **Off** |
| Email provider | Enabled |
| Google, GitHub, Apple, phone, anonymous, magic link | **Off** |
| Emails → **Confirm email** | **Off** — admin approval is the gate, not an email round-trip |
| Sessions → **Refresh token rotation** | **On** |
| Sessions → **Time-box user sessions** | Leave unset |

**Sightline has a sign-up page, and this setting still stays off.** The
application creates accounts with the service-role client, which works either
way, and forces `status = pending`. Supabase's own endpoint would create an auth
user with **no `users` row and no status**, bypassing approval entirely.

Verify it rather than trusting the toggle:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<project-ref>.supabase.co/auth/v1/signup" \
  -H "apikey: <anon-key>" \
  -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"probe-password-12345"}'
```

Expect `422`. **Anything `2xx` means an account can be created that skips the
approval gate**, whatever the interface shows. Run it against both projects.

### 1.3 Collect the values

Dashboard → Settings → **API**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY`

Dashboard → **Connect** → ORMs → Prisma (or Settings → Database):

- **Transaction pooler**, port `6543` → `DATABASE_URL`. Append `?pgbouncer=true`.
- **Direct connection**, port `5432` → `DIRECT_URL`.

The two are not interchangeable. Application traffic goes through the pooler;
migrations and the Python runtime use the direct connection. Swapping them
exhausts Postgres connections under serverless invocation — a failure that only
appears under load.

**The `service_role` key bypasses every Supabase-side check.** Its blast radius
is the whole auth schema. It goes in server-side environment configuration and
nowhere else — never in a `NEXT_PUBLIC_` variable, never in a client bundle,
never in a log.

### 1.4 Apply migrations

Against each project, from your machine:

```bash
DATABASE_URL="<pooler-url>" DIRECT_URL="<direct-url>" npx prisma migrate deploy
```

`migrate deploy`, not `migrate dev` — the latter can reset a database, which on
production is unrecoverable.

Confirm the access tables landed:

```bash
DATABASE_URL="<pooler-url>" DIRECT_URL="<direct-url>" npx prisma migrate status
```

---

## 2. Seed the first admin (blocker)

**There is no path to the first admin through the product**, and this is
structural rather than an oversight: sign-up creates a `pending` account, and
only an admin can approve one. So the first account is seeded out of band, once
per project.

`prisma/seed.ts` does both halves — the Supabase auth user and the matching
`users` row — and is **idempotent**, so it doubles as an "unlock myself" tool if
the account is ever locked out.

```bash
DATABASE_URL="<pooler-url>" \
DIRECT_URL="<direct-url>" \
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run db:seed
```

Defaults to `troy@sightline.app`. Override with `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, and `SEED_ADMIN_NAME`.

**Change the password from the default before seeding production.** The default
is a development convenience and is committed to the repository.

### Confirm it

Sign in at the deployed URL. You should land on `/slate` with **Slate, Health,
Users** in the navigation.

| Symptom | Cause |
| ------- | ----- |
| Only Slate in the nav | the row's `role` is not `admin` |
| Bounced to sign-in, no message | no `users` row for that auth user — the id did not match |
| Bounced with *awaiting approval* | the row exists but `status` is `pending` |

Re-running the seed repairs all three.

---

## 3. Email — not required

**Sightline sends no email.** The invitation system was removed along with its
Resend dependency. Approval happens inside the product, and a person learns
their request was approved by signing in.

Nothing to provision here. Stated explicitly because an earlier version of this
runbook required a mail provider, and because "how does someone find out they
were approved" is a fair question with a deliberate answer: they try to sign in,
and either they are in or they are told they are still waiting.

---

## 4. Vercel

### 4.1 Create and link the project

Vercel → **Add New** → Project → import `troyrhodes02/sightline`. Framework
detection picks up Next.js; no build-setting changes are needed once §0 is done.

### 4.2 Environment variables

Set per environment. **Production points at the production Supabase project;
Preview and Development point at the development one.**

| Variable | Production | Preview | Development |
| -------- | ---------- | ------- | ----------- |
| `DATABASE_URL` | prod pooler, `?pgbouncer=true` | dev pooler | dev pooler |
| `DIRECT_URL` | prod direct | dev direct | dev direct |
| `NEXT_PUBLIC_SUPABASE_URL` | prod | dev | dev |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod | dev | dev |
| `SUPABASE_SERVICE_ROLE_KEY` | prod | dev | dev |
| `APP_URL` | `https://<your-domain>` | the preview URL | `http://localhost:3000` |

That is the whole list. No mail provider, no invitation lifetime, and no Kalshi
variables — those arrive with Pitch 11.

### 4.3 Domain

Vercel → Settings → Domains. Add the production domain and update `APP_URL` to
match. The Product Brief lists domain and trademark clearance for "Sightline" as
unverified — the brand assets ship on the assumption it is accepted
(Resolved Decisions #4), so if that changes, the mark and wordmark are the
rework.

---

## 5. GitHub

### 5.1 Repository secrets for the E2E suite

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Value |
| ------ | ----- |
| `E2E_ADMIN_EMAIL` | the seeded admin on the **development** project |
| `E2E_ADMIN_PASSWORD` | its password |
| `E2E_VIEWER_EMAIL` | an approved viewer on the development project |
| `E2E_VIEWER_PASSWORD` | its password |

**Until these exist, fourteen Playwright specs report as skipped, never as
passed.** They are the ones proving this milestone's central claims: a viewer
denied every admin route with the served markup asserted, revocation across two
live sessions while the access token is still valid, and credential-failure
timing parity. A green CI run without them has silently dropped its most
important assertions.

The viewer account is created the normal way once the admin exists: go to
`/sign-up` and request an account, then sign in as admin → `/users` →
**Approve**. Never point these at production.

### 5.2 Branch protection (recommended, not required)

Settings → Branches → protect `main`: require the `web`, `schema`, and `python`
CI jobs to pass before merge.

---

## 6. Local development

Your local Supabase stack is already running. To get its values at any time:

```bash
npx supabase status
```

Create `.env` in the repo root — gitignored, never committed:

```bash
# Local Supabase stack. `npx supabase status` prints all of these.
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54331"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<ANON_KEY from supabase status>"
SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY from supabase status>"
APP_URL="http://localhost:3000"

# No mail provider is needed: Sightline sends no email. Approval happens in
# the product, and people learn they were approved by signing in.
```

Then:

```bash
npm install
npx prisma migrate deploy     # already applied to the local stack
npx playwright install chromium
npm run dev
```

Seed a local admin with `npm run db:seed` (§2). Supabase Studio is at
`http://127.0.0.1:54333` if you want to inspect the result.

The local stack has no signup restriction unless you set it in
`supabase/config.toml`. That is acceptable locally and **is not** a substitute
for the hosted check in §1.2.

---

## 7. Verification — do these in order

Each one fails loudly if a prior step was skipped.

| # | Check | Pass condition |
| - | ----- | -------------- |
| 1 | `rm -rf generated && npm run build` | Build succeeds |
| 2 | Signup probe (§1.2) against **both** projects | `422` on both |
| 3 | `npx prisma migrate status` against both | No pending migrations |
| 4 | Sign in as the seeded admin | Lands on `/slate`; nav shows Slate, Health, Users |
| 5 | Visit `/health` | Three signals, all *Not yet implemented*, all timestamps `—` |
| 6 | `/sign-up` in a private window; request an account | Confirmation shown, and **no access granted** |
| 7 | Try to sign in as that account | Refused with *awaiting approval* |
| 8 | As admin, `/users` → **Approve**, then sign in as them | Lands on `/slate`; nav shows **Slate only** |
| 9 | As the viewer, open `/users` directly | 403, denial in place, URL unchanged |
| 10 | View source on that page | Contains no `/health` or `/users` string |
| 11 | As admin, revoke the viewer while their session is live | Their next request lands on `/sign-in?reason=revoked` |
| 12 | Set the four GitHub secrets, re-run CI | Playwright reports **0 skipped** |

Check 12 is the one that converts "correct by construction" into
"demonstrated". Until it passes, that distinction is worth keeping in mind.

---

## What you do not need

Named because each is a plausible assumption and each is wrong here:

- **No Redis or cache.** Rate limiting is in-memory by design; `CLAUDE.md` rules
  out a caching layer.
- **No queue or worker service.** Pitch 5's scheduled jobs are GitHub Actions
  cron entries.
- **No Supabase Storage.** There are no uploads and no user-facing files.
- **No Kalshi account or API key.** Pitch 11. No variable for one exists yet,
  and a build-invariant test asserts that.
- **No mail provider.** Sightline sends no email at all.
- **No monitoring or error-reporting service.** The health surface is the
  operational visibility this pitch ships.
- **No third Supabase project for Preview.** Preview shares development.
