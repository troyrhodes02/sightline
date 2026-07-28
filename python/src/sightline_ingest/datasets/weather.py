"""Per-game weather ingest under the era policy that prevents look-ahead bias.

One GameWeather row per game. Era is chosen by season: archived forecasts for
2021-forward (legitimately pre-knowable), ERA5 reanalysis before (an accepted,
recorded leak). Both eras record their source so calibration can be reported
split, never blended.

Three distinct states, never collapsed to one null:
  * dome          — indoor venue; weather bypassed by design, no measurements.
  * request_failed — the source was expected but the fetch failed; retryable.
  * unavailable   — no venue coordinates / no source covers the era; degraded.

knownAt / validAt: set to kickoff − 24h (a day-ahead availability), reconstructed
= true. For the archived era this is the conservative pre-game availability; for
the reanalysis era it is the reconstructed availability of the accepted leak. The
era field — not the reconstructed flag — is what keeps the two distinguishable
for split calibration. (A future enhancement can capture the archived forecast's
true issue time via Open-Meteo previous-runs, making that era observed.)
"""

from __future__ import annotations

from datetime import timedelta

from ..db import ConnectionFactory
from ..provenance import IngestRunHandle
from ..registry import Dataset, register
from ..stadiums import STADIUM_COORDS
from ..weather_source import SOURCE_IDS, OpenMeteoClient, OpenMeteoError
from ._common import season_range, to_decimal

ERA_CUTOFF = 2021  # 2021-forward -> archived_forecast; earlier -> reanalysis


def _era(season: int) -> str:
    return "archived_forecast" if season >= ERA_CUTOFF else "reanalysis"


_UPSERT = """
insert into game_weather (
    id, game_id, temperature_c, wind_kph, precipitation_mm,
    era, status, weather_source, valid_at, known_at, known_at_reconstructed,
    source, ingest_run_id, created_at
) values (
    gen_random_uuid(), %(game_id)s, %(temp)s, %(wind)s, %(precip)s,
    %(era)s, %(status)s, %(weather_source)s, %(valid_at)s, %(known_at)s, true,
    'open_meteo', %(run_id)s, now()
)
on conflict (game_id) do update
   set temperature_c = excluded.temperature_c,
       wind_kph = excluded.wind_kph,
       precipitation_mm = excluded.precipitation_mm,
       era = excluded.era,
       status = excluded.status,
       weather_source = excluded.weather_source,
       valid_at = excluded.valid_at,
       known_at = excluded.known_at
   where game_weather.status is distinct from excluded.status
      or game_weather.temperature_c is distinct from excluded.temperature_c
      or game_weather.wind_kph is distinct from excluded.wind_kph
      or game_weather.precipitation_mm is distinct from excluded.precipitation_mm
returning (xmax = 0) as inserted
"""


def ingest_weather(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None = None,
    season_to: int | None = None,
    *,
    client: OpenMeteoClient | None = None,
    coords: dict[str, tuple[float, float]] | None = None,
    **_: object,
) -> None:
    seasons = season_range(season_from, season_to)
    client = client or OpenMeteoClient()
    coords = STADIUM_COORDS if coords is None else coords

    written = updated = failed = 0
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select g.id, g.season, g.kickoff_at, g.is_dome, ht.nflverse_abbr "
                "from games g join teams ht on g.home_team_id = ht.id "
                "where g.season between %s and %s",
                (season_from, season_to),
            )
            games = cur.fetchall()

            for gid, season, kickoff, is_dome, home_abbr in games:
                era = _era(season)
                known = kickoff - timedelta(hours=24)
                row = {
                    "game_id": gid, "era": era,
                    "valid_at": known, "known_at": known, "run_id": handle.run_id,
                    "temp": None, "wind": None, "precip": None,
                }

                if is_dome:
                    row.update(status="dome", weather_source="dome_indoor_venue")
                else:
                    latlon = coords.get(home_abbr)
                    if latlon is None:
                        row.update(status="unavailable", weather_source="none")
                    else:
                        try:
                            reading = client.fetch(latlon[0], latlon[1], kickoff, era)
                            row.update(
                                status="observed",
                                weather_source=reading.source_id,
                                temp=to_decimal(reading.temperature_c),
                                wind=to_decimal(reading.wind_kph),
                                precip=to_decimal(reading.precipitation_mm),
                            )
                        except OpenMeteoError:
                            failed += 1
                            row.update(status="request_failed", weather_source=SOURCE_IDS[era])

                cur.execute(_UPSERT, row)
                result = cur.fetchone()
                if result is None:
                    continue
                if result[0]:
                    written += 1
                else:
                    updated += 1
        conn.commit()

    handle.rows_written = written
    handle.rows_updated = updated
    if failed:
        handle.mark_partial(f"{failed} games recorded request_failed (retryable)")


register(Dataset(name="weather", source="open_meteo", run=ingest_weather))
