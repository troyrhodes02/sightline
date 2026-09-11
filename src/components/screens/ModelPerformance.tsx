// A client component: it composes the level tabs, the facet toggle, and link
// rows that pass `component={Link}` to MUI. Everything it receives is a
// serializable DTO; it holds only URL-derived view state and never a data
// fetch or a mutation (D12 — nothing here writes production config).
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { EmptyState } from "@/components/primitives/EmptyState";
import { NumericText } from "@/components/primitives/NumericText";
import { Accuracy } from "@/components/screens/Accuracy";
import { LeaderChip } from "@/components/model-performance/LeaderChip";
import { EvidenceChip } from "@/components/model-performance/EvidenceChip";
import { RecommendationCard } from "@/components/model-performance/RecommendationCard";
import { PortfolioScorecard } from "@/components/model-performance/PortfolioScorecard";
import { ComparisonBarChart } from "@/components/model-performance/ComparisonBarChart";
import type { AccuracyDto } from "@/lib/dto/accuracy";
import type {
  EvidenceRecord,
  ModelComparisonDto,
  ModelPerformanceDto,
  ModelPerformanceLevel,
  StatLeaderRowDto,
} from "@/lib/dto/model-eval";
import type { StatType } from "../../../generated/prisma/enums";

/**
 * The Model Performance surface — the admin's model-quality experience (PME-4,
 * D9). Three levels sit under one heading, deep-linked via `?level=`:
 *
 *  - **Summary** — the overall leader, the plain-language recommendation, the
 *    per-stat leaders, the three paper scorecards, readiness, and exclusions.
 *  - **Breakdown** — per-facet comparisons, every rate with its n and never a
 *    probability-bucket rate below the 30-observation floor (D8).
 *  - **Advanced** — the preserved statistical Accuracy surface (D9), including
 *    the two-model reliability overlay.
 *
 * Nothing on any level writes production config (D12): the recommendation is
 * prose plus a navigational link, and the scorecards are read-only mirrors.
 */

const LEVEL_LABEL: Record<ModelPerformanceLevel, string> = {
  summary: "Summary",
  breakdown: "Breakdown",
  advanced: "Advanced",
};

const STAT_LABEL: Record<StatType, string> = {
  passing_yards: "Passing yards",
  rushing_yards: "Rushing yards",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
  rushing_tds: "Rushing TDs",
  receiving_tds: "Receiving TDs",
};

/** The D8 display floor for a probability-bucket rate — 30 observations. */
const DISPLAY_FLOOR = 30;

export function ModelPerformance({
  level,
  modelPerformance,
  accuracy,
}: {
  level: ModelPerformanceLevel;
  modelPerformance: ModelPerformanceDto;
  accuracy: AccuracyDto;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Stack spacing={2}>
      <Typography variant="h1">Model Performance</Typography>

      <Tabs
        value={level}
        onChange={(_, next: ModelPerformanceLevel) =>
          router.replace(`${pathname}?level=${next}`)
        }
        aria-label="Model Performance level"
      >
        {(["summary", "breakdown", "advanced"] as const).map((value) => (
          <Tab key={value} value={value} label={LEVEL_LABEL[value]} />
        ))}
      </Tabs>

      {level === "summary" ? (
        <SummaryLevel data={modelPerformance} />
      ) : level === "breakdown" ? (
        <BreakdownLevel data={modelPerformance} />
      ) : (
        // The preserved Accuracy surface, nested under the level tabs (D9).
        <Accuracy accuracy={accuracy} hideHeading />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryLevel({ data }: { data: ModelPerformanceDto }) {
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2,
          alignItems: "start",
        }}
      >
        <OverallLeaderCard
          live={data.overallLive}
          backtest={data.overallBacktest}
        />
        <RecommendationCard recommendation={data.recommendation} />
      </Box>

      <StatLeaderTable rows={data.statLeadersLive} record="live" />

      <Scorecards data={data} />

      <ReadinessStrip readiness={data.readiness} />
    </Stack>
  );
}

function OverallLeaderCard({
  live,
  backtest,
}: {
  live: ModelComparisonDto;
  backtest: ModelComparisonDto;
}) {
  // The card carries both records so the reader sees which is thin (D15). The
  // headline chip reflects the live record; the backtest is shown beneath it,
  // never blended into one figure.
  const notEnough =
    live.leader === "not_enough_evidence" &&
    backtest.leader === "not_enough_evidence";

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Overall leader · contract-like population
        </Typography>

        {notEnough ? (
          <EmptyState
            title="Not enough evidence to compare the engines yet."
            detail={`Live grading is still accumulating — ${live.liveObservations.toLocaleString(
              "en-US",
            )} live obs · ${backtest.backtestObservations.toLocaleString(
              "en-US",
            )} backtest obs. Both engines keep running; no model change is warranted.`}
          />
        ) : (
          <>
            <RecordLeaderRow label="Live" comparison={live} />
            <RecordLeaderRow label="Backtest" comparison={backtest} />
          </>
        )}
      </Stack>
    </Paper>
  );
}

