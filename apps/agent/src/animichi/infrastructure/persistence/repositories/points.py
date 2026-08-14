"""SQLModel read-only points repository (#995).

Replaces the asyncpg ``PointsRepository`` against the same ``points`` /
``bangumi`` catalog tables. Read-only by contract (#839). PostGIS proximity
expressions come from ``animichi.infrastructure.persistence.expressions``.
The proximity select builder is a module-level pure function (1-10-50).
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import ColumnElement, select
from sqlalchemy import cast as sa_cast
from sqlalchemy.sql.selectable import Select

from animichi.domain.repo_types import NearbyPointRow, PointRow
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


def _search_point(lon: float, lat: float) -> ColumnElement[object]:
    return sa_cast(st_makepoint(lon, lat), Geography())


def _location() -> ColumnElement[object]:
    return location_or_fallback(
        points_table.c.location,
        points_table.c.longitude,
        points_table.c.latitude,
    )


def _nearby_core() -> Select:
    return select(
        points_table.c.id,
        points_table.c.bangumi_id,
        points_table.c.name,
        points_table.c.name_cn,
        points_table.c.episode,
        points_table.c.time_seconds,
        points_table.c.image.label("screenshot_url"),
        points_table.c.origin,
    )


def _latitude_label() -> ColumnElement[object]:
    "The latitude column, falling back to a geography-derived value."
    return latitude_with_fallback(
        points_table.c.latitude, points_table.c.location
    ).label("latitude")


def _longitude_label() -> ColumnElement[object]:
    "The longitude column, falling back to a geography-derived value."
    return longitude_with_fallback(
        points_table.c.longitude, points_table.c.location
    ).label("longitude")


def _nearby_columns(
    location: ColumnElement[object], search_point: ColumnElement[object]
) -> Select:
    "The full nearby-result select over the points and bangumi tables."
    return _nearby_core().add_columns(
        _latitude_label(),
        _longitude_label(),
        st_distance(location, search_point).label("distance_m"),
        bangumi_table.c.title,
        bangumi_table.c.title_cn,
    )


def _nearby_query(
    location: ColumnElement[object],
    search_point: ColumnElement[object],
    radius_m: float,
) -> Select:
    "The nearby-points select joined to title data and proximity-sorted."
    return (
        _nearby_columns(location, search_point)
        .select_from(points_table)
        .join(
            bangumi_table, bangumi_table.c.id == points_table.c.bangumi_id, isouter=True
        )
        .where(st_dwithin(location, search_point, radius_m))
        .order_by(st_distance(location, search_point).asc())
    )


def _nearby_select(
    lon: float,
    lat: float,
    radius_m: float,
    limit: int,
) -> Select:
    search_point = _search_point(lon, lat)
    location = _location()
    return _nearby_query(location, search_point, radius_m).limit(limit)


def _by_bangumi_select(bangumi_id: str) -> Select:
    """Every spot of one work, in canonical episode/time order."""
    return (
        select(points_table)
        .where(points_table.c.bangumi_id == bangumi_id)
        .order_by(points_table.c.episode, points_table.c.time_seconds)
    )


def _by_ids_select(point_ids: list[str]) -> Select:
    """The requested spots in request order (``unnest`` + LATERAL)."""
    requested = unnest_with_ordinality(point_ids, column="id")
    return (
        select(points_table)
        .select_from(requested.join(points_table, points_table.c.id == requested.c.id))
        .order_by(requested.c.ord)
    )


class SQLModelPointsRepository:
    """Pilgrimage point read operations (read-only, #839)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker

    async def get_points_by_bangumi(
        self,
        bangumi_id: str,
    ) -> list[PointRow]:
        """Every spot of one work, in the canonical episode/time order."""
        async with self._sessionmaker() as session:
            rows = await session.execute(_by_bangumi_select(bangumi_id))
        return [cast(PointRow, dict(row._mapping)) for row in rows.all()]

    async def get_points_by_ids(
        self,
        point_ids: list[str],
    ) -> list[PointRow]:
        """The requested spots in request order."""
        if not point_ids:
            return []
        async with self._sessionmaker() as session:
            rows = await session.execute(_by_ids_select(point_ids))
        return [cast(PointRow, dict(row._mapping)) for row in rows.all()]

    async def search_points_by_location(
        self,
        lat: float,
        lon: float,
        radius_m: float = 5000,
        *,
        limit: int = 50,
    ) -> list[NearbyPointRow]:
        """Nearby spots with alias, coordinate fallback, distance, titles."""
        async with self._sessionmaker() as session:
            rows = await session.execute(
                _nearby_select(lon, lat, radius_m, limit),
            )
        return [cast(NearbyPointRow, dict(row._mapping)) for row in rows.all()]


__all__ = ["SQLModelPointsRepository"]
