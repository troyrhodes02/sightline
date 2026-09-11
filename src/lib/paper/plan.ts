import type {
  BindingConstraint,
  BreachCondition,
  CandidateVerdict,
  Confidence,
  MarketSide,
  PaperCycleOutcome,
  RiskMode,
} from "../../../generated/prisma/enums";
import type { StalenessDto } from "@/lib/dto/slate";
import { MAX_ALLOCATION_PASSES, PRE_KICKOFF_CUTOFF_MINUTES } from "./config";
import { feeCents, netPriceCents } from "./fees";
import {
  appliedKellyFraction,
  contractsForStake,
  desiredStakeCents,
  kellyEdge,
} from "./kelly";
import {
  correctedProbability,
  type ActiveRecalibration,
} from "./recalibration/apply";

/**
 * The decision path, as one pure function.
 *
 * `planCycle` takes stored state and returns what should happen: a ranked,
 * capped, fill-modelled set of intended positions, each carrying the single
 * constraint that determined its outcome. It touches no database, reads no
 * clock, and calls no network — everything is supplied.
 *
 * That purity is the point rather than a style preference. Scheduled execution,
 * Dry Run, and counterfactual replay must be the same logic, and the only way
 * to guarantee that is for them to be the same function. A Dry Run that
 * approximated what a cycle would do would defeat its own purpose the first
 * time the two drifted, and the drift would be invisible.
 *
 * **Every rounding in here goes against the position.** Stakes floor, contracts
 * floor, fees ceiling, and a fill never exceeds the size actually displayed.
 * The output of this feature is evidence about whether the system deserves real
 * capital; an optimistic rounding compounds silently across a season and
 * corrupts exactly the thing the paper campaign exists to produce.
 */

export type CandidateInput = {
  contractId: string;
  kalshiTicker: string;
  /** Null when Sightline could not price this contract. */
  projectionId: string | null;
  modelVersion: string | null;
  priceObservationId: string | null;
  /** P(stat >= threshold) from the stored distribution, before correction. */
  rawYesProbability: number | null;
  confidence: Confidence | null;
  /** Null when there is no projection; staleness qualifies a projection. */
  staleness: StalenessDto | null;
  /**
   * A pending Adjustment Suggestion (or an insufficient-evidence hold) against
   * this contract's player/stat (decision 1). Null when none. `held` marks the
   * insufficient-evidence case. Blocks this contract only — teammates and the
   * rest of the slate trade normally.
   */
  pendingSuggestion: { held: boolean } | null;
  yesAskCents: number | null;
  noAskCents: number | null;
  /** Displayed size at the executable price. Null means "could not read". */
  yesAskSizeContracts: number | null;
  noAskSizeContracts: number | null;
};

export type PlanRiskConfig = {
  mode: RiskMode;
  kellyFraction: number;
  perGameCapPct: number;
  perSlateCapPct: number;
  probabilityCeiling: number;
};

export type CyclePlanInput = {
  now: Date;
  kickoffAt: Date;
  config: PlanRiskConfig;
  /** Null when no fit governs the projections' model version. */
  recalibration: ActiveRecalibration | null;
  /** Settled balance plus the market value of open positions. */
  activeBankrollCents: number;
  /** Settled, unallocated cash this cycle may spend. */
  availableBankrollCents: number;
  /** Cost basis plus fees of open positions, campaign-wide. */
  slateExposureCents: number;
  /** The same, restricted to this game. */
  gameExposureCents: number;
  /**
   * The open position on each contract, by contract id — **side and all.**
   *
   * A bare count would be side-blind, and a side-blind count is dangerous
   * rather than merely imprecise: if the book moves enough between cycles that
   * the better side flips, subtracting YES contracts from a NO desired total
   * produces an increment the executor cannot write (a position holds one
   * side), and the whole cycle aborts. The side travels with the count so the
   * planner can refuse the flip explicitly instead.
   */
  heldByContractId: Readonly<
    Record<string, { side: MarketSide; contracts: number }>
  >;
  candidates: CandidateInput[];
  /**
   * Halting breach conditions active at evaluation. A non-empty list blocks
   * every candidate; `drawdown_warning` is not a halting condition and must
   * not appear here.
   */
  haltingBreaches: BreachCondition[];
  /** True when mark-to-market could not be computed for every open position. */
  markToMarketUnavailable?: boolean;
};

