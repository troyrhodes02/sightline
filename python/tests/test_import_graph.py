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
#
# The ``paper_*`` family and ``recalibration_fits`` (SIG-60) join the list for
# two reasons. ``paper_cycle_candidates`` carries executable Kalshi prices and
# top-of-book sizes, which makes it as barred as ``price_observations``
# outright. The rest — the bankroll, the ledger, positions, fills, breaches —
# are barred because the modelling runtime has no reason to know a bankroll
# exists, and a feature that could see one could learn from its own P&L. Every
# name here is distinctive enough to match bare, unlike ``outcomes``.
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
    # Autonomous paper trading (SIG-60). Table names and Prisma model names.
    "paper_campaign",
    "paper_risk_config",
    "paper_control_event",
    "paper_ledger_entr",
    "paper_cycle",
    "paper_position",
    "paper_fill",
    "paper_desired_exposure",
    "paper_breach",
    "paper_dry_run",
    "paper_replay",
    "recalibration_fit",
    "papercampaign",
    "paperriskconfig",
    "papercontrolevent",
    "paperledgerentry",
    "papercycle",
    "paperposition",
    "paperfill",
    "paperdesiredexposure",
    "paperbreach",
    "paperdryrun",
    "paperreplay",
    "recalibrationfit",
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


def test_sweep_catches_a_planted_paper_trading_reference() -> None:
    # SIG-60. Same discipline as the settlement tokens: a blocklist is only
    # worth what it catches, so plant a reference to every barred paper table
    # and assert each one trips the sweep. If a token is dropped or typo'd in a
    # future edit, this fails before a modelling module can read a bankroll.
    planted = (
        "select balance_after_cents from paper_ledger_entries",
        'SELECT * FROM "paper_ledger_entries"',
        "select * from paper_campaigns where id = %s",
        "join paper_positions p on p.contract_id = c.id",
        "select ask_cents from paper_cycle_candidates",
        'INSERT INTO "paper_cycles" (game_id) VALUES (%s)',
        "update paper_risk_configs set kelly_fraction = %s",
        "select * from paper_fills",
        "select * from paper_breaches where resolution = 'active'",
        "select * from paper_desired_exposures",
        "select * from paper_control_events",
        "select * from paper_dry_runs",
        "select * from paper_replays",
        "select knots from recalibration_fits where is_active",
        # Prisma model names, in case a future ORM path is ever added.
        "from prisma.models import PaperPosition",
        "PaperCampaign",
        "RecalibrationFit",
    )
    for statement in planted:
        assert _forbidden_tokens_in(statement), (
            f"the sweep failed to catch a planted paper-trading reference: "
            f"{statement!r}"
        )


def test_sweep_ignores_legitimate_modelling_vocabulary() -> None:
    # The paper tokens are distinctive enough to match bare, but "paper" and
    # "fill" are ordinary words and "cycle" is the ingest runtime's own
    # vocabulary. Assert the guard does not fire on any of them, because a
    # guard that false-positives gets loosened the first week it annoys
    # someone, and a loosened guard protects nothing.
    innocent = (
        "See the pitch paper for the shrinkage rationale.",
        "def run_cycle(as_of: datetime) -> RunOutcome:",
        "the nightly recompute cycle",
        "fill_missing_context(frame)",
        "forward-fill the trailing window",
        "positions in the depth chart",
        "recalibrate the trailing-five baseline",  # not recalibration_fit
        "paper trading is a downstream concern of the TypeScript runtime",
    )
    for text in innocent:
        assert _forbidden_tokens_in(text) == [], (
            f"the sweep false-positives on legitimate vocabulary: {text!r}"
        )


def test_sweep_covers_the_simulation_engine_modules() -> None:
    # SIG-66. The Simulation Engine is three new feature layers plus a
    # vectorised sim core — three fresh chances to reach for a price to
    # "sanity-check" a projection. The sweep is file-recursive over
    # ``sightline_model``, so simulation modules are covered automatically; this
    # asserts that coverage explicitly, so deleting or moving the package can
    # never silently drop it from the guard.
    scanned = [str(p) for p in _package_python_files()]
    assert any(
        "simulation" in p and p.endswith("config.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/config.py"
    assert any(
        "simulation" in p and p.endswith("seed.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/seed.py"
    # SIG-67: Layer 1 (game environment) is the first module that assembles
    # features and could reach for a price to "sanity-check" volume. Assert it
    # is covered explicitly so moving the module can never silently drop it.
    assert any(
        "simulation" in p and p.endswith("game_environment.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/game_environment.py"
    # SIG-68: Layer 2 (usage allocation) assembles per-player usage features and
    # could reach for a price to "sanity-check" a share. Assert it is covered
    # explicitly so moving the module can never silently drop it from the guard.
    assert any(
        "simulation" in p and p.endswith("usage_allocation.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/usage_allocation.py"
    # SIG-69: Layer 3 (efficiency) turns opportunity into a stat line and could
    # reach for a price to "sanity-check" a rate. Assert it is covered explicitly
    # so moving the module can never silently drop it from the guard.
    assert any(
        "simulation" in p and p.endswith("efficiency.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/efficiency.py"
    # SIG-69: the vectorised joint simulation core composes all three layers and
    # is the module a price would most tempt into a "does this beat the market?"
    # check. Assert coverage explicitly.
    assert any(
        "simulation" in p and p.endswith("core.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/core.py"
    # SIG-70: the backtest-integration module runs the joint engine under the
    # harness discipline and grades against actuals — the module most tempted to
    # "sanity-check" a projection against the market it is trying to beat. Assert
    # coverage explicitly so moving it can never silently drop it from the guard.
    assert any(
        "simulation" in p and p.endswith("backtest.py") for p in scanned
    ), "the import-graph sweep does not reach sightline_model/simulation/backtest.py"


def test_sweep_catches_a_price_reference_planted_in_a_simulation_module() -> None:
    # SIG-66. A game-environment / usage / efficiency layer that read a price is
    # the exact failure this invariant exists to prevent. Plant the shapes such
    # a layer might use and assert each trips the sweep before it can leak.
    planted = (
        "select yes_ask_cents from price_observations where contract_id = %s",
        'SELECT * FROM "price_observations"  -- weight the game-env prior',
        "from prisma.models import PriceObservation  # just to sanity-check",
        "join recommendation_snapshots r on r.game_id = g.id",
        "RecommendationSnapshot  # smoke-test the usage layer against the market",
    )
    for statement in planted:
        assert _forbidden_tokens_in(statement), (
            f"the sweep failed to catch a planted simulation-layer price "
            f"reference: {statement!r}"
        )


def test_forbidden_list_has_no_duplicates_or_empty_tokens() -> None:
    # A duplicated token is harmless; an empty one would match every file and
    # make the sweep permanently red, and a whitespace-only one would do the
    # same silently. Both are cheap to rule out and expensive to debug.
    assert all(token.strip() for token in FORBIDDEN), "empty token in FORBIDDEN"
    assert len(set(FORBIDDEN)) == len(FORBIDDEN), "duplicate token in FORBIDDEN"
    assert all(token == token.lower() for token in FORBIDDEN), (
        "tokens are compared against lowercased text, so every token must be "
        "lowercase or it can never match"
    )
