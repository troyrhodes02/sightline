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

    run = sub.add_parser("run", help="execute a backtest (the only writing command)")
    run.add_argument("--seasons", required=True, help="e.g. 2019-2023 or 2021")
    run.add_argument(
        "--stat-types", required=True,
        help="comma-separated; see the registry for valid values",
    )
    run.add_argument("--season-types", default="REG", help="e.g. REG or REG,POST")
    run.add_argument("--window", choices=EVALUATION_WINDOWS, default="development")
    run.add_argument("--label", default=None)
    run.add_argument("--seed", type=int, default=20260728)
    run.add_argument("--limit-games", type=int, default=None)
    run.add_argument("--artifact-base", default=None)
    run.add_argument(
        "--reap", action="store_true",
        help="mark abandoned `running` rows as interrupted first (never completed)",
    )

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


def _parse_seasons(value: str) -> tuple[int, int]:
    parts = value.split("-")
    try:
        if len(parts) == 1:
            year = int(parts[0])
            return year, year
        if len(parts) == 2:
            start, end = int(parts[0]), int(parts[1])
            if start <= end:
                return start, end
    except ValueError:
        pass
    raise ValueError(f"invalid --seasons {value!r}; expected e.g. 2019-2023 or 2021")


def _run_backtest(args: argparse.Namespace, connect) -> int:
    from pathlib import Path

    from . import persist
    from .harness import RunConfig, run_backtest, validate_stat_types

    try:
        season_from, season_to = _parse_seasons(args.seasons)
        stat_types = validate_stat_types(
            [s.strip() for s in args.stat_types.split(",") if s.strip()]
        )
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_USAGE

    if args.reap:
        reaped = persist.reap_stale_runs(connect)
        if reaped:
            print(f"reaped {reaped} abandoned run(s) as interrupted")

    config = RunConfig(
        season_from=season_from,
        season_to=season_to,
        stat_types=stat_types,
        season_types=tuple(s.strip() for s in args.season_types.split(",")),
        evaluation_window=args.window,
        label=args.label,
        seed=args.seed,
        limit_games=args.limit_games,
        artifact_base=Path(args.artifact_base) if args.artifact_base else None,
    )

    if args.window == "holdout":
        touched = persist.holdout_model_versions(connect)
        print(
            f"holdout run: {len(touched)} model version(s) have already touched "
            "this window — that count is the selection-bias record"
        )

    print(
        f"running {config.season_from}-{config.season_to} "
        f"[{', '.join(config.stat_types)}] window={config.evaluation_window}"
    )
    outcome = run_backtest(connect, config, persist=persist)
    totals = outcome.totals
    print(
        f"{outcome.status}: {totals.projected:,} projected, "
        f"{totals.unprojectable:,} unprojectable, {totals.excluded:,} excluded "
        f"of {totals.candidates:,} candidates "
        f"({totals.comparison:,} in the comparison population)"
    )
    print(f"artefacts: {outcome.root}")
    if outcome.status == "ready":
        # Aggregation (SIG-18) is what moves the row to `completed`, because a
        # completed run must carry all three digests and two of them do not
        # exist until the metrics layer computes them.
        print("aggregation pending — the run is not yet a readable result")
        return EXIT_OK
    print(f"error: {outcome.error}", file=sys.stderr)
    return EXIT_FAILED


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
        if args.command == "run":
            return _run_backtest(args, connect)
    except Exception as exc:  # noqa: BLE001 — credential-safe last resort
        # A raw psycopg OperationalError embeds the DSN's host and username.
        # Everything that reaches a console goes through sanitize_error first.
        print(f"backtest command failed: {sanitize_error(exc)}", file=sys.stderr)
        return EXIT_FAILED

    parser.error(f"unknown command {args.command!r}")  # pragma: no cover
    return EXIT_USAGE  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
