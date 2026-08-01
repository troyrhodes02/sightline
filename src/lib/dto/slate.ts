import type {
  Confidence,
  ContractStatus,
  Disposition,
  MarketSide,
  MarketSyncStatus,
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

  yesBidCents: number | null;
  yesAskCents: number | null;
  noBidCents: number | null;
  noAskCents: number | null;
  priceObservedAt: string | null;

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
};
