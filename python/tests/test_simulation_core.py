"""The vectorised joint game simulation — the ticket's most important tests.

Reproducibility (R3), vectorisation, sparse/zero evidence, low-count zero mass,
joint-outcome signs, and the compact PMF/quantile helpers. No database.
"""

from __future__ import annotations

import inspect
import json
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np
import pytest

from sightline_model.projection import CONFIDENCE_LOW, Unprojectable
from sightline_model.simulation import core as core_mod
from sightline_model.simulation.config import (
    DISTRIBUTION_KIND_PMF,
    DISTRIBUTION_KIND_QUANTILES,
    SIMULATION_MODEL_VERSION,
)
from sightline_model.simulation.core import (
    PlayerSimInput,
    REASON_INSUFFICIENT_EVIDENCE,
    compute_correlations,
    prob_at_least_from_pmf,
    prob_at_least_from_quantiles,
    simulate_game,
    to_pmf,
    to_quantile_grid,
)
from sightline_model.simulation.efficiency import PlayerEfficiency
from sightline_model.simulation.game_environment import GameEnvironmentPrediction
from sightline_model.simulation.usage_allocation import allocate_shares


CUTOFF = datetime(2024, 11, 3, 16, 30, tzinfo=timezone.utc)


# --- A small, coherent two-team game to drive the core ----------------------


def _environment() -> dict[str, GameEnvironmentPrediction]:
    return {
        "KC": GameEnvironmentPrediction(pass_attempts_mean=38.0, rush_attempts_mean=26.0, dispersion=0.2),
        "BUF": GameEnvironmentPrediction(pass_attempts_mean=35.0, rush_attempts_mean=27.0, dispersion=0.2),
    }


def _kc_shares() -> dict[str, dict[str, float]]:
    # A QB (no share — he throws the team's attempts), a lead WR, two competing
    # RBs who split carries, so the joint-sign tests have their subjects.
    scores = {
        "kc_wr": {"target": 3.0, "carry": 0.0},
        "kc_rb1": {"target": 0.6, "carry": 2.0},
        "kc_rb2": {"target": 0.4, "carry": 1.8},
        "kc_te": {"target": 1.2, "carry": 0.0},
    }
    shares = allocate_shares(scores, {pid: True for pid in scores})
    return {
        "target_shares": {pid: s["target_share"] for pid, s in shares.items()},
        "carry_shares": {pid: s["carry_share"] for pid, s in shares.items()},
    }


def _eff(pid: str, position: str, **rates: float) -> PlayerEfficiency:
    return PlayerEfficiency(player_id=pid, position=position, n_eff=rates.pop("n_eff", 10), **rates)


def _players(n_eff_override: dict[str, int] | None = None) -> list[PlayerSimInput]:
    n_eff_override = n_eff_override or {}
    specs = {
        "kc_qb": ("QB", ("passing_yards",), dict(yards_per_pass_attempt=7.2, pass_td_rate=0.045)),
        "kc_wr": ("WR", ("receiving_yards", "receptions", "receiving_tds"), dict(yards_per_target=9.0, catch_rate=0.66, rec_td_rate=0.06)),
        "kc_rb1": ("RB", ("rushing_yards", "rushing_tds"), dict(yards_per_carry=4.4, rush_td_rate=0.03)),
        "kc_rb2": ("RB", ("rushing_yards", "rushing_tds"), dict(yards_per_carry=4.1, rush_td_rate=0.025)),
        "kc_te": ("TE", ("receiving_yards", "receptions"), dict(yards_per_target=7.5, catch_rate=0.68, rec_td_rate=0.05)),
    }
    out: list[PlayerSimInput] = []
    for pid, (pos, stats, rates) in specs.items():
        out.append(
            PlayerSimInput(
                player_id=pid,
                team_abbr="KC",
                position=pos,
                efficiency=_eff(pid, pos, **rates),
                n_eff=n_eff_override.get(pid, 10),
                requested_stats=stats,
            )
        )
    return out


def _run(draw_count: int = 5000, **kwargs) -> core_mod.GameSimulationResult:
    return simulate_game(
        game_id="2024_KC_BUF",
        information_cutoff=CUTOFF,
        environment_pred=_environment(),
        usage_by_team={"KC": _kc_shares()},
        players=kwargs.pop("players", _players()),
        computed_at=datetime(2024, 11, 3, 15, 0, tzinfo=timezone.utc),
        draw_count=draw_count,
        **kwargs,
    )


# --- Reproducibility (R3): byte-identical stored distributions --------------


def _serialize(result: core_mod.GameSimulationResult) -> str:
    # Only the STORED compact form — quantiles and pmf — plus identity, which is
    # what a byte-identical re-run must reproduce (raw draws are discarded).
    payload = [
        {
            "player_id": p.player_id,
            "stat_type": p.stat_type,
            "distribution_kind": p.distribution_kind,
            "quantiles": p.quantiles,
            "pmf": p.pmf,
            "params": p.params,
        }
        for p in sorted(result.projections, key=lambda p: (p.player_id, p.stat_type))
    ]
    return json.dumps(payload, sort_keys=True)


