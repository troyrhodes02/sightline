"""Reads and writes over ``backtest_runs`` / ``calibration_bins``.

SIG-13 ships the read half only: enough to prove the wiring end to end (DSN →
direct connection → query → sanitised output) before any modelling code lands.
The write half arrives with the harness (SIG-17) and the metrics layer (SIG-18).

These two tables are shared reference data — no ``user_id``, no per-user
partition, no RLS. A calibration curve is identical for every user, so
row-level isolation of one would be ceremony rather than security.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from sightline_ingest.db import ConnectionFactory

# Terminal-safe statuses. Anything other than `completed` is not a result, and
# every reader in this package is expected to say so rather than render the
# partial numbers as though they were final.
COMPLETED = "completed"

# stat_types is cast to text[] explicitly: psycopg does not know the StatType
# enum's OID, and an array of an unknown type comes back as the raw Postgres
# array literal ("{rushing_yards,receiving_yards}") rather than a list. The
# cast is cheaper and more obvious than registering a type adapter for a value
# this package only ever displays.
_LIST_COLUMNS = (
    "id, label, status, season_from, season_to, stat_types::text[] as stat_types, "
    "evaluation_window, model_version, code_version, code_dirty, comparison_count, "
    "projected_count, engine_config_digest, corpus_digest, started_at, finished_at"
)


@dataclass(frozen=True)
class RunSummary:
    """One row of ``sightline-backtest list``."""

    id: str
    label: str | None
    status: str
    season_from: int
    season_to: int
    stat_types: list[str]
    evaluation_window: str
    model_version: str
    code_version: str
    code_dirty: bool
    comparison_count: int
    projected_count: int
    engine_config_digest: str
    corpus_digest: str
    started_at: datetime
    finished_at: datetime | None

    @property
    def seasons(self) -> str:
        if self.season_from == self.season_to:
            return str(self.season_from)
        return f"{self.season_from}-{self.season_to}"

    @property
    def is_result(self) -> bool:
        """Whether this run may be read as a backtest result at all."""
        return self.status == COMPLETED


def list_runs(
    connect: ConnectionFactory,
    *,
    model_version: str | None = None,
    evaluation_window: str | None = None,
    limit: int | None = None,
) -> list[RunSummary]:
    """Stored runs, newest first.

    Ordered by ``started_at DESC, id DESC``: the id tiebreaker matters because
    two runs started in the same millisecond would otherwise order
    nondeterministically, and this package treats unordered result sets feeding
    output as a defect even when the values are identical.
    """
    where: list[str] = []
    params: dict[str, object] = {}
    if model_version is not None:
        where.append("model_version = %(model_version)s")
        params["model_version"] = model_version
    if evaluation_window is not None:
        where.append("evaluation_window = %(evaluation_window)s")
        params["evaluation_window"] = evaluation_window

    sql = f"select {_LIST_COLUMNS} from backtest_runs"
    if where:
        sql += " where " + " and ".join(where)
    sql += " order by started_at desc, id desc"
    if limit is not None:
        sql += " limit %(limit)s"
        params["limit"] = limit

    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [RunSummary(**dict(zip(cols, row))) for row in cur.fetchall()]


def holdout_model_versions(connect: ConnectionFactory) -> list[str]:
    """Distinct model versions that have been run against the holdout window.

    This list IS the selection-bias record. The holdout is meant to be run once
    per model version; a long list means the reported holdout performance has
    been selected against and should not be read as an untouched estimate.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select distinct model_version from backtest_runs "
            "where evaluation_window = 'holdout' order by model_version"
        )
        return [row[0] for row in cur.fetchall()]


# --- Writes (SIG-17) --------------------------------------------------------
#
# Ordering is normative. A run is inserted as `running` and only moves to
# `completed` after its artefacts are flushed, its manifest written, and its
# marker placed — with the digests present, because a CHECK constraint refuses
# a completed run without them. A run that finished without its reproducibility
# evidence cannot support the claim this pitch makes.

