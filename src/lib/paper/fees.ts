import { KALSHI_FEE_RATE } from "./config";

/**
 * Kalshi trading fees, as they apply to simulated execution.
 *
 * Paper execution crosses the spread at the ask, so it is always the taker
 * side: the maker schedule is deliberately not modelled, and settlement carries
 * no fee. The general formula is
 *
 *     fee = ceil_to_cent(rate x contracts x price x (1 - price))
 *
 * with price in dollars. The ceiling is at the ORDER level, which is why the
 * per-contract figure below is only ever used for ranking and stake conversion
 * — the fee actually charged on a fill is computed once, on the filled count.
 *
 * Every rounding here goes against the position. Understating fills and
 * overstating costs is the safe direction of error for a system whose entire
 * output is evidence about whether it deserves real capital.
 */

/** Kalshi prices are integer cents, 1-99. */
export function assertPriceCents(priceCents: number): void {
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 99) {
    throw new RangeError(
      `price must be an integer 1-99 cents, received ${priceCents}`,
    );
  }
}

/**
 * The fee for an order of `contracts` at `priceCents`, in whole cents, rounded
 * **up**. Zero contracts cost nothing; a fee is never negative.
 */
export function feeCents(contracts: number, priceCents: number): number {
  assertPriceCents(priceCents);
  if (!Number.isInteger(contracts) || contracts < 0) {
    throw new RangeError(
      `contracts must be a non-negative integer, received ${contracts}`,
    );
  }
  if (contracts === 0) return 0;

  const price = priceCents / 100;
  const feeDollars = KALSHI_FEE_RATE * contracts * price * (1 - price);
  // Guard the float: 0.07 * 30 * 0.54 * 0.46 lands a hair under a cent
  // boundary often enough to matter, and rounding down would understate the
  // cost. Nudge by an epsilon far below a cent before taking the ceiling.
  return Math.ceil(feeDollars * 100 - 1e-9);
}

/**
 * The fee-adjusted price of ONE contract, in cents, rounded up.
 *
 * This is the price every economic test uses: the Kelly edge, the
 * no-edge-after-fees rejection, and the conversion from a dollar stake to a
 * whole number of contracts. Using the raw ask for any of them would let an
 * opportunity that is unprofitable after fees receive a stake, which the
 * pitch's Definition of Done forbids.
 */
export function netPriceCents(priceCents: number): number {
  assertPriceCents(priceCents);
  const price = priceCents / 100;
  const perContractFee = KALSHI_FEE_RATE * price * (1 - price);
  return Math.ceil((price + perContractFee) * 100 - 1e-9);
}

/**
 * The fee-adjusted price as a dollar fraction, unrounded — the input to the
 * Kelly arithmetic, which needs the continuous value rather than the cent it
 * displays as.
 */
export function netPriceDollars(priceCents: number): number {
  assertPriceCents(priceCents);
  const price = priceCents / 100;
  return price + KALSHI_FEE_RATE * price * (1 - price);
}
