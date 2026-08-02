"""``sightline-ingest grade`` — grade projections against the official line.

The Python half of Outcome Scoring (spec §10): after games complete, every
evaluative-unit projection is graded against the official corrected stat line
and the results land in ``projection_grades`` / ``threshold_grades``. The
TypeScript side grades everything contract-facing (settlement, recommendations,
decisions) at read time; this job never touches any of that. The settlement
table is on this package's import blocklist along with the price tables — the
only market table this module may read is ``contracts``, and only its identity
and threshold columns.

Boundaries this module is built around:

* **Official values come from ``GradingCorpus``** — the current corrected line,
  no cutoff. That is the sanctioned grading exception, and it stays a grading
  exception: the corrected value is a grading target here, never a feature.
* **Baseline errors are as-of quantities.** The season-average and
  trailing-five baselines are recomputed through ``AsOfCorpus`` bound to the
  projection's OWN ``information_cutoff``, using the same feature-assembly and
  baseline code the backtest uses. A baseline that could see the graded game —
  or any stat published after the cutoff — would flatter the model in exactly
  the direction nobody questions.
* **Idempotence is comparison, not error handling.** Every grade row carries
  the ``player_game_stats.version`` it graded against; the upsert writes only
  when the intended row differs on ``(status, graded_stat_version)``. A stat
  correction bumps the version and the same upsert path regrades.
* **One transaction per game.** A game's grade rows commit together or not at
  all, so an interrupted cycle leaves whole games visibly ungraded rather than
  a half-graded game presented as complete.
* **Grading writes grades and nothing else.** Projections, drivers, snapshots,
  and decisions are never touched — regrading is an update to derived data.
* **Prisma owns the schema.** This module writes rows; it never migrates.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sightline_model.baselines import compute as compute_baselines
from sightline_model.constants import is_contract_like
from sightline_model.distributions import (
    KIND_NB,
    KIND_ZIL,
    DistributionError,
    NegativeBinomial,
    ZeroInflatedLogNormal,
)
from sightline_model.features import assemble
from sightline_model.stat_types import REGISTRY
from sightline_model.stat_types import spec as stat_spec

from .asof import AsOfCorpus
from .config import ConfigError, ingest_dsn
from .db import ConnectionFactory, connection_factory
from .errors import sanitize_error
from .grading import GradingCorpus
from .pipeline import (
    CATEGORY_GRADING,
    GAME_FAILED,
    GAME_SUCCEEDED,
    RUN_FAILED,
    RUN_SUCCEEDED,
    finish_pipeline_run,
    manual_invocation_id,
    record_pipeline_run_game,
    start_pipeline_run,
)

_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # RFC 4122 URL namespace

# ProjectionGradeStatus enum values (mirror the Prisma enum; strings by contract).
STATUS_GRADED = "graded"
STATUS_MISSING_OFFICIAL = "missing_official_result"
STATUS_NEVER_COMPLETED = "game_never_completed"
STATUS_UNSUPPORTED = "unsupported_stat_type"

# ThresholdSource enum values.
SOURCE_POLICY = "policy"
SOURCE_MARKET = "market"

# The evaluative unit (spec §5): per (player, game, stat, model version), the
# projection with the latest information_cutoff at or before kickoff, ties
# broken by latest computed_at (id as a total-order tiebreak). Earlier
# intra-week revisions are superseded working states and are never graded.
#
# A unit needs (re)grading when:
#   * it has no grade row at all;
#   * its game is cancelled and the grade is not yet terminal;
#   * its grade's graded_stat_version trails the current stat version — which
#     covers both a correction (version bumped) and a stat line arriving where
#     there was none (NULL vs version). A missing_official_result row stores
#     the version it saw (or NULL when no row existed), so "nothing changed"
#     games are structurally unselected rather than re-written.
_ELIGIBLE_SQL = """
    with eligible as (
        select distinct on (p.player_id, p.game_id, p.stat_type, p.model_version)
               p.id, p.player_id, p.game_id, p.stat_type, p.model_version,
               p.distribution_kind, p.params, p.pmf,
               p.projected_value, p.projected_median, p.information_cutoff,
               g.status as game_status, g.kickoff_at, g.season
          from projections p
          join games g on g.id = p.game_id
         where g.status in ('completed', 'cancelled')
           and p.information_cutoff <= g.kickoff_at
         order by p.player_id, p.game_id, p.stat_type, p.model_version,
                  p.information_cutoff desc, p.computed_at desc, p.id
    )
    select e.*
      from eligible e
      left join projection_grades pg on pg.projection_id = e.id
      left join player_game_stats s
             on s.player_id = e.player_id and s.game_id = e.game_id
     where pg.id is null
        or (e.game_status = 'cancelled' and pg.status <> 'game_never_completed')
        or (e.game_status = 'completed'
            and pg.status in ('graded', 'missing_official_result')
            and pg.graded_stat_version is distinct from s.version)
     order by e.kickoff_at, e.game_id, e.player_id, e.stat_type, e.model_version
