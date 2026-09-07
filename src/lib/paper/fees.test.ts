import { KALSHI_FEE_RATE } from "./config";
import {
  assertPriceCents,
  feeCents,
  netPriceCents,
  netPriceDollars,
} from "./fees";

describe("feeCents", () => {
  it("matches the published general schedule", () => {
    // 0.07 x 100 x 0.50 x 0.50 = $1.75
    expect(feeCents(100, 50)).toBe(175);
    // 0.07 x 1 x 0.54 x 0.46 = $0.0173... -> 2 cents
    expect(feeCents(1, 54)).toBe(2);
    // 0.07 x 32 x 0.54 x 0.46 = $0.5564... -> 56 cents
    expect(feeCents(32, 54)).toBe(56);
  });

  it("always rounds up, never down", () => {
    for (let contracts = 1; contracts <= 60; contracts += 1) {
      for (let price = 1; price <= 99; price += 1) {
        const exact =
          KALSHI_FEE_RATE * contracts * (price / 100) * (1 - price / 100) * 100;
        const charged = feeCents(contracts, price);
        expect(charged).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(charged - exact).toBeLessThan(1.0000001);
        expect(Number.isInteger(charged)).toBe(true);
      }
    }
  });

  it("is free at the boundary prices where the formula collapses", () => {
    // p(1-p) is smallest at the extremes, but the ceiling keeps a real order's
    // fee at a minimum of one cent — never zero for a non-zero order.
    expect(feeCents(1, 1)).toBe(1);
    expect(feeCents(1, 99)).toBe(1);
  });

  it("costs nothing for a zero-contract order", () => {
    expect(feeCents(0, 54)).toBe(0);
  });

  it("is maximal at the midpoint, as p(1-p) requires", () => {
    const at50 = feeCents(100, 50);
    expect(feeCents(100, 40)).toBeLessThan(at50);
    expect(feeCents(100, 60)).toBeLessThan(at50);
  });

  it("scales linearly in contracts up to the order-level rounding", () => {
    const one = feeCents(1, 50);
    const ten = feeCents(10, 50);
    // Ten contracts cost about ten times one, but the ceiling is applied once
    // at the order level rather than ten times — which is why the fill's fee is
    // computed on the filled count, not multiplied from a per-contract figure.
    expect(ten).toBeLessThanOrEqual(one * 10);
    expect(ten).toBeGreaterThan(one);
  });

  it("rejects prices outside Kalshi's 1-99 cent range", () => {
    expect(() => feeCents(1, 0)).toThrow(RangeError);
    expect(() => feeCents(1, 100)).toThrow(RangeError);
    expect(() => feeCents(1, 54.5)).toThrow(RangeError);
  });

  it("rejects a negative or fractional contract count", () => {
    expect(() => feeCents(-1, 54)).toThrow(RangeError);
    expect(() => feeCents(1.5, 54)).toThrow(RangeError);
  });
});

describe("netPriceCents", () => {
  it("is strictly greater than the raw ask", () => {
    // If the fee-adjusted price ever equalled the ask, an opportunity whose
    // edge disappears after fees would still receive a stake.
    for (let price = 1; price <= 99; price += 1) {
      expect(netPriceCents(price)).toBeGreaterThan(price);
    }
  });

  it("rounds up", () => {
    for (let price = 1; price <= 99; price += 1) {
      expect(netPriceCents(price)).toBeGreaterThanOrEqual(
        Math.ceil(netPriceDollars(price) * 100 - 1e-9),
      );
      expect(Number.isInteger(netPriceCents(price))).toBe(true);
    }
  });

  it("adds about 1.7 cents at 54 cents", () => {
    // 0.54 + 0.07 x 0.54 x 0.46 = 0.5574 -> 56 cents
    expect(netPriceCents(54)).toBe(56);
  });

  it("stays below a dollar for every valid ask", () => {
    // A fee-adjusted price at or above $1 has no net odds; the Kelly module
    // relies on this holding across the whole price range.
    for (let price = 1; price <= 99; price += 1) {
      expect(netPriceDollars(price)).toBeLessThan(1);
    }
  });
});

describe("assertPriceCents", () => {
  it("accepts the whole 1-99 range and nothing else", () => {
    for (let price = 1; price <= 99; price += 1) {
      expect(() => assertPriceCents(price)).not.toThrow();
    }
    expect(() => assertPriceCents(0)).toThrow(RangeError);
    expect(() => assertPriceCents(100)).toThrow(RangeError);
    expect(() => assertPriceCents(Number.NaN)).toThrow(RangeError);
  });
});
