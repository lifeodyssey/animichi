"""SQLModel read-only points repository (#995).

Replaces the asyncpg ``PointsRepository`` against the same ``points`` /
``bangumi`` catalog tables. Read-only by contract (#839). PostGIS proximity
expressions come from ``animichi.infrastructure.persistence.expressions``.
"""

from __future__ import annotations

from sqlalchemy import cast, select

from animichi.infrastructure.persistence.database import AsyncSessionFactory
from animichi.infrastructure.persistence.expressions import (
    Geography,
    latitude_with_fallback,
    location_or_fallback,
    longitude_with_fallback,
    st_distance,
    st_dwithin,
    st_makepoint,
    unnest_with_ordinality,
)
from animichi.infrastructure.persistence.models import bangumi_table, points_table


class SQLModelPointsRepository:
    """Pilgrimage point read operations (read-only, #839)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def get_points_by_bangumi(self, bangumi_id: str) -> list[dict[str, object]]:
        """Every spot of one work, in the canonical episode/time order."""
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(points_table)
                    .where(points_table.c.bangumi_id == bangumi_id)
                    .order_by(points_table.c.episode, points_table.c.time_seconds)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def get_points_by_ids(self, point_ids: list[str]) -> list[dict[str, object]]:
        """The requested spots in request order."""
        if not point_ids:
            return []
        requested = unnest_with_ordinality(point_ids, column="id")
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(points_table)
                    .select_from(
                        requested.join(
                            points_table, points_table.c.id == requested.c.id
                        )
                    )
                    .order_by(requested.c.ord)
                )
            ).all()
        return [dict(row._mapping) for row in rows]

    async def search_points_by_location(
        self,
        lat: float,
        lon: float,
        radius_m: float = 5000,
        *,
        limit: int = 50,
    ) -> list[dict[str, object]]:
        """Nearby spots with screenshot alias, coordinate fallback, distance,
        and the joined work titles — nearest first."""
        search_point = cast(st_makepoint(lon, lat), Geography())
        async with self._sessionmaker() as session:
            rows = (
                await session.execute(
                    select(
                        points_table.c.id,
                        points_table.c.bangumi_id,
                        points_table.c.name,
                        points_table.c.name_cn,
                        points_table.c.episode,
                        points_table.c.time_seconds,
                        points_table.c.image.label("screenshot_url"),
                        points_table.c.origin,
                        latitude_with_fallback(
                            points_table.c.latitude, points_table.c.location
                        ).label("latitude"),
                        longitude_with_fallback(
                            points_table.c.longitude, points_table.c.location
                        ).label("longitude"),
                        st_distance(
                            location_or_fallback(
                                points_table.c.location,
                                points_table.c.longitude,
                                points_table.c.latitude,
                            ),
                            search_point,
                        ).label("distance_m"),
                        bangumi_table.c.title,
                        bangumi_table.c.title_cn,
                    )
                    .select_from(points_table)
                    .join(
                        bangumi_table,
                        bangumi_table.c.id == points_table.c.bangumi_id,
                        isouter=True,
                    )
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
                    .order_by(
                        st_distance(
                            location_or_fallback(
                                points_table.c.location,
                                points_table.c.longitude,
                                points_table.c.latitude,
                            ),
                            search_point,
                        ).asc()
                    )
                    .limit(limit)
                )
            ).all()
        return [dict(row._mapping) for row in rows]
