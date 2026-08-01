# App Shell, Brand & Access — Design Document

> ## ⚠ Superseded in part — access model changed (2026-08-01)
>
> This document was written for an **invite-only** access model: the admin
> issued invitations and a `User` existed only once one was accepted. That is no
> longer how Sightline works.
>
> **The current model is request-and-approve.** Anyone may request an account at
> `/sign-up`; a `User` row is created immediately with `status = pending` and
> **grants nothing**; the admin approves or denies it on `/users`. There is no
> `Invitation` entity, no token, and no email of any kind.
>
> What is unchanged, and is most of this document: the server-side role model,
> the per-request database read that makes access decisions immediate, the theme
> and every screen outside the access flow, the privacy posture, and the
> responsive and accessibility requirements.
>
> What is superseded: everything describing invitations, tokens, invitation
> acceptance, and mail delivery. Sections are annotated inline where the change
> is not obvious from context.
>
> This change contradicts a Brief-level non-goal — the Product Brief and the PRD
> still state that access is invite-only and that public signup does not exist.
> **Both should be amended.** Recorded here so the divergence is deliberate and
> visible rather than discovered later.


**Version:** 1.0
**Pitch Source:** Sightline — Pitch 3: App Shell, Brand & Access
**Focus:** The signed-out entry surfaces, the authenticated shell, the design system every later screen inherits, and the access-management and system-health surfaces that exist in this pitch.

---

## Decisions settled for this document

Four of the pitch's Open Questions were addressed to the design document. They are resolved as follows and are treated as settled below.

| Pitch question | Resolution |
| -------------- | ---------- |
| 5 — Who can view operational health? | **Admin only.** Health sits behind the server-side role check alongside Users. Viewers get projection freshness through staleness disclosure on data surfaces from Pitch 5; job-level operational status is the operator layer. |
| 1 — Where does health-read ownership belong? | **Pitch 3 builds the surface and its honest not-yet-available states.** Pitches 4 and 5 populate their respective signals. This pitch renders all three signals as `not yet implemented` and says so in plain words. It claims nothing about downstream job freshness. |
| 6 — Minimum invitation-management surface | **Invite, list, revoke.** One list of current access including pending invitations, a role selector at invite time, and a confirmed revoke. No resend, no cancel, no expiry management, no post-acceptance role change. |
| 4 — Is the name cleared for permanent brand work? | **Accepted.** The full supplied asset set ships: adaptive lockup, mark, favicon, app icons, touch icon. Assets are organised across `public/`, `src/assets/`, and `design/brand/` — mapped in §4.6. |

The landing route is a **placeholder**, per direction: `/slate` exists and is the post-sign-in destination, rendering a designed "not yet available" state. It contains no fabricated contracts, no mock rows, and no preview of the slate. Pitch 4 replaces the state, not the route.

---

## 1. Vision

Sightline's shell is the container William signs into before the product has anything to say. It has to feel finished while being honest that the surfaces inside it are not yet built, keep a viewer permanently outside the private layer without ever hinting the private layer exists, and hand every later pitch a design system it can build inside rather than around.

**North star: a container that is finished even though the product inside it is not.**

---

## 2. Design principles

### 1. Authorization is a server fact, and the interface never renders ahead of it

Nothing in the shell is drawn before the session and role are known server-side. A viewer deep-linking to `/users` sees the access-denied view at that URL, with no admin chrome flashing first and no client-side redirect after a partial render. Hiding a navigation item is a courtesy, not the boundary — the boundary is that the server refused.

### 2. Absence is indistinguishable from non-existence

For a viewer, admin surfaces are not disabled, not greyed, not blurred, and not present with a lock icon. They are simply not in the interface. A viewer must not be able to infer from the shell that a decision log, a positions view, or a health surface exists at all. This is the rule that survives into every later pitch, where the private layer holds real data.

### 3. A shell that admits it is a shell

Every placeholder in this pitch names what is missing and when it arrives. It never impersonates the feature it is standing in for, and it never invents a chart, a row, or a metric to look populated. A page reading *the slate is not yet available* is a designed answer; a page reading *0 contracts* with an empty table is a lie about a feature that has not been built.

### 4. The theme is the deliverable, not a by-product

Every colour, size, radius, and border in this pitch comes from the theme. Hex values appear exactly once in the codebase, in the theme module. If a screen needs a value the theme does not have, the theme is incomplete and gets extended — an inline one-off is the failure mode this whole pitch exists to prevent.

### 5. Phone-first at the shell level

Navigation, forms, dialogs, tables, and every action work at 320px with no horizontal scrolling. The slate is read on a phone on a Sunday morning; the frame it is read inside is designed at that width first and expanded upward, not designed at desktop and squeezed down.

---

## 3. Information architecture

```text
Signed out
├── /sign-in                          Sign in (email + password only)
├── /invite/[token]                   Invitation acceptance — 5 states
└── /sign-in?reason=revoked           Revoked-access notice

Signed in — shell wraps everything below
├── /slate            (shared)  ← post-sign-in landing; placeholder this pitch
├── /settings         (shared)  ← appearance selection lives here and nowhere else
├── /health           (admin)   ← honest not-yet-available states this pitch
└── /users            (admin)   ← invite, current access, revoke

Terminal states
├── 403                                Access denied — rendered in place at the requested URL
├── 404                                Not found
└── 500                                Application error
```

A viewer's navigation in this pitch contains exactly two items: Slate and Settings. An admin's contains four: Slate, Health, Users, Settings.

**Reserved space rule.** `/slate` is the only route that exists ahead of its feature, and it exists because sign-in must land somewhere. Accuracy, Backtests, and Decisions do **not** appear in navigation in this pitch — a nav item leading to a page that explains itself is still a nav item implying a feature. They are added by the pitches that build them, into a navigation model designed to take them.

---

## 4. Visual language

> All styling inherits from Sightline's Material UI theme and design system. This design doc only defines feature-specific usage, variants, and states.

This is the one design document that states the theme in full, because the theme is this pitch's named deliverable. Later design docs reference these tokens and must not restate them.

### 4.1 Palette

Sightline supports **light, dark, and system, with system as the default**. The theme is built with MUI's `colorSchemes` and CSS variables so both modes ship from one theme object and the correct mode is applied before first paint.

Colour carries **source, not sentiment**. This is the organising idea of the entire interface and the rule most often broken by accident.

| Semantic role | Theme path | Light | Dark | Meaning |
| ------------- | ---------- | ----- | ---- | ------- |
| Model accent | `palette.primary.main` | `#5B51E8` | `#7C74FF` | Anything Sightline computed. In this pitch: focus rings, primary actions, the selected nav item, the lockup mark. |
| Model accent hover | `palette.primary.light` | `#4A40D6` | `#8F88FF` | |
| Model accent pressed | `palette.primary.dark` | `#3F35C4` | `#6A61F0` | |
| Model accent soft | `palette.primary.soft` | `#EFEDFF` | `#1E1C3A` | Selected-state fills, soft alert backgrounds. |
| Market mint | `palette.market.main` | `#0F9C6E` | `#4DE4B2` | Anything Kalshi supplied. **Unused in this pitch** — no market data ships. Defined now so Pitch 4 does not invent it. |
| Market mint fill | `palette.market.fill` | `#4DE4B2` | `#4DE4B2` | Fills, chart strokes, elements above 24px only. |
| Market mint soft | `palette.market.soft` | `#E6FAF3` | `#12332A` | |
| Caution | `palette.warning.main` | `#B57414` | `#E8A33D` | Staleness, degraded mode, low confidence, insufficient sample, **a failed or late scheduled job**. Never "bad price", never "loss". |
| Caution soft | `palette.warning.soft` | `#FDF3E2` | `#33260F` | |
| Negative / destructive | `palette.error.main` | `#C4425F` | `#E06C8A` | Negative edge and destructive actions. In this pitch: revoke access, and validation errors. |
| Negative soft | `palette.error.soft` | `#FCEBEF` | `#3A1C25` | |
| App background | `palette.background.default` | `#FAFAFA` | `#0A0A0B` | |
| Surface | `palette.background.paper` | `#FFFFFF` | `#131315` | |
| Elevated surface | `palette.background.elevated` | `#FFFFFF` | `#1A1A1D` | Menus, dialogs, the mobile drawer. In light mode elevation is carried by the border, not a fill change. |
| Divider | `palette.divider` | `#E4E4E7` | `#26262A` | |
| Border strong | `palette.border.strong` | `#C9C9CF` | `#35353B` | Input outlines, focused table borders. |
| Text primary | `palette.text.primary` | `#131316` | `#ECECEE` | |
| Text secondary | `palette.text.secondary` | `#5C5C66` | `#9B9BA3` | |
| Text muted | `palette.text.muted` | `#8A8A93` | `#6B6B73` | Timestamps, helper text, de-emphasised rows. |

