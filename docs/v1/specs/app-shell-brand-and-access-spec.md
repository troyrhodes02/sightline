---
version: 2.0.0
status: approved
author: Sightline
last_updated: 2026-07-31
pitch_reference: docs/v1/pitches/app-shell-brand-and-access.md
design_reference: docs/v1/design-docs/app-shell-brand-and-access-design-doc.md
ui_preview_reference: docs/v1/ui/app-shell-brand-and-access-ui-preview.html
prd_reference: docs/planning/sightline-prd.md
architecture_reference: docs/planning/sightline-architecture.md
linear_issue: [SIGHT-### — App Shell, Brand & Access]
---

# App Shell, Brand & Access (Authentication and Access Approval · Brand and Responsive Interface)

> **v2.0.0 — the access model changed from invite-only to request-and-approve
> on 2026-08-01.** Invitations, tokens, and mail delivery are removed. Anyone
> may request an account; a `User` row is created immediately with
> `status = pending` and grants nothing; the admin approves or denies it.
>
> This contradicts a Brief-level non-goal. The Product Brief and PRD still say
> access is invite-only and public signup does not exist, and **both should be
> amended**. Recorded so the divergence is deliberate rather than discovered.

## Summary

This pitch introduces the entire TypeScript runtime. Today the repository is Prisma plus Python; when this ships it is also a Next.js application with a comprehensive Material UI theme, an invite-only access model, and four authenticated routes — none of which display product data.

The core technical abstraction is that **authorization is a per-request database fact, not a token claim**. A Supabase access token proves who signed in and stays valid for its lifetime; it cannot express that access was approved this morning or revoked ninety seconds ago. So every protected surface resolves the session *and then reads `users.status` from Postgres* before rendering or mutating anything.

That single decision carries both halves of the access model. A `users` row exists from the moment someone signs up, so **the row's existence grants nothing — only its status does**, which is what makes a pending account genuinely powerless rather than merely undisplayed. It is also what makes "revocation takes effect immediately, including when a session was already active" true rather than aspirational, and it is why no authenticated route in this application may be statically rendered or cached.

The second abstraction is that **the theme is a compiled artefact with exactly one source**. Hex values exist in `src/theme/index.ts` and nowhere else in the codebase; every screen consumes tokens. This is enforceable — a lint rule fails the build on a raw colour outside that file — and enforcing it now is the whole reason this pitch precedes Pitch 4.

"Working" means five things, in priority order: (1) a viewer is rejected server-side on every admin route with no admin chrome rendered first, and cannot infer from any surface that admin surfaces exist; (2) revoking a user ends their access on their next request, on every device; (3) public account creation is impossible through the interface *and* through the Supabase project's own configuration; (4) every shipped surface renders correctly in light and dark at 320px with no horizontal scroll; and (5) the health surface reports honestly that no scheduled job exists yet, rather than inventing a timestamp.

---

## Problem

Sightline has a leakage-safe corpus and a backtested baseline model, and no way for a person to look at any of it. More precisely, the system cannot answer:

- **Who is allowed in?** There is no account, no session, and no role. Supabase Auth is provisioned but unconfigured, and a default project accepts public sign-ups directly against its own API — meaning the current state is worse than "no auth", it is "open auth nobody has looked at".
- **Where does a screen go?** There is no application, no route structure, no layout, and no navigation, so Pitch 4 has nowhere to put the slate.
- **What does a screen look like?** There is no theme. Building the slate now would produce stock Material UI, and the Architecture Doc names the theme as a deliverable precisely because stock MUI reads as stock MUI and retrofitting a visual identity across finished screens costs more than establishing one first.
- **Is the pipeline alive?** Pitch 5 introduces scheduled jobs whose defining failure mode is silence. The health surface must exist before the jobs do, so the jobs land into a place that already displays them.

This blocks Pitch 4 entirely: the roadmap sequences this pitch first so no user-facing surface is built outside the design system. It supports the PRD's **Invite and Onboarding** and **Viewer Slate Review** journeys, and it is the pitch that makes the PRD's statement that "Authentication and Invite blocks every user-facing surface" concrete.

---

## Scope and Non-Scope

### In Scope

- **Authentication and Access Approval** — public account requests, an admin approve/deny queue, persistent sessions across devices, admin and viewer roles, server-enforced authorization on every protected read and write, and immediate revocation.
- **Brand and Responsive Interface** — the Material UI theme as a named deliverable, self-hosted Space Grotesk, the brand asset pipeline, the responsive application shell with role-aware navigation, and the reusable interface-state primitives.
- **The Next.js application itself** — App Router project, directory structure, Prisma client wiring through the transaction pooler, Supabase SSR session handling, and the test harness (Jest + Playwright).
- **Four authenticated routes** — `/slate` (placeholder), `/settings`, `/health` (admin), `/users` (admin) — plus two public ones, `/sign-in` and `/sign-up`.
- **Every interface state named in the design doc**, with the invitation states replaced by the three account statuses — pending, denied, revoked — plus two sign-in failure modes, six health signal states, loading, load failure, access denied, not found, application error.

### Out of Scope

- **Every product-data surface.** No contract, projection, price, edge, recommendation, driver, distribution, decision, accuracy figure, or backtest run is read or displayed. `/slate` renders a placeholder state and issues no query.
- **Kalshi anything** — discovery, prices, resolution, orders, credentials. No Kalshi client, no signing key configuration, and no environment variable for one ships in this pitch (Pitch 4, Pitch 11).
- **Scheduled jobs, staleness, keepalive** (Pitch 5). This pitch builds the health *surface* and its not-yet-available states; it does not build, schedule, or read any job.
- **Grading, accuracy, calibration display** (Pitch 6).
- **Bankroll, sizing, paper trading, execution, breakers** (Pitches 7–8).
- **Password reset.** Not specified in any approved doc. The sign-in screen has no recovery link, and no reset route exists. See Resolved Decisions #1.
- **Editing a display name or email after acceptance**, and changing a role after acceptance.
- **Reinstating a denied or revoked account.** Both are terminal in this pitch. There is no un-deny and no un-revoke.
- **Row-level security policies.** Server-side checks are the primary and, in this pitch, only mechanism. See Resolved Decisions #4.

### Named creep temptations (explicitly excluded)

- Do **not** wire the health surface to the existing `ingest_runs` table. Rows exist there from Pitch 1's manual local backfill, and rendering one as "last successful ingest" would report a scheduled pipeline as healthy when no scheduled pipeline exists. See Core Concepts → Health signals.
- Do **not** add a navigation entry, route, or placeholder page for Accuracy, Backtests, or Decisions. `/slate` is the only route that exists ahead of its feature, and it exists because sign-in must land somewhere.
- Do **not** introduce an organization, workspace, team, tenant, or membership concept. Two roles, one shared dataset.
- Do **not** build a generic permission framework, a policy engine, or a role table. `UserRole` is a two-value enum.
- Do **not** put authorization in middleware. Middleware refreshes a cookie; it is not the boundary.
- Do **not** add a second styling system, a component library, or a design-system package.

---

## Core Concepts

| Concept | Description |
| ------- | ----------- |
| `User` | An account **or a request for one**. `id` **is** the Supabase `auth.users` UUID — no separate identifier, no mapping table. A row exists from the moment someone signs up. |
| `UserRole` | `admin` or `viewer`. Two values, closed set, database enum. Never client-supplied. |
| `UserStatus` | `pending`, `active`, `denied`, `revoked`. **The authorization gate**, read on every protected request. |
| Session | The Supabase access and refresh token pair in HTTP-only cookies. Proves identity. **Does not prove authorization.** |
| `SessionContext` | The result of `requireSession()` — the authenticated `User` row read fresh from Postgres. This, not the token, is what every guard evaluates. |
| Access decision | An admin moving a row from `pending` to `active` or `denied`, or from `active` to `revoked`. Recorded with `decidedAt` and `decidedById`. |
| Health signal | One of three named scheduled processes — `ingest`, `recompute`, `price_refresh` — each with a state and a nullable last-success timestamp. In this pitch all three are `not_yet_implemented`. |
| `HealthSignalState` | Six states: `not_yet_implemented`, `never_run`, `not_expected`, `ok`, `late`, `failed`. Six exist so a not-built job, a never-run job, a late job, and a failed read are never collapsed into one "unavailable". |
| Theme token | A value in `src/theme/index.ts`. The only file in the repository permitted to contain a colour literal. |
| Appearance | `system` (default), `light`, or `dark`. Browser-local display preference, applied before first paint. **Not account state.** |

### Distinctions to preserve

- **A row is not a user.** `User` exists from sign-up onward, so its existence grants nothing — `status` does. Any code that treats "a row was found" as "this person may proceed" has reintroduced the bug the four-state enum exists to prevent.
- **Authentication and authorization are two checks, and the second one hits the database.** A valid token means the person signed in. It does not mean they are allowed in. Any path reading a role or status from a JWT claim is wrong, because a claim minted at sign-up carries no hint that approval never came.
- **Hiding is not authorizing.** `visibleSections()` filters navigation as a courtesy. The route's own guard is the boundary, and it must hold when navigation is bypassed entirely.
- **Absence is not denial.** For a viewer, admin surfaces are absent from navigation, and the denial page never names the feature, its data, or who can see it.
- **Sign-up is opaque; sign-in is opaque until it is not.** A sign-up attempt answers identically whether or not the address is registered, because it is a public surface and a distinct reply would enumerate the group. Sign-in answers identically on any *authentication* failure — but once the correct password is supplied, it says which status is blocking, because the caller has proved they own the address.
- **`not_yet_implemented` and a failed health read are different facts.** The first says the job does not exist; the second says we could not find out.

### Ownership

No entity in this spec is user-scoped. `User` is shared administrative data, readable and writable only by an admin, gated by a server-side role check. `Decision` and `Position` — the only genuinely user-scoped entities — arrive in Pitch 4. There is consequently no RLS story and no owner column in this pitch.

---

## States and Lifecycle

### Enums

```prisma
enum UserRole {
  admin
  viewer
}

enum UserStatus {
  pending // account requested; no access of any kind until decided
  active  // approved by an admin
  denied  // request refused; may not sign in
  revoked // access ended after having been approved
}
```

`HealthSignalState` is **not** a database enum — no health row is persisted in this pitch. It is a TypeScript union in `src/lib/health/types.ts`.

### Account lifecycle

| From | To | Who | Side effects |
| ---- | -- | --- | ------------ |
| — | `pending` | anyone, via `/sign-up` | Supabase auth user created, then a `User` row with `role = viewer`, `status = pending`. **No session is established.** |
| `pending` | `active` | admin | `decidedAt` and `decidedById` set. The account can sign in from its next attempt. |
| `pending` | `denied` | admin | `decidedAt` and `decidedById` set; refresh tokens invalidated. |
| `active` | `revoked` | admin, never self | `revokedAt` set; refresh tokens invalidated; denied on the next request on every device. |
| `denied` / `revoked` | any | **no** | Terminal. Reinstatement is not in this pitch. |

**Terminal and exceptional states:**

- **A pending account holding a live token.** It cannot happen through the product — sign-up establishes no session — but if one existed, `requireSession` rejects it on the first protected request.
- **A revoked user holding a live access token.** Their next request resolves the session, reads the status, clears the cookies, and redirects to `/sign-in?reason=revoked`. This is the mechanism behind "immediate", and why no authenticated route may be cached.
- **A second sign-up for a registered address.** Answered identically to a first, with no row written and no error. The caller cannot tell.
- **An admin acting on their own account.** Blocked by the route *and* by a `users_no_self_decision` check constraint. With one admin, self-denial locks the product's only operator out of their own product.

---

## UI Integration

Visual detail lives in the design doc and the UI preview. This section specifies only what the implementation must supply.

### Screens

| Screen | Route | Access | Data needed | Actions |
| ------ | ----- | ------ | ----------- | ------- |
| Sign in | `/sign-in` | public | optional `reason` (`pending` \| `denied` \| `revoked`) | submit credentials |
| Request an account | `/sign-up` | public | none | submit a request |
| Slate placeholder | `/slate` | any active session | **none — issues no query** | none |
| Settings | `/settings` | any active session | `SessionUserDto` | change appearance, sign out |
| System health | `/health` | admin | `HealthSignalDto[]` | none |
| Users | `/users` | admin | `{ pending, members }` as `AccessRowDto[]` | approve, deny, revoke |
| Access denied | rendered at the requested URL | any active session | none | link to `/slate` |
| Not found · Application error | `404` · `500` | any | none | link to `/slate`, retry |

### Components

| Component | Data contract | Notes |
| --------- | ------------- | ----- |
| `AppShell` | `SessionUserDto` | Server-resolved. Renders only after session and role resolve. |
| `NavSections` | `role` | Single source for tabs and drawer. Filtering is presentational; the guard is the boundary. |
| `AccountMenu` | `SessionUserDto` | Settings and Sign out. **Must not contain an appearance control.** |
| `EmptyState` | `{ title, detail?, action? }` | The reusable state primitive. No icon, no illustration, no artwork. |
| `NumericText` | `{ size, muted }` | Mono with tabular figures. Every displayed number goes through it. |
| `StatusChip` / `RoleChip` / `HealthStateChip` | label, tone, filled, icon | Colour is never the only signal. `HealthStateChip` renders `null` for `ok`. |
| `Users` | `{ pending, members }` | Two groups, deliberately apart. Requests are a queue; members are the roster. |
| `ConfirmDialog` (internal to `Users`) | `{ row, action }` | Copy names the subject and states the consequence. `Esc` and backdrop cancel. |

### Forms and validation

**Sign in** (`/sign-in`)

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `email` | email | yes | non-empty | Preserved on failure |
| `password` | password | yes | non-empty | Cleared on failure |

**Request an account** (`/sign-up`)

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `email` | email | yes | RFC-shape | Never reveals whether it is already registered |
| `displayName` | string | no | ≤ 80 characters | Renders as the email when null |
| `password` | password | yes | ≥ 12 characters | Rule stated in helper text before submission |
| `confirmPassword` | password | yes | equals `password` | `Passwords do not match.` |

**Role is never a form field.** It is assigned server-side as `viewer`, and a request body carrying one is rejected outright rather than ignored.

### Material UI integration

Unchanged from v1.1: `createTheme` with `cssVariables` and both `colorSchemes`; `ThemeRegistry` as the client boundary because the theme carries function-valued `styleOverrides`; `InitColorSchemeScript` for pre-paint application; the font through `next/font/local` from `src/assets/fonts/space-grotesk/`; module augmentation for the custom palette keys and typography variants. Dialogs are `fullScreen` below `sm`.

---

## Data Model

> Prisma is the single source of schema truth. Model names are `PascalCase` singular; tables are `snake_case` plural via `@@map`; every field maps explicitly via `@map`.

### Relationship to existing schema

One new model. It connects to nothing in the corpus — deliberately, because access control shares no domain with it.

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `User` | 0..1 → many | `User` (`decidedById`) | Which admin approved or denied this account |
| `User.id` | 1 → 1 | Supabase `auth.users.id` | Same UUID. Not a Prisma relation — `auth` is a schema Prisma does not manage. |

### New model

```prisma
enum UserRole {
  admin
  viewer
}

enum UserStatus {
  pending // account requested; no access of any kind until decided
  active  // approved by an admin
  denied  // request refused
  revoked // access ended after having been approved
}

/// An account, or a request for one. `id` IS the Supabase auth.users UUID.
///
/// A row exists from the moment someone signs up, which is why `status` rather
/// than the row's existence is what grants access.
model User {
  id          String     @id // = auth.users.id; NOT @default(uuid())
  email       String     @unique
  displayName String?    @map("display_name")
  role        UserRole   @default(viewer)
  status      UserStatus @default(pending)

  requestedAt  DateTime  @default(now()) @map("requested_at")
  decidedAt    DateTime? @map("decided_at")
  decidedById  String?   @map("decided_by_id")
  lastActiveAt DateTime? @map("last_active_at")
  revokedAt    DateTime? @map("revoked_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  decidedBy     User?  @relation("AccessDecision", fields: [decidedById], references: [id])
  decisionsMade User[] @relation("AccessDecision")

  @@index([status, requestedAt])
  @@map("users")
}
```

### Raw SQL constructs

Two check constraints Prisma cannot express. **Split into their own migration**, because Postgres refuses to use an enum value inside the transaction that added it.

```sql
-- Status and its timestamps must agree. Without this they can drift, and every
-- surface that reads one while trusting the other silently reports the wrong
-- thing.
ALTER TABLE "users"
  ADD CONSTRAINT "users_status_consistent" CHECK (
    (
      "status" = 'pending'
      AND "decided_at" IS NULL
      AND "decided_by_id" IS NULL
      AND "revoked_at" IS NULL
    )
    OR ("status" = 'active' AND "decided_at" IS NOT NULL AND "revoked_at" IS NULL)
    OR ("status" = 'denied' AND "decided_at" IS NOT NULL AND "revoked_at" IS NULL)
    OR ("status" = 'revoked' AND "decided_at" IS NOT NULL AND "revoked_at" IS NOT NULL)
  );

-- An admin cannot decide their own request. Enforced in the route as well; this
-- is the layer that survives a future code path forgetting to check.
ALTER TABLE "users"
  ADD CONSTRAINT "users_no_self_decision" CHECK (
    "decided_by_id" IS NULL OR "decided_by_id" <> "id"
  );
```

**No RLS policies ship in this pitch.** The table is not user-scoped; server-side role checks are the sole mechanism. See Resolved Decisions #4.

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| "Has access" | **no** | `status === "active"` | One predicate, `hasAccess()`. Never a column, never a claim. |
| Health signal state | **no** | the static signal registry | No health table exists in this pitch. |
| Relative age | **no** | `lastActiveAt` vs. render time | Formatted alongside the absolute value, never instead of it. |
| `isAdmin` | **no** | `role === "admin"` | Read from the row, per request. |
| Appearance mode | **no** (not in Postgres) | `localStorage` | Browser-local display preference. |

---

## Authorization and Access Control

Two roles, one shared dataset, **not multi-tenancy**. Enforcement is server-side in Next.js — in server components and route handlers. The Supabase client manages the session; it is not the query layer and it is not the authorization layer.

### The session resolver

Every protected surface begins here. This is the single most important function in the pitch.

```typescript
// src/lib/auth/session.ts
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export type SessionContext = {
  user: { id: string; email: string; displayName: string | null;
          role: "admin" | "viewer" };
};

/**
 * Resolves the caller. Two checks, not one:
 *   1. Supabase verifies the access token (authentication).
 *   2. Postgres confirms the account is still active (authorization).
 *
 * Step 2 is what makes revocation immediate. An access token minted before
 * revocation still verifies and still claims a role; only the database knows
 * access ended. Never read the role from a token claim.
 */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/sign-in");

  const user = await prisma.user.findUnique({ where: { id: data.user.id } });

  if (!user || user.status === "revoked") {
    await supabase.auth.signOut();
    redirect("/sign-in?reason=revoked");
  }

  void touchLastActive(user); // fire-and-forget, throttled to 15 minutes
  return { user: { id: user.id, email: user.email,
                   displayName: user.displayName, role: user.role } };
}

/** Admin surfaces. Renders the denial in place; never redirects, never
 *  renders admin chrome first. */
export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.user.role !== "admin") forbidden(); // Next.js 15 `forbidden()` → 403
  return session;
}
```

Every authenticated route segment must declare `export const dynamic = "force-dynamic"`. A statically rendered or cached authenticated page would serve a revoked user's shell from cache, which defeats the entire mechanism above.

### Middleware is not the boundary

```typescript
// src/middleware.ts — refreshes the Supabase session cookie ONLY.
// It performs no role check and gates no route. Every protected surface
// independently calls requireSession/requireAdmin. If this file were deleted,
// the application would still be secure; sessions would merely expire sooner.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.svg).*)"] };
```

### Policies per resource

| Resource | Read | Create | Update | Delete |
| -------- | ---- | ------ | ------ | ------ |
| `User` (own) | own session | — | — | — |
| `User` (list) | admin | **anyone, via `/sign-up`** — always as `pending` | admin (approve, deny, revoke only) | never |
| Health signals | admin | — | — | — |
| Slate placeholder | any **active** session | — | — | — |

### Supabase configuration (part of the deliverable, not setup trivia)

- **Supabase's own public sign-up stays disabled at the project level, even though Sightline has a sign-up page.** The application creates accounts with the service-role client, which works either way, and forces `status = pending`. Supabase's endpoint would create an auth user with **no `users` row and no status at all**, bypassing approval entirely and leaving an account no admin surface can see. Verified by a probe that calls it directly and asserts rejection.
- Email confirmations disabled; **admin approval is the gate**, not an email round-trip.
- The service-role key is used only by `createAdminClient()`, importable **only** from `src/lib/supabase/admin.ts`, with exactly two call sites: the sign-up route and the access-decision route. Never reachable from a client component, never sent to a browser.
- Development and production projects have separate, documented configuration, so a development shortcut cannot weaken production.

---

## Route Handlers and API Surface

Reads happen in server components through Prisma. Only mutations get routes.

| Method | Route | Access | Purpose |
| ------ | ----- | ------ | ------- |
| `POST` | `/api/auth/sign-up` | public | Request an account; creates a `pending` row |
| `POST` | `/api/auth/sign-in` | public | Exchange credentials for a session cookie |
| `POST` | `/api/auth/sign-out` | session | Clear the session |
| `POST` | `/api/users/:id/decision` | admin | Approve, deny, or revoke |

There is no `GET /api/health` and no `GET /api/users` — both are server-component reads. No route resets a password.

### `POST /api/auth/sign-up`

```typescript
export type SignUpInput = {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
};
```

Sequence, in order:

1. Validate. The schema is `.strict()`, so a body carrying `role` is rejected rather than ignored — that is an attempt to self-assign admin.
2. Rate-limit on the address: 5 per hour.
3. If a `User` already exists for the address, **return the success body and write nothing**.
4. Create the Supabase auth user with the service-role client. **Outside any Prisma transaction** — it is a remote call and cannot participate.
5. Create the `User` row with `id` = the auth UUID, `role = viewer`, `status = pending`.
6. If step 5 fails, delete the auth user from step 4. An orphaned auth user can authenticate, be rejected forever, and appear on no admin surface.
7. Return `202` with the uniform message.

**No session is established.** Sign-up grants nothing; the response is a receipt.

**The response is identical in every non-validation case** — new request, duplicate address, rate-limited, provider refusal. Sign-up is a public surface, so a distinct "already registered" reply would let anyone enumerate the group.

### `POST /api/auth/sign-in`

Unchanged in its opacity: unknown email, wrong password, and a missing `users` row all return one `401` with `Email or password is incorrect.`, within the same response-time band. A provider outage returns a distinguishable `503`.

**New:** once authentication *succeeds*, a non-`active` status returns `403` carrying `STATUS_MESSAGE[status]` and `details.status`. This is safe precisely here — the caller supplied the correct password, so they own the address and learn nothing they could not learn by owning it. A guesser never reaches this branch.

### `POST /api/users/:id/decision` (admin)

```typescript
export type AccessDecisionInput = { action: "approve" | "deny" | "revoke" };
```

1. `requireAdmin()`.
2. Reject if `id === session.user.id` — `400`. Also blocked by `users_no_self_decision`.
3. Reject if the target's current status is not legal for the action, per a declared table: `approve` and `deny` from `pending`; `revoke` from `active`. Expressed as a table so an illegal transition is rejected by construction rather than by whichever branch was written first.
4. Update `status`, `decidedAt`, `decidedById`, and `revokedAt`.
5. For `deny` and `revoke` only, invalidate refresh tokens. **A failure here does not fail the request** — the database write is the authoritative gate, and `requireSession` denies on the next request regardless. Rolling back because a cleanup failed would leave an admin believing access ended when it had not.

Approval deliberately does *not* call sign-out: approving someone should not terminate a session they do not have.

### Error response format

Per `references/api-conventions.md`. No response body, error message, `details` object, or log line may contain a password, the Supabase service-role key, a Prisma error string, or a connection string.

---

## Validation Rules

| Field / condition | Validation | Warn or Block | Outcome |
| ----------------- | ---------- | ------------- | ------- |
| Sign-in credentials wrong | opaque single message | **Block** | `401`, identical for unknown address, wrong password, and missing row |
| Sign-in succeeds, status not `active` | status reported | **Block** | `403` with `STATUS_MESSAGE[status]`; session torn down first |
| Sign-in attempts > 10 / 15 min / address | rate limit | **Block** | `429`, message identical to a credential failure |
| Sign-up email malformed | RFC shape | **Block** | `400`, `details.email` |
| Sign-up password < 12 chars | length | **Block** | `400`, `details.password` |
| Sign-up passwords differ | equality | **Block** | `400`, `details.confirmPassword` |
| Sign-up address already registered | — | **Warn (silent)** | `202` with the uniform body; nothing written |
| Sign-up attempts > 5 / hour / address | rate limit | **Warn (silent)** | `202` with the uniform body |
| Sign-up body contains `role` | `.strict()` schema | **Block** | `400` — an attempt to self-assign admin, not a value to reason about |
| Decision target is self | identity | **Block** | `400`; also a check constraint |
| Decision illegal for current status | transition table | **Block** | `400 invalid_state_transition` |
| Supabase sign-out fails during deny/revoke | — | **Warn** | Decision succeeds; failure logged. The DB gate is authoritative. |
| Any request body containing a Kalshi credential field | schema rejection | **Block** | `400`, never silently ignored |
| A user with no `lastActiveAt` | — | **Warn** | Renders `—`. Never `0`, never a fabricated timestamp. |
| A health signal with no last-success time | — | **Warn** | Renders `—` with its state chip. Never `now()`. |

---

## UI Data Contracts

```typescript
// src/lib/dto/session.ts
export type SessionUserDto = {
  id: string;
  email: string;
  displayName: string | null; // UI falls back to the email when null
  role: "admin" | "viewer";
};

// src/lib/dto/access.ts — one row of the Users screen.
export type AccessRowDto = {
  id: string;
  displayName: string | null; // null renders the email, never a blank cell
  email: string;
  role: "admin" | "viewer";
  status: "pending" | "active" | "denied" | "revoked";
  requestedAt: string; // ISO; rendered as a date
  lastActiveAt: string | null; // null renders "—"
  isSelf: boolean; // suppresses the revoke control; the server blocks it too
};

// The screen reads two groups, never one merged list: requests are a QUEUE that
// has been granted nothing, members are the roster. Merging them buries the
// only thing on the page that needs doing.
export type AccessScreenDto = {
  pending: AccessRowDto[];
  members: AccessRowDto[];
};
```

Contract rules:

- **No DTO contains a password, a token, or any Supabase key.**
- `null` is carried as `null`; the component renders the dash. A DTO carrying `"—"` makes a missing value indistinguishable from a present one.
- `denied` and `revoked` accounts appear in **neither** group. They are terminal, no action remains, and listing them turns an actionable screen into an audit log nobody asked for.
- Field names are shared across surfaces.

---

## Testing Strategy

Frameworks: **Jest** for unit and integration, **Playwright** for end-to-end. No pytest — nothing here touches the Python runtime.

This pitch inverts the usual ranking. Temporal leakage and prices-feeding-projections are structurally impossible — no fact table, no feature path, no Kalshi client ships — so **role enforcement is first**, tested adversarially rather than confirmed.

### 1. Access gating (first, adversarial)

```text
TEST: a_pending_account_has_no_access_anywhere
GIVEN: A User row with status pending and correct credentials
WHEN: Sign-in is attempted, then every protected route is requested directly
THEN:
  - Sign-in returns 403 with the pending message and NO session cookie
  - Every protected route redirects to /sign-in?reason=pending
  - The row exists throughout — proving the row grants nothing, status does

TEST: viewer_cannot_reach_any_admin_surface
GIVEN: An authenticated active viewer, and an admin account
WHEN: The viewer requests /health and /users by direct URL, by client-side
      navigation, by stale prefetch, and POSTs /api/users/:id/decision
THEN:
  - Every page returns 403 and renders the denial at the requested URL
  - Every route handler returns 403
  - The SERVED MARKUP contains no /health or /users reference — asserted against
    the HTML, not against visibility
  - No response body, including error details, contains any user's email

TEST: revoked_user_loses_access_on_next_request
GIVEN: An active viewer with sessions in two browser contexts
WHEN: The admin revokes them, then each context makes any request
THEN:
  - Both redirect to /sign-in?reason=revoked with cookies cleared
  - The access token has NOT expired — proving the DB read, not expiry, denied them

TEST: role_is_never_read_from_a_token_claim
THEN: No code path derives a role or status from a JWT claim, app_metadata,
      or user_metadata. Every guard reads the users row through Prisma.

TEST: authenticated_routes_are_never_cached
THEN: Every route under (app) is dynamic; none is statically prerendered.
```

### 2. Sign-up is a request, not an account

```text
TEST: sign_up_creates_a_pending_row_and_no_session
WHEN: POST /api/auth/sign-up with valid details
THEN:
  - A User row exists with status pending and role viewer
  - No session cookie is set
  - The response is 202 with the uniform message

TEST: sign_up_cannot_self_assign_a_role
WHEN: POST /api/auth/sign-up with { role: "admin" } in the body
THEN:
  - 400 validation_error — rejected, not silently ignored
  - No row is created

TEST: sign_up_does_not_reveal_whether_an_address_is_registered
GIVEN: One registered address and one unknown address
WHEN: Both are submitted
THEN:
  - Identical status, body, and response-time band
  - No second row is written for the registered address

TEST: sign_up_rolls_back_an_orphaned_auth_user
GIVEN: The Prisma write forced to fail
THEN:
  - No User row exists
  - The auth user created mid-flight is deleted
  - (An orphan can authenticate, be rejected forever, and appear on no admin
    surface — invisible and unfixable through the product.)

TEST: supabase_project_rejects_direct_signup
WHEN: A request is made straight to Supabase's /auth/v1/signup, bypassing the app
THEN:
  - Rejected by Supabase itself
  - (Otherwise an account exists with no users row and no status — approval
    bypassed entirely.)
```

### 3. The decision transitions

```text
TEST: only_legal_transitions_are_accepted
GIVEN: Accounts in each of the four statuses
WHEN: Each of approve, deny and revoke is attempted against each
THEN:
  - approve and deny succeed only from pending
  - revoke succeeds only from active
  - Every other combination returns 400 invalid_state_transition
  - No row changes on a rejected attempt

TEST: admin_cannot_decide_on_their_own_account
WHEN: POST /api/users/:ownId/decision, bypassing the UI
THEN:
  - 400 validation_error, status unchanged
  - The users_no_self_decision constraint would also reject the write

TEST: approval_does_not_sign_the_account_out
WHEN: A pending account is approved
THEN:
  - No token invalidation is attempted
  - (Approving someone should not terminate a session they do not have.)

TEST: decision_survives_supabase_signout_failure
GIVEN: The Supabase admin sign-out call failing
WHEN: An account is revoked
THEN:
  - status = revoked is committed and the route returns success
  - The failure is logged
  - The account is denied on its next request anyway
```

### 4. Sign-in disclosure boundary

```text
TEST: authentication_failures_are_indistinguishable
GIVEN: An unknown address, a wrong password on a real account, and an auth user
       with no users row
THEN:
  - Identical 401, code, message, and response-time band for all three

TEST: status_is_reported_only_after_authentication_succeeds
GIVEN: A pending account
WHEN: Sign-in with the WRONG password, then with the RIGHT one
THEN:
  - Wrong password: the opaque credential message, no status leaked
  - Right password: 403 naming the status
  - (A guesser never reaches the status branch.)
```

### 5. Theme and brand invariants

```text
TEST: no_colour_literal_outside_the_theme
THEN: Zero matches outside src/theme/index.ts. The rule fails the build.

TEST: no_second_styling_system
THEN: No Tailwind, styled-components, CSS module, global stylesheet, or second
      component library in package.json or src/.

TEST: appearance_applies_before_first_paint
GIVEN: An OS set to dark and no stored preference
THEN: No light-mode frame is painted.

TEST: appearance_control_exists_only_in_settings
THEN: Exactly one appearance control exists, on /settings.
```

### 6. Health honesty

```text
TEST: health_reports_not_yet_implemented_in_this_pitch
GIVEN: ingest_runs rows present from Pitch 1's manual backfill
THEN:
  - All three signals report not_yet_implemented with null timestamps
  - No value is derived from ingest_runs

TEST: health_read_failure_is_not_not_implemented
GIVEN: The resolver throwing
THEN: An error with a retry renders; three not-implemented rows do NOT.
```

### 7. Responsive and accessibility

```text
TEST: no_horizontal_scroll_at_320
GIVEN: Every route, both appearance modes, 320px, a 64-character email
THEN: scrollWidth <= clientWidth everywhere; every md+ action reachable.

TEST: state_never_relies_on_colour_alone
THEN: Every state remains identifiable in greyscale from its text label.
```

### 8. Integration scenario

```text
TEST: request_to_revoke_end_to_end
SCENARIO: The full access lifecycle

STEP 1: Seed the admin, sign in, open /users
VERIFY: The request queue is empty and says so; the roster holds one row with
        no revoke control on it

STEP 2: In a clean context, request an account at /sign-up
VERIFY: Uniform confirmation; a pending row appears in the admin's queue

STEP 3: Try to sign in as that account
VERIFY: Refused with the pending message; no session cookie

STEP 4: Admin approves
VERIFY: The row moves from the queue to the roster

STEP 5: Sign in as the approved viewer
VERIFY: Lands on /slate; the shell shows one tab; the markup contains no
        /health or /users

STEP 6: Viewer requests /users and /health directly
VERIFY: 403 at both URLs, denial in place

STEP 7: Viewer signs in on a second device
VERIFY: Both sessions live; no forced re-login on the first

STEP 8: Admin revokes while both sessions are live
VERIFY: Both devices land on /sign-in?reason=revoked on their next request,
        with the access token not yet expired

STEP 9: Revoked account attempts sign-in with the correct password
VERIFY: 403 naming the revoked status; no session
```

### Test data factories

```typescript
// Never default a decision timestamp to now() — a factory that does makes the
// status-consistency assertions pass while the production path writes a row the
// check constraint would reject.
export function createTestUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    email: "dana@example.com",
    displayName: "Dana Whitfield",
    role: "viewer",
    status: "pending",
    requestedAt: new Date("2026-08-04T12:00:00Z"),
    decidedAt: null,
    decidedById: null,
    lastActiveAt: null,
    revokedAt: null,
    createdAt: new Date("2026-08-04T12:00:00Z"),
    updatedAt: new Date("2026-08-04T12:00:00Z"),
    ...overrides,
  };
}
```

---

## Acceptance Criteria

**Access model**

- [ ] Anyone can request an account at `/sign-up`; the request creates a `pending` row and **no session**.
- [ ] A pending account cannot reach any protected surface, and sign-in refuses it with the pending message.
- [ ] Sign-up answers identically whether or not the address is already registered.
- [ ] A sign-up body carrying `role` is rejected, not ignored.
- [ ] Supabase's own signup endpoint rejects direct registration, so the application's route is the only way an account exists.
- [ ] An admin can approve, deny, and revoke; only legal transitions are accepted.
- [ ] An admin cannot decide on their own account — blocked by the route and by a check constraint.
- [ ] Revoking ends access on the next request on every device, with a still-valid access token.
- [ ] Deny and revoke invalidate refresh tokens; approval does not.
- [ ] Sign-in is opaque on any authentication failure and reports status only after success.
- [ ] No route accepts a user identifier, a role, or a Kalshi credential from a client.
- [ ] The first admin is seeded by `npm run db:seed`, which is idempotent.

**Design system**

- [ ] The theme defines palette, typography, spacing, shape, elevation, interaction states, and component overrides for light and dark.
- [ ] No colour literal exists outside `src/theme/index.ts`, enforced by a build-failing lint rule.
- [ ] Space Grotesk is self-hosted as one variable file; every numeric renders with `tabular-nums`, which is the sole mechanism keeping columns aligned once the face is proportional.
- [ ] The correct appearance applies before first paint; the appearance control exists only in Settings.

**Shell and states**

- [ ] Every surface is usable at phone, tablet, and desktop widths with no horizontal scrolling at 320px.
- [ ] Long names, long emails, validation messages, and role labels do not break the shell.
- [ ] The slate placeholder issues no query and displays no fabricated data.
- [ ] All three health signals report `not_yet_implemented`; no timestamp is derived from `ingest_runs`; a failed read is visibly distinct.
- [ ] The Users screen separates the request queue from the roster, and an empty queue reads as a settled answer rather than a failure.
- [ ] Every list and section has designed loading, empty, and error states.

---

## Explicit Non-Goals

**Permanent** (Product Brief)

- ❌ Sportsbook or DFS integration.
- ❌ Public or commercial access — no signup, subscriptions, pricing, or marketing surface.
- ❌ Viewer trading, viewer positions, or any surface that stores, transmits, or requests a viewer's Kalshi credential.
- ❌ Live in-game trading; film or tape-derived inputs; general sports data browsing.

**Deferred** (do not build, do not preclude)

- ❌ Slate, contract detail, decisions, edge, recommendations (Pitch 4).
- ❌ Scheduled jobs, staleness, keepalive, populated health signals (Pitch 5).
- ❌ Grading, accuracy, calibration, override performance (Pitch 6).
- ❌ Bankroll, sizing, paper trading, autonomous execution, circuit breakers (Pitches 7–8).
- ❌ Trading and order placement (Pitch 11).
- ❌ Friend pick sharing — note it would convert viewers into a role that writes, a genuine permission change this role model must not preclude.
- ❌ NBA, WNBA, additional stat types, additional suggestion sources.
- ❌ Native applications, offline support, push notifications, in-app messaging.

---

## Resolved Decisions

The spec's open questions were resolved by the owner on 2026-07-31. These are the design's committed positions; reversing any of them is a design-review change rather than an implementation choice.

1. **Password recovery does not exist — RESOLVED, accepted.** No reset flow is built, no reset route exists, and the sign-in screen carries no recovery link. **The recovery path is that the admin revokes the account and the person requests a new one**, choosing a fresh password at sign-up. Recorded here so it is not "helpfully" added during implementation; a reset flow needs a pitch.

2. **Display name is collected at sign-up — RESOLVED.** The sign-up form carries an optional **Name** field, and the value lands on the `User` row directly. Where it is null the UI renders the email address, never a blank cell and never a system identifier. Nobody edits their name after sign-up in this pitch.

3. **Requests do not expire — RESOLVED.** A pending row waits indefinitely, because the queue is the admin's to empty and a request that silently lapsed would be indistinguishable from one never made. Nothing sweeps pending rows. If the queue ever grows enough for that to matter, denying is one click.

4. **RLS is not enabled on `users` — RESOLVED for this pitch.** The table is not user-scoped, so the defence-in-depth argument that will apply to `Decision` and `Position` does not apply here. Server-side role checks are the sole mechanism. This decision is **scoped to this table only** and must be revisited — not inherited — when Pitch 4 introduces genuinely user-scoped data.

5. **Sightline sends no email — RESOLVED.** The invitation system and its Resend dependency were removed with the access-model change. Approval happens inside the product, and a person learns their request was approved by signing in: either they are in, or they are told they are still waiting. The pitch's "email delivery must be configured" dependency no longer applies.

   The obvious follow-up — notifying someone when they are approved — is deliberately **not** built. It would reintroduce a mail provider, a template, and a delivery failure mode for a product with three users who already have each other's phone numbers.

6. **Session posture is Supabase defaults with refresh-token rotation — RESOLVED.** Access tokens expire on the Supabase default; refresh-token rotation is enabled; refresh tokens are long-lived so sessions persist across devices without repeated login. The tension with immediate revocation is resolved entirely by the per-request database check in `requireSession` — token lifetime is deliberately *not* the security control here, and shortening it would be a false economy that degrades the session experience without meaningfully improving revocation latency.

7. **Last-admin protection is not implemented — RESOLVED, accepted.** Deciding on your own account is blocked by the route *and* by the `users_no_self_decision` constraint, which is sufficient while exactly one admin exists. A second admin is not planned in V1. If one is ever approved, a last-admin guard becomes necessary before that approval; recorded in Future Considerations rather than built speculatively.

   Note that an admin can only be created by the seed script — `/sign-up` assigns `viewer` unconditionally and rejects a body that says otherwise.

### Inherited, deliberately not resolved here

- **Edge against the ask or the midpoint**, and **Kalshi settlement versus the official stat line as grading truth.** Both are open in the Architecture Doc. Neither is touched by this pitch — no price and no outcome is read — and both belong to Pitches 4 and 6 respectively. Noted so nothing here silently assumes an answer.
- **Whether model calibration is visible to viewers.** Open in the PRD. This pitch keeps the option open by filtering navigation from a single role-aware list rather than hardcoding visibility per surface, so assigning Accuracy to either audience in Pitch 6 is a one-line change.

---

## Future Considerations

- **Pitch 4 (Kalshi Sync, The Slate & Decision Log)** replaces the `/slate` placeholder state without touching the route, the shell, the guards, or the theme. It introduces the first genuinely user-scoped table, `Decision`, and with it the first real RLS decision (#4) and the ownership pattern this pitch deliberately does not model.
- **Pitch 5 (Live Pipeline & Staleness)** fills the health signals from `ingest_runs` and adds `expectedWithin` and `lastAttemptAt`, which are already in `HealthSignalDto` and already rendered by `HealthSignalRow`. The `not_yet_implemented` state retires per signal as each job ships.
- **Pitch 6 (Outcome Scoring & Accuracy Surface)** adds the first chart, and with it the Recharts wrapper that reads every colour from the theme established here. It also forces the PRD's open question about whether calibration is visible to viewers — which is why navigation is role-filtered from one list rather than hardcoded per surface.
- **Pitch 11 (Kalshi Live Trading)** introduces the signing key. The rule that no route accepts a credential and no DTO carries one is established here, before there is a credential to leak.
- **Friend pick sharing (Post-MVP)** would convert viewers from read-only to a role that writes their own decisions. The two-value `UserRole` enum and the direct `role` read make that a migration and a guard change rather than a re-architecture — which is the reason no permission framework was built here.
- **Approval notifications**, if the queue ever justifies them, reintroduce a mail provider. Deliberately out of scope: see Resolved Decisions #5.
