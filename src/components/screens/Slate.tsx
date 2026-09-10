"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { BestOpportunities } from "@/components/slate/BestOpportunities";
import { GameGroup } from "@/components/slate/GameGroup";
import {
  RefreshPricesButton,
  SlatePoller,
} from "@/components/slate/SlatePoller";
import { UnresolvedRow } from "@/components/slate/SlateRow";
import { formatEt } from "@/components/slate/values";
import type { SlateGroupedDto } from "@/lib/dto/slate";

type ViewMode = "best" | "game";

/**
 * The Slate — the product's front door, redesigned around game groups and
 * one card per player (Pitch 10, Screen 1). It renders entirely from the
 * grouped DTO the server read produced: no model run, never blocked on the
 * refresh round-trip.
 *
 * The best-opportunities block and the game-grouped block are the SAME rows
 * re-emphasised — the view toggle reorders in place, it does not fetch. Kalshi
 * being unreachable is a DESIGNED degraded mode with one banner (last-known
 * price age), never an error page. The three empty states are each a
 * deliberate answer: no games, nothing recommended, nothing listed.
 *
 * Search and Filters are scaffolded here (a full-width field + a Filters
 * button); the filtering LOGIC lands in SIG-97. This ticket owns grouping,
 * cards, disclosure, suggestions, and freshness.
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
  const [view, setView] = useState<ViewMode>("best");

  const hasGames = slate.games.length > 0;
  const hasUnresolved = slate.unresolved.length > 0;

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

      {/* Controls: search + view toggle + Filters affordance. Filter LOGIC is
          SIG-97; these are scaffolded so the surface reads complete. */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <TextField
          placeholder="Search players"
          aria-label="Search players"
          size="small"
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 20, color: "text.muted" }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <ToggleButtonGroup
          value={view}
          exclusive
          size="small"
          onChange={(_event, next: ViewMode | null) => {
            if (next) setView(next);
          }}
          aria-label="View mode"
        >
          <ToggleButton value="best" aria-label="Best opportunities">
            Best opportunities
          </ToggleButton>
          <ToggleButton value="game" aria-label="By game">
            By game
          </ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="outlined"
          size="small"
          color="inherit"
          startIcon={<FilterListIcon sx={{ fontSize: 20 }} />}
          sx={{ color: "text.secondary", borderColor: "border.strong" }}
        >
          Filters
        </Button>
      </Stack>

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
          {/* Best-opportunities block: expanded in `best`, a compact strip in
              `game`. Same rows, re-emphasised. */}
          {view === "best" ? (
            <Stack spacing={1.5}>
              <Typography variant="h2">Best opportunities</Typography>
              <BestOpportunities rows={slate.bestOpportunities} />
            </Stack>
          ) : null}

          {hasGames ? (
            <Stack spacing={1.5}>
              <Typography variant="h2">All games</Typography>
              <Box>
                {slate.games.map((game) => (
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
