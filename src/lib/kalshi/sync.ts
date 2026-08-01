import "server-only";

import { serverEnv } from "@/env";
import { prisma } from "@/lib/prisma";
import {
  KalshiRateLimitError,
  KalshiUnavailableError,
  listOpenMarkets,
} from "./client";
import { NFL_SERIES_TICKERS, parseMarket } from "./parse";
import { resolveContract } from "./resolve";
import type { KalshiMarket } from "./types";
import type { MarketSyncStatus } from "../../../generated/prisma/enums";

/**
 * The market sync: discovery, contract upsert, resolution, and price
 * observation capture, with the run itself recorded as a `MarketSyncRun` so
 * completeness is a fact rather than an impression (RD-8).
 *
 * Rate-limit discipline is centralised here (pitch: "refresh storms").
 * Browsers call Sightline's refresh route; this module decides whether Kalshi
 * is actually contacted. Coalescing (RD-13) returns the previous run when it
 * finished inside the configured window, and an in-process gate collapses
 * concurrent callers onto one sync.
 */

export type SyncResult = {
  syncRunId: string;
  status: MarketSyncStatus;
  coalesced: boolean;
  /** True when the sync could not reach Kalshi at all. */
  degraded: boolean;
  marketsDiscovered: number;
  contractsUpserted: number;
  observationsWritten: number;
  finishedAt: string | null;
};

/**
 * Books differ when any of the four sides differs. Null and a number are
 * different books — a side appearing or disappearing is a market event.
 * Exported for tests.
 */
export function booksDiffer(
  a: {
    yesBidCents: number | null;
    yesAskCents: number | null;
    noBidCents: number | null;
    noAskCents: number | null;
  },
  b: {
    yesBidCents: number | null;
    yesAskCents: number | null;
    noBidCents: number | null;
    noAskCents: number | null;
  },
): boolean {
  return (
    a.yesBidCents !== b.yesBidCents ||
    a.yesAskCents !== b.yesAskCents ||
    a.noBidCents !== b.noBidCents ||
    a.noAskCents !== b.noAskCents
  );
}

/**
 * Kalshi sends 0 for an empty side; Sightline stores null — a book side that
 * does not exist is absent, not free. Valid prices are 1–99 integer cents.
 * Exported for tests.
 */
export function toCents(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cents = Math.round(value);
  if (cents < 1 || cents > 99) return null;
  return cents;
}

/** Strips anything URL- or credential-shaped before a message is stored. */
export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.replace(/https?:\/\/\S+/g, "[url]").slice(0, 500);
}

/** Collapses concurrent in-process callers onto one running sync. */
let inFlight: Promise<SyncResult> | null = null;

