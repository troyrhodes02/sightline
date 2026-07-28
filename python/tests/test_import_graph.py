"""Second invariant, structural: prices never feed projections.

Established now, before any modelling code exists, so the guard predates the
risk. No module in the corpus/ingest/as-of package may import or reference
``PriceObservation`` or ``RecommendationSnapshot``.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

import sightline_ingest

FORBIDDEN = ("PriceObservation", "RecommendationSnapshot")


def _package_python_files() -> list[Path]:
    root = Path(sightline_ingest.__file__).resolve().parent
    return sorted(root.rglob("*.py"))


def test_no_price_references_in_source() -> None:
    offenders: list[str] = []
    for path in _package_python_files():
        text = path.read_text(encoding="utf-8")
        for token in FORBIDDEN:
            if token in text:
                offenders.append(f"{path.name}: {token}")
    assert not offenders, (
        "price/recommendation references found in the ingest package "
        f"(prices must never feed projections): {offenders}"
    )


def test_every_module_imports_cleanly_without_price_modules() -> None:
    # Importing the whole package must not pull in a price/recommendation module.
    imported: list[str] = []
    for mod in pkgutil.walk_packages(
        sightline_ingest.__path__, prefix="sightline_ingest."
    ):
        importlib.import_module(mod.name)
        imported.append(mod.name)

    assert imported, "expected to import at least one submodule"
    for name in imported:
        lowered = name.lower()
        assert "price" not in lowered
        assert "recommendation" not in lowered
