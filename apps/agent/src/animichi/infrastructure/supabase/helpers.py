"""Shared helpers for Supabase repository modules.

#839: the catalog write helpers (column allowlists, ``upsert`` SQL builders)
were removed with the dual SQL write path — the agent is a read-only
consumer of catalog master data. Remaining helpers serve the read and
operational (session/route/feedback) repositories only.
"""

from __future__ import annotations

from animichi.infrastructure.supabase.client_types import Row


def _require_row(row: Row | None, *, operation: str) -> Row:
    if row is None:
        raise RuntimeError(f"Database did not return a row for {operation}")
    return row
