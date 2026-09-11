"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputAdornment from "@mui/material/InputAdornment";
import InputLabel from "@mui/material/InputLabel";
import Link from "next/link";
import MenuItem from "@mui/material/MenuItem";
import OutlinedInput from "@mui/material/OutlinedInput";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import { NumericText } from "@/components/primitives/NumericText";
import { DistributionSummary } from "@/components/slate/DistributionSummary";
import { PmfBars } from "@/components/slate/PmfBars";
import { STAT_LABELS } from "@/components/slate/prop-display";
import { FreshnessLabel } from "@/components/slate/FreshnessLabel";
import {
  ConfidenceValue,
  formatEt,
  ProvenanceChip,
} from "@/components/slate/values";
import { provenanceFor } from "@/lib/dto/slate";
import type {
  PropResearchProjectionDto,
  PropResearchResponse,
  ResearchPlayerDto,
} from "@/lib/dto/research";
import { probAtLeast } from "@/lib/slate/probability";
import type { StatType } from "../../../generated/prisma/enums";

/** Full-sentence stat label for the result headline and chart caption. */
const STAT_SENTENCE: Record<StatType, string> = {
  passing_yards: "passing yards",
  rushing_yards: "rushing yards",
  receiving_yards: "receiving yards",
  receptions: "receptions",
  rushing_tds: "rushing touchdowns",
  receiving_tds: "receiving touchdowns",
};

/**
 * Prop Research (Pitch 10, Screen 7): player → game → stat → threshold →
 * Sightline's honest probability. Viewer-accessible; probability-only.
 *
 * The distribution is fetched once per (player, game, stat) selection; the
 * THRESHOLD recomputes `P(≥)`/`P(<)` LOCALLY via the shared `probAtLeast` — no
 * round trip, no engine run (RD-1: `P(<) = 1 − P(≥)` exactly). There is NO edge
 * or profitability anywhere on this screen (RD-8); when the entered threshold
 * exactly matches a currently-listed contract with a fresh price, a "View
 * contract" link points at that contract's detail, where edge lives.
 *
 * Honest states, never a fallback: no current base projection → "No current
 * projection"; a game that reached kickoff → "This game has started". The
 * player search itself only surfaces eligible players, so the no-data states
 * are reached mainly via a deep link.
 */