function RecordLeaderRow({
  label,
  comparison,
}: {
  label: string;
  comparison: ModelComparisonDto;
}) {
  const sample =
    comparison.record === "live"
      ? comparison.liveObservations
      : comparison.backtestObservations;
  return (
    <Stack spacing={0.5}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "baseline", flexWrap: "wrap" }}
        useFlexGap
      >
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {label}:
        </Typography>
        <LeaderChip
          leader={comparison.leader}
          brierMargin={comparison.brierMargin}
          liveObservations={comparison.liveObservations}
          backtestObservations={comparison.backtestObservations}
          simulationModelVersion={comparison.simulationModelVersion}
          baselineModelVersion={comparison.baselineModelVersion}
        />
      </Stack>
      <NumericText size="sm" muted>
        Brier{" "}
        {comparison.baselineBrier === null
          ? "—"
          : comparison.baselineBrier.toFixed(3)}{" "}
        vs{" "}
        {comparison.simulationBrier === null
          ? "—"
          : comparison.simulationBrier.toFixed(3)}{" "}
        · {sample.toLocaleString("en-US")} obs
      </NumericText>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Best model by stat type
// ---------------------------------------------------------------------------

function StatLeaderTable({
  rows,
  record,
}: {
  rows: StatLeaderRowDto[];
  record: EvidenceRecord;
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Best model by stat type
        </Typography>
        <Table size="small" aria-label="Best model by stat type">
          <TableHead>
            <TableRow>
              <TableCell>stat</TableCell>
              <TableCell>leader</TableCell>
              <TableCell align="right">margin</TableCell>
              <TableCell align="right">evidence</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <StatLeaderRow key={row.statType} row={row} record={record} />
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Leaders shown under the {record === "live" ? "Live" : "Backtest"}{" "}
          record — each stat judged in its own population, never pooled (D15).
        </Typography>
      </Stack>
    </Paper>
  );
}

function StatLeaderRow({
  row,
  record,
}: {
  row: StatLeaderRowDto;
  record: EvidenceRecord;
}) {
  const floor = record === "live" ? 50 : 500;
  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2">{STAT_LABEL[row.statType]}</Typography>
      </TableCell>
      <TableCell>
        <LeaderChip
          leader={row.leader}
          brierMargin={row.brierMargin}
          liveObservations={record === "live" ? row.sampleSize : 0}
          backtestObservations={record === "backtest" ? row.sampleSize : 0}
          simulationModelVersion="simulation-mc-0.1.0"
          baselineModelVersion="baseline-zil-0.1.0"
          showEvidence={false}
        />
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm" component="span">
          {row.brierMargin === null ? "—" : row.brierMargin.toFixed(3)}
        </NumericText>
      </TableCell>
      <TableCell align="right">
        <Box sx={{ display: "inline-flex", justifyContent: "flex-end" }}>
          <EvidenceChip
            strength={row.evidence}
            sampleSize={row.sampleSize}
            belowFloor={row.belowFloor}
            floor={floor}
          />
        </Box>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Portfolio scorecards
// ---------------------------------------------------------------------------

function Scorecards({ data }: { data: ModelPerformanceDto }) {
  if (data.scorecards === null) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <EmptyState
          title="No paper campaign yet."
          detail="The three paper portfolios begin accruing once a paper evaluation campaign is running."
          action={{
            label: "Open Paper Bot settings",
            href: "/autonomy/settings",
          }}
        />
      </Paper>
    );
  }

  return (
    <Stack spacing={1}>
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        Paper portfolios
      </Typography>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        useFlexGap
        sx={{ alignItems: "stretch" }}
      >
        {data.scorecards.map((card) => (
          <PortfolioScorecard key={card.portfolio} scorecard={card} />
        ))}
      </Stack>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Portfolios may evaluate different opportunity sets — counts shown above.
        Paper P&amp;L never grades model quality; the two are reported apart
        (D17).
      </Typography>
    </Stack>
  );
}

