"""Reviewed promotion tooling for the Simulation Engine (SIG-71, RD-1).

Promotion is the one action that flips a stat type's active model from the
baseline to the simulation engine. It is a **reviewed, manual data change**, not
an automated one: the application never promotes, never triggers a backtest, and
never writes ``model_selections`` from a request path. This script is the human's
tool for applying a promotion once the evidence exists.

What it does, given a completed simulation ``BacktestRun`` id and the baseline
``BacktestRun`` id to compare against:

1. Loads both runs' stored aggregates (the ``contractLike`` per-stat Brier block
   — the population the promotion bar is defined over).
2. Computes, per stat type present in both, the Brier delta and whether it clears
   :func:`sightline_model.metrics.meets_promotion_bar` (≥0.01 absolute over ≥500
   graded predictions across ≥2 seasons).
3. **Dry-run by default:** prints exactly what it would change and writes nothing.
   Only with ``--apply`` does it UPDATE ``model_selections`` for the clearing stat
   types, recording ``backtest_run_id``, ``brier_delta``, and ``sample_size`` as
   the evidence. A stat type below the bar is left on the baseline, untouched.

It never triggers a Dry Run of the paper-trading pipeline, never flips autonomy,
and never places an order — those are downstream human-triggered gates in the
staking pitch, out of this pitch's scope. No price, recommendation, or edge is
imported; the import-graph guard sweeps this module.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

from sightline_ingest.db import ConnectionFactory, connection_factory

from .. import persist
from ..metrics import compare_stat_type_briers
from .config import SIMULATION_MODEL_VERSION

# The baseline model version a promotion moves a stat type AWAY from. A promotion
# is only ever baseline -> simulation in this pitch.
BASELINE_MODEL_VERSION = "baseline-zil-0.1.0"

_SELECT_CURRENT_SQL = "select model_version from model_selections where stat_type = %s"

_UPDATE_SELECTION_SQL = """
    update model_selections
       set model_version = %(model_version)s,
           backtest_run_id = %(backtest_run_id)s,
           brier_delta = %(brier_delta)s,
           sample_size = %(sample_size)s,
           note = %(note)s,
           promoted_at = %(promoted_at)s
     where stat_type = %(stat_type)s
"""


@dataclass(frozen=True)
class PromotionCandidate:
    """One stat type's promotion evaluation against the baseline."""

    stat_type: str
    sim_brier: float
    baseline_brier: float
    brier_delta: float
    sample_size: int
    promotes: bool


def _seasons_covered(run: dict) -> int:
    """The number of distinct seasons the run spans, inclusive."""
    return int(run["season_to"]) - int(run["season_from"]) + 1


def evaluate_promotions(
    connect: ConnectionFactory, *, simulation_run_id: str, baseline_run_id: str
) -> list[PromotionCandidate]:
    """Compute per-stat-type promotion candidates from two stored runs.

    Reads both runs' aggregates through :func:`sightline_model.persist.load_run`
    and delegates the pure comparison to
    :func:`sightline_model.metrics.compare_stat_type_briers`. Validates the run
    identities so a mis-passed pair (two baseline runs, a simulation run compared
    to itself) fails loudly rather than promoting on nonsense.
    """
    sim_run = persist.load_run(connect, simulation_run_id)
    if sim_run is None:
        raise SystemExit(f"simulation run {simulation_run_id!r} not found")
    baseline_run = persist.load_run(connect, baseline_run_id)
    if baseline_run is None:
        raise SystemExit(f"baseline run {baseline_run_id!r} not found")

    if sim_run["model_version"] != SIMULATION_MODEL_VERSION:
        raise SystemExit(
            f"run {simulation_run_id!r} is model_version "
            f"{sim_run['model_version']!r}, not the simulation engine "
            f"{SIMULATION_MODEL_VERSION!r}"
        )
    if baseline_run["model_version"] != BASELINE_MODEL_VERSION:
        raise SystemExit(
            f"run {baseline_run_id!r} is model_version "
            f"{baseline_run['model_version']!r}, not the baseline "
            f"{BASELINE_MODEL_VERSION!r}"
        )
    if sim_run["status"] != "completed" or baseline_run["status"] != "completed":
        raise SystemExit("both runs must be completed to compare their aggregates")

    # The comparison bar checks the span; a promotion needs >= 2 seasons of
    # evidence, so use the SMALLER of the two runs' spans (a comparison is only as
    # long as its shorter arm).
    seasons_covered = min(_seasons_covered(sim_run), _seasons_covered(baseline_run))

    comparison = compare_stat_type_briers(
        sim_run.get("aggregates") or {},
        baseline_run.get("aggregates") or {},
        seasons_covered,
    )
    out: list[PromotionCandidate] = []
    for stat_type in sorted(comparison):
        row = comparison[stat_type]
        out.append(
            PromotionCandidate(
                stat_type=stat_type,
                sim_brier=row["sim_brier"],
                baseline_brier=row["baseline_brier"],
                brier_delta=row["delta"],
                sample_size=row["n"],
                promotes=row["promotes"],
            )
        )
    return out


