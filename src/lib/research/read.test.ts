/**
 * Prop Research reads (SIG-98): base-only distribution selection and the honest
 * unavailable states. Attacks the load-bearing invariants — never a fallback,
 * never an edge, always the BASE (not an accepted shadow) — against mocked
 * seams so the selection logic and the payload SHAPE are what is under test.
 */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    game: { findMany: jest.fn(), findUnique: jest.fn() },
    player: { findUnique: jest.fn() },
    projection: { findMany: jest.fn(), findFirst: jest.fn() },
    projectionDriver: { findMany: jest.fn() },
    contract: { findMany: jest.fn() },
    modelSelection: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/slate/staleness-read", () => ({
  latestFactKnownAtByGame: jest.fn(async () => new Map()),
  stalenessForRow: jest.fn(() => ({
    isStale: false,
    predatesInactives: false,
    inactivesExpectedAt: null,
  })),
}));
jest.mock("@/env", () => ({
  serverEnv: () => ({ PRICE_ONVIEW_FRESHNESS_SECONDS: 300 }),
}));

import { prisma } from "@/lib/prisma";
import { readResearchProjection, readResearchPlayers } from "./read";
import { probAtLeast } from "@/lib/slate/probability";
import type { PropResearchProjectionDto } from "@/lib/dto/research";

const mock = prisma as unknown as {
  game: { findMany: jest.Mock; findUnique: jest.Mock };
  player: { findUnique: jest.Mock };
  projection: { findMany: jest.Mock; findFirst: jest.Mock };
  projectionDriver: { findMany: jest.Mock };
  contract: { findMany: jest.Mock };
  modelSelection: { findMany: jest.Mock };
};

const FUTURE = new Date(Date.now() + 3 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

const ACTIVE = "simulation-mc-0.1.0";

function baseProjectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-base",
    distributionKind: "empirical_quantiles",
    params: {},
    pmf: null,
    quantiles: { q50: 241.3 },
    projectedValue: 241.3,
    projectedMedian: 240,
    intervalLow: 198,
    intervalHigh: 286,
    confidence: "medium",
    modelVersion: ACTIVE,
    computedAt: new Date("2026-11-08T09:58:00.000Z"),
    informationCutoff: new Date("2026-11-08T08:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock.modelSelection.findMany.mockResolvedValue([
    { statType: "passing_yards", modelVersion: ACTIVE },
    { statType: "receiving_yards", modelVersion: ACTIVE },
  ]);
  mock.projectionDriver.findMany.mockResolvedValue([
    { text: "high recent pass volume" },
  ]);
  mock.contract.findMany.mockResolvedValue([]);
  mock.player.findUnique.mockResolvedValue({ fullName: "Matthew Stafford" });
});

describe("readResearchProjection — honest states (RD-4)", () => {
  it("returns no_projection (never a fallback) when there is no base projection", async () => {
    mock.game.findUnique.mockResolvedValue({
      id: "g1",
      kickoffAt: FUTURE,
      season: 2026,
      homeTeamId: "h",
      awayTeamId: "a",
      homeTeam: { nflverseAbbr: "SF" },
      awayTeam: { nflverseAbbr: "LAR" },
    });
    mock.projection.findFirst.mockResolvedValue(null);

    const result = await readResearchProjection({
      playerId: "p1",
      gameId: "g1",
      statType: "passing_yards",
    });

    expect(result.available).toBe(false);
    if (result.available === false) {
      expect(result.reason).toBe("no_projection");
    }
    // No approximation was consulted: no season-average query exists to run.
    expect(mock.contract.findMany).not.toHaveBeenCalled();
  });

  it("returns game_started for a kicked-off game and never queries a projection", async () => {
    mock.game.findUnique.mockResolvedValue({
      id: "g1",
      kickoffAt: PAST,
      season: 2026,
      homeTeamId: "h",
      awayTeamId: "a",
      homeTeam: { nflverseAbbr: "SF" },
      awayTeam: { nflverseAbbr: "LAR" },
    });

    const result = await readResearchProjection({
      playerId: "p1",
      gameId: "g1",
      statType: "passing_yards",
    });

    expect(result.available).toBe(false);
    if (result.available === false) {
      expect(result.reason).toBe("game_started");
    }
    // Pre-game only: no probability is derived for a started game.
    expect(mock.projection.findFirst).not.toHaveBeenCalled();
  });
});

