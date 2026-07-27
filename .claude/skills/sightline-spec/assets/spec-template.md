---
version: 1.0.0
status: draft
author: [Your Name]
last_updated: YYYY-MM-DD
pitch_reference: [Link or filename to the expanded pitch]
design_reference: [Link or filename to the design doc, or "n/a — no user-facing surface"]
prd_reference: docs/planning/prd.md
architecture_reference: docs/planning/architecture.md
linear_issue: [SIGHT-###, omit if none yet]
---

# [Feature Name]

## Summary

[Two to three paragraphs: what the feature does in one sentence, the core technical
abstraction, how it fits Sightline's workflow, and what "working" means from an
implementation perspective. Name the abstraction rather than restating the feature list.]

---

## Problem

[What the system cannot answer today, why it blocks downstream work, which PRD journey
it supports, which pitch it unlocks or depends on.]

---

## Scope and Non-Scope

### In Scope

- [Behavior this spec covers]

### Out of Scope

- [Deferred or excluded behavior, marked Post-MVP or permanent non-goal]
- [Adjacent feature that tempts creep, named explicitly]

---

## Core Concepts

| Concept | Description |
| ------- | ----------- |
| `[concept]` | [description, including ownership, cardinality, derived vs. persisted] |

**Distinctions to preserve:**

- [Concept A vs. Concept B, and why they must not collapse]

**Ownership:**

- [Which entities carry `userId`, and which are shared reference data]

---

## States and Lifecycle

### [Enum name]

```prisma
enum [EnumName] {
  [value]
  [value]
}
```

### State Transition Rules

| From | To | Allowed? | Side Effects |
| ---- | -- | -------- | ------------ |
| `[state]` | `[state]` | [yes/no/conditional] | [writes that must happen together] |

**Terminal states:** [what they are and how they affect active views]

---

## UI Integration

> Reference the design doc for detailed UI/UX specifications.
> Omit this entire section for pitches with no user-facing surface.

### Screens

| Screen | Purpose | Data Needed | Actions |
| ------ | ------- | ----------- | ------- |
| [screen] | [purpose] | [data] | [actions] |

### Components

| Component | Data Contract | Notes |
| --------- | ------------- | ----- |
| `[Component]` | [contract] | [note] |

### Forms and Validation

| Field | Type | Required | Validation | Notes |
| ----- | ---- | -------- | ---------- | ----- |
| `[field]` | [type] | [yes/no] | [rule] | [note] |

### Material UI Integration

- [Component choice, variants, disabled/loading states, dialog behavior, theme token
  usage, responsive behavior — only where it materially affects implementation]

---

## Data Model

### Relationship to Existing Schema

| From | Relation | To | Description |
| ---- | -------- | -- | ----------- |
| `[from]` | [relation] | `[to]` | [description] |

### New Models

```prisma
model [ModelName] {
  id        String   @id @default(uuid())
  [field]   [Type]   @map("[snake_case]")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([field])
  @@map("[snake_case_plural]")
}
```

### Updated Models

```prisma
// Add to existing [Model]:
[new or changed fields only]
```

### Enums

```prisma
enum [EnumName] {
  [value]
}
```

### Raw SQL Constructs

> RLS policies, partial and expression indexes, and check constraints only.
> Prisma does not manage these. Omit this section if the feature adds none.

```sql
[migration statements]
```

### Derived Fields

| Field / Concept | Stored? | Computed From | Notes |
| --------------- | ------- | ------------- | ----- |
| `[field]` | [yes/no] | [inputs] | [note; storing requires a stated reason] |

---

## Authorization and Access Control

[How enforcement applies to the entities in this spec. Two roles, admin and viewer.
Shared reference data is not user-partitioned; only `Decision` and `Position` are.]

```typescript
[Route handler guard example — session-resolved identity, server-side role check]
```

| Resource | Read | Create | Update | Delete |
| -------- | ---- | ------ | ------ | ------ |
| `[resource]` | [rule] | [rule] | [rule] | [rule] |

---

## Route Handlers and API Surface

> See `references/api-conventions.md` for naming, error codes, filtering, and idempotency.

### Route Handlers

```http
[METHOD] [path]
```

**Authentication:** [requirement]
**Authorization:** [role requirement]
**Request:** [shape, if applicable]
**Response:** [shape, if applicable]
**Side Effects:** [if applicable]
**Error Responses:** [if non-standard]

| Operation | Input | Output | Side Effects |
| --------- | ----- | ------ | ------------ |
| `[operation]` | [input] | [output] | [side effects] |

### Types

```typescript
[Input and output type definitions]
```

### Error Response Format

| Code | HTTP Status | Description |
| ---- | ----------- | ----------- |
| `[code]` | [status] | [description] |

---

## Validation Rules

| Field | Validation | Warn or Block | Error |
| ----- | ---------- | ------------- | ----- |
| `[field]` | [rule] | [warn/block] | `[error code]` |

---

## UI Data Contracts

> Omit this section for pitches with no user-facing surface.

```typescript
[DTO definitions, with null-vs-zero states distinguished explicitly]
```

---

## Testing Strategy

> See `references/testing-patterns.md` for category definitions, templates, and factories.
> Priority order is fixed by `CLAUDE.md` → Testing. Do not reorder it here.

### 1. [Feature Area]

```text
TEST: [descriptive_snake_case_name]
GIVEN:
  - [precondition]
WHEN:
  - [action]
THEN:
  - [expected outcome]
  - [side effect]
```

### 2. Invariant Tests

```text
TEST: [invariant_name]
GIVEN: Any system state
THEN: [property that must hold]
QUERY: [verification query]
EXPECT: [expected result]
```

### 3. Integration Scenarios

```text
TEST: [lifecycle_scenario_name]
SCENARIO: [description]

STEP 1: [action]
VERIFY:
  - [expected state]

STEP 2: [action]
VERIFY:
  - [expected state]
```

### Test Data Factories

```typescript
[Factory function using real entity and field names]
```

```python
[Factory function for the Python side, where the feature touches it]
```

---

## Acceptance Criteria

1. **[Feature Area]**
   - [ ] [Observable, testable criterion]
   - [ ] [Criterion]

2. **[Feature Area]**
   - [ ] [Criterion]

---

## Explicit Non-Goals

**Permanent:**

- ❌ [Permanent non-goal touched by this feature]

**Deferred:**

- ❌ [Deferred work this spec must not pull in — do not preclude it]

---

## Open Questions

1. **[Topic]** — [unresolved decision; mark blocking, or state the default assumption]

---

## Future Considerations

- **[Future feature]** can build on [what this spec establishes].
