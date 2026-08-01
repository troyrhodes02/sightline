-- Constructs Prisma cannot express, replacing the invite-era constraints.
--
-- Split from the previous migration deliberately: Postgres refuses to use an
-- enum value inside the same transaction that added it, and these constraints
-- reference 'pending' and 'denied'.

-- The invite-era constraint knew only 'active' and 'revoked', so it would
-- reject every pending signup. Replaced rather than amended.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_revocation_consistent";

-- Status and its timestamps must agree. Without this, `status` and the
-- decision columns can drift apart, and every surface that reads one while
-- trusting the other silently reports the wrong thing.
--
--   pending → not yet decided, so no decision fields and no revocation
--   active  → decided, still holding access
--   denied  → decided, never held access
--   revoked → decided, held access, then lost it
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