def test_two_runs_produce_byte_identical_stored_distributions() -> None:
    # Same (game_id, model_version, cutoff) -> same derived seed -> identical
    # stored quantile grids and PMFs, byte-for-byte in serialised JSON (R3).
    a = _run()
    b = _run()
    assert _serialize(a) == _serialize(b)
    assert a.seed == b.seed


def test_seed_is_derived_from_game_identity_not_wall_clock() -> None:
    from sightline_model.simulation.seed import derive_seed

    a = _run()
    assert a.seed == derive_seed("2024_KC_BUF", SIMULATION_MODEL_VERSION, CUTOFF)


# --- Vectorisation ----------------------------------------------------------


def test_simulate_game_has_no_per_draw_python_loop() -> None:
    source = inspect.getsource(simulate_game) + inspect.getsource(core_mod._player_stat_draws)
    assert "range(draw_count)" not in source
    assert "for _ in range" not in source
    # The only loops iterate teams, players, and requested stats — never draws.


def test_draw_axis_is_a_single_dimension_of_length_draw_count(monkeypatch) -> None:
    # Capture the arrays fed to the compact reducers and assert each is a single
    # NumPy axis of length draw_count.
    seen: list[np.ndarray] = []
    real = core_mod.to_quantile_grid

    def spy(draws):
        seen.append(np.asarray(draws))
        return real(draws)

    monkeypatch.setattr(core_mod, "to_quantile_grid", spy)
    _run(draw_count=5000)
    assert seen, "expected at least one yardage marginal reduced"
    for arr in seen:
        assert arr.ndim == 1
        assert arr.shape == (5000,)


# --- Sparse and zero evidence -----------------------------------------------


def test_sparse_player_projects_low_confidence_wide() -> None:
    result = _run(players=_players(n_eff_override={"kc_wr": 1}))
    wr_projs = [p for p in result.projections if p.player_id == "kc_wr"]
    assert wr_projs, "a one-game player still projects (wide, low), not declines"
    for p in wr_projs:
        assert p.confidence == CONFIDENCE_LOW


def test_confidence_is_not_inflated_by_draw_count() -> None:
    # Same inputs at 1,000 vs 20,000 draws -> same ordinal confidence per stat.
    small = {(p.player_id, p.stat_type): p.confidence for p in _run(draw_count=1000).projections}
    large = {(p.player_id, p.stat_type): p.confidence for p in _run(draw_count=20000).projections}
    assert small == large


def test_zero_evidence_declines_with_insufficient_evidence() -> None:
    players = _players(n_eff_override={"kc_te": 0})
    result = _run(players=players)
    te_projs = [p for p in result.projections if p.player_id == "kc_te"]
    assert te_projs == [], "a zero-evidence player must not produce a distribution"
    te_declines = [d for d in result.declines if d.player_id == "kc_te"]
    assert te_declines, "a zero-evidence player must produce a decline"
    for d in te_declines:
        assert isinstance(d, Unprojectable)
        assert d.reason == REASON_INSUFFICIENT_EVIDENCE


# --- Low-count zero mass ----------------------------------------------------


def test_td_pmf_retains_large_zero_mass() -> None:
    result = _run(draw_count=20000)
    td = next(p for p in result.projections if p.stat_type == "rushing_tds")
    assert td.distribution_kind == DISTRIBUTION_KIND_PMF
    assert td.pmf is not None
    assert td.pmf[0] > 0.5, f"expected large P(0 TDs), got {td.pmf[0]}"
    assert sum(td.pmf) == pytest.approx(1.0)


def test_yardage_stored_as_quantile_grid() -> None:
    result = _run()
    ry = next(p for p in result.projections if p.stat_type == "passing_yards")
    assert ry.distribution_kind == DISTRIBUTION_KIND_QUANTILES
    assert ry.quantiles is not None
    assert set(ry.quantiles) == {"q01", "q05", "q10", "q25", "q50", "q75", "q90", "q95", "q99"}
    assert ry.pmf is None


# --- Joint outcome signs ----------------------------------------------------


def test_qb_and_his_wr_yards_correlate_positively() -> None:
    result = _run(draw_count=20000)
    pairs = {
        (r.player_a, r.stat_a, r.player_b, r.stat_b): r.correlation
        for r in result.correlations
    }
    # Find the QB passing_yards vs WR receiving_yards pair in either order.
    corr = None
    for (pa, sa, pb, sb), c in pairs.items():
        names = {(pa, sa), (pb, sb)}
        if {("kc_qb", "passing_yards"), ("kc_wr", "receiving_yards")} == names:
            corr = c
    assert corr is not None, "expected a QB-passing / WR-receiving correlation record"
    assert corr > 0.0, f"shared pass volume should correlate positively, got {corr}"


def test_two_backs_carries_correlate_negatively() -> None:
    result = _run(draw_count=20000)
    corr = None
    for r in result.correlations:
        names = {(r.player_a, r.stat_a), (r.player_b, r.stat_b)}
        if {("kc_rb1", "rushing_yards"), ("kc_rb2", "rushing_yards")} == names:
            corr = r.correlation
    assert corr is not None, "expected a competing-backs correlation record"
    assert corr < 0.0, f"competing carries should correlate negatively, got {corr}"


