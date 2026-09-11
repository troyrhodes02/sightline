// A client component because it composes the interactive scope bar, the
// Recharts wrapper, and link rows that pass `component={Link}` to MUI (same
// reasoning as ContractDetail). Everything it receives is a serializable DTO.
"use client";

import { useId } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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
import { AccuracyScopeBar } from "@/components/accuracy/AccuracyScopeBar";
import { OverridesEntry } from "@/components/accuracy/OverridesEntry";
import { ReliabilityCurve } from "@/components/accuracy/ReliabilityCurve";
import { SampleSizePair } from "@/components/accuracy/SampleSizePair";
import { formatEt } from "@/components/slate/values";
import type {
  AccuracyDto,
  AccuracyScope,
  CalibrationSeriesDto,
} from "@/lib/dto/accuracy";

/**
 * The accuracy surface — the screen that answers the product's founding
 * question about itself. Every figure renders with its record, population,
 * and both denominators; unlike metrics never share a frame; small samples
 * look small; and the private layer (the overrides entry) exists only when
 * the server payload carries it.
 */

const EXCLUSION_LABELS: Record<string, string> = {
  missing_official_result: "no official result",
  unsupported_stat_type: "unsupported stat",
  game_never_completed: "game not completed",
  unresolved_identity: "unresolved player",
  contract_voided: "voided",
};

function signedPoints(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function scopeQuery(scope: AccuracyScope, record: AccuracyScope["record"]) {
  const params = new URLSearchParams({
    record,
    version: String(scope.modelVersion),
    population: scope.population,
    stat: String(scope.statType),
    season: String(scope.season),
  });
  params.set("level", "advanced");
  return `/model-performance?${params.toString()}`;
}

/**
 * The statistical evidence surface — the Advanced level of Model Performance
 * (PME-4/D9). Rendered inside the level tabs by the Model Performance screen; it
 * omits its own page heading (`hideHeading`) when nested so the surface has one
 * title, not two. Standalone rendering (tests, fixtures) keeps the heading.
 */
export function Accuracy({
  accuracy,
  hideHeading = false,
}: {
  accuracy: AccuracyDto;
  hideHeading?: boolean;
}) {
  // When nested as the Advanced level, every scope change must keep the level
  // param so the surface does not fall back to Summary.
  const extraParams = hideHeading ? { level: "advanced" } : undefined;
  return (
    <Stack spacing={2}>
      {hideHeading ? null : <Typography variant="h1">Accuracy</Typography>}

      <AccuracyScopeBar
        scope={accuracy.scope}
        availableVersions={accuracy.availableVersions}
        availableSeasons={accuracy.availableSeasons}
        extraParams={extraParams}
      />

      <FreshnessLine accuracy={accuracy} />

      {accuracy.summary ? <SummaryPanel summary={accuracy.summary} /> : null}

      {/* The admin's doorway to the private overrides surface stays visible —
          it is navigation, not advanced calibration, and never sits behind the
          disclosure below. */}
      {accuracy.overridesEntry ? (
        <OverridesEntry decisionCount={accuracy.overridesEntry.decisionCount} />
      ) : null}

      <Accordion disableGutters sx={{ bgcolor: "transparent" }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="advanced-analysis"
          id="advanced-analysis-header"
        >
          <Typography variant="h2">Advanced analysis</Typography>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", ml: 1.5, alignSelf: "center" }}
          >
            reliability curve, calibration bins, error vs baselines, market
            comparison
          </Typography>
        </AccordionSummary>
        <AccordionDetails id="advanced-analysis">
          <Stack spacing={2}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "3fr 2fr" },
                gap: 2,
                alignItems: "start",
              }}
            >
              <CalibrationPanel accuracy={accuracy} />
              <Stack spacing={2}>
                <ErrorPanel accuracy={accuracy} />
                <MarketPanel accuracy={accuracy} />
              </Stack>
            </Box>
            <ExclusionsLine exclusions={accuracy.exclusions} />
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Plain-language summary (Pitch 10) — interprets the metrics below it.
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<
  "calibrated" | "provisional" | "drifting",
  { text: string; color: "success" | "warning" }
> = {
  calibrated: { text: "Calibrated within tolerance", color: "success" },
  provisional: { text: "Not enough evidence yet", color: "warning" },
  drifting: { text: "Probabilities drifting", color: "warning" },
};

const TREND_TEXT: Record<
  "improving" | "stable" | "deteriorating" | "insufficient",
  string
> = {
  improving: "Improving over recent graded weeks",
  stable: "Stable over recent graded weeks",
  deteriorating: "Deteriorating over recent graded weeks",
  insufficient: "Not enough graded weeks yet to establish a trend",
};

function SummaryPanel({
  summary,
}: {
  summary: NonNullable<AccuracyDto["summary"]>;
}) {
  const verdict = VERDICT_LABEL[summary.verdict];
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="h2">How is the active model doing?</Typography>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Chip
            label={verdict.text}
            color={verdict.color}
            variant="outlined"
            size="small"
          />
          <SampleSizePair
            observations={summary.thresholdObservations}
            projections={summary.projectionCount}
          />
        </Stack>

        <SummaryRow question="Are the probabilities calibrated?">
          {summary.calibrationVerdict}
        </SummaryRow>
        <SummaryRow question="Brier score">
          {summary.brier === null ? (
            "Not enough graded predictions to compute."
          ) : (
            <>
              <NumericText>{summary.brier.toFixed(3)}</NumericText>
              <Typography
                component="span"
                variant="caption"
                sx={{ color: "text.secondary", ml: 1 }}
              >
                {summary.brierGloss}
              </Typography>
            </>
          )}
        </SummaryRow>
        <SummaryRow question="Is it beating the baseline?">
          {summary.baselineVerdict}
        </SummaryRow>
        <SummaryRow question="How does it compare with the market?">
          {summary.marketVerdict}
        </SummaryRow>
        <SummaryRow question="Is performance improving?">
          {TREND_TEXT[summary.trend]}
        </SummaryRow>
      </Stack>
    </Paper>
  );
}

