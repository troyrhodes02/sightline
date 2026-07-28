"""Open-Meteo client for the weather era policy.

Two datasets, chosen by era:

  * archived_forecast (2021+) — the Previous Runs API, requesting the
    ``*_previous_day1`` variables: the value each model PREDICTED one day
    ahead of the hour, not the best-match value the plain historical-forecast
    endpoint serves. Best-match hourly values come from the shortest-lead run
    (≈0–6h before the hour) and are nearly the actual weather; stamping those
    as day-ahead-available would be a leak inside the era that split
    calibration treats as clean. The previous-day value is what a Saturday
    reader could genuinely have known about Sunday's wind.
  * reanalysis (pre-2021) — the ERA5 Archive API: what the weather actually
    was, assembled after the fact. Using it for prediction is an accepted,
    RECORDED leak (era = reanalysis), reported split in backtest calibration.

Open-Meteo requires no API key. Attribution (CC BY 4.0) is a build requirement.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import requests

ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"

_PREVIOUS_RUNS_ENDPOINT = "https://previous-runs-api.open-meteo.com/v1/forecast"
_REANALYSIS_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive"

# Hourly variables per era. The archived era uses the day-ahead (previous_day1)
# view of each variable; reanalysis has no lead-time dimension.
_HOURLY_VARS = {
    "archived_forecast": {
        "temperature": "temperature_2m_previous_day1",
        "wind": "wind_speed_10m_previous_day1",
        "precipitation": "precipitation_previous_day1",
    },
    "reanalysis": {
        "temperature": "temperature_2m",
        "wind": "wind_speed_10m",
        "precipitation": "precipitation",
    },
}

# Specific dataset ids recorded per weather record (WeatherEra values as keys).
SOURCE_IDS = {
    "archived_forecast": "openmeteo_previous_day1_forecast_v1",
    "reanalysis": "openmeteo_era5_archive_v1",
}


class OpenMeteoError(RuntimeError):
    """A weather fetch failed. Recorded as WeatherStatus.request_failed (retryable)."""


@dataclass(frozen=True)
class WeatherReading:
    temperature_c: float | None
    wind_kph: float | None
    precipitation_mm: float | None
    source_id: str


class OpenMeteoClient:
    def __init__(self, session: requests.Session | None = None, timeout: int = 30) -> None:
        self._session = session or requests.Session()
        self._timeout = timeout

    def fetch(self, lat: float, lon: float, kickoff: datetime, era: str) -> WeatherReading:
        endpoint = (
            _PREVIOUS_RUNS_ENDPOINT if era == "archived_forecast" else _REANALYSIS_ENDPOINT
        )
        variables = _HOURLY_VARS[era]
        source_id = SOURCE_IDS[era]
        date = kickoff.strftime("%Y-%m-%d")
        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": date,
            "end_date": date,
            "hourly": ",".join(variables.values()),
            "wind_speed_unit": "kmh",
            "timezone": "UTC",
        }
        try:
            resp = self._session.get(endpoint, params=params, timeout=self._timeout)
            resp.raise_for_status()
            data = resp.json()
        except (requests.RequestException, ValueError) as exc:
            raise OpenMeteoError(f"open-meteo request failed for {era}: {exc}") from exc

        hourly = data.get("hourly") or {}
        times = hourly.get("time") or []
        target = kickoff.strftime("%Y-%m-%dT%H:00")
        if target not in times:
            raise OpenMeteoError(f"open-meteo returned no hourly row for {target}")
        i = times.index(target)

        def _at(key: str) -> float | None:
            values = hourly.get(key) or []
            return values[i] if i < len(values) else None

        return WeatherReading(
            temperature_c=_at(variables["temperature"]),
            wind_kph=_at(variables["wind"]),
            precipitation_mm=_at(variables["precipitation"]),
            source_id=source_id,
        )
