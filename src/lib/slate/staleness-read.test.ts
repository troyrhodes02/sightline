/**
 * `latestFactKnownAtByGame` against a mocked Prisma seam (SIG-84).
 *
 * The invariant under test: a fact whose `knownAt` is in the future is not
 * yet knowable, so it must not contribute to `latestFactKnownAt` and cannot
 * make a projection stale. Because Prisma is mocked here (it returns whatever
 * we stub, it does not filter), the assertion is at the query-construction
 * level — every fact group must be bounded by `knownAt <= now`. The behaviour
 * that bound produces is exercised end-to-end by the DB-backed slate tests.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    playerGameContext: { groupBy: jest.fn() },
    gameScheduleRevision: { groupBy: jest.fn() },
    gameWeather: { findMany: jest.fn() },
    game: { findMany: jest.fn() },
    playerGameStat: { groupBy: jest.fn() },
    playByPlay: { groupBy: jest.fn() },
  },
}));

jest.mock("@/env", () => ({
  serverEnv: () => ({ INACTIVES_LEAD_MINUTES: 90 }),
}));

import { prisma } from "@/lib/prisma";
import { latestFactKnownAtByGame } from "./staleness-read";

const mockPrisma = prisma as unknown as {
  playerGameContext: { groupBy: jest.Mock };
  gameScheduleRevision: { groupBy: jest.Mock };
  gameWeather: { findMany: jest.Mock };
  game: { findMany: jest.Mock };
  playerGameStat: { groupBy: jest.Mock };
  playByPlay: { groupBy: jest.Mock };
};

const NOW = new Date("2026-09-10T12:00:00.000Z");
const GAME = {
  id: "g1",
  season: 2026,
  homeTeamId: "home",
  awayTeamId: "away",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.playerGameContext.groupBy.mockResolvedValue([]);
  mockPrisma.gameScheduleRevision.groupBy.mockResolvedValue([]);
  mockPrisma.gameWeather.findMany.mockResolvedValue([]);
  mockPrisma.game.findMany.mockResolvedValue([]);
  mockPrisma.playerGameStat.groupBy.mockResolvedValue([]);
  mockPrisma.playByPlay.groupBy.mockResolvedValue([]);
});

describe("latestFactKnownAtByGame — future facts are not yet knowable (SIG-84)", () => {
  it("bounds every fact group by knownAt <= now", async () => {
    await latestFactKnownAtByGame([GAME], NOW);

    expect(mockPrisma.playerGameContext.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ knownAt: { lte: NOW } }),
      }),
    );
    expect(mockPrisma.gameScheduleRevision.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ knownAt: { lte: NOW } }),
      }),
    );
    expect(mockPrisma.gameWeather.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ knownAt: { lte: NOW } }),
      }),
    );
  });

  it("bounds completed-game stat/play groups by knownAt <= now", async () => {
    mockPrisma.game.findMany.mockResolvedValue([
      { id: "prior", season: 2026, homeTeamId: "home", awayTeamId: "x" },
    ]);

    await latestFactKnownAtByGame([GAME], NOW);

    expect(mockPrisma.playerGameStat.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ knownAt: { lte: NOW } }),
      }),
    );
    expect(mockPrisma.playByPlay.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ knownAt: { lte: NOW } }),
      }),
    );
  });

  it("returns a knownAt the query surfaced (already bounded to <= now)", async () => {
    const known = new Date("2026-09-09T20:00:00.000Z");
    mockPrisma.playerGameContext.groupBy.mockResolvedValue([
      { gameId: "g1", _max: { knownAt: known } },
    ]);

    const result = await latestFactKnownAtByGame([GAME], NOW);

    expect(result.get("g1")).toEqual(known);
  });

  it("maps a game with no knowable facts to null, never undefined", async () => {
    const result = await latestFactKnownAtByGame([GAME], NOW);
    expect(result.get("g1")).toBeNull();
  });
});
