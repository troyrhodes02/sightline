"""Dataset registry.

The CLI is a thin dispatcher over this registry. Later PRs register the actual
datasets (players, schedule, pbp, stats, context, weather, identities); this PR
ships the registry and the dispatch/failure plumbing with the registry empty.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .db import ConnectionFactory
from .provenance import IngestRunHandle


class DatasetRun(Protocol):
    """A dataset's ingest entrypoint — the CLI's actual call contract.

    Receives the run handle (to update row counts and downgrade status), a
    connection factory (for its own data transaction), and the season range
    positionally. The CLI ALSO passes ``source=`` and ``from_samples=`` as
    keyword arguments (see cli.py), so every implementation must swallow
    keywords it does not use — the shipped datasets do this with a trailing
    ``**_: object``. Implementations raise on failure — the CLI records that
    as a failed run.
    """

    def __call__(
        self,
        handle: IngestRunHandle,
        connect: ConnectionFactory,
        season_from: int | None,
        season_to: int | None,
        /,
        **kwargs: object,
    ) -> None: ...


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