function SummaryRow({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 0.25, sm: 1.5 }}
      sx={{ alignItems: { sm: "baseline" } }}
    >
      <Typography
        variant="label"
        sx={{ color: "text.secondary", minWidth: 210 }}
      >
        {question}
      </Typography>
      <Typography variant="body2" component="div">
        {children}
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

function FreshnessLine({ accuracy }: { accuracy: AccuracyDto }) {
  const graded = accuracy.gradedThroughWeek
    ? `Graded through Wk ${accuracy.gradedThroughWeek.week} ${accuracy.gradedThroughWeek.season}`
    : "Nothing graded yet";
  const cycle = accuracy.lastGradingCycleAt
    ? `last grading cycle ${formatEt(accuracy.lastGradingCycleAt)}`
    : "no grading cycle has completed yet";
  return (
    <Typography variant="caption" sx={{ color: "text.secondary" }}>
      <NumericText size="sm" muted component="span">
        {graded} · {cycle}
      </NumericText>
      {accuracy.gradingDelayed ? (
        <Box component="span" sx={{ color: "warning.main" }}>
          {" "}
          — results may trail recent games
        </Box>
      ) : null}
    </Typography>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

const SIMULATION_VERSION = "simulation-mc-0.1.0";

/** Whether a series is the dashed reference model in a model-vs-model overlay. */
function isReferenceModel(
  series: CalibrationSeriesDto,
  scope: AccuracyScope,
): boolean {
  return (
    scope.record === "compare" &&
    series.kind === "live" &&
    series.modelVersion !== SIMULATION_VERSION
  );
}

/** A stable React key per series — two live series (compare) must not collide. */
function seriesKey(series: CalibrationSeriesDto): string {
  return `${series.kind}-${series.modelVersion ?? "none"}`;
}

function CalibrationPanel({ accuracy }: { accuracy: AccuracyDto }) {
  const bucketTableId = useId();
  const { scope } = accuracy;
  const series = accuracy.calibration;
  const backtestExpected = scope.record === "backtest";
  const backtest = series.find((entry) => entry.kind === "backtest") ?? null;
  const populated = series.filter((entry) => entry.thresholdObservations > 0);

  const backtestMissingNote =
    backtestExpected && !backtest
      ? scope.statType !== "all" ||
        scope.season !== "all" ||
        scope.population === "market_linked"
        ? "The backtest record stores pooled populations only — set Stat and Season to All, and Population to Contract-like or All projections, to view it."
        : "No completed backtest run is stored."
      : null;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Calibration
        </Typography>

        {populated.length === 0 ? (
          <>
            <EmptyState
              title="No graded predictions for this scope."
              detail={
                accuracy.gradedThroughWeek
                  ? `Graded data exists through Wk ${accuracy.gradedThroughWeek.week} ${accuracy.gradedThroughWeek.season} — nothing matches this scope. 0 obs · 0 projections.`
                  : "Live grading has not produced results yet. 0 obs · 0 projections."
              }
              action={
                scope.record === "live"
                  ? {
                      label: "View backtest record",
                      href: scopeQuery(scope, "backtest"),
                    }
                  : undefined
              }
            />
            {backtestMissingNote ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {backtestMissingNote}
              </Typography>
            ) : null}
          </>
        ) : (
          <>
            {series.map((entry) => (
              <SeriesHeadline
                key={seriesKey(entry)}
                series={entry}
                named={series.length > 1}
                scope={scope}
              />
            ))}
            {backtestMissingNote ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {backtestMissingNote}
              </Typography>
            ) : null}
            <ReliabilityCurve
              series={populated.map((entry) => ({
                kind: entry.kind,
                modelVersion: entry.modelVersion,
                label: entry.label,
                buckets: entry.buckets,
                reference: isReferenceModel(entry, scope),
              }))}
              ariaSummaryId={bucketTableId}
            />
            <Box id={bucketTableId}>
              {populated.map((entry) => (
                <BucketTable key={seriesKey(entry)} series={entry} />
              ))}
            </Box>
          </>
        )}
      </Stack>
    </Paper>
  );
}