Two contrast rules are load-bearing rather than advisory:

- **Mint at `#4DE4B2` fails contrast for body-size text on white.** Light mode uses `#0F9C6E` for any market value at 16px or below. This is why two mint tokens exist. Nothing in this pitch renders a market value, but the tokens ship correct.
- **Dark mode is near-black, not navy.** If a dark surface has a hue, it is wrong. Elevation is carried by 1px borders and small lightness steps, never blue tinting and never drop shadows.

### 4.2 State colours used in this pitch

No product-data enums render here. The states this pitch owns are the invitation lifecycle, the user access states, and the health-signal states.

| State | Visual treatment | Usage |
| ----- | ---------------- | ----- |
| Invitation `pending` | Warning tone, outlined chip, label `Pending` | An invited account that has not been accepted |
| Access `active` | No chip at all | The resting state. An active user's row carries no status indicator, the same way an unmarked contract carries none. |
| Access `revoked` | Row removed from the list | Revocation removes access; the row does not persist as a tombstone in this pitch's surface |
| Role `admin` | Model accent, outlined chip | |
| Role `viewer` | Neutral, outlined chip | |
| Health `not yet implemented` | Neutral, outlined, label `Not yet implemented` | The job does not exist in this version. All three signals this pitch. |
| Health `never run` | Neutral, outlined, label `Never run` | Implemented, no successful run recorded |
| Health `not expected` | Neutral, outlined, label `Not expected` | Outside the season or outside the scheduled window |
| Health `ok` | No chip; timestamp in mono, text primary | Last success inside expected bounds |
| Health `late` | Warning tone, filled, label `Late` | Last success outside expected bounds |
| Health `failed` | Warning tone, filled, label `Failed` | Last run failed |

Four distinct not-available states exist deliberately. Collapsing them into one "unavailable" is the rabbit hole the pitch names: a health surface that cannot distinguish *not built* from *never ran* from *failed* will report false outages in Pitch 3 and false success in Pitch 5.

Colour is never the only indicator. Every state above carries a text label, and `failed` and `late` additionally carry an icon.

### 4.3 Typography

**Space Grotesk for everything** — interface text and every numeric alike. One
variable file covering weights 300–700, self-hosted, 36 KB.

| Variant | Size / line | Weight | Tracking | Usage |
| ------- | ----------- | ------ | -------- | ----- |
| `h1` | 22 / 30 | 600 | -0.01em | Screen title. The only place 600 is used. |
| `h2` | 18 / 26 | 500 | default | Section title within a screen |
| `body1` | 15 / 22 | 400 | default | Body text, table cells, form values |
| `body2` | 14 / 20 | 400 | default | Supporting text |
| `label` | 13 / 18 | 500 | default | Column headers, form labels, chip text |
| `caption` | 13 / 18 | 400 | default | Helper text, qualifiers |
| `numericLg` | 22 / 30 | 400 | default | Headline figures (Pitch 6 onward) |
| `numericMd` | 15 / 22 | 400 | default | Health timestamps, table dates |
| `numericSm` | 13 / 18 | 400 | default | Dense secondary figures |

- **`font-variant-numeric: tabular-nums` is set on all three numeric variants,
  and it is load-bearing rather than a refinement.** Space Grotesk's default
  figures are *proportional* — ten digits, nine different advance widths — so
  this setting is the only thing keeping numeric columns aligned. Column
  alignment down sixty rows is why the numeric variants exist at all.
- **Never bold a data value to signal importance.** Importance is carried by
  position and colour.
- **No uppercase labels anywhere**, therefore no letter-spacing on labels.
  `textTransform: 'none'` is a global override, including on buttons.
- Base font size is 15px. `htmlFontSize` stays at 16 so browser text-size
  preferences scale correctly.

**One trap, already hit once.** `next/font`'s `.variable` is a generated *class
name*, not a custom-property name. Building a `var()` expression from it yields
invalid CSS that browsers discard silently, falling back to `system-ui` with
nothing reported. Reference `var(--font-space-grotesk)` directly.

### 4.4 Spacing, shape, elevation

- **Spacing:** MUI's default 8px base, with half-steps (`spacing(0.5)` = 4px) permitted for dense rows. Screen gutters: 16px at `xs`, 24px at `sm`, 32px at `md+`. Content max-width 1280px, centred.
- **Shape:** `borderRadius: 6`. Chips 4px. Nothing is fully rounded — there are no pill badges in this product.
- **Elevation:** carried by 1px borders and background lightness steps. `shadows[1]` through `shadows[7]` are overridden to `'none'`; MUI's defaults are retained only where MUI ships them for menus, popovers, and dialogs. Cards are bordered, not floated. `MuiPaper` defaults to `variant="outlined"`.
- **Focus:** 2px `palette.primary.main` outline at 2px offset on every focusable element. The default MUI focus ring is replaced globally, not per component.

### 4.5 Appearance behaviour

- Default is **system**. Selection lives in **Settings only** — never a toggle in the app bar, never a sun/moon icon, never in the account menu.
- The chosen scheme is applied before first paint via MUI's initialisation script, so there is no flash of the wrong mode on load. A user whose OS is dark must never see a white flash.
- Selection persists per browser. It is a display preference, not account state, and does not follow the user across devices in this pitch.
- Every screen is designed theme-aware through tokens. No screen in this pitch looks meaningfully different between modes beyond its surface and text colours; the lockup adapts through `currentColor`.

### 4.6 Brand assets

The name is accepted and the full supplied set ships. The mark is a circular reticle and **must not be redesigned or recoloured**, and the arc must not be recoloured.

Assets are organised by how they are consumed, in three locations. `design/brand/README.md` is the authoritative map; the table below is the design-facing subset.

| Asset | Path | Where it is used |
| ----- | ---- | ---------------- |
| App lockup | `src/assets/brand/logo-lockup-adaptive.svg` | App bar, sign-in, invitation acceptance. **Inlined in the DOM** so `currentColor` resolves. |
| Mark alone | `src/assets/brand/logo-mark-adaptive.svg` | Compact app bar at `xs` |
| Fixed-colour lockups | `src/assets/brand/logo-lockup-for-{dark,light}-backgrounds.svg` | Invitation email. Not used in-app — `currentColor` does not inherit through an `<img>` tag. |
| Typeface | `src/assets/fonts/space-grotesk/` | Everything — interface text and numerics alike. One variable file, 300–700, WOFF2. |
| Favicon | `public/favicon.svg` | Browser tab. A separate drawing with ticks removed — not a scaled mark. Filename is convention-locked. |
| Touch icon | `public/apple-touch-icon.png` | iOS home screen. Filename is convention-locked. |
| PWA / store icons | `public/icons/` | Web app manifest |
| Icon sources | `design/brand/` | Regeneration only. Never served, never imported. |

