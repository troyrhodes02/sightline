-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'viewer');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'revoked');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "invited_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "last_active_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "display_name" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "invited_by_id" TEXT NOT NULL,
    "accepted_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_accepted_at_idx" ON "users"("status", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_accepted_user_id_key" ON "invitations"("accepted_user_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_invited_by_id_idx" ON "invitations"("invited_by_id");

-- CreateIndex
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constructs Prisma cannot express. Hand-authored, as with the temporal check
-- constraints in the corpus migrations.
-- ---------------------------------------------------------------------------

-- At most one PENDING (unaccepted, unrevoked) invitation per address,
-- case-insensitively. Historical rows for the same address are retained, so a
-- plain unique index would be wrong. An expired-but-unaccepted row still holds
-- the slot on purpose: the admin issues a fresh invitation, and the stale one
-- is revoked as part of that rather than accumulating unnoticed.
CREATE UNIQUE INDEX "invitations_one_pending_per_email"
  ON "invitations" (lower("email"))
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- A revoked user must carry its revocation time, and an active one must not.
-- Without this, `status` and `revoked_at` can disagree, and every surface that
-- reads one while trusting the other silently reports the wrong thing.
ALTER TABLE "users"
  ADD CONSTRAINT "users_revocation_consistent" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    OR ("status" = 'active' AND "revoked_at" IS NULL)
  );

-- An accepted invitation must point at the account it produced. The pair is
-- written in one transaction; this is what makes a half-written pair
-- impossible rather than merely unlikely.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_acceptance_consistent" CHECK (
    ("accepted_at" IS NULL AND "accepted_user_id" IS NULL)
    OR ("accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL)
  );

-- An invitation cannot be both accepted and revoked. Revocation of an accepted
-- invitation is expressed on the USER row, not here.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_not_both" CHECK (
    "accepted_at" IS NULL OR "revoked_at" IS NULL
  );