"""

# Market thresholds for one game: identity and threshold columns only. Reading
# ``contracts`` is permitted (it says WHICH thresholds the market asked about);
# the price and snapshot tables are not, and the settlement table is not — the
# import-graph sweep enforces all three structurally.
_MARKET_THRESHOLDS_SQL = """
    select c.id, c.player_id, c.stat_type, c.threshold
      from contracts c
     where c.game_id = %(gid)s
       and c.player_id is not null
       and c.stat_type is not null
       and c.threshold is not null
       and c.resolution_status in ('resolved', 'manual_override')
     order by c.player_id, c.stat_type, c.threshold, c.first_seen_at, c.id
"""

_UPSERT_GRADE_SQL = """
    insert into projection_grades (
        id, projection_id, status, official_value, graded_stat_version,
        abs_error_mean, abs_error_median, season_avg_abs_error,
        trailing_five_abs_error, contract_like, graded_at, created_at, updated_at
    ) values (
        %(id)s, %(projection_id)s, %(status)s::"ProjectionGradeStatus",
        %(official_value)s, %(graded_stat_version)s, %(abs_error_mean)s,
        %(abs_error_median)s, %(season_avg_abs_error)s,
        %(trailing_five_abs_error)s, %(contract_like)s, %(graded_at)s,
        now(), now()
    )
    on conflict (projection_id) do update
       set status = excluded.status,
           official_value = excluded.official_value,
           graded_stat_version = excluded.graded_stat_version,
           abs_error_mean = excluded.abs_error_mean,
           abs_error_median = excluded.abs_error_median,
           season_avg_abs_error = excluded.season_avg_abs_error,
           trailing_five_abs_error = excluded.trailing_five_abs_error,
           contract_like = excluded.contract_like,
           graded_at = excluded.graded_at,
           updated_at = now()
     where (projection_grades.status, projection_grades.graded_stat_version)
           is distinct from
           (excluded.status, excluded.graded_stat_version)
"""

_UPSERT_THRESHOLD_SQL = """
    insert into threshold_grades (
        id, projection_id, contract_id, threshold_source, threshold,
        stated_probability, outcome, contract_like, graded_stat_version,
        graded_at, created_at, updated_at
    ) values (
        %(id)s, %(projection_id)s, %(contract_id)s,
        %(threshold_source)s::"ThresholdSource", %(threshold)s,
        %(stated_probability)s, %(outcome)s, %(contract_like)s,
        %(graded_stat_version)s, %(graded_at)s, now(), now()
    )
    on conflict (projection_id, threshold_source, threshold) do update
       set contract_id = excluded.contract_id,
           stated_probability = excluded.stated_probability,
           outcome = excluded.outcome,
           contract_like = excluded.contract_like,
           graded_stat_version = excluded.graded_stat_version,
           graded_at = excluded.graded_at,
           updated_at = now()
     where threshold_grades.graded_stat_version
           is distinct from excluded.graded_stat_version
