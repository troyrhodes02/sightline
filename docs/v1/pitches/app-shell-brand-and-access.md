# Sightline — Pitch: App Shell, Brand & Access

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


## Summary

This pitch delivers the branded, responsive, invite-only application shell that every later Sightline capability will inhabit. Authenticated users can accept invitations, sign in across devices, navigate the application according to their role, and encounter deliberate loading, empty, unavailable, and access-denied states rather than unfinished scaffolding.

When this pitch ships, Sightline will not yet display projections, contracts, recommendations, or bankroll information. It will provide the visual system, access model, responsive structure, and operational container necessary for those surfaces to be built once, consistently, rather than assembled in stock Material UI and redesigned after the product already has momentum.

## Type & Appetite

* **Type:** Foundational
* **Appetite:** M — The pitch contains no modelling or market-data work, but it combines a comprehensive design system, responsive application shell, invite lifecycle, persistent authentication, server-enforced authorization, administrative access management, navigation behavior, and reusable application states. Those pieces interact across every future surface, making this more than a small styling or login task while remaining bounded enough to avoid becoming a general application-platform project.

## Problem

Sightline’s core job is to tell William which Kalshi NFL player contracts are mispriced, how much to trust that judgment, and how much to stake. Delivering that job requires more than calculating a number: William must be able to open the product on a phone before kickoff, quickly understand what he is seeing, trust that private information is actually private, and return often enough for the product to accumulate a meaningful record.

Without a deliberate shell established first, each later feature would make its own decisions about spacing, typography, navigation, responsive behavior, permissions, empty states, and administrative access. The likely result would be an application that technically functions but feels inconsistent, leaks implementation details, handles small screens poorly, and relies on hidden navigation items rather than real authorization.

The secondary audience creates an additional boundary. Invited viewers must eventually see shared projections, prices, edges, recommendations, drivers, and staleness, while remaining completely outside William’s decisions, positions, bankroll, sizing, trading, and private analytics. That separation must exist before those private surfaces are introduced, not be retrofitted after data has already been exposed.

This pitch therefore solves the foundational access and usability problem: establish one trusted application container, one visual language, and one enforceable role model before substantial product surfaces are built.

## Solution Shape

Sightline ships as a closed, authenticated web application with no public account-creation path. William can invite viewers, invited users can complete onboarding and establish credentials, authenticated sessions persist across devices, and William can revoke access with immediate effect.

The application recognizes two roles:

* **Admin:** William, with access to administrative controls and, in later pitches, all private product surfaces.
* **Viewer:** Invited friends, with access only to authenticated shared-read surfaces introduced by later pitches.

Authorization is behavioral rather than cosmetic. Navigation reflects the user’s role, but hiding an item is not treated as enforcement. Protected reads, writes, routes, and administrative actions reject unauthorized access on the server according to the authentication and authorization decisions in the Architecture Doc.

The shell provides a stable responsive frame for future product surfaces:

* A consistent application header and navigation model.
* A clear current-location and selected-section state.
* Phone, tablet, and desktop behavior without horizontal page scrolling.
* Designed states for loading, no available content, unavailable integrations, expired or invalid invitations, revoked access, and unauthorized routes.
* A stable place for account controls, role-aware navigation, application status, and administrative access management.
* A route and layout structure into which the slate, accuracy, bankroll, and later operational surfaces can be added without replacing the shell.

A comprehensive Material UI theme is a named output of this pitch. It governs palette, typography, spacing, shape, elevation, interaction states, and component-level presentation. Future surfaces are expected to use the theme rather than introducing inline visual exceptions or parallel styling systems.

The visual direction should support the product’s actual context: dense probabilistic information read quickly before kickoff. Pitch 3 establishes the typography, spacing, hierarchy, number treatment, status language, and responsive primitives that later surfaces will use, but it does not invent or build the slate’s contract-row design before the slate exists.

The shell also includes the health-read location named in the Pitch Roadmap. Its purpose is to make the freshness of Sightline’s operating systems visible inside the application rather than requiring log inspection. Because the ingest, live recompute, and price-refresh processes are introduced in later pitches, this pitch establishes the health surface and its honest unavailable or not-yet-running states. Ownership of the final success criteria for populated health timestamps remains an open sequencing question.

