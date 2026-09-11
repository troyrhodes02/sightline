import "server-only";

import { prisma } from "@/lib/prisma";
import type { StatType } from "../../../generated/prisma/enums";
import type {
  PropResearchResponse,
  ResearchPlayerDto,
} from "@/lib/dto/research";
import { modelSelectionMap } from "@/lib/slate/read";
import { deriveFreshness } from "@/lib/slate/freshness";
import {
  latestFactKnownAtByGame,
  stalenessForRow,
} from "@/lib/slate/staleness-read";
import { serverEnv } from "@/env";

/**
 * Prop Research reads (Pitch 10 — spec §9, RD-4, RD-8).
 *
 * Two surfaces, both pure database reads through Prisma:
 *
 *  - `readResearchPlayers(q)` — players with ≥1 current stored BASE projection
 *    for an upcoming (pre-kickoff) game, matching a partial name; with each
 *    player's upcoming games and the stat types that have a stored base
 *    distribution.
 *  - `readResearchProjection(...)` — the BASE distribution + metadata for one
 *    (player, game, stat), delivered so the client recomputes P(≥)/P(<)
 *    locally. Honest unavailable states when there is no base projection (or a
 *    decline) or the game has kicked off.
 *
 * The BASE-only rule is load-bearing: `freshestProjections` (the Slate read)
 * overlays an accepted adjustment shadow, which Prop Research must NOT do — an
 * accepted adjustment changes what the Slate displays, never what a probability
 * check researches. So this module selects `provenance: "base"` directly and
 * never touches the shadow resolver.
 *
 * No price feeds any probability here. The only price read is
 * `listedContractsByThreshold`, which resolves the exact-threshold "View
 * contract" LINK — it returns contract ids, never a cent value or an edge.
 */

function gameLabel(game: {
  homeTeam: { nflverseAbbr: string };
  awayTeam: { nflverseAbbr: string };
}): string {
  return `${game.awayTeam.nflverseAbbr} @ ${game.homeTeam.nflverseAbbr}`;
}

/**
 * Minimum characters before the player search runs. Below this the query would
 * match a large share of the corpus, so an empty/one-letter search returns
 * nothing rather than pulling every upcoming projection into memory — which is
 * what made the Prop Research page slow to load (it preloaded the full set).
 */
const RESEARCH_MIN_QUERY = 2;

/** Safety cap on the name-matched projection rows a single search scans. */
const RESEARCH_MAX_PROJECTIONS = 500;

/**
 * Players with a current stored BASE projection for an upcoming game, matching
 * a partial name (case-insensitive). Only the active-model base projections
 * count; an inactive-model or shadow projection never makes a player eligible.
 *
 * The search is name-driven and requires at least {@link RESEARCH_MIN_QUERY}
 * characters; a shorter query returns `[]` without touching the projection
 * table, so neither the page's first paint nor a stray empty request runs an
 * unbounded query.
 */
