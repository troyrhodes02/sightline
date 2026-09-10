import type {
  GameGroupDto,
  PlayerCardDto,
  PropDto,
  SlateGroupedDto,
} from "@/lib/dto/slate";
import type { Confidence, StatType } from "../../../generated/prisma/enums";

/**
 * Client-side selection over the ALREADY-DELIVERED grouped slate (SIG-97).
 *
 * These functions hide and re-order the SAME computed rows the server produced;
 * they NEVER change a probability, a price, or an edge. There is no refetch and
 * no model run — filtering is pure array selection over `SlateGroupedDto`. The
 * scope travels in the URL so a filtered slate is shareable and returnable.
 *
 * "Warn, not block" (spec §11): every filter is lenient. An unknown value in a
 * URL param resolves to the default rather than erroring, and an over-narrow
 * combination yields the empty state rather than an alert.
 */

export type ViewMode = "best" | "game";
export type RecFilter = "all" | "recommended" | "above" | "below";
export type MarketFilter = "all" | "has_market" | "no_market";

export type SlateScope = {
  view: ViewMode;
  /** Free-text partial player-name search; empty means unfiltered. */
  q: string;
  /** Selected game ids; empty means all. */
  games: string[];
  /** Selected team abbreviations (home or away); empty means all. */
  teams: string[];
  /** Selected kickoff-window labels; empty means all. */
  windows: string[];
  /** Selected stat types; empty means all. */
  stats: StatType[];
  /** Recommendation / favored-direction filter. */
  rec: RecFilter;
  /** Selected confidence levels; empty means all. */
  confidence: Confidence[];
  /** Market-availability filter. */
  market: MarketFilter;
};

export const DEFAULT_SCOPE: SlateScope = {
  view: "best",
  q: "",
  games: [],
  teams: [],
  windows: [],
  stats: [],
  rec: "all",
  confidence: [],
  market: "all",
};

const VIEW_VALUES: ViewMode[] = ["best", "game"];
const REC_VALUES: RecFilter[] = ["all", "recommended", "above", "below"];
const MARKET_VALUES: MarketFilter[] = ["all", "has_market", "no_market"];
const CONFIDENCE_VALUES: Confidence[] = ["high", "medium", "low"];
const STAT_VALUES: StatType[] = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "rushing_tds",
  "receiving_tds",
];

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** One-of parse: an unrecognised value falls back to the default (spec §11). */
function oneOf<T extends string>(
  value: string | null,
  allowed: T[],
  fallback: T,
): T {
  return allowed.includes((value ?? "") as T) ? (value as T) : fallback;
}

/** Many-of parse: keeps only recognised members; unknowns are dropped, never error. */
function manyOf<T extends string>(value: string | null, allowed: T[]): T[] {
  const allow = new Set<string>(allowed);
  return csv(value).filter((entry): entry is T => allow.has(entry));
}

/**
 * Parse the scope from URL params. Lenient by construction: unknown values
 * resolve to defaults so a hand-edited or stale link never errors (spec §11).
 */
export function parseScope(params: URLSearchParams): SlateScope {
  return {
    view: oneOf(params.get("view"), VIEW_VALUES, "best"),
    q: (params.get("q") ?? "").trim(),
    games: csv(params.get("game")),
    teams: csv(params.get("team")).map((team) => team.toUpperCase()),
    windows: csv(params.get("window")),
    stats: manyOf(params.get("stat"), STAT_VALUES),
    rec: oneOf(params.get("rec"), REC_VALUES, "all"),
    confidence: manyOf(params.get("conf"), CONFIDENCE_VALUES),
    market: oneOf(params.get("market"), MARKET_VALUES, "all"),
  };
}

/**
 * Serialise the scope back into URL params, omitting anything at its default so
 * the URL stays short and a reset yields a clean address. `view` is always
 * written so the shared toggle round-trips predictably.
 */
