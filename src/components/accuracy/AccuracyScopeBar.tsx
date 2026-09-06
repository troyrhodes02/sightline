"use client";

import { usePathname, useRouter } from "next/navigation";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { AccuracyScope } from "@/lib/dto/accuracy";

/**
 * The scope bar: record, version, population, stat, season — URL-backed so
 * every view is shareable and returnable. Each change rewrites the query via
 * `router.replace`; the server re-reads and every denominator on screen
 * updates in the same paint. Unrecognized values fall back to defaults
 * server-side (the URL is user-editable input, not a form).
 */

const POPULATION_LABELS: Record<AccuracyScope["population"], string> = {
  contract_like: "Contract-like",
  all: "All projections",
  market_linked: "Market-linked",
};

const STAT_LABELS: Array<{ value: string; label: string }> = [
  { value: "passing_yards", label: "Passing yards" },
  { value: "rushing_yards", label: "Rushing yards" },
  { value: "receiving_yards", label: "Receiving yards" },
  { value: "receptions", label: "Receptions" },
  { value: "rushing_tds", label: "Rushing TDs" },
  { value: "receiving_tds", label: "Receiving TDs" },
];

export function AccuracyScopeBar({
  scope,
  availableVersions,
  availableSeasons,
}: {
  scope: AccuracyScope;
  availableVersions: string[];
  availableSeasons: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = (patch: Partial<Record<keyof AccuracyScope, string>>) => {
    const next = {
      record: scope.record,
      version: String(scope.modelVersion),
      population: scope.population,
      stat: String(scope.statType),
      season: String(scope.season),
      ...("record" in patch ? { record: patch.record as string } : {}),
      ...("modelVersion" in patch ? { version: patch.modelVersion } : {}),
      ...("population" in patch ? { population: patch.population } : {}),
      ...("statType" in patch ? { stat: patch.statType } : {}),
      ...("season" in patch ? { season: patch.season } : {}),
    };
    const params = new URLSearchParams({
      record: next.record as string,
      version: next.version as string,
      population: next.population as string,
      stat: next.stat as string,
      season: next.season as string,
    });
    router.replace(`${pathname}?${params.toString()}`);
  };

  // The current value always appears in its own list, even when it has no
  // graded data (a deep link ahead of the data), so the select stays honest
  // and controlled instead of snapping to a value the URL does not carry.
  const versions = availableVersions.includes(scope.modelVersion)
    ? availableVersions
    : scope.modelVersion === "all"
      ? availableVersions
      : [scope.modelVersion, ...availableVersions];
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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={scope.record}
          aria-label="Record"
          onChange={(_, value: string | null) => {
            if (value) apply({ record: value });
          }}
        >
          <ToggleButton value="live">Live</ToggleButton>
          <ToggleButton value="backtest">Backtest</ToggleButton>
          <ToggleButton value="compare">Compare</ToggleButton>
        </ToggleButtonGroup>

        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="accuracy-version-label">Version</InputLabel>
          <Select
            labelId="accuracy-version-label"
            label="Version"
            value={scope.modelVersion}
            onChange={(event) => apply({ modelVersion: event.target.value })}
          >
            {versions.map((version) => (
              <MenuItem key={version} value={version}>
                {version}
              </MenuItem>
            ))}
            <MenuItem value="all">All versions (deployed system)</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="accuracy-population-label">Population</InputLabel>
          <Select
            labelId="accuracy-population-label"
            label="Population"
            value={scope.population}
            onChange={(event) => apply({ population: event.target.value })}
          >
            {(
              Object.keys(POPULATION_LABELS) as AccuracyScope["population"][]
            ).map((population) => (
              <MenuItem key={population} value={population}>
                {POPULATION_LABELS[population]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="accuracy-stat-label">Stat</InputLabel>
          <Select
            labelId="accuracy-stat-label"
            label="Stat"
            value={scope.statType}
            onChange={(event) => apply({ statType: event.target.value })}
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
          <InputLabel id="accuracy-season-label">Season</InputLabel>
          <Select
            labelId="accuracy-season-label"
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