export async function readResearchPlayers(
  q: string,
): Promise<ResearchPlayerDto[]> {
  const now = new Date();
  const query = q.trim();
  if (query.length < RESEARCH_MIN_QUERY) return [];

  const games = await prisma.game.findMany({
    where: { status: "scheduled", kickoffAt: { gt: now } },
    select: {
      id: true,
      kickoffAt: true,
      homeTeam: { select: { nflverseAbbr: true } },
      awayTeam: { select: { nflverseAbbr: true } },
    },
  });
  if (games.length === 0) return [];
  const gameById = new Map(games.map((game) => [game.id, game]));

  const activeByStat = await modelSelectionMap();

  // Base projections for upcoming games matching the searched name. The name
  // filter is applied in the DB so a large corpus never streams into memory,
  // and a hard cap bounds even a very common surname.
  const projections = await prisma.projection.findMany({
    where: {
      provenance: "base",
      gameId: { in: [...gameById.keys()] },
      player: { fullName: { contains: query, mode: "insensitive" } },
    },
    select: {
      playerId: true,
      gameId: true,
      statType: true,
      modelVersion: true,
      computedAt: true,
      player: { select: { fullName: true } },
    },
    orderBy: { computedAt: "desc" },
    take: RESEARCH_MAX_PROJECTIONS,
  });

  // Reduce to: player → game → set of stat types that have an active-model base
  // projection. "Current" is the freshest per (player, game, stat); presence is
  // all we need for eligibility, so the newest-first order lets the first win.
  type PlayerAcc = {
    playerId: string;
    fullName: string;
    games: Map<string, Set<StatType>>;
  };
  const byPlayer = new Map<string, PlayerAcc>();
  for (const projection of projections) {
    if (activeByStat.get(projection.statType) !== projection.modelVersion) {
      continue;
    }
    let player = byPlayer.get(projection.playerId);
    if (!player) {
      player = {
        playerId: projection.playerId,
        fullName: projection.player.fullName,
        games: new Map(),
      };
      byPlayer.set(projection.playerId, player);
    }
    let stats = player.games.get(projection.gameId);
    if (!stats) {
      stats = new Set();
      player.games.set(projection.gameId, stats);
    }
    stats.add(projection.statType);
  }

  const players: ResearchPlayerDto[] = [];
  for (const player of byPlayer.values()) {
    const playerGames = [...player.games.entries()]
      .map(([gameId, stats]) => {
        const game = gameById.get(gameId)!;
        return {
          gameId,
          label: gameLabel(game),
          kickoffAt: game.kickoffAt.toISOString(),
          statTypes: [...stats].sort(),
        };
      })
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
    players.push({
      playerId: player.playerId,
      fullName: player.fullName,
      games: playerGames,
    });
  }
  players.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return players;
}

/**
 * The BASE distribution + metadata for one (player, game, stat). Honest states:
 *
 *  - `game_started` when the game has reached kickoff (RD-4): pre-game only.
 *  - `no_projection` when there is no active-model base projection (RD-4):
 *    never a season-average fallback. A `ProjectionDecline` is the same
 *    unavailable answer to the user — there is nothing to research.
 */
