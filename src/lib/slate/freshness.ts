import type { FreshnessStateDto, StalenessDto } from "@/lib/dto/slate";

/**
 * The five-state plain-language freshness vocabulary (spec §5, RD-9), derived
 * from the signals the slate already computes. This is a DISPLAY mapping over
 * `StalenessDto`, price age, and a material pending suggestion — not a stored
 * state and not a new fact.
 *
 * Two clocks, never merged (the invariant an agent will collapse if not told):
 * price freshness and projection freshness are distinct facts. A successful
 * price refresh never sets a projection state to non-stale, and a stale
 * projection here can sit under a perfectly fresh price. `computedAt` and
 * `informationCutoff` are carried through unchanged; only the LABEL is derived.
 *
 * Pure module: no prisma, no env — the caller supplies the price-freshness
 * threshold in seconds, the same way `computeEdge` takes its threshold and
 * `evaluateStaleness` takes its lead.
 */

export type FreshnessInputs = {
  /** The displayed projection's staleness, or null when there is no projection. */
  staleness: StalenessDto | null;
  /** The projection's compute clock; retained in the DTO. */
  projectionComputedAt: string | null;
  /** The projection's information cutoff; retained in the DTO. */
  informationCutoff: string | null;
  /** The freshest price observation's clock; the price clock, distinct from the projection clock. */
  priceObservedAt: string | null;
  /**
   * A material pending `AdjustmentSuggestion` exists for this player/game.
   * SIG-96 wires the suggestion query; here it is an optional input so the
   * derivation is complete and testable now. Defaults to false.
   */
  hasPendingSuggestion?: boolean;
  /** Kalshi degraded — no fresh price could be fetched. */
  priceDegraded?: boolean;
  now: Date;
};

/**
 * Derive the freshness label. Precedence (spec §5 table):
 *
 *  - `unavailable` — no current projection, or Kalshi degraded with no fresh price.
 *  - `stale` — the projection is stale, or predates inactives past the boundary.
 *  - `new_info_pending` — a material pending suggestion, or predates inactives
 *    before the boundary is reached (the caution-but-not-yet-stale window).
 *  - `updated_recently` — projection fine and the price refreshed within the
 *    on-view freshness interval.
 *  - `current` — projection fine and the price is within the interval as well.
 *
 * `updated_recently` and `current` differ only in emphasis in the design doc;
 * both are neutral. This function treats a price observed *within* the interval
 * as `current` and a price observed but *outside* it (still present, just older)
 * as `updated_recently` only when a refresh is not warranted — otherwise the
 * projection state dominates. The distinction is deliberately conservative: a
 * price never upgrades a projection's freshness.
 */
export function deriveFreshness(
  inputs: FreshnessInputs,
  priceFreshnessSeconds: number,
): FreshnessStateDto {
  const raw = {
    projectionComputedAt: inputs.projectionComputedAt,
    informationCutoff: inputs.informationCutoff,
    priceObservedAt: inputs.priceObservedAt,
  };

  // No projection, or a price outage with nothing fresh to show → unavailable.
  const hasProjection = inputs.staleness !== null;
  const hasPrice = inputs.priceObservedAt !== null;
  if (!hasProjection || (inputs.priceDegraded === true && !hasPrice)) {
    return { state: "unavailable", ...raw };
  }

  const staleness = inputs.staleness as StalenessDto;

  // Stale dominates everything below it: a caution the list must surface, and
  // a fresh price can never clear it.
  if (staleness.isStale || staleness.predatesInactives) {
    return { state: "stale", ...raw };
  }

  // A material pending suggestion is new information the projection has not yet
  // incorporated — caution, but not yet stale.
  if (inputs.hasPendingSuggestion === true) {
    return { state: "new_info_pending", ...raw };
  }

  // Projection is fine. With no price observation at all (a contract never
  // priced, or Prop Research which carries no price), freshness reflects the
  // current projection — the absent price is disclosed separately in the price
  // cell, never as a phantom "updated_recently" refresh that did not happen.
  if (!hasPrice) {
    return { state: "current", ...raw };
  }

  // A price is present; its clock decides current vs updated_recently. A price
  // never upgrades a projection's freshness, only qualifies it here.
  const priceFresh =
    inputs.now.getTime() -
      new Date(inputs.priceObservedAt as string).getTime() <=
    priceFreshnessSeconds * 1000;

  return { state: priceFresh ? "current" : "updated_recently", ...raw };
}
