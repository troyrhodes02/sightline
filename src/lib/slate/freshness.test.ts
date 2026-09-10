/**
 * The five-state freshness derivation (RD-9): a display mapping over existing
 * signals that must never merge the two clocks — a fresh price cannot clear a
 * stale projection.
 */
import { deriveFreshness } from "./freshness";
import type { StalenessDto } from "@/lib/dto/slate";

const NOW = new Date("2026-11-08T16:42:00.000Z");
const FRESH_SECONDS = 300;

const staleness = (over: Partial<StalenessDto> = {}): StalenessDto => ({
  isStale: false,
  predatesInactives: false,
  inactivesExpectedAt: null,
  ...over,
});

const base = {
  projectionComputedAt: "2026-11-08T16:00:00.000Z",
  informationCutoff: "2026-11-08T15:00:00.000Z",
  now: NOW,
};

describe("deriveFreshness", () => {
  it("unavailable when there is no projection", () => {
    const result = deriveFreshness(
      { ...base, staleness: null, priceObservedAt: "2026-11-08T16:41:00.000Z" },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("unavailable");
  });

  it("unavailable when Kalshi is degraded and no price is present", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness(),
        priceObservedAt: null,
        priceDegraded: true,
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("unavailable");
  });

  it("stale when the projection is stale, even under a perfectly fresh price", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness({ isStale: true }),
        priceObservedAt: NOW.toISOString(),
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("stale");
  });

  it("stale when the projection predates inactives", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness({ predatesInactives: true }),
        priceObservedAt: NOW.toISOString(),
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("stale");
  });

  it("new_info_pending when a material suggestion is pending and projection is fine", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness(),
        priceObservedAt: NOW.toISOString(),
        hasPendingSuggestion: true,
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("new_info_pending");
  });

  it("current when projection is fine and the price is within the interval", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness(),
        priceObservedAt: "2026-11-08T16:41:00.000Z", // 1m old
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("current");
  });

  it("updated_recently when the price is older than the interval but projection is fine", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness(),
        priceObservedAt: "2026-11-08T16:30:00.000Z", // 12m old > 5m interval
      },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("updated_recently");
  });

  it("current (not updated_recently) when the projection is fine and there is no price at all", () => {
    // A never-priced contract, or Prop Research (which carries no price), must
    // reflect the current projection — not a phantom "recently refreshed" price.
    const result = deriveFreshness(
      { ...base, staleness: staleness(), priceObservedAt: null },
      FRESH_SECONDS,
    );
    expect(result.state).toBe("current");
  });

  it("retains both clocks unchanged in the payload (never merged)", () => {
    const result = deriveFreshness(
      {
        ...base,
        staleness: staleness(),
        priceObservedAt: "2026-11-08T16:41:00.000Z",
      },
      FRESH_SECONDS,
    );
    expect(result.projectionComputedAt).toBe("2026-11-08T16:00:00.000Z");
    expect(result.informationCutoff).toBe("2026-11-08T15:00:00.000Z");
    expect(result.priceObservedAt).toBe("2026-11-08T16:41:00.000Z");
  });
});
