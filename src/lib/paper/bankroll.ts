import type { MarketSide } from "../../../generated/prisma/enums";

/**
 * Bankroll arithmetic — pure.
 *
 * Three numbers that are routinely confused and must not be:
 *
 * - **Settled balance** is the running total of the append-only ledger. Only a
 *   completed event moves it: a stake, a fee, a settlement, a void refund, a
 *   withdrawal.
 * - **Open exposure** is the cost basis plus fees of open positions. A Kalshi
 *   position's maximum loss is what was paid, so cost basis *is* the amount at
 *   risk.
 * - **Mark-to-market** is settled balance plus what the open positions could be
 *   realised for right now.
 *
 * Mark-to-market values a position at the **bid** on the side held, not the
 * ask. The bid is what could be realised; the ask is what it would cost to buy
 * the position again. Using the ask would inflate the account by the spread on
 * every open position, and it would do so most where the market is thinnest —
 * exactly where the model's apparent edges are largest.
 */

export type OpenPositionMark = {
  positionId: string;
  side: MarketSide;
  contracts: number;
  costBasisCents: number;
  feesPaidCents: number;
  /** Latest observed bid on the held side. Null when none is usable. */
  bidCentsOnHeldSide: number | null;
};

export type MarkToMarket =
  | { available: true; markCents: number; openValueCents: number }
  /**
   * At least one open position has no usable bid. Reported rather than
   * approximated: a drawdown computed on a different basis than the breaker's
   * would misstate the safety state, and the breaker is the reason this number
   * exists.
   */
  | { available: false; missingPositionIds: string[] };

/** Cost basis plus fees across open positions — the amount actually at risk. */
export function openExposureCents(
  positions: ReadonlyArray<
    Pick<OpenPositionMark, "costBasisCents" | "feesPaidCents">
  >,
): number {
  return positions.reduce(
    (sum, position) => sum + position.costBasisCents + position.feesPaidCents,
    0,
  );
}

/** The bid on the side actually held. */
export function bidOnHeldSide(
  side: MarketSide,
  observation: {
    yesBidCents: number | null;
    noBidCents: number | null;
  } | null,
): number | null {
  if (!observation) return null;
  const bid = side === "yes" ? observation.yesBidCents : observation.noBidCents;
  if (bid === null || !Number.isInteger(bid) || bid < 0 || bid > 100) {
    return null;
  }
  return bid;
}

export function markToMarket(
  settledBalanceCents: number,
  positions: ReadonlyArray<OpenPositionMark>,
): MarkToMarket {
  const missing = positions
    .filter((position) => position.bidCentsOnHeldSide === null)
    .map((position) => position.positionId);
  if (missing.length > 0) {
    return { available: false, missingPositionIds: missing };
  }

  const openValueCents = positions.reduce(
    (sum, position) =>
      sum + position.contracts * (position.bidCentsOnHeldSide as number),
    0,
  );
  return {
    available: true,
    markCents: settledBalanceCents + openValueCents,
    openValueCents,
  };
}

/**
 * Drawdown from the high-water mark, in basis points.
 *
 * Basis points rather than a fraction because every threshold in this feature
 * is a whole percentage and integers compare exactly. `null` propagates when
 * mark-to-market is unavailable — never a settled-only substitute.
 */
export function drawdownBps(
  highWaterMarkCents: number,
  mark: MarkToMarket,
): number | null {
  if (!mark.available) return null;
  if (highWaterMarkCents <= 0) return 0;
  const fallen = highWaterMarkCents - mark.markCents;
  if (fallen <= 0) return 0;
  return Math.round((fallen / highWaterMarkCents) * 10_000);
}

/**
 * The withdrawal ratchet.
 *
 * Above the working ceiling, the excess is removed from the active bankroll and
 * recorded separately as simulated withdrawn profit. This models a real
 * operating strategy where profits are periodically swept out rather than
 * endlessly compounding, and it is a **repeating** rule rather than a one-time
 * skim — it fires again every time the account climbs back through the ceiling.
 *
 * The test uses SETTLED balance only. Unrealised value cannot be withdrawn, and
 * treating it as withdrawable would sweep out money the account does not yet
 * have.
 */
export function withdrawalCents(
  settledBalanceCents: number,
  startingBankrollCents: number,
  ceilingMultiple: number,
): number {
  const ceiling = Math.floor(startingBankrollCents * ceilingMultiple);
  if (settledBalanceCents <= ceiling) return 0;
  return settledBalanceCents - ceiling;
}

/**
 * The high-water mark after an event.
 *
 * Monotone, with exactly one exception: a simulated withdrawal resets it to the
 * post-withdrawal active bankroll. Without that reset, deliberately removing
 * profit would read as a loss against the pre-withdrawal peak and could trip a
 * drawdown breaker on money the account chose to bank.
 */
export function nextHighWaterMark(inputs: {
  currentCents: number;
  markCents: number | null;
  withdrewCents: number;
}): number {
  if (inputs.withdrewCents > 0) {
    // The mark is already net of the withdrawal when this is called.
    return inputs.markCents ?? inputs.currentCents - inputs.withdrewCents;
  }
  if (inputs.markCents === null) return inputs.currentCents;
  return Math.max(inputs.currentCents, inputs.markCents);
}

/** Realised profit on a settled position, after the fees already paid. */
export function realizedPnlCents(inputs: {
  proceedsCents: number;
  costBasisCents: number;
  feesPaidCents: number;
}): number {
  return inputs.proceedsCents - inputs.costBasisCents - inputs.feesPaidCents;
}

/**
 * Settlement proceeds for one position.
 *
 * A winning contract pays $1. A losing one pays nothing. A **voided** market
 * returns the cost basis and the fees — Kalshi refunds both, and a void is not
 * a loss. Keeping void distinct from `settled_lost` all the way down to the
 * arithmetic is what stops a voided market quietly depressing the campaign's
 * apparent win rate.
 */
export function settlementProceedsCents(inputs: {
  side: MarketSide;
  contracts: number;
  costBasisCents: number;
  feesPaidCents: number;
  result: "yes" | "no" | "voided";
}): { proceedsCents: number; realizedPnlCents: number } {
  if (inputs.result === "voided") {
    const proceeds = inputs.costBasisCents + inputs.feesPaidCents;
    return { proceedsCents: proceeds, realizedPnlCents: 0 };
  }
  const won = inputs.result === inputs.side;
  const proceedsCents = won ? inputs.contracts * 100 : 0;
  return {
    proceedsCents,
    realizedPnlCents: realizedPnlCents({
      proceedsCents,
      costBasisCents: inputs.costBasisCents,
      feesPaidCents: inputs.feesPaidCents,
    }),
  };
}