_INSERT_RUN = """
insert into backtest_runs (
    id, label, status, season_from, season_to, season_types, stat_types,
    evaluation_window, cutoff_policy, threshold_policy_version, grading_target,
    model_version, code_version, code_dirty, seed, rng_draws, engine_config,
    engine_config_digest, corpus_digest, artifact_path, started_at, updated_at
) values (
    gen_random_uuid(), %(label)s, 'running', %(season_from)s, %(season_to)s,
    %(season_types)s, %(stat_types)s::"StatType"[], %(window)s::"EvaluationWindow",
    %(cutoff_policy)s, %(threshold_policy)s, %(grading_target)s,
    %(model_version)s, %(code_version)s, %(code_dirty)s, %(seed)s, 0,
    %(engine_config)s, %(engine_config_digest)s, %(corpus_digest)s,
    %(artifact_path)s, %(started_at)s, %(started_at)s
)
returning id
"""


def insert_run(
    connect: ConnectionFactory,
    *,
    config,
    model_version: str,
    code_version: str,
    code_dirty: bool,
    engine_config: dict,
    engine_config_digest: str,
    corpus_digest: str,
    cutoff_policy: str,
    threshold_policy_version: str,
    grading_target: str,
    artifact_path: str,
    started_at: datetime,
) -> str:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            _INSERT_RUN,
            {
                "label": config.label,
                "season_from": config.season_from,
                "season_to": config.season_to,
                "season_types": list(config.season_types),
                "stat_types": list(config.stat_types),
                "window": config.evaluation_window,
                "cutoff_policy": cutoff_policy,
                "threshold_policy": threshold_policy_version,
                "grading_target": grading_target,
                "model_version": model_version,
                "code_version": code_version,
                "code_dirty": code_dirty,
                "seed": config.seed,
                "engine_config": json.dumps(engine_config, sort_keys=True),
                "engine_config_digest": engine_config_digest,
                "corpus_digest": corpus_digest,
                "artifact_path": artifact_path,
                "started_at": started_at,
            },
        )
        run_id = cur.fetchone()[0]
        conn.commit()
    return str(run_id)


def set_artifact_path(connect: ConnectionFactory, run_id: str, path: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update backtest_runs set artifact_path = %s, updated_at = now() "
            "where id = %s",
            (path, run_id),
        )
        conn.commit()


def finish_run(
    connect: ConnectionFactory,
    run_id: str,
    *,
    status: str,
    totals,
    finished_at: datetime,
    error: str | None = None,
) -> None:
    """Move a run to a terminal state. Never to `completed` — see complete_run."""
    if status == COMPLETED:
        raise ValueError(
            "finish_run cannot complete a run; completion requires digests and "
            "goes through complete_run"
        )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            update backtest_runs set
                status = %(status)s::"BacktestStatus",
                candidate_count = %(candidates)s,
                projected_count = %(projected)s,
                unprojectable_count = %(unprojectable)s,
                excluded_count = %(excluded)s,
                comparison_count = %(comparison)s,
                threshold_obs_count = %(thresholds)s,
                error_message = %(error)s,
                finished_at = %(finished_at)s,
                updated_at = now()
            where id = %(id)s
            """,
            {
                "id": run_id, "status": status, "error": error,
                "finished_at": finished_at,
                "candidates": totals.candidates, "projected": totals.projected,
                "unprojectable": totals.unprojectable, "excluded": totals.excluded,
                "comparison": totals.comparison,
                "thresholds": totals.threshold_observations,
            },
        )
        conn.commit()


def reap_stale_runs(connect: ConnectionFactory, *, older_than_hours: int = 24) -> int:
    """Mark long-abandoned `running` rows as `interrupted`. Never as completed.

    A process killed uncatchably leaves `running` forever, which is correct
    until someone says otherwise — and what they may say is "that run died",
    never "that run finished".
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "update backtest_runs set status = 'interrupted', "
            "error_message = coalesce(error_message, 'reaped: abandoned run'), "
            "finished_at = coalesce(finished_at, now()), updated_at = now() "
            "where status = 'running' "
            "  and started_at < now() - make_interval(hours => %s)",
            (older_than_hours,),
        )
        reaped = cur.rowcount
        conn.commit()
    return reaped


