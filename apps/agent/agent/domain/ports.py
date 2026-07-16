"""Domain port protocols for infrastructure dependencies.

These protocols define the interface that the agent/handler layer requires
from the database. The concrete ``SupabaseClient`` satisfies these protocols
structurally (PEP 544) — no inheritance needed.

Only methods actually *used* by the agent layer are declared here.

Note: Return types use ``dict[str, object]`` to match the asyncpg Record-to-dict
conversion in the concrete repositories. Protocol signatures must mirror
the implementation types for structural subtyping to work.
"""

from __future__ import annotations

import asyncio
from typing import Protocol, cast, runtime_checkable


class BangumiRepo(Protocol):
    """Bangumi-related DB operations used by handlers."""

    async def find_bangumi_by_title(self, title: str) -> str | None: ...

    async def find_all_by_title(self, title: str) -> list[dict[str, object]]: ...

    async def upsert_bangumi_title(self, title: str, bangumi_id: str) -> None: ...

    async def upsert_bangumi(
        self,
        bangumi_id: str,
        *,
        title: str | None = None,
        cover_url: str | None = None,
        points_count: int | None = None,
    ) -> None: ...

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[dict[str, object]]: ...


class PointsRepo(Protocol):
    """Pilgrimage point DB operations used by handlers."""

    async def search_points_by_location(
        self,
        latitude: float,
        longitude: float,
        radius_m: int,
        *,
        limit: int = 50,
    ) -> list[dict[str, object]]: ...

    async def get_points_by_ids(
        self, point_ids: list[str]
    ) -> list[dict[str, object]]: ...

    async def upsert_points_batch(self, rows: list[dict[str, object]]) -> None: ...


@runtime_checkable
class DatabasePort(Protocol):
    """Structural protocol for the DB dependency used by the agent layer.

    The concrete ``SupabaseClient`` satisfies this protocol automatically.
    Test doubles only need to implement the repositories they test against.
    """

    @property
    def bangumi(self) -> BangumiRepo: ...

    @property
    def points(self) -> PointsRepo: ...


class SessionRepo(Protocol):
    """Session-related DB operations used by persistence helpers."""

    async def upsert_session(
        self,
        session_id: str,
        session_state: dict[str, object],
        *,
        metadata: dict[str, object] | None = None,
    ) -> None: ...

    async def upsert_conversation(
        self,
        session_id: str,
        user_id: str,
        text: str,
    ) -> None: ...

    async def update_conversation_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> None: ...


class UserMemoryRepo(Protocol):
    """User memory DB operations used by persistence helpers."""

    async def get_user_memory(
        self,
        user_id: str,
    ) -> dict[str, object] | None: ...

    async def upsert_user_memory(
        self,
        user_id: str,
        *,
        bangumi_id: str | None = None,
        anime_title: str | None = None,
    ) -> None: ...


class RoutesRepo(Protocol):
    """Route persistence operations used by persistence helpers."""

    async def save_route(
        self,
        session_id: str,
        anime_ids: list[str],
        point_ids: list[str],
        data: dict[str, object],
        *,
        origin_station: str | None = None,
        origin_lat: float | None = None,
        origin_lon: float | None = None,
    ) -> str: ...


def get_session_repo(db: object) -> SessionRepo | None:
    """Return the session repo if *db* exposes one with async upsert_session."""
    session = getattr(db, "session", None)
    if session is None:
        return None
    if not asyncio.iscoroutinefunction(getattr(session, "upsert_session", None)):
        return None
    return cast(SessionRepo, session)


def get_user_memory_repo(db: object) -> UserMemoryRepo | None:
    """Return the user_memory repo if *db* exposes one with async get_user_memory."""
    user_memory = getattr(db, "user_memory", None)
    if user_memory is None:
        return None
    if not asyncio.iscoroutinefunction(getattr(user_memory, "get_user_memory", None)):
        return None
    return cast(UserMemoryRepo, user_memory)


def get_routes_repo(db: object) -> RoutesRepo | None:
    """Return the routes repo if *db* exposes one with async save_route."""
    routes = getattr(db, "routes", None)
    if routes is None:
        return None
    if not asyncio.iscoroutinefunction(getattr(routes, "save_route", None)):
        return None
    return cast(RoutesRepo, routes)


def has_session_repo(db: object) -> bool:
    """Return True if *db* exposes a session repo."""
    return get_session_repo(db) is not None


def has_user_memory_repo(db: object) -> bool:
    """Return True if *db* exposes a user_memory repo."""
    return get_user_memory_repo(db) is not None


def has_routes_repo(db: object) -> bool:
    """Return True if *db* exposes a routes repo."""
    return get_routes_repo(db) is not None
