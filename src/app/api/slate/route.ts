import { requireSession } from "@/lib/auth/session";
import { readSlate } from "@/lib/slate/read";

export const dynamic = "force-dynamic";

/**
 * The aggregate slate read. Server components read through the same
 * `readSlate` implementation; this route exists so the polling island can
 * re-fetch after a price refresh without a full navigation.
 *
 * The role decides which serializer runs: viewer payloads are built by code
 * that never queries decisions, so decision keys are structurally absent —
 * not nulled, not filtered.
 */
export async function GET(): Promise<Response> {
  const session = await requireSession();
  const slate = await readSlate(session.user.role);
  return Response.json(slate, { status: 200 });
}