export function scopeToParams(scope: SlateScope): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.view !== "best") params.set("view", scope.view);
  if (scope.q) params.set("q", scope.q);
  if (scope.games.length) params.set("game", scope.games.join(","));
  if (scope.teams.length) params.set("team", scope.teams.join(","));
  if (scope.windows.length) params.set("window", scope.windows.join(","));
  if (scope.stats.length) params.set("stat", scope.stats.join(","));
  if (scope.rec !== "all") params.set("rec", scope.rec);
  if (scope.confidence.length) params.set("conf", scope.confidence.join(","));
  if (scope.market !== "all") params.set("market", scope.market);
  return params;
}

/** True when nothing beyond the view toggle is active — the default best view. */
export function isDefaultSelection(scope: SlateScope): boolean {
  return (
    scope.q === "" &&
    scope.games.length === 0 &&
    scope.teams.length === 0 &&
    scope.windows.length === 0 &&
    scope.stats.length === 0 &&
    scope.rec === "all" &&
    scope.confidence.length === 0 &&
    scope.market === "all"
  );
}

/** The count of active filter facets (search excluded — it has its own field). */
export function activeFilterCount(scope: SlateScope): number {
  let count = 0;
  if (scope.games.length) count += 1;
  if (scope.teams.length) count += 1;
  if (scope.windows.length) count += 1;
  if (scope.stats.length) count += 1;
  if (scope.rec !== "all") count += 1;
  if (scope.confidence.length) count += 1;
  if (scope.market !== "all") count += 1;
  return count;
}

// --- diacritic-insensitive partial name matching ---------------------------

/** Lower-case and strip diacritics so "josé" matches "jose" and vice versa. */
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function nameMatches(playerName: string, query: string): boolean {
  const q = normalizeName(query.trim());
  if (q === "") return true;
  return normalizeName(playerName).includes(q);
}

// --- derived filter options (from data, never hardcoded) -------------------

export type WindowOption = { value: string; label: string };

/**
 * The kickoff-window options present in the slate, keyed by a stable
 * date-and-hour bucket so "Sun 1:00p" and "Sun 4:25p" are distinct choices
 * derived from the data rather than a hardcoded list.
 */
