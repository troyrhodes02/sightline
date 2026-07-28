"""Reads and writes over ``backtest_runs`` / ``calibration_bins``.

SIG-13 ships the read half only: enough to prove the wiring end to end (DSN →
direct connection → query → sanitised output) before any modelling code lands.
The write half arrives with the harness (SIG-17) and the metrics layer (SIG-18).

These two tables are shared reference data — no ``user_id``, no per-user
partition, no RLS. A calibration curve is identical for every user, so
row-level isolation of one would be ceremony rather than security.
"""

from __future__ import annotations

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
