// A client component because it composes the interactive scope bar and rows
// that pass `component={Link}` to MUI (same reasoning as Accuracy). Everything
// it receives is a serializable DTO.
"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { StatusChip } from "@/components/primitives/StatusChip";
import { OverridesScopeBar } from "@/components/accuracy/OverridesScopeBar";
import { DispositionChip, formatEt } from "@/components/slate/values";
import type { OverrideDecisionRowDto, OverridesDto } from "@/lib/dto/accuracy";

/**
 * The overrides surface — William's private record, descriptive and never
 * causal. Took, faded, and skipped stay three states; skips carry no win/loss
 * language; voided enters no denominator; every figure travels with its n.
 * Won and lost are words with glyphs (✓/✗), never green or red fills.
 */

/** The surface's honesty contract — fixed copy, always rendered. */
const SELECTION_BIAS_STATEMENT =
  "William selects which contracts to mark. This record reflects those " +
  "choices, not a head-to-head against the model's full prediction population.";

const STAT_ABBREV: Record<OverrideDecisionRowDto["statType"], string> = {
  passing_yards: "pass yds",
  rushing_yards: "rush yds",
  receiving_yards: "rec yds",
  receptions: "receptions",
  rushing_tds: "rush TDs",
  receiving_tds: "rec TDs",
};

const UNAVAILABLE_LABELS: Record<string, string> = {
  missing_final_snapshot: "no final snapshot",
  voided: "voided",
  side_unavailable: "book side unavailable",
};

