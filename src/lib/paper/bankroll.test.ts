import {
  bidOnHeldSide,
  drawdownBps,
  markToMarket,
  nextHighWaterMark,
  openExposureCents,
  realizedPnlCents,
  settlementProceedsCents,
  withdrawalCents,
  type OpenPositionMark,
} from "./bankroll";

function open(over: Partial<OpenPositionMark> = {}): OpenPositionMark {
  return {
    positionId: "p1",
    side: "yes",
    contracts: 32,
    costBasisCents: 1_728,
    feesPaidCents: 56,
    bidCentsOnHeldSide: 60,
    ...over,
  };
}

describe("openExposureCents", () => {
  it("counts cost basis AND the fees paid", () => {
    // A Kalshi position's maximum loss is what was paid, and the fee was paid.
    expect(openExposureCents([open()])).toBe(1_784);
  });

  it("is zero with nothing open", () => {
    expect(openExposureCents([])).toBe(0);
  });
});

describe("bidOnHeldSide", () => {
  it("reads the bid on the side actually held", () => {
    const observation = { yesBidCents: 53, noBidCents: 44 };
    expect(bidOnHeldSide("yes", observation)).toBe(53);
    expect(bidOnHeldSide("no", observation)).toBe(44);
  });

  it("returns null for a missing or unusable bid", () => {
    expect(bidOnHeldSide("yes", null)).toBeNull();
    expect(
      bidOnHeldSide("yes", { yesBidCents: null, noBidCents: 44 }),
    ).toBeNull();
    expect(
      bidOnHeldSide("yes", { yesBidCents: -1, noBidCents: 44 }),
    ).toBeNull();
    expect(
      bidOnHeldSide("yes", { yesBidCents: 101, noBidCents: 44 }),
    ).toBeNull();
  });
});

describe("markToMarket", () => {
  it("values open positions at the BID, not the ask", () => {
    // The bid is what could be realised. The ask is what it would cost to buy
    // the position again, and using it would inflate the account by the spread
    // on every position — most where the market is thinnest, which is exactly
    // where the model's apparent edges are largest.
    const mark = markToMarket(50_000, [
      open({ contracts: 10, bidCentsOnHeldSide: 60 }),
    ]);
    expect(mark).toEqual({
      available: true,
      markCents: 50_600,
      openValueCents: 600,
    });
  });

  it("is unavailable — not approximate — when any position has no bid", () => {
    const mark = markToMarket(50_000, [
      open({ positionId: "a" }),
      open({ positionId: "b", bidCentsOnHeldSide: null }),
    ]);
    expect(mark.available).toBe(false);
    if (!mark.available) expect(mark.missingPositionIds).toEqual(["b"]);
  });

  it("equals the settled balance with nothing open", () => {
    const mark = markToMarket(50_000, []);
    expect(mark).toEqual({
      available: true,
      markCents: 50_000,
      openValueCents: 0,
    });
  });
});

describe("drawdownBps", () => {
  it("measures the fall from the high-water mark", () => {
    const mark = markToMarket(91_240, []);
    expect(drawdownBps(102_790, mark)).toBe(1_124); // 11.24%
  });

  it("is zero above the high-water mark, never negative", () => {
    expect(drawdownBps(100_000, markToMarket(110_000, []))).toBe(0);
  });

  it("propagates unavailability rather than falling back to settled-only", () => {
    // A drawdown computed on a different basis than the breaker's would
    // misstate the safety state, which is the one thing this number is for.
    const mark = markToMarket(50_000, [open({ bidCentsOnHeldSide: null })]);
    expect(drawdownBps(100_000, mark)).toBeNull();
  });

  it("is zero for a campaign with no high-water mark yet", () => {
    expect(drawdownBps(0, markToMarket(0, []))).toBe(0);
  });
});

describe("withdrawalCents", () => {
  it("withdraws only the excess above the working ceiling", () => {
    // $1,640 settled, $1,000 start, 1.5x ceiling -> withdraw $140.
    expect(withdrawalCents(164_000, 100_000, 1.5)).toBe(14_000);
  });

  it("withdraws nothing at or below the ceiling", () => {
    expect(withdrawalCents(150_000, 100_000, 1.5)).toBe(0);
    expect(withdrawalCents(120_000, 100_000, 1.5)).toBe(0);
  });

  it("never withdraws from a losing account", () => {
    expect(withdrawalCents(80_000, 100_000, 1.5)).toBe(0);
  });

  it("uses settled balance only, so unrealised value is never swept out", () => {
    // The caller passes the settled balance; there is deliberately no
    // mark-to-market parameter. Money the account does not yet have cannot be
    // withdrawn.
    expect(withdrawalCents.length).toBe(3);
  });
});

describe("nextHighWaterMark", () => {
  it("rises with the mark and never falls on its own", () => {
    expect(
      nextHighWaterMark({
        currentCents: 100_000,
        markCents: 110_000,
        withdrewCents: 0,
      }),
    ).toBe(110_000);
    expect(
      nextHighWaterMark({
        currentCents: 110_000,
        markCents: 90_000,
        withdrewCents: 0,
      }),
    ).toBe(110_000);
  });

  it("holds steady when the mark is unavailable", () => {
    expect(
      nextHighWaterMark({
        currentCents: 110_000,
        markCents: null,
        withdrewCents: 0,
      }),
    ).toBe(110_000);
  });

  it("RESETS to the post-withdrawal balance after a simulated withdrawal", () => {
    // Without this, banking profit would read as a loss against the
    // pre-withdrawal peak and could trip a drawdown breaker on money the
    // account deliberately removed.
    expect(
      nextHighWaterMark({
        currentCents: 164_000,
        markCents: 150_000,
        withdrewCents: 14_000,
      }),
    ).toBe(150_000);
  });
});

describe("settlementProceedsCents", () => {
  it("pays a dollar a contract on a win", () => {
    expect(
      settlementProceedsCents({
        side: "yes",
        contracts: 28,
        costBasisCents: 1_540,
        feesPaidCents: 40,
        result: "yes",
      }),
    ).toEqual({ proceedsCents: 2_800, realizedPnlCents: 1_220 });
  });

  it("pays nothing on a loss, and the loss includes the fee", () => {
    expect(
      settlementProceedsCents({
        side: "no",
        contracts: 20,
        costBasisCents: 900,
        feesPaidCents: 25,
        result: "yes",
      }),
    ).toEqual({ proceedsCents: 0, realizedPnlCents: -925 });
  });

  it("returns cost basis AND fees on a void, with zero P&L", () => {
    // A void is not a loss. Keeping it distinct all the way down to the
    // arithmetic is what stops a voided market quietly depressing the
    // campaign's apparent win rate.
    expect(
      settlementProceedsCents({
        side: "no",
        contracts: 15,
        costBasisCents: 825,
        feesPaidCents: 20,
        result: "voided",
      }),
    ).toEqual({ proceedsCents: 845, realizedPnlCents: 0 });
  });

  it("resolves a NO position winning when the market settles no", () => {
    expect(
      settlementProceedsCents({
        side: "no",
        contracts: 10,
        costBasisCents: 480,
        feesPaidCents: 12,
        result: "no",
      }).proceedsCents,
    ).toBe(1_000);
  });
});

describe("realizedPnlCents", () => {
  it("nets proceeds against cost basis and fees", () => {
    expect(
      realizedPnlCents({
        proceedsCents: 2_800,
        costBasisCents: 1_540,
        feesPaidCents: 40,
      }),
    ).toBe(1_220);
  });
});
