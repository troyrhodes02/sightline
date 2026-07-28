"""Sightline modelling runtime: the projection engine and the backtest harness.

A second package alongside ``sightline_ingest``, sharing its distribution and
its plumbing (DSN resolution, direct-connection factory, error sanitisation,
code-version resolution) but kept a separate package because the package
boundary is what the structural invariants are asserted against:

* **Prices never feed projections.** No module here — and nothing it imports —
  may reference the Kalshi price or recommendation tables, by model name or by
  table name. ``tests/test_import_graph.py`` asserts it over both packages, and
  it was extended to cover this one before any modelling code existed, so the
  guard predates the risk. (The guard is a blunt substring sweep over source
  text, so this docstring deliberately describes those tables rather than
  naming them — a rule that cannot be written down inside the code it governs
  is the price of a check that cannot be talked around.)
* **Temporal integrity.** Every model-facing read goes through
  ``sightline_ingest.asof.AsOfCorpus`` bound to an explicit information cutoff.
  Feature code (SIG-16) takes an ``AsOfCorpus`` instance and nothing else, so
  there is no reachable path that could open its own connection and read a
  fact table without a cutoff.

This package never migrates the schema. Prisma owns it; Python reads and writes
the resulting tables by column name.
"""

from __future__ import annotations

__all__ = ["__doc__"]
