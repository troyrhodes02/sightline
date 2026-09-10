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
from sightline_model.simulation.core import (
    prob_at_least_from_pmf,
    prob_at_least_from_quantiles,
)
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

# SourceClaimOutcome enum values (Adjustment Suggestions, SIG-77).
STATUS_SOURCE_CORRECT = "correct"
STATUS_SOURCE_INCORRECT = "incorrect"
STATUS_SOURCE_UNVERIFIABLE = "unverifiable"

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
               p.distribution_kind, p.params, p.pmf, p.quantiles,
               p.projected_value, p.projected_median, p.information_cutoff,
               g.status as game_status, g.kickoff_at, g.season
          from projections p
          join games g on g.id = p.game_id
         where g.status in ('completed', 'cancelled')
           and p.information_cutoff <= g.kickoff_at
           and p.provenance = 'base'
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

# Adjustment shadows (SIG-77). Unlike the base pass, EVERY shadow is graded —
# there is no "freshest per key" collapse, because each shadow is a distinct
# proposal (including superseded ones, which stay historical evidence). Base and
# adjusted are both graded against the outcome for every suggestion raised.
_SHADOW_ELIGIBLE_SQL = """
    select p.id, p.player_id, p.game_id, p.stat_type, p.model_version,
           p.distribution_kind, p.params, p.pmf, p.quantiles,
           p.projected_value, p.projected_median, p.information_cutoff,
           g.status as game_status, g.kickoff_at, g.season
      from projections p
      join games g on g.id = p.game_id
      left join projection_grades pg on pg.projection_id = p.id
      left join player_game_stats s
             on s.player_id = p.player_id and s.game_id = p.game_id
     where p.provenance = 'adjustment_shadow'
       -- Defence in depth (review audit): the engine never persists a shadow for
       -- a post-kickoff observation, but the base pass enforces this structurally
       -- and grading shadows must too — a shadow whose cutoff postdates kickoff
       -- must never be graded as a pre-game projection (temporal integrity).
       and p.information_cutoff <= g.kickoff_at
       and g.status in ('completed', 'cancelled')
       and (
            pg.id is null
         or (g.status = 'cancelled' and pg.status <> 'game_never_completed')
         or (g.status = 'completed'
             and pg.status in ('graded', 'missing_official_result')
             and pg.graded_stat_version is distinct from s.version)
       )
     order by g.kickoff_at, p.game_id, p.player_id, p.stat_type, p.id
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

# A regrade must REMOVE the threshold rows its new intent no longer claims,
# not merely overwrite the ones it still does. Every non-graded status
# (`game_never_completed`, `unsupported_stat_type`, `missing_official_result`)
# carries an empty threshold tuple, so a unit moving out of `graded` — a stat
# correction nulling the stat column, a game reclassified cancelled — would
# otherwise leave its old rows behind with a stale `outcome` and a stale
# `graded_stat_version`, and those stale observations keep feeding the live
# reliability curve and Brier score. The same gap orphans a threshold that
# simply stops being generated: a policy-version change, or a market threshold
# whose contract is no longer listed.
#
# An empty `keep` makes `id <> all('{}')` true for every row, so the
# no-thresholds case needs no separate statement.
_DELETE_SUPERSEDED_THRESHOLDS_SQL = """
    delete from threshold_grades
     where projection_id = %(projection_id)s
       and id <> all(%(keep)s)
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


class _EmpiricalDistribution:
    """A stored simulation/shadow distribution graded from its compact form.

    Simulation-engine and adjustment-shadow projections store an empirical
    quantile grid (continuous) or an explicit PMF (count) rather than the
    baseline's parametric ZIL/NB. Grading them means answering ``P(X >= t)`` from
    the SAME compact form the slate reads, via the closed-form helpers the
    golden-parity fixture pins — never a re-sample. This adapter exposes the same
    ``prob_at_least`` surface the parametric distributions do, so the grade path
    is one code path across both engines (Adjustment Suggestions, SIG-77).
    """

    def __init__(
        self, quantiles: dict[str, float] | None, pmf: list[float] | None
    ) -> None:
        self._quantiles = quantiles
        self._pmf = pmf

    def prob_at_least(self, threshold: float) -> float:
        if self._quantiles is not None:
            return prob_at_least_from_quantiles(self._quantiles, threshold)
        if self._pmf is not None:
            return prob_at_least_from_pmf(self._pmf, threshold)
        raise DistributionError(
            "empirical distribution has neither a quantile grid nor a PMF"
        )


