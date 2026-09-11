import { resolveContract } from "./resolve";
import type { ParsedMarket } from "./types";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * Same-name disambiguation (SIG-follow-up): only offensive skill players have
 * these markets, and a retired namesake cannot be the subject of an upcoming
 * game. So the resolver disambiguates same-name players by POSITION eligibility
 * for the stat, then by RECENT ACTIVITY — deterministically, never fuzzily.
 */
function parsed(overrides: Partial<ParsedMarket> = {}): ParsedMarket {
  return {
    kalshiTicker: "KXNFLPASSYDS-26SEP13BALIND-BALLJACKSON8-225",
    kalshiEventTicker: "KXNFLPASSYDS-26SEP13BALIND",
    kalshiSeriesTicker: "KXNFLPASSYDS",
    title: "Lamar Jackson: 225+ passing yards",
    playerName: "Lamar Jackson",
    statType: "passing_yards",
    threshold: 224.5,
    gameDate: { year: 2026, month: 9, day: 13 },
    awayCode: "BAL",
    homeCode: "IND",
    closeTime: null,
    marketStatus: "active",
    ...overrides,
  };
}

type Candidate = { id: string; fullName: string; position: string | null };

function makeDb(opts: {
  candidates: Candidate[];
  recentPlayerIds?: string[];
  game?: { id: string } | null;
}) {
  const create = jest.fn().mockResolvedValue({});
  const update = jest.fn().mockResolvedValue({});
  return {
    db: {
      playerExternalId: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create,
        update,
      },
      player: {
        findMany: jest.fn().mockResolvedValue(opts.candidates),
      },
      game: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.game === undefined ? { id: "game1" } : opts.game,
          ),
      },
      playerGameStat: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            (opts.recentPlayerIds ?? []).map((playerId) => ({ playerId })),
          ),
      },
    } as never,
    create,
  };
}

describe("resolveContract — same-name disambiguation", () => {
  it("resolves to the position-eligible player (QB, not a same-name CB) for passing yards", async () => {
    const { db } = makeDb({
      candidates: [
        { id: "qb", fullName: "Lamar Jackson", position: "QB" },
        { id: "cb", fullName: "Lamar Jackson", position: "CB" },
      ],
    });
    const result = await resolveContract(parsed(), db);
    expect(result.playerId).toBe("qb");
    expect(result.resolutionStatus).toBe("resolved");
  });

  it("breaks a position tie by recent activity (WR Jr over retired RB Sr) for receptions", async () => {
    // Both a WR and an RB are eligible for a receptions market, so position
    // alone cannot decide — the currently-active player wins.
    const { db } = makeDb({
      candidates: [
        { id: "jr", fullName: "Michael Pittman Jr.", position: "WR" },
        { id: "sr", fullName: "Michael Pittman", position: "RB" },
      ],
      recentPlayerIds: ["jr"],
    });
    const result = await resolveContract(
      parsed({
        playerName: "Michael Pittman Jr.",
        statType: "receptions" as StatType,
        title: "Michael Pittman Jr.: 6+ receptions",
      }),
      db,
    );
    expect(result.playerId).toBe("jr");
    expect(result.resolutionStatus).toBe("resolved");
  });

  it("stays ambiguous when two eligible same-name players are both currently active", async () => {
    const { db } = makeDb({
      candidates: [
        { id: "a", fullName: "John Smith", position: "WR" },
        { id: "b", fullName: "John Smith", position: "RB" },
      ],
      recentPlayerIds: ["a", "b"],
    });
    const result = await resolveContract(
      parsed({
        playerName: "John Smith",
        statType: "receptions" as StatType,
        title: "John Smith: 5+ receptions",
      }),
      db,
    );
    expect(result.playerId).toBeNull();
    expect(result.resolutionStatus).toBe("ambiguous");
  });

  it("leaves unresolved when the only same-name match cannot play the stat's position", async () => {
    const { db } = makeDb({
      candidates: [{ id: "cb", fullName: "Lamar Jackson", position: "CB" }],
    });
    const result = await resolveContract(parsed(), db);
    expect(result.playerId).toBeNull();
    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.resolutionNote).toMatch(/none play a position/i);
  });

  it("still resolves an ordinary single match (regression)", async () => {
    const { db } = makeDb({
      candidates: [{ id: "one", fullName: "Ja'Marr Chase", position: "WR" }],
    });
    const result = await resolveContract(
      parsed({
        playerName: "Ja'Marr Chase",
        statType: "receiving_yards" as StatType,
        title: "Ja'Marr Chase: 74.5+ receiving yards",
      }),
      db,
    );
    expect(result.playerId).toBe("one");
    expect(result.resolutionStatus).toBe("resolved");
  });
});
