import "server-only";

import { prisma } from "@/lib/prisma";
import type { RiskMode } from "../../../generated/prisma/enums";
import {
  GAME_DURATION_ALLOWANCE_HOURS,
  PROBABILITY_CEILING,
  RISK_PRESETS,
} from "./config";
import { feeCents, netPriceCents } from "./fees";
import {
  appliedKellyFraction,
  contractsForStake,
  desiredStakeCents,
} from "./kelly";
import { capacityCents } from "./plan";
import {
  nextHighWaterMark,
  settlementProceedsCents,
  withdrawalCents,
} from "./bankroll";

/**
 * Counterfactual risk-mode replay.
 *
 * Answers one question — *what would have happened under a different risk
 * mode* — and is fenced so it can never answer any other.
 *
 * **It reads only what was recorded at the time.** Each stored
 * `PaperCycleCandidate` already carries the corrected probability, the
 * executable ask, the fee, the observed top-of-book size, the confidence and
 * the Kelly edge as they were. The replay re-applies sizing and the same fill
 * policy against those recorded values; it recomputes no probability, so a
 * recalibration refit performed afterward cannot leak backwards into a period
 * that predates it.
 *
 * **It writes only its own two tables.** No ledger entry, no position, no
 * breach, no campaign field, no risk config. A superior counterfactual changes
 * nothing: William changes risk mode, in Configuration, or it does not change.
 *
 * A period is replayable only once every position opened in it has settled or
 * voided. Replaying an unresolved period would compare a finished alternative
 * against an unfinished actual, which is not a comparison.
 */

export type ReplayModeResult = {
  mode: RiskMode;
  endingActiveCents: number;
  netPnlCents: number;
  withdrawnCents: number;
  maxDrawdownBps: number;
  positionCount: number;
  breakerTrips: number;
};

export type ReplayEligibility =
  | { replayable: true; cycleCount: number }
  | { replayable: false; reason: string; openPositions: number };

export type PeriodKind = "game_window" | "week" | "campaign";

/** Cycles belonging to a period, oldest first — the order they must replay in. */
async function cyclesForPeriod(
  campaignId: string,
  kind: PeriodKind,
  key: string,
) {
  const where =
    kind === "campaign"
      ? { campaignId }
      : kind === "week"
        ? {
            campaignId,
            game: {
              season: Number(key.split("-w")[0]),
              week: Number(key.split("-w")[1]),
            },
          }
        : { campaignId, game: { kickoffAt: new Date(key) } };

  return prisma.paperCycle.findMany({
    where,
    orderBy: { startedAt: "asc" },
    include: {
      candidates: { orderBy: { rank: "asc" } },
      game: { select: { id: true, kickoffAt: true, season: true, week: true } },
    },
  });
}

export async function replayEligibility(
  campaignId: string,
  kind: PeriodKind,
  key: string,
): Promise<ReplayEligibility> {
  const cycles = await cyclesForPeriod(campaignId, kind, key);
  if (cycles.length === 0) {
    return {
      replayable: false,
      reason: "No cycles ran in this period.",
      openPositions: 0,
    };
  }

  const contractIds = cycles.flatMap((cycle) =>
    cycle.candidates
      .filter((candidate) => candidate.filledContracts > 0)
      .map((candidate) => candidate.contractId),
  );
  const open = await prisma.paperPosition.count({
    where: {
      campaignId,
      contractId: { in: contractIds },
      status: "open",
    },
  });

  if (open > 0) {
    return {
      replayable: false,
      reason: `Replay runs once the period's positions have all settled — ${open} still open.`,
      openPositions: open,
    };
  }

  return { replayable: true, cycleCount: cycles.length };
}

type PresetMode = Exclude<RiskMode, "custom">;
const REPLAY_MODES: PresetMode[] = ["conservative", "moderate", "aggressive"];

/**
 * Replays the period under each preset mode.
 *
 * Custom is deliberately not replayed: it is whatever the operator last typed,
 * so a stored "custom" result would be uninterpretable a month later when the
 * numbers behind the word had changed.
 */
