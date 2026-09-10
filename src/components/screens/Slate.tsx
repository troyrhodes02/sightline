"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
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
              {/* Best-opportunities block: expanded in `best`, a compact strip
                  in `game`. Same rows, re-emphasised — over the FILTERED set. */}
              {view === "best" ? (
                <Stack spacing={1.5}>
                  <Typography variant="h2">Best opportunities</Typography>
                  <BestOpportunities rows={filtered.bestOpportunities} />
                </Stack>
              ) : null}

              {filtered.games.length > 0 ? (
                <Stack spacing={1.5}>
                  <Typography variant="h2">All games</Typography>
                  <Box>
                    {filtered.games.map((game) => (
                      <GameGroup
                        key={game.gameId}
                        game={game}
                        isAdmin={isAdmin}
                        defaultExpanded={view === "game"}
                      />
                    ))}
                  </Box>
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
