import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Link from "next/link";

import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { AutonomyTabs } from "@/components/autonomy/AutonomyTabs";
import {
  AutonomyHeading,
  formatCents,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import type { PositionRowDto } from "@/lib/dto/autonomy";

/**
 * The paper ledger.
 *
 * Every row carries the intended stake beside the actual fill, permanently. The
 * ledger must represent what realistically would have happened, not what the
 * sizing formula wished had happened — and losing the intent would make a
 * partial fill indistinguishable from a small one.
 *
 * P&L renders as `—` while a position is open. Unrealised value never enters
 * that column: a realised-P&L figure that quietly included marks would make
 * the campaign's record move with the book.
 */
export function AutonomyPositions({
  rows,
  status,
  openCount,
  settledCount,
}: {
  rows: PositionRowDto[];
  status: "open" | "settled" | "all";
  openCount: number;
  settledCount: number;
}) {
  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Positions"
        detail="Paper mode · all positions simulated · never live"
      />
      <AutonomyTabs current="/autonomy/positions" />

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        {(["open", "settled", "all"] as const).map((value) => (
          <Box
            key={value}
            component={Link}
            href={`/autonomy/positions?status=${value}`}
            aria-current={value === status ? "true" : undefined}
            sx={{
              px: 1,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 0.5,
              border: 1,
              fontSize: 12,
              fontWeight: 500,
              textDecoration: "none",
              borderColor: value === status ? "primary.main" : "border.strong",
              color: value === status ? "primary.main" : "text.secondary",
            }}
          >
            {value}
          </Box>
        ))}
      </Stack>

      <Paper>
        {rows.length === 0 ? (
          <EmptyState
            title={
              openCount + settledCount === 0
                ? "No paper positions."
                : `No ${status} positions.`
            }
            detail={
              openCount + settledCount === 0
                ? "Positions appear once an autonomous cycle fills one."
                : `${openCount} open, ${settledCount} settled in this campaign.`
            }
            action={{ label: "View cycles", href: "/autonomy/cycles" }}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contract</TableCell>
                <TableCell>Side</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell align="right">Mark</TableCell>
                <TableCell>Result</TableCell>
                <TableCell align="right">P&amp;L</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <PositionRow key={row.positionId} row={row} />
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Typography
        variant="caption"
        sx={{ color: "text.secondary", maxWidth: 720 }}
      >
        Positions settle against Kalshi&apos;s settlement result. Where
        Kalshi&apos;s settlement and the official stat line disagree, the
        position follows Kalshi and the model&apos;s grade follows the official
        line — the two are recorded separately and never reconciled.
      </Typography>
    </Stack>
  );
}

function PositionRow({ row }: { row: PositionRowDto }) {
  const voided = row.status === "voided";
  const partial = row.unfilledStakeCents > 0;

  return (
    <TableRow sx={voided ? { color: "text.secondary" } : undefined}>
      <TableCell>
        <Typography
          variant="body2"
          sx={voided ? { color: "text.secondary" } : undefined}
        >
          {row.playerName}
          {row.statType && row.threshold !== null
            ? ` · ${row.statType.replace(/_/g, " ")} ≥ ${row.threshold}`
            : ""}
        </Typography>
        <NumericText
          size="sm"
          sx={{ color: "text.secondary", display: "block" }}
        >
          opened {formatTimestamp(row.openedAt)}
          {row.settledAt ? ` · settled ${formatTimestamp(row.settledAt)}` : ""}
          {" · intended "}
          {formatCents(row.intendedStakeCents)}
          {partial ? "" : " · filled complete"}
        </NumericText>
        {partial ? (
          <NumericText
            size="sm"
            sx={{ color: "warning.main", display: "block" }}
          >
            partial — {formatCents(row.unfilledStakeCents)} unfilled
          </NumericText>
        ) : null}
        {voided ? (
          <NumericText size="sm" sx={{ color: "text.muted", display: "block" }}>
            market voided — cost basis and fees returned
          </NumericText>
        ) : null}
      </TableCell>
      <TableCell sx={{ color: voided ? "text.secondary" : "market.main" }}>
        {row.side}
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm">{row.contracts}</NumericText>
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm">
          {formatCents(row.costBasisCents + row.feesPaidCents)}
        </NumericText>
      </TableCell>
      <TableCell align="right">
        {row.status !== "open" ? (
          <NumericText size="sm" muted>
            —
          </NumericText>
        ) : row.markCents === null ? (
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            unavailable
          </Typography>
        ) : (
          <NumericText size="sm" sx={{ color: "market.main" }}>
            {formatCents(row.markCents)}
          </NumericText>
        )}
      </TableCell>
      <TableCell>
        {row.status === "open" ? (
          <Typography variant="body2">open</Typography>
        ) : voided ? (
          <Box
            component="span"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              height: 22,
              px: 1,
              borderRadius: 0.5,
              border: 1,
              borderColor: "border.strong",
              color: "text.secondary",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            voided
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: "market.main" }}>
            settled {row.settlementResult}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        {row.realizedPnlCents === null ? (
          <NumericText size="sm" muted>
            —
          </NumericText>
        ) : (
          <NumericText
            size="sm"
            sx={{
              color:
                row.realizedPnlCents > 0
                  ? "primary.main"
                  : row.realizedPnlCents < 0
                    ? "error.main"
                    : "text.primary",
            }}
          >
            {formatCents(row.realizedPnlCents, true)}
          </NumericText>
        )}
      </TableCell>
    </TableRow>
  );
}
