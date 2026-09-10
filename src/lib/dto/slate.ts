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

/**
 * Which state a contract's projection is in for the ACTIVE model of its stat
 * type (spec §UI Data Contracts). Three distinct states the UI must keep apart:
 * a real projection; an explicit decline for lack of evidence (RD-4), rendered
 * in the warning register and distinct from a loading dash; and the ordinary
 * "no projection yet" absence.
 */
export type ProjectionState = "projected" | "insufficient_evidence" | "none";

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
  /**
   * The resolved player and game behind this row. Not secret — the grouped
   * read (spec §12) groups games → players → props by these keys rather than
   * re-querying, and both roles receive them.
   */
  playerId: string;
  gameId: string;
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

  /**
   * The raw model version behind the shown projection (`null` when there is no
   * projection). Drives the SIM/BASE provenance chip via the provenance mapper;
   * the raw string is NEVER rendered to the user.
   */
  modelVersion: string | null;
  /** The active model's projection state for this contract (spec §UI Data Contracts). */
  projectionState: ProjectionState;

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

/**
 * Model provenance for the UI. The raw `model_version` string is developer
 * vocabulary and is NEVER shown to the user (spec §UI Data Contracts, design
 * doc §4.2); every surface renders `short`/`name` instead. An unknown version
 * degrades to a neutral generic label rather than leaking the raw string.
 */
export type Provenance = { short: string; name: string };

const PROVENANCE: Record<string, Provenance> = {
  "simulation-mc-0.1.0": { short: "SIM", name: "Simulation Engine" },
  "baseline-zil-0.1.0": { short: "BASE", name: "Baseline" },
};

export function provenanceFor(modelVersion: string | null): Provenance | null {
  if (modelVersion === null) return null;
  return PROVENANCE[modelVersion] ?? { short: "MODEL", name: "Model" };
}

export type ContractDetailDto = SlateRowDto & {
  /** Admin-only diagnostics for the unresolved variant; absent for viewers. */
  resolutionNote?: string;
  kalshiPlayerName?: string;

  projectedValue: number | null;
  projectedMedian: number | null;
  intervalLow: number | null;
  intervalHigh: number | null;
  quantiles: Record<string, number> | null;
  /** The explicit PMF for `empirical_pmf` / count families; drives the bar chart. */
  pmf: number[] | null;
  distributionKind: string | null;
  drivers: string[];
  midCents: number | null;
  status: ContractStatus;
  /**
   * Human-readable decline reason, set ONLY when
   * `projectionState === "insufficient_evidence"`. Feeds the warning-register
   * block that replaces the projection.
   */
  declineReason: string | null;

  /** Present only once the contract's game is completed or cancelled. */
  outcomeBlock?: OutcomeBlockDto;
};

// ---------------------------------------------------------------------------
// Grouped slate (Pitch 10 — Slate Experience & Prop Research, spec §12)
//
// A read-time reshaping of the SAME rows `readSlate` produces: games →
// players → props. Nothing here is persisted, no ranking changes, no edge is
// stored. `PlayerCardDto` keeps the structural admin-field absence: viewer
// payloads never carry `currentDisposition`/`decidedAt` because the code path
// that builds them never touches decisions.
// ---------------------------------------------------------------------------

/**
 * The five-state plain-language freshness vocabulary (spec §5, RD-9), derived
 * from existing signals. It is a DISPLAY mapping, not a stored state, and it
 * never collapses the two clocks: `projectionComputedAt`/`informationCutoff`
 * are the projection clock, `priceObservedAt` is the price clock, and a fresh
 * price never clears a stale projection.
 */
export type FreshnessStateDto = {
  state:
    | "current"
    | "updated_recently"
    | "new_info_pending"
    | "stale"
    | "unavailable";
  /** Raw signals retained for detail/Health; the label is derived, these are not removed. */
  projectionComputedAt: string | null;
  informationCutoff: string | null;
  priceObservedAt: string | null;
};

/**
 * One (contract or stored-projection) threshold+direction for a player/stat.
 * `null` is a distinct state from `0` throughout: `modelProbability: null`
 * means "no projection", `edgePoints: null` means "no market", not a free or
 * zero-edge contract.
 */
export type PropDto = {
  /** Null for a stored projection with no currently listed contract. */
  contractId: string | null;
  /**
   * The stat type this prop belongs to. Carried so the expanded player card's
   * stat selector can partition a player's flat `props` per stat without a
   * refetch (SIG-96); the flat list spans all of a player's stat types.
   */
  statType: StatType;
  threshold: number;
  direction: "above" | "below";
  /** P(stat >= threshold) for "above"; P(stat < threshold) for "below". null ≠ 0. */
  modelProbability: number | null;
  confidence: Confidence | null;
  bidCents: number | null;
  askCents: number | null;
  /** null when no market — never zero. */
  edgePoints: number | null;
  confidenceAdjustedEdge: number | null;
  isRecommended: boolean;
};

export type PlayerCardDto = {
  playerId: string;
  playerName: string;
  teamAbbreviation: string;
  opponentAbbreviation: string;
  /** Derived from the player's stored props, never hardcoded. */
  statTypes: StatType[];
  /** All thresholds across all stat types for local (no-refetch) stepping. */
  props: PropDto[];
  /** Max `confidenceAdjustedEdge` across props (RD-5); null if none has edge. Both directions eligible. */
  bestOpportunity: PropDto | null;
  projectionState: "projected" | "insufficient_evidence" | "none";
  freshness: FreshnessStateDto;
  adjustment: {
    kind: "accepted" | "pending" | null;
    note: string | null;
    suggestionId: string | null;
  };
  /**
   * ADMIN SERIALIZER ONLY — absent (not null) from viewer payloads. The viewer
   * code path never reads decisions, so absence is structural.
   */
  currentDisposition?: Disposition;
  decidedAt?: string;
};

export type GameGroupDto = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  freshness: FreshnessStateDto;
  players: PlayerCardDto[];
};

export type SlateGroupedDto = {
  games: GameGroupDto[];
  /** Cross-game strongest-opportunity slice, ranked by the existing order (RD-5). */
  bestOpportunities: Array<{
    playerId: string;
    gameId: string;
    prop: PropDto;
    playerName: string;
    teamAbbreviation: string;
    kickoffLabel: string;
  }>;
  /** Unchanged from `readSlate`. */
  unresolved: UnresolvedRowDto[];
  /** Derived from data, never hardcoded. */
  availableStatTypes: StatType[];
  availableGames: Array<{ gameId: string; label: string }>;
  pricesUpdatedAt: string | null;
  priceDegraded: boolean;
  /**
   * The last sync refreshed some markets but not all — a mix of current and
   * last-observed prices is on screen. Distinct from `priceDegraded` (a full
   * outage); disclosed so a partial refresh is never silently presented as
   * fully current (the "disclose, don't race" posture).
   */
  pricePartial: boolean;
};