The font is loaded through `next/font/local` from `src/assets/`, **not** served from `public/`. That is what produces the hashed filename, the preload hint, and the generated `@font-face` with `font-display: swap`. Moving it into `public/` loses all three.

**No asset gaps remain.** The typeface ships as a single WOFF2 variable file, which is the right format for self-hosting and roughly a quarter the size of the equivalent TTF.

No social preview image exists in the set. None is required this pitch — there is no public surface, and the only externally-shared link is an invitation, which resolves to a page behind a token. If one is wanted later it is an additive asset, not a design change.

---

## 5. Screen specifications

## Screen 1: Sign in

### Purpose

Let an invited person with existing credentials into the application, and make the absence of a signup path read as deliberate.

### URL pattern

`/sign-in`, and `/sign-in?reason=revoked` for the revoked-access variant.

### Trigger

Any unauthenticated request to a protected route; sign-out; session expiry; revocation taking effect.

### Layout

```text
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│            ◎ sightline                   │
│                                          │
│   Email                                  │
│   ┌────────────────────────────────────┐ │
│   │                                    │ │
│   └────────────────────────────────────┘ │
│   Password                               │
│   ┌────────────────────────────────────┐ │
│   │                                    │ │
│   └────────────────────────────────────┘ │
│                                          │
│   ┌────────────────────────────────────┐ │
│   │            Sign in                 │ │
│   └────────────────────────────────────┘ │
│                                          │
│   Access to Sightline is by invitation.  │
│                                          │
└──────────────────────────────────────────┘
```

Error state:

```text
│   ┌────────────────────────────────────┐ │
│   │ ⚠  Email or password is incorrect. │ │
│   └────────────────────────────────────┘ │
```

Revoked variant, shown above the form:

```text
│   ┌────────────────────────────────────┐ │
│   │ Your access to Sightline has been  │ │
│   │ removed.                           │ │
│   └────────────────────────────────────┘ │
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Lockup** | Inlined `SightlineLockup`, 28px height | Adapts to appearance through `currentColor` |
| **Email** | `TextField`, outlined, `size="small"`, `type="email"`, `autoComplete="email"` | Autofocus on load at `md+`; no autofocus at `xs` so the keyboard does not cover the form |
| **Password** | `TextField`, outlined, `type="password"`, `autoComplete="current-password"` | No visibility toggle — an unnecessary surface on a two-field form |
| **Submit** | `Button`, `variant="contained"`, full width | Disabled while submitting, label unchanged, `CircularProgress` size 16 replaces nothing — the button shows a leading spinner and keeps its label |
| **Failure** | `Alert`, `severity="error"`, `variant="outlined"` | Rendered above the form, focus moved to it on appearance |
| **Footer note** | `Typography variant="caption"`, `text.muted` | Static. Not a link. |

### Code reference

```tsx
<Stack component="form" spacing={3} sx={{ width: '100%', maxWidth: 380 }}>
  <SightlineLockup height={30} />

  {reason === 'revoked' && (
    <Alert severity="info" variant="outlined">
      Your access to Sightline has been removed.
    </Alert>
  )}

  {error && (
    <Alert severity="error" variant="outlined" ref={errorRef} tabIndex={-1}>
      Email or password is incorrect.
    </Alert>
  )}

  <TextField label="Email" type="email" autoComplete="email" size="small" required />
  <TextField label="Password" type="password" autoComplete="current-password" size="small" required />

  <Button type="submit" variant="contained" disabled={submitting}>
    Sign in
  </Button>

  <Typography variant="caption" sx={{ color: 'text.muted' }}>
    Access to Sightline is by invitation.
  </Typography>
</Stack>
```

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Email | email | yes | empty | Format checked on blur; message `Enter a valid email address.` |
| Password | password | yes | empty | Non-empty only. **No strength meter, no format hint** — this is sign-in, not account creation. |

### Validation

- Submit is enabled whenever both fields are non-empty. It is never disabled to communicate a validation failure — a disabled button with no explanation is the failure mode being avoided.
- **The failure message never distinguishes an unknown email from a wrong password.** One string, both cases: `Email or password is incorrect.` This is a security requirement, not a copy preference.
- Email input is preserved on failure; password is cleared.
- Repeated failures do not change the message or reveal a lockout count.

### Empty state

Not applicable — the screen is a form.

### Loading state

The submit button takes a leading 16px spinner and both fields become read-only. No full-screen overlay.

### Error state

Network or provider failure renders a separate alert: `Sign-in is unavailable right now. Try again in a moment.` with a `Retry` action. This is distinguishable from a credential failure, because a person who typed the right password should not be told they did not.

### Behavior

- Success navigates to `/slate`, or to the originally requested path if the user was redirected here from a protected route.
- `Enter` in either field submits.
- **There is no "forgot password" link.** Password reset is not specified in the approved docs, and the login screen must not offer a flow that does not exist. See Open Question 3.
- No signup link, no social auth, no magic link, no marketing copy. The screen should look deliberate about it rather than like a link went missing.

---

## Screen 2: Invitation acceptance

### Purpose

Let an invited person establish credentials and enter the application — and fail clearly, in the right words, when the invitation cannot be used.

### URL pattern

`/invite/[token]`

### Trigger

Following the link in an invitation email.

### Layout — valid token

```text
┌──────────────────────────────────────────┐
│            ◎ sightline                   │
│                                          │
│   You have been invited to Sightline.    │
│                                          │
│   dana@example.com          [ Viewer ]   │
│                                          │
│   Choose a password                      │
│   ┌────────────────────────────────────┐ │
│   └────────────────────────────────────┘ │
│   At least 12 characters.                │
│                                          │
│   Confirm password                       │
│   ┌────────────────────────────────────┐ │
│   └────────────────────────────────────┘ │
│                                          │
│   ┌────────────────────────────────────┐ │
│   │          Create account            │ │
│   └────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

### Layout — the four failure states

Each is a distinct screen with its own copy. An agent handed "invite acceptance" builds one; all five are named here for that reason.

