"""The sole Session aggregate repository on SQLModel/SQLAlchemy (#994).

``SQLModelSessionRepository`` is the single storage surface for the Session
aggregate against the fresh-schema manifest: ``sessions`` (state envelope,
metadata, AND ownership in one row), ``messages`` (the ordered transcript),
and ``turn_reservations`` (the durable revision CAS). It implements create,
load, commit, history, and adoption so AgentTurn, GetSessionHistory, and
AdoptSessions speak one repository — no second-root store exists.

The repository is a thin composition of private capability mixins (1-10-50):
lifecycle + state live in ``_session_store``, the data records/scalar
coercion in ``_session_records``, the transcript/history in
``_session_messages``, and adoption in ``_session_adoption``.
"""

from __future__ import annotations

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.repositories._session_adoption import (
    _SessionAdoptionMixin,
)
from animichi.infrastructure.persistence.repositories._session_messages import (
    _SessionHistoryMixin,
    _SessionMessagesMixin,
)
from animichi.infrastructure.persistence.repositories._session_records import (
    HistoryPage,
    MessageRow,
    SessionRecord,
)
from animichi.infrastructure.persistence.repositories._session_store import (
    _SessionLifecycleMixin,
    _SessionMutationMixin,
    _SessionStateMixin,
)


class SQLModelSessionRepository(
    _SessionHistoryMixin,
    _SessionMessagesMixin,
    _SessionMutationMixin,
    _SessionLifecycleMixin,
    _SessionStateMixin,
    _SessionAdoptionMixin,
):
    """The sole Session aggregate repository against the fresh-schema manifest."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker


__all__ = ["HistoryPage", "MessageRow", "SQLModelSessionRepository", "SessionRecord"]
