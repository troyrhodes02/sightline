import { requireAdmin } from "@/lib/auth/session";
import { jsonError } from "@/lib/api/errors";
import {
  SuggestionNotFoundError,
  acceptSuggestion,
} from "@/lib/suggestions/actions";

export const dynamic = "force-dynamic";

/**
 * Accept an Adjustment Suggestion — admin-only (decision 7). The body carries
 * nothing; the suggestion id is in the path and the acting user comes from the
 * session. Accepting makes the shadow the active projection. Idempotent from
 * `pending`; a resolved suggestion returns its current state so the client
 * refreshes rather than errors.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireAdmin();
  const { id } = await params;

  try {
    const result = await acceptSuggestion(id, session.user.id);
    if (result.outcome === "invalid") {
      return jsonError(
        "invalid_state_transition",
        `Cannot accept a ${result.statusNow} suggestion.`,
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