```text
Expired                     ┌────────────────────────────────────┐
                            │ ◎ sightline                        │
                            │ This invitation has expired.       │
                            │ Ask William to send a new one.     │
                            │ [ Go to sign in → ]                │
                            └────────────────────────────────────┘

Already used                │ This invitation has already been   │
                            │ used. If the account is yours,     │
                            │ sign in.                           │
                            │ [ Go to sign in → ]                │

Revoked                     │ This invitation is no longer       │
                            │ valid.                             │
                            │ [ Go to sign in → ]                │

Invalid / unknown token     │ This invitation link is not valid. │
                            │ Check that you copied the whole    │
                            │ link.                              │
                            │ [ Go to sign in → ]                │
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Invited email** | `Typography variant="body1"`, `text.primary` | Read-only text, never an editable field. The invitation determines the address. |
| **Role chip** | `Chip`, outlined, `size="small"` | Model accent for admin, neutral for viewer. Read-only. |
| **Password** | `TextField`, `type="password"`, `autoComplete="new-password"` | Helper text states the rule up front, not after failure |
| **Confirm** | `TextField`, `type="password"`, `autoComplete="new-password"` | Mismatch checked on blur and on submit |
| **Submit** | `Button contained`, full width | |
| **Failure screens** | `EmptyState` component | Title, one line of detail, one action back to sign-in |

### Code reference

```tsx
switch (invitation.state) {
  case 'valid':
    return <AcceptInvitationForm email={invitation.email} role={invitation.role} />;
  case 'expired':
    return (
      <EmptyState
        title="This invitation has expired."
        detail="Ask William to send a new one."
        action={{ label: 'Go to sign in', href: '/sign-in' }}
      />
    );
  case 'used':
    return (
      <EmptyState
        title="This invitation has already been used."
        detail="If the account is yours, sign in."
        action={{ label: 'Go to sign in', href: '/sign-in' }}
      />
    );
  case 'revoked':
    return (
      <EmptyState
        title="This invitation is no longer valid."
        action={{ label: 'Go to sign in', href: '/sign-in' }}
      />
    );
  default:
    return (
      <EmptyState
        title="This invitation link is not valid."
        detail="Check that you copied the whole link."
        action={{ label: 'Go to sign in', href: '/sign-in' }}
      />
    );
}
```

### Fields

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Email | display only | — | from invitation | Never editable. An invitation is to an address. |
| Role | display only | — | from invitation | Never editable by the invitee. |
| Password | password | yes | empty | Minimum 12 characters, stated in helper text before the user types |
| Confirm password | password | yes | empty | Must match; message `Passwords do not match.` |

### Validation

- Rules are stated in helper text before submission, not revealed by failing.
- Errors render inline beneath the field. Neither field is cleared on failure.
- Submit is enabled when both fields are non-empty; validation happens on submit.

### Empty state

Not applicable.

### Loading state

Token validation happens server-side before render, so the user never sees a form that then turns out to be invalid. While the account is being created, the submit button takes a leading spinner and both fields become read-only.

### Error state

If account creation fails for a reason other than the token — a provider outage — the form persists with an alert: `Account setup failed. Try again in a moment.` The token is not consumed by a failed attempt.

### Behavior

- Success signs the user in and lands them on `/slate`. It does not route them through sign-in to type the password they just set.
- An invitation for an address that already has an account renders the **already used** state.
- A revoked user following an old invitation link renders **revoked**, not **valid**.
- All four failure states route to `/sign-in`, never deeper into the application.
- The token appears in the URL and is never echoed in copy, in an error message, or in a page title.

---

## Screen 3: Application shell

### Purpose

Hold every authenticated surface in one frame with role-aware navigation, a stable place for account controls, and identical structure across phone, tablet, and desktop.

### URL pattern

Wraps all authenticated routes. Not a route itself.

### Trigger

Any authenticated request.

### Layout — `md` and above

```text
┌──────────────────────────────────────────────────────────────────┐
│ ◎ sightline    Slate   Health   Users                    [ WR ▾ ]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Screen title                                                   │
│                                                                  │
│   content                                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
       ↑ selected section carries a 2px model-accent underline
```

### Layout — `xs` and `sm`

```text
┌────────────────────────────────┐    Drawer open:
│ ☰   ◎ sightline          [WR] │    ┌──────────────────┐
├────────────────────────────────┤    │ ◎ sightline    ✕ │
│                                │    ├──────────────────┤
│  Screen title                  │    │ Slate            │
│                                │    │ Health           │
│  content                       │    │ Users            │
│                                │    │ Settings         │
│                                │    ├──────────────────┤
│                                │    │ William Rhodes   │
│                                │    │ Admin            │
│                                │    │ Sign out         │
└────────────────────────────────┘    └──────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **App bar** | `AppBar position="sticky"`, `variant="outlined"`, no elevation, bottom divider only | Height 60px. Background is `background.paper`, not the accent. |
| **Lockup** | Inlined `SightlineLockup` at `sm+`, `SightlineMark` alone at `xs` | Links to `/slate`. No wordmark added to the mark when the mark stands alone. |
| **Section nav** | `Tabs` at `md+` with `textTransform: 'none'` | Selected item: model accent text plus a 2px accent underline. Unselected: `text.secondary`. |
| **Menu button** | `IconButton` with `MenuIcon`, `xs`/`sm` only | Opens the temporary drawer. `aria-label="Open navigation"`. |
| **Drawer** | `Drawer variant="temporary"`, `background.elevated` | Contains sections, then a divider, then account block and sign-out. Closes on selection and on `Esc`. |
| **Account control** | `IconButton` with initials `Avatar` → `Menu` | Menu shows display name, email, role chip, `Settings`, `Sign out`. **No appearance toggle.** |
| **Content region** | `Container maxWidth="lg"` with responsive gutters | `<main>` landmark, focus target for skip link |
| **Skip link** | Visually hidden `Link`, visible on focus | First tabbable element; jumps to `<main>` |

### Code reference

```tsx
const sections = [
  { label: 'Slate', href: '/slate', adminOnly: false },
  { label: 'Health', href: '/health', adminOnly: true },
  { label: 'Users', href: '/users', adminOnly: true },
  { label: 'Settings', href: '/settings', adminOnly: false, drawerOnly: true },
];

// `role` is resolved server-side. The shell is not rendered before it is known.
const visible = sections.filter((s) => !s.adminOnly || role === 'admin');
```

```tsx
<AppBar position="sticky" color="transparent" variant="outlined"
  sx={{ bgcolor: 'background.paper', borderWidth: 0, borderBottomWidth: 1 }}>
  <Toolbar sx={{ minHeight: 56, gap: 2 }}>
    <IconButton edge="start" aria-label="Open navigation"
      sx={{ display: { xs: 'inline-flex', md: 'none' } }} onClick={openDrawer}>
      <MenuIcon />
    </IconButton>

    <Box component={Link} href="/slate" sx={{ display: 'flex', color: 'text.primary' }}>
      <SightlineLockup height={22} sx={{ display: { xs: 'none', sm: 'block' } }} />
      <SightlineMark size={22} sx={{ display: { xs: 'block', sm: 'none' } }} />
    </Box>

    <Tabs value={current} sx={{ display: { xs: 'none', md: 'flex' }, ml: 2 }}>
      {visible.filter((s) => !s.drawerOnly).map((s) => (
        <Tab key={s.href} value={s.href} label={s.label} href={s.href} />
      ))}
    </Tabs>

    <Box sx={{ flex: 1 }} />
    <AccountMenu user={user} />
  </Toolbar>
</AppBar>
```

### Empty state

Not applicable — the shell always has content, and its content owns its own empty state.

### Loading state

Route transitions render a 2px indeterminate `LinearProgress` in the model accent, flush beneath the app bar. The app bar and navigation never re-skeleton between authenticated routes; only the content region changes.

### Error state

An uncaught error inside the content region renders the application-error state **inside the shell**, preserving navigation, so a user is never stranded on a bare error page with no way back.

### Behavior

- The shell is rendered only after the session and role resolve server-side. There is no state in which navigation is drawn and then corrected.
- The selected section is derived from the current path and exposed with `aria-current="page"`.
- The drawer traps focus while open, closes on `Esc`, and returns focus to the menu button.
- Sign-out clears the session and lands on `/sign-in` with no reason parameter.
- **A revoked user's next request is rejected.** The shell is not rendered; the user lands on `/sign-in?reason=revoked`. Revocation does not wait for session expiry, and it does not depend on the user reloading a cached page.

---

## Screen 4: Slate (placeholder)

### Purpose

Give sign-in a destination and hold the route the slate will occupy, without pretending the slate exists.

### URL pattern

`/slate` — the post-sign-in landing for both roles.

### Trigger

Successful sign-in, the lockup in the app bar, or the Slate nav item.

### Layout

