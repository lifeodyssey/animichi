"""SQLModel read-only bangumi repository (#995).

Replaces the asyncpg ``BangumiRepository`` against the same catalog tables.
Read-only by contract (#839): every method selects, joins, or filters; the
agent never writes catalog master data. PostgreSQL-specific behavior (PostGIS
proximity, ILIKE escaping, ``unnest WITH ORDINALITY`` + LATERAL) comes from
``animichi.infrastructure.persistence.expressions``, the constrained
typed-expression module.
"""

from __future__ import annotations

from sqlalchemy import cast, func, or_, select, true

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.expressions import (
    Geography,
    escaped_ilike_pattern,
    location_or_fallback,
    st_dwithin,
    st_makepoint,
    unnest_with_ordinality,
)
from animichi.infrastructure.persistence.models import bangumi_table, points_table


class SQLModelBangumiRepository:
    """Bangumi-related read operations (read-only, #839)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def get_bangumi(self, bangumi_id: str) -> dict[str, object] | None:
        """One work row by id, or ``None``."""
        async with self._sessionmaker() as session:
            row = (
                await session.execute(
                    select(bangumi_table).where(bangumi_table.c.id == bangumi_id)
                )
            ).first()
        return dict(row._mapping) if row is not None else None

    async def filter_existing_ids(self, bangumi_ids: list[str]) -> list[str]:
        """The subset of ids that exist (FK-backed route associations)."""
        if not bangumi_ids:
            return []
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(bangumi_table.c.id).where(bangumi_table.c.id.in_(bangumi_ids))
            )
            return [str(value) for value in result.scalars()]

    async def list_bangumi(self, *, limit: int = 50) -> list[dict[str, object]]:
        """Top-rated works, highest rating first."""
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(bangumi_table)
                    .order_by(bangumi_table.c.rating.desc().nulls_last())
                    .limit(limit)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def get_bangumi_by_area(
        self, lat: float, lng: float, radius_m: int = 50000
    ) -> list[dict[str, object]]:
        """Works with points within ``radius_m`` of (lat, lng), with counts.

        Params are (lat, lng) at the Python boundary; the legacy SQL binds
        (lng, lat) into ``ST_MakePoint`` (lon/lat order) — preserved here.
        """
        search_point = cast(st_makepoint(lng, lat), Geography())
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        bangumi_table.c.id.label("bangumi_id"),
                        bangumi_table.c.title.label("bangumi_title"),
                        bangumi_table.c.title_cn,
                        bangumi_table.c.cover_url,
                        bangumi_table.c.city,
                        func.count(points_table.c.id).label("points_count"),
                    )
                    .join(points_table, points_table.c.bangumi_id == bangumi_table.c.id)
                    .where(
                        st_dwithin(
                            location_or_fallback(
                                points_table.c.location,
                                points_table.c.longitude,
                                points_table.c.latitude,
                            ),
                            search_point,
                            radius_m,
                        )
                    )
                    .group_by(
                        bangumi_table.c.id,
                        bangumi_table.c.title,
                        bangumi_table.c.title_cn,
                        bangumi_table.c.cover_url,
                        bangumi_table.c.city,
                    )
                    .limit(10)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def find_bangumi_by_title(self, title: str) -> str | None:
        """First id whose title (ja or cn) contains *title* (case-insensitive)."""
        pattern = f"%{escaped_ilike_pattern(title)}%"
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(bangumi_table.c.id)
                .where(
                    or_(
                        bangumi_table.c.title.ilike(pattern, escape="\\"),
                        bangumi_table.c.title_cn.ilike(pattern, escape="\\"),
                    )
                )
                .limit(1)
            )
            raw = result.scalar_one_or_none()
        return str(raw) if raw is not None else None

    async def find_all_by_title(self, title: str) -> list[dict[str, object]]:
        """Matching works with normalized cover/city/count fields, ranked."""
        pattern = f"%{escaped_ilike_pattern(title)}%"
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        bangumi_table.c.id,
                        bangumi_table.c.title,
                        bangumi_table.c.title_cn,
                        func.coalesce(bangumi_table.c.cover_url, "").label("cover_url"),
                        func.coalesce(bangumi_table.c.city, "").label("city"),
                        func.coalesce(bangumi_table.c.points_count, 0).label(
                            "points_count"
                        ),
                    )
                    .where(
                        or_(
                            bangumi_table.c.title.ilike(pattern, escape="\\"),
                            bangumi_table.c.title_cn.ilike(pattern, escape="\\"),
                        )
                    )
                    .order_by(bangumi_table.c.points_count.desc().nulls_last())
                    .limit(10)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[dict[str, object]]:
        """One best match per requested title, in request order."""
        if not titles:
            return []
        requested = unnest_with_ordinality(titles)
        best_match = (
            select(
                bangumi_table.c.id,
                bangumi_table.c.cover_url,
                bangumi_table.c.city,
                bangumi_table.c.points_count,
            )
            .where(
                or_(
                    bangumi_table.c.title.ilike(requested.c.title, escape="\\"),
                    bangumi_table.c.title_cn.ilike(requested.c.title, escape="\\"),
                )
            )
            .order_by(bangumi_table.c.points_count.desc().nulls_last())
            .limit(1)
        ).subquery("b")
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        requested.c.title.label("title"),
                        best_match.c.id.label("bangumi_id"),
                        func.coalesce(best_match.c.cover_url, "").label("cover_url"),
                        func.coalesce(best_match.c.city, "").label("city"),
                        func.coalesce(best_match.c.points_count, 0).label(
                            "points_count"
                        ),
                    )
                    .select_from(requested.outerjoin(best_match, true()))
                    .order_by(requested.c.ord)
                )
            ).all()
        return [dict(row._mapping) for row in rows]