export type PlannedCandidate = {
  contractId: string;
  kalshiTicker: string;
  projectionId: string | null;
  /**
   * The model version behind the driving probability, carried through for the
   * permanent Hybrid attribution recorded on the candidate and position rows
   * (PME-1, D6). Null when no projection backed the candidate.
   */
  modelVersion: string | null;
  priceObservationId: string | null;
  rank: number;
  side: MarketSide | null;
  rawProbability: number | null;
  correctedProbability: number | null;
  confidence: Confidence | null;
  askCents: number | null;
  netPriceCents: number | null;
  topOfBookSizeContracts: number | null;
  kellyEdge: number | null;
  kellyFractionApplied: number | null;
  /** The TOTAL exposure this opportunity warrants, in contracts. */
  desiredTotalContracts: number;
  desiredTotalStakeCents: number;
  intendedContracts: number;
  intendedStakeCents: number;
  filledContracts: number;
  filledCostCents: number;
  filledFeeCents: number;
  /** Intended minus filled, in cents. Zero on a complete fill. */
  unfilledStakeCents: number;
  feeCents: number | null;
  verdict: CandidateVerdict;
  boundBy: BindingConstraint;
  boundByDetail: string | null;
};

export type CyclePlan = {
  outcome: PaperCycleOutcome;
  skipReason: string | null;
  candidates: PlannedCandidate[];
  allocationPasses: number;
  allocationTrace: string[];
  candidatesEvaluated: number;
  candidatesSized: number;
  candidatesFilled: number;
  stakedCents: number;
  slateCapacityCents: number;
  gameCapacityCents: number;
};

/** Sizing outcomes that a later pass could still change. */
const RETRYABLE: ReadonlySet<BindingConstraint> = new Set([
  "available_bankroll",
  "per_game_cap",
  "per_slate_cap",
]);

