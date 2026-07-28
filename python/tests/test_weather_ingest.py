"""Weather ingest: era policy + the distinct degraded states. Requires a database."""

from __future__ import annotations

from datetime import timedelta

import polars as pl
import pytest

from sightline_ingest.datasets._common import game_id, parse_kickoff
from sightline_ingest.datasets.schedule import ingest_schedule
from sightline_ingest.datasets.teams import ingest_teams
from sightline_ingest.datasets.weather import ingest_weather
from sightline_ingest.provenance import IngestRunHandle
from sightline_ingest.stadiums import STADIUM_COORDS
from sightline_ingest.weather_source import OpenMeteoError, WeatherReading

pytestmark = pytest.mark.db


def _h(dataset: str) -> IngestRunHandle:
    return IngestRunHandle(source="open_meteo", dataset=dataset)


def _teams_df() -> pl.DataFrame:
    return pl.DataFrame({
        "team_abbr": ["KC", "DET", "NO"], "team_name": ["KC", "DET", "NO"],
        "team_conf": ["AFC", "NFC", "NFC"], "team_division": ["W", "N", "S"],
    })


def _schedule_df() -> pl.DataFrame:
    # Six games: 2023 outdoor (archived), 2020 outdoor (reanalysis),
    # 2023 dome (NO home), 2023 outdoor with a home team missing from coords,
    # 2023 closed retractable roof (indoor conditions), 2023 London neutral site.
    return pl.DataFrame({
        "game_id": ["2023_01_DET_KC", "2020_01_DET_KC", "2023_02_KC_NO",
                    "2023_03_DET_KC", "2023_04_KC_NO", "2023_05_DET_KC"],
        "season": [2023, 2020, 2023, 2023, 2023, 2023],
        "week": [1, 1, 2, 3, 4, 5],
        "game_type": ["REG"] * 6,
        "gameday": ["2023-09-07", "2020-09-13", "2023-09-14",
                    "2023-09-21", "2023-09-28", "2023-10-01"],
        "gametime": ["20:20", "13:00", "20:15", "20:15", "20:15", "09:30"],
        "home_team": ["KC", "KC", "NO", "DET", "NO", "KC"],
        "away_team": ["DET", "DET", "KC", "KC", "KC", "DET"],
        "roof": ["outdoors", "outdoors", "dome", "outdoors", "closed", "outdoors"],
        "stadium": ["Arrowhead", "Arrowhead", "Superdome", "Ford Field",
                    "Superdome", "Wembley Stadium"],
        "location": ["Home", "Home", "Home", "Home", "Home", "Neutral"],
        "result": [3, 7, 3, 3, 3, 3],
    })


class FakeClient:
    def __init__(self, *, fail: bool = False, reading: WeatherReading | None = None) -> None:
        self.fail = fail
        self.reading = reading
        self.calls: list[tuple] = []

    def fetch(self, lat, lon, kickoff, era) -> WeatherReading:
        self.calls.append((lat, lon, era))
        if self.fail:
            raise OpenMeteoError("boom")
        return self.reading or WeatherReading(7.0, 18.0, 0.0, f"src_{era}")


@pytest.fixture
def games(connect, clean_db):
    ingest_teams(_h("teams"), connect, fetch=_teams_df)
    ingest_schedule(_h("schedule"), connect, 2020, 2023, fetch=lambda s: _schedule_df())
    return connect


def _weather_by_game(connect):
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select game_id, era, status, temperature_c, wind_kph, precipitation_mm, "
            "weather_source, known_at, known_at_reconstructed, valid_at from game_weather"
        )
        cols = [d[0] for d in cur.description]
        return {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}


def test_era_policy_and_observed_state(games) -> None:
    connect = games
    client = FakeClient()
    # Only ingest the two outdoor games' seasons; dome + missing handled in other tests.
    ingest_weather(_h("weather"), connect, 2020, 2023, client=client)
    rows = _weather_by_game(connect)

    archived = rows[game_id("2023_01_DET_KC")]
    reanalysis = rows[game_id("2020_01_DET_KC")]
    assert archived["era"] == "archived_forecast"
    assert reanalysis["era"] == "reanalysis"
    # Two eras distinguishable for split calibration.
    assert archived["era"] != reanalysis["era"]
    # Observed state carries measurements + a recorded source.
    assert archived["status"] == "observed"
    assert float(archived["temperature_c"]) == 7.0
    assert archived["weather_source"] == "src_archived_forecast"

    # validAt is the kickoff window the weather describes; knownAt is the
    # conservative pre-game bound per era. A forecast is known BEFORE the
    # window it describes (game_weather is exempt from known_at >= valid_at).
    kickoff_2023 = parse_kickoff("2023-09-07", "20:20")
    kickoff_2020 = parse_kickoff("2020-09-13", "13:00")
    assert archived["valid_at"] == kickoff_2023
    assert archived["known_at"] == kickoff_2023 - timedelta(hours=12)
    assert archived["known_at"] < archived["valid_at"]
    assert reanalysis["valid_at"] == kickoff_2020
    assert reanalysis["known_at"] == kickoff_2020 - timedelta(hours=24)
    # Both eras are reconstructed availability, flagged as such.
    assert archived["known_at_reconstructed"] is True
    assert reanalysis["known_at_reconstructed"] is True