The solution follows the application, identity, styling, and authorization decisions already established in the Architecture Doc. This pitch does not redesign those technical choices or specify their schemas, route contracts, or component structure.

## In Scope

* **Authentication and Invite** — Invite-only account creation, invitation acceptance, persistent authenticated sessions, admin and viewer roles, server-enforced authorization, administrative invitation management, and immediate access revocation.
* **Brand and Responsive Interface** — Sightline’s visual identity, comprehensive Material UI theme, responsive application shell, role-aware navigation, reusable interface states, and shell-level behavior across phone, tablet, and desktop widths.

The following roadmap deliverables are treated as parts of those two PRD features rather than as separately renamed features:

* The Material UI theme is the principal design-system deliverable within **Brand and Responsive Interface**.
* Navigation is part of the responsive application shell.
* Empty, unavailable, access-denied, and related interface states are part of the shell’s completeness.
* The health read is included because the Pitch Roadmap assigns it to this pitch, although its PRD acceptance-criterion coverage and final completion ownership require clarification.

## Out of Scope / Boundaries

* Every product-data surface is excluded. There is no live slate, contract list, contract detail view, projection display, recommendation display, decision log, accuracy chart, bankroll view, position list, sizing history, or trading interface in this pitch.
* Kalshi discovery, price refresh, contract resolution, recommendation calculation, and decision logging belong to **Pitch 4: Kalshi Sync, The Slate & Decision Log**.
* Scheduled ingest, scheduled recomputation, staleness evaluation, scheduler keepalive, and operational freshness alerting belong to **Pitch 5: Live Pipeline & Staleness**.
* Outcome grading, reliability curves, Brier scores, baseline comparison, override performance, and timing cost belong to **Pitch 6: Outcome Scoring & Accuracy Surface**.
* Recalibration, ledgers, bankroll state, position sizing, and dry-run intents belong to **Pitch 7: Bankroll, Sizing & Paper Trading**.
* Autonomous execution, circuit-breaker operation, withdrawal notifications, and the paper-to-live gate belong to **Pitch 8: Autonomous Execution & Circuit Breakers**.
* Live order placement and Kalshi position reconciliation belong to the later live-trading pitch.
* The shell may reserve navigation or layout space for later capabilities, but it must not build nonfunctional preview pages that imply those capabilities already exist.
* Public signup, subscriptions, public profiles, commercial onboarding, and self-service account creation are permanently excluded by the Product Brief.
* Viewer trading credentials, viewer positions, and any viewer trading flow are permanently excluded.
* Multi-tenancy is excluded. Shared projections, prices, contracts, recommendations, and reference data will not be partitioned into separate user-owned copies.
* A general-purpose permission framework is excluded. The product has two known roles and a known shared-versus-private access split.
* A second styling system is excluded. There is no utility-CSS framework, hand-authored global component stylesheet, or growing collection of inline one-off visual rules alongside Material UI.
* Native mobile applications and offline support are excluded. This remains a responsive, online-only web application.
* Final slate information-density decisions are excluded until real contract volume is observed and the slate is designed in Pitch 4.

## Definition of Done

* Public signup is unavailable through both the interface and direct access paths; a user account can begin only through an admin-issued invitation.
* William can issue an invitation to an email address, and the recipient can use a valid invitation to establish credentials and enter the authenticated application.
* Expired, invalid, or previously used invitations do not create access and produce a deliberate explanatory state rather than a generic application failure.
* Admin and viewer roles exist and are independently enforced by server-side authorization.
* A viewer attempting to access an admin-only route or operation included in this pitch is rejected by the server, even when navigating directly rather than through the visible interface.
* William can revoke an invited user, and the revoked user loses access immediately, including when an authenticated session was already active.
* Authenticated sessions persist across devices without forcing a new login during ordinary continued use.
* Every shell surface shipped in this pitch is usable at supported phone, tablet, and desktop widths without horizontal page scrolling.
* The application’s navigation remains understandable and operable at each supported width, including when the user is signed out, signed in as a viewer, or signed in as the admin.
* A defined Material UI design system governs color, typography, spacing, shape, elevation, interaction states, and component presentation.
* Every interface shipped in this pitch uses that design system rather than bypassing it with isolated visual rules.
* The sign-in, invitation, access-denied, revoked-access, administrative access-management, and application-shell experiences present a coherent Sightline identity rather than default framework styling.
* Long names, long email addresses, validation messages, and role labels do not break the shell at supported widths.
* Future authenticated sections can be added to the established application frame without replacing the authentication flow, role model, navigation model, or design system.

