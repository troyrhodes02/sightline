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
    """
    text = str(exc)

    # Layer 2 first: remove exact known secret values wherever they appear.
    for secret in known_secret_values():
        if secret:
            text = text.replace(secret, _REDACTED)

    # Layer 1: rewrite any remaining user:pass@ credential span in a DSN.
    text = _DSN_CREDENTIALS.sub(lambda m: f"{m.group('scheme')}{_REDACTED}@", text)

    return text
