import type { Confidence } from "../../../generated/prisma/enums";
import { CONFIDENCE_WEIGHTS } from "@/lib/slate/edge";
import { netPriceDollars } from "./fees";

/**
 * Fractional-Kelly sizing on the fee-adjusted executable price.
 *
 * One number does two jobs here, deliberately. The Kelly edge fraction
 *
 *     f* = (b p - q) / b = p - q c / (1 - c)
 *
 * — where `p` is the corrected probability of the staked side, `q = 1 - p`,
 * `c` is the fee-adjusted price of a contract that pays $1, and `b = (1 - c)/c`
 * is the net odds — is both the RANKING key and the unscaled stake fraction.
 * Ranking by anything else would let the slate consider one contract most
 * attractive while sizing considered another, which is precisely the confusion
 * the pitch's "highest win probability instead of highest value" rabbit hole
 * describes: a 90% event priced at 95c has a negative Kelly edge and must rank
 * below a 55% event priced at 48c.
 *
 * Pure module — no Prisma, no env, no clock. `plan.ts` supplies everything.
 */

/**
 * Kelly edge for one side at one price. Returns a signed fraction of bankroll;
 * `<= 0` means the edge does not survive fees and the candidate receives no
 * stake.
 *
 * Returns `null` when the probability cannot be priced, which is a different
 * state from an edge of zero and must stay distinguishable all the way to the
 * candidate row.
 */
export function kellyEdge(inputs: {
  /** Corrected probability of the staked side, 0..1. */
  probability: number | null;
  /** Executable ask for that side, integer cents 1-99. */
  askCents: number | null;
}): number | null {
  const { probability, askCents } = inputs;
  if (probability === null || askCents === null) return null;
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    return null;
  }

  const c = netPriceDollars(askCents);
  // A fee-adjusted price at or above a dollar can never pay: the contract's
  // maximum return is $1, so there are no net odds to compute.
  if (c >= 1) return null;

  const q = 1 - probability;
  return probability - (q * c) / (1 - c);
}

/**
 * The fraction of bankroll this candidate is permitted to risk, before any cap.
 *
 * Confidence enters by scaling the mode's Kelly fraction with the **existing**
 * `CONFIDENCE_WEIGHTS` the slate already ranks by. Importing rather than
 * redefining is the point: a second confidence scale for money would let the
 * screen and the bot disagree about how much a medium-confidence projection is
 * worth, and neither would be visibly wrong.
 */
export function appliedKellyFraction(
  modeFraction: number,
  confidence: Confidence,
): number {
  return modeFraction * CONFIDENCE_WEIGHTS[confidence];
}

export type StakeInputs = {
  kellyEdge: number;
  /** Mode fraction already scaled by confidence. */
  appliedFraction: number;
  /** Current active bankroll, in cents. */
  activeBankrollCents: number;
};

/**
 * The unconstrained desired stake, in whole cents, floored.
 *
 * Rounding down is not a detail. Every rounding decision in this feature goes
 * against the position, because the output is evidence about whether the system
 * deserves real capital and an optimistic rounding compounds silently across a
 * season.
 */
export function desiredStakeCents(inputs: StakeInputs): number {
  const { kellyEdge: edge, appliedFraction, activeBankrollCents } = inputs;
  if (edge <= 0 || appliedFraction <= 0 || activeBankrollCents <= 0) return 0;
  return Math.floor(edge * appliedFraction * activeBankrollCents);
}

/**
 * Whole contracts affordable at a fee-adjusted price. Kalshi trades whole
 * contracts, so a stake that buys 12.9 of them buys twelve.
 */
export function contractsForStake(
  stakeCents: number,
  netPriceCentsValue: number,
): number {
  if (stakeCents <= 0 || netPriceCentsValue <= 0) return 0;
  return Math.floor(stakeCents / netPriceCentsValue);
}