def apply_promotions(
    connect: ConnectionFactory,
    candidates: list[PromotionCandidate],
    *,
    simulation_run_id: str,
    note: str | None = None,
) -> list[str]:
    """UPDATE ``model_selections`` for the clearing stat types, atomically.

    Only stat types with ``promotes == True`` are written, and only those still
    on the baseline (an already-promoted stat is a no-op, reported, not
    re-stamped). Every write records the evidence — the simulation run id, the
    Brier delta, and the sample size — so the promotion is auditable from the row
    alone. All writes share one transaction: a partial promotion is impossible.
    Returns the list of stat types actually promoted.
    """
    to_promote = [c for c in candidates if c.promotes]
    if not to_promote:
        return []
    promoted: list[str] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with connect() as conn:
        with conn.transaction(), conn.cursor() as cur:
            for candidate in to_promote:
                cur.execute(_SELECT_CURRENT_SQL, (candidate.stat_type,))
                row = cur.fetchone()
                if row is None:
                    raise SystemExit(
                        f"no model_selections row for {candidate.stat_type!r}; "
                        f"the registry is mis-seeded"
                    )
                if row[0] == SIMULATION_MODEL_VERSION:
                    # Already promoted; leave its recorded evidence intact.
                    print(f"  {candidate.stat_type}: already on simulation; skipping")
                    continue
                cur.execute(
                    _UPDATE_SELECTION_SQL,
                    {
                        "model_version": SIMULATION_MODEL_VERSION,
                        "backtest_run_id": simulation_run_id,
                        "brier_delta": round(candidate.brier_delta, 4),
                        "sample_size": candidate.sample_size,
                        "note": note,
                        "promoted_at": now,
                        "stat_type": candidate.stat_type,
                    },
                )
                promoted.append(candidate.stat_type)
    return promoted


def _print_report(candidates: list[PromotionCandidate], *, apply: bool) -> None:
    header = "APPLY" if apply else "DRY RUN — no changes written"
    print(f"Promotion evaluation ({header}):")
    if not candidates:
        print("  no stat type has a measured contract-like Brier in BOTH runs.")
        return
    for c in candidates:
        verdict = "PROMOTE" if c.promotes else "hold on baseline"
        print(
            f"  {c.stat_type:<16} sim={c.sim_brier:.4f} baseline={c.baseline_brier:.4f} "
            f"delta={c.brier_delta:+.4f} n={c.sample_size} -> {verdict}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sightline-model-promote",
        description=(
            "Reviewed promotion of a stat type from the baseline to the "
            "Simulation Engine, gated on the promotion bar (RD-1). Dry-run by "
            "default; --apply writes model_selections. Never triggers a Dry Run "
            "of the paper pipeline, never flips autonomy, never places an order."
        ),
    )
    parser.add_argument(
        "--simulation-run", required=True, help="completed simulation BacktestRun id"
    )
    parser.add_argument(
        "--baseline-run", required=True, help="completed baseline BacktestRun id to compare against"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply the promotion (write model_selections); omit for a dry run",
    )
    parser.add_argument(
        "--note", default=None, help="optional note recorded on each promoted row"
    )
    args = parser.parse_args(argv)

    connect = connection_factory()
    candidates = evaluate_promotions(
        connect,
        simulation_run_id=args.simulation_run,
        baseline_run_id=args.baseline_run,
    )
    _print_report(candidates, apply=args.apply)

    if not args.apply:
        clearing = [c.stat_type for c in candidates if c.promotes]
        if clearing:
            print(f"\n{len(clearing)} stat type(s) would be promoted: {', '.join(clearing)}")
            print("Re-run with --apply to write the change.")
        return 0

    promoted = apply_promotions(
        connect, candidates, simulation_run_id=args.simulation_run, note=args.note
    )
    if promoted:
        print(f"\nPromoted to simulation: {', '.join(promoted)}")
    else:
        print("\nNothing promoted (nothing cleared the bar, or all already promoted).")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
