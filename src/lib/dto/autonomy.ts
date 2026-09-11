import type {
  BindingConstraint,
  BreachCondition,
  BreachResolution,
  CandidateVerdict,
  Confidence,
  MarketSide,
  PaperCycleOutcome,
  PaperPortfolio,
  PaperPositionStatus,
  RiskMode,
  StatType,
} from "../../../generated/prisma/enums";
import type { PortfolioScorecardDto } from "@/lib/dto/model-eval";

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
  /**
   * The portfolio this cycle belongs to (PME-6, Activity). Present so an `All`
   * view stays legible; a single-portfolio filter still carries it.
   */
  portfolio?: PaperPortfolio;
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
  /**
   * The portfolio holding this position (PME-6, Activity). Present so an `All`
   * view names each row's portfolio.
   */
  portfolio?: PaperPortfolio;
  /**
   * The model version that produced the driving probability (PME-6, D6). Fixed
   * at open time and never rewritten — for a Hybrid position it names the engine
   * selected for the stat at decision time, and a later selection change never
   * relabels it.
   */
  sourceModelVersion?: string;
};

/**
 * Everything Paper Bot → Activity renders (PME-6, D10). Positions and cycles
 * across the campaign's portfolios; the portfolio and view filters window which
 * of each is shown, deep-linked. Records are never deleted — a failed cycle is a
 * row with a reason, not an absence.
 */
export type ActivityDto = {
  view: "positions" | "cycles";
  portfolio: PaperPortfolio | "all";
  /** The status GROUPING the UI filters on, not the raw enum. */
  status: "open" | "settled" | "all";
  positions: PositionRowDto[];
  cycles: CycleRowDto[];
  openCount: number;
  settledCount: number;
  /** True when a paper evaluation campaign exists at all. */
  campaignExists: boolean;
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
  /** The withdrawal ceiling multiple (PME-6 Settings), on the parent campaign. */
  withdrawalCeilingMultiple: number;
  /** Continuous paper evaluation flag (PME-6 Settings), on the parent campaign. */
  continuousEvaluationEnabled: boolean;
};

/** One portfolio's breach state on the Performance banner (PME-6, per portfolio). */
export type PortfolioBreachDto = {
  portfolio: PaperPortfolio;
  breaches: BreachDto[];
  /** Whether any breach on THIS portfolio halts it. */
  halted: boolean;
};

/** A per-portfolio bankroll history series for the 3-series chart (PME-6). */
export type PortfolioBankrollSeriesDto = {
  portfolio: PaperPortfolio;
  points: Array<{ at: string; settledCents: number }>;
  highWaterMarkCents: number;
  haltThresholdCents: number | null;
};

/**
 * Everything Paper Bot → Performance renders (PME-6, D10/D11/D19/D21). Three
 * portfolio scorecards under identical assumptions, per-portfolio breach state,
 * a 3-series bankroll chart, and the readiness summary with its criterion detail
 * one click away. Nothing here writes configuration; readiness never enables
 * live trading.
 */
export type PaperBotPerformanceDto = {
  campaignExists: boolean;
  killSwitchEngaged: boolean;
  startingBankrollCents: number;
  riskModeName: RiskMode | null;
  /** The campaign start, for the "began Wk N" caption. */
  campaignStartedAt: string | null;
  scorecards: PortfolioScorecardDto[];
  portfolioBreaches: PortfolioBreachDto[];
  bankrollSeries: PortfolioBankrollSeriesDto[];
  /** The full readiness evaluation (summary state + criterion detail — D21). */
  readiness: ReadinessDetailDto;
  period: "current_week" | "previous_week" | "two_week" | "campaign";
  emptyReason: "no_campaign" | null;
};

/** The readiness evaluation for Performance, summary + expandable detail (D21). */
export type ReadinessDetailDto = {
  state: ReadinessState;
  weeksComplete: number;
  weeksRequired: number;
  activeConfigurationPortfolio: PaperPortfolio;
  paperResultPositive: boolean;
  modelQualityHealthy: boolean;
  operationalHealthy: boolean;
  disclaimer: string;
  criteria: Array<{
    key: string;
    category: "paper_evidence" | "model_quality" | "safety_operations";
    label: string;
    met: boolean;
    evidence: string;
    unevaluable: boolean;
  }>;
};

/** Model selection row for Settings (PME-6, D13). */
export type ModelSelectionRowDto = {
  statType: StatType;
  /** The currently-active model version for this stat. */
  activeModelVersion: string;
  /** Whether Simulation supports this stat (radio enabled/disabled). */
  simulationSupported: boolean;
  /**
   * The advisory recommendation glyph (★) target for this stat, derived from the
   * live per-stat leader (D13). One of the two model versions, or null when the
   * leader is too_close_to_call / not_enough_evidence. Advisory only — never a
   * control (D12).
   */
  recommendedModelVersion: string | null;
  /** Plain-language evidence label, e.g. "Simulation (moderate)". */
  evidenceLabel: string;
};

/** Everything Paper Bot → Settings renders (PME-6, D13). */
export type PaperBotSettingsDto = {
  config: ConfigurationDto;
  modelSelections: ModelSelectionRowDto[];
  baselineModelVersion: string;
  simulationModelVersion: string;
};

export type ActiveBreachesDto = {
  campaignExists: boolean;
  killSwitchEngaged: boolean;
  breaches: BreachDto[];
};
