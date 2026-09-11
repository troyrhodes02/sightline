import "server-only";

import type { PrismaClient, Prisma } from "../../../generated/prisma/client";
import type {
  IdentityResolutionStatus,
  StatType,
} from "../../../generated/prisma/enums";
import { normalizeName, toNflverseAbbr } from "./parse";
import type { ParsedMarket } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Positions eligible to record each prop stat. Only offensive skill players have
 * these markets, so a same-name defender or lineman is never the subject — this
 * is what tells QB Lamar Jackson apart from a cornerback of the same name. It is
 * a hard eligibility rule, not fuzzy scoring: a candidate is ruled OUT only when
 * its KNOWN position cannot produce the stat; unknown positions are kept.
 */
const OFFENSE_BY_STAT: Readonly<Record<StatType, ReadonlySet<string>>> = {
  passing_yards: new Set(["QB"]),
  rushing_yards: new Set(["QB", "RB", "HB", "FB", "WR", "TE"]),
  receiving_yards: new Set(["WR", "TE", "RB", "HB", "FB"]),
  receptions: new Set(["WR", "TE", "RB", "HB", "FB"]),
  rushing_tds: new Set(["QB", "RB", "HB", "FB", "WR", "TE"]),
  receiving_tds: new Set(["WR", "TE", "RB", "HB", "FB"]),
};

function positionEligible(
  position: string | null,
  statType: StatType | null,
): boolean {
  if (!statType || !position) return true;
  return OFFENSE_BY_STAT[statType].has(position.trim().toUpperCase());
}

/**
 * How recently (before the game) a player must have played to count as active.
 * When two same-name players survive the position filter (e.g. a father/son
 * pair — WR Michael Pittman Jr. and RB Michael Pittman Sr., both eligible for a
 * receptions market), the retiree cannot be the subject of an UPCOMING game, so
 * recent activity breaks the tie. Deliberately generous so a player who missed a
 * season still counts as active.
 */
const RECENT_ACTIVITY_MS = 3 * 365 * 24 * 60 * 60 * 1000;

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
        select: { id: true, fullName: true, position: true },
      });
      const nameMatches = candidates.filter(
        (candidate) => normalizeName(candidate.fullName) === wanted,
      );

      // 1) Position: rule out same-name candidates whose known position cannot
      //    record this stat (a passing market is a QB, a receptions market a
      //    WR/TE/RB — never a defender). Unknown positions are kept.
      const positionMatches = nameMatches.filter((candidate) =>
        positionEligible(candidate.position, parsed.statType),
      );

      let subject: { id: string } | null = null;
      let ambiguousAmong: { id: string; fullName: string }[] = [];

      if (positionMatches.length === 1) {
        subject = positionMatches[0];
      } else if (positionMatches.length > 1) {
        // 2) Recency: a same-name retiree cannot be the subject of an upcoming
        //    game. Keep only candidates active within the recent window; if that
        //    leaves exactly one, it is the subject.
        const anchor = parsed.gameDate
          ? Date.UTC(
              parsed.gameDate.year,
              parsed.gameDate.month - 1,
              parsed.gameDate.day,
            )
          : Date.now();
        const cutoff = new Date(anchor - RECENT_ACTIVITY_MS);
        const recent = await db.playerGameStat.findMany({
          where: {
            playerId: { in: positionMatches.map((candidate) => candidate.id) },
            validAt: { gte: cutoff },
          },
          select: { playerId: true },
          distinct: ["playerId"],
        });
        const activeIds = new Set(recent.map((row) => row.playerId));
        const active = positionMatches.filter((candidate) =>
          activeIds.has(candidate.id),
        );
        if (active.length === 1) subject = active[0];
        else ambiguousAmong = positionMatches;
      }
      // positionMatches.length === 0 → nobody of this name plays an eligible
      // position → not ambiguous, just no matching offensive player.

      if (subject) {
        playerId = subject.id;
        playerStatus = "resolved";
        await upsertMapping(db, parsed.playerName, {
          playerId,
          status: "resolved",
          candidateIds: undefined,
        });
      } else if (ambiguousAmong.length > 1) {
        playerStatus = "ambiguous";
        notes.push(
          `Kalshi name "${parsed.playerName}" matched ${ambiguousAmong.length} current players: ` +
            ambiguousAmong.map((match) => match.fullName).join(", ") +
            ".",
        );
        await upsertMapping(db, parsed.playerName, {
          playerId: null,
          status: "ambiguous",
          candidateIds: ambiguousAmong.map((match) => match.id),
        });
      } else {
        notes.push(
          nameMatches.length === 0
            ? `Kalshi name "${parsed.playerName}" matched 0 players.`
            : `Kalshi name "${parsed.playerName}" matched ${nameMatches.length} player(s), but none play a position that records ${parsed.statType ?? "this stat"}.`,
        );
        await upsertMapping(db, parsed.playerName, {
          playerId: null,
          status: "unresolved",
          candidateIds:
            nameMatches.length > 0
              ? nameMatches.map((match) => match.id)
              : undefined,
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
