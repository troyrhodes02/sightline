"use client";

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
  formatKickoff,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import type {
  ActivityDto,
  CycleRowDto,
  PositionRowDto,
} from "@/lib/dto/autonomy";
import type { PaperPortfolio } from "../../../generated/prisma/enums";

/**
 * Paper Bot → Activity (PME-6, D10/D6).
 *
 * The full simulated-position ledger and the candidate-by-candidate cycle
 * diagnostics, kept available for inspection and audit without making scheduler
 * internals a primary workflow. Every position row carries its portfolio and its
 * permanent model attribution (`sourceModelVersion`) — for a Hybrid position it
 * names the engine that produced the driving probability at open time and never
 * relabels it (D6). A failed cycle is a ROW with a reason, not an error state;
 * underlying records are never deleted.
 *
 * Filters are deep-linked so a shared Activity link resolves to the same view.
 */

const PORTFOLIOS: Array<PaperPortfolio | "all"> = [
  "all",
  "baseline",
  "simulation",
  "hybrid",
];

function activityHref(scope: {
  view: "positions" | "cycles";
  portfolio: PaperPortfolio | "all";
  status: "open" | "settled" | "all";
}): string {
  const params = new URLSearchParams();
  params.set("view", scope.view);
  if (scope.portfolio !== "all") params.set("portfolio", scope.portfolio);
  if (scope.view === "positions" && scope.status !== "open") {
    params.set("status", scope.status);
  }
  const query = params.toString();
  return `/autonomy/activity${query ? `?${query}` : ""}`;
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      component={Link}
      href={href}
      aria-current={active ? "true" : undefined}
      sx={{
        px: 1,
        height: 24,
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 0.5,
        border: 1,
        fontSize: 12,
        fontWeight: 500,
        textTransform: "capitalize",
        textDecoration: "none",
        borderColor: active ? "primary.main" : "border.strong",
        color: active ? "primary.main" : "text.secondary",
      }}
    >
      {children}
    </Box>
  );
}

