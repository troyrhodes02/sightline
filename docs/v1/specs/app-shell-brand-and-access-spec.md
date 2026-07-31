---
version: 1.1.0
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

# App Shell, Brand & Access (Authentication and Invite · Brand and Responsive Interface)

## Summary

This pitch introduces the entire TypeScript runtime. Today the repository is Prisma plus Python; when this ships it is also a Next.js application with a comprehensive Material UI theme, an invite-only access model, and four authenticated routes — none of which display product data.

The core technical abstraction is that **authorization is a per-request database fact, not a token claim**. A Supabase access token proves who signed in and stays valid for its lifetime; it cannot express that access was revoked ninety seconds ago. So every protected surface resolves the session *and then reads `users.status` from Postgres* before rendering or mutating anything. That single decision is what makes "revocation takes effect immediately, including when a session was already active" true rather than aspirational, and it is why no authenticated route in this application may be statically rendered or cached.

The second abstraction is that **the theme is a compiled artefact with exactly one source**. Hex values exist in `src/theme/index.ts` and nowhere else in the codebase; every screen consumes tokens. This is enforceable — a lint rule fails the build on a raw colour outside that file — and enforcing it now is the whole reason this pitch precedes Pitch 4.

"Working" means five things, in priority order: (1) a viewer is rejected server-side on every admin route with no admin chrome rendered first, and cannot infer from any surface that admin surfaces exist; (2) revoking a user ends their access on their next request, on every device; (3) public account creation is impossible through the interface *and* through the Supabase project's own configuration; (4) every shipped surface renders correctly in light and dark at 320px with no horizontal scroll; and (5) the health surface reports honestly that no scheduled job exists yet, rather than inventing a timestamp.

---

## Problem

Sightline has a leakage-safe corpus and a backtested baseline model, and no way for a person to look at any of it. More precisely, the system cannot answer:

- **Who is allowed in?** There is no account, no session, no role, and no invitation. Supabase Auth is provisioned but unconfigured for invite-only use, and a default Supabase project accepts public sign-ups — meaning the current state is worse than "no auth", it is "open auth nobody has looked at".
- **Where does a screen go?** There is no application, no route structure, no layout, and no navigation, so Pitch 4 has nowhere to put the slate.
- **What does a screen look like?** There is no theme. Building the slate now would produce stock Material UI, and the Architecture Doc names the theme as a deliverable precisely because stock MUI reads as stock MUI and retrofitting a visual identity across finished screens costs more than establishing one first.
- **Is the pipeline alive?** Pitch 5 introduces scheduled jobs whose defining failure mode is silence. The health surface must exist before the jobs do, so the jobs land into a place that already displays them.

This blocks Pitch 4 entirely: the roadmap sequences this pitch first so no user-facing surface is built outside the design system. It supports the PRD's **Invite and Onboarding** and **Viewer Slate Review** journeys, and it is the pitch that makes the PRD's statement that "Authentication and Invite blocks every user-facing surface" concrete.

---

## Scope and Non-Scope

### In Scope

- **Authentication and Invite** — invite-only account creation, invitation acceptance, persistent sessions across devices, admin and viewer roles, server-enforced authorization on every protected read and write, invitation management, and immediate revocation.
- **Brand and Responsive Interface** — the Material UI theme as a named deliverable, self-hosted IBM Plex, the brand asset pipeline, the responsive application shell with role-aware navigation, and the reusable interface-state primitives.
- **The Next.js application itself** — App Router project, directory structure, Prisma client wiring through the transaction pooler, Supabase SSR session handling, and the test harness (Jest + Playwright).
- **Four authenticated routes** — `/slate` (placeholder), `/settings`, `/health` (admin), `/users` (admin).
- **Every interface state named in the design doc** — five invitation states, two sign-in failure modes, six health signal states, loading, load failure, access denied, not found, application error.

### Out of Scope

- **Every product-data surface.** No contract, projection, price, edge, recommendation, driver, distribution, decision, accuracy figure, or backtest run is read or displayed. `/slate` renders a placeholder state and issues no query.
- **Kalshi anything** — discovery, prices, resolution, orders, credentials. No Kalshi client, no signing key configuration, and no environment variable for one ships in this pitch (Pitch 4, Pitch 11).
- **Scheduled jobs, staleness, keepalive** (Pitch 5). This pitch builds the health *surface* and its not-yet-available states; it does not build, schedule, or read any job.
- **Grading, accuracy, calibration display** (Pitch 6).
- **Bankroll, sizing, paper trading, execution, breakers** (Pitches 7–8).
- **Password reset.** Not specified in any approved doc. The sign-in screen has no recovery link, and no reset route exists. See Resolved Decisions #1.
- **Editing a display name or email after acceptance**, and changing a role after acceptance.
- **Resending or cancelling an invitation.** Re-inviting an address whose invitation lapsed is a fresh invitation through the same dialog.
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
| `User` | An account. `id` **is** the Supabase `auth.users` UUID — there is no separate internal identifier and no mapping table. Carries role, status, mirrored email, display name, and activity timestamps. |
| `UserRole` | `admin` or `viewer`. Two values, closed set, database enum. Not a table, not a permission list. |
| `UserStatus` | `active` or `revoked`. The authorization gate read on every protected request. |
| `Invitation` | An admin-issued grant for one email address at one role. Carries a token *hash*, an expiry, and three nullable lifecycle timestamps. |
| Invitation state | **Derived, never stored.** Resolved from `(row exists, revokedAt, acceptedAt, expiresAt, now)` by one pure function with a fixed precedence. See States and Lifecycle. |
| Session | The Supabase-managed access and refresh token pair, held in HTTP-only cookies. Proves identity. **Does not prove authorization.** |
| `SessionContext` | The result of `requireSession()` — the authenticated `User` row read fresh from Postgres. This, not the token, is what every guard evaluates. |
| Health signal | One of three named scheduled processes — `ingest`, `recompute`, `price_refresh` — each with a state and a nullable last-success timestamp. In this pitch all three are `not_yet_implemented`. |
| `HealthSignalState` | Six states: `not_yet_implemented`, `never_run`, `not_expected`, `ok`, `late`, `failed`. Six exist so that a not-built job, a never-run job, a late job, and a failed read are never collapsed into one "unavailable". |
| Theme token | A value in `src/theme/index.ts`. The only file in the repository permitted to contain a colour literal. |
| Appearance | `system` (default), `light`, or `dark`. Browser-local display preference, persisted in `localStorage` and applied before first paint. **Not account state**; it does not follow the user across devices. |