export async function runReplay(
  campaignId: string,
  kind: PeriodKind,
  key: string,
  actorUserId: string,
  now: Date,
): Promise<{ replayId: string; results: ReplayModeResult[] }> {
  const eligibility = await replayEligibility(campaignId, kind, key);
  if (!eligibility.replayable) throw new Error(eligibility.reason);

  const campaign = await prisma.paperCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { startingBankrollCents: true },
  });
  // Newest first, as every other read of this append-only table does. The
  // oldest version would report whatever mode the campaign was CREATED with as
  // `actualMode`, so a campaign that switched to aggressive in week 3 would see
  // week 5 replayed with the aggressive run presented as a road not taken.
  const config = await prisma.paperRiskConfig.findFirst({
    where: { campaignId },
    orderBy: { effectiveFrom: "desc" },
    select: { mode: true, withdrawalCeilingMultiple: true },
  });

  const cycles = await cyclesForPeriod(campaignId, kind, key);
  const contractIds = [
    ...new Set(cycles.flatMap((c) => c.candidates.map((x) => x.contractId))),
  ];
  const outcomes = await prisma.outcome.findMany({
    where: { contractId: { in: contractIds } },
    select: { contractId: true, result: true },
  });
  const outcomeByContract = new Map(outcomes.map((o) => [o.contractId, o]));

  const results = REPLAY_MODES.map((mode) =>
    simulateMode({
      mode,
      startingBankrollCents: campaign.startingBankrollCents,
      ceilingMultiple: Number(config?.withdrawalCeilingMultiple ?? 1.5),
      cycles,
      outcomeByContract,
    }),
  );

  const replay = await prisma.$transaction(async (tx) => {
    const created = await tx.paperReplay.create({
      data: {
        campaignId,
        periodKind: kind,
        periodKey: key,
        actualMode: config?.mode ?? "conservative",
        actorUserId,
        ranAt: now,
      },
      select: { id: true },
    });
    for (const result of results) {
      await tx.paperReplayModeResult.create({
        data: { replayId: created.id, ...result },
      });
    }
    return created;
  });

  return { replayId: replay.id, results };
}

type ReplayCycle = Awaited<ReturnType<typeof cyclesForPeriod>>[number];

const GAME_DURATION_ALLOWANCE_MS =
  GAME_DURATION_ALLOWANCE_HOURS * 60 * 60 * 1000;

/**
 * One mode's alternate history.
 *
 * Deliberately NOT a call to `planCycle`: the planner takes live projections
 * and a live book, and this has neither — it has the recorded economics of
 * candidates that were already priced. What it reuses is the arithmetic that
 * matters (Kelly sizing, the caps, floor-to-whole-contracts, top-of-book-only
 * fills), applied to stored values, so the two cannot disagree about what a
 * given edge at a given price is worth.
 */
