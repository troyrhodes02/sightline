"use client";

import { usePathname, useRouter } from "next/navigation";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import type { OverridesDto } from "@/lib/dto/accuracy";

/**
 * The overrides scope controls — stat and season only, URL-backed like the
 * accuracy scope bar so any filtered view is shareable and returnable.
 * Unrecognized values fall back to defaults server-side.
 */

const STAT_LABELS: Array<{ value: string; label: string }> = [
  { value: "passing_yards", label: "Passing yards" },
  { value: "rushing_yards", label: "Rushing yards" },
  { value: "receiving_yards", label: "Receiving yards" },
  { value: "receptions", label: "Receptions" },
  { value: "rushing_tds", label: "Rushing TDs" },
  { value: "receiving_tds", label: "Receiving TDs" },
];

export function OverridesScopeBar({
  scope,
  availableSeasons,
}: {
  scope: OverridesDto["scope"];
  availableSeasons: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = (patch: { stat?: string; season?: string }) => {
    const params = new URLSearchParams({
      stat: patch.stat ?? String(scope.statType),
      season: patch.season ?? String(scope.season),
    });
    router.replace(`${pathname}?${params.toString()}`);
  };

  // The current value always appears in its own list (a deep link ahead of
  // the data), so the select stays controlled and honest.
  const seasons =
    scope.season === "all" || availableSeasons.includes(scope.season)
      ? availableSeasons
      : [scope.season, ...availableSeasons];

  return (
    <Paper sx={{ p: 1.5 }}>
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center" }}
      >
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="overrides-stat-label">Stat</InputLabel>
          <Select
            labelId="overrides-stat-label"
            label="Stat"
            value={scope.statType}
            onChange={(event) => apply({ stat: event.target.value })}
          >
            <MenuItem value="all">All</MenuItem>
            {STAT_LABELS.map((stat) => (
              <MenuItem key={stat.value} value={stat.value}>
                {stat.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="overrides-season-label">Season</InputLabel>
          <Select
            labelId="overrides-season-label"
            label="Season"
            value={String(scope.season)}
            onChange={(event) => apply({ season: event.target.value })}
          >
            <MenuItem value="all">All</MenuItem>
            {seasons.map((season) => (
              <MenuItem key={season} value={String(season)}>
                {season}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
    </Paper>
  );
}
