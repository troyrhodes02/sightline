"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Pagination from "@mui/material/Pagination";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { BestOpportunities } from "@/components/slate/BestOpportunities";
import {
  applyScope,
  parseScope,
  scopeToParams,
  type SlateScope,
} from "@/components/slate/filters";
import { GameGroup } from "@/components/slate/GameGroup";
import { SlateControls } from "@/components/slate/SlateControls";
import {
  RefreshPricesButton,
  SlatePoller,
} from "@/components/slate/SlatePoller";
import { UnresolvedRow } from "@/components/slate/SlateRow";
import { formatEt } from "@/components/slate/values";
import type { SlateGroupedDto } from "@/lib/dto/slate";

/**
 * The Slate — the product's front door, redesigned around game groups and
 * one card per player (Pitch 10, Screen 1). It renders entirely from the
 * grouped DTO the server read produced: no model run, never blocked on the
 * refresh round-trip.
 *
 * The best-opportunities block and the game-grouped block are the SAME rows
 * re-emphasised — the view toggle reorders in place, it does not fetch. Kalshi
 * being unreachable is a DESIGNED degraded mode with one banner (last-known
 * price age), never an error page.
 *
 * Search and filters (SIG-97) are client-side SELECTION over the already-loaded
 * grouped DTO: they hide and re-order the SAME computed rows and never change a
 * probability or edge. The scope lives in the URL (`?view=&game=&team=&…`) via a
 * shallow `router.replace`, so a filtered slate is shareable and returnable.
 *
 * Three empty states: (a) an over-narrow filter/search resolves to
 * "No players match — clear filters"; (b) a valid slate with nothing
 * recommended shows the quiet best-block message with games still browsable
 * below (BestOpportunities); (c) no upcoming games at all is the designed empty
 * slate. This ticket owns (a) and the controls; (b)/(c) came from SIG-96.
 */