```text
┌──────────────────────────────────────────────────────────┐
│ ◎ sightline    Slate   Health   Users            [ WR ▾ ]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Slate                                                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                                                    │  │
│  │   The slate is not yet available.                  │  │
│  │                                                    │  │
│  │   Contract listings, projections, and edges        │  │
│  │   arrive with Kalshi market sync.                  │  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Title** | `Typography variant="h1"` | `Slate` — the section's real name, so the route reads correctly from Pitch 4 onward |
| **Placeholder block** | `EmptyState` inside an outlined `Paper`, centred, `py: 8` | No illustration, no icon, no artwork |
| **Copy** | `h2` for the statement, `body2` `text.secondary` for the detail | Flat and declarative. No "coming soon", no exclamation, no countdown. |

### Code reference

```tsx
<Stack spacing={3}>
  <Typography variant="h1">Slate</Typography>
  <Paper variant="outlined">
    <EmptyState
      title="The slate is not yet available."
      detail="Contract listings, projections, and edges arrive with Kalshi market sync."
    />
  </Paper>
</Stack>
```

### Empty / loading / error states

The screen *is* a state. It has no data to load, no query to fail, and no skeleton. This is deliberate: a placeholder that renders a skeleton and then a placeholder is pretending to fetch something.

### Behavior

- **No mock contracts, no sample rows, no illustrative numbers, no disabled filter controls.** The pitch's No-Go list names this directly, and it is the single easiest way for this screen to go wrong.
- No action buttons routing to Accuracy or Backtests — neither surface exists yet. When they do, the empty-slate state gains those routes as the PRD's empty-slate journey specifies.
- Identical for admin and viewer. There is nothing role-specific about an unavailable section.

---

## Screen 5: Health

### Purpose

Make the freshness of Sightline's scheduled systems visible inside the application rather than in a logs tab — and, in this pitch, state honestly that none of them exist yet.

### URL pattern

`/health` — **admin only**, enforced server-side.

### Trigger

The Health nav item. Reachable in one tap from anywhere in the shell.

### Layout — this pitch, all three signals not yet implemented

```text
┌──────────────────────────────────────────────────────────┐
│  System health                                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ℹ  Scheduled jobs are not part of this version.    │  │
│  │    These signals report as unavailable until the   │  │
│  │    live pipeline ships.                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Ingest                      [ Not yet implemented ]│  │
│  │ Last successful run    —                           │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Recompute                   [ Not yet implemented ]│  │
│  │ Last successful run    —                           │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Price refresh               [ Not yet implemented ]│  │
│  │ Last successful run    —                           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Layout — the populated shape this surface grows into

Included so Pitches 4 and 5 populate a designed row rather than inventing one.

