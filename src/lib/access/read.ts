import "server-only";

import { prisma } from "@/lib/prisma";
import type { AccessRowDto } from "@/lib/dto/access";

/**
 * Reads everyone the admin can act on, split into two groups.
 *
 * `pending` is a **queue**, not a list of users — a row there is a request that
 * has been granted nothing. Keeping it separate from the roster is the point of
 * the screen: the admin's job here is to empty that queue.
 *
 * Denied and revoked accounts are deliberately excluded. They are terminal, no
 * action remains, and listing them would turn an actionable screen into an
 * audit log nobody asked for.
 *
 * Order is deterministic. Requests are **oldest first**, because a queue that
 * reorders is one people lose their place in. The roster puts the acting admin
 * first, then everyone else in the order they were approved.
 */
export async function readAccess(currentUserId: string): Promise<{
  pending: AccessRowDto[];
  members: AccessRowDto[];
}> {
  const select = {
    id: true,
    email: true,
    displayName: true,
    role: true,
    status: true,
    requestedAt: true,
    lastActiveAt: true,
  } as const;

  const [pending, members] = await Promise.all([
    prisma.user.findMany({
      where: { status: "pending" },
      orderBy: { requestedAt: "asc" },
      select,
    }),
    prisma.user.findMany({
      where: { status: "active" },
      orderBy: { decidedAt: "asc" },
      select,
    }),
  ]);

  const toDto = (row: (typeof pending)[number]): AccessRowDto => ({
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    isSelf: row.id === currentUserId,
  });

  const roster = members.map(toDto);

  return {
    pending: pending.map(toDto),
    members: [
      ...roster.filter((row) => row.isSelf),
      ...roster.filter((row) => !row.isSelf),
    ],
  };
}
