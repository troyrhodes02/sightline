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

/**
 * Kalshi migrated the market payload to dollar-denominated price fields:
 * `yes_ask_dollars: "0.83"` means 83¢. Parse the dollar string (or number) to
 * integer cents with the same 1–99 discipline as `toCents` — "0.0000", the
 * empty string, and absence all mean "no book on this side" → null, never a
 * fabricated 0. Exported for tests.
 */
export function dollarsToCents(
  value: string | number | undefined | null,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const dollars = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(dollars)) return null;
  return toCents(Math.round(dollars * 100));
}

/**
 * One book side in cents, preferring Kalshi's current dollar field and
 * falling back to the legacy integer-cent field when a payload still carries
 * it (older fixtures, or a partial rollback upstream). Exported for tests.
 */
export function marketSideCents(
  dollars: string | number | undefined | null,
  legacyCents: number | undefined,
): number | null {
  const fromDollars = dollarsToCents(dollars);
  return fromDollars !== null ? fromDollars : toCents(legacyCents);
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

/**
 * The coalesced result to return when a concurrent refresh already holds the
 * advisory lock (Pitch 10): read the latest completed run and report it as
 * `coalesced` WITHOUT contacting Kalshi. This is what makes two concurrent
 * staleness-triggered refreshes produce exactly one upstream call.
 */
export async function latestCoalescedResult(): Promise<SyncResult> {
  const latest = await prisma.marketSyncRun.findFirst({
    orderBy: { startedAt: "desc" },
    where: { finishedAt: { not: null } },
  });
  if (!latest?.finishedAt) {
    return {
      syncRunId: "",
      status: "failed",
      coalesced: true,
      degraded: false,
      marketsDiscovered: 0,
      contractsUpserted: 0,
      observationsWritten: 0,
      finishedAt: null,
    };
  }
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

  // --- Phase 1: Discover all markets from Kalshi ---
  // All four series are fetched first so we can bulk-preload DB state in
  // one round trip rather than one findUnique per market (2500+ sequential
  // queries was exceeding the function timeout).
  const allMarkets: Array<{ market: KalshiMarket; seriesTicker: string }> = [];
  const failures: string[] = [];

  for (const seriesTicker of NFL_SERIES_TICKERS) {
    let markets: KalshiMarket[];
    try {
      markets = await listOpenMarkets(seriesTicker);
    } catch (error) {
      failures.push(`${seriesTicker}: ${sanitizeErrorMessage(error)}`);
      if (error instanceof KalshiRateLimitError) break;
      if (error instanceof KalshiUnavailableError) continue;
      throw error;
    }
    for (const market of markets) {
      allMarkets.push({ market, seriesTicker });
    }
  }

  const marketsDiscovered = allMarkets.length;
  const allTickers = allMarkets.map(({ market }) => market.ticker);

  // --- Phase 2: Bulk-preload existing DB state (2 queries total) ---
  const [existingContracts, latestObservations] = await Promise.all([
    // All contracts we already know about for the discovered tickers.
    prisma.contract.findMany({
      where: { kalshiTicker: { in: allTickers } },
      select: {
        id: true,
        kalshiTicker: true,
        resolutionStatus: true,
        closeTime: true,
      },
    }),
    // Latest price observation per contract, for the heartbeat/diff check.
    // DISTINCT ON is not available via Prisma; use a raw query.
    allTickers.length > 0
      ? prisma.$queryRaw<
          Array<{
            contract_id: string;
            yes_bid_cents: number | null;
            yes_ask_cents: number | null;
            no_bid_cents: number | null;
            no_ask_cents: number | null;
            observed_at: Date;
          }>
        >`
          SELECT DISTINCT ON (po.contract_id)
            po.contract_id, po.yes_bid_cents, po.yes_ask_cents,
            po.no_bid_cents, po.no_ask_cents, po.observed_at
          FROM price_observations po
          JOIN contracts c ON c.id = po.contract_id
          WHERE c.kalshi_ticker = ANY(${allTickers})
          ORDER BY po.contract_id, po.observed_at DESC
        `
      : Promise.resolve([]),
  ]);

  const contractCache = new Map(
    existingContracts.map((c) => [c.kalshiTicker, c]),
  );
  const observationCache = new Map(
    latestObservations.map((o) => [o.contract_id, o]),
  );

  // --- Phase 3: Upsert contracts and accumulate price observations ---
  const observedAt = now;
  const heartbeatMs = env.PRICE_HEARTBEAT_MINUTES * 60 * 1000;
  let contractsUpserted = 0;
  const pendingObservations: Array<{
    contractId: string;
    syncRunId: string;
    observedAt: Date;
    yesBidCents: number | null;
    yesAskCents: number | null;
    noBidCents: number | null;
    noAskCents: number | null;
  }> = [];
  const seenTickers: string[] = [];
  // Resolved known contracts only need lastSeenAt touched — batched after the loop.
  const batchLastSeenIds: string[] = [];
  // Resolved contracts whose closeTime changed — individual update needed.
  const batchCloseTimeUpdates: Array<{ id: string; closeTime: Date | null }> =
    [];

  for (const { market, seriesTicker } of allMarkets) {
    const parsed = parseMarket(market, seriesTicker);

    try {
      let contractId: string;
      const existing = contractCache.get(parsed.kalshiTicker);

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
        contractCache.set(parsed.kalshiTicker, {
          id: contractId,
          kalshiTicker: parsed.kalshiTicker,
          resolutionStatus: resolution.resolutionStatus,
          closeTime: parsed.closeTime,
        });
      } else {
        contractId = existing.id;
        const needsResolution =
          existing.resolutionStatus === "unresolved" ||
          existing.resolutionStatus === "ambiguous";

        if (needsResolution) {
          // Individual update: resolution fields may change.
          const resolution = await resolveContract(parsed, prisma);
          await prisma.contract.update({
            where: { id: contractId },
            data: {
              status: "active",
              lastSeenAt: observedAt,
              closeTime: parsed.closeTime,
              playerId: resolution.playerId,
              gameId: resolution.gameId,
              statType: resolution.statType,
              threshold: resolution.threshold,
              resolutionStatus: resolution.resolutionStatus,
              resolutionNote: resolution.resolutionNote,
            },
          });
        } else {
          // Resolved: batch the lastSeenAt touch; only individual-update if
          // closeTime actually changed (rare — NFL schedules are stable).
          batchLastSeenIds.push(contractId);
          const storedClose = existing.closeTime?.getTime() ?? null;
          const freshClose = parsed.closeTime?.getTime() ?? null;
          if (storedClose !== freshClose) {
            batchCloseTimeUpdates.push({
              id: contractId,
              closeTime: parsed.closeTime,
            });
          }
        }
      }

      contractsUpserted += 1;
      seenTickers.push(market.ticker);

      // Decide whether to write a price observation using cached state.
      // Kalshi's current payload carries dollar-denominated fields
      // (`*_dollars`); the legacy integer-cent fields are the fallback (SIG-86).
      const book = {
        yesBidCents: marketSideCents(market.yes_bid_dollars, market.yes_bid),
        yesAskCents: marketSideCents(market.yes_ask_dollars, market.yes_ask),
        noBidCents: marketSideCents(market.no_bid_dollars, market.no_bid),
        noAskCents: marketSideCents(market.no_ask_dollars, market.no_ask),
      };
      const lastObs = observationCache.get(contractId);
      const heartbeatElapsed =
        !lastObs ||
        observedAt.getTime() - lastObs.observed_at.getTime() >= heartbeatMs;

      const lastObsBook = lastObs
        ? {
            yesBidCents: lastObs.yes_bid_cents,
            yesAskCents: lastObs.yes_ask_cents,
            noBidCents: lastObs.no_bid_cents,
            noAskCents: lastObs.no_ask_cents,
          }
        : null;
      if (!lastObsBook || booksDiffer(book, lastObsBook) || heartbeatElapsed) {
        pendingObservations.push({
          contractId,
          syncRunId: run.id,
          observedAt,
          ...book,
        });
      }
    } catch (error) {
      failures.push(`${market.ticker}: ${sanitizeErrorMessage(error)}`);
    }
  }

  // --- Phase 4: Batch writes ---
  // Single updateMany for all resolved contracts that just need lastSeenAt.
  await Promise.all([
    batchLastSeenIds.length > 0
      ? prisma.contract.updateMany({
          where: { id: { in: batchLastSeenIds } },
          data: { status: "active", lastSeenAt: observedAt },
        })
      : Promise.resolve(),
    // CloseTime changed on a small subset — individual updates are fine here.
    ...batchCloseTimeUpdates.map((u) =>
      prisma.contract.update({
        where: { id: u.id },
        data: { closeTime: u.closeTime },
      }),
    ),
    pendingObservations.length > 0
      ? prisma.priceObservation.createMany({ data: pendingObservations })
      : Promise.resolve(),
  ]);
  const observationsWritten = pendingObservations.length;

  // Delist pass: an active contract in a governed series that a COMPLETE
  // discovery no longer returned has left the market. Partial discoveries
  // must not delist — absence from a failed fetch is not absence from the
  // exchange — and neither does a discovery that returned NOTHING: a
  // legitimately empty exchange and a silently drifted series taxonomy are
  // indistinguishable from here, and started games leave the slate via the
  // kickoff boundary regardless, so the conservative reading costs only a
  // cosmetic status. History is retained; nothing is deleted.
  const completeDiscovery = failures.length === 0;
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
}