```text
│  │ Ingest                                             │  │
│  │ Last successful run    2026-09-14 03:12 ET         │  │   ← ok: no chip
│  ├────────────────────────────────────────────────────┤  │
│  │ Recompute                              [ ⚠ Late ]  │  │
│  │ Last successful run    2026-09-13 22:40 ET         │  │
│  │ Expected within        6h                          │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ Price refresh                        [ ⚠ Failed ]  │  │
│  │ Last successful run    2026-09-14 11:02 ET         │  │
│  │ Last attempt           2026-09-14 11:17 ET         │  │
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Title** | `Typography variant="h1"` | `System health` |
| **Version notice** | `Alert severity="info" variant="outlined"` | Present only while any signal is `not yet implemented`. Disappears on its own once all three are live — it is not a permanent banner. |
| **Signal list** | Outlined `Paper` containing `List` with dividers | Three rows: Ingest, Recompute, Price refresh |
| **Signal name** | `Typography variant="body1"` | |
| **State chip** | `Chip size="small"` per §4.2 | Omitted entirely when the state is `ok` — a healthy job carries no badge |
| **Timestamp** | `numericMd`, `text.primary`; `text.muted` when the value is `—` | Absolute, with an explicit timezone. Never "3 hours ago" alone. |
| **Relative age** | `caption`, `text.muted`, in parentheses after the timestamp at `sm+` | Hidden at `xs` to protect the row |

### Code reference

```tsx
<List disablePadding>
  {signals.map((signal, i) => (
    <ListItem key={signal.key} divider={i < signals.length - 1}
      sx={{ display: 'block', py: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography variant="body1">{signal.label}</Typography>
        <HealthStateChip state={signal.state} />
      </Stack>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="label" sx={{ color: 'text.secondary' }}>
          Last successful run
        </Typography>
        <Typography variant="numericMd"
          sx={{ color: signal.lastSuccessAt ? 'text.primary' : 'text.muted' }}>
          {signal.lastSuccessAt ? formatAbsolute(signal.lastSuccessAt) : '—'}
        </Typography>
      </Stack>
    </ListItem>
  ))}
</List>
```

### Empty state

There is no empty state. The list always has exactly three rows; a signal with nothing to report says which kind of nothing it is. An absent row would be indistinguishable from a job that was forgotten.

### Loading state

Three `Skeleton` rows at the final row height, so the layout does not shift. The version notice does not skeleton.

### Error state

If the health read itself fails, the list is replaced by an `Alert severity="error"` reading `Health could not be read.` with a `Retry` action. It must not fall back to rendering three `Not yet implemented` rows — a failed read and a not-built job are different facts, and conflating them is exactly the rabbit hole the pitch names.

### Behavior

- **No fabricated success timestamps.** A job that does not exist has no last-success time, and the field renders `—`, never a current time and never a zero date.
- Values are read on request. There is no auto-refresh interval, no live polling, and no countdown.
- This surface reports scheduled-job freshness only. It is not an operations console: no logs, no feature flags, no job triggers, no database tools, no deploy controls.
- Admin only. A viewer requesting `/health` gets Screen 8.

---

## Screen 6: Users

### Purpose

Let William invite a person, see who currently has access, and remove access with immediate effect.

### URL pattern

`/users` — **admin only**, enforced server-side.

### Trigger

The Users nav item.

### Layout — `md` and above

```text
┌────────────────────────────────────────────────────────────────────┐
│  Users                                          [ Invite viewer ]  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Name             Email               Role     Invited   Last │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ William Rhodes   wtrhodes02@…       [Admin]  2026-08-02  Now │  │
│  │ Dana Whitfield   dana@example.com   [Viewer] 2026-08-04  2d  │  │
│  │                                                       [Revoke]│  │
│  │ —                marcus@example.com [Viewer] 2026-08-09   —  │  │
│  │                                     [Pending]         [Revoke]│  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### Layout — `xs`

Rows become two-line entries in a list; the table does not scroll horizontally and does not become a card deck.

```text
┌────────────────────────────────┐
│  Users        [ Invite viewer ]│
├────────────────────────────────┤
│ Dana Whitfield        [Viewer] │
│ dana@example.com               │
│ Invited 2026-08-04 · Last 2d   │
│                       [Revoke] │
├────────────────────────────────┤
│ marcus@example.com   [Pending] │
│ Invited 2026-08-09             │
│                       [Revoke] │
└────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Invite action** | `Button variant="contained"` | Opens the invite dialog. Full width at `xs`, beneath the title. |
| **Table** | `Table size="small"` at `md+`; `List` at `xs`/`sm` | Not a data grid. Six accounts at most; sorting, filtering, and pagination are not built. |
| **Column headers** | `label` variant, `text.secondary` | Sentence case |
| **Name** | `body1`, `noWrap` with `title` attribute | `—` for a pending invitation that has no account yet |
| **Email** | `body1`, truncated with ellipsis at `md`, wrapped at `xs` | Full value always available via `title` and via the revoke dialog |
| **Role** | `Chip size="small" variant="outlined"` | Model accent for admin, neutral for viewer |
| **Invited** | `numericSm`, `text.secondary` | Absolute date |
| **Last active** | `numericSm`, `text.secondary` | Relative; `—` when never |
| **Pending marker** | `Chip size="small"`, warning outlined, label `Pending` | Only on rows without an accepted account |
| **Revoke** | `Button size="small" color="error" variant="text"` | Absent on the admin's own row. Opens the confirmation dialog. |

### Invite dialog

```text
┌──────────────────────────────────────────┐
│  Invite a user                        ✕  │
├──────────────────────────────────────────┤
│  Email                                   │
│  ┌────────────────────────────────────┐  │
│  └────────────────────────────────────┘  │
│                                          │
│  Role                                    │
│  ( ) Viewer   ( ) Admin                  │
│  Viewers see the shared analytical       │
│  surfaces. They cannot log decisions or  │
│  trade.                                  │
│                                          │
│                    [ Cancel ]  [ Invite ]│
└──────────────────────────────────────────┘
```

### Revoke confirmation

```text
┌──────────────────────────────────────────┐
│  Revoke access                           │
├──────────────────────────────────────────┤
│  Revoke access for dana@example.com?     │
│  They will be signed out immediately.    │
│                                          │
│                   [ Cancel ]  [ Revoke ] │
└──────────────────────────────────────────┘
```

### Code reference

```tsx
<Dialog open={confirming !== null} onClose={cancel} maxWidth="xs" fullWidth>
  <DialogTitle>Revoke access</DialogTitle>
  <DialogContent>
    <Typography variant="body1">
      Revoke access for {confirming?.email}? They will be signed out immediately.
    </Typography>
  </DialogContent>
  <DialogActions>
    <Button onClick={cancel}>Cancel</Button>
    <Button color="error" variant="contained" onClick={revoke} disabled={pending}>
      Revoke
    </Button>
  </DialogActions>
</Dialog>
```

### Fields — invite dialog

| Field | Type | Required | Default | Validation / notes |
| ----- | ---- | -------- | ------- | ------------------ |
| Email | email | yes | empty | Format validated on submit. `That address already has access.` when a live account or pending invitation exists. |
| Role | radio | yes | `Viewer` | Two options only. Viewer is the default because it is the safe one. |

### Validation

- Errors render inline in the dialog, never only in a snackbar.
- The dialog stays open on failure with the typed email preserved.
- Submit is enabled when the email field is non-empty.

### Empty state

The list is never empty — the admin's own account is always in it. There is no zero-state to design, and one should not be built speculatively.

### Loading state

Four `Skeleton` rows at final row height. The Invite button renders immediately and is enabled; inviting does not depend on the list having loaded.

### Error state

- List read failure: `Alert severity="error"` reading `Users could not be loaded.` with `Retry`, replacing the table.
- Invite failure: inline alert inside the dialog.
- Revoke failure: the dialog stays open with `Access could not be revoked. Try again.` The row is never optimistically removed — a row that vanishes from the list while the person still has access is the worst possible outcome on this screen.

### Behavior

- Successful invite closes the dialog, inserts the pending row, and shows `Invitation sent to marcus@example.com`.
- Successful revoke closes the dialog, removes the row, and shows `Access revoked for dana@example.com`.
- **Revocation takes effect immediately**, including for a user with an active session on another device. Their next request lands on `/sign-in?reason=revoked`.
- The admin cannot revoke their own access; the control is absent from that row rather than present-and-disabled.
- Rows show display name, email, role, invited date, and last active. **Never a password field, never a Kalshi credential, never anything about positions.**
- No resend, no cancel-invitation, no post-acceptance role change. Re-inviting an address whose invitation expired is a fresh invite through the same dialog.

---

## Screen 7: Settings

### Purpose

Hold appearance selection and the account basics, and give the user a place to sign out that is not buried in a menu.

### URL pattern

`/settings` — shared, both roles.

### Layout

```text
┌──────────────────────────────────────────────────────────┐
│  Settings                                                │
│                                                          │
│  Appearance                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  [ System ] [ Light ] [ Dark ]                     │  │
│  │  System follows your device setting.               │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Account                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Name     William Rhodes                           │  │
│  │  Email    wtrhodes02@gmail.com                     │  │
│  │  Role     [ Admin ]                                │  │
│  ├────────────────────────────────────────────────────┤  │
│  │  [ Sign out ]                                      │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Appearance** | `ToggleButtonGroup exclusive`, three options, full width at `xs` | Applies immediately on selection. No save button. |
| **Helper** | `caption`, `text.muted` | `System follows your device setting.` |
| **Account block** | Outlined `Paper`, label/value rows | All read-only. Name and email are not editable in this pitch. |
| **Role** | `Chip outlined size="small"` | Identical treatment to the Users table |
| **Sign out** | `Button variant="outlined"` | Not destructive-coloured. Signing out is not destructive. |

### Code reference

```tsx
<ToggleButtonGroup
  exclusive
  value={mode}
  onChange={(_, next) => next && setMode(next)}
  aria-label="Appearance"
  sx={{ width: { xs: '100%', sm: 'auto' } }}
>
  <ToggleButton value="system" sx={{ flex: 1 }}>System</ToggleButton>
  <ToggleButton value="light" sx={{ flex: 1 }}>Light</ToggleButton>
  <ToggleButton value="dark" sx={{ flex: 1 }}>Dark</ToggleButton>
</ToggleButtonGroup>
```

### Empty / loading / error states

- **Empty:** none. Every field always has a value.
- **Loading:** account values render as `Skeleton` at text width if the session read has not resolved; the appearance control renders immediately because it is client state.
- **Error:** appearance selection cannot fail. If the account read fails, the account block renders `Account details could not be loaded.` with `Retry`, and the appearance control and sign-out remain usable.

### Behavior

- Appearance applies instantly on selection, with no toast — the interface changing colour is the feedback.
- Selection persists across reloads in this browser and is applied before first paint.
- **This is the only place appearance is selectable.** No toggle in the app bar, the account menu, or anywhere else.
- Sign-out clears the session and lands on `/sign-in`.

---

## Screen 8: Access denied

### Purpose

Tell a viewer who reached an admin route that they cannot be there, without confirming what is there.

### URL pattern

Rendered in place at the requested URL — `/users`, `/health` — with a 403 status. **Not a redirect.** The URL stays honest about what was asked for, and no admin chrome renders first.

### Layout

```text
┌──────────────────────────────────────────────────────────┐
│ ◎ sightline    Slate                             [ DW ▾ ]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│         You do not have access to this page.             │
│                                                          │
│                    [ Go to slate → ]                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Component sections

| Element | MUI component / styling | Behavior |
| ------- | ----------------------- | -------- |
| **Shell** | Standard authenticated shell with the **viewer's** navigation | Two items only. The requested section does not appear. |
| **Message** | `EmptyState`, `h2` title, no detail line | One sentence. No humour, no apology, no explanation of what the page contains. |
| **Action** | `Button variant="outlined"` to `/slate` | |

### Behavior

- The copy never names the feature, its data, or who can see it. `You do not have access to this page.` — not "this is the admin decision log."
- No request-access affordance, no contact link. There is one admin and he is the person who issues invitations.
- Rendered inside the shell so the viewer has a way back without using browser navigation.

---

## Screen 9: Not found and application error

### Purpose

Fail plainly and route back.

### URL pattern

Any unmatched path (404); any uncaught error (500).

### Layout

```text
Not found                          Application error
┌──────────────────────────┐       ┌──────────────────────────┐
│  This page does not      │       │  Something went wrong.   │
│  exist.                  │       │                          │
│                          │       │  [ Try again ]           │
│  [ Go to slate → ]       │       │  [ Go to slate → ]       │
└──────────────────────────┘       └──────────────────────────┘
```

### Behavior

- Both render inside the shell when the user is authenticated, and standalone with the lockup when not.
- No illustration, no spot graphic, no error code displayed to the user, no stack trace, no request identifier.
- The application error state offers `Try again` first, because a transient failure is the common case.
- **Nothing in either state ever echoes a secret**, a token, an environment variable name, or an upstream provider message. The Kalshi signing key does not exist in this pitch and must never appear in any surface once it does.

---

## 6. Navigation flows

```text
Sign in
  └─ credentials valid ──────────────► /slate
  └─ credentials invalid ────────────► stays, inline alert, password cleared
  └─ redirected here from /users ────► on success, returns to /users
                                        └─ viewer → access denied at /users
                                        └─ admin  → users list

Invitation link
  /invite/[token]
     ├─ valid ────► set password ────► signed in ────► /slate
     ├─ expired ──► notice ──────────► /sign-in
     ├─ used ─────► notice ──────────► /sign-in
     ├─ revoked ──► notice ──────────► /sign-in
     └─ invalid ──► notice ──────────► /sign-in

Revocation, admin side
  /users → [Revoke] → confirm dialog → row removed → snackbar
                                    └─ cancel → dialog closes, nothing changes

Revocation, revoked user's side
  any request (any device, active session) ──► rejected ──► /sign-in?reason=revoked

Viewer deep-links an admin route
  GET /health ──► server role check fails ──► 403 rendered at /health
                                              inside the viewer's shell
                                              (no redirect, no admin chrome)

Appearance
  /settings → select mode → applies immediately, persists, no navigation
```

**State carried between screens.** The originally requested path survives a sign-in redirect and is returned to on success. Nothing else carries: there are no filters, no scroll positions, and no drafts in this pitch. Deep-linking works for every route; every authenticated route is directly addressable and no screen depends on having been reached from another.

---

## 7. Interaction specifications

### Keyboard navigation

| Context | Key | Action |
| ------- | --- | ------ |
| Any page | `Tab` (first press) | Focuses the skip link; `Enter` jumps to `<main>` |
| App bar nav | `Tab` / `Shift+Tab` | Moves through sections in visual order |
| App bar nav | `←` / `→` | Moves between section tabs at `md+` |
| Mobile drawer | `Esc` | Closes, focus returns to the menu button |
| Account menu | `Enter` / `Space` | Opens; `↑` / `↓` move; `Esc` closes and restores focus |
| Any dialog | `Tab` | Cycles within the dialog; focus is trapped |
| Any dialog | `Esc` | Cancels — never confirms |
| Invite / revoke dialog | `Enter` | Submits only when focus is on the submit control, never from a text field in the revoke dialog |
| Forms | `Enter` | Submits sign-in and invitation acceptance |

No single-letter shortcuts are introduced in this pitch. The `T`/`F`/`S` decision shortcuts belong to Pitch 4, where a decision control exists to bind them to.

### Loading states

| Surface | Treatment |
| ------- | --------- |
| Route transition | 2px indeterminate `LinearProgress` under the app bar, model accent |
| Users table | Four `Skeleton` rows at final row height |
| Health list | Three `Skeleton` rows at final row height |
| Settings account block | `Skeleton` at text width per value |
| Any form submit | Leading 16px spinner inside the button; the label stays |
| Slate placeholder | None — it has nothing to load |

Skeletons always match final height so nothing shifts. No spinner ever covers a whole screen, and no data animates in.

### Error states

- MUI `Alert` with `variant="outlined"` for surface-level failures; inline field errors for form-level ones.
- Copy is plain and action-oriented, and states what failed rather than that something did.
- User input is preserved on every failure in this pitch.
- Retry is offered wherever a retry could plausibly succeed, and omitted where it could not.
- An error never removes a user's access row, never consumes an invitation token, and never signs anyone out.

### Notifications

| Action | Message | Severity | Duration |
| ------ | ------- | -------- | -------- |
| Invitation sent | `Invitation sent to marcus@example.com` | success | 4s |
| Access revoked | `Access revoked for dana@example.com` | success | 4s |
| Signed out | none — landing on sign-in is the feedback | — | — |
| Appearance changed | none — the interface changing is the feedback | — | — |
| Sign-in failed | none — inline alert only | — | — |
| Invite failed | none — inline in the dialog only | — | — |

Snackbars appear bottom-centre at `xs` and bottom-left at `sm+`, and are dismissible. **No notification is ever the only place a validation error appears.**

### Destructive actions

One destructive action exists in this pitch: revoking access.

- Confirmation dialog, always. The confirm control is `color="error"`, `variant="contained"`, and is not the visually dominant element on the screen behind it.
- Copy names the person: `Revoke access for dana@example.com? They will be signed out immediately.` — never `Are you sure?`
- `Esc` and the backdrop both cancel. Only the explicit button confirms.
- No undo. Access is restored by issuing a new invitation, which is a deliberate second decision rather than a buried toast action.

Signing out is **not** treated as destructive and gets no confirmation.

---

## 8. Responsive behavior

| Breakpoint | Width | Behavior |
| ---------- | ----- | -------- |
| `xs` | 0–599 | Single column, 16px gutters. Mark only in the app bar; navigation in a temporary drawer. Users list renders as two-line list entries. Dialogs are `fullScreen`. Primary actions full-width. Forms max-width 100%. |
| `sm` | 600–899 | Single column, 24px gutters. Lockup returns to the app bar. Navigation still in the drawer. Users still a list. Dialogs return to centred `maxWidth="xs"`. |
| `md` | 900–1199 | Section nav becomes inline tabs in the app bar; the drawer and menu button disappear. Users becomes a table. 32px gutters. |
| `lg` | 1200–1535 | Full users table with no column truncation at typical values. |
| `xl` | 1536+ | Content max-width 1280px, centred. The shell does not stretch to arbitrary width. |

**Nothing horizontally scrolls at any breakpoint**, including the users table — which becomes a list rather than gaining a scroll container.

### Overflow and long values

The Definition of Done requires that long names, long emails, validation messages, and role labels do not break the shell. Specifically:

| Value | Treatment |
| ----- | --------- |
| Display name | Single line, ellipsis, full value in `title`. Never wraps a table row to two lines at `md+`. |
| Email address | Ellipsis at `md+`; wraps at `xs` with `overflow-wrap: anywhere` so a long local part cannot force horizontal scroll. The full address always appears un-truncated in the revoke dialog, so the confirmation is unambiguous. |
| Account menu | Name and email both truncate; the menu has a fixed max-width of 280px. |
| Role chip | Fixed labels, `Admin` and `Viewer`. Never truncated; the column is sized to the longer of the two. |
| Validation messages | Wrap freely beneath their field. Never truncated, never in a tooltip. |
| Health timestamps | Fixed-format and fixed-width by construction, which is what tabular figures buy. |

Every action available at `md+` is available at `xs`. Nothing is desktop-only in this pitch.

---

## 9. Component inventory

| Component | Location | New / reused | Notes |
| --------- | -------- | ------------ | ----- |
| `SightlineLockup` | App bar, sign-in, invitation | new | Inlined SVG so `currentColor` resolves. Height-driven; never restyled. |
| `SightlineMark` | App bar at `xs`, favicon parity | new | Mark alone. No wordmark added. |
| `AppShell` | All authenticated routes | new | App bar, nav, drawer, account menu, content region, skip link |
| `NavSections` | `AppShell` | new | Role-filtered section list. Single source for both tabs and drawer. |
| `AccountMenu` | `AppShell` | new | Name, email, role chip, Settings, Sign out. **No appearance control.** |
| `EmptyState` | Slate, access denied, 404, 500, invitation failures | new | Title, optional detail, optional action. **The most reused component from this pitch** — every later surface's empty state is built on it. |
| `RoleChip` | Users, Settings, invitation acceptance | new | Two variants, admin and viewer |
| `StatusChip` | Users (pending), Health (five states) | new | Generic small outlined/filled chip with text label plus optional icon. Never colour-only. |
| `NumericText` | Health, Users | new | Wraps the mono variants with `tabular-nums`. **Every number in the product goes through this** from Pitch 4 onward. |
| `ConfirmDialog` | Revoke | new | Title, body naming the subject, cancel and confirm. Reused by Pitch 11's order confirmation shape, not its content. |
| `InviteDialog` | Users | new | Email plus role radio |
| `AppearanceControl` | Settings | new | Three-option toggle group |
| `SignInForm` | Sign in | new | |
| `AcceptInvitationForm` | Invitation | new | |
| `HealthSignalRow` | Health | new | Label, state chip, last-success timestamp. Grows expected-window and last-attempt fields in Pitch 5. |

Not built in this pitch, and deliberately: no `DataGrid`, no generic table abstraction, no layout primitive library, no design-system package. Six accounts and three health rows do not justify any of them, and the pitch's No-Go list rules out a design system built for products that do not exist.

---

## 10. Accessibility, privacy, and data sensitivity

### Accessibility

- All interactive controls have accessible names, including the icon-only menu button and the account avatar button.
- **No state relies on colour alone.** Every health state, every role, and the pending marker carry a text label; `failed` and `late` carry an icon in addition to the amber tone.
- Form fields have visible labels — never placeholder-only — plus helper or error text associated by `aria-describedby`.
- Errors are announced when they appear: surface alerts use `role="alert"`, and focus moves to the sign-in failure alert.
- Dialogs trap focus while open and return focus to the trigger on close.
- The drawer is a modal dialog for assistive technology and behaves like one.
- The skip link is the first tabbable element on every page.
- The selected navigation item carries `aria-current="page"`; selection is signalled by the underline and text colour together, not colour alone.
- Contrast: all text/background pairs in both modes meet WCAG AA at their rendered size. The mint token split exists specifically to keep light-mode market values above the threshold.
- No charts exist in this pitch, so the text-equivalent requirement does not yet apply. It applies from Pitch 6.

### Privacy and data sensitivity

- **A viewer must never see, and must never be able to infer, the existence of the admin's private layer.** In this pitch that means: Health and Users are absent from viewer navigation, absent from any route listing, and rejected server-side. They are not rendered disabled, blurred, or locked.
- Admin-only routes are rejected on the server before any admin chrome renders. There is no partial shell followed by a client-side correction.
- The users list shows display name, email, role, invited date, and last active — and nothing else. No password field, no credential of any kind, no session detail, no IP address, no device list.
- **Nothing on any surface implies a viewer can trade through Sightline.** No order controls, no "connect your Kalshi account" affordance, no credential field anywhere in the shell or in Settings. Sightline does not custody another person's signing credentials and the interface must not suggest it might.
- The Kalshi signing key must never appear in any surface, including Settings, Health, or an error message. Nothing in this pitch reads it.
- Invitation tokens appear only in the URL. They are never rendered in copy, in a title, in an error message, or in a log line surfaced to the interface.
- The revoked-access notice states that access was removed and nothing about why or by whom.
- Open-Meteo attribution is not required in this pitch — no weather data is displayed. It becomes a requirement on the first surface that shows it.

---

## 11. Out of scope

### Deferred to a later pitch

- The slate list, contract detail, projections, prices, edges, recommendations, drivers, distribution summary, and the take/fade/skip control — **Pitch 4**.
- Staleness disclosure, scheduled ingest, recompute, price-refresh jobs, the keepalive workflow, and populated health signals — **Pitch 5**.
- Outcome grading, the reliability curve, Brier score, baselines, override performance, and timing cost — **Pitch 6**.
- Bankroll, sizing, ledgers, dry run, and paper trading surfaces — **Pitch 7**.
- Circuit-breaker state display and the paper-to-live gate — **Pitch 8**.
- Adjustment suggestions and suggestion reliability analytics — **Pitch 10**.
- Order entry, confirmation, fills, and reconciliation — **Pitch 11**.
- Backtest run list and detail — a shared surface with no pitch-3 route; it enters navigation with the pitch that builds it.
- Chart theming and the Recharts wrapper — no chart exists yet. The tokens charts will read are defined here.
- Password reset, if it is ever specified. See Open Question 3.
- Editing display name or email.
- Appearance selection following the user across devices.

### Permanent non-goals

- Public signup, self-service account creation, subscriptions, pricing pages, public profiles, and any acquisition surface.
- Social or OAuth sign-in, and magic links.
- Any viewer trading affordance, viewer credential field, or viewer position surface. View-only means view-only.
- Sportsbook and DFS integration of any kind.
- Organizations, workspaces, teams, tenants, or any multi-tenancy concept.
- Roles beyond admin and viewer, and any general-purpose permission framework.
- A second styling system — no utility CSS, no styled-components, no CSS modules, no hand-authored stylesheets, no second component library.
- Native applications, offline support, push notifications, and in-app messaging.
- An operations console: logs, feature flags, job triggers, database tools, deployment controls.
- Illustration, photography, spot graphics, and empty-state artwork.

---

## 12. Open questions

**1. Which shell states need PRD acceptance criteria?** (Pitch Open Question 2.) The PRD lists empty states as an edge case for Brand and Responsive Interface, while the roadmap treats designed empty states as part of this pitch's Definition of Done. This document designs the states — slate-not-available, four invitation failures, revoked access, access denied, not found, application error, and five health states — but their observable completion conditions do not yet trace to PRD acceptance criteria. The PRD should name them before the spec treats them as traceable.

**2. Carrying deferred responsive criteria to Pitch 4.** (Pitch Open Question 3.) Three Brand and Responsive Interface acceptance criteria — the slate being scannable on a phone, dense numerics readable at a glance, and the slate rendering without waiting on a model run — cannot be demonstrated by this pitch. This document establishes the primitives that support them (`NumericText`, the mono variants, tabular figures, the breakpoint model, the no-spinner rule). The criteria themselves should be explicitly carried into Pitch 4 rather than counted as met because a theme exists.

**3. There is no password-recovery path.** A user who forgets their password has no route back in: no reset flow exists, and the approved docs do not specify one. The implicit recovery is that William revokes and re-invites, which works but is undocumented and unstated in the interface. Either that is accepted and this document's decision to omit a "forgot password" link stands, or password reset needs a pitch. It should not be added quietly during implementation.

**4. Typography — RESOLVED.** Space Grotesk replaced IBM Plex on 2026-08-01, as one variable WOFF2 file serving interface text and numerics alike. The former open item about TTF-versus-WOFF2 is closed by the same change. The consequence to carry forward: the new face has proportional default figures, so `tabular-nums` is now the sole mechanism keeping numeric columns aligned.

**5. Invitation email delivery is a dependency, not a design.** The pitch lists email delivery as a dependency but no provider is chosen and no template is designed. The invitation email is the only surface in this pitch that renders outside the application, and it is where the fixed-colour lockups are used. Whether its design belongs in this pitch or in the spec needs deciding.

**6. Session lifetime.** The Definition of Done requires sessions to persist across devices "during ordinary continued use," and revocation to be immediate. Those two pull in opposite directions: a long-lived session is what makes revocation hard to enforce promptly. The design assumes every protected request independently verifies the session server-side, which resolves it — but the concrete lifetime and refresh posture is a Supabase configuration decision the spec must make explicit rather than inherit from defaults.