"""


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _grade_row_id(projection_id: str) -> str:
    """Deterministic id: re-grades collide with their own prior row by design."""
    return str(uuid.uuid5(_NS, f"sightline:projection-grade:{projection_id}"))


def _threshold_row_id(projection_id: str, source: str, threshold: float) -> str:
    return str(
        uuid.uuid5(
            _NS,
            f"sightline:threshold-grade:{projection_id}:{source}:{threshold:.1f}",
        )
    )


@dataclass(frozen=True)
class ThresholdRow:
    source: str
    threshold: float
    stated_probability: float
    outcome: bool
    contract_id: str | None = None


@dataclass(frozen=True)
class GradeIntent:
    """The grade one evaluative unit should carry, before any write."""

    projection_id: str
    status: str
    contract_like: bool
    official_value: float | None = None
    graded_stat_version: int | None = None
    abs_error_mean: float | None = None
    abs_error_median: float | None = None
    season_avg_abs_error: float | None = None
    trailing_five_abs_error: float | None = None
    thresholds: tuple[ThresholdRow, ...] = field(default_factory=tuple)


def _rehydrate(kind: str, params: dict, pmf: list | None):
    """Rebuild the stored distribution exactly — the same objects the engine
    fitted, so a stated probability here is the number the model stated."""
    if kind == KIND_ZIL:
        return ZeroInflatedLogNormal(**params)
    if kind == KIND_NB:
        return NegativeBinomial(**params, cap=max(len(pmf or []) - 1, 1))
    raise DistributionError(f"unknown distribution kind {kind!r}")


def _prob_above(distribution, threshold: float) -> float:
    """``P(X > t)``. The same strict-inequality nudge the harness uses for
    percentiles: a no-op for the .5-valued grids (where > and >= coincide) and
    correct for an integer threshold, where ``prob_at_least`` would answer >=.
    """
    return distribution.prob_at_least(threshold + 1e-9)


def _intended_grade(
    connect: ConnectionFactory,
    unit: dict,
    *,
    stats_by_player: dict[str, dict],
    market_thresholds: dict[tuple[str, str], list[tuple[str, float]]],
    corpus_cache: dict[datetime, AsOfCorpus],
    seasons_by_game: dict[str, int],
) -> GradeIntent:
    """Compute what this unit's grade should be. Pure derivation, no writes."""
    stat_type = unit["stat_type"]
    projected_value = float(unit["projected_value"])
    contract_like = is_contract_like(stat_type, projected_value)

    if unit["game_status"] == "cancelled":
        # Terminal: the game will never produce a line to grade against.
        return GradeIntent(
            projection_id=unit["id"],
            status=STATUS_NEVER_COMPLETED,
            contract_like=contract_like,
        )

    if stat_type not in REGISTRY:
        # Defensive: the StatType enum and the registry are kept in lockstep,
        # but a projection for an unregistered stat must land as an explicit
        # status, never as a crash or a fabricated zero.
        return GradeIntent(
            projection_id=unit["id"],
            status=STATUS_UNSUPPORTED,
            contract_like=contract_like,
        )

    stat = stat_spec(stat_type)
    stat_row = stats_by_player.get(unit["player_id"])
    stat_version = int(stat_row["version"]) if stat_row is not None else None
    raw_official = stat_row.get(stat.column) if stat_row is not None else None
    if raw_official is None:
        # No stat row, or the stat's own column is null. A null column is
        # absence, never zero (the feature layer's rule, mirrored here), and
        # the harness excludes the same rows as REASON_NO_ACTUAL. The version
        # seen (or None) is recorded so the revisit is comparison-driven: the
        # unit is reselected only when a line (or a corrected version) arrives.
        return GradeIntent(
            projection_id=unit["id"],
            status=STATUS_MISSING_OFFICIAL,
            contract_like=contract_like,
            graded_stat_version=stat_version,
        )

    official = float(raw_official)
    projected_median = float(unit["projected_median"])

    # Baselines at the projection's own cutoff, through the as-of layer — the
    # exact reads the backtest uses. Never a hand-rolled aggregate: an
    # aggregate over the current stats table would include the graded game
    # itself and every later one.
    cutoff = unit["information_cutoff"]
    corpus = corpus_cache.get(cutoff)
    if corpus is None:
        corpus = AsOfCorpus(connect, cutoff)
        corpus_cache[cutoff] = corpus
    history = assemble(
        corpus,
        player_id=unit["player_id"],
        game_id=unit["game_id"],
        spec=stat,
        seasons_by_game=seasons_by_game,
    )
    baselines = compute_baselines(history, season=unit["season"])

    distribution = _rehydrate(
        unit["distribution_kind"], unit["params"], unit["pmf"]
    )

    thresholds: list[ThresholdRow] = []
    for threshold in stat.thresholds:
        thresholds.append(
            ThresholdRow(
                source=SOURCE_POLICY,
                threshold=float(threshold),
                stated_probability=_prob_above(distribution, float(threshold)),
                outcome=official > float(threshold),
            )
        )
    seen_market: set[float] = set()
    for contract_id, threshold in market_thresholds.get(
        (unit["player_id"], stat_type), []
    ):
        if threshold in seen_market:
            # Kalshi can relist a market at the same threshold under a new
            # ticker; one observation per threshold, first listing wins.
            continue
        seen_market.add(threshold)
        thresholds.append(
            ThresholdRow(
                source=SOURCE_MARKET,
                threshold=threshold,
                stated_probability=_prob_above(distribution, threshold),
                outcome=official > threshold,
                contract_id=contract_id,
            )
        )

    return GradeIntent(
        projection_id=unit["id"],
        status=STATUS_GRADED,
        contract_like=contract_like,
        official_value=official,
        graded_stat_version=stat_version,
        abs_error_mean=abs(official - projected_value),
        abs_error_median=abs(official - projected_median),
        season_avg_abs_error=(
            abs(official - baselines.season_average)
            if baselines.season_average is not None
            else None
        ),
        trailing_five_abs_error=(
            abs(official - baselines.trailing_five)
            if baselines.trailing_five is not None
            else None
        ),
        thresholds=tuple(thresholds),
    )


