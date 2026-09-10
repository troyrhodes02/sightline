/**
 * The grouped slate read (SIG-95): games → players → props, reshaping the SAME
 * rows `readSlate` produces. These tests attack the grouping and best-
 * opportunity contract — one player once per game, a below-direction prop able
 * to win, and structural admin-field absence for viewers — against mocked
 * seams so the arithmetic and the shape are what is under test, not the DB.
 */
jest.mock("./read", () => ({
  readSlate: jest.fn(),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    playerGameContext: { findMany: jest.fn() },
    adjustmentSuggestion: { findMany: jest.fn() },
  },
}));
jest.mock("@/env", () => ({
  serverEnv: () => ({ PRICE_ONVIEW_FRESHNESS_SECONDS: 300 }),
}));

import { readSlate } from "./read";
import { prisma } from "@/lib/prisma";
import { readSlateGrouped, evaluateThreshold } from "./read-grouped";
import type { SlateDto, SlateRowDto } from "@/lib/dto/slate";

const mockReadSlate = readSlate as jest.Mock;
const mockPrisma = prisma as unknown as {
  playerGameContext: { findMany: jest.Mock };
  adjustmentSuggestion: { findMany: jest.Mock };
};

const NOW = "2026-11-08T16:42:00.000Z";

function row(overrides: Partial<SlateRowDto> = {}): SlateRowDto {
  return {
    contractId: "c1",
    playerId: "p1",
    gameId: "g1",
    playerName: "Ja'Marr Chase",
    gameLabel: "CIN @ BAL",
    statType: "receiving_yards",
    threshold: 74.5,
    kickoffAt: "2026-11-08T18:00:00.000Z",
    modelProbability: 0.6,
    confidence: "high",
    projectionComputedAt: "2026-11-08T16:00:00.000Z",
    informationCutoff: "2026-11-08T15:00:00.000Z",
    staleness: {
      isStale: false,
      predatesInactives: false,
      inactivesExpectedAt: null,
    },
    projectionAge: "42m",
    yesBidCents: 52,
    yesAskCents: 54,
    noBidCents: 46,
    noAskCents: 48,
    priceObservedAt: "2026-11-08T16:41:00.000Z",
    priceAge: "1m",
    side: "yes",
    edgePoints: 6,
    confidenceAdjustedEdge: 6,
    isRecommended: true,
    modelVersion: "baseline-zil-0.1.0",
    projectionState: "projected",
    ...overrides,
  };
}

function slate(rows: SlateRowDto[]): SlateDto {
  return {
    generatedAt: NOW,
    slateDate: "2026-11-08T18:00:00.000Z",
    gameCount: 1,
    rows,
    unresolved: [],
    lastSync: { status: "complete", finishedAt: NOW },
    degraded: false,
    nextKickoffAt: "2026-11-08T18:00:00.000Z",
  };
}

beforeEach(() => {
  mockPrisma.playerGameContext.findMany.mockResolvedValue([]);
  mockPrisma.adjustmentSuggestion.findMany.mockResolvedValue([]);
});

describe("readSlateGrouped grouping", () => {
  it("groups one player once per game with all props across stat types", async () => {
    mockReadSlate.mockResolvedValue(
      slate([
        row({ contractId: "c1", statType: "receiving_yards", threshold: 74.5 }),
        row({ contractId: "c2", statType: "receiving_yards", threshold: 99.5 }),
        row({ contractId: "c3", statType: "receptions", threshold: 5.5 }),
      ]),
    );

    const grouped = await readSlateGrouped("viewer");

    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].players).toHaveLength(1);
    const card = grouped.games[0].players[0];
    expect(card.playerId).toBe("p1");
    // Three rows, each yielding above+below → six props.
    expect(card.props).toHaveLength(6);
    expect(card.statTypes).toEqual(["receiving_yards", "receptions"]);
  });

  it("derives availableStatTypes and availableGames from the data, not a hardcode", async () => {
    mockReadSlate.mockResolvedValue(
      slate([
        row({ contractId: "c1", statType: "receiving_yards" }),
        row({
          contractId: "c2",
          statType: "rushing_yards",
          playerId: "p2",
          playerName: "Chase Brown",
          gameId: "g2",
          gameLabel: "KC @ DEN",
        }),
      ]),
    );

    const grouped = await readSlateGrouped("viewer");
    expect(grouped.availableStatTypes).toEqual([
      "receiving_yards",
      "rushing_yards",
    ]);
    expect(grouped.availableGames).toEqual([
      { gameId: "g1", label: "CIN @ BAL" },
      { gameId: "g2", label: "KC @ DEN" },
    ]);
  });

  it("carries admin decision fields for admins and omits them structurally for viewers", async () => {
    const decidedRow = row({ currentDisposition: "took", decidedAt: NOW });
    mockReadSlate.mockResolvedValue(slate([decidedRow]));

    const asAdmin = await readSlateGrouped("admin");
    expect(asAdmin.games[0].players[0].currentDisposition).toBe("took");
    expect(asAdmin.games[0].players[0].decidedAt).toBe(NOW);

    // The viewer branch never receives decision-bearing rows from readSlate,
    // so even if one leaked in, the viewer card must not expose it.
    mockReadSlate.mockResolvedValue(slate([row()]));
    const asViewer = await readSlateGrouped("viewer");
    expect("currentDisposition" in asViewer.games[0].players[0]).toBe(false);
    expect("decidedAt" in asViewer.games[0].players[0]).toBe(false);
  });
});