function signedPoints(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

export function Overrides({
  overrides,
  availableSeasons,
}: {
  overrides: OverridesDto;
  availableSeasons: number[];
}) {
  const empty = overrides.decisions.length === 0;

  return (
    <Stack spacing={2}>
      <Typography variant="h1">Overrides</Typography>

      <OverridesScopeBar
        scope={overrides.scope}
        availableSeasons={availableSeasons}
      />

      <Typography
        variant="body2"
        sx={{ color: "text.secondary", maxWidth: 640 }}
      >
        {SELECTION_BIAS_STATEMENT}
      </Typography>

      {empty ? (
        <EmptyState
          title="No decisions logged for this scope."
          detail="Decisions are marked from the slate; graded results appear here after settlement."
        />
      ) : (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
              gap: 2,
            }}
          >
            <TookFadedTile label="took" tile={overrides.tiles.took} />
            <TookFadedTile
              label="faded"
              tile={overrides.tiles.faded}
              caption="graded on the side he preferred"
            />
            <SkippedTile tile={overrides.tiles.skipped} />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
              alignItems: "start",
            }}
          >
            <AgreementPanel agreement={overrides.agreement} />
            <TimingPanel timing={overrides.timing} />
          </Box>

          <DecisionsPanel decisions={overrides.decisions} />
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Disposition tiles
// ---------------------------------------------------------------------------

function TookFadedTile({
  label,
  tile,
  caption,
}: {
  label: "took" | "faded";
  tile: OverridesDto["tiles"]["took"];
  caption?: string;
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="label" sx={{ color: "text.secondary" }}>
            {label}
          </Typography>
          {tile.settled === 0 && tile.pending > 0 ? (
            <StatusChip label="pending" tone="neutral" />
          ) : null}
        </Stack>
        <NumericText size="lg">
          {tile.total.toLocaleString("en-US")}
        </NumericText>
        <NumericText size="sm" muted>
          settled {tile.settled} · won {tile.won} ✓ · lost {tile.lost} ✗
        </NumericText>
        <NumericText size="sm" muted>
          voided {tile.voided} · pending {tile.pending}
        </NumericText>
        {caption ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {caption}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

/** A skip is no action — settlement is described, never won or lost. */
function SkippedTile({ tile }: { tile: OverridesDto["tiles"]["skipped"] }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="label" sx={{ color: "text.secondary" }}>
            skipped
          </Typography>
          {tile.settledYes + tile.settledNo === 0 && tile.pending > 0 ? (
            <StatusChip label="pending" tone="neutral" />
          ) : null}
        </Stack>
        <NumericText size="lg">
          {tile.total.toLocaleString("en-US")}
        </NumericText>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          no action taken
        </Typography>
        <NumericText size="sm" muted>
          settled yes {tile.settledYes} · settled no {tile.settledNo}
        </NumericText>
        <NumericText size="sm" muted>
          voided {tile.voided} · pending {tile.pending}
        </NumericText>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

function agreementCell(cell: { count: number; won: number | null }): string {
  return cell.won === null
    ? `${cell.count}`
    : `${cell.count} (won ${cell.won})`;
}

function AgreementPanel({
  agreement,
}: {
  agreement: OverridesDto["agreement"];
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Against the recommendation
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          per final pre-kickoff state · unmarked contracts excluded entirely
        </Typography>
        <Table size="small" aria-label="Decisions against the recommendation">
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell align="right">recommended</TableCell>
              <TableCell align="right">not recommended</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agreement.map((row) => (
              <TableRow key={row.disposition}>
                <TableCell>
                  <Typography variant="body2" component="span">
                    {row.disposition}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <NumericText size="sm" component="span">
                    {agreementCell(row.recommended)}
                  </NumericText>
                </TableCell>
                <TableCell align="right">
                  <NumericText size="sm" component="span">
                    {agreementCell(row.notRecommended)}
                  </NumericText>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Timing cost
// ---------------------------------------------------------------------------

function TimingPanel({ timing }: { timing: OverridesDto["timing"] }) {
  const unavailableTotal = timing.unavailable.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Timing cost
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          positive = the final pre-kickoff edge exceeded the edge he acted on —
          waiting would have been better
        </Typography>
        <Stack
          direction="row"
          spacing={2.5}
          useFlexGap
          sx={{ alignItems: "baseline", flexWrap: "wrap" }}
        >
          <NumericText size="lg">
            median{" "}
            {timing.medianPoints === null
              ? "—"
              : `${signedPoints(timing.medianPoints)} pts`}
          </NumericText>
          <NumericText size="md" muted>
            mean{" "}
            {timing.meanPoints === null
              ? "—"
              : `${signedPoints(timing.meanPoints)} pts`}
          </NumericText>
        </Stack>
        <NumericText size="sm" muted>
          {timing.measurable} of {timing.total} decisions measurable
          {unavailableTotal > 0
            ? ` · ${unavailableTotal} unavailable: ${timing.unavailable
                .map(
                  (entry) =>
                    `${entry.count} ${UNAVAILABLE_LABELS[entry.reason] ?? entry.reason}`,
                )
                .join(" · ")}`
            : ""}
        </NumericText>
      </Stack>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Per-decision table
// ---------------------------------------------------------------------------

function OutcomeCell({
  outcome,
}: {
  outcome: OverrideDecisionRowDto["outcome"];
}) {
  switch (outcome) {
    case "won":
      return <NumericText size="sm">won ✓</NumericText>;
    case "lost":
      return <NumericText size="sm">lost ✗</NumericText>;
    case "voided":
      return <StatusChip label="voided" tone="neutral" />;
    case "pending":
      return (
        <NumericText size="sm" muted>
          pending
        </NumericText>
      );
    case "settled_yes":
      return (
        <NumericText size="sm" muted>
          settled yes
        </NumericText>
      );
    case "settled_no":
      return (
        <NumericText size="sm" muted>
          settled no
        </NumericText>
      );
  }
}

function RowChips({ row }: { row: OverrideDecisionRowDto }) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      {row.sourcesDisagree ? (
        <StatusChip label="sources disagree" tone="caution" icon />
      ) : null}
      {row.timingUnavailableReason !== null &&
      row.timingUnavailableReason !== "voided" ? (
        <StatusChip
          label={UNAVAILABLE_LABELS[row.timingUnavailableReason]}
          tone="neutral"
        />
      ) : null}
    </Stack>
  );
}

function ContractLink({ row }: { row: OverrideDecisionRowDto }) {
  return (
    <Typography
      component={Link}
      href={`/slate/${row.contractId}`}
      variant="body2"
      sx={{
        color: "text.primary",
        textDecoration: "none",
        "&:hover": { color: "primary.main" },
      }}
    >
      {row.playerName} · {STAT_ABBREV[row.statType]} ≥ {row.threshold}
    </Typography>
  );
}

function points(value: number | null): React.ReactNode {
  return (
    <NumericText size="sm" muted={value === null} component="span">
      {value === null ? "—" : signedPoints(value)}
    </NumericText>
  );
}

/**
 * Every acted-on decision, linked to its contract. Superseded rows never
 * reach this table — the read selects chain heads only. At `xs` the table
 * yields to two-line stacked rows; nothing scrolls horizontally.
 */
function DecisionsPanel({
  decisions,
}: {
  decisions: OverrideDecisionRowDto[];
}) {
  return (
    <Paper sx={{ p: { xs: 1.5, sm: 0 } }}>
      <Box sx={{ display: { xs: "none", sm: "block" } }}>
        <Table size="small" aria-label="Per-decision record">
          <TableHead>
            <TableRow>
              <TableCell>decided</TableCell>
              <TableCell>contract</TableCell>
              <TableCell>disp</TableCell>
              <TableCell align="right">edge @ decision</TableCell>
              <TableCell align="right">edge @ final</TableCell>
              <TableCell align="right">timing</TableCell>
              <TableCell>outcome</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {decisions.map((row) => (
              <TableRow key={row.contractId} hover>
                <TableCell>
                  <NumericText size="sm" muted component="span">
                    {formatEt(row.decidedAt)}
                  </NumericText>
                </TableCell>
                <TableCell>
                  <ContractLink row={row} />
                </TableCell>
                <TableCell>
                  <DispositionChip disposition={row.disposition} />
                </TableCell>
                <TableCell align="right">
                  {points(row.edgeAtDecision)}
                </TableCell>
                <TableCell align="right">{points(row.edgeAtFinal)}</TableCell>
                <TableCell align="right">
                  {points(row.timingCostPoints)}
                </TableCell>
                <TableCell>
                  <OutcomeCell outcome={row.outcome} />
                </TableCell>
                <TableCell>
                  <RowChips row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      {/* Phone: identity line, then figures line — nothing scrolls. */}
      <Stack
        spacing={1.5}
        sx={{ display: { xs: "flex", sm: "none" } }}
        aria-label="Per-decision record"
      >
        {decisions.map((row) => (
          <Stack
            key={row.contractId}
            spacing={0.5}
            sx={{ borderBottom: 1, borderColor: "divider", pb: 1 }}
          >
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <ContractLink row={row} />
              <DispositionChip disposition={row.disposition} />
            </Stack>
            <Stack
              direction="row"
              spacing={1.5}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <NumericText size="sm" muted component="span">
                {formatEt(row.decidedAt)}
              </NumericText>
              <NumericText size="sm" component="span">
                {points(row.edgeAtDecision)} → {points(row.edgeAtFinal)}
              </NumericText>
              <OutcomeCell outcome={row.outcome} />
              <RowChips row={row} />
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
