"""Sightline Python runtime — historical corpus ingest and the as-of query layer.

This package owns everything upstream of a stored projection: ingest, provenance,
and (from a later PR) the as-of query layer. It reads and writes the Postgres
tables that Prisma owns, over the DIRECT (non-pooled) connection, and it NEVER
migrates the schema.

The second invariant is enforced structurally here: no module in this package
imports or references the price or recommendation-snapshot tables. Prices never
feed projections. See ``tests/test_import_graph.py`` for the guard.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
