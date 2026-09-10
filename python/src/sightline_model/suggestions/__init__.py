"""Adjustment Suggestions engine (SIG-74…SIG-80).

This package computes shadow-adjusted projections from external source claims
(ESPN inactives first) and never reads Kalshi prices — it is covered by the
same import-graph guard as the rest of ``sightline_model`` (see
``python/tests/test_import_graph.py``).
"""
