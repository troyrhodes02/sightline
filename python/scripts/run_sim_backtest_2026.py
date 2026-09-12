"""Point-in-time Simulation-Engine backtest over 2026 REG (played games).

Mirrors ``sightline_model.cli._run_backtest`` exactly for the wiring it shares
(connection factory, RunConfig, persist, run_backtest), but selects the joint
Simulation Engine via ``run_simulation_backtest`` and its fitted layer models.

Run against the production DB with:

    INGEST_DATABASE_URL="$PROD_DSN" \
        uv run --project python python scripts/run_sim_backtest_2026.py

It READS the corpus and WRITES a BacktestRun + calibration_bins to that DB, plus
raw per-prediction Parquet to local disk. It never writes decisions/positions/
model_selections and promotes nothing. Kalshi prices are never read.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sightline_ingest.config import ingest_dsn
from sightline_ingest.db import connection_factory

from sightline_model import persist
from sightline_model.harness import RunConfig, validate_stat_types
from sightline_model.simulation.backtest import run_simulation_backtest
from sightline_model.simulation.live import load_simulation_models

# The six stat types the simulation engine can store; identical to the baseline
# run's stat set so the two runs are apples-to-apples over the same population.
STAT_TYPES = (
    "passing_yards",
    "rushing_yards",
    "receiving_yards",
    "receptions",
    "rushing_tds",
    "receiving_tds",
)


def main() -> int:
    connect = connection_factory(ingest_dsn())

    config = RunConfig(
        season_from=2026,
        season_to=2026,
        stat_types=validate_stat_types(list(STAT_TYPES)),
        season_types=("REG",),
        evaluation_window="development",
        label="2026 simulation (played games)",
        seed=20260728,  # CLI default; the run-level sim seed derives from config
        limit_games=None,
        artifact_base=None,
    )

    models = load_simulation_models()

    # Same ``now`` convention the harness/CLI uses when now is not supplied.
    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)

    print(
        f"running simulation {config.season_from}-{config.season_to} "
        f"[{', '.join(config.stat_types)}] window={config.evaluation_window}"
    )
    outcome = run_simulation_backtest(
        connect, config, models=models, persist=persist, now=now
    )
    totals = outcome.totals
    print(
        f"{outcome.status}: {totals.projected:,} projected, "
        f"{totals.unprojectable:,} unprojectable, {totals.excluded:,} excluded "
        f"of {totals.candidates:,} candidates"
    )
    print(f"artefacts: {outcome.root}")
    print(f"SIM_RUN_ID={outcome.run_id}")
    if outcome.status == "completed":
        return 0
    if outcome.error is not None:
        print(f"error: {outcome.error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
