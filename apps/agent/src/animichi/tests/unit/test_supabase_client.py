"""Unit tests for the composed PersistenceRepos aggregate (#995).

The aggregate is the structural successor of the deleted ``SupabaseClient``
facade: every production repository is composed over one session factory,
and each attribute resolves to its own repository instance.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.infrastructure.persistence.repositories.bangumi import (
    SQLModelBangumiRepository,
)
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.persistence.repositories.feedback import (
    SQLModelFeedbackRepository,
)
from animichi.infrastructure.persistence.repositories.memory import (
    SQLModelMemoryStore,
)
from animichi.infrastructure.persistence.repositories.points import (
    SQLModelPointsRepository,
)
from animichi.infrastructure.persistence.repositories.session import (
    SQLModelSessionRepository,
)
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
)
from animichi.infrastructure.persistence.repositories.usage import (
    SQLModelUsageRepository,
)


def test_build_composes_every_repository_over_one_session_factory() -> None:
    sessionmaker: AsyncSessionFactory = MagicMock()

    aggregate = PersistenceRepos.build(sessionmaker)

    assert aggregate.sessionmaker is sessionmaker
    assert isinstance(aggregate.session, SQLModelSessionRepository)
    assert isinstance(aggregate.turn_reservation, SQLModelTurnReservationStore)
    assert isinstance(aggregate.bangumi, SQLModelBangumiRepository)
    assert isinstance(aggregate.points, SQLModelPointsRepository)
    assert isinstance(aggregate.usage, SQLModelUsageRepository)
    assert isinstance(aggregate.anon_quota, SQLModelAnonQuotaRepository)
    assert isinstance(aggregate.feedback, SQLModelFeedbackRepository)
    assert isinstance(aggregate.memory, SQLModelMemoryStore)


def test_aggregate_children_can_be_replaced_for_testing() -> None:
    """Test doubles swap sub-repositories after construction; the aggregate
    must stay mutable for that convention."""
    aggregate = PersistenceRepos.build(MagicMock())
    replacement: SQLModelSessionRepository = MagicMock()

    aggregate.session = replacement

    assert aggregate.session is replacement
