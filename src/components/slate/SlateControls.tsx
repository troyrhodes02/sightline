"use client";

import { useState } from "react";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControl from "@mui/material/FormControl";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import Popover from "@mui/material/Popover";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import type { SlateGroupedDto } from "@/lib/dto/slate";
import type { Confidence, StatType } from "../../../generated/prisma/enums";
import { STAT_LABELS } from "./prop-display";
import {
  activeFilterCount,
  DEFAULT_SCOPE,
  isDefaultSelection,
  type MarketFilter,
  type RecFilter,
  type SlateScope,
  teamsFromGames,
  type ViewMode,
  windowOptionsFromGames,
} from "./filters";

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const REC_LABELS: Record<RecFilter, string> = {
  all: "All",
  recommended: "Recommended",
  above: "Above",
  below: "Below",
};

const MARKET_LABELS: Record<MarketFilter, string> = {
  all: "All",
  has_market: "Has market",
  no_market: "No market",
};

/**
 * The Slate's search + view toggle + combinable filters (SIG-97, Screen 1).
 *
 * Every control is client-side SELECTION over the already-loaded slate: it
 * writes the shared scope (which the parent turns into a shallow URL update) and
 * NEVER refetches or re-values a row. Filter OPTIONS are derived from the data
 * passed in (`availableStatTypes`, `availableGames`, the teams and windows
 * present) — nothing is hardcoded.
 *
 * Responsive: at `md`+ the filters open in a `Popover`; at `xs`/`sm` they open a
 * full-width `Drawer` (design doc §Responsive — never a shrunken desktop bar).
 */
export function SlateControls({
  scope,
  slate,
  onScopeChange,
}: {
  scope: SlateScope;
  slate: SlateGroupedDto;
  onScopeChange: (next: SlateScope) => void;
}) {
  const theme = useTheme();
  const useDrawer = useMediaQuery(theme.breakpoints.down("md"));
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeCount = activeFilterCount(scope);
  const teams = teamsFromGames(slate.games);
  const windows = windowOptionsFromGames(slate.games);

  function patch(next: Partial<SlateScope>) {
    onScopeChange({ ...scope, ...next });
  }

  function openFilters(event: React.MouseEvent<HTMLElement>) {
    if (useDrawer) setDrawerOpen(true);
    else setFilterAnchor(event.currentTarget);
  }

  function closeFilters() {
    setFilterAnchor(null);
    setDrawerOpen(false);
  }

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "center" } }}
      >
        <TextField
          value={scope.q}
          onChange={(event) => patch({ q: event.target.value })}
          placeholder="Search players"
          size="small"
          sx={{ flex: 1, width: { xs: "100%", sm: "auto" } }}
          slotProps={{
            htmlInput: { "aria-label": "Search players" },
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
          value={scope.view}
          exclusive
          size="small"
          onChange={(_event, next: ViewMode | null) => {
            if (next) patch({ view: next });
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
        <Badge
          color="primary"
          badgeContent={activeCount}
          invisible={activeCount === 0}
        >
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            aria-label="Filters"
            aria-haspopup="dialog"
            startIcon={<FilterListIcon sx={{ fontSize: 20 }} />}
            onClick={openFilters}
            sx={{ color: "text.secondary", borderColor: "border.strong" }}
          >
            Filters
          </Button>
        </Badge>
      </Stack>

      <ActiveFilterChips scope={scope} slate={slate} onScopeChange={patch} />

      {useDrawer ? (
        <Drawer
          anchor="bottom"
          open={drawerOpen}
          onClose={closeFilters}
          slotProps={{ paper: { sx: { maxHeight: "85vh" } } }}
        >
          <Box sx={{ p: 2 }}>
            <FilterBody
              scope={scope}
              availableStatTypes={slate.availableStatTypes}
              availableGames={slate.availableGames}
              teams={teams}
              windows={windows}
              onPatch={patch}
              onClose={closeFilters}
            />
          </Box>
        </Drawer>
      ) : (
        <Popover
          open={filterAnchor !== null}
          anchorEl={filterAnchor}
          onClose={closeFilters}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { p: 2, width: 340, maxWidth: "90vw" } } }}
        >
          <FilterBody
            scope={scope}
            availableStatTypes={slate.availableStatTypes}
            availableGames={slate.availableGames}
            teams={teams}
            windows={windows}
            onPatch={patch}
            onClose={closeFilters}
          />
        </Popover>
      )}
    </Stack>
  );
}

/**
 * The grouped filter controls shared by the desktop popover and the phone
 * drawer. Options are the derived, data-backed lists passed in; a `Reset all`
 * clears every facet (and the search) back to the default best view.
 */
