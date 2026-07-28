"""Identity ingest against the database: nflverse/ESPN population and Kalshi
name resolution, including the manual-override protection. Requires a database."""

from __future__ import annotations

import json

import polars as pl
import pytest

from sightline_ingest.datasets._common import player_id
from sightline_ingest.datasets.identities import ingest_identities
from sightline_ingest.datasets.players import ingest_players
from sightline_ingest.provenance import IngestRunHandle

pytestmark = pytest.mark.db

GSIS_MAHOMES = "00-0033873"
GSIS_CHASE = "00-0036900"


def _handle(dataset: str = "identities") -> IngestRunHandle:
    return IngestRunHandle(source="nflverse", dataset=dataset)


def _players_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "gsis_id": [GSIS_MAHOMES, GSIS_CHASE],
            "display_name": ["Patrick Mahomes", "Ja'Marr Chase"],
            "position": ["QB", "WR"],
            "birth_date": ["1995-09-17", "2000-03-01"],
            "espn_id": ["3139477", "4362628"],
        }
    )


@pytest.fixture
def seeded_players(connect, clean_db):
    ingest_players(_handle("players"), connect, fetch=_players_df)
    return connect


def test_nflverse_and_espn_ids_populate_resolved_and_are_idempotent(seeded_players) -> None:
    connect = seeded_players
    h1 = _handle()
    ingest_identities(h1, connect, fetch=_players_df)
    assert h1.rows_written == 4  # 2 nflverse + 2 espn

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select source, external_id, player_id, status from player_external_ids "
            "order by source, external_id"
        )
        rows = cur.fetchall()
    assert len(rows) == 4
    # nflverse gsis maps to the deterministic player id, status resolved.
    nfl = [r for r in rows if r[0] == "nflverse"]
    assert all(r[3] == "resolved" and r[2] is not None for r in nfl)
    assert any(r[1] == GSIS_MAHOMES and r[2] == player_id(GSIS_MAHOMES) for r in nfl)

    # Re-run: no duplicates, no changes.
    h2 = _handle()
    ingest_identities(h2, connect, fetch=_players_df)
    assert (h2.rows_written, h2.rows_updated) == (0, 0)


def test_kalshi_resolution_resolved_ambiguous_unresolved(seeded_players, tmp_path) -> None:
    connect = seeded_players
    samples = [
        {"ticker": "K-MAHOMES", "name": "Patrick Mahomes"},   # resolved
        {"ticker": "K-CHASE-APOS", "name": "Ja'Marr Chase"},  # resolved (apostrophe)
        {"ticker": "K-CHASE-NOAPOS", "name": "JaMarr Chase"}, # resolved (same player)
        {"ticker": "K-UNKNOWN", "name": "Nobody Here"},       # unresolved
    ]
    path = tmp_path / "kalshi.json"
    path.write_text(json.dumps(samples), encoding="utf-8")

    handle = _handle()
    ingest_identities(handle, connect, source="kalshi", from_samples=str(path))

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select external_name, status, player_id from player_external_ids "
            "where source = 'kalshi' order by external_id"
        )
        rows = {name: (status, pid) for name, status, pid in cur.fetchall()}

    assert rows["Patrick Mahomes"][0] == "resolved"
    assert rows["Patrick Mahomes"][1] == player_id(GSIS_MAHOMES)
    assert rows["Ja'Marr Chase"] == ("resolved", player_id(GSIS_CHASE))
    # Missing apostrophe still resolves to the same canonical player.
    assert rows["JaMarr Chase"] == ("resolved", player_id(GSIS_CHASE))
    # Unknown is retained as unresolved with no player — never dropped or guessed.
    assert rows["Nobody Here"] == ("unresolved", None)


def test_ambiguous_kalshi_name_retains_candidates(connect, clean_db, tmp_path) -> None:
    # Two distinct players sharing a rendered surname; an abbreviated Kalshi name
    # must stay ambiguous with both candidates.
    df = pl.DataFrame(
        {
            "gsis_id": ["00-0000001", "00-0000002"],
            "display_name": ["Jared Chase", "Jamal Chase"],
            "position": ["WR", "WR"],
            "birth_date": ["1998-01-01", "1999-01-01"],
            "espn_id": ["1", "2"],
        }
    )
    ingest_players(_handle("players"), connect, fetch=lambda: df)

    path = tmp_path / "k.json"
    path.write_text(json.dumps([{"ticker": "K-CHASE", "name": "J. Chase"}]), encoding="utf-8")
    ingest_identities(_handle(), connect, source="kalshi", from_samples=str(path))

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select status, player_id, candidate_ids from player_external_ids where source='kalshi'"
        )
        status, pid, candidates = cur.fetchone()
    assert status == "ambiguous"
    assert pid is None  # consistent with external_id_resolution_consistent
    assert set(candidates) == {player_id("00-0000001"), player_id("00-0000002")}


def test_manual_override_is_not_overwritten_by_automatic_pass(seeded_players, tmp_path) -> None:
    connect = seeded_players
    path = tmp_path / "k.json"
    path.write_text(json.dumps([{"ticker": "K-X", "name": "Mystery Player"}]), encoding="utf-8")

    # First pass: unresolved.
    ingest_identities(_handle(), connect, source="kalshi", from_samples=str(path))

    # Operator manually maps it to Mahomes.
    override_pid = player_id(GSIS_MAHOMES)
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "update player_external_ids "
                "set player_id = %s, status = 'manual_override', "
                "    resolved_by = 'operator', resolved_at = now() "
                "where source = 'kalshi' and external_name = 'Mystery Player'",
                (override_pid,),
            )
        conn.commit()

    # A later automatic pass must NOT overwrite the override.
    ingest_identities(_handle(), connect, source="kalshi", from_samples=str(path))

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select status, player_id, resolved_by from player_external_ids "
            "where source = 'kalshi' and external_name = 'Mystery Player'"
        )
        status, pid, resolved_by = cur.fetchone()
    assert status == "manual_override"
    assert pid == override_pid
    assert resolved_by == "operator"