### Distinctions to preserve

- **Authentication and authorization are two checks, and the second one hits the database.** A valid token means the person signed in. It does not mean they are still allowed in. Any code path that reads the role from a JWT claim rather than from `users` is wrong, because a claim minted before revocation still says `admin`.
- **Hiding is not authorizing.** `visibleSections()` filters navigation as a courtesy. The route's own guard is the boundary, and it must hold when navigation is bypassed entirely.
- **Absence is not denial.** For a viewer, admin surfaces are absent from navigation, and the denial page never names the feature, its data, or who can see it. A "you need admin access to view the decision log" message confirms the decision log exists.
- **`not_yet_implemented` and a failed health read are different facts.** The first says the job does not exist; the second says we could not find out. Rendering the first when the second happened is the health surface lying, which is the one thing it exists not to do.
- **A stored `expiresAt` and a derived `expired` state are different things.** The column is data; the state is computed on read, consistent with this product's compute-on-read posture.
- **The invitation token is a secret with a one-way store.** The plaintext exists in exactly two places: the recipient's email and the URL they click. The database holds only a SHA-256 hash. It is never logged, never echoed in an error, and never rendered.
- **`User` and `Invitation` are shared administrative data, not user-scoped data.** They carry no `userId` owner column, and this is *not* the ownership model that `Decision` and `Position` will use from Pitch 4 onward. Do not generalise from these tables to those.

### Ownership

No entity in this spec is user-scoped. `User` and `Invitation` are administrative records readable and writable only by an admin, gated by a server-side role check. `Decision` and `Position` — the only genuinely user-scoped entities — arrive in Pitch 4 and later. There is consequently no RLS story and no `userId` column in this pitch.

---

## States and Lifecycle

### Enums

```prisma
enum UserRole {
  admin
  viewer
}

enum UserStatus {
  active // may sign in and hold a session
  revoked // access ended; every request is rejected on its next hop
}
```

`HealthSignalState` is **not** a database enum. No health row is persisted in this pitch; the three signals are produced by a server-side resolver from a static registry. It is a TypeScript union in `src/lib/health/types.ts`.

```typescript
export type HealthSignalState =
  | "not_yet_implemented" // the job does not exist in this version
  | "never_run" // implemented, no successful run recorded
  | "not_expected" // outside the season or outside its scheduled window
  | "ok" // last success inside expected bounds
  | "late" // last success outside expected bounds
  | "failed"; // last run failed
```

### Invitation state resolution

State is derived on read. The precedence is fixed and must be implemented in exactly this order — evaluating expiry before revocation, for example, would show "expired" for a link the admin deliberately killed.

```typescript
export function resolveInvitationState(
  invitation: Invitation | null,
  now: Date,
): InvitationState {
  if (invitation === null) return "invalid"; // includes an unknown or malformed token
  if (invitation.revokedAt !== null) return "revoked";
  if (invitation.acceptedAt !== null) return "used";
  if (invitation.expiresAt <= now) return "expired";
  return "valid";
}
```

| Precedence | Condition | State | UI copy (design doc §Screen 2) |
| ---------- | --------- | ----- | ------------------------------ |
| 1 | No row for the token hash | `invalid` | This invitation link is not valid. |
| 2 | `revokedAt` set | `revoked` | This invitation is no longer valid. |
| 3 | `acceptedAt` set | `used` | This invitation has already been used. |
| 4 | `expiresAt <= now` | `expired` | This invitation has expired. |
| 5 | otherwise | `valid` | Acceptance form renders |

### Invitation lifecycle

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| — | `valid` | admin only | `Invitation` created with a fresh token; the plaintext is emailed and never persisted |
| `valid` | `used` | recipient | Inside one transaction: `acceptedAt` set, `User` created with `status = active`. The Supabase auth user is created **before** the transaction opens; see Route Handlers. |
| `valid` | `revoked` | admin only | `revokedAt` set. Revoking a pending invitation and revoking an accepted user are the same operation from the admin's side. |
| `valid` | `expired` | automatic | No write. Purely the passage of time against `expiresAt`. |
| `expired` / `used` / `revoked` | any | **no** | Terminal. A new invitation is a new row with a new token. |

### User lifecycle

| From | To | Allowed? | Side effects |
| ---- | -- | -------- | ------------ |
| — | `active` | invitation acceptance only | There is no other creation path. No route, no seed, no admin form creates a `User` directly. |
| `active` | `revoked` | admin only, never self | `status = revoked`, `revokedAt` set, **and** the Supabase refresh tokens are invalidated. Both must succeed; see Route Handlers → revoke. |
| `revoked` | `active` | **no** | Reactivation is not in this pitch. Restoring access means a new invitation, which creates a new `User`. |
| `active` | `active` | — | `lastActiveAt` refreshed at most once per 15 minutes by the session resolver. |

**Terminal and exceptional states:**

