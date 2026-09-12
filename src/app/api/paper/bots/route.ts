import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ControlStateError } from "@/lib/paper/controls";
import { createBot, createBotInputSchema } from "@/lib/paper/bots";

export const dynamic = "force-dynamic";

/**
 * Create a Paper Bot Lab bot (design doc §7).
 *
 * A bot is a `PaperCampaign` (isComparison=false) plus its opening-balance ledger
 * entry and its own initial risk config, created atomically. It attaches to the
 * active evaluation campaign (the parent that owns the campaign-wide kill switch)
 * and starts enabled, so it begins accumulating on the next scheduled cycle.
 *
 * Admin-only. The acting user comes from the session; a body carrying a userId or
 * a role is rejected by the strict schema before it reaches here. No live money is
 * ever touched — this is a paper bot.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    return jsonError("forbidden", "Not available.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("validation_error", "The request body is not JSON.");
  }

  const parsed = createBotInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid bot configuration.", {
      fields: parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", "),
    });
  }

  // The bot attaches to the active evaluation campaign, resolved server-side.
  const campaign = await prisma.paperEvaluationCampaign.findFirst({
    orderBy: { campaignStartedAt: "asc" },
    select: { id: true },
  });
  if (!campaign) {
    return jsonError(
      "not_found",
      "No paper evaluation campaign exists to attach the bot to.",
    );
  }

  try {
    const botId = await createBot({
      evaluationCampaignId: campaign.id,
      name: parsed.data.name,
      engine: parsed.data.engine,
      mode: parsed.data.mode,
      customParams: {
        kellyFraction: parsed.data.kellyFraction,
        perGameCapPct: parsed.data.perGameCapPct,
        perSlateCapPct: parsed.data.perSlateCapPct,
        drawdownHaltPct: parsed.data.drawdownHaltPct,
      },
      startingBankrollCents: parsed.data.startingBankrollCents,
      withdrawalCeilingMultiple: parsed.data.withdrawalCeilingMultiple,
      actorUserId: session.user.id,
    });
    return Response.json({ botId }, { status: 201 });
  } catch (error) {
    if (error instanceof ControlStateError) {
      return jsonError("invalid_state_transition", error.message);
    }
    return jsonError("internal_error", "The bot could not be created.");
  }
}