The Pitch Roadmap also expects designed empty states and a health read exposing the latest successful ingest, recompute, and price refresh. Empty-state treatment is retained in this pitch’s solution shape, and the health surface is retained in scope, but both need explicit PRD-level acceptance criteria before their final observable conditions can be treated as fully traceable Definition-of-Done requirements.

## Rabbit Holes

* **Provider defaults accidentally restoring public signup.** Disabling a visible signup button is insufficient if the underlying authentication provider still accepts direct public registrations.
* **Authorization implemented only through navigation.** A viewer must not gain access by entering an admin URL, calling an operation directly, or reusing a previously rendered page.
* **Revocation delayed by session caching.** “Immediate” revocation becomes meaningless if a revoked user remains authorized until a long-lived session expires or a stale page is refreshed.
* **Invitation lifecycle ambiguity.** Expired links, reused links, already-existing accounts, duplicate invitations, and revoked invitations can each produce confusing or unsafe behavior if the lifecycle is not deliberately shaped.
* **Treating shared product data as tenant-owned data.** The two-role model can easily be buried under unnecessary organization, workspace, and row-ownership abstractions that provide no product value.
* **Designing the full product before its data surfaces exist.** Pitch 3 should establish reusable visual foundations, not fabricate every future card, chart, table, and detail view from imaginary content.
* **Under-designing numeric hierarchy.** The final slate will display probability, price, edge, confidence, timestamps, and statuses together. The theme must anticipate dense numeric reading without prematurely deciding the exact Pitch 4 layout.
* **Responsive navigation becoming its own product.** The application needs clear navigation for a small, known set of sections, not a configurable portal framework with nested workspaces and arbitrary information architecture.
* **Brand work proceeding before name clearance.** The Product Brief identifies “Sightline” domain and trademark availability as unverified. Permanent logos and public-facing brand assets could create avoidable rework if that remains unresolved.
* **Health states pretending downstream systems exist.** Before the live pipeline and Kalshi refresh jobs ship, the health surface must distinguish “not yet implemented,” “never run,” “not expected,” and “failed” rather than presenting false outages or false success.
* **Empty states becoming feature previews.** An empty shell should explain that a section has no available data or has not shipped; it should not impersonate completed projection or market functionality.
* **Broadening “admin” into a full operations console.** The pitch needs invitation and access management, not a generic dashboard for logs, jobs, feature flags, database tools, and deployment controls.
* **Conflating authentication with personal data partitioning.** Authentication establishes who may enter; it does not imply that every shared row must be copied or filtered per user.
* **Unclear role boundaries for future accuracy data.** The PRD leaves model-calibration visibility to viewers unresolved. Pitch 3 should preserve the ability to assign that future surface deliberately without pre-deciding it through an overly rigid navigation structure.

## No-Gos

* Do not build substantial screens in default Material UI and promise to theme them later.
* Do not add Tailwind, another utility-CSS system, or a parallel component library.
* Do not create a generic design-system package intended for unrelated products.
* Do not introduce organization, workspace, team, tenant, or subscription concepts.
* Do not create more roles than admin and viewer.
* Do not permit public account creation, even as a temporary development shortcut in a production-connected environment.
* Do not rely on hidden buttons or navigation items as the authorization boundary.
* Do not store or accept Kalshi credentials for any viewer.
* Do not build mock slate, bankroll, accuracy, or trading functionality merely to make the shell appear populated.
* Do not create fake health success timestamps for jobs that do not yet exist.
* Do not turn the health read into a full monitoring platform.
* Do not optimize the shell for imagined public scale; the known audience is William and a small invited group.
* Do not introduce offline support, native-app scaffolding, push-notification infrastructure, or in-app messaging.
* Do not finalize detailed contract-row density before Pitch 4 observes and designs against real slate volume.
* Do not make permanent, expensive brand assets until the Sightline name question is resolved or consciously accepted.