def _rehydrate(kind: str, params: dict, pmf: list | None, quantiles: dict | None = None):
    """Rebuild the stored distribution exactly — the same objects the engine
    fitted (baseline) or the same compact form it stored (simulation/shadow), so
    a stated probability here is the number the model stated."""
    if kind == KIND_ZIL:
        return ZeroInflatedLogNormal(**params)
    if kind == KIND_NB:
        return NegativeBinomial(**params, cap=max(len(pmf or []) - 1, 1))
    if kind in ("empirical_quantiles", "empirical_pmf"):
        return _EmpiricalDistribution(quantiles=quantiles, pmf=pmf)
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
        unit["distribution_kind"], unit["params"], unit["pmf"], unit.get("quantiles")
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
    keep: list[str] = []
    for row in intent.thresholds:
        row_id = _threshold_row_id(intent.projection_id, row.source, row.threshold)
        keep.append(row_id)
        cur.execute(
            _UPSERT_THRESHOLD_SQL,
            {
                "id": row_id,
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

    # Inside the caller's per-game transaction: a grade row and its thresholds
    # commit as one, so a regrade is never visible half-applied.
    cur.execute(
        _DELETE_SUPERSEDED_THRESHOLDS_SQL,
        {"projection_id": intent.projection_id, "keep": keep},
    )


def _eligible_units(connect: ConnectionFactory) -> list[dict]:
    """Base projections needing (re)grading — the freshest per evaluative unit."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_ELIGIBLE_SQL)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _shadow_units(connect: ConnectionFactory) -> list[dict]:
    """Every adjustment-shadow projection needing (re)grading (SIG-77)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_SHADOW_ELIGIBLE_SQL)
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# --- Source-claim grading (SIG-77, decision 10) ----------------------------
#
# Was the source's factual claim correct? Graded against official recorded
# participation (snaps, or their absence) — the same official-statistics truth
# the model itself is graded against — NEVER against Kalshi settlement, so a
# voided contract or a settlement quirk can never corrupt a claim about whether a
# player actually played. This writes only the source-correctness columns on
# adjustment_source_events; it never touches a projection or a suggestion.

# Claim values that assert the player will SIT / will PLAY. A "questionable"
# claim asserts neither and is left ungraded (unverifiable-by-nature).
_CLAIM_EXPECTS_OUT = frozenset({"out", "doubtful", "ir", "pup"})
_CLAIM_EXPECTS_IN = frozenset({"active"})

_SNAP_CONTEXT_TYPES = (
    "snap_count_offense",
    "snap_count_defense",
    "snap_pct_offense",
    "snap_pct_defense",
    "snap_pct_st",
)

_UNGRADED_SOURCE_EVENTS_SQL = """
    select count(*) from adjustment_source_events e
      join games g on g.id = e.game_id
     where g.status = 'completed' and e.source_outcome is null
"""

_COMPLETED_SOURCE_EVENTS_SQL = """
    select e.id, e.subject_player_id, e.game_id, e.claim_value,
           e.source_outcome::text as source_outcome, e.graded_stat_version
      from adjustment_source_events e
      join games g on g.id = e.game_id
     where g.status = 'completed'
     order by g.kickoff_at, e.game_id
"""

_UPDATE_SOURCE_OUTCOME_SQL = """
    update adjustment_source_events
       set source_outcome = %(outcome)s::"SourceClaimOutcome",
           graded_stat_version = %(version)s,
           source_graded_at = %(graded_at)s,
           updated_at = now()
     where id = %(id)s
       and (source_outcome, graded_stat_version)
           is distinct from (%(outcome)s::"SourceClaimOutcome", %(version)s)
"""


def _ungraded_source_events_exist(connect: ConnectionFactory) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_UNGRADED_SOURCE_EVENTS_SQL)
        return int(cur.fetchone()[0]) > 0


def _game_participation(cur, game_id: str) -> tuple[bool, set[str]]:
    """(participation-ingested?, players who recorded a snap) for a game."""
    cur.execute(
        "select distinct player_id from player_game_context "
        "where game_id = %s and context_type = any(%s) "
        "and numeric_value is not null and numeric_value > 0",
        (game_id, list(_SNAP_CONTEXT_TYPES)),
    )
    played = {row[0] for row in cur.fetchall()}
    cur.execute(
        "select exists(select 1 from player_game_context "
        "where game_id = %s and context_type = any(%s))",
        (game_id, list(_SNAP_CONTEXT_TYPES)),
    )
    ingested = bool(cur.fetchone()[0])
    return ingested, played


