/*
  Warnings:

  - You are about to drop the column `accepted_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `invited_at` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `invitations` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'pending';
ALTER TYPE "UserStatus" ADD VALUE 'denied';

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_accepted_user_id_fkey";

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_invited_by_id_fkey";

-- DropIndex
DROP INDEX "users_status_accepted_at_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "accepted_at",
DROP COLUMN "invited_at",
ADD COLUMN     "decided_at" TIMESTAMP(3),
ADD COLUMN     "decided_by_id" TEXT,
ADD COLUMN     "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "role" SET DEFAULT 'viewer',
ALTER COLUMN "status" SET DEFAULT 'pending';

-- DropTable
DROP TABLE "invitations";

-- CreateIndex
CREATE INDEX "users_status_requested_at_idx" ON "users"("status", "requested_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
