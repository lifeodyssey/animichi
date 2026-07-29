"""Async Supabase client — thin facade over domain repositories.

Usage:
    async with SupabaseClient(dsn="postgresql://...") as db:
        bangumi_id = await db.bangumi.find_bangumi_by_title("Eupho")
"""

from __future__ import annotations

import asyncio

import asyncpg
import structlog

from agent.infrastructure.supabase.client_types import AsyncPGPool, Row
from agent.infrastructure.supabase.repositories.anon_quota import AnonQuotaRepository
from agent.infrastructure.supabase.repositories.bangumi import BangumiRepository
from agent.infrastructure.supabase.repositories.feedback import FeedbackRepository
from agent.infrastructure.supabase.repositories.messages import MessagesRepository
from agent.infrastructure.supabase.repositories.points import PointsRepository
from agent.infrastructure.supabase.repositories.routes import RoutesRepository
from agent.infrastructure.supabase.repositories.session import SessionRepository
from agent.infrastructure.supabase.repositories.usage import UsageRepository

logger = structlog.get_logger(__name__)

__all__ = ["Row", "SupabaseClient"]


class SupabaseClient:
    """Async PostgreSQL client delegating to domain repository instances.

    Access repositories via explicit typed properties:
    ``db.bangumi``, ``db.points``, ``db.session``, ``db.feedback``,
    ``db.routes``, ``db.messages``, ``db.usage``, ``db.anon_quota``.
    """

    def __init__(
        self,
        dsn: str,
        *,
        min_pool_size: int = 2,
        max_pool_size: int = 10,
        statement_cache_size: int = 100,
    ) -> None:
        self._dsn = dsn
        self._min_pool_size = min_pool_size
        self._max_pool_size = max_pool_size
        self._statement_cache_size = statement_cache_size
        self._pool: AsyncPGPool | None = None
        self._bangumi: BangumiRepository | None = None
        self._points: PointsRepository | None = None
        self._session: SessionRepository | None = None
        self._feedback: FeedbackRepository | None = None
        self._routes: RoutesRepository | None = None
        self._messages: MessagesRepository | None = None
        self._usage: UsageRepository | None = None
        self._anon_quota: AnonQuotaRepository | None = None

    async def connect(self) -> None:
        """Create the connection pool and initialise repositories."""
        if self._pool is not None:
            return
        self._pool = await asyncio.wait_for(
            asyncpg.create_pool(
                self._dsn,
                min_size=self._min_pool_size,
                max_size=self._max_pool_size,
                statement_cache_size=self._statement_cache_size,
            ),
            timeout=15,
        )
        self._init_repos(self._pool)
        logger.info("supabase_connected", pool_size=self._max_pool_size)

    async def close(self) -> None:
        """Close the connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.info("supabase_disconnected")

    async def __aenter__(self) -> SupabaseClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    @property
    def pool(self) -> AsyncPGPool:
        """Get the connection pool (raises if not connected)."""
        if self._pool is None:
            raise RuntimeError("SupabaseClient not connected. Call connect() first.")
        return self._pool

    # --- Repository access ---

    def _init_repos(self, pool: AsyncPGPool) -> None:
        self._bangumi = BangumiRepository(pool)
        self._points = PointsRepository(pool)
        self._session = SessionRepository(pool)
        self._feedback = FeedbackRepository(pool)
        self._routes = RoutesRepository(pool)
        self._messages = MessagesRepository(pool)
        self._usage = UsageRepository(pool)
        self._anon_quota = AnonQuotaRepository(pool)

    @property
    def bangumi(self) -> BangumiRepository:
        if self._bangumi is None:
            raise RuntimeError(
                "BangumiRepository not initialized — call connect() first"
            )
        return self._bangumi

    @property
    def points(self) -> PointsRepository:
        if self._points is None:
            raise RuntimeError(
                "PointsRepository not initialized — call connect() first"
            )
        return self._points

    @property
    def session(self) -> SessionRepository:
        if self._session is None:
            raise RuntimeError(
                "SessionRepository not initialized — call connect() first"
            )
        return self._session

    @property
    def feedback(self) -> FeedbackRepository:
        if self._feedback is None:
            raise RuntimeError(
                "FeedbackRepository not initialized — call connect() first"
            )
        return self._feedback

    @property
    def routes(self) -> RoutesRepository:
        if self._routes is None:
            raise RuntimeError(
                "RoutesRepository not initialized — call connect() first"
            )
        return self._routes

    @property
    def messages(self) -> MessagesRepository:
        if self._messages is None:
            raise RuntimeError(
                "MessagesRepository not initialized — call connect() first"
            )
        return self._messages

    @property
    def usage(self) -> UsageRepository:
        if self._usage is None:
            raise RuntimeError("UsageRepository not initialized — call connect() first")
        return self._usage

    @property
    def anon_quota(self) -> AnonQuotaRepository:
        if self._anon_quota is None:
            raise RuntimeError(
                "AnonQuotaRepository not initialized — call connect() first"
            )
        return self._anon_quota
