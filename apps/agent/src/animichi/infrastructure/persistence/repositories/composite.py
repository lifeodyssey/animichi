"""The Agent persistence aggregate (#995).

``PersistenceRepos`` is the lifespan-owned composition of every SQLModel
repository over one session factory — the structural successor of the
deleted asyncpg ``SupabaseClient`` facade. It keeps the same attribute shape
(``session``, ``turn_reservation``, ``bangumi``, ``points``, ``usage``,
``anon_quota``, ``feedback``) so the narrow repo extractors in
``interfaces.db_repos`` and the route seam resolve the same protocols they
always did, now over SQLModel/SQLAlchemy operations only.

The aggregate owns no lifecycle: the surrounding ``DatabaseLifecycle``
(engine + sessionmaker) is the lifespan's and is closed there; repositories
open short-lived sessions per operation.
"""

from __future__ import annotations

from dataclasses import dataclass

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.repositories.anon_quota import (
    SQLModelAnonQuotaRepository,
)
from animichi.infrastructure.persistence.repositories.bangumi import (
    SQLModelBangumiRepository,
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


@dataclass
class PersistenceRepos:
    """Every Agent SQLModel repository over one session factory.

    Not frozen: the pervasive test-double convention replaces sub-repositories
    after construction (``db.turn_reservation = store``), and production never
    mutates the aggregate.
    """

    sessionmaker: AsyncSessionFactory
    session: SQLModelSessionRepository
    turn_reservation: SQLModelTurnReservationStore
    bangumi: SQLModelBangumiRepository
    points: SQLModelPointsRepository
    usage: SQLModelUsageRepository
    anon_quota: SQLModelAnonQuotaRepository
    feedback: SQLModelFeedbackRepository
    memory: SQLModelMemoryStore

    @classmethod
    def build(cls, sessionmaker: AsyncSessionFactory) -> PersistenceRepos:
        """Compose the full repository set over one shared session factory."""
        return _build_repos(sessionmaker)


def _build_repos(
    sessionmaker: AsyncSessionFactory,
) -> PersistenceRepos:
    "Instantiate every repository over one shared session factory."
    repos = PersistenceRepos.__new__(PersistenceRepos)
    _assign_factory(repos, sessionmaker)
    _assign_agent(repos, sessionmaker)
    _assign_catalog(repos, sessionmaker)
    return repos


def _assign_factory(repos: PersistenceRepos, sessionmaker: AsyncSessionFactory) -> None:
    "Attach the shared session factory."
    repos.sessionmaker = sessionmaker


def _assign_agent(repos: PersistenceRepos, sessionmaker: AsyncSessionFactory) -> None:
    "Attach the agent-owned repositories over the shared factory."
    repos.session = SQLModelSessionRepository(sessionmaker)
    repos.turn_reservation = SQLModelTurnReservationStore(sessionmaker)
    repos.usage = SQLModelUsageRepository(sessionmaker)
    repos.anon_quota = SQLModelAnonQuotaRepository(sessionmaker)
    repos.feedback = SQLModelFeedbackRepository(sessionmaker)
    repos.memory = SQLModelMemoryStore(sessionmaker)


def _assign_catalog(repos: PersistenceRepos, sessionmaker: AsyncSessionFactory) -> None:
    "Attach the read-only catalog repositories over the shared factory."
    repos.bangumi = SQLModelBangumiRepository(sessionmaker)
    repos.points = SQLModelPointsRepository(sessionmaker)
