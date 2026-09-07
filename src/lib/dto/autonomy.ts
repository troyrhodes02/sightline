import type {
  BindingConstraint,
  BreachCondition,
  BreachResolution,
  CandidateVerdict,
  Confidence,
  MarketSide,
  PaperCycleOutcome,
  PaperPositionStatus,
  RiskMode,
  StatType,
} from "../../../generated/prisma/enums";

/**
 * The DTOs the Autonomy surfaces consume.
 *
 * Two shapes here carry product rules rather than convenience.
 *
 * `MoneyDto` is a discriminated union rather than `number | null`. On these
 * screens "unavailable" is a first-class rendered state — mark-to-market and
 * therefore drawdown genuinely cannot be computed when an open position has no
 * usable bid — and a bare null invites a `?? 0` at a call site, which would
 * render a missing number as zero dollars.
 *
 * `boundBy` is a required closed enum on every candidate, never optional and
 * never blank. It is the audit trail this whole feature exists to produce.
 */

export type MoneyDto = { cents: number } | { unavailable: true };

export function money(cents: number): MoneyDto {
  return { cents };
}

export const MONEY_UNAVAILABLE: MoneyDto = { unavailable: true };

export function isMoneyAvailable(value: MoneyDto): value is { cents: number } {
  return "cents" in value;
}

export type AutonomyStatusDto = "disabled" | "active" | "halted" | "killed";

export type RiskModeDto = {
  mode: RiskMode;
  kellyFraction: number;
  perGameCapPct: number;
  perSlateCapPct: number;
  drawdownWarnPct: number;
  drawdownHaltPct: number;
  probabilityCeiling: number;
  withdrawalCeilingMultiple: number;
};

export type BreachDto = {
  id: string;
  condition: BreachCondition;
  label: string;
  conditionDescription: string;
  measuredDisplay: string;
  thresholdDisplay: string;
  trippedAt: string;
  resolution: BreachResolution;
  resolvedAt: string | null;
  resolvedByDisplayName: string | null;
  /** `drawdown_warning` is the only condition that does not halt. */
  halts: boolean;
};

export type ExposureMeterDto = {
  key: string;
  label: string;
  usedCents: number;
  capCents: number;
  capPct: number;
};

export type CycleRowDto = {
  cycleId: string;
  startedAt: string;
  gameLabel: string;
  kickoffAt: string;
  outcome: PaperCycleOutcome;
  reason: string | null;
  candidatesEvaluated: number | null;
  candidatesSized: number | null;
  candidatesFilled: number | null;
  stakedCents: number | null;
};

export type CandidateDto = {
  contractId: string;
  rank: number;
  playerName: string;
  teamAbbreviation: string | null;
  statType: StatType | null;
  threshold: number | null;
  /** Null is "could not price this", never zero. */
  rawProbability: number | null;
  correctedProbability: number | null;
  confidence: Confidence | null;
  side: MarketSide | null;
  askCents: number | null;
  feeCents: number | null;
  netPriceCents: number | null;
  topOfBookSizeContracts: number | null;
  kellyEdge: number | null;
  kellyFractionApplied: number | null;
  /** Intended and filled are two fields, always both. */
  intendedStakeCents: number;
  intendedContracts: number;
  filledContracts: number;
  filledCostCents: number;
  filledFeeCents: number;
  unfilledStakeCents: number;
  verdict: CandidateVerdict;
  boundBy: BindingConstraint;
  boundByDetail: string | null;
};

export type CycleDetailDto = {
  cycleId: string;
  gameLabel: string;
  kickoffAt: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: PaperCycleOutcome;
  reason: string | null;
  mode: RiskModeDto;
  recalibration: {
    version: number;
    backtestLabel: string;
    liveObservationCount: number;
  } | null;
  bankrollAtEvaluationCents: number;
  slateCapacityCents: number;
  gameCapacityCents: number;
  candidates: CandidateDto[];
  allocationTrace: string[];
};

export type PositionRowDto = {
  positionId: string;
  contractId: string;
  playerName: string;
  statType: StatType | null;
  threshold: number | null;
  side: MarketSide;
  contracts: number;
  costBasisCents: number;
  feesPaidCents: number;
  intendedStakeCents: number;
  unfilledStakeCents: number;
  /** Null means unavailable, and renders as such — never as zero. */
  markCents: number | null;
  status: PaperPositionStatus;
  settlementResult: "yes" | "no" | "voided" | null;
  /** Null while open. Unrealised value never enters this field. */
  realizedPnlCents: number | null;
  openedAt: string;
  settledAt: string | null;
};

export type ReadinessState =
  "not_ready" | "paper_evidence_building" | "eligible_for_live_trading";

export type AutonomyOverviewDto = {
  status: AutonomyStatusDto;
  killSwitchEngaged: boolean;
  autonomyEnabled: boolean;
  mode: RiskModeDto | null;
  figures: {
    startingBankrollCents: number;
    settledBalanceCents: number;
    openExposureCents: number;
    activeBankroll: MoneyDto;
    cumulativeWithdrawalsCents: number;
    totalPaperWealth: MoneyDto;
    netPaperPnl: MoneyDto;
    /** Null means unavailable, never zero. */
    maxDrawdownBps: number | null;
    highWaterMarkCents: number;
    markToMarketAvailable: boolean;
    priceLastFetchedAt: string | null;
  };
  exposure: { slate: ExposureMeterDto | null; games: ExposureMeterDto[] };
  history: Array<{
    at: string;
    settledCents: number;
    markCents: number | null;
  }>;
  breaches: BreachDto[];
  recentCycles: CycleRowDto[];
  readiness: {
    state: ReadinessState;
    weeksComplete: number;
    weeksRequired: number;
  };
  emptyReason: "not_enabled" | "offseason" | "no_cycles_this_week" | null;
  nextWindowOpensAt: string | null;
  lastCycleAt: string | null;
};

export type ConfigurationDto = {
  mode: RiskModeDto | null;
  autonomyEnabled: boolean;
  startingBankrollCents: number;
  /** False once any fill exists: the starting bankroll defines the record. */
  startingBankrollEditable: boolean;
  hasActiveHaltingBreach: boolean;
};

export type ActiveBreachesDto = {
  campaignExists: boolean;
  killSwitchEngaged: boolean;
  breaches: BreachDto[];
};