export function Slate({
  slate,
  refreshIntervalSeconds,
  refreshFreshnessSeconds = 300,
  isAdmin = false,
}: {
  slate: SlateGroupedDto;
  refreshIntervalSeconds: number;
  /** On-view refresh threshold (Pitch 10). */
  refreshFreshnessSeconds?: number;
  /** Manual refresh is an admin diagnostic; viewers never see the control. */
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const scope = useMemo(
    () => parseScope(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const onScopeChange = useCallback(
    (next: SlateScope) => {
      const query = scopeToParams(next).toString();
      // Shallow URL update — no server round-trip, no refetch. The scope is the
      // only thing that changes; the delivered slate is untouched.
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  // Selection over the ALREADY-DELIVERED slate. `filtered` is a subset of the
  // same rows; no probability, price, or edge is recomputed.
  const filtered = useMemo(() => applyScope(slate, scope), [slate, scope]);

  // Pagination (25 per page) keeps the DOM small: a full Sunday slate is
  // hundreds of player cards, and rendering them all is what makes the view
  // toggle and scroll slow. Two independent page cursors — the cross-game
  // "best" list and the by-game card list — both reset to page 1 whenever the
  // selection or view changes.
  const PAGE_SIZE = 25;
  const [bestPage, setBestPage] = useState(1);
  const [gamesPage, setGamesPage] = useState(1);
  const scopeKey = scopeToParams(scope).toString();
  useEffect(() => {
    setBestPage(1);
    setGamesPage(1);
  }, [scopeKey]);

  const bestRows = filtered.bestOpportunities;
  const bestPageCount = Math.max(1, Math.ceil(bestRows.length / PAGE_SIZE));
  const bestCurrent = Math.min(bestPage, bestPageCount);
  const bestWindow = useMemo(
    () =>
      bestRows.slice((bestCurrent - 1) * PAGE_SIZE, bestCurrent * PAGE_SIZE),
    [bestRows, bestCurrent],
  );

  // Paginate player cards ACROSS games, then re-group the windowed cards under
  // their game headers so a game that straddles a page boundary still shows its
  // header on each page.
  const gamesPaged = useMemo(() => {
    const flat: Array<{
      game: (typeof filtered.games)[number];
      card: (typeof filtered.games)[number]["players"][number];
    }> = [];
    for (const game of filtered.games) {
      for (const card of game.players) flat.push({ game, card });
    }
    const pageCount = Math.max(1, Math.ceil(flat.length / PAGE_SIZE));
    const current = Math.min(gamesPage, pageCount);
    const windowed = flat.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
    const games: typeof filtered.games = [];
    for (const { game, card } of windowed) {
      const last = games[games.length - 1];
      if (!last || last.gameId !== game.gameId) {
        games.push({ ...game, players: [card] });
      } else {
        last.players.push(card);
      }
    }
    return { games, pageCount, current };
  }, [filtered.games, gamesPage]);

  const view = scope.view;
  const hasGames = slate.games.length > 0;
  const hasUnresolved = slate.unresolved.length > 0;
  // The selection emptied every game/opportunity, but the slate itself is not
  // empty — this is the "No players match" state, distinct from "No games".
  const selectionIsEmpty =
    hasGames &&
    filtered.games.length === 0 &&
    filtered.bestOpportunities.length === 0;

  return (
    <Stack spacing={3}>
      <SlatePoller
        intervalSeconds={refreshIntervalSeconds}
        pricesUpdatedAt={slate.pricesUpdatedAt}
        freshnessSeconds={refreshFreshnessSeconds}
      />

      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "flex-end", justifyContent: "space-between" }}
      >
        <Typography variant="h1">Slate</Typography>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexShrink: 0 }}
        >
          {slate.pricesUpdatedAt ? (
            <NumericText
              size="sm"
              sx={{
                color: "market.main",
                display: { xs: "none", sm: "block" },
              }}
              suppressHydrationWarning
            >
              prices updated {formatEt(slate.pricesUpdatedAt)}
            </NumericText>
          ) : null}
          {isAdmin ? <RefreshPricesButton /> : null}
        </Stack>
      </Stack>

      {/* Controls: search + view toggle + combinable filters. All client-side
          selection over the delivered slate; scope is written to the URL. The
          filter options come from the ORIGINAL slate so every real choice stays
          offered even when the current selection empties the surface. */}
      {hasGames ? (
        <SlateControls
          scope={scope}
          slate={slate}
          onScopeChange={onScopeChange}
        />
      ) : null}

      {slate.priceDegraded ? (
        <Alert severity="warning">
          Prices unavailable — showing last-known values
          {slate.pricesUpdatedAt
            ? `, last refreshed ${formatEt(slate.pricesUpdatedAt)}`
            : ""}
          . Projections and cards render fully.
        </Alert>
      ) : slate.pricePartial ? (
        <Alert severity="warning">
          Some markets could not be refreshed; showing last-observed prices
          where current ones are unavailable.
        </Alert>
      ) : null}

      {!hasGames && !hasUnresolved ? (
        <Paper>
          <EmptyState
            title="No upcoming games."
            detail="No games are in Sightline's schedule yet — schedule ingest has not run."
          />
        </Paper>
      ) : (
        <>
          {/* (a) An over-narrow filter/search: the slate has games but the
              selection matched none. A clear answer, never an alert. */}
          {selectionIsEmpty ? (
            <Paper>
              <EmptyState
                title="No players match"
                detail={
                  scope.q
                    ? `No players match “${scope.q}” with these filters.`
                    : "No players match these filters."
                }
              />
            </Paper>
          ) : (
            <>
              {/* Best-opportunities block (best view): the cross-game strongest
                  slice, paginated 25 per page. */}
              {view === "best" ? (
                <Stack spacing={1.5}>
                  <Typography variant="h2">Best opportunities</Typography>
                  <BestOpportunities rows={bestWindow} />
                  {bestPageCount > 1 ? (
                    <Stack sx={{ alignItems: "center", pt: 0.5 }}>
                      <Pagination
                        count={bestPageCount}
                        page={bestCurrent}
                        onChange={(_, p) => setBestPage(p)}
                        siblingCount={0}
                        size="small"
                      />
                    </Stack>
                  ) : null}
                </Stack>
              ) : null}

              {filtered.games.length > 0 ? (
                <Stack spacing={1.5}>
                  <Typography variant="h2">All games</Typography>
                  <Box>
                    {gamesPaged.games.map((game) => (
                      <GameGroup
                        key={game.gameId}
                        game={game}
                        isAdmin={isAdmin}
                        defaultExpanded={view === "game"}
                      />
                    ))}
                  </Box>
                  {gamesPaged.pageCount > 1 ? (
                    <Stack sx={{ alignItems: "center", pt: 0.5 }}>
                      <Pagination
                        count={gamesPaged.pageCount}
                        page={gamesPaged.current}
                        onChange={(_, p) => setGamesPage(p)}
                        siblingCount={0}
                        size="small"
                      />
                    </Stack>
                  ) : null}
                </Stack>
              ) : null}
            </>
          )}

          {hasUnresolved ? (
            <Stack spacing={1}>
              <Typography variant="h2">
                Unresolved contracts ({slate.unresolved.length})
              </Typography>
              {!hasGames ? (
                <Alert severity="warning">
                  No listed contract could be matched to a player yet.
                </Alert>
              ) : null}
              <Paper sx={{ overflow: "hidden" }}>
                {slate.unresolved.map((row) => (
                  <UnresolvedRow key={row.contractId} row={row} />
                ))}
              </Paper>
            </Stack>
          ) : null}
        </>
      )}
    </Stack>
  );
}
