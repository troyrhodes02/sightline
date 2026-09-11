import type { Confidence, StatType } from "../../../generated/prisma/enums";

/**
 * The model-comparison evidence layer's contracts (spec §UI data contracts).
 *
 * Contract rules that must survive refactors:
 *
 * - `null` and `0` are different states everywhere. A Brier that was not
 *   computed (no evidence, or a side empty) is `null`, never zero — a stored
 *   zero would be read as a perfect score.
 * - Live and Backtest are two labelled records (D15). A DTO carries exactly one
 *   `record`; nothing here blends them into a single count or score.
 * - Every leader state that is not `not_enough_evidence` carries its margin and
 *   both sample counts (D14) — the number is never shown without its evidence.
 * - Each model's Brier is measured under its OWN `RecalibrationFit` keyed by
 *   `modelVersion` (D4). The `baselineModelVersion` / `simulationModelVersion`
 *   fields name which record each Brier belongs to so the two can never be
 *   confused for one another.
 */

export type LeaderState =
  | "simulation_leads"
  | "baseline_leads"
  | "too_close_to_call"
  | "not_enough_evidence";

export type EvidenceStrength = "strong" | "moderate" | "limited";
export type EvidenceRecord = "live" | "backtest";
export type ComparisonPopulation = "contract_like" | "all" | "market_linked";

/**
 * One model's independently-read series for a (record, population) scope. Read
 * under this model's own fit; a comparison assembles two of these and never
 * pairs one model's projections with another's correction (D4).
 */
export type ModelSeriesDto = {
  modelVersion: string;
  record: EvidenceRecord;
  population: ComparisonPopulation;
  /** Brier of the recalibrated probability, or null when the sample is empty. */
  brier: number | null;
  /** Deduped per (model, contract) for live (D3); raw for backtest. */
  observations: number;
  /** The fit version that corrected this model's probabilities, or null. */
  recalibrationVersion: number | null;
};

export type ModelComparisonDto = {
  record: EvidenceRecord;
  population: ComparisonPopulation;
  leader: LeaderState;
  baselineBrier: number | null;
  simulationBrier: number | null;
  /** abs(baseline − simulation); null if a side is empty. */
  brierMargin: number | null;
  baselineModelVersion: string;
  simulationModelVersion: string;
  /** Deduped per (model, contract) — D3. Zero for a backtest record. */
  liveObservations: number;
  backtestObservations: number;
  evidence: EvidenceStrength;
};

export type StatLeaderRowDto = {
  statType: StatType;
  leader: LeaderState;
  brierMargin: number | null;
  /** For the selected record's population. */
  sampleSize: number;
  evidence: EvidenceStrength;
  /** Sample under the record's applicable minimum floor. */
  belowFloor: boolean;
};

/**
 * The viewer-facing model track-record block on contract detail (spec §UI data
 * contracts, D8/D18/D22). The ONLY model-quality surface a viewer sees.
 *
 * Deliberately narrow — this is the whole payload, so what is not here cannot
 * leak. There is no leader, no shadow-model figure, no paper bankroll, no admin
 * link, and nothing from which a viewer could infer a second engine runs (D22):
 * the block is a function of the ACTIVE production model's own graded record for
 * this stat, and names no other model. The admin receives an identical payload
 * (D18) — the richer comparison lives on Model Performance, never here.
 *
 * Contract rules that must survive refactors:
 *
 * - `rangeObservedRate === null` (below the 30-obs floor, D8) is a different
 *   state from a real `0` rate; the component renders the honest
 *   insufficient-evidence sentence with the running count, never a fabricated
 *   rate. `rangeSampleSize` is always shown.
 * - `modelProbability` is a probability (a %); `confidence` is a word — never
 *   conflated (D16). The DTO keeps them as separate typed fields.
 * - `trackRecord` may read `limited` even below the floor; the label is a
 *   qualitative track-record strength, not a rate, and never implies
 *   profitability.
 */
export type ContractTrackRecordDto = {
  /** The active production model's P(threshold) for this contract. */
  modelProbability: number;
  /** A word (low / medium / high), never a percentage (D16). */
  confidence: Confidence;
  statType: StatType;
  /** e.g. "70–80%" — the displayed probability's bucket. */
  rangeLabel: string;
  /** Observed frequency in the bucket; null below the 30-obs floor (D8). */
  rangeObservedRate: number | null;
  /** Running count of graded observations in the bucket (D8). */
  rangeSampleSize: number;
  /** Stat-type track record from pooled graded evidence. */
  trackRecord: EvidenceStrength;
  /** Pooled graded observations for the stat — the count behind `trackRecord`. */
  statObservations: number;
  /** True when the bucket sample is under the 30-obs display floor (D8). */
  belowFloor: boolean;
};

export type PortfolioKind = "baseline" | "simulation" | "hybrid";

export type PaperRiskModeName =
  "conservative" | "moderate" | "aggressive" | "custom";

