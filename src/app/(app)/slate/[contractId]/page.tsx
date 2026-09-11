import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { readContractDetail } from "@/lib/slate/read";
import { normalizeName } from "@/lib/kalshi/parse";
import { ContractDetail } from "@/components/screens/ContractDetail";
import { ModelTrackRecordBlock } from "@/components/model-performance/ModelTrackRecordBlock";
import { readContractTrackRecord } from "@/lib/model-eval";
import { DecisionControl } from "@/components/slate/DecisionControl";
import type { ResolveCandidate } from "@/components/slate/ResolveControl";
import type { ContractTrackRecordDto } from "@/lib/dto/model-eval";

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

  // The shared viewer track-record block (Screen 4, D18). Rendered for both
  // roles once the contract has an active-model projection — a resolved contract
  // with a probability to interpret. A read failure hides the block, never the
  // whole detail view: it is supplementary context, not the contract itself.
  const hasProjection =
    !isUnresolved &&
    detail.projectionState !== "insufficient_evidence" &&
    detail.modelProbability !== null;

  let trackRecordSlot: React.ReactNode = undefined;
  if (hasProjection) {
    let trackRecord: ContractTrackRecordDto | null = null;
    let trackRecordFailed = false;
    try {
      trackRecord = await readContractTrackRecord(
        {
          statType: detail.statType,
          modelVersion: detail.modelVersion,
          modelProbability: detail.modelProbability,
          confidence: detail.confidence,
        },
        session.user.role,
      );
    } catch {
      // Supplementary context: a failed read hides the block, not the detail.
      trackRecordFailed = true;
    }
    if (!trackRecordFailed) {
      trackRecordSlot = (
        <ModelTrackRecordBlock dto={trackRecord} statType={detail.statType} />
      );
    }
  }

  return (
    <ContractDetail
      detail={detail}
      isAdmin={isAdmin}
      isUnresolved={Boolean(isUnresolved)}
      resolveCandidates={resolveCandidates}
      trackRecordSlot={trackRecordSlot}
      decisionSlot={
        isAdmin && !isUnresolved ? (
          <DecisionControl
            contractId={detail.contractId}
            current={detail.currentDisposition ?? null}
          />
        ) : undefined
      }
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
