"""Home-venue coordinates per team, for weather lookups.

City-level accuracy is sufficient — game-time weather does not vary meaningfully
within a metro. Includes relocated franchises (OAK/SD/STL and their successors)
so 1999-forward home games resolve. A home team not in this map yields
WeatherStatus.unavailable (surfaced), never a guessed location.
"""

from __future__ import annotations

# team_abbr -> (latitude, longitude)
STADIUM_COORDS: dict[str, tuple[float, float]] = {
    "ARI": (33.5277, -112.2626),
    "ATL": (33.7554, -84.4009),
    "BAL": (39.2780, -76.6227),
    "BUF": (42.7738, -78.7870),
    "CAR": (35.2258, -80.8528),
    "CHI": (41.8623, -87.6167),
    "CIN": (39.0955, -84.5161),
    "CLE": (41.5061, -81.6995),
    "DAL": (32.7473, -97.0945),
    "DEN": (39.7439, -105.0201),
    "DET": (42.3400, -83.0456),
    "GB": (44.5013, -88.0622),
    "HOU": (29.6847, -95.4107),
    "IND": (39.7601, -86.1639),
    "JAX": (30.3239, -81.6373),
    "KC": (39.0489, -94.4839),
    "LA": (34.0141, -118.2879),
    "LAC": (33.9535, -118.3392),
    "LAR": (33.9535, -118.3392),
    "LV": (36.0909, -115.1833),
    "MIA": (25.9580, -80.2389),
    "MIN": (44.9736, -93.2575),
    "NE": (42.0909, -71.2643),
    "NO": (29.9511, -90.0812),
    "NYG": (40.8135, -74.0745),
    "NYJ": (40.8135, -74.0745),
    "OAK": (37.7516, -122.2005),
    "PHI": (39.9008, -75.1675),
    "PIT": (40.4468, -80.0158),
    "SD": (32.7831, -117.1196),
    "SEA": (47.5952, -122.3316),
    "SF": (37.4030, -121.9698),
    "STL": (38.6328, -90.1885),
    "TB": (27.9759, -82.5033),
    "TEN": (36.1665, -86.7713),
    "WAS": (38.9077, -76.8645),
}
