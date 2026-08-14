"""SQLModel read-only bangumi repository (#995).

Replaces the asyncpg ``BangumiRepository`` against the same catalog tables.
Read-only by contract (#839): every method selects, joins, or filters; the
agent never writes catalog master data. PostgreSQL-specific behavior (PostGIS
proximity, ILIKE escaping, ``unnest WITH ORDINALITY`` + LATERAL) comes from
``animichi.infrastructure.persistence.expressions`` (raw-SQL policy, #999).

The large select/subquery builders are module-level pure functions
(1-10-50) so each repository method stays a thin execute-and-map wrapper.
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import ColumnElement, func, or_, select, true
from sqlalchemy import cast as sa_cast
from sqlalchemy.sql.selectable import FromClause, Select

from animichi.domain.repo_types import (
    BangumiAreaRow,
    BangumiCandidateRow,
    BangumiRow,
    BangumiTitleRow,
)
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


def _title_pattern(title: str) -> str:
    return f"%{escaped_ilike_pattern(title)}%"


def _title_where(title: str) -> ColumnElement[bool]:
    pattern = _title_pattern(title)
    return or_(
        bangumi_table.c.title.ilike(pattern, escape="\\"),
        bangumi_table.c.title_cn.ilike(pattern, escape="\\"),
    )


def _area_location() -> ColumnElement[object]:
    "The proximity-probe location for a points row."
    return location_or_fallback(
        points_table.c.location,
        points_table.c.longitude,
        points_table.c.latitude,
    )


def _area_columns() -> Select:
    "The columns of one area result row."
    return select(
        bangumi_table.c.id.label("bangumi_id"),
        bangumi_table.c.title.label("bangumi_title"),
        bangumi_table.c.title_cn,
        bangumi_table.c.cover_url,
        bangumi_table.c.city,
        func.count(points_table.c.id).label("points_count"),
    )


def _area_group() -> Select:
    "Area columns grouped per bangumi, ready for proximity filtering."
    return _area_columns().group_by(
        bangumi_table.c.id,
        bangumi_table.c.title,
        bangumi_table.c.title_cn,
        bangumi_table.c.cover_url,
        bangumi_table.c.city,
    )


def _area_select(search_point: ColumnElement[object], radius_m: int) -> Select:
    """Works with points within ``radius_m`` of (lat, lng), with counts."""
    return (
        _area_group()
        .join(points_table, points_table.c.bangumi_id == bangumi_table.c.id)
        .where(st_dwithin(_area_location(), search_point, radius_m))
        .limit(10)
    )


def _single_title_select(title: str) -> Select:
    """One matching id whose title (ja or cn) contains ``title``."""
    return select(bangumi_table.c.id).where(_title_where(title)).limit(1)


def _title_columns() -> Select:
    "The ranked title-result columns, with normalized cover/city/count."
    return select(
        bangumi_table.c.id,
        bangumi_table.c.title,
        bangumi_table.c.title_cn,
        func.coalesce(bangumi_table.c.cover_url, "").label("cover_url"),
        func.coalesce(bangumi_table.c.city, "").label("city"),
        func.coalesce(bangumi_table.c.points_count, 0).label("points_count"),
    )


def _title_rows_select(title: str) -> Select:
    """Matching works with normalized cover/city/count fields, ranked."""
    return (
        _title_columns()
        .where(_title_where(title))
        .order_by(bangumi_table.c.points_count.desc().nulls_last())
        .limit(10)
    )


def _candidate_columns() -> Select:
    "The per-work columns of one candidate subquery."
    return select(
        bangumi_table.c.id,
        bangumi_table.c.cover_url,
        bangumi_table.c.city,
        bangumi_table.c.points_count,
    )


def _candidate_where(requested: FromClause) -> ColumnElement[bool]:
    "ILIKE match against a requested title for one candidate row."
    return or_(
        bangumi_table.c.title.ilike(requested.c.title, escape="\\"),
        bangumi_table.c.title_cn.ilike(requested.c.title, escape="\\"),
    )


def _candidate_subquery(titles: list[str]) -> FromClause:
    """Best match per requested title inside an ``unnest`` LATERAL."""
    requested = unnest_with_ordinality(titles)
    return (
        _candidate_columns()
        .where(_candidate_where(requested))
        .order_by(bangumi_table.c.points_count.desc().nulls_last())
        .limit(1)
    ).subquery("b")


def _candidate_outer(requested: FromClause, best_match: FromClause) -> Select:
    "The outer columns aligned to one best-match candidate row."
    return select(
        requested.c.title.label("title"),
        best_match.c.id.label("bangumi_id"),
        func.coalesce(best_match.c.cover_url, "").label("cover_url"),
        func.coalesce(best_match.c.city, "").label("city"),
        func.coalesce(best_match.c.points_count, 0).label("points_count"),
    )


def _candidate_select(titles: list[str]) -> Select:
    """One best match per requested title, in request order."""
    requested = unnest_with_ordinality(titles)
    best_match = _candidate_subquery(titles)
    return (
        _candidate_outer(requested, best_match)
        .select_from(requested.outerjoin(best_match, true()))
        .order_by(requested.c.ord)
    )


def _existing_ids_select(bangumi_ids: list[str]) -> Select:
    """The subset of ids that exist (FK-backed route associations)."""
    return select(bangumi_table.c.id).where(bangumi_table.c.id.in_(bangumi_ids))


def _rating_select(limit: int) -> Select:
    """Top-rated works, highest rating first."""
    return (
        select(bangumi_table)
        .order_by(bangumi_table.c.rating.desc().nulls_last())
        .limit(limit)
    )


class _BangumiReadMixin:
    """Direct bangumi row reads over one session factory."""

    _sessionmaker: AsyncSessionFactory

    async def get_bangumi(self, bangumi_id: str) -> BangumiRow | None:
        """One work row by id, or ``None``."""
        async with self._sessionmaker() as session:
            result = await session.execute(
                select(bangumi_table).where(bangumi_table.c.id == bangumi_id)
            )
        row = result.first()
        return cast(BangumiRow, dict(row._mapping)) if row is not None else None

    async def filter_existing_ids(
        self,
        bangumi_ids: list[str],
    ) -> list[str]:
        """The subset of ids that exist (FK-backed route associations)."""
        if not bangumi_ids:
            return []
        async with self._sessionmaker() as session:
            result = await session.execute(_existing_ids_select(bangumi_ids))
            return [str(value) for value in result.scalars()]

    async def list_bangumi(self, *, limit: int = 50) -> list[BangumiRow]:
        """Top-rated works, highest rating first."""
        async with self._sessionmaker() as session:
            rows = await session.execute(_rating_select(limit))
            return [cast(BangumiRow, dict(row._mapping)) for row in rows.all()]


class _BangumiSearchMixin:
    """Title/area/candidate search operations over one session factory."""

    _sessionmaker: AsyncSessionFactory

    async def get_bangumi_by_area(
        self, lat: float, lng: float, radius_m: int = 50000
    ) -> list[BangumiAreaRow]:
        """Works with points within ``radius_m`` of (lat, lng), with counts."""
        search_point = sa_cast(st_makepoint(lng, lat), Geography())
        async with self._sessionmaker() as session:
            rows = await session.execute(_area_select(search_point, radius_m))
        return [cast(BangumiAreaRow, dict(row._mapping)) for row in rows.all()]

    async def find_bangumi_by_title(self, title: str) -> str | None:
        """First id whose title (ja or cn) contains ``title``."""
        async with self._sessionmaker() as session:
            result = await session.execute(_single_title_select(title))
            raw = result.scalar_one_or_none()
        return str(raw) if raw is not None else None

    async def find_all_by_title(self, title: str) -> list[BangumiTitleRow]:
        """Matching works with normalized cover/city/count fields, ranked."""
        async with self._sessionmaker() as session:
            rows = await session.execute(_title_rows_select(title))
        return [cast(BangumiTitleRow, dict(row._mapping)) for row in rows.all()]

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[BangumiCandidateRow]:
        """One best match per requested title, in request order."""
        if not titles:
            return []
        async with self._sessionmaker() as session:
            rows = await session.execute(_candidate_select(titles))
        return [cast(BangumiCandidateRow, dict(row._mapping)) for row in rows.all()]


class SQLModelBangumiRepository(_BangumiReadMixin, _BangumiSearchMixin):
    """Bangumi-related read operations (read-only, #839)."""

    def __init__(self, sessionmaker: AsyncSessionFactory) -> None:
        self._sessionmaker = sessionmaker


__all__ = ["SQLModelBangumiRepository"]
