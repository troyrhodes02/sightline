"""``sightline-backtest`` command-line entry point.

The backtest is executed and inspected from the terminal and nowhere else.
There is no route, no server, no port, and no browser-triggered execution
surface — not in this pitch and not in a later one.

SIG-13 ships the subcommand skeleton and ``list``. ``run`` arrives with the
harness (SIG-17); the inspection commands (``show``, ``calibration``,
``predictions``, ``explain``, ``exclusions``, ``thresholds``) with SIG-19; and
``verify`` with the capstone (SIG-20). Unimplemented subcommands are absent
rather than stubbed, so ``--help`` never advertises a command that does
nothing.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Sequence

from sightline_ingest.config import ConfigError, ingest_dsn
from sightline_ingest.db import connection_factory
from sightline_ingest.errors import sanitize_error

from .persist import RunSummary, holdout_model_versions, list_runs

EVALUATION_WINDOWS = ("development", "validation", "holdout")

# Exit codes, shared with sightline-ingest: 0 success, 1 the operation failed,
# 2 usage/configuration error (nothing was attempted).
EXIT_OK = 0
EXIT_FAILED = 1
EXIT_USAGE = 2


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sightline-backtest",
        description=(
            "Run and inspect Sightline backtests. Read-only unless the "
            "subcommand is `run`."
        ),
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="override the DSN (defaults to INGEST_DATABASE_URL / DIRECT_URL)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    listing = sub.add_parser("list", help="list stored backtest runs, newest first")
    listing.add_argument("--model-version", default=None)
    listing.add_argument("--window", choices=EVALUATION_WINDOWS, default=None)
    listing.add_argument("--limit", type=int, default=None)
    listing.add_argument(
        "--json", action="store_true", help="emit machine-readable JSON"
    )

    return parser


def _format_table(runs: Sequence[RunSummary]) -> str:
    """A fixed-width table. The header prints even when there are no runs.

    An empty list is a result, not an error: before the first backtest there
    are legitimately zero runs, and rendering that as a failure would train the
    operator to ignore the exit code.
    """
    headers = (
        "run",
        "status",
        "seasons",
        "window",
        "model version",
        "code",
        "comparison n",
        "started",
    )
    rows = [
        (
            run.id[:8],
            run.status,
            run.seasons,
            run.evaluation_window,
            run.model_version,
            run.code_version[:7] + ("*" if run.code_dirty else ""),
            f"{run.comparison_count:,}" if run.is_result else "—",
            run.started_at.strftime("%Y-%m-%d %H:%M"),
        )
        for run in runs
    ]
    widths = [
        max(len(headers[i]), *(len(r[i]) for r in rows)) if rows else len(headers[i])
        for i in range(len(headers))
    ]
    out = ["  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)).rstrip()]
    out.append("  ".join("-" * w for w in widths))
    for row in rows:
        out.append("  ".join(c.ljust(widths[i]) for i, c in enumerate(row)).rstrip())
    if not rows:
        out.append("(no runs stored)")
    return "\n".join(out)


def _run_list(args: argparse.Namespace, connect) -> int:
    runs = list_runs(
        connect,
        model_version=args.model_version,
        evaluation_window=args.window,
        limit=args.limit,
    )

    if args.json:
        print(
            json.dumps(
                [
                    {
                        "id": r.id,
                        "label": r.label,
                        "status": r.status,
                        "seasons": r.seasons,
                        "statTypes": list(r.stat_types),
                        "evaluationWindow": r.evaluation_window,
                        "modelVersion": r.model_version,
                        "codeVersion": r.code_version,
                        "codeDirty": r.code_dirty,
                        "comparisonCount": r.comparison_count,
                        "projectedCount": r.projected_count,
                        "engineConfigDigest": r.engine_config_digest,
                        "corpusDigest": r.corpus_digest,
                        "startedAt": r.started_at.isoformat(),
                        "finishedAt": (
                            r.finished_at.isoformat() if r.finished_at else None
                        ),
                        "isResult": r.is_result,
                    }
                    for r in runs
                ],
                indent=2,
            )
        )
        return EXIT_OK

    print(_format_table(runs))

    # The holdout is meant to be touched once per model version. Printing the
    # count makes selection pressure countable instead of invisible.
    if args.window == "holdout":
        versions = holdout_model_versions(connect)
        print()
        print(
            f"holdout touched by {len(versions)} model version(s): "
            + (", ".join(versions) if versions else "none")
        )
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    try:
        dsn = args.database_url or ingest_dsn()
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_USAGE

    connect = connection_factory(dsn)

    try:
        if args.command == "list":
            return _run_list(args, connect)
    except Exception as exc:  # noqa: BLE001 — credential-safe last resort
        # A raw psycopg OperationalError embeds the DSN's host and username.
        # Everything that reaches a console goes through sanitize_error first.
        print(f"backtest command failed: {sanitize_error(exc)}", file=sys.stderr)
        return EXIT_FAILED

    parser.error(f"unknown command {args.command!r}")  # pragma: no cover
    return EXIT_USAGE  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
