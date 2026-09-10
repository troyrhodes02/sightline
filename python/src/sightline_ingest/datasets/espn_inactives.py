"""ESPN inactives — the first Adjustment Suggestions source (SIG-76).

ESPN's inactives feed is undocumented, unauthenticated, and explicitly treated as
non-critical (Architecture Doc). It is registered as an OPTIONAL cycle source: if
it is unavailable the cycle still succeeds, no new suggestions fire, and affected
games stay honestly stale under the existing Pitch 5 mechanism. The bot NEVER
infers a player's status from Kalshi price movement as a substitute — this module
reads no market data at all (the import-graph guard sweeps it).

The feed writes ``AdjustmentSourceEvent`` rows only (via the SIG-75 engine), never
``PlayerGameContext``, so an unproven source can never reach the as-of feature
path and change a projection automatically. It proposes; William disposes.

Design for a schema that can change under us: the parser reads defensively and an
unexpected shape raises :class:`EspnInactivesError`, which the cycle records as a
per-source ingest failure — never a crash and never a silent gap. The HTTP fetch
is injectable so the orchestration is testable without the network.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import requests

from ..db import ConnectionFactory
from ..identity_resolution import RESOLVED, NameIndex, Resolution
from ..provenance import IngestRunHandle
from ..registry import Dataset, register

# Statuses ESPN publishes that mean "expected to sit". Mapped to claim values the
# engine understands. Anything else (e.g. an "active"/cleared report) is a valid
# reversal claim but redistributes no usage.
_STATUS_TO_CLAIM: dict[str, str] = {
    "out": "out",
    "inactive": "out",
    "doubtful": "doubtful",
    "questionable": "questionable",
    "active": "active",
}

_CLAIM_TYPE = "game_status"
_SOURCE = "espn"
# How far ahead a game must kick off to still be an actionable target.
_UPCOMING_WINDOW = timedelta(days=8)

# ESPN's public, unauthenticated site API (Architecture Doc: undocumented, non-
# critical). The scoreboard lists the current week's games; each game summary
# carries an ``injuries`` block — the weekly injury report — which we flatten
# into claims. There is no single ESPN endpoint in the flat shape the legacy
# ``SIGHTLINE_ESPN_INACTIVES_URL`` path expects, so the default source is this
# two-step adapter (scoreboard → per-game summary).
_ESPN_SCOREBOARD_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
)
_ESPN_SUMMARY_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"
)


class EspnInactivesError(RuntimeError):
    """A fetch or parse failure. Recorded as a failed (optional) ingest run."""


@dataclass(frozen=True)
class RawInactive:
    """One ESPN inactive report, source-verbatim before resolution."""

    player_name: str
    team_abbr: str
    status: str
    espn_player_id: str | None = None
    known_at: datetime | None = None


class EspnInactivesClient:
    """Thin, schema-tolerant client for ESPN's undocumented injury feed.

    Default path (no env override): ESPN's public site API — the scoreboard for
    the week's games, then each upcoming game's summary, whose ``injuries`` block
    is flattened into inactive reports. If ``SIGHTLINE_ESPN_INACTIVES_URL`` is
    set it is used instead as a single flat-shape endpoint (legacy/override),
    parsed by :func:`parse_payload`.

    Not exercised over the network in tests; the orchestration injects a
    ``fetch`` and the flatteners are unit-tested directly.
    """

    def __init__(
        self,
        session: requests.Session | None = None,
        timeout: int = 15,
        scoreboard_url: str = _ESPN_SCOREBOARD_URL,
        summary_url: str = _ESPN_SUMMARY_URL,
    ) -> None:
        self._session = session or requests.Session()
        self._timeout = timeout
        self._scoreboard_url = scoreboard_url
        self._summary_url = summary_url

    def _get(self, url: str, params: dict[str, str] | None = None) -> Any:
        try:
            resp = self._session.get(url, params=params, timeout=self._timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:  # network or bad JSON
            raise EspnInactivesError(f"ESPN fetch failed: {exc}") from None

    def fetch(self, *, now: datetime) -> list[RawInactive]:
        override = os.environ.get("SIGHTLINE_ESPN_INACTIVES_URL")
        if override:
            return parse_payload(self._get(override), now=now)
        return self._fetch_from_espn(now=now)

    def _fetch_from_espn(self, *, now: datetime) -> list[RawInactive]:
        board = self._get(self._scoreboard_url)
        events = board.get("events", []) if isinstance(board, dict) else []
        out: list[RawInactive] = []
        for event in events:
            if not isinstance(event, dict):
                continue
            # Only upcoming games — a live or final game's injury report is no
            # longer a pre-game claim. ESPN's state is "pre" | "in" | "post".
            state = (
                ((event.get("status") or {}).get("type") or {}).get("state")
            )
            if state and state != "pre":
                continue
            event_id = event.get("id")
            if not event_id:
                continue
            summary = self._get(self._summary_url, params={"event": str(event_id)})
            out.extend(parse_espn_summary(summary, now=now))
        return out


def parse_payload(payload: Any, *, now: datetime) -> list[RawInactive]:
    """Defensively extract inactive reports from an ESPN-shaped JSON payload.

    Accepts a top-level list, or a dict with an ``inactives``/``athletes`` list.
    A shape that yields no recognisable records from a non-empty payload raises,
    so a silently changed schema surfaces as an ingest failure rather than an
    empty (falsely-healthy) run.
    """
    records = _candidate_records(payload)
    out: list[RawInactive] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        name = _first_str(rec, ("player_name", "playerName", "athlete", "displayName", "name"))
        team = _first_str(rec, ("team_abbr", "teamAbbr", "team", "abbreviation"))
        status = _first_str(rec, ("status", "designation", "injuryStatus"))
        if not name or not team or not status:
            continue
        out.append(
            RawInactive(
                player_name=name,
                team_abbr=team.upper(),
                status=status.strip().lower(),
                espn_player_id=_first_str(rec, ("espn_id", "espnId", "id", "athleteId")),
                known_at=now,
            )
        )
    if records and not out:
        raise EspnInactivesError(
            "ESPN inactives payload had records but none were parseable — "
            "the source schema may have changed"
        )
    return out


def _candidate_records(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("inactives", "athletes", "items", "reports"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _first_str(rec: dict, keys: Iterable[str]) -> str | None:
    for k in keys:
        v = rec.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):  # e.g. {"athlete": {"displayName": ...}}
            nested = _first_str(v, ("displayName", "name", "abbreviation"))
            if nested:
                return nested
    return None


def parse_espn_summary(summary: Any, *, now: datetime) -> list[RawInactive]:
    """Flatten one ESPN game-summary ``injuries`` block into inactive reports.

    Shape (defensive): ``{"injuries": [{"team": {"abbreviation": "SF"},
    "injuries": [{"athlete": {"displayName": "...", "id": "..."},
    "status": "Out"}]}]}``. A record missing team, name, or status is skipped
    rather than raised — ESPN routinely omits fields and a game with no injury
    report is a legitimate empty result, not drift. ``known_at`` is the fetch
    time (a live source we observe now), never reconstructed.
    """
    out: list[RawInactive] = []
    groups = summary.get("injuries") if isinstance(summary, dict) else None
    if not isinstance(groups, list):
        return out
    for group in groups:
        if not isinstance(group, dict):
            continue
        team = _first_str(group, ("team", "abbreviation"))
        entries = group.get("injuries")
        if not team or not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            name = _first_str(entry, ("athlete", "displayName", "name"))
            status = _first_str(entry, ("status", "designation"))
            if not name or not status:
                continue
            athlete = entry.get("athlete")
            espn_id = None
            if isinstance(athlete, dict) and athlete.get("id") is not None:
                espn_id = str(athlete["id"])
            out.append(
                RawInactive(
                    player_name=name,
                    team_abbr=team.upper(),
                    status=status.strip().lower(),
                    espn_player_id=espn_id,
                    known_at=now,
                )
            )
    return out


def _rows(cur) -> list[dict[str, Any]]:
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _load_name_index(cur) -> NameIndex:
    cur.execute("select id, full_name from players")
    return NameIndex.from_players([(r["id"], r["full_name"]) for r in _rows(cur)])


def resolve_player(cur, raw: RawInactive, name_index: NameIndex) -> Resolution:
    """Resolve an ESPN report to a Sightline player id.

    Prefers the explicit ESPN external-id mapping; falls back to name matching.
    Ambiguous or unmatched reports are returned unresolved and never guessed onto
    the wrong player.
    """
    if raw.espn_player_id:
        cur.execute(
            "select player_id, status from player_external_ids "
            "where source = 'espn'::\"DataSource\" and external_id = %s "
            "and player_id is not null limit 1",
            (raw.espn_player_id,),
        )
        found = _rows(cur)
        if found and found[0]["player_id"]:
            return Resolution(RESOLVED, player_id=found[0]["player_id"])
    return name_index.resolve(raw.player_name)


def map_game(cur, *, team_abbr: str, now: datetime) -> dict[str, Any] | None:
    """The upcoming scheduled game the team plays, with the fields the engine needs."""
    cur.execute(
        "select g.id, g.season, g.is_dome, g.kickoff_at, "
        "ht.nflverse_abbr as home_abbr, at.nflverse_abbr as away_abbr "
        "from games g "
        "join teams ht on ht.id = g.home_team_id "
        "join teams at on at.id = g.away_team_id "
        "where g.status = 'scheduled'::\"GameStatus\" "
        "and g.kickoff_at > %s and g.kickoff_at <= %s "
        "and (ht.nflverse_abbr = %s or at.nflverse_abbr = %s) "
        "order by g.kickoff_at asc limit 1",
        (now, now + _UPCOMING_WINDOW, team_abbr, team_abbr),
    )
    found = _rows(cur)
    return found[0] if found else None


def run_espn_inactives(
    handle: IngestRunHandle,
    connect: ConnectionFactory,
    season_from: int | None,
    season_to: int | None,
    /,
    *,
    fetch: Callable[..., list[RawInactive]] | None = None,
    models: Any = None,
    now: datetime | None = None,
    **_: object,
) -> None:
    """Fetch ESPN inactives and feed each into the Adjustment Suggestions engine.

    **On by default** via the ESPN site-API adapter (scoreboard → per-game
    summary injury reports); no configuration is required. It can be turned off
    without a deploy by setting ``SIGHTLINE_ESPN_INACTIVES_DISABLED`` — the run
    is then marked ``degraded`` (deliberately off), never ``failed``, so an
    intentionally-disabled optional source adds no error noise to a healthy
    cycle. ``SIGHTLINE_ESPN_INACTIVES_URL`` still overrides the adapter with a
    single flat-shape endpoint (legacy).

    A fetch failure raises :class:`EspnInactivesError` — recorded by the cycle as
    a failed OPTIONAL source, which never fails the cycle. Unresolvable reports
    are counted and skipped; the run is marked partial so the gap is visible.
    """
    # Explicitly disabled → deliberately-off, not broken. Only gate the real
    # client; an injected fetch (tests) always proceeds.
    if fetch is None and os.environ.get("SIGHTLINE_ESPN_INACTIVES_DISABLED"):
        handle.mark_degraded(
            "ESPN inactives disabled via SIGHTLINE_ESPN_INACTIVES_DISABLED; "
            "source off — affected games stay honestly stale (Pitch 5)"
        )
        return

    # Imported lazily so the ingest package does not hard-depend on the modelling
    # package at import time (and so the import-graph sweep stays clean).
    from sightline_ingest.asof import AsOfCorpus
    from sightline_model.simulation import live
    from sightline_model.suggestions.engine import Observation, process_observation

    resolved_now = now or datetime.now()

    # Building a suggestion means re-simulating the injured player's usage
    # redistributed, which needs the fitted Simulation Engine artefacts. Until
    # they are provisioned to this runtime (the Simulation Engine is not yet
    # deployed — production runs on the baseline model), there is nothing this
    # source can do: mark it DEGRADED (deliberately-off, like an unconfigured
    # source) rather than letting a missing-artefact FileNotFoundError read as a
    # per-cycle FAILURE. Checked before the network fetch so a models-absent
    # runtime does no work at all. An injected `models` (tests) skips this.
    if models is not None:
        sim_models = models
    else:
        try:
            sim_models = live.load_simulation_models()
        except (FileNotFoundError, OSError) as exc:
            handle.mark_degraded(
                "ESPN inactives: Simulation Engine models not provisioned "
                f"({exc}); suggestions disabled until the models are staged"
            )
            return

    fetcher = fetch or EspnInactivesClient().fetch
    raws = fetcher(now=resolved_now)

    created = 0
    unresolved = 0
    processed = 0

    with connect() as conn:
        with conn.cursor() as cur:
            name_index = _load_name_index(cur)

        for raw in raws:
            claim_value = _STATUS_TO_CLAIM.get(raw.status)
            if claim_value is None:
                continue

            with conn.cursor() as cur:
                resolution = resolve_player(cur, raw, name_index)
                if resolution.status != RESOLVED or not resolution.player_id:
                    unresolved += 1
                    continue
                game = map_game(cur, team_abbr=raw.team_abbr, now=resolved_now)
            if game is None:
                continue

            observation = Observation(
                source=_SOURCE,
                subject_player_id=resolution.player_id,
                game_id=game["id"],
                claim_type=_CLAIM_TYPE,
                claim_value=claim_value,
                evidence_text=(
                    f"ESPN inactives: {raw.player_name} listed "
                    f"{raw.status.upper()} ({raw.team_abbr})"
                ),
                known_at=raw.known_at or resolved_now,
                ingest_run_id=handle.run_id,
            )
            game_dict = {
                "id": game["id"],
                "season": game["season"],
                "home_abbr": game["home_abbr"],
                "away_abbr": game["away_abbr"],
                "is_dome": bool(game["is_dome"]),
                "kickoff_at": game["kickoff_at"],
            }
            result = process_observation(
                conn,
                lambda cutoff: AsOfCorpus(connect, cutoff),
                observation=observation,
                game=game_dict,
                models=sim_models,
                now=resolved_now,
            )
            created += result.suggestions_created
            processed += 1
        conn.commit()

    handle.rows_written = created
    if unresolved:
        handle.mark_partial(
            f"{unresolved} ESPN report(s) unresolved to a player; skipped, not guessed"
        )


register(Dataset(name="espn_inactives", source=_SOURCE, run=run_espn_inactives))