- **A revoked user holding a live access token.** Their next request to any protected surface resolves the session, reads `status = revoked`, clears the session cookies, and redirects to `/sign-in?reason=revoked`. This is the mechanism behind "immediate", and it is why no authenticated route may be cached.
- **An invitation for an address that already has a `User`.** Creation is blocked at the route with `duplicate_resource`. If one is reached anyway — an account created between issue and acceptance — acceptance resolves to `used`.
- **The admin attempting to revoke themselves.** Blocked server-side with `validation_error`; the control is absent from that row rather than rendered disabled.

---

## UI Integration

Visual detail lives in the design doc and the UI preview. This section specifies only what the implementation must supply.

### Screens

| Screen | Route | Access | Data needed | Actions |
| ------ | ----- | ------ | ----------- | ------- |
| Sign in | `/sign-in` | public | none | submit credentials |
| Invitation acceptance | `/invite/[token]` | public | resolved `InvitationState`; on `valid`, the invited email and role | set password, create account |
| Slate placeholder | `/slate` | any session | **none — issues no query** | none |
| Settings | `/settings` | any session | `SessionUserDto` | change appearance, sign out |
| System health | `/health` | admin | `HealthSignalDto[]` | none |
| Users | `/users` | admin | `AccessRowDto[]` | invite, revoke |
| Access denied | rendered at the requested URL | any session | none | link to `/slate` |
| Not found · Application error | `404` · `500` | any | none | link to `/slate`, retry |

### Components

| Component | Data contract | Notes |
| --------- | ------------- | ----- |
| `AppShell` | `SessionUserDto` | Server component. Renders only after the session and role resolve. Client island for the drawer and menu only. |
| `NavSections` | `role` | Single source for tabs and drawer. Filtering is presentational; the guard is the boundary. |
| `AccountMenu` | `SessionUserDto` | Contains Settings and Sign out. **Must not contain an appearance control.** |
| `EmptyState` | `{ title, detail?, action? }` | The reusable state primitive. No icon, no illustration, no artwork. |
| `NumericText` | `{ size, muted }` | Wraps the mono variants with tabular figures. Every displayed number goes through it. |
| `StatusChip` / `RoleChip` / `HealthStateChip` | label, tone, filled, icon | Colour is never the only signal; every chip carries text. `HealthStateChip` renders `null` for `ok`. |
| `UsersTable` | `AccessRowDto[]` | Table at `md+`, list at `xs`. Must not gain a horizontal scroll container. |
| `ConfirmDialog` | `{ title, body, confirmLabel, tone }` | Copy names the subject. `Esc` and backdrop cancel; only the button confirms. |

### Forms and validation

**Sign in** (`/sign-in`)

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `email` | string | yes | RFC-shape email | Preserved on failure |
| `password` | string | yes | non-empty | Cleared on failure |

**Invitation acceptance** (`/invite/[token]`)

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `password` | string | yes | ≥ 12 characters | Rule stated in helper text before submission, not revealed by failing |
| `confirmPassword` | string | yes | equals `password` | `Passwords do not match.` |

Email and role are display-only and are read from the invitation. A request supplying either is a validation error, not a value to trust.

**Invite a user** (dialog on `/users`)

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `email` | string | yes | RFC-shape; no active `User` and no pending `Invitation` for it | `duplicate_resource` on collision |
| `role` | enum | yes | `viewer` \| `admin` | Defaults to `viewer` because it is the safe one |
| `displayName` | string | no | ≤ 80 characters | **Deviates from design doc §Screen 6's two-field dialog — see Resolved Decisions #2.** |

### Material UI integration

- `createTheme` with `cssVariables: { colorSchemeSelector: 'data-mui-color-scheme' }` and both `colorSchemes`, so one theme object serves both modes.
- `<ThemeProvider defaultMode="system">` plus `InitColorSchemeScript` in the root layout. The stored scheme applies before first paint; a dark-mode user must never see a white flash.
- `AppRouterCacheProvider` from `@mui/material-nextjs` wraps the tree for App Router emotion caching.
- `MuiPaper` defaults to `variant="outlined"`; `shadows[1..7]` are `'none'`. MUI's own menu and dialog shadows remain.
- Custom palette keys (`market`, `border.strong`, `text.muted`, `background.elevated`, `*.soft`) and typography variants (`label`, `numericLg|Md|Sm`) require module augmentation in `src/theme/augmentation.d.ts`.
- Fonts load through `next/font/local` from `src/assets/fonts/`, **not** from `public/`. Four faces only: Plex Sans variable roman, Plex Mono 400 and 500 upright.
- Responsive behaviour per the design doc §8. Dialogs are `fullScreen` below `sm`.

---

## Data Model

> Prisma is the single source of schema truth. Model names are `PascalCase` singular; tables are `snake_case` plural via `@@map`; every field maps explicitly via `@map`. The Python runtime does not read these two tables, but the convention is repository-wide and is kept for consistency.

### Relationship to existing schema

The existing schema (Pitches 1–2) contains corpus, ingest, and backtest models only. These two models are new and connect to nothing existing — deliberately, because access control shares no domain with the corpus.

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `Invitation` | 1 → 0..1 | `User` | The account an accepted invitation produced |
| `User` | 1 → many | `Invitation` | Invitations this admin issued (`invitedById`) |
| `User.id` | 1 → 1 | Supabase `auth.users.id` | Same UUID. Not a Prisma relation — `auth` is a separate schema Prisma does not manage. |

### New models