export function windowOptionsFromGames(games: GameGroupDto[]): WindowOption[] {
  const seen = new Map<string, string>();
  for (const game of games) {
    const value = windowKey(game.kickoffAt);
    if (!seen.has(value)) seen.set(value, windowLabel(game.kickoffAt));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/** The set of team abbreviations present across the slate's games. */
export function teamsFromGames(games: GameGroupDto[]): string[] {
  const teams = new Set<string>();
  for (const game of games) {
    if (game.homeTeam) teams.add(game.homeTeam);
    if (game.awayTeam) teams.add(game.awayTeam);
  }
  return [...teams].sort();
}

/** A stable per-window bucket: the game's kickoff to the hour, in UTC. */
export function windowKey(kickoffAt: string): string {
  return kickoffAt.slice(0, 13); // YYYY-MM-DDTHH
}

function windowLabel(kickoffAt: string): string {
  const date = new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return kickoffAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// --- selection over the grouped DTO (hides rows; NEVER mutates numbers) ----

function propPassesRec(prop: PropDto, rec: RecFilter): boolean {
  switch (rec) {
    case "recommended":
      return prop.isRecommended;
    case "above":
      return prop.direction === "above";
    case "below":
      return prop.direction === "below";
    default:
      return true;
  }
}

function propPassesMarket(prop: PropDto, market: MarketFilter): boolean {
  switch (market) {
    case "has_market":
      return prop.contractId !== null;
    case "no_market":
      return prop.contractId === null;
    default:
      return true;
  }
}

function propPassesConfidence(
  prop: PropDto,
  confidence: Confidence[],
): boolean {
  if (confidence.length === 0) return true;
  return prop.confidence !== null && confidence.includes(prop.confidence);
}

function propPassesStat(prop: PropDto, stats: StatType[]): boolean {
  if (stats.length === 0) return true;
  return stats.includes(prop.statType);
}

/** A prop survives the prop-level facets (stat, direction/rec, confidence, market). */
function propPasses(prop: PropDto, scope: SlateScope): boolean {
  return (
    propPassesStat(prop, scope.stats) &&
    propPassesRec(prop, scope.rec) &&
    propPassesConfidence(prop, scope.confidence) &&
    propPassesMarket(prop, scope.market)
  );
}

/**
 * Re-derive a player card restricted to its surviving props. Returns null when
 * no prop survives (the player is hidden), otherwise a card carrying the SAME
 * prop objects — probabilities, edges and prices are untouched. `bestOpportunity`
 * is re-selected from the surviving props by the SAME ranking key
 * (`confidenceAdjustedEdge`, RD-5); it is never recomputed.
 */
function selectCard(
  card: PlayerCardDto,
  scope: SlateScope,
): PlayerCardDto | null {
  if (!nameMatches(card.playerName, scope.q)) return null;

  const survivingProps = card.props.filter((prop) => propPasses(prop, scope));
  if (survivingProps.length === 0) return null;

  const survivingStatTypes = card.statTypes.filter((stat) =>
    survivingProps.some((prop) => prop.statType === stat),
  );

  // Re-select the best from the surviving set by the existing ranking key,
  // never recomputing the value itself. The tie-break MUST match the server's
  // buildPlayerCard (higher confidenceAdjustedEdge, then higher edgePoints);
  // otherwise a filter that removes none of a player's props could still flip
  // which prop is shown as best relative to the unfiltered slate.
  const best = survivingProps.reduce<PropDto | null>((acc, prop) => {
    if (prop.confidenceAdjustedEdge === null) return acc;
    if (acc === null || acc.confidenceAdjustedEdge === null) return prop;
    if (prop.confidenceAdjustedEdge > acc.confidenceAdjustedEdge) return prop;
    if (
      prop.confidenceAdjustedEdge === acc.confidenceAdjustedEdge &&
      (prop.edgePoints ?? 0) > (acc.edgePoints ?? 0)
    ) {
      return prop;
    }
    return acc;
  }, null);

  return {
    ...card,
    props: survivingProps,
    statTypes: survivingStatTypes,
    bestOpportunity: best,
  };
}

function gamePasses(game: GameGroupDto, scope: SlateScope): boolean {
  if (scope.games.length && !scope.games.includes(game.gameId)) return false;
  if (
    scope.windows.length &&
    !scope.windows.includes(windowKey(game.kickoffAt))
  )
    return false;
  if (scope.teams.length) {
    const home = game.homeTeam.toUpperCase();
    const away = game.awayTeam.toUpperCase();
    if (!scope.teams.includes(home) && !scope.teams.includes(away))
      return false;
  }
  return true;
}

/**
 * Apply the scope to the grouped slate, producing a NEW `SlateGroupedDto` whose
 * games, players and best-opportunities are a subset of the input, re-emphasised
 * but never re-valued. The available-option lists are preserved from the
 * ORIGINAL slate so the filter menu keeps offering every real choice even when
 * the current selection empties the surface.
 */
export function applyScope(
  slate: SlateGroupedDto,
  scope: SlateScope,
): SlateGroupedDto {
  const games: GameGroupDto[] = [];
  const survivingPlayerIds = new Set<string>();

  for (const game of slate.games) {
    if (!gamePasses(game, scope)) continue;
    const players: PlayerCardDto[] = [];
    for (const card of game.players) {
      const selected = selectCard(card, scope);
      if (selected) {
        players.push(selected);
        survivingPlayerIds.add(`${game.gameId}:${selected.playerId}`);
      }
    }
    if (players.length > 0) games.push({ ...game, players });
  }

  // The best-opportunities slice is the same rows re-emphasised; keep only
  // entries whose player survived and whose prop passes the prop-level facets.
  const bestOpportunities = slate.bestOpportunities.filter(
    (entry) =>
      survivingPlayerIds.has(`${entry.gameId}:${entry.playerId}`) &&
      propPasses(entry.prop, scope),
  );

  return {
    ...slate,
    games,
    bestOpportunities,
  };
}
