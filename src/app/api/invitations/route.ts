import { z } from "zod";
import { serverEnv } from "@/env";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
import {
  generateInvitationToken,
  hashInvitationToken,
} from "@/lib/auth/tokens";
import { invitationMailer } from "@/lib/mail";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.email("Enter a valid email address.").max(320),
  role: z.enum(["admin", "viewer"]),
  displayName: z.string().trim().max(80).optional(),
});

export type InvitationDto = {
  id: string;
  email: string;
  role: "admin" | "viewer";
  displayName: string | null;
  expiresAt: string;
  createdAt: string;
  // No token. No hash. Not here, not in any DTO.
};

/**
 * Issues an invitation.
 *
 * Ordering matters: the row is written first so the unique index can reject a
 * duplicate before an email goes out, then the mail is sent, and **a send
 * failure rolls the row back**. A stored invitation whose link was never
 * delivered is unrecoverable — the plaintext cannot be recovered from the hash,
 * and there is no resend in this pitch. Better to leave no trace and let the
 * admin try again.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await requireAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "Expected a JSON body.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError("validation_error", "Check the invitation details.", {
      [String(first?.path[0] ?? "email")]: first?.message ?? "Invalid value.",
    });
  }

  const { role, displayName } = parsed.data;
  const email = parsed.data.email.trim();

  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, status: true },
  });
  if (existingUser && existingUser.status === "active") {
    return jsonError("duplicate_resource", "That address already has access.");
  }

  const token = generateInvitationToken();
  const env = serverEnv();
  const expiresAt = new Date(
    Date.now() + env.INVITATION_TTL_HOURS * 60 * 60 * 1000,
  );

  let invitationId: string;
  let createdAt: Date;

  try {
    const created = await prisma.invitation.create({
      data: {
        email: email.toLowerCase(),
        role,
        displayName: displayName?.length ? displayName : null,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedById: session.user.id,
      },
      select: { id: true, createdAt: true },
    });
    invitationId = created.id;
    createdAt = created.createdAt;
  } catch {
    // The partial unique index rejects a second PENDING invitation for the same
    // address, case-insensitively. Anything else that fails here is also a
    // reason not to proceed, and the message stays generic either way.
    return jsonError(
      "duplicate_resource",
      "That address already has a pending invitation.",
    );
  }

  try {
    await invitationMailer().send({
      to: email,
      acceptUrl: `${env.APP_URL}/invite/${token}`,
      role,
      displayName: displayName?.length ? displayName : null,
    });
  } catch {
    await prisma.invitation.delete({ where: { id: invitationId } });
    return jsonError(
      "upstream_unavailable",
      "The invitation could not be sent. Nothing was created — try again.",
    );
  }

  const dto: InvitationDto = {
    id: invitationId,
    email,
    role,
    displayName: displayName?.length ? displayName : null,
    expiresAt: expiresAt.toISOString(),
    createdAt: createdAt.toISOString(),
  };

  return Response.json(dto, { status: 201 });
}