export function planCycle(input: CyclePlanInput): CyclePlan {
  const slateCapacityCents = capacityCents(
    input.activeBankrollCents,
    input.config.perSlateCapPct,
  );
  const gameCapacityCents = capacityCents(
    input.activeBankrollCents,
    input.config.perGameCapPct,
  );

  const base = {
    slateCapacityCents,
    gameCapacityCents,
    allocationPasses: 0,
    allocationTrace: [] as string[],
    candidatesEvaluated: input.candidates.length,
    candidatesSized: 0,
    candidatesFilled: 0,
    stakedCents: 0,
  };

  // --- Whole-cycle refusals, before any candidate is priced ---------------

  // The cutoff outranks everything except a breaker. It applies in every risk
  // mode: Aggressive means accepting more controlled bankroll risk, not
  // ignoring a timing safeguard.
  if (pastCutoff(input.now, input.kickoffAt)) {
    return {
      ...base,
      outcome: "skipped",
      skipReason: "pre_kickoff_cutoff",
      candidates: blockAll(input.candidates, "pre_kickoff_cutoff", null),
    };
  }

  if (input.markToMarketUnavailable) {
    // A safety check that cannot run is not a safety check. Refusing to stake
    // is the conservative direction, and the same posture as refusing a stale
    // projection.
    return {
      ...base,
      outcome: "failed",
      skipReason: "mark_to_market_unavailable",
      candidates: blockAll(
        input.candidates,
        "price_unavailable",
        "mark_to_market_unavailable",
      ),
    };
  }

  if (input.haltingBreaches.length > 0) {
    return {
      ...base,
      outcome: "halted",
      skipReason: input.haltingBreaches.join(","),
      candidates: blockAll(
        input.candidates,
        "breaker",
        input.haltingBreaches.join(","),
      ),
    };
  }

  // --- Price every candidate ---------------------------------------------

  const priced = input.candidates.map((candidate) =>
    priceCandidate(candidate, input),
  );

  // Rank by Kelly edge descending. Ties break on ticker so the ordering is
  // total and reproducible: two identical runs must produce the same plan, or
  // a replay proves nothing.
  const rankable = priced.filter((c) => c.kellyEdge !== null);
  const unrankable = priced.filter((c) => c.kellyEdge === null);
  rankable.sort((a, b) => {
    const byEdge = (b.kellyEdge as number) - (a.kellyEdge as number);
    if (byEdge !== 0) return byEdge;
    return a.kalshiTicker < b.kalshiTicker ? -1 : 1;
  });
  unrankable.sort((a, b) => (a.kalshiTicker < b.kalshiTicker ? -1 : 1));
  const ordered = [...rankable, ...unrankable];
  ordered.forEach((candidate, index) => {
    candidate.rank = index;
  });

  // --- Allocate, reallocating after partial fills -------------------------

  const trace: string[] = [];
  const exhausted = new Set<string>();
  let spentCents = 0;
  let gameUsedCents = input.gameExposureCents;
  let slateUsedCents = input.slateExposureCents;
  let passes = 0;

  for (let pass = 1; pass <= MAX_ALLOCATION_PASSES; pass += 1) {
    // Only candidates that survived pricing are allocatable. `priceCandidate`
    // leaves a sizable candidate provisionally `no_stake / available_bankroll`,
    // so membership in RETRYABLE is precisely "passed every eligibility and
    // economic test, and is waiting on capacity". A `refused` candidate must
    // never re-enter here — it was refused for a reason capacity cannot fix,
    // and letting it through would overwrite that reason with a cap.
    const eligible = ordered.filter(
      (candidate) =>
        candidate.verdict === "no_stake" &&
        RETRYABLE.has(candidate.boundBy) &&
        candidate.kellyEdge !== null &&
        candidate.kellyEdge > 0 &&
        !exhausted.has(candidate.contractId) &&
        candidate.filledContracts === 0,
    );

    if (eligible.length === 0) {
      if (pass === 1) {
        trace.push(
          "Pass 1 — no candidate had positive Kelly edge after fees. Nothing allocated.",
        );
        passes = 1;
      } else {
        trace.push(
          `Pass ${pass} — no remaining candidate was eligible. Allocation stopped.`,
        );
        passes = pass;
      }
      break;
    }

    passes = pass;
    const allocated: string[] = [];
    let filledThisPass = 0;

    for (const candidate of eligible) {
      const available = input.availableBankrollCents - spentCents;
      const gameRemaining = gameCapacityCents - gameUsedCents;
      const slateRemaining = slateCapacityCents - slateUsedCents;

      const sized = sizeCandidate(candidate, input, {
        available,
        gameRemaining,
        slateRemaining,
      });
      if (sized.intendedContracts === 0) {
        candidate.verdict = "no_stake";
        candidate.boundBy = sized.boundBy;
        candidate.boundByDetail = sized.boundByDetail;
        candidate.intendedContracts = 0;
        candidate.intendedStakeCents = 0;
        continue;
      }

      candidate.intendedContracts = sized.intendedContracts;
      candidate.intendedStakeCents = sized.intendedStakeCents;

      // The fill. Top of book only: never walk deeper, never assume a worse
      // price would have been available, never infer depth that was not shown.
      const displayed = candidate.topOfBookSizeContracts ?? 0;
      const filled = Math.min(sized.intendedContracts, displayed);

      if (filled === 0) {
        candidate.verdict = "no_stake";
        candidate.boundBy = "top_of_book_size";
        candidate.boundByDetail = null;
        candidate.unfilledStakeCents = candidate.intendedStakeCents;
        exhausted.add(candidate.contractId);
        continue;
      }

      const ask = candidate.askCents as number;
      const cost = filled * ask;
      const fee = feeCents(filled, ask);
      candidate.filledContracts = filled;
      candidate.filledCostCents = cost;
      candidate.filledFeeCents = fee;
      candidate.feeCents = fee;
      // Stake the book did not take, derived from the CONTRACTS left unfilled
      // rather than from intended-minus-spent. `intendedStakeCents` is a
      // per-contract ceiling (`contracts x netPriceCents`) while the actual
      // cost is one order-level ceiling, so the former is always the larger
      // and the subtraction leaves a few cents behind even on a complete fill
      // — which would report stake as returned on a position that filled
      // entirely. Zero unfilled contracts is zero unfilled stake.
      candidate.unfilledStakeCents =
        (sized.intendedContracts - filled) *
        (candidate.netPriceCents as number);

      if (filled < sized.intendedContracts) {
        candidate.verdict = "partial";
        candidate.boundBy = "top_of_book_size";
        candidate.boundByDetail =
          sized.boundBy === "none" ? null : sized.boundBy;
        // Its top of book was consumed. Retrying it inside the same cycle
        // would be chasing liquidity Sightline has no evidence existed.
        exhausted.add(candidate.contractId);
      } else {
        candidate.verdict = "filled";
        candidate.boundBy = sized.boundBy;
        candidate.boundByDetail = sized.boundByDetail;
      }

      spentCents += cost + fee;
      gameUsedCents += cost + fee;
      slateUsedCents += cost + fee;
      filledThisPass += 1;
      allocated.push(
        `${candidate.kalshiTicker} ${filled}/${sized.intendedContracts} contracts, ${formatCents(cost + fee)}`,
      );
    }

    trace.push(
      allocated.length > 0
        ? `Pass ${pass} — allocated ${allocated.join("; ")}.`
        : `Pass ${pass} — nothing could be allocated.`,
    );

    if (filledThisPass === 0) {
      trace.push(
        `Pass ${pass} — no candidate filled; further passes would repeat this one. Allocation stopped.`,
      );
      break;
    }
  }

  const unallocated = input.availableBankrollCents - spentCents;
  const partials = ordered.filter((c) => c.verdict === "partial");
  if (partials.length > 0) {
    trace.push(
      `${formatCents(partials.reduce((sum, c) => sum + c.unfilledStakeCents, 0))} returned from ` +
        `${partials.map((c) => c.kalshiTicker).join(", ")}; their top of book was consumed and they are not retried this cycle.`,
    );
  }
  trace.push(
    `${formatCents(unallocated)} of ${formatCents(input.availableBankrollCents)} available bankroll left unallocated.`,
  );

  const candidatesFilled = ordered.filter((c) => c.filledContracts > 0).length;
  const candidatesSized = ordered.filter((c) => c.intendedContracts > 0).length;
  const stakedCents = ordered.reduce(
    (sum, c) => sum + c.filledCostCents + c.filledFeeCents,
    0,
  );

  return {
    outcome: cycleOutcome(ordered),
    skipReason: null,
    candidates: ordered,
    allocationPasses: passes,
    allocationTrace: trace,
    candidatesEvaluated: input.candidates.length,
    candidatesSized,
    candidatesFilled,
    stakedCents,
    slateCapacityCents,
    gameCapacityCents,
  };
}

