import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { readContractDetail } from "@/lib/slate/read";
import { normalizeName } from "@/lib/kalshi/parse";
import { ContractDetail } from "@/components/screens/ContractDetail";
import type { ResolveCandidate } from "@/components/slate/ResolveControl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contract · Sightline" };

/**
 * Contract detail — URL-addressed and deep-linkable for both roles. The
 * role decides which serializer built the payload; the viewer variant of an
 * unresolved contract carries no diagnostics and no controls.
 *
 * Resolve candidates are selected server-side and passed as props — the
 * resolve island fetches nothing. Candidates are players whose normalized
 * name shares the parsed name's last token (usually a handful), falling back
 * to recent-season participants when nothing parsed.
 */
export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const session = await requireSession();
  const { contractId } = await params;

  const detail = await readContractDetail(contractId, session.user.role);
  if (!detail) notFound();

  const isAdmin = session.user.role === "admin";
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { resolutionStatus: true, kalshiPlayerName: true },
  });
  const isUnresolved =
    contract?.resolutionStatus === "unresolved" ||
    contract?.resolutionStatus === "ambiguous";

  let resolveCandidates: ResolveCandidate[] = [];
  if (isAdmin && isUnresolved) {
    resolveCandidates = await candidatesFor(contract?.kalshiPlayerName ?? null);
  }

  return (
    <ContractDetail
      detail={detail}
      isAdmin={isAdmin}
      isUnresolved={Boolean(isUnresolved)}
      resolveCandidates={resolveCandidates}
    />
  );
}

async function candidatesFor(
  kalshiName: string | null,
): Promise<ResolveCandidate[]> {
  const lastToken = kalshiName
    ? (normalizeName(kalshiName).split(" ").at(-1) ?? null)
    : null;

  const players = await prisma.player.findMany({
    where: lastToken
      ? { fullName: { contains: lastToken, mode: "insensitive" } }
      : undefined,
    select: { id: true, fullName: true, position: true },
    orderBy: { fullName: "asc" },
    take: 200,
  });

  return players.map((player) => ({
    id: player.id,
    label: player.position
      ? `${player.fullName} (${player.position})`
      : player.fullName,
  }));
}
