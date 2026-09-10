import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
import {
  SuggestionNotFoundError,
  declineSuggestion,
} from "@/lib/suggestions/actions";

export const dynamic = "force-dynamic";

/**
 * Decline an Adjustment Suggestion — admin-only. The base projection stays
 * active; the shadow is untouched and still graded. Idempotent from `pending`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAdmin();
  const { id } = await params;

  try {
    const result = await declineSuggestion(id, session.user.id);
    if (result.outcome === "invalid") {
      return jsonError(
        "invalid_state_transition",
        `Cannot decline a ${result.statusNow} suggestion.`,
      );
    }
    return Response.json(
      {
        suggestion: { id: result.suggestionId, status: result.statusNow },
        activeProjectionId: result.activeProjectionId,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof SuggestionNotFoundError) {
      return jsonError("not_found", "No such suggestion.");
    }
    throw error;
  }
}
