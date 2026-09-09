import { jsonError } from "@/lib/api/errors";
import { requireSession } from "@/lib/auth/session";
import {
  ControlStateError,
  configurationInputSchema,
  saveConfiguration,
} from "@/lib/paper/controls";

export const dynamic = "force-dynamic";

/**
 * Save autonomy configuration (SIG-63).
 *
 * A save APPENDS a `PaperRiskConfig` version; no row is ever edited. That is
 * what makes "changing mode applies to the next sizing decision, and open
 * positions keep the limits they were created under" true of the data rather
 * than only of the copy on the screen.
 *
 * The starting bankroll is locked once any fill exists. It defines the
 * historical record, and changing it afterward would silently restate every
 * percentage the campaign has ever reported.
 *
 * A Kelly fraction above 0.75 is VALID. Custom exists precisely so the presets
 * can be overridden deliberately; the interface warns and does not block.
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

  const parsed = configurationInputSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("validation_error", "Invalid configuration.", {
      fields: parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", "),
    });
  }

  try {
    // The acting user comes from the session. A body carrying a userId or a
    // role is rejected by the strict schema before it reaches here.
    const result = await saveConfiguration(
      parsed.data,
      session.user.id,
      new Date(),
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ControlStateError) {
      return jsonError("invalid_state_transition", error.message);
    }
    return jsonError("internal_error", "The configuration could not be saved.");
  }
}