_INSERT_BIN = """
insert into calibration_bins (
    id, backtest_run_id, stat_type, season, era, bin_index, bin_low, bin_high,
    predicted_mean, observed_rate, threshold_observations, projection_count,
    below_floor
) values (
    gen_random_uuid(), %(run_id)s, %(stat_type)s::"StatType", %(season)s,
    %(era)s::"WeatherEra", %(bin_index)s, %(bin_low)s, %(bin_high)s,
    %(predicted_mean)s, %(observed_rate)s, %(threshold_observations)s,
    %(projection_count)s, %(below_floor)s
)
"""


def complete_run(
    connect: ConnectionFactory,
    run_id: str,
    *,
    totals,
    aggregates: dict,
    aggregates_version: int,
    bins: list[dict],
    predictions_digest: str,
    aggregate_digest: str,
    calibration_digest: str,
    finished_at: datetime,
) -> None:
    """Move a run to `completed`, with its bins, in one transaction.

    Both writes or neither. A run marked completed whose calibration bins
    failed to land would be a result with a missing reliability curve, and
    Pitch 6 would render the absence as "no data" rather than as a fault.
    """
    with connect() as conn, conn.cursor() as cur:
        for row in bins:
            cur.execute(_INSERT_BIN, {"run_id": run_id, **row})
        cur.execute(
            """
            update backtest_runs set
                status = 'completed',
                candidate_count = %(candidates)s,
                projected_count = %(projected)s,
                unprojectable_count = %(unprojectable)s,
                excluded_count = %(excluded)s,
                comparison_count = %(comparison)s,
                threshold_obs_count = %(thresholds)s,
                aggregates = %(aggregates)s,
                aggregates_version = %(aggregates_version)s,
                predictions_digest = %(predictions_digest)s,
                aggregate_digest = %(aggregate_digest)s,
                calibration_digest = %(calibration_digest)s,
                finished_at = %(finished_at)s,
                updated_at = now()
            where id = %(id)s
            """,
            {
                "id": run_id,
                "candidates": totals.candidates, "projected": totals.projected,
                "unprojectable": totals.unprojectable, "excluded": totals.excluded,
                "comparison": totals.comparison,
                "thresholds": totals.threshold_observations,
                "aggregates": json.dumps(aggregates, sort_keys=True, default=str),
                "aggregates_version": aggregates_version,
                "predictions_digest": predictions_digest,
                "aggregate_digest": aggregate_digest,
                "calibration_digest": calibration_digest,
                "finished_at": finished_at,
            },
        )
        conn.commit()


def load_run(connect: ConnectionFactory, run_id: str) -> dict | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select id, status, aggregates, aggregates_version, predictions_digest, "
            "aggregate_digest, calibration_digest, corpus_digest, "
            "engine_config_digest, artifact_path, model_version, code_version, "
            "code_dirty, seed, rng_draws, evaluation_window, season_from, "
            "season_to, stat_types::text[] as stat_types, season_types, cutoff_policy, "
            "threshold_policy_version, grading_target, candidate_count, "
            "projected_count, unprojectable_count, excluded_count, "
            "comparison_count, threshold_obs_count, started_at, finished_at, "
            "error_message from backtest_runs where id = %s",
            (run_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))


def load_calibration_bins(connect: ConnectionFactory, run_id: str) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select stat_type::text as stat_type, season, era::text as era, "
            "bin_index, bin_low, bin_high, predicted_mean, observed_rate, "
            "threshold_observations, projection_count, below_floor "
            "from calibration_bins where backtest_run_id = %s "
            "order by stat_type nulls first, season nulls first, "
            "era nulls first, bin_index",
            (run_id,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
