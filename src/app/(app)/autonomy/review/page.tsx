import { requireAdmin } from "@/lib/auth/session";
import { activeCampaign } from "@/lib/paper/controls";
import { readReview, reviewPeriods } from "@/lib/paper/review";
import { latestReplay, replayEligibility } from "@/lib/paper/replay";
import type { PeriodKind } from "@/lib/paper/replay";
import { AutonomyReview } from "@/components/screens/AutonomyReview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper review · Sightline" };

export default async function AutonomyReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const campaign = await activeCampaign();
  if (!campaign) {
    return (
      <AutonomyReview
        review={null}
        periods={[]}
        replay={{
          ranAt: null,
          actualMode: "conservative",
          rows: [],
          available: false,
          blockedReason: null,
        }}
      />
    );
  }

  const granularity = parseGranularity(params.granularity);
  const periods = await reviewPeriods(campaign.id, granularity);
  const requested = first(params.period);
  const period =
    periods.find((candidate) => candidate.key === requested) ?? periods[0];

  if (!period) {
    return (
      <AutonomyReview
        review={null}
        periods={[]}
        replay={{
          ranAt: null,
          actualMode: "conservative",
          rows: [],
          available: false,
          blockedReason: null,
        }}
      />
    );
  }

  const review = await readReview(campaign.id, period);
  const eligibility = await replayEligibility(
    campaign.id,
    period.kind,
    period.key,
  );
  const stored = await latestReplay(campaign.id, period.kind, period.key);

  return (
    <AutonomyReview
      review={review}
      periods={periods}
      replay={{
        ranAt: stored?.ranAt.toISOString() ?? null,
        actualMode: stored?.actualMode ?? "conservative",
        rows:
          stored?.results.map((result) => ({
            mode: result.mode,
            endingActiveCents: result.endingActiveCents,
            netPnlCents: result.netPnlCents,
            withdrawnCents: result.withdrawnCents,
            maxDrawdownBps: result.maxDrawdownBps,
            positionCount: result.positionCount,
            breakerTrips: result.breakerTrips,
          })) ?? [],
        available: eligibility.replayable,
        blockedReason: eligibility.replayable ? null : eligibility.reason,
      }}
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Unrecognised values fall back to the default rather than erroring. */
function parseGranularity(value: string | string[] | undefined): PeriodKind {
  const raw = first(value);
  return raw === "game_window" || raw === "campaign" ? raw : "week";
}
