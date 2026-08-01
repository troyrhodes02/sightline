import { jsonError } from "@/lib/api/errors";
import { SEASON_LOOKAHEAD_DAYS } from "@/lib/health/config";
import { verifyPipelineToken } from "@/lib/pipeline/auth";
import { decidePriceRefreshAction } from "@/lib/pipeline/cadence";
import { captureFinalPreKickoffSnapshots } from "@/lib/pipeline/final-snapshot";
import { runMarketSync } from "@/lib/kalshi/sync";
import { prisma } from "@/lib/prisma";
import type { MarketSyncStatus } from "../../../../../generated/prisma/enums";

export const dynamic = "force-dynamic";

/**
 * Scheduled price maintenance (RD-P4, RD-20). The 15-minute cron calls this
 * unconditionally; the route decides server-side — from the stored schedule,
 * never the calendar — whether Kalshi is actually contacted, then runs the
 * final pre-kickoff snapshot capture pass (RD-19, capture only).
 *
 * Machine-authenticated: scheduler bearer token, not a user session. No user
 * identifier is read from anywhere. A Kalshi outage stays the designed
 * degraded mode — recorded on the sync run, answered with 200, never a 5xx.
 */

export type PipelinePriceRefreshResult = {
  skipped?: "not_expected" | "coalesced";
  sync?: {
    status: MarketSyncStatus;
    observationsWritten: number;
    degraded: boolean;
  };
  finalSnapshotsCaptured: number;
};

export async function POST(request: Request): Promise<Response> {
  const auth = verifyPipelineToken(request.headers.get("authorization"));
  if (auth === "unconfigured") {
    return jsonError(
      "upstream_unavailable",
      "The scheduler token is not configured.",
    );
  }
  if (auth === "unauthorized") {
    return jsonError("unauthorized", "Invalid scheduler credentials.");
  }

  try {
    const now = new Date();
    const lookaheadEnd = new Date(
      now.getTime() + SEASON_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    );
    const [games, lastSync] = await Promise.all([
      prisma.game.findMany({
        where: {
          status: "scheduled",
          kickoffAt: { gt: now, lte: lookaheadEnd },
        },
        select: { kickoffAt: true },
      }),
      prisma.marketSyncRun.findFirst({
        where: { finishedAt: { not: null } },
        orderBy: { startedAt: "desc" },
        select: { finishedAt: true },
      }),
    ]);

    const action = decidePriceRefreshAction({
      kickoffs: games.map((game) => game.kickoffAt),
      lastSyncFinishedAt: lastSync?.finishedAt ?? null,
      now,
    });

    if (action === "not_expected") {
      const result: PipelinePriceRefreshResult = {
        skipped: "not_expected",
        finalSnapshotsCaptured: 0,
      };
      return Response.json(result, { status: 200 });
    }

    if (action === "coalesced") {
      // No game is inside any capture window when the in-week branch is
      // taken, but the pass is idempotent and cheap — running it keeps the
      // guarantee structural rather than reasoned-about.
      const finalSnapshotsCaptured = await captureFinalPreKickoffSnapshots(now);
      const result: PipelinePriceRefreshResult = {
        skipped: "coalesced",
        finalSnapshotsCaptured,
      };
      return Response.json(result, { status: 200 });
    }

    const sync = await runMarketSync();
    const finalSnapshotsCaptured = await captureFinalPreKickoffSnapshots(now);
    const result: PipelinePriceRefreshResult = {
      sync: {
        status: sync.status,
        observationsWritten: sync.observationsWritten,
        degraded: sync.degraded,
      },
      finalSnapshotsCaptured,
    };
    return Response.json(result, { status: 200 });
  } catch {
    // Unexpected only — Kalshi failures are recorded inside the sync.
    // Nothing internal reaches the caller.
    return jsonError("internal_error", "The scheduled price refresh failed.");
  }
}
