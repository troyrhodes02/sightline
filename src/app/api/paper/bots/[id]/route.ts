import { z } from "zod";
import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { ControlStateError } from "@/lib/paper/controls";
import { renameBot, setBotAutonomy } from "@/lib/paper/bots";

export const dynamic = "force-dynamic";

/**
 * Manage a single Paper Bot Lab bot: rename, pause, or resume (design doc §7).
 *
 * - `rename` — change the bot's name (its campaign label).
 * - `pause` — stop NEW positions for THIS bot only (autonomyEnabled=false). Its
 *   siblings are untouched; the campaign-wide kill switch is a separate halt.
 * - `resume` — re-enable the bot (autonomyEnabled=true).
 *
 * "Kill" a Lab bot is `pause`: a bot is a paper campaign whose ledger is history
 * that is never destroyed, so the terminal action is to stop it from trading, not
 * to delete it. Admin-only; the actor comes from the session, never the body.
 */
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return jsonError("forbidden", "Not available.");
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "The request body is not JSON.");
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid bot action.", {
      fields: parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", "),
    });
  }

  try {
    switch (parsed.data.action) {
      case "rename":
        await renameBot(id, parsed.data.name, session.user.id, new Date());
        return Response.json({ renamed: true }, { status: 200 });
      case "pause":
        await setBotAutonomy(id, false, session.user.id, new Date());
        return Response.json({ autonomyEnabled: false }, { status: 200 });
      case "resume":
        await setBotAutonomy(id, true, session.user.id, new Date());
        return Response.json({ autonomyEnabled: true }, { status: 200 });
    }
  } catch (error) {
    if (error instanceof ControlStateError) {
      return jsonError("invalid_state_transition", error.message);
    }
    // A missing bot surfaces as Prisma's not-found on the findUniqueOrThrow.
    const notFound =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2025";
    if (notFound) return jsonError("not_found", "No such bot.");
    return jsonError("internal_error", "The bot could not be updated.");
  }
}
