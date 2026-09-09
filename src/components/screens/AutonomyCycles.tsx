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
  BoundByLabel,
  formatCents,
  formatKickoff,
  formatTimestamp,
} from "@/components/autonomy/primitives";
import type {
  CandidateDto,
  CycleDetailDto,
  CycleRowDto,
} from "@/lib/dto/autonomy";

/**
 * Every autonomous evaluation, including the ones that did nothing.
 *
 * Three narrowing counts tell the cycle's story: how many contracts were
 * considered, how many received a stake, how many produced a position. A
 * skipped or failed cycle is a ROW with a reason, not an error state — the
 * screen only fails when the read fails.
 */
export function AutonomyCycles({
  rows,
  seasons,
  weeks,
  season,
  week,
}: {
  rows: CycleRowDto[];
  seasons: number[];
  weeks: number[];
  season: number | null;
  week: number | null;
}) {
  return (
    <Stack spacing={3}>
      <AutonomyHeading title="Cycles" />
      <AutonomyTabs current="/autonomy/cycles" />

      {seasons.length > 0 ? (
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <ScopeLinks
            label="Season"
            values={seasons}
            current={season}
            hrefFor={(value) => `/autonomy/cycles?season=${value}`}
          />
          <ScopeLinks
            label="Week"
            values={weeks}
            current={week}
            hrefFor={(value) =>
              `/autonomy/cycles?season=${season}&week=${value}`
            }
          />
        </Stack>
      ) : null}

      <Paper>
        {rows.length === 0 ? (
          <EmptyState
            title="No autonomous cycles recorded."
            detail="Cycles begin once autonomy is enabled and a game window opens."
            action={{ label: "Configuration", href: "/autonomy/configuration" }}
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
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
              {rows.map((row) => (
                <TableRow
                  key={row.cycleId}
                  hover
                  component={Link}
                  href={`/autonomy/cycles/${row.cycleId}`}
                  sx={{
                    textDecoration: "none",
                    color: "inherit",
                    display: "table-row",
                  }}
                >
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
    </Stack>
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

function Count({ value }: { value: number | null }) {
  return (
    <TableCell align="right">
      <NumericText size="sm" muted={value === null}>
        {value === null ? "—" : value}
      </NumericText>
    </TableCell>
  );
}

function ScopeLinks({
  label,
  values,
  current,
  hrefFor,
}: {
  label: string;
  values: number[];
  current: number | null;
  hrefFor: (value: number) => string;
}) {
  if (values.length === 0) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      {values.map((value) => (
        <Box
          key={value}
          component={Link}
          href={hrefFor(value)}
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
            borderColor: value === current ? "primary.main" : "border.strong",
            color: value === current ? "primary.main" : "text.secondary",
          }}
        >
          {value}
        </Box>
      ))}
    </Stack>
  );
}

/**
 * The audit trail: candidate by candidate, why each got what it got.
 *
 * The candidate card is shared verbatim with Dry Run — only the verb tense
 * differs. Any divergence between what Dry Run shows and what a cycle does
 * would defeat the point of Dry Run, and the divergence would be invisible.
 */
export function AutonomyCycleDetail({ detail }: { detail: CycleDetailDto }) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          component={Link}
          href="/autonomy/cycles"
          variant="body2"
          sx={{ color: "primary.main", textDecoration: "none" }}
        >
          ← Cycles
        </Typography>
      </Box>
      <AutonomyHeading
        title={`${detail.gameLabel} · ${formatKickoff(detail.kickoffAt)}`}
      />

      <Paper sx={{ px: 2, py: 1.5 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "132px 1fr" },
            gap: 0.5,
            columnGap: 2,
          }}
        >
          <Field label="Run">
            started {formatTimestamp(detail.startedAt)} · outcome{" "}
            {OUTCOME_COPY[detail.outcome]}
            {detail.reason ? ` (${detail.reason})` : ""}
          </Field>
          <Field label="Risk mode">
            {detail.mode.mode} — {detail.mode.kellyFraction.toFixed(2)}× Kelly,
            game {detail.mode.perGameCapPct}%, slate{" "}
            {detail.mode.perSlateCapPct}%
          </Field>
          <Field label="Recalibration">
            {detail.recalibration
              ? `v${detail.recalibration.version} — ${detail.recalibration.backtestLabel}, blended with ${detail.recalibration.liveObservationCount} live observations`
              : "none active — no candidate could be sized"}
          </Field>
          <Field label="Bankroll">
            {formatCents(detail.bankrollAtEvaluationCents)} at evaluation ·
            slate capacity {formatCents(detail.slateCapacityCents)} · game
            capacity {formatCents(detail.gameCapacityCents)}
          </Field>
        </Box>
      </Paper>

      <Paper>
        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            alignItems: "baseline",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h2">Candidates</Typography>
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            ranked by Kelly edge, descending
          </Typography>
        </Stack>
        {detail.candidates.length === 0 ? (
          <EmptyState
            title="No resolvable contracts in this game window."
            detail="A cycle with nothing to evaluate is a completed cycle, not a failure."
          />
        ) : (
          <Stack
            divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}
          >
            {detail.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.contractId}
                candidate={candidate}
                tense="past"
              />
            ))}
          </Stack>
        )}
      </Paper>

      {detail.allocationTrace.length > 0 ? (
        <Paper sx={{ px: 2, py: 1.5 }}>
          <Typography variant="h2" sx={{ mb: 1 }}>
            Reallocation
          </Typography>
          <Stack spacing={0.5}>
            {detail.allocationTrace.map((line, index) => (
              <Typography
                key={index}
                variant="body2"
                sx={{ color: "text.secondary" }}
              >
                {line}
              </Typography>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography variant="body2">{children}</Typography>
    </>
  );
}

const VERDICT_COPY: Record<
  CandidateDto["verdict"],
  { past: string; conditional: string; tone: string }
> = {
  filled: { past: "FILLED", conditional: "WOULD FILL", tone: "primary.main" },
  partial: {
    past: "PARTIAL",
    conditional: "WOULD PARTIAL",
    tone: "warning.main",
  },
  no_stake: {
    past: "NO STAKE",
    conditional: "NO STAKE",
    tone: "text.secondary",
  },
  refused: { past: "REFUSED", conditional: "REFUSED", tone: "warning.main" },
  blocked: {
    past: "BLOCKED",
    conditional: "WOULD BE BLOCKED",
    tone: "error.main",
  },
};

/**
 * One candidate's full economics.
 *
 * Intended and filled are two numbers, always both — a complete fill is the two
 * agreeing, not the absence of one. `bound by:` is always present, including
 * `none`.
 */
export function CandidateCard({
  candidate,
  tense,
}: {
  candidate: CandidateDto;
  tense: "past" | "conditional";
}) {
  const verdict = VERDICT_COPY[candidate.verdict];

  return (
    <Box sx={{ px: 2, py: 1.75 }}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: "baseline", mb: 0.5, flexWrap: "wrap" }}
      >
        <NumericText size="sm" sx={{ color: "text.muted", width: 16 }}>
          {candidate.rank + 1}
        </NumericText>
        <Typography variant="body1">
          {candidate.playerName}
          {candidate.statType && candidate.threshold !== null
            ? ` · ${candidate.statType.replace(/_/g, " ")} ≥ ${candidate.threshold}`
            : ""}
        </Typography>
        <Typography
          variant="label"
          sx={{ color: verdict.tone, ml: "auto", flexShrink: 0 }}
        >
          {tense === "past" ? verdict.past : verdict.conditional}
        </Typography>
      </Stack>

      <Stack spacing={0.25} sx={{ pl: { sm: 3.25 } }}>
        {candidate.rawProbability !== null ? (
          <NumericText size="sm" sx={{ color: "text.secondary" }}>
            raw{" "}
            <Box component="span" sx={{ color: "primary.main" }}>
              {(candidate.rawProbability * 100).toFixed(1)}%
            </Box>
            {candidate.correctedProbability !== null ? (
              <>
                {" → corrected "}
                <Box component="span" sx={{ color: "primary.main" }}>
                  {(candidate.correctedProbability * 100).toFixed(1)}%
                </Box>
              </>
            ) : null}
            {candidate.confidence
              ? ` · confidence ${candidate.confidence}`
              : ""}
            {candidate.kellyFractionApplied !== null
              ? ` (×${candidate.kellyFractionApplied.toFixed(2)})`
              : ""}
          </NumericText>
        ) : null}

        {candidate.askCents !== null ? (
          <NumericText size="sm" sx={{ color: "text.secondary" }}>
            {candidate.side} ask{" "}
            <Box component="span" sx={{ color: "market.main" }}>
              {candidate.askCents}¢
            </Box>
            {candidate.netPriceCents !== null ? (
              <>
                {" · net price "}
                <Box component="span" sx={{ color: "market.main" }}>
                  {candidate.netPriceCents}¢
                </Box>
              </>
            ) : null}
            {candidate.topOfBookSizeContracts !== null ? (
              <>
                {" · top-of-book "}
                <Box component="span" sx={{ color: "market.main" }}>
                  {candidate.topOfBookSizeContracts} contracts
                </Box>
              </>
            ) : null}
          </NumericText>
        ) : null}

        {candidate.kellyEdge !== null ? (
          <NumericText size="sm" sx={{ color: "text.secondary" }}>
            Kelly edge{" "}
            <Box
              component="span"
              sx={{
                color: candidate.kellyEdge >= 0 ? "primary.main" : "error.main",
              }}
            >
              {candidate.kellyEdge >= 0 ? "+" : "−"}
              {Math.abs(candidate.kellyEdge).toFixed(3)}
            </Box>
            {candidate.intendedContracts > 0
              ? ` · intended ${formatCents(candidate.intendedStakeCents)} (${candidate.intendedContracts} contracts)`
              : ""}
          </NumericText>
        ) : null}

        <BoundByLabel
          boundBy={candidate.boundBy}
          detail={candidate.boundByDetail}
        />

        {candidate.filledContracts > 0 ? (
          <NumericText size="sm">
            filled {candidate.filledContracts} @ {candidate.askCents}¢ +{" "}
            {formatCents(candidate.filledFeeCents)} fee ={" "}
            {formatCents(candidate.filledCostCents + candidate.filledFeeCents)}
          </NumericText>
        ) : null}

        {candidate.unfilledStakeCents > 0 &&
        candidate.verdict !== "no_stake" ? (
          <NumericText size="sm" sx={{ color: "warning.main" }}>
            unfilled {formatCents(candidate.unfilledStakeCents)} returned to
            available bankroll
          </NumericText>
        ) : null}
      </Stack>
    </Box>
  );
}
