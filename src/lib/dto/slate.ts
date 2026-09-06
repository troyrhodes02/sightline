import type {
  Confidence,
  ContractStatus,
  Disposition,
  MarketSide,
  MarketSyncStatus,
  ProjectionGradeStatus,
  StatType,
} from "../../../generated/prisma/enums";

/**
 * The slate and contract-detail contracts the UI consumes.
 *
 * Null is a state, not a shorthand: `modelProbability: null` means "no
 * projection", which the UI must render differently from a small number, and
 * `yesAskCents: null` means "no current price", which is not a free contract.
 *
 * **The admin-only fields are optional and ABSENT from viewer payloads** —
 * not null, absent. The viewer serializer never touches decision data, so
 * absence is structural rather than a filter that could regress.
 */

export type StalenessDto = {
  /**
   * Clearable (RD-22): ingested game-scoped facts postdate the displayed
   * projection's information cutoff. Clears only when a recomputed
   * projection's cutoff demonstrates incorporation — never on ingest alone,
   * never on clock advance.
   */
  isStale: boolean;
  /**
   * Permanent this version (RD-23): the game is past
   * kickoff − INACTIVES_LEAD_MINUTES. A disclosure, not a failure —
   * Sightline has no inactives source yet.
   */
  predatesInactives: boolean;
  /** Absolute expected-inactives instant for the detail sentence; null until applicable. */
  inactivesExpectedAt: string | null;
};

export type SlateRowDto = {
  contractId: string;
  playerName: string;
  /** "CIN @ BAL" — away at home. Null only for an unresolved game. */
  gameLabel: string | null;
  statType: StatType;
  threshold: number;
  kickoffAt: string;

  modelProbability: number | null;
  confidence: Confidence | null;
  projectionComputedAt: string | null;
  informationCutoff: string | null;
  /** Null iff no projection — staleness qualifies a projection (RD-22/23). */
  staleness: StalenessDto | null;
  /** Server-formatted ("38m", "6h", "2d 4h") at serialization time (RD-28). */
  projectionAge: string | null;

  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
  priceObservedAt: string | null;
  /** The price clock's age — never merged with the projection clock (RD-29). */
  priceAge: string | null;

  side: MarketSide | null;
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;

  currentDisposition?: Disposition;
  decidedAt?: string;
};

export type UnresolvedRowDto = {
  contractId: string;
  title: string;
  kalshiTicker: string;
  yesAskCents: number | null;
  priceObservedAt: string | null;

  resolutionNote?: string;
  kalshiPlayerName?: string;
};

export type SlateDto = {
  generatedAt: string;
  slateDate: string | null;
  gameCount: number;
  rows: SlateRowDto[];
  unresolved: UnresolvedRowDto[];
  lastSync: { status: MarketSyncStatus; finishedAt: string | null } | null;
  degraded: boolean;
  nextKickoffAt: string | null;
};

/**
 * The contract's outcome block (spec §12) — present on the detail payload only
 * once the game is completed (or cancelled, showing the taxonomy state), and
 * absent entirely pre-completion.
 *
 * Settlement and the official line are two facts and may disagree;
 * `sourcesDisagree` flags the conflict with both values preserved, never
 * reconciled. **The `decision` key is added by the admin serializer and never
 * nulled for viewers** — absent, not null, so the viewer payload is
 * structurally decision-free.
 */
export type OutcomeBlockDto = {
  officialValue: number | null;
  /** Latest correction date, when any corrections exist. */
  officialCorrectedAt: string | null;
  settlement: {
    result: "yes" | "no" | "voided";
    settledAt: string | null;
  } | null;
  projectionGrade: {
    status: ProjectionGradeStatus;
    hit: boolean | null;
    statedProbability: number | null;
  } | null;
  recommendationGrade:
    | "correct"
    | "incorrect"
    | "voided"
    | "missing_final_snapshot"
    | "pending"
    | null;
  sourcesDisagree: boolean;
  /** ADMIN SERIALIZER ONLY — key absent for viewers. */
  decision?: { disposition: string; outcome: string };
};

export type ContractDetailDto = SlateRowDto & {
  /** Admin-only diagnostics for the unresolved variant; absent for viewers. */
  resolutionNote?: string;
  kalshiPlayerName?: string;

  projectedValue: number | null;
  projectedMedian: number | null;
  intervalLow: number | null;
  intervalHigh: number | null;
  quantiles: Record<string, number> | null;
  drivers: string[];
  modelVersion: string | null;
  midCents: number | null;
  status: ContractStatus;

  /** Present only once the contract's game is completed or cancelled. */
  outcomeBlock?: OutcomeBlockDto;
};
