import "server-only";

import { serverEnv } from "@/env";
import { prisma } from "@/lib/prisma";
import type { StatType } from "../../../generated/prisma/enums";
import type {
  GameGroupDto,
  PlayerCardDto,
  PropDto,
  SlateGroupedDto,
  SlateRowDto,
} from "@/lib/dto/slate";
import { compareSlateRows } from "./edge";
import { deriveFreshness } from "./freshness";
import { probAtLeast } from "./probability";
import { readSlate, type SlateRole } from "./read";

/**
 * The grouped slate read (Pitch 10, SIG-95): the SAME rows `readSlate`
 * produces, reshaped into games → players → props. It is a read-time
 * projection of stored data — no model runs, no ranking change (RD-5), no
 * stored edge, no new fact table.
 *
 * It composes `readSlate(role)` rather than re-deriving edge/probability/
 * staleness, so the flat and grouped surfaces can never disagree and the ONE
 * snapshot-transition write still happens exactly once (in `readSlate`). Two
 * additional reads decorate the grouping: the player's team-in-game (for the
 * card header) and accepted/pending adjustment context (unchanged from Pitch 9;
 * this builds no second suggestion mechanism).
 *
 * Role split stays structural: the admin decision fields on `SlateRowDto` are
 * only ever populated by `readSlate` for admins, so a viewer's `PlayerCardDto`
 * is decision-free by construction — the fields are copied only when present.
 */
