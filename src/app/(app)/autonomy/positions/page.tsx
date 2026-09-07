import { requireAdmin } from "@/lib/auth/session";
import { readPositions } from "@/lib/paper/read";
import { AutonomyPositions } from "@/components/screens/AutonomyPositions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper positions · Sightline" };

export default async function AutonomyPositionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const raw = Array.isArray(params.status) ? params.status[0] : params.status;
  const status =
    raw === "settled" || raw === "all" || raw === "open" ? raw : "open";

  const { rows, openCount, settledCount } = await readPositions(status);

  return (
    <AutonomyPositions
      rows={rows}
      status={status}
      openCount={openCount}
      settledCount={settledCount}
    />
  );
}
