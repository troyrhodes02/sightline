import { requireAdmin } from "@/lib/auth/session";
import {
  readPendingSuggestions,
  readSuggestionHistory,
} from "@/lib/suggestions/read";
import { readSuggestionReliability } from "@/lib/suggestions/read";
import { Suggestions } from "@/components/screens/Suggestions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions · Sightline" };

/**
 * The Adjustment Suggestions section — admin-only, rejected in place with a 403
 * before any chrome renders (decision 7). One page, three tabs: the pending
 * accept/decline queue, the history, and the private reliability analytics.
 */
export default async function SuggestionsPage() {
  await requireAdmin();
  const [pending, history, reliability] = await Promise.all([
    readPendingSuggestions(),
    readSuggestionHistory(),
    readSuggestionReliability(),
  ]);
  return (
    <Suggestions
      pending={pending}
      history={history}
      reliability={reliability}
    />
  );
}
