# Supabase Auth configuration (Pitch 3)

Part of the deliverable, not setup trivia. **Disabling a signup button in the
interface is not disabling signup** — a default Supabase project accepts direct
registrations against its own auth API, bypassing the application entirely. The
pitch names this as a rabbit hole; this runbook is how it is closed.

Apply to **both** the development and production projects, and keep them
documented separately so a development shortcut cannot weaken production.

## Required settings

| Setting | Value | Why |
| ------- | ----- | --- |
| Authentication → Sign In / Providers → **Allow new users to sign up** | **Off** | The only account-creation path is an admin invitation. With this on, anyone with the anon key — which ships in the browser bundle by design — can create an account. |
| Authentication → Providers → **Email** | Enabled | Email and password is the only method. |
| Authentication → Providers → all others (Google, GitHub, magic link, phone, anonymous) | **Off** | No social auth, no magic links. Their absence is a product commitment. |
| Authentication → Emails → **Confirm email** | **Off** | The invitation token is the proof of address ownership. A second confirmation adds a step without adding evidence. |
| Authentication → Sessions → **Refresh token rotation** | **On** | Resolved Decisions #6. |
| Authentication → Sessions → **Time-box user sessions** | Unset | Sessions persist across devices by design; revocation is enforced per-request in `requireSession`, not by shortening token life. |

## Verifying it, rather than trusting the toggle

Run against each project. A `200` here means public signup is live and the
application's invite-only claim is false regardless of what the interface shows.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.com","password":"probe-password-12345"}'
```

Expected: `422` (`signup_disabled`). Anything in the `2xx` range is a failure.

## Service-role key

Lives in server-side environment configuration only. Never sent to a client,
never logged, never in an error body. Exactly one module reads it —
`src/lib/supabase/admin.ts` — guarded by `server-only`, an ESLint restriction,
and a structural test that fails when a new importer appears.

If it is ever exposed, rotate it in the dashboard immediately: it bypasses every
Supabase-side check, so its blast radius is the whole auth schema.
