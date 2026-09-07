import { z } from "zod";

import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import { runDryRun } from "@/lib/paper/dry-run";
import {
  KalshiRateLimitError,
  KalshiUnavailableError,
} from "@/lib/kalshi/client";

export const dynamic = "force-dynamic";

const dryRunInputSchema = z.object({ gameId: z.string().min(1) }).strict();

/**
 * Dry Run (SIG-65).
 *
 * Runs the same decision path with the same active configuration and writes
 * ONE `PaperDryRun` row — no position, no fill, no ledger entry, no breach.
 * That is structural: `executeCycle` is the only function that writes ledger
 * data and this path does not call it.
 *
 * A failure states, in required copy, that nothing was written. The whole
 * value of a Dry Run is that a failure is inert.
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

  const parsed = dryRunInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Choose a game window to dry run.");
  }

  try {
    const result = await runDryRun(
      parsed.data.gameId,
      session.user.id,
      new Date(),
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (
      error instanceof KalshiUnavailableError ||
      error instanceof KalshiRateLimitError
    ) {
      return jsonError(
        "upstream_unavailable",
        `Dry run could not complete: ${error.message}. Nothing was written.`,
      );
    }
    return jsonError(
      "internal_error",
      "Dry run could not complete. Nothing was written.",
    );
  }
}