function simulateMode(inputs: {
  mode: PresetMode;
  startingBankrollCents: number;
  ceilingMultiple: number;
  cycles: ReplayCycle[];
  outcomeByContract: Map<string, { result: "yes" | "no" | "voided" }>;
}): ReplayModeResult {
  const preset = RISK_PRESETS[inputs.mode];
  let settled = inputs.startingBankrollCents;
  let highWater = inputs.startingBankrollCents;
  let maxDrawdownBps = 0;
  let withdrawn = 0;
  let breakerTrips = 0;
  let halted = false;

  // Held contracts per contract id, so duplicate prevention behaves in the
  // replay exactly as it did live: a second cycle adds only an increment.
  const held = new Map<string, number>();
  const openCost = new Map<string, number>();
  const openSide = new Map<string, "yes" | "no">();
  // When each held contract's game kicks off, so a position is not settled out
  // from under the cycles that were still evaluating it. See `settleFinished`.
  const kickoffByContract = new Map<string, Date>();
  const gameByContract = new Map<string, string>();
  // Distinct contracts opened, not fills. Live, a second increment accumulates
  // onto the existing position row rather than creating a second one, so
  // counting fills would report more positions than the run could have held.
  const opened = new Set<string>();

  /**
   * Credit the outcome of every held contract whose game had finished by
   * `asOf`, or of every held contract when `asOf` is null (the final sweep).
   *
   * The timing is the whole point. Settling the instant an outcome merely
   * EXISTS would clear `held` after the first cycle of a game window — and a
   * period is only replayable once all of its positions have settled, so the
   * outcome always exists from the first iteration. Three cycles pricing the
   * same contract at T-6h, T-5.5h and T-5h would then open the full desired
   * stake three times instead of once, tripling exposure and position count
   * against a live run that added nothing on cycles two and three.
   *
   * A game is treated as finished four hours after kickoff, which is longer
   * than an NFL game runs. Returning the cash late is the conservative
   * direction: it can only reduce what later cycles are able to stake.
   */
  function settleFinished(asOf: Date | null): void {
    for (const [contractId, contracts] of [...held]) {
      const kickoff = kickoffByContract.get(contractId);
      if (asOf !== null) {
        if (!kickoff) continue;
        const finishedAt = new Date(
          kickoff.getTime() + GAME_DURATION_ALLOWANCE_MS,
        );
        if (asOf < finishedAt) continue;
      }

      const outcome = inputs.outcomeByContract.get(contractId);
      if (!outcome) continue;
      const side = openSide.get(contractId);
      const cost = openCost.get(contractId);
      if (!side || cost === undefined) continue;

      const { proceedsCents } = settlementProceedsCents({
        side,
        contracts,
        costBasisCents: cost,
        feesPaidCents: 0,
        result: outcome.result,
      });
      settled += proceedsCents;
      held.delete(contractId);
      openCost.delete(contractId);
      openSide.delete(contractId);
      kickoffByContract.delete(contractId);
      gameByContract.delete(contractId);
    }
  }

  for (const cycle of inputs.cycles) {
    if (halted) continue;

    // What has finished as of this cycle, before it sizes anything.
    settleFinished(cycle.startedAt);

    const activeBankroll =
      settled + [...openCost.values()].reduce((a, b) => a + b, 0);
    const slateCapacity = capacityCents(activeBankroll, preset.perSlateCapPct);
    const gameCapacity = capacityCents(activeBankroll, preset.perGameCapPct);
    let slateUsed = [...openCost.values()].reduce((a, b) => a + b, 0);
    // Exposure already open on THIS game, carried across cycles exactly as the
    // live path carries `gameExposureCents`. Resetting it to zero each cycle
    // would let the replay stake the full per-game cap again every thirty
    // minutes — a counterfactual staking more than the campaign it is a
    // counterfactual of, which is the flattering direction of error.
    let gameUsed = [...openCost].reduce(
      (sum, [contractId, cost]) =>
        gameByContract.get(contractId) === cycle.game.id ? sum + cost : sum,
      0,
    );
    let available = settled;

    for (const candidate of cycle.candidates) {
      // Mode-independent refusals stand: staleness, an unreadable book, a
      // probability above the ceiling, and no edge after fees are all
      // properties of the evidence rather than of the risk appetite.
      if (
        candidate.verdict === "refused" ||
        candidate.kellyEdge === null ||
        Number(candidate.kellyEdge) <= 0 ||
        candidate.askCents === null ||
        candidate.topOfBookSizeContracts === null ||
        candidate.correctedProbability === null ||
        candidate.confidence === null ||
        candidate.side === null
      ) {
        continue;
      }
      const sideProbability =
        candidate.side === "yes"
          ? Number(candidate.correctedProbability)
          : 1 - Number(candidate.correctedProbability);
      if (sideProbability > PROBABILITY_CEILING) continue;

      const net = netPriceCents(candidate.askCents);
      const fraction = appliedKellyFraction(
        preset.kellyFraction,
        candidate.confidence,
      );
      const desiredTotal = contractsForStake(
        desiredStakeCents({
          kellyEdge: Number(candidate.kellyEdge),
          appliedFraction: fraction,
          activeBankrollCents: activeBankroll,
        }),
        net,
      );
      const increment = Math.max(
        0,
        desiredTotal - (held.get(candidate.contractId) ?? 0),
      );
      if (increment === 0) continue;

      let stake = increment * net;
      stake = Math.min(
        stake,
        Math.max(0, available),
        Math.max(0, gameCapacity - gameUsed),
        Math.max(0, slateCapacity - slateUsed),
      );
      const intended = contractsForStake(stake, net);
      if (intended === 0) continue;

      // The same conservative fill: never more than the size that was actually
      // displayed at the time, and never at a different price.
      const filled = Math.min(intended, candidate.topOfBookSizeContracts);
      if (filled === 0) continue;

      const cost = filled * candidate.askCents;
      const fee = feeCents(filled, candidate.askCents);
      settled -= cost + fee;
      available -= cost + fee;
      gameUsed += cost + fee;
      slateUsed += cost + fee;
      held.set(
        candidate.contractId,
        (held.get(candidate.contractId) ?? 0) + filled,
      );
      openCost.set(
        candidate.contractId,
        (openCost.get(candidate.contractId) ?? 0) + cost + fee,
      );
      openSide.set(candidate.contractId, candidate.side);
      kickoffByContract.set(candidate.contractId, cycle.game.kickoffAt);
      gameByContract.set(candidate.contractId, cycle.game.id);
      opened.add(candidate.contractId);
    }

    // Drawdown is judged on the settled balance. Marks are not available
    // historically, so the replay measures on settled balance and is labelled
    // as such rather than approximated from prices that were never recorded.
    highWater = nextHighWaterMark({
      currentCents: highWater,
      markCents: settled,
      withdrewCents: 0,
    });
    if (highWater > 0) {
      const bps = Math.round(((highWater - settled) / highWater) * 10_000);
      if (bps > maxDrawdownBps) maxDrawdownBps = bps;
      if (bps >= preset.drawdownHaltPct * 100) {
        breakerTrips += 1;
        halted = true;
      }
    }

    for (;;) {
      const excess = withdrawalCents(
        settled,
        inputs.startingBankrollCents,
        inputs.ceilingMultiple,
      );
      if (excess <= 0) break;
      settled -= excess;
      withdrawn += excess;
      highWater = settled;
    }
  }

  // The final sweep. A period is only replayable once every position in it has
  // settled, so the counterfactual must settle everything too — leaving a
  // position open at cost would report a P&L for an alternative history that
  // never finished, against an actual one that did.
  settleFinished(null);
  // The final settled balance counts toward drawdown like every intermediate
  // one. It usually rises, so this can only ever ADD a trough the run really
  // reached — never hide one.
  highWater = nextHighWaterMark({
    currentCents: highWater,
    markCents: settled,
    withdrewCents: 0,
  });
  if (highWater > 0) {
    const bps = Math.round(((highWater - settled) / highWater) * 10_000);
    if (bps > maxDrawdownBps) maxDrawdownBps = bps;
  }
  for (;;) {
    const excess = withdrawalCents(
      settled,
      inputs.startingBankrollCents,
      inputs.ceilingMultiple,
    );
    if (excess <= 0) break;
    settled -= excess;
    withdrawn += excess;
    highWater = settled;
  }

  const endingActiveCents =
    settled + [...openCost.values()].reduce((a, b) => a + b, 0);

  return {
    mode: inputs.mode,
    endingActiveCents,
    netPnlCents: endingActiveCents + withdrawn - inputs.startingBankrollCents,
    withdrawnCents: withdrawn,
    maxDrawdownBps,
    positionCount: opened.size,
    breakerTrips,
  };
}

/** The most recent stored replay for a period, if any. */
export async function latestReplay(
  campaignId: string,
  kind: PeriodKind,
  key: string,
) {
  return prisma.paperReplay.findFirst({
    where: { campaignId, periodKind: kind, periodKey: key },
    orderBy: { ranAt: "desc" },
    include: { results: { orderBy: { mode: "asc" } } },
  });
}