export async function runMarketSync(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = executeSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function executeSync(): Promise<SyncResult> {
  const env = serverEnv();
  const now = new Date();

  // Coalescing (RD-13): a run that finished inside the window answers for
  // this one. Failed runs coalesce too — hammering refresh during an outage
  // must not multiply outbound attempts.
  const latest = await prisma.marketSyncRun.findFirst({
    orderBy: { startedAt: "desc" },
    where: { finishedAt: { not: null } },
  });
  if (
    latest?.finishedAt &&
    now.getTime() - latest.finishedAt.getTime() <
      env.KALSHI_SYNC_MIN_INTERVAL_SECONDS * 1000
  ) {
    return {
      syncRunId: latest.id,
      status: latest.status,
      coalesced: true,
      degraded: latest.status === "failed",
      marketsDiscovered: latest.marketsDiscovered,
      contractsUpserted: latest.contractsUpserted,
      observationsWritten: latest.observationsWritten,
      finishedAt: latest.finishedAt.toISOString(),
    };
  }

  // Pessimistic row: if this process dies mid-sync, what remains reads as a
  // failure with no finishedAt — never as a silently complete run.
  const run = await prisma.marketSyncRun.create({
    data: { status: "failed", startedAt: now },
  });

  let marketsDiscovered = 0;
  let contractsUpserted = 0;
  let observationsWritten = 0;
  const failures: string[] = [];
  const seenTickers: string[] = [];

  for (const seriesTicker of NFL_SERIES_TICKERS) {
    let markets: KalshiMarket[];
    try {
      markets = await listOpenMarkets(seriesTicker);
    } catch (error) {
      failures.push(`${seriesTicker}: ${sanitizeErrorMessage(error)}`);
      // A rate-limit response ends the run rather than retrying in a loop;
      // the next refresh (outside the coalescing window) tries again.
      if (error instanceof KalshiRateLimitError) break;
      if (error instanceof KalshiUnavailableError) continue;
      throw error;
    }

    marketsDiscovered += markets.length;

    for (const market of markets) {
      try {
        const written = await upsertOneMarket(market, seriesTicker);
        contractsUpserted += 1;
        observationsWritten += written ? 1 : 0;
        seenTickers.push(market.ticker);
      } catch (error) {
        // One malformed market never blocks the slate (pitch no-go). It is
        // counted, named, and the run marked partial.
        failures.push(`${market.ticker}: ${sanitizeErrorMessage(error)}`);
      }
    }
  }

  const completeDiscovery = failures.length === 0;

  // Delist pass: an active contract in a governed series that a COMPLETE
  // discovery no longer returned has left the market. Partial discoveries
  // must not delist — absence from a failed fetch is not absence from the
  // exchange — and neither does a discovery that returned NOTHING: a
  // legitimately empty exchange and a silently drifted series taxonomy are
  // indistinguishable from here, and started games leave the slate via the
  // kickoff boundary regardless, so the conservative reading costs only a
  // cosmetic status. History is retained; nothing is deleted.
  if (completeDiscovery && marketsDiscovered > 0) {
    await prisma.contract.updateMany({
      where: {
        status: "active",
        kalshiSeriesTicker: { in: NFL_SERIES_TICKERS },
        kalshiTicker: { notIn: seenTickers },
      },
      data: { status: "delisted" },
    });
  }

  const status: MarketSyncStatus = !completeDiscovery
    ? marketsDiscovered === 0 && contractsUpserted === 0
      ? "failed"
      : "partial"
    : marketsDiscovered === 0
      ? "empty"
      : "complete";

  const finishedAt = new Date();
  await prisma.marketSyncRun.update({
    where: { id: run.id },
    data: {
      status,
      marketsDiscovered,
      contractsUpserted,
      observationsWritten,
      errorMessage:
        failures.length > 0 ? failures.join(" | ").slice(0, 2000) : null,
      finishedAt,
    },
  });

  return {
    syncRunId: run.id,
    status,
    coalesced: false,
    degraded: status === "failed",
    marketsDiscovered,
    contractsUpserted,
    observationsWritten,
    finishedAt: finishedAt.toISOString(),
  };

  /**
   * Upserts one market's contract and, when the book changed or the
   * heartbeat elapsed (RD-14), appends a price observation. Returns whether
   * an observation was written.
   */
  async function upsertOneMarket(
    market: KalshiMarket,
    seriesTicker: string,
  ): Promise<boolean> {
    const parsed = parseMarket(market, seriesTicker);
    const observedAt = new Date();

    const existing = await prisma.contract.findUnique({
      where: { kalshiTicker: parsed.kalshiTicker },
      select: { id: true, resolutionStatus: true },
    });

    let contractId: string;
    if (!existing) {
      const resolution = await resolveContract(parsed, prisma);
      const created = await prisma.contract.create({
        data: {
          kalshiTicker: parsed.kalshiTicker,
          kalshiEventTicker: parsed.kalshiEventTicker,
          kalshiSeriesTicker: seriesTicker,
          title: parsed.title,
          kalshiPlayerName: parsed.playerName,
          playerId: resolution.playerId,
          gameId: resolution.gameId,
          statType: resolution.statType,
          threshold: resolution.threshold,
          resolutionStatus: resolution.resolutionStatus,
          resolutionNote: resolution.resolutionNote,
          status: "active",
          closeTime: parsed.closeTime,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
        },
      });
      contractId = created.id;
    } else {
      contractId = existing.id;
      // Re-resolution only for contracts still unresolved or ambiguous — a
      // resolved or manually corrected mapping is settled history (RD-9).
      const needsResolution =
        existing.resolutionStatus === "unresolved" ||
        existing.resolutionStatus === "ambiguous";
      const resolution = needsResolution
        ? await resolveContract(parsed, prisma)
        : null;

      await prisma.contract.update({
        where: { id: contractId },
        data: {
          status: "active",
          lastSeenAt: observedAt,
          closeTime: parsed.closeTime,
          ...(resolution
            ? {
                playerId: resolution.playerId,
                gameId: resolution.gameId,
                statType: resolution.statType,
                threshold: resolution.threshold,
                resolutionStatus: resolution.resolutionStatus,
                resolutionNote: resolution.resolutionNote,
              }
            : {}),
        },
      });
    }

    const book = {
      yesBidCents: toCents(market.yes_bid),
      yesAskCents: toCents(market.yes_ask),
      noBidCents: toCents(market.no_bid),
      noAskCents: toCents(market.no_ask),
    };

    const lastObservation = await prisma.priceObservation.findFirst({
      where: { contractId },
      orderBy: { observedAt: "desc" },
      select: {
        yesBidCents: true,
        yesAskCents: true,
        noBidCents: true,
        noAskCents: true,
        observedAt: true,
      },
    });

    const heartbeatElapsed =
      !lastObservation ||
      observedAt.getTime() - lastObservation.observedAt.getTime() >=
        env.PRICE_HEARTBEAT_MINUTES * 60 * 1000;

    if (
      lastObservation &&
      !booksDiffer(book, lastObservation) &&
      !heartbeatElapsed
    ) {
      return false;
    }

    await prisma.priceObservation.create({
      data: { contractId, syncRunId: run.id, observedAt, ...book },
    });
    return true;
  }
}
