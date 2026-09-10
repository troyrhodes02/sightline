import {
  SuggestionNotFoundError,
  acceptSuggestion,
  declineSuggestion,
} from "./actions";

jest.mock("@/lib/prisma", () => {
  const tx = {
    adjustmentSuggestion: { update: jest.fn() },
    contract: { findMany: jest.fn().mockResolvedValue([{ id: "contract-1" }]) },
    paperPosition: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    prisma: {
      adjustmentSuggestion: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { prisma } from "@/lib/prisma";

const findUnique = prisma.adjustmentSuggestion
  .findUnique as jest.MockedFunction<
  typeof prisma.adjustmentSuggestion.findUnique
>;
// @ts-expect-error test-only handle on the transaction client
const tx = prisma.__tx as {
  adjustmentSuggestion: { update: jest.Mock };
  contract: { findMany: jest.Mock };
  paperPosition: { updateMany: jest.Mock };
};

const PENDING = {
  id: "s1",
  status: "pending",
  targetPlayerId: "p1",
  gameId: "g1",
  statType: "receiving_yards",
  baseProjectionId: "base-1",
  shadowProjectionId: "shadow-1",
};

beforeEach(() => jest.clearAllMocks());

describe("acceptSuggestion", () => {
  it("accepts a pending suggestion, activates the shadow, and annotates the position", async () => {
    findUnique.mockResolvedValueOnce(PENDING as never);
    const now = new Date("2026-11-02T15:40:00Z");
    const result = await acceptSuggestion("s1", "admin-user", now);

    expect(result.outcome).toBe("applied");
    expect(result.statusNow).toBe("accepted");
    expect(result.activeProjectionId).toBe("shadow-1"); // shadow becomes active
    expect(tx.adjustmentSuggestion.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: {
        status: "accepted",
        decidedByUserId: "admin-user",
        decidedAt: now,
      },
    });
    // decision 8: an open position is annotated, never exited.
    expect(tx.paperPosition.updateMany).toHaveBeenCalled();
  });

  it("is idempotent — accepting an already-accepted suggestion is unchanged", async () => {
    findUnique.mockResolvedValueOnce({
      ...PENDING,
      status: "accepted",
    } as never);
    const result = await acceptSuggestion("s1", "admin-user");
    expect(result.outcome).toBe("unchanged");
    expect(tx.adjustmentSuggestion.update).not.toHaveBeenCalled();
  });

  it("refuses to accept a declined suggestion (invalid transition)", async () => {
    findUnique.mockResolvedValueOnce({
      ...PENDING,
      status: "declined",
    } as never);
    const result = await acceptSuggestion("s1", "admin-user");
    expect(result.outcome).toBe("invalid");
    expect(result.statusNow).toBe("declined");
  });

  it("throws when the suggestion does not exist", async () => {
    findUnique.mockResolvedValueOnce(null as never);
    await expect(
      acceptSuggestion("missing", "admin-user"),
    ).rejects.toBeInstanceOf(SuggestionNotFoundError);
  });
});

describe("declineSuggestion", () => {
  it("declines a pending suggestion and keeps the base active", async () => {
    findUnique.mockResolvedValueOnce(PENDING as never);
    const result = await declineSuggestion("s1", "admin-user");
    expect(result.outcome).toBe("applied");
    expect(result.statusNow).toBe("declined");
    expect(result.activeProjectionId).toBe("base-1"); // base stays active
    // Declining never touches a position (no exposure change of any kind).
    expect(tx.paperPosition.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-declined suggestion", async () => {
    findUnique.mockResolvedValueOnce({
      ...PENDING,
      status: "declined",
    } as never);
    const result = await declineSuggestion("s1", "admin-user");
    expect(result.outcome).toBe("unchanged");
  });
});
