import type { Confidence, StatType } from "../../../generated/prisma/enums";
import type { FreshnessStateDto } from "./slate";

/**
 * Prop Research DTOs (Pitch 10 — Slate Experience & Prop Research, spec §9/§12,
 * design doc Screen 7).
 *
 * Prop Research answers an arbitrary player/stat/threshold question from a
 * distribution Sightline has ALREADY computed. It is probability-only: the
 * distribution is delivered to the client, which recomputes `P(≥)`/`P(<)`
 * locally via the shared `probAtLeast` on every threshold change — no engine
 * runs, no round trip, and NO edge is ever computed here (RD-8). It reads the
 * BASE projection only (RD-AS): an accepted adjustment shadow changes what the
 * Slate displays, never what Prop Research researches.
 */

/**
 * A player eligible for Prop Research: has ≥1 current stored base `Projection`
 * for a game whose kickoff is still in the future. Each carries the player's
 * upcoming games and, per game, the stat types with a stored base distribution
 * so the game/stat selectors are populated from data, never hardcoded.
 */
export type ResearchPlayerDto = {
  playerId: string;
  fullName: string;
  games: Array<{
    gameId: string;
    label: string;
    kickoffAt: string;
    statTypes: StatType[];
  }>;
};

/**
 * The base distribution plus metadata for one (player, game, stat), delivered
 * so the client recomputes the complementary probabilities locally on any
 * threshold. `listedContractId` supports the "View contract" link ONLY when the
 * entered threshold exactly matches a currently-listed contract with a fresh
 * price; Prop Research computes no edge either way (RD-8).
 */
export type PropResearchProjectionDto = {
  available: true;
  playerId: string;
  playerName: string;
  gameId: string;
  gameLabel: string;
  /** Enforces pre-kickoff on the client too; a game that kicked off shows the started state. */
  kickoffAt: string;
  statType: StatType;
  // Distribution delivered for local P(≥)/P(<) recompute via `probAtLeast`.
  distributionKind: string;
  params: Record<string, number>;
  pmf: number[] | null;
  quantiles: Record<string, number> | null;
  projectedValue: number;
  projectedMedian: number;
  intervalLow: number;
  intervalHigh: number;
  confidence: Confidence;
  drivers: string[];
  computedAt: string;
  informationCutoff: string;
  /** Developer vocabulary; the UI renders `provenanceFor(modelVersion)`, never the raw string. */
  modelVersion: string;
  freshness: FreshnessStateDto;
  /**
   * A listed contract at each stored threshold with a fresh price, so the
   * client can resolve the exact-match "View contract" link WITHOUT any edge.
   * Keyed by threshold; a threshold with no fresh-priced listed contract is
   * absent. This is the only price-derived field, and it drives a link, never a
   * number (RD-8).
   */
  listedContracts: Array<{ threshold: number; contractId: string }>;
};

/**
 * The honest unavailable states (RD-4): no current stored base projection (or a
 * decline) → `no_projection`, never a season-average fallback; a game that has
 * reached kickoff → `game_started`, no probability shown.
 */
export type PropResearchUnavailableDto = {
  available: false;
  reason: "no_projection" | "game_started";
  /** Echoed back for the honest-state copy ("… for {player} · {stat} · this week"). */
  playerName: string | null;
  statType: StatType | null;
  gameLabel: string | null;
};

export type PropResearchResponse =
  PropResearchProjectionDto | PropResearchUnavailableDto;

/**
 * The client-computed result for one entered threshold. `P(<) = 1 − P(≥)`
 * exactly (RD-1). There is NO edge or profitability field — by construction,
 * not by omission.
 */
export type PropResearchResultDto = {
  threshold: number;
  probabilityAbove: number;
  probabilityBelow: number;
};