const MODEL_NAMES: Record<string, string> = {
  "simulation-mc-0.1.0": "Simulation Engine",
  "baseline-zil-0.1.0": "Baseline",
};

/** The headline prefix — the model name in compare, otherwise the record. */
function headlinePrefix(
  series: CalibrationSeriesDto,
  scope: AccuracyScope,
): string {
  if (scope.record === "compare" && series.modelVersion) {
    return MODEL_NAMES[series.modelVersion] ?? "Model";
  }
  if (series.modelVersion === "lifetime") return "Sightline lifetime";
  return series.kind === "live" ? "Live" : "Backtest";
}

function SeriesHeadline({
  series,
  named,
  scope,
}: {
  series: CalibrationSeriesDto;
  named: boolean;
  scope: AccuracyScope;
}) {
  const color = series.kind === "live" ? "primary.main" : "text.secondary";
  const lifetime = series.modelVersion === "lifetime";
  const showPrefix = named || lifetime;
  return (
    <Stack spacing={0.25}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "baseline", flexWrap: "wrap" }}
      >
        <NumericText size={named ? "md" : "lg"} sx={{ color }}>
          {showPrefix ? `${headlinePrefix(series, scope)} · ` : ""}
          Brier {series.brier === null ? "—" : series.brier.toFixed(3)}
        </NumericText>
        <SampleSizePair
          observations={series.thresholdObservations}
          projections={series.projectionCount}
        />
      </Stack>
      {lifetime ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Combined across Baseline and Simulation Engine — spans model versions.
        </Typography>
      ) : null}
      {series.kind === "backtest" ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {series.label}
        </Typography>
      ) : null}
      {series.eraDisclosure ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {series.eraDisclosure}
        </Typography>
      ) : null}
    </Stack>
  );
}

/**
 * The chart's text equivalent — always rendered, never collapsed. One row per
 * fixed bucket; empty buckets show em dashes rather than vanishing, because
 * the axes are the record's shape.
 */
