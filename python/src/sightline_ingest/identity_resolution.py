"""Name-based player identity resolution (pure; no DB, no network).

Resolving a rendered name (e.g. a Kalshi contract's "J. Chase") to a canonical
Player is a named architecture risk. The rule is: match confidently or don't
match — never guess. A name that matches exactly one player resolves; a name
that matches several is ``ambiguous`` (all candidates retained); a name that
matches none is ``unresolved``. Nothing is ever silently coalesced into the
wrong player.

Normalisation handles the variants that would otherwise fragment one identity:
apostrophes ("Ja'Marr" == "JaMarr"), punctuation and hyphens ("Amon-Ra St.
Brown"), generational suffixes ("Odell Beckham Jr." == "Odell Beckham"), and
first-initial abbreviations ("J. Chase" matched on initial + surname).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

# Resolution statuses (mirror the Prisma IdentityResolutionStatus enum).
RESOLVED = "resolved"
UNRESOLVED = "unresolved"
AMBIGUOUS = "ambiguous"

_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_tokens(name: str) -> list[str]:
    """Return canonical name tokens: lowercased, punctuation-folded, suffix-stripped."""
    s = name.lower().strip()
    s = s.replace("'", "").replace("’", "")  # apostrophes vanish (Ja'Marr -> jamarr)
    for ch in ".,-/":
        s = s.replace(ch, " ")
    tokens = [t for t in s.split() if t]
    if len(tokens) > 1 and tokens[-1] in _SUFFIXES:
        tokens = tokens[:-1]
    return tokens


@dataclass(frozen=True)
class Resolution:
    status: str  # RESOLVED | AMBIGUOUS | UNRESOLVED
    player_id: str | None = None
    candidate_ids: list[str] | None = None


class NameIndex:
    """Index of canonical players for name lookup.

    Two views: full normalised name, and (first initial, surname) for
    abbreviated forms. Both map to a *set* of player ids so collisions surface as
    ambiguity rather than a silent pick.
    """

    def __init__(self) -> None:
        self._by_full: dict[str, set[str]] = defaultdict(set)
        self._by_initial_surname: dict[tuple[str, str], set[str]] = defaultdict(set)

    def add(self, player_id: str, full_name: str) -> None:
        tokens = normalize_tokens(full_name)
        if not tokens:
            return
        self._by_full[" ".join(tokens)].add(player_id)
        self._by_initial_surname[(tokens[0][0], tokens[-1])].add(player_id)

    @classmethod
    def from_players(cls, players: list[tuple[str, str]]) -> "NameIndex":
        index = cls()
        for player_id, full_name in players:
            index.add(player_id, full_name)
        return index

    def resolve(self, name: str) -> Resolution:
        tokens = normalize_tokens(name)
        if not tokens:
            return Resolution(UNRESOLVED)

        if len(tokens) >= 2 and len(tokens[0]) == 1:
            # Abbreviated form "J. Chase": match on initial + surname only.
            candidates = self._by_initial_surname.get((tokens[0], tokens[-1]), set())
        else:
            # Full name: exact normalised match only. No looser fallback — a
            # near-miss must stay unresolved rather than resolve to the wrong player.
            candidates = self._by_full.get(" ".join(tokens), set())

        ordered = sorted(candidates)
        if len(ordered) == 1:
            return Resolution(RESOLVED, player_id=ordered[0])
        if len(ordered) > 1:
            return Resolution(AMBIGUOUS, candidate_ids=ordered)
        return Resolution(UNRESOLVED)