```prisma
enum UserRole {
  admin
  viewer
}

enum UserStatus {
  active
  revoked
}

/// An account. `id` IS the Supabase auth.users UUID — there is no separate
/// internal identifier. Credentials live in Supabase Auth and never here:
/// this table holds authorization state, not secrets.
model User {
  id          String     @id // = auth.users.id; NOT @default(uuid())
  email       String     @unique // mirrored from auth at acceptance; never editable
  displayName String?    @map("display_name")
  role        UserRole
  status      UserStatus @default(active)

  invitedAt    DateTime  @map("invited_at") // the invitation's createdAt, carried over
  acceptedAt   DateTime  @map("accepted_at")
  lastActiveAt DateTime? @map("last_active_at") // refreshed at most every 15 minutes
  revokedAt    DateTime? @map("revoked_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  invitation       Invitation?  @relation("InvitationAcceptedBy")
  invitationsIssued Invitation[] @relation("InvitationIssuedBy")

  // The Users list reads active-first, then by acceptance order.
  @@index([status, acceptedAt])
  @@map("users")
}

/// An admin-issued grant for one email address at one role. Lifecycle state is
/// DERIVED from the three nullable timestamps plus expiresAt — there is no
/// status column, and adding one would create a second source of truth.
model Invitation {
  id          String   @id @default(uuid())
  email       String
  role        UserRole
  displayName String?  @map("display_name")

  /// SHA-256 of the plaintext token, hex-encoded. The plaintext is emailed and
  /// never persisted, never logged, and never returned by any route.
  tokenHash String   @unique @map("token_hash")
  expiresAt DateTime @map("expires_at")

  acceptedAt DateTime? @map("accepted_at")
  revokedAt  DateTime? @map("revoked_at")

  invitedById    String  @map("invited_by_id")
  acceptedUserId String? @unique @map("accepted_user_id")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  invitedBy    User  @relation("InvitationIssuedBy", fields: [invitedById], references: [id])
  acceptedUser User? @relation("InvitationAcceptedBy", fields: [acceptedUserId], references: [id])

  @@index([email])
  @@index([invitedById])
  @@index([expiresAt])
  @@map("invitations")
}
```

### Raw SQL constructs

Prisma cannot express a partial unique index, and this one carries a real invariant: at most one *live* invitation per address, while historical rows for the same address are retained.

```sql
-- At most one pending (unaccepted, unrevoked) invitation per email address.
-- Expired-but-unaccepted rows still occupy this slot, which is intended: the
-- admin issues a fresh invitation, and the old row is revoked as part of that
-- operation rather than accumulating silently.
create unique index invitations_one_pending_per_email
  on invitations (lower(email))
  where accepted_at is null and revoked_at is null;

-- A revoked user must carry its revocation time, and an active one must not.
alter table users
  add constraint users_revocation_consistent check (
    (status = 'revoked' and revoked_at is not null)
    or (status = 'active' and revoked_at is null)
  );

-- An accepted invitation must point at the account it produced.
alter table invitations
  add constraint invitations_acceptance_consistent check (
    (accepted_at is null and accepted_user_id is null)
    or (accepted_at is not null and accepted_user_id is not null)
  );

-- An invitation cannot be both accepted and revoked.
alter table invitations
  add constraint invitations_not_both check (
    accepted_at is null or revoked_at is null
  );
```

**No RLS policies ship in this pitch.** These tables are not user-scoped, and server-side role checks are the primary mechanism. See Resolved Decisions #4.

### Derived fields

| Field / concept | Stored? | Computed from | Notes |
| --------------- | ------- | ------------- | ----- |
| Invitation state | **no** | `revokedAt`, `acceptedAt`, `expiresAt`, `now` | One resolver, fixed precedence. A status column would drift the moment expiry passed with no write. |
| `pending` marker on a users row | **no** | the row is an `Invitation` with no `acceptedUserId` | The Users list is a union of two queries, not a status field |
| Health signal state | **no** | the static signal registry | No health table exists in this pitch. Pitch 5 supplies real values from `ingest_runs`. |
| Relative age ("8h ago") | **no** | `lastSuccessAt` vs. render time | Formatted server-side alongside the absolute timestamp, never instead of it |
| `isAdmin` | **no** | `user.role === 'admin'` | Not a column. Not a claim. Read from the row. |
| Appearance mode | **no** (not in Postgres) | `localStorage` | Browser-local display preference; deliberately not account state |

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
| `User` (list) | admin | **never** — acceptance is the only creation path | admin (revoke only) | never |
| `Invitation` | admin; recipient reads only the derived state by token | admin | admin (revoke only) | never |
| Health signals | admin | — | — | — |
| Slate placeholder | any session | — | — | — |

### Supabase configuration (part of the deliverable, not setup trivia)

- **Public sign-up disabled at the project level.** Disabling the UI is insufficient — the Supabase auth API accepts direct registrations by default, which the pitch names as a rabbit hole. Verified by a test that calls the public sign-up endpoint directly and asserts rejection.
- Email confirmations disabled; the invitation token *is* the proof of address ownership.
- The service-role key is used only by `createAdminClient()`, which is importable **only** from `src/lib/supabase/admin.ts` and is used by exactly two call sites: invitation acceptance and revocation. It is never reachable from a client component and never sent to a browser.
- Development and production projects have separate, documented configuration, so a development shortcut cannot weaken production.

---

## Route Handlers and API Surface

Reads happen in server components through Prisma. Only mutations get routes.

| Method | Route | Access | Purpose |
| ------ | ----- | ------ | ------- |
| `POST` | `/api/auth/sign-in` | public | Exchange credentials for a session cookie |
| `POST` | `/api/auth/sign-out` | session | Clear the session |
| `POST` | `/api/invitations/accept` | public + valid token | Create the auth user and the `User` row |
| `POST` | `/api/invitations` | admin | Issue an invitation |
| `POST` | `/api/users/:id/revoke` | admin | End access immediately |

There is no `GET /api/health` and no `GET /api/users` in this pitch — both are server-component reads. There is no route that creates a `User` directly, and none that resets a password.

### `POST /api/auth/sign-in`