export async function readResearchProjection(input: {
  playerId: string;
  gameId: string;
  statType: StatType;
}): Promise<PropResearchResponse> {
  const now = new Date();

  const game = await prisma.game.findUnique({
    where: { id: input.gameId },
    select: {
      id: true,
      kickoffAt: true,
      season: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { nflverseAbbr: true } },
      awayTeam: { select: { nflverseAbbr: true } },
    },
  });

  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { fullName: true },
  });

  const label = game ? gameLabel(game) : null;
  const playerName = player?.fullName ?? null;

  // A game that has kicked off (or is unknown) is pre-game-only territory: no
  // probability is shown. An unknown game reads as started rather than leaking
  // that it does not exist.
  if (!game || game.kickoffAt <= now) {
    return {
      available: false,
      reason: "game_started",
      playerName,
      statType: input.statType,
      gameLabel: label,
    };
  }

  const activeByStat = await modelSelectionMap();
  const activeVersion = activeByStat.get(input.statType);

  // Freshest ACTIVE-MODEL BASE projection for this key. No shadow overlay:
  // Prop Research reads the base only (RD-AS).
  const projection = activeVersion
    ? await prisma.projection.findFirst({
        where: {
          provenance: "base",
          playerId: input.playerId,
          gameId: input.gameId,
          statType: input.statType,
          modelVersion: activeVersion,
        },
        orderBy: { computedAt: "desc" },
        select: {
          id: true,
          distributionKind: true,
          params: true,
          pmf: true,
          quantiles: true,
          projectedValue: true,
          projectedMedian: true,
          intervalLow: true,
          intervalHigh: true,
          confidence: true,
          modelVersion: true,
          computedAt: true,
          informationCutoff: true,
        },
      })
    : null;

  if (!projection) {
    // No active-model base projection — the honest "no current projection"
    // state. A decline row is the same answer; either way there is nothing to
    // research, and NEVER a season-average or any approximation.
    return {
      available: false,
      reason: "no_projection",
      playerName,
      statType: input.statType,
      gameLabel: label,
    };
  }

  const drivers = (
    await prisma.projectionDriver.findMany({
      where: { projectionId: projection.id },
      orderBy: { rank: "asc" },
      select: { text: true },
    })
  ).map((driver) => driver.text);

  // Staleness, computed the same way the Slate does (RD-28) — the two surfaces
  // can never disagree because neither derives staleness locally.
  const latestFactKnownAt =
    (
      await latestFactKnownAtByGame(
        [
          {
            id: game.id,
            season: game.season,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
          },
        ],
        now,
      )
    ).get(game.id) ?? null;
  const staleness = stalenessForRow({
    kickoffAt: game.kickoffAt,
    informationCutoff: projection.informationCutoff,
    latestFactKnownAt,
    now,
  });

  // Probability-only: no price feeds freshness here. The freshness label is the
  // projection clock alone (price clock is absent, so it never upgrades it).
  const freshness = deriveFreshness(
    {
      staleness,
      projectionComputedAt: projection.computedAt.toISOString(),
      informationCutoff: projection.informationCutoff.toISOString(),
      priceObservedAt: null,
      hasPendingSuggestion: false,
      priceDegraded: false,
      now,
    },
    serverEnv().PRICE_ONVIEW_FRESHNESS_SECONDS,
  );

  const listedContracts = await listedContractsByThreshold(input);

  return {
    available: true,
    playerId: input.playerId,
    playerName: player?.fullName ?? "",
    gameId: game.id,
    gameLabel: label ?? "",
    kickoffAt: game.kickoffAt.toISOString(),
    statType: input.statType,
    distributionKind: projection.distributionKind,
    params: projection.params as Record<string, number>,
    pmf: (projection.pmf as number[] | null) ?? null,
    quantiles: (projection.quantiles as Record<string, number> | null) ?? null,
    projectedValue: Number(projection.projectedValue),
    projectedMedian: Number(projection.projectedMedian),
    intervalLow: Number(projection.intervalLow),
    intervalHigh: Number(projection.intervalHigh),
    confidence: projection.confidence,
    drivers,
    computedAt: projection.computedAt.toISOString(),
    informationCutoff: projection.informationCutoff.toISOString(),
    modelVersion: projection.modelVersion,
    freshness,
    listedContracts,
  };
}

/**
 * Currently-listed contracts for this (player, game, stat) that have a fresh
 * price, keyed by their threshold — so the client can show a "View contract"
 * link when the entered threshold EXACTLY matches one. Returns contract ids and
 * thresholds ONLY: no cents, no edge (RD-8). A contract with no fresh price is
 * omitted, so a link is offered only where the detail page would show a real
 * comparison.
 */
async function listedContractsByThreshold(input: {
  playerId: string;
  gameId: string;
  statType: StatType;
}): Promise<Array<{ threshold: number; contractId: string }>> {
  const freshnessSeconds = serverEnv().PRICE_ONVIEW_FRESHNESS_SECONDS;
  const freshCutoff = new Date(Date.now() - freshnessSeconds * 1000);

  const contracts = await prisma.contract.findMany({
    where: {
      status: "active",
      resolutionStatus: { in: ["resolved", "manual_override"] },
      playerId: input.playerId,
      gameId: input.gameId,
      statType: input.statType,
      threshold: { not: null },
    },
    select: {
      id: true,
      threshold: true,
      priceObservations: {
        orderBy: { observedAt: "desc" },
        take: 1,
        select: { observedAt: true },
      },
    },
  });

  const out: Array<{ threshold: number; contractId: string }> = [];
  for (const contract of contracts) {
    if (contract.threshold === null) continue;
    const observed = contract.priceObservations[0]?.observedAt ?? null;
    // Only a FRESH price qualifies; a stale-priced contract offers no link, so
    // the user is never sent to a detail page with nothing current to compare.
    if (observed === null || observed < freshCutoff) continue;
    out.push({
      threshold: Number(contract.threshold),
      contractId: contract.id,
    });
  }
  return out;
}
