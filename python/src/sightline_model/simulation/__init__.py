"""The Simulation Engine — Sightline's V1 projection model.

A three-layer football-process simulator (game environment -> usage allocation
-> efficiency) combined through a vectorised Monte Carlo game simulation that
produces every participating player's stat line jointly, per game. It coexists
with the permanent Pitch 2 baseline as a distinct ``model_version``.

This package reads the historical corpus exclusively through the as-of query
layer and NEVER reads a Kalshi price, recommendation, or edge — the import-graph
guard (``tests/test_import_graph.py``) enforces that structurally over every
module here.
"""

from __future__ import annotations

from sightline_model.simulation.config import (
    DRAW_COUNT,
    PMF_SUPPORT,
    QUANTILE_GRID,
    SIMULATION_MODEL_VERSION,
    engine_config,
)
from sightline_model.simulation.seed import derive_seed

__all__ = [
    "DRAW_COUNT",
    "PMF_SUPPORT",
    "QUANTILE_GRID",
    "SIMULATION_MODEL_VERSION",
    "engine_config",
    "derive_seed",
]