export function PropResearch({
  initialPlayers,
}: {
  initialPlayers: ResearchPlayerDto[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const playerId = searchParams.get("player") ?? "";
  const gameId = searchParams.get("game") ?? "";
  const statParam = searchParams.get("stat") ?? "";
  const thresholdParam = searchParams.get("threshold") ?? "";

  // Player search results. Seeded with the server's initial eligible set; the
  // Autocomplete refetches as the user types (debounced), against the shared
  // Sightline route — never Kalshi, never the browser touching the DB.
  const [players, setPlayers] = useState<ResearchPlayerDto[]>(initialPlayers);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  // The threshold is LOCAL client state, not the URL param: typing it must be
  // instant and freely clearable to an empty field. Driving it through the URL
  // meant a navigation per keystroke and a prefill effect that snapped a
  // cleared field back to the median. Seeded once from a deep link.
  const [thresholdInput, setThresholdInput] = useState(thresholdParam);

  const selectedPlayer = useMemo(
    () => players.find((player) => player.playerId === playerId) ?? null,
    [players, playerId],
  );
  const selectedGame = useMemo(
    () => selectedPlayer?.games.find((game) => game.gameId === gameId) ?? null,
    [selectedPlayer, gameId],
  );
  const statType = (statParam || null) as StatType | null;

  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams],
  );

  // --- Player search (debounced fetch) -----------------------------------
  // Name-driven; the server requires 2+ characters (an empty search would pull
  // the whole corpus), so a shorter input clears results without a request.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchInput = useCallback((value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSearchLoading(false);
      setPlayers([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(
          `/api/research/players?q=${encodeURIComponent(value)}`,
        );
        if (response.ok) {
          const body = (await response.json()) as {
            players: ResearchPlayerDto[];
          };
          setPlayers(body.players);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 200);
  }, []);

  // --- Projection fetch: once per (player, game, stat) selection ----------
  const [projection, setProjection] = useState<PropResearchResponse | null>(
    null,
  );
  const [projectionLoading, setProjectionLoading] = useState(false);

  const selectionComplete = Boolean(playerId && gameId && statType);

  useEffect(() => {
    if (!selectionComplete) return;
    let cancelled = false;
    void (async () => {
      setProjectionLoading(true);
      try {
        const response = await fetch(
          `/api/research/projection?playerId=${encodeURIComponent(
            playerId,
          )}&gameId=${encodeURIComponent(gameId)}&statType=${encodeURIComponent(
            String(statType),
          )}`,
        );
        const body = (await response.json()) as PropResearchResponse;
        if (!cancelled) setProjection(body);
      } finally {
        if (!cancelled) setProjectionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // The threshold is deliberately NOT a dependency: changing it never
    // refetches (RD-1 / spec §9 — recompute is local arithmetic).
  }, [selectionComplete, playerId, gameId, statType]);

  // Prefill the threshold with the projected median when a distribution loads
  // AND the field is empty (a fresh selection, or first paint without a deep
  // link) — so a first result appears immediately (design doc §Behavior). It
  // keys on `projection` only, so a value the user typed or cleared is never
  // clobbered: clearing the field stays cleared.
  useEffect(() => {
    if (
      projection?.available === true &&
      Number.isFinite(projection.projectedMedian)
    ) {
      setThresholdInput((prev) =>
        prev.trim() === "" ? String(projection.projectedMedian) : prev,
      );
    }
  }, [projection]);

  // --- Selection handlers -------------------------------------------------
  // Each selection change clears the threshold so the prefill effect re-seeds
  // the new distribution's median.
  function onPlayerChange(player: ResearchPlayerDto | null) {
    setThresholdInput("");
    if (!player) {
      patch({ player: null, game: null, stat: null, threshold: null });
      return;
    }
    // Default game = soonest upcoming; default stat = first available.
    const firstGame = player.games[0] ?? null;
    const firstStat = firstGame?.statTypes[0] ?? null;
    patch({
      player: player.playerId,
      game: firstGame?.gameId ?? null,
      stat: firstStat ?? null,
      threshold: null,
    });
  }

  function onGameChange(nextGameId: string) {
    setThresholdInput("");
    const game = selectedPlayer?.games.find((g) => g.gameId === nextGameId);
    const firstStat = game?.statTypes[0] ?? null;
    patch({ game: nextGameId, stat: firstStat ?? null, threshold: null });
  }

  function onStatChange(nextStat: string) {
    setThresholdInput("");
    patch({ stat: nextStat, threshold: null });
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Prop Research</Typography>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          Sightline&apos;s honest probability for any player, stat, and
          threshold on an upcoming game. Probability only — no edge without a
          real market price.
        </Typography>
      </Stack>

      <Paper sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: { md: "flex-start" } }}
        >
          <Autocomplete
            sx={{ flex: 1, width: "100%" }}
            options={players}
            value={selectedPlayer}
            loading={searchLoading}
            onChange={(_event, value) => onPlayerChange(value)}
            onInputChange={(_event, value, reason) => {
              setSearchInput(value);
              if (reason === "input") onSearchInput(value);
            }}
            getOptionLabel={(option) => option.fullName}
            isOptionEqualToValue={(option, value) =>
              option.playerId === value.playerId
            }
            noOptionsText={
              searchInput.trim().length < 2
                ? "Type at least 2 letters to search"
                : "No players Sightline is projecting"
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Player"
                placeholder="Search players"
                size="small"
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps.input,
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon
                          sx={{ fontSize: 20, color: "text.muted" }}
                        />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <>
                        {searchLoading ? (
                          <CircularProgress color="inherit" size={16} />
                        ) : null}
                        {params.slotProps.input.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />

          <FormControl
            size="small"
            sx={{ minWidth: { md: 220 }, width: { xs: "100%", md: "auto" } }}
            disabled={!selectedPlayer}
          >
            <InputLabel>Game</InputLabel>
            <Select
              value={selectedGame ? selectedGame.gameId : ""}
              input={<OutlinedInput label="Game" />}
              onChange={(event) => onGameChange(event.target.value)}
            >
              {(selectedPlayer?.games ?? []).map((game) => (
                <MenuItem key={game.gameId} value={game.gameId}>
                  {game.label} · {formatEt(game.kickoffAt)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl
            size="small"
            sx={{ minWidth: { md: 180 }, width: { xs: "100%", md: "auto" } }}
            disabled={!selectedGame}
          >
            <InputLabel>Stat</InputLabel>
            <Select
              value={statType ?? ""}
              input={<OutlinedInput label="Stat" />}
              onChange={(event) => onStatChange(event.target.value)}
            >
              {(selectedGame?.statTypes ?? []).map((stat) => (
                <MenuItem key={stat} value={stat}>
                  {STAT_LABELS[stat]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Threshold"
            size="small"
            value={thresholdInput}
            disabled={projection?.available !== true}
            onChange={(event) => setThresholdInput(event.target.value)}
            sx={{ width: { xs: "100%", md: 120 } }}
            slotProps={{
              htmlInput: {
                inputMode: "decimal",
                "aria-label": "Threshold",
              },
            }}
          />
        </Stack>
      </Paper>

      {!selectionComplete ? (
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Choose a player, game, and stat to see Sightline&apos;s probability.
          </Typography>
        </Paper>
      ) : projectionLoading ? (
        <ResultSkeleton />
      ) : projection?.available === true ? (
        <ResultCard projection={projection} threshold={thresholdInput} />
      ) : projection?.available === false ? (
        <UnavailableCard
          reason={projection.reason}
          playerName={projection.playerName}
          statType={projection.statType}
        />
      ) : (
        <ResultSkeleton />
      )}
    </Stack>
  );
}

/**
 * The result card. Above/below are computed HERE, in the browser, from the
 * delivered distribution — the identity that makes typing a threshold instant
 * and engine-free (RD-1). No edge, no profitability, ever (RD-8).
 */
function ResultCard({
  projection,
  threshold,
}: {
  projection: PropResearchProjectionDto;
  threshold: string;
}) {
  const statSentence = STAT_SENTENCE[projection.statType];
  const provenance = provenanceFor(projection.modelVersion);

  const numericThreshold = Number(threshold);
  const thresholdValid =
    threshold.trim() !== "" && Number.isFinite(numericThreshold);

  const distribution = {
    distributionKind: projection.distributionKind,
    params: projection.params,
    pmf: projection.pmf,
    quantiles: projection.quantiles,
  };

  const probabilityAbove = thresholdValid
    ? probAtLeast(distribution, numericThreshold)
    : null;
  const probabilityBelow =
    probabilityAbove === null ? null : 1 - probabilityAbove;

  // The exact-match listed contract (with a fresh price) → a link to detail,
  // where edge lives. Prop Research itself renders no number for it (RD-8).
  const listedContractId = thresholdValid
    ? (projection.listedContracts.find(
        (listed) => listed.threshold === numericThreshold,
      )?.contractId ?? null)
    : null;

  const isPmf = projection.distributionKind === "empirical_pmf";

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <Typography variant="h2">
            {STAT_LABELS[projection.statType]}
            {thresholdValid ? ` vs ${numericThreshold}` : ""}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <FreshnessLabel freshness={projection.freshness} />
            <ConfidenceValue confidence={projection.confidence} size="sm" />
          </Stack>
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {projection.playerName} · {projection.gameLabel} ·{" "}
          {formatEt(projection.kickoffAt)}
        </Typography>

        <Divider />

        {thresholdValid ? (
          <Stack
            direction="row"
            spacing={4}
            sx={{ flexWrap: "wrap", rowGap: 2 }}
          >
            <Cell label={`Above ${numericThreshold}`}>
              <NumericText size="lg" sx={{ color: "primary.main" }}>
                {probabilityAbove === null
                  ? "—"
                  : `${(probabilityAbove * 100).toFixed(1)}%`}
              </NumericText>
            </Cell>
            <Cell label={`Below ${numericThreshold}`}>
              <NumericText size="lg" sx={{ color: "primary.main" }}>
                {probabilityBelow === null
                  ? "—"
                  : `${(probabilityBelow * 100).toFixed(1)}%`}
              </NumericText>
            </Cell>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: "warning.main" }}>
            Enter a numeric threshold to see the above/below probabilities.
          </Typography>
        )}

        <Stack
          direction="row"
          spacing={3}
          sx={{ flexWrap: "wrap", rowGap: 1, alignItems: "baseline" }}
        >
          <Labelled label="projected">
            <NumericText size="md" sx={{ color: "primary.main" }}>
              {projection.projectedValue}
            </NumericText>
          </Labelled>
          <Labelled label="range (10–90%)">
            <NumericText size="md" sx={{ color: "primary.main" }}>
              {projection.intervalLow} – {projection.intervalHigh}
            </NumericText>
          </Labelled>
        </Stack>

        {thresholdValid ? (
          isPmf && projection.pmf ? (
            <PmfBars
              pmf={projection.pmf}
              threshold={numericThreshold}
              probability={probabilityAbove}
              unitLabel={statSentence}
            />
          ) : projection.quantiles ? (
            <DistributionSummary
              quantiles={projection.quantiles}
              threshold={numericThreshold}
              probability={probabilityAbove}
              unitLabel={statSentence}
            />
          ) : null
        ) : null}

        {projection.drivers.length > 0 ? (
          <Box>
            <Typography variant="label" sx={{ color: "text.secondary" }}>
              Why
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {projection.drivers.map((driver) => (
                <Typography key={driver} component="li" variant="body2">
                  {driver}
                </Typography>
              ))}
            </Stack>
          </Box>
        ) : null}

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <ProvenanceChip modelVersion={projection.modelVersion} />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {provenance?.name ?? "Model"} · computed{" "}
            {formatEt(projection.computedAt)} · cutoff{" "}
            {formatEt(projection.informationCutoff)}
          </Typography>
        </Stack>

        {listedContractId ? (
          <Box>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              This line is listed on Kalshi
            </Typography>{" "}
            <Button
              component={Link}
              href={`/slate/${listedContractId}`}
              variant="text"
              size="small"
            >
              View contract
            </Button>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

/**
 * The honest no-data / kicked-off states (RD-4). Never a season average, never
 * an error dialog — a plain declarative statement of what Sightline does and
 * does not cover.
 */
function UnavailableCard({
  reason,
  playerName,
  statType,
}: {
  reason: "no_projection" | "game_started";
  playerName: string | null;
  statType: StatType | null;
}) {
  if (reason === "game_started") {
    return (
      <Paper sx={{ p: 2.5 }}>
        <Stack spacing={1}>
          <Typography variant="h2">This game has started</Typography>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", maxWidth: 460 }}
          >
            Prop Research is pre-game only. Once the ball is kicked,
            Sightline&apos;s projection is stale by design, so no probability is
            shown for a game that has started.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  const subject =
    playerName && statType
      ? `${playerName} · ${STAT_SENTENCE[statType]} · this week`
      : "this player, stat, and game";
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack spacing={1}>
        <Typography variant="h2">No current projection</Typography>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", maxWidth: 460 }}
        >
          Sightline doesn&apos;t have a current projection for {subject}. Prop
          Research only covers players Sightline is already projecting for an
          upcoming game — it never falls back to a season average or any
          approximation.
        </Typography>
      </Stack>
    </Paper>
  );
}

function ResultSkeleton() {
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="rectangular" height={120} />
      </Stack>
    </Paper>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}

function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography
        variant="body2"
        component="span"
        sx={{ color: "text.secondary" }}
      >
        {label}
      </Typography>
      {children}
    </Stack>
  );
}
