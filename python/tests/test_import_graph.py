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
#
# ``outcomes`` (SIG-51) is Kalshi settlement — market data, exactly as barred
# as prices. The bare words "outcome"/"outcomes" appear legitimately all over
# both packages (``RunOutcome``, threshold-observation ``outcome`` fields,
# prose), so the guard matches the SQL forms that can actually name the
# table, quoted or bare. Python reaches tables only through raw SQL, so a
# statement touching the table must contain one of these spellings.
FORBIDDEN = (
    "priceobservation",
    "recommendationsnapshot",
    "price_observation",
    "recommendation_snapshot",
    "from outcomes",
    "join outcomes",
    "into outcomes",
    "update outcomes",
    'from "outcomes"',
    'join "outcomes"',
    'into "outcomes"',
    'update "outcomes"',
)


def _package_python_files() -> list[Path]:
    paths: list[Path] = []
    for package in GUARDED_PACKAGES:
        root = Path(package.__file__).resolve().parent
        paths.extend(root.rglob("*.py"))
    return sorted(paths)


def _forbidden_tokens_in(text: str) -> list[str]:
    lowered = text.lower()
    return [token for token in FORBIDDEN if token in lowered]


def test_no_price_references_in_source() -> None:
    offenders: list[str] = []
    for path in _package_python_files():
        text = path.read_text(encoding="utf-8")
        for token in _forbidden_tokens_in(text):
            offenders.append(f"{path.parent.name}/{path.name}: {token}")
    assert not offenders, (
        "price/recommendation/settlement references found in the ingest or "
        "modelling package (prices — including settlement — must never feed "
        f"projections): {offenders}"
    )


def test_sweep_catches_a_planted_settlement_reference() -> None:
    # The token list is only worth what it catches. Plant every SQL shape a
    # module could use to reach the settlement table and assert each trips the
    # sweep — if a token is dropped or typo'd, this fails before a leak can.
    planted = (
        'select "result" from outcomes where contract_id = %s',
        'SELECT result FROM "outcomes" WHERE contract_id = %s',
        "insert into outcomes (contract_id, result) values (%s, %s)",
        'INSERT INTO "outcomes" (contract_id) VALUES (%s)',
        "join outcomes o on o.contract_id = c.id",
        'LEFT JOIN "outcomes" ON true',
        "update outcomes set result = %s",
        'UPDATE "outcomes" SET result = %s',
    )
    for statement in planted:
        assert _forbidden_tokens_in(statement), (
            f"the sweep failed to catch a planted settlement reference: "
            f"{statement!r}"
        )


def test_sweep_ignores_legitimate_outcome_vocabulary() -> None:
    # "outcome" is ordinary modelling vocabulary (RunOutcome, the threshold
    # observation's outcome field, prose about per-game outcomes). The guard
    # must not fire on it, or it would be loosened the first week it annoys
    # someone — and a loosened guard protects nothing.
    innocent = (
        "class RunOutcome:",
        '"outcome": bool(float(actual) >= threshold),',
        "per-game outcomes in ``pipeline_run_games``.",
        "season's outcomes into every prediction inside it.",
    )
    for text in innocent:
        assert _forbidden_tokens_in(text) == [], (
            f"the sweep false-positives on legitimate vocabulary: {text!r}"
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