```typescript
export type SignInInput = { email: string; password: string };
export type SignInResult = { redirectTo: string };
```

- On success: sets the Supabase session cookies, returns `{ redirectTo }` — the originally requested path if one was carried, otherwise `/slate`.
- **On any credential failure — unknown email, wrong password, revoked account — returns exactly one response:** `401 unauthorized`, `message: "Email or password is incorrect."` The three cases must be indistinguishable in status, code, message, and response timing.
- On provider failure: `503 upstream_unavailable`, `message: "Sign-in is unavailable right now. Try again in a moment."` This is a distinct response because a person who typed the right password must not be told they did not.
- Rate limited to 10 attempts per email per 15 minutes, returning `429 rate_limited` with the same opaque message as a credential failure.

### `POST /api/invitations` (admin)

```typescript
export type CreateInvitationInput = {
  email: string;
  role: "admin" | "viewer";
  displayName?: string;
};

export type InvitationDto = {
  id: string;
  email: string;
  role: "admin" | "viewer";
  displayName: string | null;
  expiresAt: string;
  createdAt: string;
  // No token. No hash. Not in this DTO, not in any DTO.
};
```

Sequence, in order:

1. `requireAdmin()`.
2. Reject if an active `User` exists for the email, or a pending `Invitation` does — `409 duplicate_resource`.
3. Generate 32 random bytes via `crypto.randomBytes`, encode base64url → the plaintext token.
4. Store `tokenHash = sha256(plaintext)` hex, `expiresAt = now + 7 days`.
5. Send the email containing `${APP_URL}/invite/${plaintext}` through the `InvitationMailer` port.
6. Return `201` with `InvitationDto`.

If the mail send fails, the `Invitation` row is rolled back and the route returns `503 upstream_unavailable`. A stored invitation whose link was never delivered is unrecoverable — the plaintext cannot be regenerated from the hash, and no resend exists in this pitch.

### `POST /api/invitations/accept`

```typescript
export type AcceptInvitationInput = {
  token: string;
  password: string;
  confirmPassword: string;
};
```

This is the only path that creates a `User`, and it spans two systems, so ordering is load-bearing:

1. Resolve the invitation by `sha256(token)`. Any state other than `valid` → `400 invalid_state_transition` with the derived state in `details.state`.
2. Validate the password (≥ 12 chars, matches confirmation).
3. Create the Supabase auth user with `createAdminClient().auth.admin.createUser({ email, password, email_confirm: true })`. **Outside the Prisma transaction** — it is a remote call and cannot participate.
4. Open a Prisma `$transaction`: create the `User` with `id` = the returned auth UUID, `role` and `displayName` from the invitation, `invitedAt` = the invitation's `createdAt`; then set the invitation's `acceptedAt` and `acceptedUserId`.
5. If step 4 fails, delete the auth user created in step 3 before returning `500`. An auth user with no `User` row can sign in and then be rejected by `requireSession` forever — a soft-bricked account that no admin surface can see.
6. Sign the user in and return `{ redirectTo: "/slate" }`.

The token is consumed only on success. A failed attempt leaves the invitation `valid`.

### `POST /api/users/:id/revoke` (admin)

```typescript
export type RevokeResult = { id: string; email: string; revokedAt: string };
```

1. `requireAdmin()`.
2. Reject if `id === session.user.id` — `400 validation_error`, `"You cannot revoke your own access."`
3. The target may be a `User` id **or** a pending `Invitation` id; the Users list is a union, so the route resolves both. A pending invitation is revoked by setting `revokedAt`; no auth user exists yet.
4. For a `User`: in one transaction set `status = revoked` and `revokedAt`; then call `createAdminClient().auth.admin.signOut(userId, "global")` to invalidate refresh tokens.
5. **If the Supabase sign-out call fails, the route still returns success** and logs the failure. The database write is the authoritative gate — `requireSession` rejects the user on their next request regardless of whether their refresh token was invalidated. Rolling back the revocation because a token cleanup failed would leave a user the admin believes is revoked with full access.

### Error response format

Per `references/api-conventions.md`. Error codes used in this pitch: `validation_error`, `invalid_state_transition`, `duplicate_resource`, `unauthorized`, `forbidden`, `rate_limited`, `upstream_unavailable`, `internal_error`.

No response body, error message, `details` object, or log line may contain: a password, an invitation plaintext token, a token hash, the Supabase service-role key, a Prisma error string, or a connection string.

---

## Validation Rules

| Field / condition | Validation | Warn or Block | Outcome |
| ----------------- | ---------- | ------------- | ------- |
| Sign-in credentials wrong | opaque single message | **Block** | `401`, identical for unknown email, wrong password, and revoked account |
| Sign-in attempts > 10 / 15 min / email | rate limit | **Block** | `429`, message identical to a credential failure |
| Invite email malformed | RFC shape | **Block** | `400 validation_error`, `details.email` |
| Invite email already has an active user or pending invitation | uniqueness | **Block** | `409 duplicate_resource` |
| Invite role not in enum | closed set | **Block** | `400 validation_error` |
| `displayName` > 80 chars | length | **Block** | `400 validation_error` |
| Acceptance password < 12 chars | length | **Block** | `400 validation_error`, `details.password`; token not consumed |
| Acceptance passwords differ | equality | **Block** | `400 validation_error`, `details.confirmPassword` |
| Acceptance token not `valid` | state resolver | **Block** | `400 invalid_state_transition`, `details.state` |
| Acceptance body contains `email` or `role` | not client-supplied | **Block** | `400 validation_error` — the invitation determines both |
| Revoke target is self | identity | **Block** | `400 validation_error` |
| Any request body containing a Kalshi credential field | schema rejection | **Block** | `400 validation_error`, never silently ignored |
| Supabase sign-out fails during revoke | — | **Warn** | Revocation succeeds; failure logged. The DB gate is authoritative. |
| A user with no `lastActiveAt` | — | **Warn** | Renders `—`. Never `0`, never a fabricated timestamp. |
| A health signal with no last-success time | — | **Warn** | Renders `—` with its state chip. Never `now()`, never a zero date. |