def _write_intent(cur, intent: GradeIntent, *, graded_at: datetime) -> None:
    cur.execute(
        _UPSERT_GRADE_SQL,
        {
            "id": _grade_row_id(intent.projection_id),
            "projection_id": intent.projection_id,
            "status": intent.status,
            "official_value": intent.official_value,
            "graded_stat_version": intent.graded_stat_version,
            "abs_error_mean": intent.abs_error_mean,
            "abs_error_median": intent.abs_error_median,
            "season_avg_abs_error": intent.season_avg_abs_error,
            "trailing_five_abs_error": intent.trailing_five_abs_error,
            "contract_like": intent.contract_like,
            "graded_at": graded_at,
        },
    )
    for row in intent.thresholds:
        cur.execute(
            _UPSERT_THRESHOLD_SQL,
            {
                "id": _threshold_row_id(
                    intent.projection_id, row.source, row.threshold
                ),
                "projection_id": intent.projection_id,
                "contract_id": row.contract_id,
                "threshold_source": row.source,
                "threshold": round(row.threshold, 1),
                "stated_probability": round(row.stated_probability, 5),
                "outcome": row.outcome,
                "contract_like": intent.contract_like,
                "graded_stat_version": intent.graded_stat_version,
                "graded_at": graded_at,
            },
        )


def _eligible_units(connect: ConnectionFactory) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_ELIGIBLE_SQL)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _seasons_by_game(connect: ConnectionFactory) -> dict[str, int]:
    # The FULL corpus map: baseline history reaches back across seasons.
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select id, season from games")
        return {row[0]: row[1] for row in cur.fetchall()}


def _market_thresholds_for_game(
    connect: ConnectionFactory, game_id: str
) -> dict[tuple[str, str], list[tuple[str, float]]]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_MARKET_THRESHOLDS_SQL, {"gid": game_id})
        rows = cur.fetchall()
    grouped: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for contract_id, player_id, stat_type, threshold in rows:
        grouped.setdefault((player_id, stat_type), []).append(
            (contract_id, round(float(threshold), 1))
        )
    return grouped


def _stats_by_player(grading: GradingCorpus, game_id: str) -> dict[str, dict]:
    frame = grading.final_player_stats_for_game(game_id=game_id)
    if frame.height == 0:
        return {}
    return {row["player_id"]: row for row in frame.to_dicts()}