## Dependencies

* No prior pitch is a technical dependency. The Pitch Roadmap deliberately sequences this pitch after the merged corpus and backtest work, but the application shell does not require those systems to function.
* This pitch must ship before **Pitch 4: Kalshi Sync, The Slate & Decision Log** under the preferred roadmap sequence, so the first substantial user-facing surface is built inside the established design system rather than retrofitted later.
* The Supabase authentication environment must be provisioned and configured for invite-only use, with public signup disabled.
* The Next.js application and Material UI foundation identified in the Architecture Doc must be available as the application runtime and component system.
* Email delivery required for invitations must be configured sufficiently for an invited user to complete onboarding.
* Production and development environments must have distinct, documented authentication configuration so development shortcuts do not expose public signup or weaken production role enforcement.
* Final permanent brand assets depend on resolving or consciously accepting the Product Brief’s open question regarding the availability of the “Sightline” name.

## Open Questions

### 1. Where does final ownership of the health read belong?

The Pitch Roadmap places the health read in Pitch 3 and defines completion as exposing the last successful ingest, recompute, and price refresh. Those processes do not all exist until Pitches 4 and 5, and the PRD does not currently define the health read as a feature with acceptance criteria.

The roadmap and PRD should be reconciled before the design document. Reasonable shapes include:

* Pitch 3 builds the health surface and honest not-yet-available states, while Pitches 4 and 5 populate and complete their respective signals.
* The entire health-read completion requirement moves to Pitch 5, while Pitch 3 provides only a reserved application-status location.
* Health becomes an explicitly named cross-pitch capability with acceptance criteria owned incrementally.

Until that is decided, Pitch 3 must not claim that downstream job freshness is fully operational.

### 2. Which roadmap empty-state requirements need PRD acceptance criteria?

The PRD lists empty states as an edge case for **Brand and Responsive Interface**, while the Pitch Roadmap treats designed empty states as part of Pitch 3’s Definition of Done. Because the expansion rules require Definition-of-Done conditions to trace to PRD acceptance criteria, the PRD should explicitly state which shell states must exist and what observable behavior constitutes completion.

At minimum, the gap covers no-content, invalid-invitation, expired-invitation, revoked-access, unauthorized-route, unavailable-health-signal, and future-section-not-yet-available states.

### 3. How are deferred responsive criteria carried forward?

Several **Brand and Responsive Interface** acceptance criteria concern surfaces that Pitch 3 deliberately does not build:

* The slate must be scannable on a phone without opening details.
* Dense probability, price, edge, and confidence information must be readable at a glance.
* The slate must render without waiting on a model run.

Pitch 3 can establish the responsive and visual primitives that support those criteria, but it cannot honestly demonstrate them. The roadmap or downstream pitches should explicitly carry those criteria into Pitch 4 rather than allowing them to appear completed merely because the theme exists.

### 4. Is the Sightline name cleared for permanent brand work?

The Product Brief identifies domain and trademark availability as unverified. The design document needs one of two explicit instructions:

* The name is approved for permanent brand assets.
* The pitch should establish a replaceable visual system while deferring expensive or difficult-to-change naming assets.

This does not block authentication or shell construction, but it affects how much durable identity work belongs inside the pitch.

### 5. Who can view operational health?

The roadmap includes the health read but does not specify whether it is visible to both authenticated roles or only to the admin. General projection freshness is relevant to viewers, while job-level operational status may belong to William’s private operator layer. The access rule should be settled before the health surface is designed.

### 6. What is the minimum invitation-management surface?

The PRD requires that William invite users and revoke access, but it does not state whether Pitch 3 must include invitation history, pending status, resend behavior, cancellation, expiration visibility, or role changes after acceptance. The design document should choose the smallest surface that satisfies invitation creation, current-access visibility, and immediate revocation without turning account administration into a larger product.