/** Percent of current active bankroll, floored. */
export function capacityCents(
  activeBankrollCents: number,
  pct: number,
): number {
  if (activeBankrollCents <= 0) return 0;
  return Math.floor((activeBankrollCents * pct) / 100);
}

/** True once the cycle is inside the hard pre-kickoff cutoff. */
export function pastCutoff(now: Date, kickoffAt: Date): boolean {
  return (
    now.getTime() >= kickoffAt.getTime() - PRE_KICKOFF_CUTOFF_MINUTES * 60_000
  );
}

function cycleOutcome(candidates: PlannedCandidate[]): PaperCycleOutcome {
  if (candidates.some((c) => c.verdict === "partial")) return "partial_fill";
  if (candidates.some((c) => c.verdict === "filled")) return "ok";
  // A cycle that took no positions is a successful cycle. The bot is not
  // expected to manufacture action because Sunday feels more entertaining.
  return "no_candidate";
}

function blockAll(
  candidates: CandidateInput[],
  boundBy: BindingConstraint,
  detail: string | null,
): PlannedCandidate[] {
  return candidates.map((candidate, index) => ({
    ...emptyPlanned(candidate),
    rank: index,
    verdict: "blocked" as CandidateVerdict,
    boundBy,
    boundByDetail: detail,
  }));
}

function emptyPlanned(candidate: CandidateInput): PlannedCandidate {
  return {
    contractId: candidate.contractId,
    kalshiTicker: candidate.kalshiTicker,
    projectionId: candidate.projectionId,
    modelVersion: candidate.modelVersion,
    priceObservationId: candidate.priceObservationId,
    rank: 0,
    side: null,
    rawProbability: candidate.rawYesProbability,
    correctedProbability: null,
    confidence: candidate.confidence,
    askCents: null,
    netPriceCents: null,
    topOfBookSizeContracts: null,
    kellyEdge: null,
    kellyFractionApplied: null,
    desiredTotalContracts: 0,
    desiredTotalStakeCents: 0,
    intendedContracts: 0,
    intendedStakeCents: 0,
    filledContracts: 0,
    filledCostCents: 0,
    filledFeeCents: 0,
    unfilledStakeCents: 0,
    feeCents: null,
    verdict: "refused",
    boundBy: "none",
    boundByDetail: null,
  };
}

/**
 * Eligibility, correction, side selection, and the economic tests — everything
 * that does not depend on how much capacity is left.
 */
