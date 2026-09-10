jest.mock("@/lib/prisma", () => ({
  prisma: { $transaction: jest.fn() },
}));

import { prisma } from "@/lib/prisma";
import { withPriceRefreshLock } from "./refresh-lock";

const mockPrisma = prisma as unknown as { $transaction: jest.Mock };

/**
 * Simulate the advisory lock: the FIRST transaction to run
 * `pg_try_advisory_xact_lock` acquires it (locked=true); any transaction that
 * overlaps it sees locked=false. `release()` frees it (as COMMIT would).
 */
function installLock() {
  let held = false;
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => {
      const alreadyHeld = held;
      if (!alreadyHeld) held = true;
      const tx = {
        $queryRaw: async () => [{ locked: !alreadyHeld }],
      };
      try {
        return await fn(tx);
      } finally {
        // The acquirer holds until it finishes (mirrors xact-scoped release).
        if (!alreadyHeld) held = false;
      }
    },
  );
  return { release: () => undefined };
}

describe("withPriceRefreshLock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("runs the upstream refresh exactly once when two callers contend for the same market set", async () => {
    installLock();
    const acquired = jest.fn(async () => "fresh");
    const onBusy = jest.fn(async () => "coalesced");

    // Two concurrent staleness-triggered refreshes for the same key.
    const [a, b] = await Promise.all([
      withPriceRefreshLock("price-refresh:v1", acquired, onBusy),
      withPriceRefreshLock("price-refresh:v1", acquired, onBusy),
    ]);

    // Exactly one upstream Kalshi call; the other coalesces with no call.
    expect(acquired).toHaveBeenCalledTimes(1);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect([a, b].sort()).toEqual(["coalesced", "fresh"]);
  });

  it("runs the upstream refresh when the lock is free", async () => {
    installLock();
    const acquired = jest.fn(async () => "fresh");
    const onBusy = jest.fn(async () => "coalesced");

    const result = await withPriceRefreshLock(
      "price-refresh:v1",
      acquired,
      onBusy,
    );

    expect(result).toBe("fresh");
    expect(acquired).toHaveBeenCalledTimes(1);
    expect(onBusy).not.toHaveBeenCalled();
  });
});
