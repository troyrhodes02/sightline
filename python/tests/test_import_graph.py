"""Second invariant, structural: prices never feed projections.

Established before any modelling code existed, so the guard predates the risk,
and extended to ``sightline_model`` (SIG-13) in that package's first commit for
the same reason. No module in either package may import or reference
``PriceObservation`` or ``RecommendationSnapshot``.

Both packages are covered because the modelling side is where the temptation
actually lives: a price is exactly what someone reaches for to sanity-check a
projection, and a model that has read the market cannot answer whether it beats
the market.
"""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

import sightline_ingest
import sightline_model

# Every package the invariant covers. A third package added to this repo must
# be added here too — the assertion is not self-extending across packages, so
# the list is the thing to review.
GUARDED_PACKAGES = (sightline_ingest, sightline_model)

# Both the Prisma model names AND the snake_case table names: the Python
# runtime reaches tables exclusively through raw SQL, so a guard that only
# knew the CamelCase names would wave `select * from price_observations`
# straight through. Checked case-insensitively.
FORBIDDEN = (
    "priceobservation",
    "recommendationsnapshot",
    "price_observation",
    "recommendation_snapshot",
)


def _package_python_files() -> list[Path]:
    paths: list[Path] = []
    for package in GUARDED_PACKAGES:
        root = Path(package.__file__).resolve().parent
        paths.extend(root.rglob("*.py"))
    return sorted(paths)


def test_no_price_references_in_source() -> None:
    offenders: list[str] = []
    for path in _package_python_files():
        text = path.read_text(encoding="utf-8").lower()
        for token in FORBIDDEN:
            if token in text:
                offenders.append(f"{path.parent.name}/{path.name}: {token}")
    assert not offenders, (
        "price/recommendation references found in the ingest or modelling "
        f"package (prices must never feed projections): {offenders}"
    )


def test_every_module_imports_cleanly_without_price_modules() -> None:
    # Importing either package whole must not pull in a price/recommendation
    # module — including transitively, which is why this imports rather than
    # only reading source text.
    imported: list[str] = []
    for package in GUARDED_PACKAGES:
        for mod in pkgutil.walk_packages(
            package.__path__, prefix=f"{package.__name__}."
        ):
            importlib.import_module(mod.name)
            imported.append(mod.name)

    assert imported, "expected to import at least one submodule"
    for name in imported:
        lowered = name.lower()
        assert "price" not in lowered
        assert "recommendation" not in lowered


def test_both_packages_are_actually_covered() -> None:
    # A guard that silently covered zero files would pass forever. Assert the
    # sweep reaches both packages by name.
    scanned = {p.parent.name for p in _package_python_files()}
    assert "sightline_ingest" in scanned
    assert "sightline_model" in scanned