describe("best opportunity (RD-5, both directions eligible)", () => {
  it("picks the max confidence-adjusted edge across a player's props", async () => {
    mockReadSlate.mockResolvedValue(
      slate([
        row({
          contractId: "c1",
          threshold: 74.5,
          confidenceAdjustedEdge: 3,
          edgePoints: 3,
        }),
        row({
          contractId: "c2",
          threshold: 99.5,
          confidenceAdjustedEdge: 8,
          edgePoints: 8,
        }),
      ]),
    );
    const grouped = await readSlateGrouped("viewer");
    const best = grouped.games[0].players[0].bestOpportunity;
    expect(best?.confidenceAdjustedEdge).toBe(8);
    expect(best?.threshold).toBe(99.5);
    expect(best?.direction).toBe("above");
  });

  it("lets a below-direction prop be the best opportunity when the chosen side is 'no'", async () => {
    // The row's better executable side is NO: edge belongs to the below prop.
    mockReadSlate.mockResolvedValue(
      slate([
        row({
          contractId: "c1",
          side: "no",
          modelProbability: 0.3,
          edgePoints: 9,
          confidenceAdjustedEdge: 9,
          isRecommended: true,
        }),
      ]),
    );
    const grouped = await readSlateGrouped("viewer");
    const best = grouped.games[0].players[0].bestOpportunity;
    expect(best).not.toBeNull();
    expect(best?.direction).toBe("below");
    expect(best?.confidenceAdjustedEdge).toBe(9);
    // The complementary above prop carries no edge (it was not the chosen side).
    const above = grouped.games[0].players[0].props.find(
      (prop) => prop.direction === "above",
    );
    expect(above?.confidenceAdjustedEdge).toBeNull();
  });

  it("is null when no prop has a computable edge", async () => {
    mockReadSlate.mockResolvedValue(
      slate([
        row({
          side: null,
          edgePoints: null,
          confidenceAdjustedEdge: null,
          isRecommended: false,
          yesAskCents: null,
          noAskCents: null,
        }),
      ]),
    );
    const grouped = await readSlateGrouped("viewer");
    expect(grouped.games[0].players[0].bestOpportunity).toBeNull();
  });
});

describe("complementary props (RD-1)", () => {
  it("below probability is 1 − above and null stays null", async () => {
    mockReadSlate.mockResolvedValue(
      slate([
        row({ modelProbability: 0.6 }),
        row({ contractId: "c2", modelProbability: null }),
      ]),
    );
    const grouped = await readSlateGrouped("viewer");
    const props = grouped.games[0].players[0].props;
    const first = props.filter((p) => p.contractId === "c1");
    const above = first.find((p) => p.direction === "above")!;
    const below = first.find((p) => p.direction === "below")!;
    expect(above.modelProbability).toBe(0.6);
    expect(below.modelProbability).toBeCloseTo(0.4, 12);

    const nullBelow = props.find(
      (p) => p.contractId === "c2" && p.direction === "below",
    )!;
    expect(nullBelow.modelProbability).toBeNull();
  });
});

describe("evaluateThreshold (RD-1 helper)", () => {
  it("returns complementary probabilities summing to exactly 1 for an integer NB threshold", () => {
    // 0..4 plus a (5+) tail bucket.
    const pmf = [0.62, 0.24, 0.09, 0.03, 0.015, 0.005];
    const result = evaluateThreshold(
      { distributionKind: "negative_binomial", params: {}, pmf },
      2,
    )!;
    expect(result.probabilityAbove + result.probabilityBelow).toBe(1);
  });

  it("returns null for a distribution that cannot be priced", () => {
    expect(
      evaluateThreshold(
        { distributionKind: "unknown-v9", params: {}, pmf: null },
        2,
      ),
    ).toBeNull();
  });
});
