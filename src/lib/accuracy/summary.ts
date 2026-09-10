import type {
  AccuracyDto,
  AccuracySummaryDto,
  CalibrationSeriesDto,
} from "@/lib/dto/accuracy";
import { REPORTING_FLOOR } from "./config";

/**
 * The plain-language summary (Pitch 10). A PURE interpretation of the metrics
 * already computed for the advanced panels — it introduces no new metric and
 * reads nothing the panels do not. The rule the pitch insists on: a thin sample
 * reads as "not enough evidence yet", never as a bad score.
 */

/** Mean |predicted − observed| over the populated, above-floor buckets. */
const CALIBRATED_TOLERANCE = 0.05;

const BRIER_GLOSS = "lower is better; 0.25 is a coin flip, 0 is perfect";

/** The record the summary speaks about: the first live series, else the first. */
function activeSeries(
  calibration: CalibrationSeriesDto[],
): CalibrationSeriesDto | null {
  if (calibration.length === 0) return null;
  return calibration.find((s) => s.kind === "live") ?? calibration[0];
}

/** Mean absolute calibration gap over buckets that carry a real measurement. */
function calibrationGap(series: CalibrationSeriesDto): number | null {
  const usable = series.buckets.filter(
    (b) => !b.belowFloor && b.predictedMean !== null && b.observedRate !== null,
  );
  if (usable.length === 0) return null;
  const total = usable.reduce(
    (sum, b) => sum + Math.abs((b.predictedMean ?? 0) - (b.observedRate ?? 0)),
    0,
  );
  return total / usable.length;
}

export function summarizeAccuracy(
  dto: Pick<AccuracyDto, "calibration" | "errorPanel" | "market">,
): AccuracySummaryDto {
  const series = activeSeries(dto.calibration);
  const thresholdObservations = series?.thresholdObservations ?? 0;
  const projectionCount = series?.projectionCount ?? 0;
  const brier = series?.brier ?? null;

  const enough = thresholdObservations >= REPORTING_FLOOR && brier !== null;
  const gap = series ? calibrationGap(series) : null;

  let verdict: AccuracySummaryDto["verdict"];
  let calibrationVerdict: string;
  if (!enough || gap === null) {
    verdict = "provisional";
    calibrationVerdict =
      thresholdObservations === 0
        ? "Not enough graded predictions yet to judge calibration."
        : `Not enough evidence yet — ${thresholdObservations.toLocaleString()} observations, below the ${REPORTING_FLOOR.toLocaleString()} needed to judge calibration.`;
  } else if (gap <= CALIBRATED_TOLERANCE) {
    verdict = "calibrated";
    calibrationVerdict =
      "Calibrated within tolerance — when Sightline says 60%, it happens about 60% of the time.";
  } else {
    verdict = "drifting";
    calibrationVerdict = `Predicted and observed rates diverge by ${(gap * 100).toFixed(1)} points on average — probabilities are not tracking outcomes.`;
  }

  // Baseline comparison: mean MAE, model vs the two naive baselines.
  let baselineVerdict: string;
  const ep = dto.errorPanel;
  if (!ep || ep.model === null) {
    baselineVerdict =
      "No graded projections with both baselines for this scope.";
  } else {
    const betterThanSeason =
      ep.seasonAverage !== null && ep.model.mae < ep.seasonAverage.mae;
    const betterThanTrailing =
      ep.trailingFive !== null && ep.model.mae < ep.trailingFive.mae;
    if (betterThanSeason && betterThanTrailing) {
      baselineVerdict =
        "Better than both baselines (season-average and trailing-five) on mean error.";
    } else if (betterThanSeason || betterThanTrailing) {
      baselineVerdict =
        "Better than one baseline but not the other on mean error.";
    } else {
      baselineVerdict =
        "Not beating the naive baselines on mean error for this scope.";
    }
  }

  // Market comparison: insufficient sample is not-enough-evidence, never poor.
  let marketVerdict: string;
  const m = dto.market;
  if (m.state === "insufficient") {
    marketVerdict = `Insufficient comparable observations — ${m.graded} of ${m.required} graded. Not a poor score, just not enough evidence yet.`;
  } else if (m.modelBrier < m.marketBrier) {
    marketVerdict = `Better calibrated than the market on the comparable set (Brier ${m.modelBrier.toFixed(3)} vs ${m.marketBrier.toFixed(3)}).`;
  } else if (m.modelBrier > m.marketBrier) {
    marketVerdict = `Behind the market on the comparable set (Brier ${m.modelBrier.toFixed(3)} vs ${m.marketBrier.toFixed(3)}).`;
  } else {
    marketVerdict = `Even with the market on the comparable set (Brier ${m.modelBrier.toFixed(3)}).`;
  }

  return {
    verdict,
    thresholdObservations,
    projectionCount,
    brier,
    brierGloss: BRIER_GLOSS,
    calibrationVerdict,
    baselineVerdict,
    marketVerdict,
    // A per-week trend is not among the aggregates this surface computes, so it
    // is reported honestly as insufficient rather than guessed from one number.
    trend: "insufficient",
  };
}
