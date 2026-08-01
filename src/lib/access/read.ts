import "server-only";

import { prisma } from "@/lib/prisma";
import type { AccessRowDto } from "@/lib/dto/access";

/**
 * Reads current access: everyone who has an account, plus everyone who has been
 * invited and has not yet accepted.
 *
 * Two queries rather than one, because they are genuinely two things — an
 * account and a promise of one. Merging them in SQL would need a union with
 * null-padded columns and would still produce the same shape.
 *
 * Order is deterministic: **self first**, then accepted users by acceptance,
 * then pending invitations by issue. Deterministic because a list that
 * reorders between renders is a list nobody trusts, and William's own row being
 * first is the one that never has a revoke control.
 */
export async function readAccessRows(
  currentUserId: string,
): Promise<AccessRowDto[]> {
  const [users, pending] = await Promise.all([
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: { acceptedAt: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        invitedAt: true,
        lastActiveAt: true,
      },
    }),
    prisma.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    }),
  ]);

  const accepted: AccessRowDto[] = users.map((user) => ({
    id: user.id,
    kind: "user",
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    invitedAt: user.invitedAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    pending: false,
    isSelf: user.id === currentUserId,
  }));

  const invited: AccessRowDto[] = pending.map((invitation) => ({
    id: invitation.id,
    kind: "invitation",
    displayName: invitation.displayName,
    email: invitation.email,
    role: invitation.role,
    invitedAt: invitation.createdAt.toISOString(),
    lastActiveAt: null,
    pending: true,
    isSelf: false,
  }));

  const self = accepted.filter((row) => row.isSelf);
  const others = accepted.filter((row) => !row.isSelf);

  return [...self, ...others, ...invited];
}