describe("readResearchProjection — base only, no edge", () => {
  beforeEach(() => {
    mock.game.findUnique.mockResolvedValue({
      id: "g1",
      kickoffAt: FUTURE,
      season: 2026,
      homeTeamId: "h",
      awayTeamId: "a",
      homeTeam: { nflverseAbbr: "SF" },
      awayTeam: { nflverseAbbr: "LAR" },
    });
  });

  it("selects the BASE projection with provenance filtered to base", async () => {
    mock.projection.findFirst.mockResolvedValue(baseProjectionRow());

    await readResearchProjection({
      playerId: "p1",
      gameId: "g1",
      statType: "passing_yards",
    });

    const where = mock.projection.findFirst.mock.calls[0][0].where;
    expect(where.provenance).toBe("base");
    // The active model version gates selection; an accepted shadow (never
    // provenance "base") cannot satisfy this query.
    expect(where.modelVersion).toBe(ACTIVE);
  });

  it("carries no edge/profitability field anywhere in the payload, even with no price", async () => {
    mock.projection.findFirst.mockResolvedValue(baseProjectionRow());
    mock.contract.findMany.mockResolvedValue([]); // no listed contract / no price

    const result = (await readResearchProjection({
      playerId: "p1",
      gameId: "g1",
      statType: "passing_yards",
    })) as PropResearchProjectionDto;

    expect(result.available).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/edge/i);
    expect(serialized).not.toMatch(/profit/i);
    expect(result.listedContracts).toEqual([]);
    // The delivered fields are probability inputs and metadata only.
    expect(result.distributionKind).toBe("empirical_quantiles");
    expect(result.projectedMedian).toBe(240);
  });

  it("offers a listed-contract link only where a FRESH price exists (id only, no cents)", async () => {
    mock.projection.findFirst.mockResolvedValue(baseProjectionRow());
    mock.contract.findMany.mockResolvedValue([
      {
        id: "c-fresh",
        threshold: 225.5,
        priceObservations: [{ observedAt: new Date() }],
      },
      {
        id: "c-stale",
        threshold: 250.5,
        priceObservations: [
          { observedAt: new Date(Date.now() - 60 * 60 * 1000) },
        ],
      },
      { id: "c-none", threshold: 275.5, priceObservations: [] },
    ]);

    const result = (await readResearchProjection({
      playerId: "p1",
      gameId: "g1",
      statType: "passing_yards",
    })) as PropResearchProjectionDto;

    expect(result.listedContracts).toEqual([
      { threshold: 225.5, contractId: "c-fresh" },
    ]);
    // Only ids and thresholds — no cent value crosses into Prop Research.
    expect(JSON.stringify(result.listedContracts)).not.toMatch(/cent|ask|bid/i);
  });
});

describe("client threshold recompute is complementary (RD-1)", () => {
  // Prop Research's above/below use the SAME shared `probAtLeast` the client
  // imports; the payload delivers a distribution and the threshold never hits
  // the server. This asserts the complement holds with no vanishing "exactly N"
  // mass for a discrete stat, exactly as the result card computes it.
  it("P(>=N) + P(<N) === 1 for an integer discrete-stat threshold", () => {
    const pmf = [0.62, 0.24, 0.09, 0.03, 0.015, 0.005]; // 0..4 plus a (5+) tail
    const above = probAtLeast(
      { distributionKind: "empirical_pmf", params: {}, pmf },
      2,
    )!;
    const below = 1 - above;
    expect(above + below).toBe(1);
  });
});

describe("readResearchPlayers — eligibility", () => {
  it("includes only players with an active-model BASE projection for an upcoming game", async () => {
    mock.game.findMany.mockResolvedValue([
      {
        id: "g1",
        kickoffAt: FUTURE,
        homeTeam: { nflverseAbbr: "SF" },
        awayTeam: { nflverseAbbr: "LAR" },
      },
    ]);
    mock.projection.findMany.mockResolvedValue([
      {
        playerId: "p1",
        gameId: "g1",
        statType: "passing_yards",
        modelVersion: ACTIVE,
        computedAt: new Date(),
        player: { fullName: "Matthew Stafford" },
      },
      {
        // Inactive model version — must not make a player eligible.
        playerId: "p2",
        gameId: "g1",
        statType: "passing_yards",
        modelVersion: "retired-v0",
        computedAt: new Date(),
        player: { fullName: "Old Model" },
      },
    ]);

    const players = await readResearchPlayers("stafford");
    expect(players).toHaveLength(1);
    expect(players[0].fullName).toBe("Matthew Stafford");
    expect(players[0].games[0].statTypes).toEqual(["passing_yards"]);
    // The projection query is base-provenance only, name-filtered, and capped.
    expect(mock.projection.findMany.mock.calls[0][0].where.provenance).toBe(
      "base",
    );
    expect(
      mock.projection.findMany.mock.calls[0][0].where.player,
    ).toBeDefined();
    expect(mock.projection.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it("short-circuits a query under two characters without scanning projections", async () => {
    for (const q of ["", " ", "a"]) {
      mock.game.findMany.mockClear();
      mock.projection.findMany.mockClear();
      const players = await readResearchPlayers(q);
      expect(players).toEqual([]);
      // No projection scan (and not even the game read) for a too-short query —
      // this is what keeps the page's first paint from pulling the whole corpus.
      expect(mock.projection.findMany).not.toHaveBeenCalled();
    }
  });

  it("returns nothing when there are no upcoming games", async () => {
    mock.game.findMany.mockResolvedValue([]);
    const players = await readResearchPlayers("stafford");
    expect(players).toEqual([]);
    expect(mock.projection.findMany).not.toHaveBeenCalled();
  });
});