export async function readSlateGrouped(
  role: SlateRole,
): Promise<SlateGroupedDto> {
  const now = new Date();
  const slate = await readSlate(role);
  const rows = slate.rows;

  // Team-in-game for each resolved (player, game): the card header wants the
  // player's own team and opponent. `PlayerGameContext.teamAbbrAtGame` is the
  // sanctioned per-game affiliation (there is deliberately no current-team
  // column on Player). One batched query; absent → empty string (honest
  // "unknown", the presentation ticket decides the fallback).
  const teamByPlayerGame = await teamAbbrByPlayerGame(rows);

  // Accepted/pending adjustment context per (player, game). Accepted is already
  // reflected in the projection `readSlate` returned; here we only surface the
  // note. Pending also gates the `new_info_pending` freshness state.
  const adjustmentByPlayerGame = await adjustmentContextByPlayerGame(rows);

  const priceFreshnessSeconds = serverEnv().PRICE_ONVIEW_FRESHNESS_SECONDS;

  // --- Group rows: game → player → props ---------------------------------
  const gameOrder: string[] = [];
  const gamesById = new Map<
    string,
    {
      gameId: string;
      homeTeam: string;
      awayTeam: string;
      kickoffAt: string;
      playerOrder: string[];
      playersById: Map<string, { rows: SlateRowDto[] }>;
    }
  >();

  for (const row of rows) {
    const gameId = row.gameId;
    if (!gamesById.has(gameId)) {
      const { homeTeam, awayTeam } = splitGameLabel(row.gameLabel);
      gamesById.set(gameId, {
        gameId,
        homeTeam,
        awayTeam,
        kickoffAt: row.kickoffAt,
        playerOrder: [],
        playersById: new Map(),
      });
      gameOrder.push(gameId);
    }
    const game = gamesById.get(gameId)!;
    if (!game.playersById.has(row.playerId)) {
      game.playersById.set(row.playerId, { rows: [] });
      game.playerOrder.push(row.playerId);
    }
    game.playersById.get(row.playerId)!.rows.push(row);
  }

  const games: GameGroupDto[] = [];
  const bestOpportunities: SlateGroupedDto["bestOpportunities"] = [];

  for (const gameId of gameOrder) {
    const group = gamesById.get(gameId)!;
    const players: PlayerCardDto[] = [];

    for (const playerId of group.playerOrder) {
      const playerRows = group.playersById.get(playerId)!.rows;
      const card = buildPlayerCard({
        role,
        playerId,
        playerRows,
        gameId,
        homeTeam: group.homeTeam,
        awayTeam: group.awayTeam,
        teamAbbr: teamByPlayerGame.get(`${playerId}:${gameId}`) ?? "",
        adjustment: adjustmentByPlayerGame.get(`${playerId}:${gameId}`) ?? null,
        priceFreshnessSeconds,
        now,
      });
      players.push(card);

      if (card.bestOpportunity) {
        bestOpportunities.push({
          playerId,
          gameId,
          prop: card.bestOpportunity,
          playerName: card.playerName,
          teamAbbreviation: card.teamAbbreviation,
          kickoffLabel: group.kickoffAt,
        });
      }
    }

    games.push({
      gameId,
      homeTeam: group.homeTeam,
      awayTeam: group.awayTeam,
      kickoffAt: group.kickoffAt,
      freshness: aggregateGameFreshness(players),
      players,
    });
  }

  // Cross-game best-opportunities ordering: the EXISTING slate order (RD-5),
  // applied to each player's best prop. A below-direction prop can lead.
  bestOpportunities.sort((a, b) =>
    compareSlateRows(
      {
        edgePoints: a.prop.edgePoints,
        confidenceAdjustedEdge: a.prop.confidenceAdjustedEdge,
        kickoffAt: a.kickoffLabel,
        kalshiTicker: a.prop.contractId ?? "",
      },
      {
        edgePoints: b.prop.edgePoints,
        confidenceAdjustedEdge: b.prop.confidenceAdjustedEdge,
        kickoffAt: b.kickoffLabel,
        kalshiTicker: b.prop.contractId ?? "",
      },
    ),
  );

  // Available filters derived from the data on the slate, never hardcoded.
  const availableStatTypes = [
    ...new Set(rows.map((row) => row.statType)),
  ].sort();
  const availableGames = games.map((game) => ({
    gameId: game.gameId,
    label: `${game.awayTeam} @ ${game.homeTeam}`,
  }));

  return {
    games,
    bestOpportunities,
    unresolved: slate.unresolved,
    availableStatTypes,
    availableGames,
    pricesUpdatedAt: slate.lastSync?.finishedAt ?? null,
    priceDegraded: slate.degraded,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type AdjustmentContext = {
  kind: "accepted" | "pending";
  note: string | null;
  suggestionId: string;
};

/**
 * Build one player's card. The player's props are all their thresholds across
 * all stat types, plus the complementary below-direction prop for each (RD-1:
 * `P(<) = 1 − P(≥)`). Best opportunity is the max `confidenceAdjustedEdge`
 * across ALL props (both directions eligible, RD-5), using the edge the
 * underlying row already computed.
 */
function buildPlayerCard(args: {
  role: SlateRole;
  playerId: string;
  playerRows: SlateRowDto[];
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  teamAbbr: string;
  adjustment: AdjustmentContext | null;
  priceFreshnessSeconds: number;
  now: Date;
}): PlayerCardDto {
  const {
    role,
    playerId,
    playerRows,
    teamAbbr,
    homeTeam,
    awayTeam,
    adjustment,
    priceFreshnessSeconds,
    now,
  } = args;

  const props: PropDto[] = [];
  for (const row of playerRows) {
    props.push(...propsForRow(row));
  }

  // Best opportunity: max confidence-adjusted edge over every prop, both
  // directions eligible. Ties broken by raw edge, matching the slate order.
  let bestOpportunity: PropDto | null = null;
  for (const prop of props) {
    if (prop.confidenceAdjustedEdge === null) continue;
    if (
      bestOpportunity === null ||
      bestOpportunity.confidenceAdjustedEdge === null ||
      prop.confidenceAdjustedEdge > bestOpportunity.confidenceAdjustedEdge ||
      (prop.confidenceAdjustedEdge === bestOpportunity.confidenceAdjustedEdge &&
        (prop.edgePoints ?? 0) > (bestOpportunity.edgePoints ?? 0))
    ) {
      bestOpportunity = prop;
    }
  }

  // The card's projection facts come from the (single) freshest projection for
  // this player/game; all rows for a player share it, so the first row carries
  // representative projection/price clocks and staleness.
  const lead = playerRows[0];
  const opponent =
    teamAbbr === homeTeam ? awayTeam : teamAbbr === awayTeam ? homeTeam : "";

  const freshness = deriveFreshness(
    {
      staleness: lead.staleness,
      projectionComputedAt: lead.projectionComputedAt,
      informationCutoff: lead.informationCutoff,
      priceObservedAt: freshestPriceObservedAt(playerRows),
      hasPendingSuggestion: adjustment?.kind === "pending",
      priceDegraded: false,
      now,
    },
    priceFreshnessSeconds,
  );

  const card: PlayerCardDto = {
    playerId,
    playerName: lead.playerName,
    teamAbbreviation: teamAbbr,
    opponentAbbreviation: opponent,
    statTypes: [...new Set(playerRows.map((row) => row.statType))].sort(),
    props,
    bestOpportunity,
    projectionState: lead.projectionState,
    freshness,
    adjustment: {
      kind: adjustment?.kind ?? null,
      note: adjustment?.note ?? null,
      suggestionId: adjustment?.suggestionId ?? null,
    },
  };

  // Admin-only decision fields: copied ONLY when the underlying row carried
  // them (i.e. role === "admin" in readSlate). Structurally absent otherwise.
  if (role === "admin") {
    const decided = playerRows.find(
      (row) => row.currentDisposition !== undefined,
    );
    if (decided?.currentDisposition !== undefined) {
      card.currentDisposition = decided.currentDisposition;
      card.decidedAt = decided.decidedAt;
    }
  }

  return card;
}

/**
 * The two directional props for a slate row: the listed "above" prop the row
 * represents, and its complementary "below" prop. RD-1: for the same
 * threshold, `P(< N) = 1 − P(≥ N)` exactly, so no "exactly N" mass vanishes.
 *
 * Edge is directional and belongs to the listed side only. `readSlate`'s
 * `computeEdge` already chose the better executable side for the above-listed
 * row; the complementary below prop is a probability view, so it carries no
 * edge (a below prop can still be the best opportunity when the row's chosen
 * side favours "no").
 */
function propsForRow(row: SlateRowDto): PropDto[] {
  const above: PropDto = {
    contractId: row.contractId,
    threshold: row.threshold,
    direction: "above",
    modelProbability: row.modelProbability,
    confidence: row.confidence,
    bidCents: row.yesBidCents,
    askCents: row.yesAskCents,
    edgePoints: row.side === "yes" ? row.edgePoints : null,
    confidenceAdjustedEdge:
      row.side === "yes" ? row.confidenceAdjustedEdge : null,
    isRecommended: row.side === "yes" ? row.isRecommended : false,
  };
  const below: PropDto = {
    contractId: row.contractId,
    threshold: row.threshold,
    direction: "below",
    modelProbability:
      row.modelProbability === null ? null : 1 - row.modelProbability,
    confidence: row.confidence,
    bidCents: row.noBidCents,
    askCents: row.noAskCents,
    edgePoints: row.side === "no" ? row.edgePoints : null,
    confidenceAdjustedEdge:
      row.side === "no" ? row.confidenceAdjustedEdge : null,
    isRecommended: row.side === "no" ? row.isRecommended : false,
  };
  return [above, below];
}

function freshestPriceObservedAt(rows: SlateRowDto[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.priceObservedAt === null) continue;
    if (latest === null || row.priceObservedAt > latest) {
      latest = row.priceObservedAt;
    }
  }
  return latest;
}

/**
 * Game-level freshness: the most cautionary of its players' states. Order of
 * severity: unavailable < current < updated_recently < new_info_pending <
 * stale is NOT a total order for display, so we surface the worst caution a
 * user would want to see at the game header — stale, then new_info_pending —
 * else the calmest state present.
 */
function aggregateGameFreshness(
  players: PlayerCardDto[],
): GameGroupDto["freshness"] {
  const raw = {
    projectionComputedAt: null,
    informationCutoff: null,
    priceObservedAt: null,
  };
  if (players.length === 0) return { state: "unavailable", ...raw };

  const states = players.map((player) => player.freshness.state);
  if (states.includes("stale")) return { state: "stale", ...raw };
  if (states.includes("new_info_pending"))
    return { state: "new_info_pending", ...raw };
  if (states.includes("updated_recently"))
    return { state: "updated_recently", ...raw };
  if (states.includes("current")) return { state: "current", ...raw };
  return { state: "unavailable", ...raw };
}

function splitGameLabel(label: string | null): {
  homeTeam: string;
  awayTeam: string;
} {
  // "AWAY @ HOME". Null only for unresolved games, which are not grouped.
  if (!label) return { homeTeam: "", awayTeam: "" };
  const parts = label.split(" @ ");
  if (parts.length !== 2) return { homeTeam: "", awayTeam: "" };
  return { awayTeam: parts[0], homeTeam: parts[1] };
}

async function teamAbbrByPlayerGame(
  rows: SlateRowDto[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pairs = [
    ...new Map(
      rows.map((row) => [`${row.playerId}:${row.gameId}`, row]),
    ).values(),
  ];
  if (pairs.length === 0) return out;

  const contexts = await prisma.playerGameContext.findMany({
    where: {
      OR: pairs.map((row) => ({ playerId: row.playerId, gameId: row.gameId })),
    },
    select: { playerId: true, gameId: true, teamAbbrAtGame: true },
    distinct: ["playerId", "gameId"],
  });
  for (const context of contexts) {
    out.set(`${context.playerId}:${context.gameId}`, context.teamAbbrAtGame);
  }
  return out;
}

async function adjustmentContextByPlayerGame(
  rows: SlateRowDto[],
): Promise<Map<string, AdjustmentContext>> {
  const out = new Map<string, AdjustmentContext>();
  const pairs = [
    ...new Map(
      rows.map((row) => [`${row.playerId}:${row.gameId}`, row]),
    ).values(),
  ];
  if (pairs.length === 0) return out;

  // Accepted or pending suggestions for these players in these games. Accepted
  // context is displayed for both roles; pending gates freshness. Newest first
  // so the head per key wins; accepted takes precedence over pending for the
  // displayed note.
  const suggestions = await prisma.adjustmentSuggestion.findMany({
    where: {
      status: { in: ["accepted", "pending"] },
      OR: pairs.map((row) => ({
        targetPlayerId: row.playerId,
        gameId: row.gameId,
      })),
    },
    orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
    select: {
      targetPlayerId: true,
      gameId: true,
      status: true,
      reasonText: true,
      id: true,
    },
  });
  for (const suggestion of suggestions) {
    const key = `${suggestion.targetPlayerId}:${suggestion.gameId}`;
    const existing = out.get(key);
    const kind = suggestion.status === "accepted" ? "accepted" : "pending";
    // Accepted wins the displayed note over a pending one on the same key.
    if (existing?.kind === "accepted") continue;
    if (existing && kind === "pending") continue;
    out.set(key, {
      kind,
      note: suggestion.reasonText,
      suggestionId: suggestion.id,
    });
  }
  return out;
}

/**
 * Pure evaluation of the complementary threshold pair for a stored
 * distribution (RD-1). Exposed for the threshold-semantics test:
 * `P(≥ N) + P(< N) === 1` exactly, with no vanishing "exactly N" mass.
 */
export function evaluateThreshold(
  distribution: Parameters<typeof probAtLeast>[0],
  threshold: number,
): { probabilityAbove: number; probabilityBelow: number } | null {
  const above = probAtLeast(distribution, threshold);
  if (above === null) return null;
  return { probabilityAbove: above, probabilityBelow: 1 - above };
}

export type { StatType };