def test_correlations_are_within_bounds_and_among_projected_marginals() -> None:
    result = _run()
    projected = {(p.player_id, p.stat_type) for p in result.projections}
    for r in result.correlations:
        assert -1.0 <= r.correlation <= 1.0
        assert (r.player_a, r.stat_a) in projected
        assert (r.player_b, r.stat_b) in projected


def test_compute_correlations_rejects_unknown_method() -> None:
    with pytest.raises(ValueError):
        compute_correlations({}, method="pearson")


# --- Compact helpers: PMF / quantile correctness ----------------------------


def test_to_pmf_on_a_hand_array() -> None:
    # counts: three 0s, two 1s, one 2, one 5 (tail for k=4)
    draws = np.array([0, 0, 0, 1, 1, 2, 5], dtype=np.int64)
    pmf = to_pmf(draws, k=4)
    assert len(pmf) == 6  # 0..4 plus (5)+ tail
    assert pmf[0] == pytest.approx(3 / 7)
    assert pmf[1] == pytest.approx(2 / 7)
    assert pmf[2] == pytest.approx(1 / 7)
    assert pmf[3] == 0.0
    assert pmf[4] == 0.0
    assert pmf[5] == pytest.approx(1 / 7)  # the 5 lands in the tail
    assert sum(pmf) == pytest.approx(1.0)


def test_to_quantile_grid_on_a_hand_array() -> None:
    draws = np.arange(0, 101, dtype=np.float64)  # 0..100
    grid = to_quantile_grid(draws)
    assert grid["q50"] == pytest.approx(50.0)
    assert grid["q10"] == pytest.approx(10.0)
    assert grid["q90"] == pytest.approx(90.0)


def test_prob_at_least_from_pmf_is_a_tail_sum() -> None:
    pmf = [0.5, 0.3, 0.15, 0.05]  # k=2 -> indices 0,1,2, tail=3+
    assert prob_at_least_from_pmf(pmf, 0.5) == pytest.approx(0.5)  # ceil .5 -> 1
    assert prob_at_least_from_pmf(pmf, 1.5) == pytest.approx(0.2)  # ceil -> 2: 0.15+0.05
    assert prob_at_least_from_pmf(pmf, -1) == 1.0


def test_grid_threshold_prob_matches_empirical_fraction() -> None:
    # A threshold probability read off the STORED grid should match the empirical
    # draw fraction within tolerance — the whole point of storing the grid.
    rng = np.random.default_rng(123)
    draws = rng.lognormal(mean=4.0, sigma=0.6, size=50000)
    grid = to_quantile_grid(draws)
    for threshold in (30.0, 55.0, 90.0, 150.0):
        empirical = float(np.mean(draws >= threshold))
        from_grid = prob_at_least_from_quantiles(grid, threshold)
        assert from_grid == pytest.approx(empirical, abs=0.05), (
            f"threshold {threshold}: grid {from_grid} vs empirical {empirical}"
        )


def test_projections_carry_full_provenance() -> None:
    result = _run()
    for p in result.projections:
        assert p.model_version == SIMULATION_MODEL_VERSION
        assert p.computed_at is not None
        assert p.information_cutoff == CUTOFF
        assert p.confidence in {"high", "medium", "low"}
        assert 3 <= len(p.drivers) <= 5
        # No driver may reference a value the sim did not use: every driver is a
        # sentence about volume, role depth, efficiency, or the projected mean.
        assert all(isinstance(d, str) and d for d in p.drivers)
    # asdict round-trips (dataclass, JSON-serialisable compact form).
    assert asdict(result.projections[0])


def test_driver_omits_volume_sentence_for_untracked_team() -> None:
    # Review fix: a player whose resolved team is absent from the game's
    # environment gets team_volume_mean == 0. The driver must NOT fabricate a
    # "Expected team volume 0 plays, 100% below the league" claim (the pitch's
    # "driver theater" no-go); it omits the volume sentence and keeps the honest
    # role-history / efficiency / projected-mean drivers.
    from sightline_model.simulation.core import PlayerSimInput, _drivers

    eff = PlayerEfficiency(
        player_id="rb1", position="RB", n_eff=8, yards_per_carry=4.5
    )
    player = PlayerSimInput(
        player_id="rb1",
        team_abbr="XXX",
        position="RB",
        efficiency=eff,
        n_eff=8,
        requested_stats=("rushing_yards",),
    )

    untracked = _drivers(
        stat_type="rushing_yards",
        player=player,
        team_volume_mean=0.0,
        league_volume_ref=120.0,
        player_stat_mean=55.0,
    )
    assert all(
        "below the league" not in d and "0 plays" not in d for d in untracked
    )
    assert any("role-history" in d for d in untracked)  # honest drivers remain

    # A player whose team WAS simulated still gets the volume sentence.
    tracked = _drivers(
        stat_type="rushing_yards",
        player=player,
        team_volume_mean=125.0,
        league_volume_ref=120.0,
        player_stat_mean=55.0,
    )
    assert any("Expected team volume" in d for d in tracked)