function priceCandidate(
  candidate: CandidateInput,
  input: CyclePlanInput,
): PlannedCandidate {
  const planned = emptyPlanned(candidate);

  // A pending Adjustment Suggestion means important late information may not be
  // reflected in the active projection; an insufficient-evidence hold means the
  // model cannot defensibly estimate the adjustment (decision 1/6). Either way
  // the bot must not stake this contract until William resolves it — the same
  // structural refusal as a stale projection, tagged distinctly so the two
  // causes stay diagnosable. Checked before staleness so the more specific,
  // actionable reason is the one recorded when a contract is both.
  if (candidate.pendingSuggestion !== null) {
    planned.verdict = "refused";
    planned.boundBy = "pending_suggestion";
    planned.boundByDetail = candidate.pendingSuggestion.held
      ? "insufficient evidence to estimate the adjustment"
      : "pending adjustment suggestion awaiting review";
    return planned;
  }

  // A projection that is stale, or that admits it predates today's inactives,
  // is exactly what autonomous execution must not stake against. Both states
  // refuse: the second is a disclosure the slate makes to a human who can
  // judge it, and the bot cannot.
  if (
    candidate.staleness !== null &&
    (candidate.staleness.isStale || candidate.staleness.predatesInactives)
  ) {
    planned.verdict = "refused";
    planned.boundBy = "stale_projection";
    planned.boundByDetail = candidate.staleness.isStale
      ? "newer facts than the projection's cutoff"
      : "predates today's inactives";
    return planned;
  }

  if (
    candidate.rawYesProbability === null ||
    candidate.confidence === null ||
    candidate.modelVersion === null
  ) {
    planned.verdict = "refused";
    planned.boundBy = "price_unavailable";
    planned.boundByDetail = "no projection";
    return planned;
  }

  // Sizing from a raw probability is a No-Go. With no fit governing this
  // model version there is no corrected probability, so the candidate is
  // refused rather than sized from the uncorrected number.
  if (
    input.recalibration === null ||
    input.recalibration.modelVersion !== candidate.modelVersion
  ) {
    planned.verdict = "refused";
    planned.boundBy = "no_active_recalibration";
    planned.boundByDetail = candidate.modelVersion;
    return planned;
  }

  const corrected = correctedProbability(
    input.recalibration,
    candidate.rawYesProbability,
  ) as number;
  planned.correctedProbability = corrected;

  // Both sides are evaluated at their own fee-adjusted asks and the greater
  // Kelly edge wins — the same shape as the slate's side selection, so the
  // two can never disagree about which side is the interesting one.
  const sides: Array<{
    side: MarketSide;
    probability: number;
    askCents: number;
    sizeContracts: number | null;
  }> = [];
  if (candidate.yesAskCents !== null) {
    sides.push({
      side: "yes",
      probability: corrected,
      askCents: candidate.yesAskCents,
      sizeContracts: candidate.yesAskSizeContracts,
    });
  }
  if (candidate.noAskCents !== null) {
    sides.push({
      side: "no",
      probability: 1 - corrected,
      askCents: candidate.noAskCents,
      sizeContracts: candidate.noAskSizeContracts,
    });
  }

  if (sides.length === 0) {
    planned.verdict = "refused";
    planned.boundBy = "price_unavailable";
    planned.boundByDetail = "no ask on either side";
    return planned;
  }

  let best: (typeof sides)[number] | null = null;
  let bestEdge = Number.NEGATIVE_INFINITY;
  for (const side of sides) {
    const edge = kellyEdge({
      probability: side.probability,
      askCents: side.askCents,
    });
    if (edge !== null && edge > bestEdge) {
      bestEdge = edge;
      best = side;
    }
  }

  if (best === null) {
    planned.verdict = "refused";
    planned.boundBy = "price_unavailable";
    planned.boundByDetail = "no priceable side";
    return planned;
  }

  planned.side = best.side;
  planned.askCents = best.askCents;
  planned.netPriceCents = netPriceCents(best.askCents);
  planned.topOfBookSizeContracts = best.sizeContracts;
  planned.kellyEdge = bestEdge;

  // The ceiling is checked on the CORRECTED probability of the side actually
  // being staked, and read from the config version — never from the mode.
  // Aggressive raises how much is risked on acceptable opportunities; it does
  // not redefine which probabilities are acceptable.
  if (best.probability > input.config.probabilityCeiling) {
    planned.verdict = "no_stake";
    planned.boundBy = "probability_ceiling";
    planned.boundByDetail = input.config.probabilityCeiling.toFixed(3);
    return planned;
  }

  if (bestEdge <= 0) {
    planned.verdict = "no_stake";
    planned.boundBy = "no_edge_after_fees";
    return planned;
  }

  // Depth that could not be read is not depth. Treating an unreadable book as
  // available would be the single most flattering assumption in the feature.
  if (best.sizeContracts === null) {
    planned.verdict = "refused";
    planned.boundBy = "price_unavailable";
    planned.boundByDetail = "no displayed size at the executable price";
    return planned;
  }

  // A side flip is refused, never traded through. The book or the corrected
  // probability can move enough between cycles that the other side becomes the
  // better one, but a paper position holds a single side: an increment on the
  // opposite side is not an increment at all. Closing the old side to open the
  // new one would be the bot trading out of a position on its own initiative,
  // which is not in this pitch. So the candidate is refused and the existing
  // position is left to settle.
  //
  // Checked LAST among the refusals, after every test that is a property of the
  // evidence — staleness, the ceiling, no edge after fees, unreadable depth. A
  // candidate reaching here was otherwise a live opportunity, so
  // `opposite_side_held` means exactly that: declined only because of what is
  // already held. Recording it ahead of the evidence tests would let a portfolio
  // fact mask a reason that would have applied with no position at all.
  const openPosition = input.heldByContractId[candidate.contractId];
  if (openPosition !== undefined && openPosition.side !== best.side) {
    planned.verdict = "refused";
    planned.boundBy = "opposite_side_held";
    planned.boundByDetail = `holds ${openPosition.contracts} ${openPosition.side}`;
    return planned;
  }

  planned.kellyFractionApplied = appliedKellyFraction(
    input.config.kellyFraction,
    candidate.confidence,
  );

  // The DESIRED TOTAL for this opportunity — not an addition. Duplicate
  // prevention compares totals; it never reapplies an instruction.
  const desiredStake = desiredStakeCents({
    kellyEdge: bestEdge,
    appliedFraction: planned.kellyFractionApplied,
    activeBankrollCents: input.activeBankrollCents,
  });
  planned.desiredTotalContracts = contractsForStake(
    desiredStake,
    planned.netPriceCents,
  );
  planned.desiredTotalStakeCents =
    planned.desiredTotalContracts * planned.netPriceCents;

  planned.verdict = "no_stake";
  planned.boundBy = "available_bankroll";
  return planned;
}