def _subject_stat_version(cur, player_id: str, game_id: str) -> int | None:
    """The subject's stat-line version, or None when he has no row.

    None (not 0) for the absent-row case — the same choice the projection-grade
    path makes — so "no stat row" is distinguishable from a genuine version 0.
    Collapsing them (review audit) would let a later inserted version-0 row read
    as unchanged and skip the correction-driven re-grade.
    """
    cur.execute(
        "select version from player_game_stats where player_id = %s and game_id = %s",
        (player_id, game_id),
    )
    row = cur.fetchone()
    return int(row[0]) if row is not None else None


def _source_outcome(claim_value: str, *, ingested: bool, played: bool) -> str | None:
    """The graded correctness of one claim, or None when it is not gradable."""
    if not ingested:
        return STATUS_SOURCE_UNVERIFIABLE
    cv = claim_value.lower()
    if cv in _CLAIM_EXPECTS_OUT:
        return STATUS_SOURCE_CORRECT if not played else STATUS_SOURCE_INCORRECT
    if cv in _CLAIM_EXPECTS_IN:
        return STATUS_SOURCE_CORRECT if played else STATUS_SOURCE_INCORRECT
    return None  # e.g. "questionable" — asserts neither; left ungraded


def _grade_source_claims(connect: ConnectionFactory, *, now: datetime) -> int:
    """Grade every completed-game source claim against official participation.

    Idempotent: the update writes only when the outcome or version changed, so a
    re-run writes nothing and a stat/participation correction regrades. One
    transaction per game, so a partial pass never presents as complete.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(_COMPLETED_SOURCE_EVENTS_SQL)
        cols = [d.name for d in cur.description]
        events = [dict(zip(cols, row)) for row in cur.fetchall()]

    by_game: dict[str, list[dict]] = {}
    for e in events:
        by_game.setdefault(e["game_id"], []).append(e)

    graded = 0
    with connect() as conn:
        for game_id, game_events in by_game.items():
            with conn.transaction():
                with conn.cursor() as cur:
                    ingested, played = _game_participation(cur, game_id)
                    for e in game_events:
                        outcome = _source_outcome(
                            e["claim_value"],
                            ingested=ingested,
                            played=e["subject_player_id"] in played,
                        )
                        if outcome is None:
                            continue
                        # TODO(SIG-81): fetch stat versions once per game keyed by
                        # player rather than one query per event (N+1).
                        version = _subject_stat_version(
                            cur, e["subject_player_id"], game_id
                        )
                        cur.execute(
                            _UPDATE_SOURCE_OUTCOME_SQL,
                            {
                                "id": e["id"],
                                "outcome": outcome,
                                "version": version,
                                "graded_at": now,
                            },
                        )
                        graded += 1
    return graded


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
    record_games: bool = True,
) -> tuple[int, int]:
    """Grade every selected game, one transaction per game.

    Returns ``(graded_units, failed_games)``.

    ``record_games`` gates the per-game ``pipeline_run_game`` recording. Base
    projections run with it on; the shadow pass runs with it OFF and in its OWN
    per-game transactions (review audit) so a malformed shadow can never roll
    back — or overwrite the run-game row of — a game's committed base grades.
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
                if record_games:
                    record_pipeline_run_game(
                        connect, run_id, game_id, status=GAME_FAILED,
                        error_message=message,
                    )
                continue

            graded_total += game_graded
            if record_games:
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

    base_units = _eligible_units(connect)
    shadow_units = _shadow_units(connect)
    source_pending = _ungraded_source_events_exist(connect)
    if not base_units and not shadow_units and not source_pending:
        print(
            "grade: no completed game has projections or source claims awaiting "
            "grades; not expected, nothing recorded"
        )
        return "not_expected"

    run_id = start_pipeline_run(
        connect, category=CATEGORY_GRADING, invocation_id=invocation_id
    )
    if run_id is None:
        print(f"grade: invocation {invocation_id!r} already recorded; skipping")
        return "duplicate"

    try:
        # Base grades first, in per-game transactions that own the run-game row.
        graded, failed_games = _grade_all(connect, run_id, base_units, now=now)
        # Shadows in a SEPARATE pass (review audit): their own per-game
        # transactions, no run-game recording — a malformed shadow fails only
        # itself and never rolls back or overwrites a committed base grade.
        graded_s, failed_s = _grade_all(
            connect, run_id, shadow_units, now=now, record_games=False
        )
        graded += graded_s
        failed_games += failed_s
        # Source-claim grading (SIG-77): was the source right? Graded against
        # official participation, independently of the projection grades above.
        source_graded = _grade_source_claims(connect, now=now)
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
        f"{len({u['game_id'] for u in (*base_units, *shadow_units)})} game(s), "
        f"{failed_games} failed; "
        f"{source_graded} source claim(s) graded)"
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
