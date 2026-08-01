import "server-only";

import type { PrismaClient, Prisma } from "../../../generated/prisma/client";
import type {
  IdentityResolutionStatus,
  StatType,
} from "../../../generated/prisma/enums";
import { normalizeName, toNflverseAbbr } from "./parse";
import type { ParsedMarket } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/** What resolution decided for one contract. Applied by the sync upsert. */
export type Resolution = {
  playerId: string | null;
  gameId: string | null;
  statType: StatType | null;
  threshold: number | null;
  resolutionStatus: IdentityResolutionStatus;
  resolutionNote: string | null;
};

/**
 * Resolves a parsed market to a Sightline player and game.
 *
 * The player path is the Pitch 1 identity mechanism: an existing
 * `PlayerExternalId` mapping (source `kalshi`) wins outright — including
 * `manual_override` rows written from the admin's resolve control — and the
 * only automatic match is **exact equality of normalized full names**. One
 * match resolves and records the mapping so the next sync short-circuits;
 * several matches record `ambiguous` with the candidates; zero record
 * `unresolved`. Nothing fuzzy, nothing scored.
 */
export async function resolveContract(
  parsed: ParsedMarket,
  db: Db,
): Promise<Resolution> {
  const notes: string[] = [];

  if (!parsed.statType) {
    notes.push(`Series ${parsed.kalshiSeriesTicker} maps to no stat type.`);
  }
  if (parsed.threshold === null) {
    notes.push("No threshold could be parsed.");
  }

  const gameId = await resolveGame(parsed, db, notes);

  let playerId: string | null = null;
  let playerStatus: IdentityResolutionStatus = "unresolved";

  if (!parsed.playerName) {
    notes.push("No player name could be parsed from the market title.");
  } else {
    const existing = await db.playerExternalId.findFirst({
      where: {
        source: "kalshi",
        externalName: parsed.playerName,
        status: { in: ["resolved", "manual_override"] },
        playerId: { not: null },
      },
      select: { playerId: true, status: true },
    });

    if (existing?.playerId) {
      playerId = existing.playerId;
      playerStatus = existing.status;
    } else {
      const wanted = normalizeName(parsed.playerName);
      const lastToken = wanted.split(" ").at(-1) ?? wanted;
      const candidates = await db.player.findMany({
        where: { fullName: { contains: lastToken, mode: "insensitive" } },
        select: { id: true, fullName: true },
      });
      const matches = candidates.filter(
        (candidate) => normalizeName(candidate.fullName) === wanted,
      );

      if (matches.length === 1) {
        playerId = matches[0].id;
        playerStatus = "resolved";
        await upsertMapping(db, parsed.playerName, {
          playerId,
          status: "resolved",
          candidateIds: undefined,
        });
      } else if (matches.length > 1) {
        playerStatus = "ambiguous";
        notes.push(
          `Kalshi name "${parsed.playerName}" matched ${matches.length} players: ` +
            matches.map((match) => match.fullName).join(", ") +
            ".",
        );
        await upsertMapping(db, parsed.playerName, {
          playerId: null,
          status: "ambiguous",
          candidateIds: matches.map((match) => match.id),
        });
      } else {
        notes.push(`Kalshi name "${parsed.playerName}" matched 0 players.`);
        await upsertMapping(db, parsed.playerName, {
          playerId: null,
          status: "unresolved",
          candidateIds: undefined,
        });
      }
    }
  }

  const fullyResolved =
    playerId !== null &&
    gameId !== null &&
    parsed.statType !== null &&
    parsed.threshold !== null;

  const resolutionStatus: IdentityResolutionStatus = fullyResolved
    ? playerStatus === "manual_override"
      ? "manual_override"
      : "resolved"
    : playerStatus === "ambiguous"
      ? "ambiguous"
      : "unresolved";

  return {
    playerId,
    gameId,
    statType: parsed.statType,
    threshold: parsed.threshold,
    resolutionStatus,
    resolutionNote: notes.length > 0 ? notes.join(" ") : null,
  };
}

/**
 * Finds the game named by the event ticker: both team codes mapped to
 * nflverse abbreviations, kickoff within a two-day UTC window of the event
 * date (an ET evening kickoff lands past UTC midnight).
 */
async function resolveGame(
  parsed: ParsedMarket,
  db: Db,
  notes: string[],
): Promise<string | null> {
  if (!parsed.gameDate || !parsed.awayCode || !parsed.homeCode) {
    notes.push(
      `Game could not be parsed from event ticker "${parsed.kalshiEventTicker}".`,
    );
    return null;
  }

  const away = toNflverseAbbr(parsed.awayCode);
  const home = toNflverseAbbr(parsed.homeCode);
  const start = new Date(
    Date.UTC(
      parsed.gameDate.year,
      parsed.gameDate.month - 1,
      parsed.gameDate.day,
    ),
  );
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);

  const game = await db.game.findFirst({
    where: {
      kickoffAt: { gte: start, lt: end },
      awayTeam: { nflverseAbbr: away },
      homeTeam: { nflverseAbbr: home },
    },
    select: { id: true },
  });

  if (!game) {
    notes.push(
      `No scheduled game matches ${away} at ${home} around ` +
        `${parsed.gameDate.year}-${String(parsed.gameDate.month).padStart(2, "0")}-` +
        `${String(parsed.gameDate.day).padStart(2, "0")}.`,
    );
    return null;
  }
  return game.id;
}

/**
 * Records the identity mapping through the Pitch 1 mechanism. Name-only
 * source, so the name itself is the external id (see PlayerExternalId).
 * Never overwrites a manual override.
 */
async function upsertMapping(
  db: Db,
  kalshiName: string,
  data: {
    playerId: string | null;
    status: IdentityResolutionStatus;
    candidateIds: string[] | undefined;
  },
): Promise<void> {
  const existing = await db.playerExternalId.findUnique({
    where: {
      source_externalId_externalName: {
        source: "kalshi",
        externalId: kalshiName,
        externalName: kalshiName,
      },
    },
    select: { id: true, status: true },
  });

  if (existing?.status === "manual_override") return;

  if (existing) {
    await db.playerExternalId.update({
      where: { id: existing.id },
      data: {
        playerId: data.playerId,
        status: data.status,
        candidateIds: data.candidateIds ?? undefined,
      },
    });
  } else {
    await db.playerExternalId.create({
      data: {
        source: "kalshi",
        externalId: kalshiName,
        externalName: kalshiName,
        playerId: data.playerId,
        status: data.status,
        candidateIds: data.candidateIds ?? undefined,
      },
    });
  }
}
