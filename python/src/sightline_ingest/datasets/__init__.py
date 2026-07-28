"""Dataset ingest modules.

Importing this package registers every available dataset in
``sightline_ingest.registry``. It is intentionally empty in this PR — the
reference, identity, fact, context, and weather datasets are added by later PRs,
each importing ``registry.register`` to add itself here.
"""

from __future__ import annotations

from . import (  # noqa: F401,E402 - import registers datasets
    teams, players, schedule, identities, pbp, stats, context, weather,
)
