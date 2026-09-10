import {
  acceptedShadowProjectionIds,
  blockedSuggestionKeys,
  annotateOpenPositionProjectionChanged,
  projectionKey,
} from "./active-projection";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    adjustmentSuggestion: { findMany: jest.fn() },
    paperPosition: { updateMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";

const suggestionFindMany = prisma.adjustmentSuggestion
  .findMany as jest.MockedFunction<typeof prisma.adjustmentSuggestion.findMany>;
const positionUpdateMany = prisma.paperPosition
  .updateMany as jest.MockedFunction<typeof prisma.paperPosition.updateMany>;

const KEY = {
  playerId: "player-a",
  gameId: "game-1",
  statType: "receiving_yards" as const,
};

describe("acceptedShadowProjectionIds", () => {
  it("returns the shadow id for an accepted suggestion, keyed by player:game:stat", async () => {
    suggestionFindMany.mockResolvedValueOnce([
      {
        targetPlayerId: "player-a",
        gameId: "game-1",
        statType: "receiving_yards",
        shadowProjectionId: "shadow-1",
      },
    ] as never);

    const out = await acceptedShadowProjectionIds([KEY]);
    expect(
      out.get(projectionKey("player-a", "game-1", "receiving_yards")),
    ).toBe("shadow-1");
    // Only accepted, shadow-bearing suggestions are queried.
    expect(suggestionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "accepted",
          shadowProjectionId: { not: null },
        }),
      }),
    );
  });

  it("is empty for no keys without querying", async () => {
    const out = await acceptedShadowProjectionIds([]);
    expect(out.size).toBe(0);
    expect(suggestionFindMany).not.toHaveBeenCalled();
  });

  it("keeps the most recent acceptance when a key has more than one", async () => {
    // Ordered decidedAt desc by the query; first seen wins.
    suggestionFindMany.mockResolvedValueOnce([
      {
        targetPlayerId: "player-a",
        gameId: "game-1",
        statType: "receiving_yards",
        shadowProjectionId: "newest",
      },
      {
        targetPlayerId: "player-a",
        gameId: "game-1",
        statType: "receiving_yards",
        shadowProjectionId: "older",
      },
    ] as never);
    const out = await acceptedShadowProjectionIds([KEY]);
    expect(
      out.get(projectionKey("player-a", "game-1", "receiving_yards")),
    ).toBe("newest");
  });
});

describe("blockedSuggestionKeys", () => {
  it("blocks pending and insufficient-evidence, flagging held for the latter", async () => {
    suggestionFindMany.mockResolvedValueOnce([
      { targetPlayerId: "p1", statType: "receiving_yards", status: "pending" },
      {
        targetPlayerId: "p2",
        statType: "rushing_yards",
        status: "insufficient_evidence",
      },
    ] as never);
    const out = await blockedSuggestionKeys("game-1");
    expect(out.get("p1:receiving_yards")).toEqual({ held: false });
    expect(out.get("p2:rushing_yards")).toEqual({ held: true });
    expect(suggestionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          gameId: "game-1",
          status: { in: ["pending", "insufficient_evidence"] },
        }),
      }),
    );
  });
});

describe("annotateOpenPositionProjectionChanged", () => {
  it("annotates only the open, not-yet-annotated position, never exiting it", async () => {
    positionUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    const now = new Date("2026-11-02T15:40:00Z");
    const tx = { paperPosition: { updateMany: positionUpdateMany } };
    await annotateOpenPositionProjectionChanged(tx as never, "contract-9", now);
    expect(positionUpdateMany).toHaveBeenCalledWith({
      where: {
        contractId: "contract-9",
        status: "open",
        projectionChangedAfterEntry: false,
      },
      data: { projectionChangedAfterEntry: true, projectionChangedAt: now },
    });
    // The update sets only the annotation — no side, contracts, or status change
    // (no auto-exit, offset, or reduction).
    const call = positionUpdateMany.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(call.data).sort()).toEqual([
      "projectionChangedAfterEntry",
      "projectionChangedAt",
    ]);
  });
});