---

## UI Data Contracts

```typescript
// src/lib/dto/session.ts
export type SessionUserDto = {
  id: string;
  email: string;
  displayName: string | null; // UI falls back to email when null
  role: "admin" | "viewer";
};

// src/lib/dto/access.ts — one row of the Users list. Union of accepted users
// and pending invitations, which is why several fields are nullable.
export type AccessRowDto = {
  id: string; // User id, or Invitation id when pending
  kind: "user" | "invitation";
  displayName: string | null; // null renders "—", never a blank cell
  email: string;
  role: "admin" | "viewer";
  invitedAt: string; // ISO 8601, rendered as a date
  lastActiveAt: string | null; // null renders "—"
  pending: boolean;
  isSelf: boolean; // suppresses the revoke control; the server blocks it too
};

// src/lib/dto/health.ts
export type HealthSignalDto = {
  key: "ingest" | "recompute" | "price_refresh";
  label: string;
  state: HealthSignalState;
  lastSuccessAt: string | null; // null when no successful run exists
  lastSuccessAge: string | null; // "8h ago" — supplements, never replaces, the absolute value
  expectedWithin: string | null; // populated from Pitch 5
  lastAttemptAt: string | null; // populated from Pitch 5
};

// src/lib/dto/invitation.ts — what /invite/[token] renders from.
export type InvitationViewDto =
  | { state: "valid"; email: string; role: "admin" | "viewer" }
  | { state: "expired" | "used" | "revoked" | "invalid" };
// The `valid` branch is the only one carrying data. The failure branches carry
// nothing — not the email, not the expiry, not the issuer. A failed invitation
// page must not confirm that an address was ever invited.
```

Contract rules:

- **No DTO in this pitch contains a token, a hash, a password, or any Supabase key.** `InvitationDto` deliberately omits the token; the plaintext exists only in the email.
- `null` and `"—"` are a display concern; the DTO carries `null`, and the component renders the dash. A DTO that carries `"—"` has made a missing value indistinguishable from a present one.
- `displayName: null` means not collected, not "blank". The UI falls back to the email address.
- Field names are shared across surfaces: `lastActiveAt` on the Users table is the same field as `lastActiveAt` anywhere else it appears.

---

## Testing Strategy

Frameworks: **Jest** for unit and integration, **Playwright** for end-to-end. No pytest in this pitch — nothing here touches the Python runtime.

This pitch's risk profile inverts the usual ranking. Temporal leakage and prices-feeding-projections are structurally impossible here — no fact table, no feature path, and no Kalshi client ships — so **role enforcement is the top priority**, and it is tested adversarially rather than confirmed.

### 1. Role enforcement and privacy (first, adversarial)

```text
TEST: viewer_cannot_reach_any_admin_surface
GIVEN: An authenticated viewer session, and an admin account with users and invitations
WHEN: The viewer requests /health and /users by direct URL, by client-side
      navigation, by a stale prefetch, and by every admin route handler —
      POST /api/invitations, POST /api/users/:id/revoke
THEN:
  - Every page request returns 403 and renders the denial at the requested URL
  - Every route handler returns 403 forbidden
  - No admin chrome is present in the response HTML — assert the served markup
    contains no "Users" or "Health" nav entry, not merely that it is not visible
  - No response body, including error details, contains any user's email
  - The denial copy names no feature and no data

TEST: revoked_user_loses_access_on_next_request
GIVEN: A viewer with an active session on two browser contexts
WHEN: The admin revokes them, and each context then makes any request
THEN:
  - Both are redirected to /sign-in?reason=revoked
  - Both session cookies are cleared
  - No authenticated markup is served to either
  - The access token has NOT expired — proving the DB check, not expiry, is what denied them

TEST: role_is_never_read_from_a_token_claim
GIVEN: The full server codebase
WHEN: An assertion scans for role resolution
THEN:
  - No code path derives a role from a JWT claim, app_metadata, or user_metadata
  - Every guard reads users.role through Prisma

TEST: authenticated_routes_are_never_cached
GIVEN: The route tree
WHEN: The build output is inspected
THEN:
  - Every route under (app) is dynamic
  - No authenticated page is statically prerendered
```

### 2. Public sign-up is impossible

```text
TEST: supabase_project_rejects_direct_signup
GIVEN: The configured Supabase project
WHEN: A request is made directly to the public sign-up endpoint, bypassing
      the application entirely
THEN:
  - The request is rejected by Supabase itself
  - No auth user is created
  - (This is the rabbit hole the pitch names: a hidden button is not a disabled feature.)

TEST: no_route_creates_a_user_outside_acceptance
GIVEN: The full route surface
WHEN: Routes are enumerated
THEN:
  - Exactly one path writes a User row, and it requires a valid invitation token
  - No signup, register, or password-reset route exists
```

### 3. Invitation lifecycle

