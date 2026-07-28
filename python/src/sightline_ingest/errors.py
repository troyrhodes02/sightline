"""Ingest error types and credential-safe error sanitisation.

Explicit-failure semantics: a named source that is unavailable or has drifted
raises, and the failure is recorded as ``IngestStatus.failed`` — never a partial
dataset that reads as complete. Any error text that reaches an ``IngestRun`` row
(or a log line) is scrubbed of credentials first.
"""

from __future__ import annotations

import re

from .config import known_secret_values


class IngestError(RuntimeError):
    """Base class for explicit ingest failures."""


class SourceUnavailableError(IngestError):
    """A named upstream source was unreachable. Recorded as failed; never partial."""


class SchemaDriftError(IngestError):
    """Source returned structurally incomplete data (e.g. a renamed required
    column) despite a technically successful request. Treated as failure, not a
    successful partial load."""


class UsageError(IngestError):
    """The operator invoked an ingest incorrectly (e.g. a seasonal dataset with
    no ``--seasons``). Kept distinct from SchemaDriftError so a recorded failure
    is not misread as upstream drift."""


# postgres://user:password@host:port/db  and  postgresql+driver://...
_DSN_CREDENTIALS = re.compile(
    r"(?P<scheme>postgres(?:ql)?(?:\+\w+)?://)[^\s/@]+@",
    re.IGNORECASE,
)
_REDACTED = "<redacted>"


def sanitize_error(exc: BaseException | str) -> str:
    """Return a message safe to persist: credentials and DSNs scrubbed.

    Two layers, because neither is sufficient alone:
      1. Structural — rewrite any ``scheme://user:pass@`` credential span.
      2. Value-based — remove any known secret value from the environment
         (full DSNs, the DB password), so a credential that appears in an
         unexpected shape is still removed.

    The structural pass MUST run first: a configured password can be a
    substring of the scheme itself (a local database with password literally
    "postgres"), and replacing it value-first would rewrite ``postgresql://``
    into ``<redacted>ql://`` — destroying the token the structural regex keys
    on and leaving an unrelated DSN's password intact. Value replacement runs
    longest-first so a full DSN is removed before its own password substring.
    """
    text = str(exc)

    # Layer 1: rewrite any user:pass@ credential span in a DSN.
    text = _DSN_CREDENTIALS.sub(lambda m: f"{m.group('scheme')}{_REDACTED}@", text)

    # Layer 2: remove exact known secret values wherever else they appear.
    for secret in sorted(known_secret_values(), key=len, reverse=True):
        if secret:
            text = text.replace(secret, _REDACTED)

    return text