/**
 * Turns a priced candidate's desired total into an eligible increment, then
 * applies the caps in order. **The first cap that reduces the stake is the one
 * recorded** — that value is the audit trail, and a later cap that would also
 * have bound is not what actually determined the outcome.
 */
function sizeCandidate(
  candidate: PlannedCandidate,
  input: CyclePlanInput,
  capacity: {
    available: number;
    gameRemaining: number;
    slateRemaining: number;
  },
): {
  intendedContracts: number;
  intendedStakeCents: number;
  boundBy: BindingConstraint;
  boundByDetail: string | null;
} {
  const net = candidate.netPriceCents as number;
  // Only same-side holdings count against the desired total. An opposite-side
  // holding is refused upstream in `priceCandidate`, so by the time sizing runs
  // the only position that can be here is on this candidate's own side.
  const open = input.heldByContractId[candidate.contractId];
  const held =
    open !== undefined && open.side === candidate.side ? open.contracts : 0;

  // If the system already holds the intended amount, repeating the cycle
  // creates no second position. Only new information raising the desired total
  // makes an increment eligible.
  const increment = Math.max(0, candidate.desiredTotalContracts - held);
  if (increment === 0) {
    return {
      intendedContracts: 0,
      intendedStakeCents: 0,
      boundBy: "none",
      boundByDetail:
        held > 0 ? "desired total already held" : "stake below one contract",
    };
  }

  let stake = increment * net;
  let boundBy: BindingConstraint = "none";

  const caps: Array<{ limit: number; constraint: BindingConstraint }> = [
    { limit: capacity.available, constraint: "available_bankroll" },
    { limit: capacity.gameRemaining, constraint: "per_game_cap" },
    { limit: capacity.slateRemaining, constraint: "per_slate_cap" },
  ];
  for (const cap of caps) {
    const limit = Math.max(0, cap.limit);
    if (stake > limit) {
      stake = limit;
      if (boundBy === "none") boundBy = cap.constraint;
    }
  }

  const contracts = contractsForStake(stake, net);
  if (contracts === 0) {
    return {
      intendedContracts: 0,
      intendedStakeCents: 0,
      // Nothing bound it but the stake still bought nothing: the increment was
      // worth less than one contract.
      boundBy: boundBy === "none" ? "available_bankroll" : boundBy,
      boundByDetail: boundBy === "none" ? "increment below one contract" : null,
    };
  }

  return {
    intendedContracts: contracts,
    intendedStakeCents: contracts * net,
    boundBy,
    boundByDetail: null,
  };
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
