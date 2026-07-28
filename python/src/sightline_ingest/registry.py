"""Dataset registry.

The CLI is a thin dispatcher over this registry. Later PRs register the actual
datasets (players, schedule, pbp, stats, context, weather, identities); this PR
ships the registry and the dispatch/failure plumbing with the registry empty.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .db import ConnectionFactory
from .provenance import IngestRunHandle

# A dataset's ingest function. It receives the run handle (to update row counts
# and downgrade status), a connection factory (for its own data transaction),
# and the season range. It raises on failure — the CLI records that as failed.
DatasetRun = Callable[[IngestRunHandle, ConnectionFactory, int | None, int | None], None]


@dataclass(frozen=True)
class Dataset:
    name: str  # CLI name, e.g. "players"
    source: str  # DataSource enum value, e.g. "nflverse"
    run: DatasetRun


DATASETS: dict[str, Dataset] = {}


def register(dataset: Dataset) -> None:
    if dataset.name in DATASETS:
        raise ValueError(f"dataset already registered: {dataset.name}")
    DATASETS[dataset.name] = dataset


def get(name: str) -> Dataset | None:
    return DATASETS.get(name)


def names() -> list[str]:
    return sorted(DATASETS)