function BucketTable({ series }: { series: CalibrationSeriesDto }) {
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {series.label}
      </Typography>
      <Table size="small" aria-label={`Calibration buckets — ${series.kind}`}>
        <TableHead>
          <TableRow>
            <TableCell>bucket</TableCell>
            <TableCell align="right">predicted</TableCell>
            <TableCell align="right">observed</TableCell>
            <TableCell align="right">obs</TableCell>
            <TableCell align="right">proj</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {series.buckets.map((bucket) => (
            <TableRow key={bucket.binIndex}>
              <TableCell>
                <NumericText size="sm" component="span">
                  {Math.round(bucket.binLow * 100)}–
                  {Math.round(bucket.binHigh * 100)}%
                </NumericText>
              </TableCell>
              <TableCell align="right">
                <NumericText size="sm" component="span">
                  {percent(bucket.predictedMean)}
                </NumericText>
              </TableCell>
              <TableCell align="right">
                <NumericText size="sm" component="span">
                  {percent(bucket.observedRate)}
                </NumericText>
              </TableCell>
              <TableCell align="right">
                <NumericText size="sm" component="span">
                  {bucket.thresholdObservations.toLocaleString("en-US")}
                </NumericText>
              </TableCell>
              <TableCell align="right">
                <NumericText size="sm" component="span">
                  {bucket.projectionCount.toLocaleString("en-US")}
                </NumericText>
              </TableCell>
              <TableCell>
                {bucket.belowFloor && bucket.thresholdObservations > 0 ? (
                  <Typography
                    variant="caption"
                    sx={{ color: "warning.main", whiteSpace: "nowrap" }}
                  >
                    below floor
                  </Typography>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Error vs baselines
// ---------------------------------------------------------------------------

function ErrorPanel({ accuracy }: { accuracy: AccuracyDto }) {
  const panel = accuracy.errorPanel;
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Error vs baselines
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          point estimate (mean) · MAE and RMSE in stat units
        </Typography>
        {panel === null ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No graded projections with both baselines for this scope.
          </Typography>
        ) : (
          <>
            <Table size="small" aria-label="Error against baselines">
              <TableHead>
                <TableRow>
                  <TableCell>series</TableCell>
                  <TableCell align="right">MAE</TableCell>
                  <TableCell align="right">RMSE</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <ErrorRow
                  label="model"
                  values={panel.model}
                  color="primary.main"
                />
                <ErrorRow label="season average" values={panel.seasonAverage} />
                <ErrorRow label="trailing five" values={panel.trailingFive} />
              </TableBody>
            </Table>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              <NumericText size="sm" muted component="span">
                {panel.projectionCount.toLocaleString("en-US")} projections
                {panel.medianMae !== null
                  ? ` · median MAE ${panel.medianMae.toFixed(1)}`
                  : ""}
              </NumericText>{" "}
              — median shown for visibility; baselines are mean-based
            </Typography>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function ErrorRow({
  label,
  values,
  color = "text.secondary",
}: {
  label: string;
  values: { mae: number; rmse: number } | null;
  color?: string;
}) {
  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2" sx={{ color }} component="span">
          {label}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm" component="span">
          {values === null ? "—" : values.mae.toFixed(1)}
        </NumericText>
      </TableCell>
      <TableCell align="right">
        <NumericText size="sm" component="span">
          {values === null ? "—" : values.rmse.toFixed(1)}
        </NumericText>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Against the market
// ---------------------------------------------------------------------------

function MarketPanel({ accuracy }: { accuracy: AccuracyDto }) {
  const market = accuracy.market;
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="label" sx={{ color: "text.secondary" }}>
          Against the market
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          market-linked population — the only population with a market to
          compare against
        </Typography>

        {market.state === "insufficient" ? (
          <Stack spacing={1}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Chip
                size="small"
                variant="outlined"
                label="insufficient sample"
                sx={{ color: "warning.main", borderColor: "warning.main" }}
              />
              <NumericText size="sm" muted component="span">
                {market.graded} of {market.required} graded observations
              </NumericText>
            </Stack>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              The edge figure renders once {market.required} market-linked
              observations are graded. The count accumulates here until then.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={0.5}>
            <MarketRow label="Brier, model">
              <NumericText size="md" sx={{ color: "primary.main" }}>
                {market.modelBrier.toFixed(3)}
              </NumericText>
            </MarketRow>
            <MarketRow label="Brier, market">
              <NumericText size="md" sx={{ color: "market.main" }}>
                {market.marketBrier.toFixed(3)}
              </NumericText>
            </MarketRow>
            <MarketRow label="mean edge at final snapshot">
              <NumericText size="md">
                {signedPoints(market.meanEdgePoints)} pts
              </NumericText>
            </MarketRow>
            <MarketRow label="95% interval">
              <NumericText size="md">
                {signedPoints(market.ci95Low)} … {signedPoints(market.ci95High)}
              </NumericText>
            </MarketRow>
            <MarketRow label="midpoint edge (secondary)">
              <NumericText size="md" muted>
                {market.midpointEdgePoints === null
                  ? "—"
                  : `${signedPoints(market.midpointEdgePoints)} pts`}
              </NumericText>
            </MarketRow>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              n ={" "}
              <SampleSizePair
                observations={market.thresholdObservations}
                projections={market.projectionCount}
              />{" "}
              · executable price on the recommended side
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

function MarketRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ justifyContent: "space-between", alignItems: "baseline" }}
    >
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

function ExclusionsLine({
  exclusions,
}: {
  exclusions: Array<{ reason: string; count: number }>;
}) {
  if (exclusions.length === 0) return null;
  const total = exclusions.reduce((sum, entry) => sum + entry.count, 0);
  const parts = exclusions
    .map(
      (entry) =>
        `${entry.count.toLocaleString("en-US")} ${EXCLUSION_LABELS[entry.reason] ?? entry.reason}`,
    )
    .join(" · ");
  return (
    <Typography variant="caption" sx={{ color: "text.secondary" }}>
      <NumericText size="sm" muted component="span">
        Excluded from this view: {total.toLocaleString("en-US")} unresolvable —{" "}
        {parts}
      </NumericText>{" "}
      · shown, never silently dropped
    </Typography>
  );
}
