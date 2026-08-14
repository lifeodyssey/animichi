"""Shared persistence test doubles (#995).

Builds a ``MagicMock`` in the shape of the composed ``PersistenceRepos``
aggregate: one sub-repo per attribute, with the async persistence sinks the
RuntimeAPI path resolves wired as ``AsyncMock``s. The aggregate is a frozen
dataclass of repository instances, so the double is deliberately unspecced —
auto-vivifying ``MagicMock`` children let callers set per-test methods
without fighting ``spec=``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock


def build_persistence_double() -> MagicMock:
    """Build a persistence double with the RuntimeAPI sinks wired.

    Wires only the shared persistence writes; callers set their own read
    doubles. SESSION-3 (#961): the transcript port resolves from the sole
    Session repository, so the message insert lives on ``db.session``; the
    request-audit port resolves from ``db.feedback`` (#663).
    """
    db = MagicMock()
    db.session.create = AsyncMock()
    db.session.upsert_session = AsyncMock()
    db.session.insert_message = AsyncMock()
    db.feedback.insert_request_log = AsyncMock()
    return db