function ReadinessStrip({
  readiness,
}: {
  readiness: ModelPerformanceDto["readiness"];
}) {
  if (readiness === null) return null;
  const label =
    readiness.state === "paper_evidence_building"
      ? "paper evidence building"
      : "not ready";
  return (
    <Stack
      direction="row"
      spacing={1.5}
      useFlexGap
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <Typography variant="label" sx={{ color: "text.secondary" }}>
        Real-money readiness
      </Typography>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        sx={{ color: "warning.main", borderColor: "warning.main" }}
      />
      <NumericText size="sm" muted>
        {readiness.weeksComplete} of {readiness.weeksRequired} weeks
      </NumericText>
      {/* Deferred (review-audit): links to Paper Bot Performance, where the
          criterion detail sits behind a collapsed expander — a follow-up should
          pass state (e.g. #readiness) so the destination opens it expanded. */}
      <MuiLink component={Link} href="/autonomy" variant="body2">
        View readiness detail →
      </MuiLink>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

type Facet =
  "stat" | "confidence" | "probability" | "live_vs_backtest" | "financial";

const FACET_LABEL: Record<Facet, string> = {
  stat: "Stat type",
  confidence: "Confidence",
  probability: "Probability range",
  live_vs_backtest: "Live vs backtest",
  financial: "Financial",
};

function BreakdownLevel({ data }: { data: ModelPerformanceDto }) {
  const router = useRouter();
  const pathname = usePathname();
  const [facet, setFacet] = useFacet();

  const setParam = (next: Facet) => {
    setFacet(next);
    router.replace(`${pathname}?level=breakdown&facet=${next}`);
  };

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={facet}
        aria-label="Breakdown facet"
        onChange={(_, next: Facet | null) => {
          if (next) setParam(next);
        }}
        sx={{ flexWrap: "wrap" }}
      >
        {(Object.keys(FACET_LABEL) as Facet[]).map((value) => (
          <ToggleButton key={value} value={value}>
            {FACET_LABEL[value]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {facet === "stat" ? (
        <StatFacet data={data} />
      ) : facet === "live_vs_backtest" ? (
        <LiveVsBacktestFacet data={data} />
      ) : facet === "financial" ? (
        <FinancialFacet data={data} />
      ) : (
        // Confidence and probability-range require per-bucket comparison
        // segments the consumed evidence read does not expose; rather than
        // fabricate a rate (D8) or conflate the two axes (D16), the surface
        // states the honest insufficient-evidence position and points to the
        // Advanced calibration buckets, which carry the per-bucket detail.
        <InsufficientFacet facet={facet} />
      )}
    </Stack>
  );
}

/** Reads the initial facet from the URL once on mount (client-only). */
function useFacet(): [Facet, (next: Facet) => void] {
  const initial = ((): Facet => {
    if (typeof window === "undefined") return "stat";
    const raw = new URLSearchParams(window.location.search).get("facet");
    return raw && raw in FACET_LABEL ? (raw as Facet) : "stat";
  })();
  const [facet, setFacet] = useState<Facet>(initial);
  return [facet, setFacet];
}

function StatFacet({ data }: { data: ModelPerformanceDto }) {
  const rows = data.statLeadersLive;
  if (rows.every((row) => row.sampleSize === 0)) {
    return (
      <FacetEmpty message="Not enough graded predictions in any stat for the live record yet." />
    );
  }
  return (
    <Stack spacing={2}>
      {rows.map((row) => (
        <Paper key={row.statType} sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ justifyContent: "space-between", alignItems: "center" }}
            >
              <Typography variant="label">
                {STAT_LABEL[row.statType]}
              </Typography>
              <LeaderChip
                leader={row.leader}
                brierMargin={row.brierMargin}
                liveObservations={row.sampleSize}
                backtestObservations={0}
                simulationModelVersion="simulation-mc-0.1.0"
                baselineModelVersion="baseline-zil-0.1.0"
                showEvidence={false}
              />
            </Stack>
            <EvidenceChip
              strength={row.evidence}
              sampleSize={row.sampleSize}
              belowFloor={row.belowFloor}
              floor={50}
            />
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function LiveVsBacktestFacet({ data }: { data: ModelPerformanceDto }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        gap: 2,
      }}
    >
      <RecordColumn label="Live" comparison={data.overallLive} />
      <RecordColumn label="Backtest" comparison={data.overallBacktest} />
    </Box>
  );
}

function RecordColumn({
  label,
  comparison,
}: {
  label: string;
  comparison: ModelComparisonDto;
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label">{label}</Typography>
        <LeaderChip
          leader={comparison.leader}
          brierMargin={comparison.brierMargin}
          liveObservations={comparison.liveObservations}
          backtestObservations={comparison.backtestObservations}
          simulationModelVersion={comparison.simulationModelVersion}
          baselineModelVersion={comparison.baselineModelVersion}
        />
        <ComparisonBarChart
          baselineBrier={comparison.baselineBrier}
          simulationBrier={comparison.simulationBrier}
        />
      </Stack>
    </Paper>
  );
}

function FinancialFacet({ data }: { data: ModelPerformanceDto }) {
  return <Scorecards data={data} />;
}

function InsufficientFacet({ facet }: { facet: Facet }) {
  const axis =
    facet === "confidence"
      ? "Confidence is the model's own (low / medium / high), never a percentage (D16)."
      : "Probability ranges are percentages, never a confidence word (D16).";
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          {FACET_LABEL[facet]}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Not enough evidence to break {FACET_LABEL[facet].toLowerCase()} rates
          out here yet — no bucket renders below {DISPLAY_FLOOR} observations
          (D8). {axis}
        </Typography>
        <MuiLink
          component={Link}
          href="/model-performance?level=advanced"
          variant="body2"
        >
          See calibration buckets in Advanced →
        </MuiLink>
      </Stack>
    </Paper>
  );
}

function FacetEmpty({ message }: { message: string }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {message}
      </Typography>
    </Paper>
  );
}