```text
TEST: invitation_state_precedence_is_fixed
GIVEN: An invitation that is simultaneously expired AND revoked
WHEN: resolveInvitationState runs
THEN: "revoked" — revocation outranks expiry, so a deliberately killed link
      never reads as merely lapsed

TEST: token_plaintext_is_never_persisted_or_returned
GIVEN: An invitation created through POST /api/invitations
THEN:
  - The invitations row contains only a hex SHA-256 hash
  - The 201 response body contains no token field
  - No log line emitted during the request contains the plaintext
  - The plaintext appears in exactly one place: the outbound email body

TEST: failed_acceptance_does_not_consume_the_token
GIVEN: A valid invitation
WHEN: Acceptance is submitted with an 8-character password
THEN:
  - 400 validation_error
  - acceptedAt remains null; the state is still "valid"
  - A subsequent correct submission succeeds

TEST: acceptance_rolls_back_orphaned_auth_user
GIVEN: A valid invitation, with the Prisma transaction forced to fail
WHEN: POST /api/invitations/accept
THEN:
  - No User row exists
  - The Supabase auth user created mid-flight is deleted
  - A retry with the same token still succeeds
  - (An orphaned auth user can sign in and then be rejected forever, invisible
    to every admin surface.)

TEST: invitation_failure_states_leak_nothing
GIVEN: Expired, used, revoked, and unknown tokens
WHEN: /invite/[token] renders each
THEN:
  - No response contains the invited email, the role, the expiry, or the issuer
  - An unknown token is indistinguishable from a revoked one in what it reveals
```

### 4. Sign-in indistinguishability

```text
TEST: credential_failures_are_indistinguishable
GIVEN: A registered active user, a registered revoked user, and an unregistered address
WHEN: Sign-in is attempted with a wrong password for each
THEN:
  - Identical status (401), code, and message for all three
  - Response times fall within the same band — no early return that reveals
    whether the address exists
  - A provider outage returns a DIFFERENT, distinguishable response
```

### 5. Side effects and atomicity

```text
TEST: revoke_survives_supabase_signout_failure
GIVEN: An active viewer, with the Supabase admin sign-out call failing
WHEN: POST /api/users/:id/revoke
THEN:
  - status = revoked committed
  - Route returns success, failure logged
  - The user is denied on their next request anyway
  - (Rolling back would leave an admin believing access ended when it had not.)

TEST: self_revoke_blocked_server_side
GIVEN: An admin session
WHEN: POST /api/users/:ownId/revoke, bypassing the UI entirely
THEN: 400 validation_error, status unchanged

TEST: one_pending_invitation_per_email
GIVEN: A pending invitation for dana@example.com
WHEN: A second is issued for DANA@EXAMPLE.COM
THEN:
  - 409 duplicate_resource
  - The partial unique index rejects it case-insensitively
```

### 6. Health honesty

```text
TEST: health_reports_not_yet_implemented_in_this_pitch
GIVEN: The application as shipped by this pitch, with ingest_runs rows present
       from Pitch 1's manual backfill
WHEN: An admin loads /health
THEN:
  - All three signals report "not_yet_implemented"
  - All three lastSuccessAt are null
  - No timestamp is derived from ingest_runs
  - (Rendering a manual local backfill as a healthy scheduled pipeline is
    precisely the false success the pitch forbids.)

TEST: health_read_failure_is_not_not_implemented
GIVEN: The health resolver throwing
WHEN: An admin loads /health
THEN:
  - An error state renders with a retry
  - Three "not yet implemented" rows do NOT render
```

### 7. Theme and brand invariants

```text
TEST: no_colour_literal_outside_the_theme
GIVEN: The full src/ tree
WHEN: A lint rule scans for hex, rgb(), hsl(), and named CSS colours
THEN:
  - Zero matches outside src/theme/index.ts
  - The rule fails the build, not merely a report

TEST: no_second_styling_system
GIVEN: package.json and the src/ tree
THEN:
  - No tailwind, styled-components, emotion-styled outside MUI's own use,
    CSS module, or global stylesheet
  - No component library other than @mui/material

TEST: appearance_applies_before_first_paint
GIVEN: A browser with the OS set to dark and no stored preference
WHEN: Any page loads
THEN:
  - No light-mode frame is painted
  - (Playwright: assert the computed background at first paint.)

TEST: appearance_control_exists_only_in_settings
GIVEN: Every shipped surface
THEN: Exactly one appearance control exists in the application, on /settings
```

### 8. Responsive and accessibility

```text
TEST: no_horizontal_scroll_at_320
GIVEN: Every route, in both appearance modes, at 320px
WHEN: Rendered with a 64-character email and an 80-character display name
THEN:
  - document.scrollingElement.scrollWidth <= clientWidth on every route
  - Every action reachable at md+ is reachable at 320px

TEST: state_never_relies_on_colour_alone
GIVEN: Every chip and status indicator
WHEN: Rendered in greyscale
THEN: Every state remains identifiable from its text label
```

### 9. Integration scenario

```text
TEST: invite_to_revoke_end_to_end
SCENARIO: The full access lifecycle

STEP 1: Admin signs in and opens /users
VERIFY: Only the admin's own row; no revoke control on it

STEP 2: Admin invites dana@example.com as a viewer
VERIFY: 201; pending row appears; email sent containing a link; the invitations
        row holds only a hash

STEP 3: Dana opens the link, sets a 14-character password, submits
VERIFY: Auth user created; User row created with role viewer and id equal to the
        auth UUID; invitation acceptedAt and acceptedUserId set; Dana lands on
        /slate; her shell shows one tab

STEP 4: Dana requests /users and /health directly
VERIFY: 403 at both URLs; served markup contains no admin nav entry

STEP 5: Dana signs in on a second device
VERIFY: Both sessions active; no forced re-login on the first

STEP 6: Admin revokes Dana while both her sessions are live
VERIFY: Both devices land on /sign-in?reason=revoked on their next request;
        her access token had not yet expired

STEP 7: Dana re-opens her original invitation link
VERIFY: "used" state; nothing about her account is revealed

STEP 8: Admin re-invites the same address
VERIFY: Succeeds — the prior invitation is accepted, so the partial unique index
        does not block a new one
```

### Test data factories

