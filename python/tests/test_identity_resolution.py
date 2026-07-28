"""Pure name-resolution tests (no DB). The tricky-variant logic lives here."""

from __future__ import annotations

from sightline_ingest.identity_resolution import (
    AMBIGUOUS,
    RESOLVED,
    UNRESOLVED,
    NameIndex,
    normalize_tokens,
)

# (player_id, full_name) — a small canonical set with deliberate collisions.
CHASE = "p-chase-jamarr"
CHASE2 = "p-chase-jeremy"
MAHOMES = "p-mahomes"
STBROWN = "p-stbrown"
OBJ = "p-obj"
WILLIAMS_A = "p-williams-mike-a"
WILLIAMS_B = "p-williams-mike-b"


def _index() -> NameIndex:
    return NameIndex.from_players(
        [
            (CHASE, "Ja'Marr Chase"),
            (MAHOMES, "Patrick Mahomes"),
            (STBROWN, "Amon-Ra St. Brown"),
            (OBJ, "Odell Beckham Jr."),
            (WILLIAMS_A, "Mike Williams"),
            (WILLIAMS_B, "Mike Williams"),  # duplicate rendered name
        ]
    )


def test_normalize_folds_apostrophes_punctuation_and_suffix() -> None:
    assert normalize_tokens("Ja'Marr Chase") == ["jamarr", "chase"]
    assert normalize_tokens("JaMarr Chase") == ["jamarr", "chase"]
    assert normalize_tokens("Amon-Ra St. Brown") == ["amon", "ra", "st", "brown"]
    assert normalize_tokens("Odell Beckham Jr.") == ["odell", "beckham"]


def test_apostrophe_and_suffix_variants_resolve_to_one_player() -> None:
    idx = _index()
    assert idx.resolve("Ja'Marr Chase") == idx.resolve("JaMarr Chase")
    assert idx.resolve("Ja'Marr Chase").status == RESOLVED
    assert idx.resolve("Ja'Marr Chase").player_id == CHASE
    obj = idx.resolve("Odell Beckham")  # no suffix
    assert obj.status == RESOLVED and obj.player_id == OBJ


def test_abbreviated_form_resolves_when_unique() -> None:
    idx = _index()  # only one surname "Chase"
    r = idx.resolve("J. Chase")
    assert r.status == RESOLVED and r.player_id == CHASE


def test_abbreviated_form_is_ambiguous_when_multiple() -> None:
    idx = NameIndex.from_players(
        [(CHASE, "Ja'Marr Chase"), (CHASE2, "Jeremy Chase")]
    )
    r = idx.resolve("J. Chase")
    assert r.status == AMBIGUOUS
    assert set(r.candidate_ids) == {CHASE, CHASE2}
    assert r.player_id is None


def test_duplicate_full_name_is_ambiguous_not_guessed() -> None:
    r = _index().resolve("Mike Williams")
    assert r.status == AMBIGUOUS
    assert set(r.candidate_ids) == {WILLIAMS_A, WILLIAMS_B}


def test_unknown_name_is_unresolved() -> None:
    assert _index().resolve("Nonexistent Testplayer").status == UNRESOLVED
