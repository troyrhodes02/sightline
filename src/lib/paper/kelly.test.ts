import { CONFIDENCE_WEIGHTS } from "@/lib/slate/edge";
import { RISK_PRESETS } from "./config";
import { netPriceCents, netPriceDollars } from "./fees";
import {
  appliedKellyFraction,
  contractsForStake,
  desiredStakeCents,
  kellyEdge,
} from "./kelly";

describe("kellyEdge", () => {
  it("is positive when the corrected probability beats the fee-adjusted price", () => {
    // 58.9% against a 54c ask: fee-adjusted 55.7c, so a real edge survives.
    const edge = kellyEdge({ probability: 0.589, askCents: 54 });
    expect(edge).not.toBeNull();
    expect(edge as number).toBeGreaterThan(0);
  });

  it("is negative for an expensive near-certainty", () => {
    // The pitch's own example: a 90% probability priced at 95c. Ranking by win
    // probability would put this first; ranking by value rejects it.
    const edge = kellyEdge({ probability: 0.9, askCents: 95 });
    expect(edge).not.toBeNull();
    expect(edge as number).toBeLessThan(0);
  });

  it("ranks a genuine mispricing above an expensive near-certainty", () => {
    const nearCertain = kellyEdge({ probability: 0.9, askCents: 95 }) as number;
    const mispriced = kellyEdge({ probability: 0.55, askCents: 48 }) as number;
    expect(mispriced).toBeGreaterThan(nearCertain);
  });

  it("crosses zero exactly where the fee-adjusted edge disappears", () => {
    // At p = c_eff the bettor is paying precisely fair value after fees.
    const askCents = 54;
    const cEff = netPriceDollars(askCents);
    expect(kellyEdge({ probability: cEff, askCents })).toBeCloseTo(0, 12);
    expect(
      kellyEdge({ probability: cEff + 0.01, askCents }) as number,
    ).toBeGreaterThan(0);
    expect(
      kellyEdge({ probability: cEff - 0.01, askCents }) as number,
    ).toBeLessThan(0);
  });

  it("is strictly worse than the fee-free edge would be", () => {
    // Fees must reduce the edge at every price, or "no edge after fees" could
    // never bind.
    const p = 0.6;
    for (let ask = 20; ask <= 80; ask += 1) {
      const withFees = kellyEdge({ probability: p, askCents: ask }) as number;
      const rawC = ask / 100;
      const withoutFees = p - ((1 - p) * rawC) / (1 - rawC);
      expect(withFees).toBeLessThan(withoutFees);
    }
  });

  it("returns null — not zero — when the probability cannot be priced", () => {
    // "No projection" and "no edge" are different states all the way to the
    // candidate row and the screen.
    expect(kellyEdge({ probability: null, askCents: 54 })).toBeNull();
    expect(kellyEdge({ probability: 0.6, askCents: null })).toBeNull();
    expect(kellyEdge({ probability: 0, askCents: 54 })).toBeNull();
    expect(kellyEdge({ probability: 1, askCents: 54 })).toBeNull();
  });

  it("never exceeds the probability itself", () => {
    // f* = p - q c/(1-c) with a positive second term, so the fraction of
    // bankroll is bounded above by p. A value above it would be arithmetic
    // gone wrong rather than an unusually good bet.
    for (let ask = 5; ask <= 95; ask += 5) {
      for (const p of [0.2, 0.4, 0.6, 0.74]) {
        const edge = kellyEdge({ probability: p, askCents: ask }) as number;
        expect(edge).toBeLessThanOrEqual(p);
      }
    }
  });
});

describe("appliedKellyFraction", () => {
  it("uses the slate's confidence weights, not a second scale", () => {
    // Importing rather than redefining is what stops the screen and the bot
    // disagreeing about what a medium-confidence projection is worth.
    expect(CONFIDENCE_WEIGHTS).toEqual({ high: 1.0, medium: 0.7, low: 0.4 });
    expect(appliedKellyFraction(0.25, "high")).toBeCloseTo(0.25, 10);
    expect(appliedKellyFraction(0.25, "medium")).toBeCloseTo(0.175, 10);
    expect(appliedKellyFraction(0.25, "low")).toBeCloseTo(0.1, 10);
  });

  it("stakes strictly less as confidence falls", () => {
    const high = appliedKellyFraction(
      RISK_PRESETS.moderate.kellyFraction,
      "high",
    );
    const medium = appliedKellyFraction(
      RISK_PRESETS.moderate.kellyFraction,
      "medium",
    );
    const low = appliedKellyFraction(
      RISK_PRESETS.moderate.kellyFraction,
      "low",
    );
    expect(medium).toBeLessThan(high);
    expect(low).toBeLessThan(medium);
  });
});

describe("desiredStakeCents", () => {
  it("floors to whole cents", () => {
    const stake = desiredStakeCents({
      kellyEdge: 0.0713,
      appliedFraction: 0.25,
      activeBankrollCents: 99_980,
    });
    expect(Number.isInteger(stake)).toBe(true);
    expect(stake).toBe(Math.floor(0.0713 * 0.25 * 99_980));
  });

  it("stakes nothing on a non-positive edge", () => {
    expect(
      desiredStakeCents({
        kellyEdge: -0.017,
        appliedFraction: 0.25,
        activeBankrollCents: 100_000,
      }),
    ).toBe(0);
    expect(
      desiredStakeCents({
        kellyEdge: 0,
        appliedFraction: 0.25,
        activeBankrollCents: 100_000,
      }),
    ).toBe(0);
  });

  it("stakes nothing on an empty bankroll", () => {
    expect(
      desiredStakeCents({
        kellyEdge: 0.07,
        appliedFraction: 0.25,
        activeBankrollCents: 0,
      }),
    ).toBe(0);
  });

  it("scales with the mode fraction and never above full Kelly", () => {
    const base = {
      kellyEdge: 0.08,
      activeBankrollCents: 100_000,
    };
    const conservative = desiredStakeCents({ ...base, appliedFraction: 0.25 });
    const aggressive = desiredStakeCents({ ...base, appliedFraction: 0.75 });
    const full = desiredStakeCents({ ...base, appliedFraction: 1 });
    expect(conservative).toBeLessThan(aggressive);
    expect(aggressive).toBeLessThan(full);
    expect(full).toBe(Math.floor(0.08 * 100_000));
  });
});

describe("contractsForStake", () => {
  it("rounds contracts down, always", () => {
    // Kalshi trades whole contracts. A stake that buys 12.9 buys twelve.
    expect(contractsForStake(720, 56)).toBe(12);
    expect(contractsForStake(719, 56)).toBe(12);
    expect(contractsForStake(671, 56)).toBe(11);
  });

  it("buys nothing when the stake is under one contract", () => {
    expect(contractsForStake(55, netPriceCents(54))).toBe(0);
    expect(contractsForStake(0, 56)).toBe(0);
  });

  it("never buys more than the stake affords at the fee-adjusted price", () => {
    for (let ask = 10; ask <= 90; ask += 7) {
      const net = netPriceCents(ask);
      for (const stake of [100, 999, 1_775, 12_500]) {
        const contracts = contractsForStake(stake, net);
        expect(contracts * net).toBeLessThanOrEqual(stake);
      }
    }
  });
});