```typescript
// Never default expiresAt to a relative value computed at import time — a
// factory whose invitation expires "in 7 days" from module load makes expiry
// tests pass while the production path miscalculates.
export function createTestInvitation(
  overrides: Partial<Invitation> = {},
): Invitation {
  return {
    id: randomUUID(),
    email: "dana@example.com",
    role: "viewer",
    displayName: "Dana Whitfield",
    tokenHash: "0".repeat(64),
    expiresAt: new Date("2026-08-11T12:00:00Z"),
    acceptedAt: null,
    revokedAt: null,
    invitedById: ADMIN_ID,
    acceptedUserId: null,
    createdAt: new Date("2026-08-04T12:00:00Z"),
    updatedAt: new Date("2026-08-04T12:00:00Z"),
    ...overrides,
  };
}
```

---

## Acceptance Criteria

**Access model**

- [ ] Public sign-up is impossible through the interface **and** by calling the Supabase project's sign-up endpoint directly.
- [ ] An account can begin only through an admin-issued invitation; exactly one code path creates a `User`.
- [ ] An admin can invite an email address at a role, and the recipient can establish credentials and enter the application.
- [ ] Expired, used, revoked, and unknown invitations each produce their own explanatory state, and none reveals the invited address, role, or issuer.
- [ ] Admin and viewer roles exist and are enforced server-side on every protected read and write.
- [ ] A viewer requesting an admin route is rejected server-side, and the served markup contains no admin navigation.
- [ ] Revoking a user ends access on their next request on every device, with a still-valid access token.
- [ ] Sessions persist across devices without forced re-login during ordinary use.
- [ ] Sign-in reports one indistinguishable message for unknown email, wrong password, and revoked account, and a distinguishable one for provider failure.
- [ ] No route accepts a user identifier, a role, or a Kalshi credential from a client.

**Design system**

- [ ] A Material UI theme defines palette, typography, spacing, shape, elevation, interaction states, and component overrides, for light and dark.
- [ ] No colour literal exists outside `src/theme/index.ts`, enforced by a build-failing lint rule.
- [ ] IBM Plex Sans and Mono are self-hosted via `next/font/local`; every numeric renders in Plex Mono with tabular figures.
- [ ] The correct appearance mode applies before first paint; the appearance control exists only in Settings.
- [ ] Every shipped surface uses the theme with no inline one-off styling.

**Shell and states**

- [ ] Every surface is usable at phone, tablet, and desktop widths with no horizontal scrolling at 320px.
- [ ] Navigation is operable at every width, signed out, as a viewer, and as an admin.
- [ ] Long names, long emails, validation messages, and role labels do not break the shell.
- [ ] The slate placeholder issues no query and displays no fabricated data.
- [ ] All three health signals report `not_yet_implemented` with `—`; no timestamp is derived from `ingest_runs`; a failed health read is visibly distinct.
- [ ] Every list and section has designed loading, empty, and error states.
- [ ] Future authenticated sections can be added without replacing the auth flow, role model, navigation model, or theme.

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

1. **Password recovery does not exist — RESOLVED, accepted.** No reset flow is built, no reset route exists, and the sign-in screen carries no recovery link. **The recovery path is that the admin revokes the account and issues a fresh invitation**, which produces a new `User` row and a new password. This is a deliberate omission rather than a gap: a public account-recovery flow is a self-serve surface on an invite-only product, and it is the exact surface `CLAUDE.md` forbids adding without a pitch. Recorded here so it is not "helpfully" added during implementation.

2. **Display name is collected on the invitation — RESOLVED.** The invite dialog gains an optional **Display name** field, and `displayName` is carried from `Invitation` to `User` at acceptance. This is a **deliberate deviation from design doc §Screen 6**, which shows a two-field dialog; the design doc should be amended to v1.1 to match. Where `displayName` is null the UI renders the email address, never a blank cell and never a system identifier. The invitee never sets or edits their own name in this pitch.

3. **Invitation expiry is 7 days — RESOLVED.** Configurable via `INVITATION_TTL_HOURS`, defaulting to `168`. Expiry is evaluated on read against `expiresAt`; nothing sweeps expired rows, and an expired invitation remains visible in the Users list as pending until revoked or superseded.

4. **RLS is not enabled on `users` or `invitations` — RESOLVED for this pitch.** Neither table is user-scoped, so the defence-in-depth argument that will apply to `Decision` and `Position` does not apply here. Server-side role checks are the sole mechanism. This decision is **scoped to these two tables only** and must be revisited — not inherited — when Pitch 4 introduces genuinely user-scoped data.

5. **Email delivery is Resend, behind a port — RESOLVED.** `InvitationMailer` is an interface with two implementations: `ResendInvitationMailer` for preview and production, and `ConsoleInvitationMailer` for local development, which writes the acceptance URL to the server console and never to a response body. **`resend` is a new dependency not named in the Architecture Doc**; it is adopted here under the pitch's "email delivery must be configured" dependency, and the Architecture Doc's Tech Stack should record it. The port exists so the provider is a one-file change. The invitation email itself uses the fixed-colour lockups from `src/assets/brand/`, which exist for exactly this non-inlined case.

6. **Session posture is Supabase defaults with refresh-token rotation — RESOLVED.** Access tokens expire on the Supabase default; refresh-token rotation is enabled; refresh tokens are long-lived so sessions persist across devices without repeated login. The tension with immediate revocation is resolved entirely by the per-request database check in `requireSession` — token lifetime is deliberately *not* the security control here, and shortening it would be a false economy that degrades the session experience without meaningfully improving revocation latency.

7. **Last-admin protection is not implemented — RESOLVED, accepted.** Self-revocation is blocked server-side, which is sufficient while exactly one admin exists. A second admin does not exist and is not planned in V1. If one is ever invited, a last-admin guard becomes necessary before that invitation is accepted; this is recorded in Future Considerations rather than built speculatively.

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