function FilterBody({
  scope,
  availableStatTypes,
  availableGames,
  teams,
  windows,
  onPatch,
  onClose,
}: {
  scope: SlateScope;
  availableStatTypes: StatType[];
  availableGames: SlateGroupedDto["availableGames"];
  teams: string[];
  windows: ReturnType<typeof windowOptionsFromGames>;
  onPatch: (next: Partial<SlateScope>) => void;
  onClose: () => void;
}) {
  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Filters
        </Typography>
        <Button
          variant="text"
          size="small"
          onClick={() => onPatch({ ...DEFAULT_SCOPE, view: scope.view })}
          disabled={isDefaultSelection(scope)}
        >
          Reset all
        </Button>
      </Stack>

      <MultiSelect
        label="Game"
        value={scope.games}
        options={availableGames.map((game) => ({
          value: game.gameId,
          label: game.label,
        }))}
        onChange={(games) => onPatch({ games })}
      />

      <MultiSelect
        label="Team"
        value={scope.teams}
        options={teams.map((team) => ({ value: team, label: team }))}
        onChange={(teamsNext) => onPatch({ teams: teamsNext })}
      />

      <MultiSelect
        label="Window"
        value={scope.windows}
        options={windows}
        onChange={(windowsNext) => onPatch({ windows: windowsNext })}
      />

      <MultiSelect
        label="Stat type"
        value={scope.stats}
        options={availableStatTypes.map((stat) => ({
          value: stat,
          label: STAT_LABELS[stat],
        }))}
        onChange={(stats) => onPatch({ stats: stats as StatType[] })}
      />

      <SingleSelect
        label="Recommendation"
        value={scope.rec}
        options={(Object.keys(REC_LABELS) as RecFilter[]).map((value) => ({
          value,
          label: REC_LABELS[value],
        }))}
        onChange={(rec) => onPatch({ rec: rec as RecFilter })}
      />

      <MultiSelect
        label="Confidence"
        value={scope.confidence}
        options={(Object.keys(CONFIDENCE_LABELS) as Confidence[]).map(
          (value) => ({ value, label: CONFIDENCE_LABELS[value] }),
        )}
        onChange={(confidence) =>
          onPatch({ confidence: confidence as Confidence[] })
        }
      />

      <SingleSelect
        label="Market"
        value={scope.market}
        options={(Object.keys(MARKET_LABELS) as MarketFilter[]).map(
          (value) => ({ value, label: MARKET_LABELS[value] }),
        )}
        onChange={(market) => onPatch({ market: market as MarketFilter })}
      />

      <Divider />
      <Button variant="contained" size="small" onClick={onClose}>
        Done
      </Button>
    </Stack>
  );
}

function MultiSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (next: string[]) => void;
}) {
  return (
    <FormControl size="small" fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={value}
        input={<OutlinedInput label={label} />}
        onChange={(event) => {
          const next = event.target.value;
          onChange(typeof next === "string" ? next.split(",") : next);
        }}
        renderValue={(selected) =>
          (selected as string[])
            .map(
              (entry) =>
                options.find((option) => option.value === entry)?.label ??
                entry,
            )
            .join(", ")
        }
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

function SingleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <FormControl size="small" fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select
        value={value}
        input={<OutlinedInput label={label} />}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

/**
 * The active-filter chip row (design doc Screen 1). Each chip clears its own
 * facet; search has its own chip too so an over-narrow search reads as an
 * active, removable selection. `Reset all` returns to the default best view.
 */
function ActiveFilterChips({
  scope,
  slate,
  onScopeChange,
}: {
  scope: SlateScope;
  slate: SlateGroupedDto;
  onScopeChange: (next: Partial<SlateScope>) => void;
}) {
  if (isDefaultSelection(scope)) return null;

  const gameLabel = (gameId: string) =>
    slate.availableGames.find((game) => game.gameId === gameId)?.label ??
    gameId;
  const windowLabel = (value: string) =>
    windowOptionsFromGames(slate.games).find((option) => option.value === value)
      ?.label ?? value;

  const chips: Array<{ key: string; label: string; onDelete: () => void }> = [];

  if (scope.q) {
    chips.push({
      key: "q",
      label: `Search: “${scope.q}”`,
      onDelete: () => onScopeChange({ q: "" }),
    });
  }
  for (const gameId of scope.games) {
    chips.push({
      key: `game:${gameId}`,
      label: `Game: ${gameLabel(gameId)}`,
      onDelete: () =>
        onScopeChange({ games: scope.games.filter((id) => id !== gameId) }),
    });
  }
  for (const team of scope.teams) {
    chips.push({
      key: `team:${team}`,
      label: `Team: ${team}`,
      onDelete: () =>
        onScopeChange({ teams: scope.teams.filter((t) => t !== team) }),
    });
  }
  for (const win of scope.windows) {
    chips.push({
      key: `window:${win}`,
      label: `Window: ${windowLabel(win)}`,
      onDelete: () =>
        onScopeChange({ windows: scope.windows.filter((w) => w !== win) }),
    });
  }
  for (const stat of scope.stats) {
    chips.push({
      key: `stat:${stat}`,
      label: `Stat: ${STAT_LABELS[stat]}`,
      onDelete: () =>
        onScopeChange({ stats: scope.stats.filter((s) => s !== stat) }),
    });
  }
  if (scope.rec !== "all") {
    chips.push({
      key: "rec",
      label: `Rec: ${REC_LABELS[scope.rec]}`,
      onDelete: () => onScopeChange({ rec: "all" }),
    });
  }
  for (const conf of scope.confidence) {
    chips.push({
      key: `conf:${conf}`,
      label: `Conf: ${CONFIDENCE_LABELS[conf]}`,
      onDelete: () =>
        onScopeChange({
          confidence: scope.confidence.filter((c) => c !== conf),
        }),
    });
  }
  if (scope.market !== "all") {
    chips.push({
      key: "market",
      label: `Market: ${MARKET_LABELS[scope.market]}`,
      onDelete: () => onScopeChange({ market: "all" }),
    });
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
    >
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          size="small"
          variant="outlined"
          label={chip.label}
          onDelete={chip.onDelete}
          sx={{ color: "text.secondary", borderColor: "border.strong" }}
        />
      ))}
      <Button
        variant="text"
        size="small"
        onClick={() => onScopeChange({ ...DEFAULT_SCOPE, view: scope.view })}
      >
        Reset all
      </Button>
    </Stack>
  );
}