export function PaperBotActivity({ activity }: { activity: ActivityDto }) {
  const { view, portfolio, status } = activity;

  return (
    <Stack spacing={3}>
      <AutonomyHeading
        title="Paper Bot"
        detail="Paper mode · all positions simulated · never live"
      />
      <AutonomyTabs current="/autonomy/activity" />

      {!activity.campaignExists ? (
        <Paper>
          <EmptyState
            title="No paper campaign configured."
            detail="Set a starting bankroll and risk mode in Settings, then cycles and positions appear here."
            action={{ label: "Settings", href: "/autonomy/settings" }}
          />
        </Paper>
      ) : (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ flexWrap: "wrap" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="label" sx={{ color: "text.secondary" }}>
                Portfolio
              </Typography>
              {PORTFOLIOS.map((value) => (
                <Pill
                  key={value}
                  href={activityHref({ view, portfolio: value, status })}
                  active={value === portfolio}
                >
                  {value}
                </Pill>
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="label" sx={{ color: "text.secondary" }}>
                View
              </Typography>
              {(["positions", "cycles"] as const).map((value) => (
                <Pill
                  key={value}
                  href={activityHref({ view: value, portfolio, status })}
                  active={value === view}
                >
                  {value}
                </Pill>
              ))}
            </Stack>
            {view === "positions" ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="label" sx={{ color: "text.secondary" }}>
                  Status
                </Typography>
                {(["open", "settled", "all"] as const).map((value) => (
                  <Pill
                    key={value}
                    href={activityHref({ view, portfolio, status: value })}
                    active={value === status}
                  >
                    {value}
                  </Pill>
                ))}
              </Stack>
            ) : null}
          </Stack>

          {view === "positions" ? (
            <PositionsView activity={activity} />
          ) : (
            <CyclesView activity={activity} />
          )}
        </>
      )}
    </Stack>
  );
}

function PositionsView({ activity }: { activity: ActivityDto }) {
  const { positions, portfolio, status, openCount, settledCount } = activity;
  return (
    <Paper>
      {positions.length === 0 ? (
        <EmptyState
          title={
            openCount + settledCount === 0
              ? "No paper positions."
              : `No ${status} positions${portfolio === "all" ? "" : ` in ${portfolio}`}.`
          }
          detail={
            openCount + settledCount === 0
              ? "Positions appear once a cycle fills one."
              : `${openCount} open, ${settledCount} settled across portfolios. Widen the filter to see more.`
          }
          action={{
            label: "View cycles",
            href: "/autonomy/activity?view=cycles",
          }}
        />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Portfolio</TableCell>
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
            {positions.map((row) => (
              <PositionRow key={row.positionId} row={row} />
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
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
          sx={{ textTransform: "capitalize", color: "text.secondary" }}
        >
          {row.portfolio ?? "—"}
        </Typography>
      </TableCell>
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
          {row.sourceModelVersion ? ` · model ${row.sourceModelVersion}` : ""}
        </NumericText>
        {partial ? (
          <NumericText
            size="sm"
            sx={{ color: "warning.main", display: "block" }}
          >
            partial — {formatCents(row.unfilledStakeCents)} unfilled
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
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            voided
          </Typography>
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

const OUTCOME_TONE: Record<CycleRowDto["outcome"], string> = {
  ok: "text.primary",
  no_candidate: "text.primary",
  partial_fill: "warning.main",
  skipped: "warning.main",
  halted: "error.main",
  failed: "error.main",
};

const OUTCOME_COPY: Record<CycleRowDto["outcome"], string> = {
  ok: "ok",
  no_candidate: "no candidate",
  partial_fill: "partial fill",
  skipped: "skipped",
  halted: "halted",
  failed: "failed",
};

function CyclesView({ activity }: { activity: ActivityDto }) {
  const { cycles, portfolio } = activity;
  return (
    <Paper>
      {cycles.length === 0 ? (
        <EmptyState
          title={`No cycles${portfolio === "all" ? "" : ` in ${portfolio}`}.`}
          detail="Cycles begin once continuous evaluation is enabled and a game window opens. A skipped or failed cycle is a row with a reason, never an absence."
          action={{ label: "Settings", href: "/autonomy/settings" }}
        />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Portfolio</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Game window</TableCell>
              <TableCell align="right">Cand.</TableCell>
              <TableCell align="right">Sized</TableCell>
              <TableCell align="right">Filled</TableCell>
              <TableCell align="right">Staked</TableCell>
              <TableCell>Outcome</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cycles.map((row) => (
              <TableRow
                key={row.cycleId}
                hover
                component={Link}
                href={`/autonomy/activity/${row.cycleId}`}
                sx={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "table-row",
                }}
              >
                <TableCell>
                  <Typography
                    variant="body2"
                    sx={{
                      textTransform: "capitalize",
                      color: "text.secondary",
                    }}
                  >
                    {row.portfolio ?? "—"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <NumericText size="sm">
                    {formatTimestamp(row.startedAt)}
                  </NumericText>
                </TableCell>
                <TableCell>
                  {row.gameLabel} · {formatKickoff(row.kickoffAt)}
                  {row.reason ? (
                    <NumericText
                      size="sm"
                      sx={{ color: "text.secondary", display: "block" }}
                    >
                      {row.reason}
                    </NumericText>
                  ) : null}
                </TableCell>
                <Count value={row.candidatesEvaluated} />
                <Count value={row.candidatesSized} />
                <Count value={row.candidatesFilled} />
                <TableCell align="right">
                  <NumericText size="sm" muted={row.stakedCents === null}>
                    {row.stakedCents === null
                      ? "—"
                      : formatCents(row.stakedCents)}
                  </NumericText>
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    sx={{ color: OUTCOME_TONE[row.outcome] }}
                  >
                    {OUTCOME_COPY[row.outcome]}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}

function Count({ value }: { value: number | null }) {
  return (
    <TableCell align="right">
      <NumericText size="sm" muted={value === null}>
        {value === null ? "—" : value}
      </NumericText>
    </TableCell>
  );
}
