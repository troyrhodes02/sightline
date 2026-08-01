import "server-only";

import { serverEnv } from "@/env";
import { prisma } from "@/lib/prisma";
import type { StalenessDto } from "@/lib/dto/slate";
import { evaluateStaleness, type StalenessInputs } from "./staleness";

/** The configured inactives lead (RD-23), read once per call site. */
export function inactivesLeadMinutes(): number {
  return serverEnv().INACTIVES_LEAD_MINUTES;
}

/** `evaluateStaleness` with the configured lead supplied. */
export function stalenessForRow(inputs: StalenessInputs): StalenessDto | null {
  return evaluateStaleness(inputs, inactivesLeadMinutes());
}

export type GameForStaleness = {
  id: string;
  season: number;
  homeTeamId: string;
  awayTeamId: string;
};

/**
 * Max `knownAt` across the RD-22 fact groups, per game, in a fixed number of
 * batched queries for the whole slate — no N+1.
 *
 * Game-scoped groups: `PlayerGameContext` rows for the game (injury
 * designations, practice status), `GameScheduleRevision` rows, the game's
 * `GameWeather`, and `PlayerGameStat`/`PlayByPlay` rows of *either team's
 * completed games this season* (a completed prior game is new information
 * about this game's players). League-wide drift is the nightly recompute's
 * job, not a stale trigger (RD-22) — another team's game completing does not
 * mark this one.
 */
export async function latestFactKnownAtByGame(
  games: GameForStaleness[],
): Promise<Map<string, Date | null>> {
  const result = new Map<string, Date | null>(
    games.map((game) => [game.id, null]),
  );
  if (games.length === 0) return result;

  const gameIds = games.map((game) => game.id);
  const seasons = [...new Set(games.map((game) => game.season))];
  const teamIds = [
    ...new Set(games.flatMap((game) => [game.homeTeamId, game.awayTeamId])),
  ];

  const [contexts, revisions, weather, completedGames] = await Promise.all([
    prisma.playerGameContext.groupBy({
      by: ["gameId"],
      where: { gameId: { in: gameIds } },
      _max: { knownAt: true },
    }),
    prisma.gameScheduleRevision.groupBy({
      by: ["gameId"],
      where: { gameId: { in: gameIds } },
      _max: { knownAt: true },
    }),
    prisma.gameWeather.findMany({
      where: { gameId: { in: gameIds } },
      select: { gameId: true, knownAt: true },
    }),
    prisma.game.findMany({
      where: {
        season: { in: seasons },
        status: "completed",
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      select: { id: true, season: true, homeTeamId: true, awayTeamId: true },
    }),
  ]);

  const completedIds = completedGames.map((game) => game.id);
  const [statMaxes, playMaxes] = await Promise.all([
    completedIds.length
      ? prisma.playerGameStat.groupBy({
          by: ["gameId"],
          where: { gameId: { in: completedIds } },
          _max: { knownAt: true },
        })
      : Promise.resolve([]),
    completedIds.length
      ? prisma.playByPlay.groupBy({
          by: ["gameId"],
          where: { gameId: { in: completedIds } },
          _max: { knownAt: true },
        })
      : Promise.resolve([]),
  ]);
  const factsByCompletedGame = new Map<string, Date>();
  for (const row of [...statMaxes, ...playMaxes]) {
    const knownAt = row._max.knownAt;
    if (!knownAt) continue;
    const existing = factsByCompletedGame.get(row.gameId);
    if (!existing || knownAt > existing) {
      factsByCompletedGame.set(row.gameId, knownAt);
    }
  }

  const bump = (gameId: string, knownAt: Date | null | undefined) => {
    if (!knownAt) return;
    const existing = result.get(gameId);
    if (!existing || knownAt > existing) result.set(gameId, knownAt);
  };

  for (const row of contexts) bump(row.gameId, row._max.knownAt);
  for (const row of revisions) bump(row.gameId, row._max.knownAt);
  for (const row of weather) bump(row.gameId, row.knownAt);

  // Completed-game facts attach to each slate game that shares a team and
  // season with the completed game — scoping in both directions (RD-22).
  for (const game of games) {
    for (const completed of completedGames) {
      if (completed.season !== game.season) continue;
      const sharesTeam =
        completed.homeTeamId === game.homeTeamId ||
        completed.homeTeamId === game.awayTeamId ||
        completed.awayTeamId === game.homeTeamId ||
        completed.awayTeamId === game.awayTeamId;
      if (!sharesTeam) continue;
      bump(game.id, factsByCompletedGame.get(completed.id));
    }
  }

  return result;
}