def _grade_all(
    connect: ConnectionFactory,
    run_id: str,
    units: list[dict],
    *,
    now: datetime,
) -> tuple[int, int]:
    """Grade every selected game, one transaction per game.

    Returns ``(graded_units, failed_games)``.
    """
    grading = GradingCorpus(connect)
    seasons_by_game = _seasons_by_game(connect)
    corpus_cache: dict[datetime, AsOfCorpus] = {}

    by_game: dict[str, list[dict]] = {}
    for unit in units:  # already ordered by kickoff, then game id
        by_game.setdefault(unit["game_id"], []).append(unit)

    graded_total = 0
    failed_games = 0
    with connect() as conn:
        for game_id, game_units in by_game.items():
            try:
                with conn.transaction():
                    game_graded = 0
                    cancelled = game_units[0]["game_status"] == "cancelled"
                    stats = (
                        {} if cancelled else _stats_by_player(grading, game_id)
                    )
                    market = (
                        {}
                        if cancelled
                        else _market_thresholds_for_game(connect, game_id)
                    )
                    with conn.cursor() as cur:
                        for unit in game_units:
                            intent = _intended_grade(
                                connect,
                                unit,
                                stats_by_player=stats,
                                market_thresholds=market,
                                corpus_cache=corpus_cache,
                                seasons_by_game=seasons_by_game,
                            )
                            _write_intent(cur, intent, graded_at=now)
                            game_graded += 1
            except Exception as exc:  # noqa: BLE001 - recorded per game; cycle continues
                failed_games += 1
                message = sanitize_error(exc)
                print(f"grade: game {game_id} failed: {message}", file=sys.stderr)
                record_pipeline_run_game(
                    connect, run_id, game_id, status=GAME_FAILED,
                    error_message=message,
                )
                continue

            graded_total += game_graded
            record_pipeline_run_game(
                connect, run_id, game_id, status=GAME_SUCCEEDED,
                projected_count=game_graded,
            )
    return graded_total, failed_games


def run_grade(
    connect: ConnectionFactory,
    *,
    invocation_id: str | None = None,
    now: datetime | None = None,
) -> str:
    """Run one grading cycle. Returns the recorded terminal status, or
    ``"not_expected"`` / ``"duplicate"`` when no run row was written.

    Dormancy mirrors the ingest cycle: when no completed or cancelled game has
    an evaluative-unit projection awaiting a grade (or a regrade), the tick is
    not a pipeline event and nothing is recorded — the selection is derived
    from stored state, never from the calendar.
    """
    now = now or _now()
    invocation_id = invocation_id or manual_invocation_id()

    units = _eligible_units(connect)
    if not units:
        print(
            "grade: no completed game has projections awaiting grades; "
            "not expected, nothing recorded"
        )
        return "not_expected"

    run_id = start_pipeline_run(
        connect, category=CATEGORY_GRADING, invocation_id=invocation_id
    )
    if run_id is None:
        print(f"grade: invocation {invocation_id!r} already recorded; skipping")
        return "duplicate"

    try:
        graded, failed_games = _grade_all(connect, run_id, units, now=now)
    except BaseException as exc:
        # Fatal error outside any per-game boundary: the cycle is failed,
        # never left presenting as (or later completing into) a success. The
        # recording attempt must never mask the original traceback.
        try:
            finish_pipeline_run(
                connect, run_id, status=RUN_FAILED,
                error_message=sanitize_error(exc),
            )
        except Exception as record_exc:  # noqa: BLE001 - deliberate: original error wins
            print(
                f"grade: could not record fatal failure: {sanitize_error(record_exc)}",
                file=sys.stderr,
            )
        raise

    status = RUN_FAILED if failed_games else RUN_SUCCEEDED
    finish_pipeline_run(
        connect,
        run_id,
        status=status,
        error_message=f"{failed_games} game(s) failed" if failed_games else None,
    )
    print(
        f"grade: {status} ({graded} projection(s) graded across "
        f"{len({u['game_id'] for u in units})} game(s), {failed_games} failed)"
    )
    return status


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sightline-ingest grade",
        description="Grade completed games' projections against the official line.",
    )
    parser.add_argument(
        "--invocation-id",
        default=None,
        help="scheduler invocation id (e.g. the GitHub Actions run id); "
        "defaults to a unique manual id",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="override the ingest DSN (defaults to INGEST_DATABASE_URL / DIRECT_URL)",
    )
    args = parser.parse_args(argv)

    try:
        dsn = args.database_url or ingest_dsn()
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    connect = connection_factory(dsn)
    status = run_grade(connect, invocation_id=args.invocation_id)
    return 1 if status == RUN_FAILED else 0