def test_dome_game_has_no_measurements(games) -> None:
    connect = games
    client = FakeClient()
    ingest_weather(_h("weather"), connect, 2020, 2023, client=client)
    dome = _weather_by_game(connect)[game_id("2023_02_KC_NO")]
    assert dome["status"] == "dome"
    assert dome["temperature_c"] is None
    assert dome["wind_kph"] is None
    assert dome["precipitation_mm"] is None
    # The dome games (NO home) never trigger a fetch: NO's coordinates must
    # not appear among the client's calls.
    assert STADIUM_COORDS["NO"] not in [(lat, lon) for lat, lon, _era in client.calls]


def test_closed_retractable_roof_is_indoor(games) -> None:
    # nflverse roof='closed' means the retractable roof was shut: indoor
    # conditions. Outdoor readings must not be recorded for it.
    connect = games
    ingest_weather(_h("weather"), connect, 2020, 2023, client=FakeClient())
    closed = _weather_by_game(connect)[game_id("2023_04_KC_NO")]
    assert closed["status"] == "dome"
    assert closed["temperature_c"] is None


def test_neutral_site_degrades_explicitly(games) -> None:
    # A London game must not store Kansas City's weather as 'observed'.
    connect = games
    client = FakeClient()
    ingest_weather(_h("weather"), connect, 2020, 2023, client=client)
    neutral = _weather_by_game(connect)[game_id("2023_05_DET_KC")]
    assert neutral["status"] == "unavailable"
    assert neutral["weather_source"] == "neutral_site_venue_unmapped"
    assert neutral["temperature_c"] is None


def test_request_failed_is_distinct_and_retryable(games) -> None:
    connect = games
    ingest_weather(_h("weather"), connect, 2020, 2023, client=FakeClient(fail=True))
    rows = _weather_by_game(connect)
    outdoor = rows[game_id("2023_01_DET_KC")]
    assert outdoor["status"] == "request_failed"
    assert outdoor["temperature_c"] is None

    # A later successful run retries and updates the failed row.
    h = _h("weather")
    ingest_weather(h, connect, 2020, 2023, client=FakeClient())
    outdoor = _weather_by_game(connect)[game_id("2023_01_DET_KC")]
    assert outdoor["status"] == "observed"
    assert h.rows_updated >= 1


def test_unavailable_when_no_coordinates(games) -> None:
    connect = games
    # Empty coords -> every outdoor game is unavailable (dome still dome).
    ingest_weather(_h("weather"), connect, 2020, 2023, client=FakeClient(), coords={})
    rows = _weather_by_game(connect)
    assert rows[game_id("2023_01_DET_KC")]["status"] == "unavailable"
    assert rows[game_id("2023_01_DET_KC")]["temperature_c"] is None
    assert rows[game_id("2023_02_KC_NO")]["status"] == "dome"  # dome independent of coords


def test_missing_coordinate_specific_team(games) -> None:
    connect = games
    # DET missing from coords: its home game is unavailable; KC/NO resolve.
    coords = {"KC": (39.0, -94.5), "NO": (29.9, -90.0)}
    ingest_weather(_h("weather"), connect, 2020, 2023, client=FakeClient(), coords=coords)
    rows = _weather_by_game(connect)
    assert rows[game_id("2023_03_DET_KC")]["status"] == "unavailable"  # DET home, no coord
    assert rows[game_id("2023_01_DET_KC")]["status"] == "observed"     # KC home, has coord


def test_reingest_is_idempotent(games) -> None:
    connect = games
    reading = WeatherReading(10.0, 12.0, 1.0, "src_archived_forecast")
    ingest_weather(_h("weather"), connect, 2020, 2023, client=FakeClient(reading=reading))
    h = _h("weather")
    ingest_weather(h, connect, 2020, 2023, client=FakeClient(reading=reading))
    assert (h.rows_written, h.rows_updated) == (0, 0)