/**
 * One paper portfolio's financial + opportunity scorecard (spec §UI data
 * contracts, D5/D11/D17/D19/D20). Shared by Model Performance → Summary and
 * Paper Bot → Performance; the field names mean the same on both surfaces.
 *
 * Contract rules that must survive refactors:
 *
 * - `null` is not `0`. `activeBankrollCents === null` means mark-to-market was
 *   unavailable (a degraded read), which is a different fact from an active
 *   bankroll that happens to be zero; when it is null, everything that depends
 *   on a live mark — `totalValueCents`, `netPnlCents`, `returnPct`,
 *   `maxDrawdownBps` — is null too rather than silently settling-only.
 * - Every scorecard carries `candidatesEvaluated` and `candidatesSized` (D5) so
 *   a bankroll figure is never shown without the opportunity set behind it. The
 *   three portfolios may legitimately differ in opportunity set.
 * - Money is presented neutral; only the SIGN of a P&L figure takes colour
 *   (D19) — a display concern the DTO supports by carrying signed cents, never
 *   a pre-formatted string.
 * - These are paper figures, permanently (D20), and are never aggregated with
 *   one another or with any future live-money ledger — each row stands alone.
 */
export type PortfolioScorecardDto = {
  portfolio: PortfolioKind;
  startingBankrollCents: number;
  /** null = mark-to-market unavailable (degraded). Distinct from a real 0. */
  activeBankrollCents: number | null;
  withdrawnCents: number;
  /** Active bankroll + cumulative withdrawals; null when the mark is degraded. */
  totalValueCents: number | null;
  /** Total value − starting bankroll; null when the mark is degraded. */
  netPnlCents: number | null;
  returnPct: number | null;
  /** null when active bankroll is unavailable. */
  maxDrawdownBps: number | null;
  /** Aggregated from PaperCycle.candidatesEvaluated across the window (D5). */
  candidatesEvaluated: number;
  /** Aggregated from PaperCycle.candidatesSized across the window (D5). */
  candidatesSized: number;
  positionCount: number;
  riskMode: PaperRiskModeName;
  breakerEventCount: number;
};

/**
 * The readiness summary strip shown on Model Performance → Summary (D2/D21).
 * Decision support only, never a control: it never auto-enables live trading.
 * `state` mirrors the paper readiness headline; the active configuration's
 * portfolio is named so the two-week clock is read against the right anchor.
 */
export type ReadinessSummaryDto = {
  state: "not_ready" | "paper_evidence_building";
  weeksComplete: number;
  weeksRequired: number;
};

/**
 * The three levels of the Model Performance surface, deep-linked via `?level=`.
 * Default is `summary`. `advanced` is the preserved Accuracy surface (D9).
 */
export type ModelPerformanceLevel = "summary" | "breakdown" | "advanced";

/**
 * Everything Model Performance → Summary and → Breakdown read from the
 * evidence + paper layers, assembled server-side (spec §UI data contracts, D9).
 *
 * Live and Backtest overall comparisons are two labelled records (D15) — the
 * surface shows both without blending. `scorecards` is `null` when no paper
 * evaluation campaign exists yet (the designed no-campaign state, linking to
 * Settings), distinct from an empty array. `readiness` is likewise `null`
 * without a campaign. The Hybrid scorecard is simply absent from the array when
 * no hybrid portfolio was provisioned (never a zeroed row).
 */
export type ModelPerformanceDto = {
  /** Overall pooled contract-like comparison for each record (D15). */
  overallLive: ModelComparisonDto;
  overallBacktest: ModelComparisonDto;
  /** Recommendation prose over the live record (D12) — decision support only. */
  recommendation: ModelRecommendationDto;
  /** Per-stat leaders for the live record. */
  statLeadersLive: StatLeaderRowDto[];
  /** Per-stat leaders for the backtest record. */
  statLeadersBacktest: StatLeaderRowDto[];
  /** null = no paper evaluation campaign yet (link to Settings). */
  scorecards: PortfolioScorecardDto[] | null;
  /** null = no paper evaluation campaign yet. */
  readiness: ReadinessSummaryDto | null;
  /** Whether a hybrid selection has been made (Hybrid scorecard present). */
  hybridSelected: boolean;
};

/**
 * The period a scorecard read windows over. NONE of these reset the campaign
 * bankroll — they window the opportunity/position aggregates and the P&L is
 * always measured against the campaign's real starting bankroll (D-period).
 */
export type ScorecardPeriod =
  "current_week" | "previous_week" | "two_week" | "campaign";

/**
 * The plain-language recommendation (D12). Decision support only — this is a
 * DTO, never a config write. `canRecommend` is false whenever the evidence
 * cannot support a recommendation, and the text says so honestly rather than
 * inventing a verdict on a thin sample.
 */
export type ModelRecommendationDto = {
  /** The overall leader the recommendation is built from. */
  leader: LeaderState;
  /** True only when a model leads with sufficient, non-trivial evidence. */
  canRecommend: boolean;
  /** The model the text recommends considering, or null when it recommends none. */
  recommendedModelVersion: string | null;
  /** One or two plain-language sentences. Never a control, never a config. */
  text: string;
};
