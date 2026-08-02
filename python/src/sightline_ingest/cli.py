"""``sightline-ingest`` command-line entry point.

Usage:
    sightline-ingest <dataset> --seasons 1999-2025

Each invocation resolves a dataset from the registry, runs it inside a recorded
``IngestRun``, and fails explicitly: an unavailable or drifted source produces a
recorded ``failed`` run and a non-zero exit, never a partial dataset that reads
as complete. Credentials never appear in output.
"""

from __future__ import annotations

import argparse
import sys

from . import datasets as _datasets  # noqa: F401 - import registers datasets
from .config import ConfigError, ingest_dsn
from .db import connection_factory
from .errors import IngestError, sanitize_error
from .provenance import record_ingest_run
from .registry import get as get_dataset, names as dataset_names


def _parse_seasons(value: str) -> tuple[int, int]:
    """Parse ``"1999-2025"`` or a single ``"2021"`` into an inclusive range."""
    parts = value.split("-")
    try:
        if len(parts) == 1:
            year = int(parts[0])
            return year, year
        if len(parts) == 2:
            start, end = int(parts[0]), int(parts[1])
            if start > end:
                raise ValueError
            return start, end
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(
        f"invalid --seasons {value!r}; expected e.g. 1999-2025 or 2021"
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sightline-ingest",
        description="Ingest a historical NFL corpus dataset into Postgres.",
    )
    available = dataset_names()
    parser.add_argument(
        "dataset",
        help="dataset to ingest"
        + (f" (available: {', '.join(available)})" if available else " (none registered yet)"),
    )
    parser.add_argument(
        "--seasons",
        type=_parse_seasons,
        default=None,
        help="season or inclusive range, e.g. 1999-2025 or 2021",
    )
    parser.add_argument(
        "--source",
        default=None,
        help="restrict to a source (e.g. --source kalshi for the identities dataset)",
    )
    parser.add_argument(
        "--from-samples",
        default=None,
        help="path to a static sample file (e.g. Kalshi naming samples for identities)",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="override the ingest DSN (defaults to INGEST_DATABASE_URL / DIRECT_URL)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "cycle":
        # The scheduled in-season cycle (Pitch 5) has its own arguments and
        # run recording; everything else stays the per-dataset dispatcher.
        from .cycle import main as cycle_main

        return cycle_main(argv[1:])
    if argv and argv[0] == "grade":
        # The scheduled grading cycle (Outcome Scoring): grades completed
        # games' projections against the official corrected line.
        from .grade_job import main as grade_main

        return grade_main(argv[1:])

    parser = _build_parser()
    args = parser.parse_args(argv)

    dataset = get_dataset(args.dataset)
    if dataset is None:
        available = dataset_names()
        hint = f" Available: {', '.join(available)}." if available else " None are registered in this build."
        print(f"error: unknown dataset {args.dataset!r}.{hint}", file=sys.stderr)
        return 2

    season_from, season_to = (args.seasons or (None, None))

    try:
        dsn = args.database_url or ingest_dsn()
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    connect = connection_factory(dsn)

    try:
        with record_ingest_run(
            connect,
            source=dataset.source,
            dataset=dataset.name,
            season_from=season_from,
            season_to=season_to,
        ) as handle:
            dataset.run(
                handle,
                connect,
                season_from,
                season_to,
                source=args.source,
                from_samples=args.from_samples,
            )
    except IngestError as exc:
        # The failure is already recorded as an IngestRun. Surface a
        # credential-safe message and exit non-zero.
        print(f"ingest failed: {sanitize_error(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — last-resort credential-safe surface
        # Unexpected failure (driver, network, library). record_ingest_run has
        # already recorded it as failed with a sanitized message; the console
        # path must be sanitized too — a raw psycopg OperationalError traceback
        # can embed the DSN's host and username.
        print(f"ingest failed unexpectedly: {sanitize_error(exc)}", file=sys.stderr)
        return 1

    print(
        f"{dataset.name}: {handle.status} "
        f"(written={handle.rows_written}, updated={handle.rows_updated})"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
