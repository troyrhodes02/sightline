/**
 * Expected operating windows for the scheduled pipeline (spec RD-Q5).
 *
 * **Product rules, not cron syntax**, collected in one module so the bounds
 * the health surface judges against are visible and adjustable without code
 * archaeology. The workflows' cron lines may drift; these are the promises
 * the interface holds them to.
 *
 * All values are deliberate constants rather than environment variables: a
 * bound that silently differs between environments would make the same run
 * history read healthy in one place and late in another.
 */

/** Ingest is `late` past this many hours since its last success (24h cadence + 2h scheduler allowance). */
export const INGEST_LATE_AFTER_HOURS = 26;

/**
 * Recompute is `late` past this many hours since its last success. Game-day
 * recompute lateness is NOT judged here — it surfaces per game through
 * staleness and the completeness detail (RD-Q5); the global signal tracks the
 * nightly cycle only.
 */
export const RECOMPUTE_LATE_AFTER_HOURS = 26;

/** Price refresh cadence during the game week, outside any kickoff window. */
export const PRICE_IN_WEEK_CADENCE_MINUTES = 60;

/** Price refresh cadence while a kickoff is upcoming (game day). */
export const PRICE_GAMEDAY_CADENCE_MINUTES = 15;

/** A price-refresh signal is `late` past this multiple of the active cadence. */
export const PRICE_LATE_CADENCE_MULTIPLIER = 2;

/** Game-day price cadence applies from each kickoff − this window until the kickoff. */
export const GAMEDAY_PRICE_WINDOW_HOURS = 6;

/**
 * A `running` row older than this is treated as `failed` (RD-25): a crashed
 * runner cannot mark its own row, so a timeout is the only honest way an
 * abandoned attempt becomes visible.
 */
export const RUN_TIMEOUT_MINUTES = 120;

/**
 * A category is `not_expected` when no scheduled game kicks off within this
 * many days — derived from the stored schedule, never from hardcoded season
 * dates (RD-Q5). In season there is always a game inside a week; the
 * offseason has none.
 */
export const SEASON_LOOKAHEAD_DAYS = 7;

/** GitHub disables scheduled workflows after this many days without a commit. */
export const KEEPALIVE_INTERVAL_DAYS = 60;

/**
 * The keepalive is flagged overdue this many days BEFORE the actual GitHub
 * cutoff, so a missed monthly action turns amber while there is still time to
 * act — not the morning the schedules die.
 */
export const KEEPALIVE_SAFETY_MARGIN_DAYS = 10;

/**
 * The ingest cycle's source registry, mirrored from the Python runtime
 * (`sightline_ingest/cycle.py`). Required sources feed identity, priors, and
 * staleness; weather has documented degraded fallbacks (RD-26).
 */
export const REQUIRED_INGEST_SOURCES: ReadonlyArray<string> = [
  "schedule",
  "pbp",
  "stats",
  "context",
];
export const OPTIONAL_INGEST_SOURCES: ReadonlyArray<string> = ["weather"];

/**
 * Final pre-kickoff snapshots are captured for contracts whose game kicks off
 * within this window (RD-19). Wide enough that the 15-minute price cron gets
 * ~3 attempts even under common scheduler delay; the first invocation inside
 * the window captures, so a wider window trades snapshot lateness for
 * missed-capture risk.
 */
export const FINAL_SNAPSHOT_WINDOW_MINUTES = 45;

/** Offseason banner copy — dormancy is a designed state, not a failure. */
export const OFFSEASON_DORMANT_COPY =
  "Offseason. Scheduled jobs resume with the season schedule.";
