"""Feature assembly. The only input is an ``AsOfCorpus`` instance.

Not a connection factory, not a DSN, not a raw DataFrame obtained elsewhere.
A feature function that *could* open its own connection could read a fact table
without a cutoff, and removing that possibility is cheaper and more durable
than testing for its absence. Everything here therefore inherits the temporal
guarantee from the corpus object it was handed: rows known after the cutoff are
absent from the result set, not filtered out of it afterward.

Two rules do the work that would otherwise leak:

* **Eligibility is per stat.** A prior game counts only if its stat line was
  visible at the cutoff *and* the stat's own column is non-null. A null column
  is absence, never zero — a quarterback's null ``receiving_yards`` is not a
  zero-yard receiving performance, and averaging it as one would drag every
  quarterback's receiving projection toward a number no quarterback ever posts.
* **Ages are counted in eligible games, never in weeks.** A player returning
  from a four-week absence has a four-week-old last game and a one-game-old
  one. Weighting by calendar would silently discount everyone coming back from
  injury, which is exactly the population whose projections matter most.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import polars as pl

from sightline_ingest.asof import AsOfCorpus

from .constants import HALF_LIFE_GAMES, RETURNING_ABSENCE_WEEKS, TRAILING_WINDOW
from .stat_types import StatTypeSpec


@dataclass(frozen=True)
class EligibleHistory:
    """What a player's record looked like at the cutoff, for one stat.

    ``values`` is oldest-first. ``n_eff`` is the count of eligible games, which
    drives both shrinkage and confidence — it is the number a reader needs to
    judge a projection, so it travels with the projection rather than being
    recomputable in principle.
    """

    player_id: str
    values: list[float]
    game_ids: list[str]
    kickoffs: list[datetime]
    seasons: list[int]

    @property
    def n_eff(self) -> int:
        return len(self.values)

    @property
    def window(self) -> list[float]:
        """The most recent ``TRAILING_WINDOW`` eligible values, oldest-first."""
        return self.values[-TRAILING_WINDOW:]

    def weights(self) -> list[float]:
        """Exponential weights over ``window``, normalised, oldest-first.

        Age is the position from the most recent eligible game, in games.
        """
        window = self.window
        raw = [0.5 ** (age / HALF_LIFE_GAMES) for age in range(len(window) - 1, -1, -1)]
        total = sum(raw)
        return [w / total for w in raw]

    def ew_mean(self) -> float | None:
        window = self.window
        if not window:
            return None
        return sum(w * v for w, v in zip(self.weights(), window))

    def zero_rate(self) -> float | None:
        window = self.window
        if not window:
            return None
        return sum(1 for v in window if v == 0.0) / len(window)

    def crosses_season_boundary(self) -> bool:
        return len(set(self.seasons[-TRAILING_WINDOW:])) > 1

    def weeks_since_last_game(self, kickoff: datetime) -> float | None:
        if not self.kickoffs:
            return None
        return (kickoff - self.kickoffs[-1]).days / 7.0

    def is_returning(self, kickoff: datetime) -> bool:
        gap = self.weeks_since_last_game(kickoff)
        return gap is not None and gap >= RETURNING_ABSENCE_WEEKS


def _history_from_rows(
    player_id: str, rows: list[dict], spec: StatTypeSpec
) -> EligibleHistory:
    values: list[float] = []
    game_ids: list[str] = []
    kickoffs: list[datetime] = []
    seasons: list[int] = []
    for row in rows:
        raw = row.get(spec.column)
        if raw is None:
            # Absence, not zero. See the module docstring.
            continue
        values.append(float(raw))
        game_ids.append(row["game_id"])
        kickoffs.append(row["kickoff_at"])
        seasons.append(row["season"])
    return EligibleHistory(
        player_id=player_id, values=values, game_ids=game_ids,
        kickoffs=kickoffs, seasons=seasons,
    )


def _with_seasons(frame: pl.DataFrame, seasons_by_game: dict[str, int]) -> list[dict]:
    rows = frame.to_dicts() if frame.height else []
    for row in rows:
        row["season"] = seasons_by_game.get(row["game_id"], 0)
    return rows


def assemble(
    corpus: AsOfCorpus,
    *,
    player_id: str,
    game_id: str,
    spec: StatTypeSpec,
    seasons_by_game: dict[str, int],
) -> EligibleHistory:
    """Eligible history for one player-stat, as of the corpus's cutoff."""
    frame = corpus.trailing_player_stats(player_id=player_id, before_game_id=game_id)
    return _history_from_rows(player_id, _with_seasons(frame, seasons_by_game), spec)


def assemble_batch(
    corpus: AsOfCorpus,
    *,
    player_ids: list[str],
    game_id: str,
    spec: StatTypeSpec,
    seasons_by_game: dict[str, int],
) -> dict[str, EligibleHistory]:
    """Eligible history for many players in one round trip.

    Every requested player appears in the result, including those with no
    eligible history at all — their ``EligibleHistory`` is empty and the engine
    declines. Omitting them would make "no history" indistinguishable from "not
    asked for", and the harness needs to tell those apart to reconcile its
    candidate count.
    """
    frame = corpus.trailing_player_stats_batch(
        player_ids=player_ids, before_game_id=game_id
    )
    grouped: dict[str, list[dict]] = {pid: [] for pid in player_ids}
    for row in _with_seasons(frame, seasons_by_game):
        pid = row["player_id"]
        if pid in grouped:
            grouped[pid].append(row)
    return {
        pid: _history_from_rows(pid, rows, spec) for pid, rows in grouped.items()
    }
