"""Resolve the ingest code version (git sha) for provenance.

Every ``IngestRun`` records the git sha of the ingest code so a stored run can be
compared against the engine version that produced it.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def code_version() -> str:
    """Return the current git sha, or a documented fallback.

    Order: explicit ``GIT_SHA`` env (set by CI) → ``git rev-parse HEAD`` →
    the literal ``"unknown"`` (never guessed, never fabricated).
    """
    env_sha = os.environ.get("GIT_SHA")
    if env_sha:
        return env_sha.strip()

    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=Path(__file__).resolve().parent,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
    except (subprocess.SubprocessError, OSError):
        return "unknown"

    return result.stdout.strip() or "unknown"
