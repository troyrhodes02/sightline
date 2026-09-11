/**
 * Thresholds for the model-comparison evidence layer (spec §Core concepts, D1).
 *
 * Deliberate constants, not environment variables — a leader that flipped state
 * between environments because a floor differed would be worse than no leader.
 *
 * The two permanent model versions the comparison splits by. Simulation first,
 * mirroring the accuracy surface's `COMPARE_VERSIONS`, so the two surfaces name
 * the same records in the same order.
 */
export const SIMULATION_VERSION = "simulation-mc-0.1.0";
export const BASELINE_VERSION = "baseline-zil-0.1.0";

/**
 * The Simulation-Engine promotion bar (D1). A leader is only declared when the
 * absolute Brier margin reaches this; below it the models are `too_close_to_call`.
 */
export const LEADER_BRIER_MARGIN = 0.01;

/**
 * Sample floors per record (D1). Live evidence accrues one NFL week at a time,
 * so a 500-observation live minimum would be unreachable in-season; the 50-obs
 * live floor is the spec's flagged-for-review default. Backtest evidence is
 * abundant, so it keeps the harness's 500 floor.
 */
export const LIVE_SAMPLE_FLOOR = 50;
export const BACKTEST_SAMPLE_FLOOR = 500;

/**
 * Evidence-strength bands (design doc). A sample below its record's floor is
 * always `limited`; `moderate` and `strong` are multiples of the floor so the
 * band scales with the record rather than being a second hard-coded number.
 */
export const EVIDENCE_MODERATE_MULTIPLE = 2;
export const EVIDENCE_STRONG_MULTIPLE = 4;
