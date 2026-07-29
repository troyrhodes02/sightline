"""Local Parquet artefacts, the manifest, and the completion marker.

Raw per-prediction output stays on local disk. Millions of rows in the
application's relational path is the thing the Architecture Doc rules out, and
Pitch 6 only ever needs the aggregates.

Two ordering rules are load-bearing and are the reason this module exists
rather than the harness writing frames inline:

* **Quantisation happens before writing, never after.** Digests are computed
  over the quantised values, so a difference below the quantum cannot flip a
  digest and a difference above it always does. Rounding at display time
  instead would make two runs that differ in the tenth decimal place look
  identical in a report and different in a digest.
* **``_COMPLETE`` is written last**, after the manifest, which is written after
  every dataset is flushed and closed. It is the filesystem twin of
  ``status = completed``, and ``verify`` asserts the two agree — a crash
  between them is exactly the state that gets presented as a finished backtest
  six weeks later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path

import polars as pl

COMPLETE_MARKER = "_COMPLETE"
MANIFEST = "manifest.json"

PREDICTIONS = "predictions"
THRESHOLDS = "thresholds"
EXCLUSIONS = "exclusions"
PRIORS = "priors"

# Decimal places per column, applied before writing and before hashing. A
# column absent from this map is written as-is (ids, strings, timestamps).
QUANTISATION = {
    "projected_value": 3,
    "interval_low": 3,
    "interval_high": 3,
    "mass_below_zero": 6,
    "relative_width": 4,
    "actual": 1,
    "actual_percentile": 4,
    "abs_error": 4,
    "sq_error": 4,
    "baseline_season_avg": 3,
    "baseline_trailing5": 3,
    "baseline_season_avg_abs_error": 4,
    "baseline_trailing5_abs_error": 4,
    "threshold": 1,
    "probability": 6,
    "tail_mass": 6,
    "zero_mass": 6,
}


def quantise(value: float | None, places: int) -> float | None:
    """Round half to even, deterministically.

    Python's round() is already banker's rounding, but going through Decimal
    makes the intent explicit and avoids the binary-float surprises that make
    round(2.675, 2) return 2.67.
    """
    if value is None:
        return None
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_EVEN))


def quantise_row(row: dict) -> dict:
    return {
        key: quantise(value, QUANTISATION[key])
        if key in QUANTISATION and isinstance(value, (int, float))
        else value
        for key, value in row.items()
    }


@dataclass
class ArtifactWriter:
    """Accumulates rows and writes one Parquet part per dataset.

    Parts are named ``part-00000.parquet`` upward in write order, and rows keep
    the harness's iteration order, so the file layout is itself deterministic.
    """

    root: Path

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self._buffers: dict[str, list[dict]] = {}

    def append(self, dataset: str, row: dict) -> None:
        self._buffers.setdefault(dataset, []).append(quantise_row(row))

    def extend(self, dataset: str, rows: list[dict]) -> None:
        for row in rows:
            self.append(dataset, row)

    def rows(self, dataset: str) -> list[dict]:
        return self._buffers.get(dataset, [])

    def flush(self) -> dict[str, int]:
        """Write every buffered dataset. Returns row counts per dataset."""
        counts: dict[str, int] = {}
        for dataset, rows in sorted(self._buffers.items()):
            directory = self.root / dataset
            directory.mkdir(parents=True, exist_ok=True)
            # infer_schema_length=None scans EVERY row before choosing dtypes.
            # The default (100) reads the schema off the first rows only, and
            # candidate order puts all three continuous stat types before the
            # count types — so `pmf` (null for continuous, a JSON string for
            # counts) infers as Null and then throws on the first count row.
            # Any run combining the two families would fail at flush, which is
            # to say the ordinary six-stat-type run. Scanning is one pass over
            # a buffer already held in memory.
            frame = (
                pl.DataFrame(rows, strict=False, infer_schema_length=None)
                if rows else pl.DataFrame()
            )
            frame.write_parquet(directory / "part-00000.parquet")
            counts[dataset] = len(rows)
        return counts

    def write_manifest(self, manifest: dict) -> None:
        (self.root / MANIFEST).write_text(
            json.dumps(manifest, indent=2, sort_keys=True, default=str),
            encoding="utf-8",
        )

    def mark_complete(self) -> None:
        """Written LAST. See the module docstring."""
        (self.root / COMPLETE_MARKER).write_text("", encoding="utf-8")

    @property
    def is_complete(self) -> bool:
        return (self.root / COMPLETE_MARKER).exists()


def read_dataset(root: Path, dataset: str) -> pl.DataFrame:
    directory = Path(root) / dataset
    parts = sorted(directory.glob("*.parquet"))
    if not parts:
        return pl.DataFrame()
    return pl.concat([pl.read_parquet(p) for p in parts], how="vertical")


def read_manifest(root: Path) -> dict:
    return json.loads((Path(root) / MANIFEST).read_text(encoding="utf-8"))


def is_complete(root: Path) -> bool:
    return (Path(root) / COMPLETE_MARKER).exists()


def run_root(base: Path, run_id: str) -> Path:
    return Path(base) / "backtests" / run_id


def default_artifact_base() -> Path:
    """``python/artifacts`` — git-ignored, never served, never a URL."""
    return Path(__file__).resolve().parents[2] / "artifacts"


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
