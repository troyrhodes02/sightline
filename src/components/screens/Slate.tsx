"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
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
 * probability or edge. Scope is client state (seeded from the URL once); the URL
 * is kept in sync with `history.replaceState` so a filtered slate is shareable
 * and returnable WITHOUT a navigation that would refetch the whole slate.
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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Scope is CLIENT STATE, seeded once from the URL. Filters, search, and the
  // view toggle are then instant re-renders — never a navigation. On this
  // force-dynamic page a router navigation re-runs the server read (a full slate
  // DB query) on every change, which made the search field unusable (a fetch per
  // keystroke) and the view flip slow. The URL is kept shareable with
  // history.replaceState, which updates the address bar WITHOUT a refetch.
  const [scope, setScope] = useState<SlateScope>(() =>
    parseScope(new URLSearchParams(searchParams.toString())),
  );

  const onScopeChange = useCallback(
    (next: SlateScope) => {
      setScope(next);
      const query = scopeToParams(next).toString();
      window.history.replaceState(
        null,
        "",
        query ? `${pathname}?${query}` : pathname,
      );
    },
    [pathname],
  );

  // Selection over the ALREADY-DELIVERED slate. `filtered` is a subset of the
  // same rows; no probability, price, or edge is recomputed.
  const filtered = useMemo(() => applyScope(slate, scope), [slate, scope]);

  // Pagination (10 per page) keeps the DOM small. Best opportunities paginate by
  // row; the game list paginates by GAME (10 games/page), and games start
  // collapsed. Both cursors reset to page 1 whenever the selection/view changes.
  const PAGE_SIZE = 10;
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

  const gamesPageCount = Math.max(
    1,
    Math.ceil(filtered.games.length / PAGE_SIZE),
  );
  const gamesCurrent = Math.min(gamesPage, gamesPageCount);
  const gamesWindow = useMemo(
    () =>
      filtered.games.slice(
        (gamesCurrent - 1) * PAGE_SIZE,
        gamesCurrent * PAGE_SIZE,
      ),
    [filtered.games, gamesCurrent],
  );

  const [unresolvedOpen, setUnresolvedOpen] = useState(false);

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
                  slice, paginated 10 per page. */}
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
                    {gamesWindow.map((game) => (
                      <GameGroup
                        key={game.gameId}
                        game={game}
                        isAdmin={isAdmin}
                        defaultExpanded={false}
                      />
                    ))}
                  </Box>
                  {gamesPageCount > 1 ? (
                    <Stack sx={{ alignItems: "center", pt: 0.5 }}>
                      <Pagination
                        count={gamesPageCount}
                        page={gamesCurrent}
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
              {/* Kalshi contracts Sightline could not automatically match to a
                  player (an unusual name, a suffix, a mid-week relisting). Kept
                  so a mapping can be corrected rather than silently dropped, but
                  collapsed by default — it is diagnostic, not part of browsing. */}
              <Box
                component="button"
                type="button"
                aria-expanded={unresolvedOpen}
                onClick={() => setUnresolvedOpen((prior) => !prior)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  width: "100%",
                  textAlign: "left",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  bgcolor: "background.paper",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  px: 2,
                  py: 1.25,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Typography variant="h2" component="span">
                  Unresolved contracts ({slate.unresolved.length})
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {unresolvedOpen ? "Hide" : "Show"}
                </Typography>
              </Box>
              <Collapse in={unresolvedOpen} unmountOnExit>
                <Stack spacing={1}>
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", px: 0.5 }}
                  >
                    Kalshi contracts Sightline couldn&apos;t match to a player
                    yet. They are held here for mapping, not scored — you can
                    ignore them for normal browsing.
                  </Typography>
                  <Paper sx={{ overflow: "hidden" }}>
                    {slate.unresolved.map((row) => (
                      <UnresolvedRow key={row.contractId} row={row} />
                    ))}
                  </Paper>
                </Stack>
              </Collapse>
            </Stack>
          ) : null}
        </>
      )}
    </Stack>
  );
}
