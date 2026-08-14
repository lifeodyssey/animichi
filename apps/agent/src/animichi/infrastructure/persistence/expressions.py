"""Constrained PostgreSQL typed expressions for the Agent persistence seam (#995).

Everything PostgreSQL-specific that SQLAlchemy's portable expression layer
cannot express directly lives here and only here: the PostGIS geography type
and the ``ST_*`` functions over it, the ``unnest(ARRAY) WITH ORDINALITY``
table function, and the ILIKE escaping convention. This is the Agent-side
counterpart of the dedicated typed expression module the raw-SQL policy
(#999) exempts.

Rules enforced here:
- No function in this module executes queries — expressions only.
- No function hides a complete SQL statement; ``text()`` is never used.
- Repositories import names from here; they never reach for ``func`` on
  PostGIS/PostgreSQL-specific behavior themselves.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import ARRAY, Text, cast, func
from sqlalchemy.types import UserDefinedType


class Geography(UserDefinedType):
    """PostGIS ``geography`` type (SPHEROID(SRID) geography columns)."""

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "geography"


class Geometry(UserDefinedType):
    """PostGIS ``geometry`` type — used only for ``::geometry`` casts."""

    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "geometry"


def st_makepoint(longitude: object, latitude: object) -> Any:
    """``ST_MakePoint(lon, lat)`` — 4326 lon/lat order, matching the legacy SQL."""
    return func.ST_MakePoint(longitude, latitude)


def st_set_srid(point: object, srid: int) -> Any:
    """``ST_SetSRID(point, srid)`` — legacy fallback coordinates are 4326."""
    return func.ST_SetSRID(point, srid)


def location_or_fallback(
    location_col: object, longitude_col: object, latitude_col: object
) -> Any:
    """``COALESCE(location, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)``.

    The schema keeps ``location`` null for legacy rows and syncs coordinates
    via trigger; reads must treat the fallback pair as the location.
    """
    return func.coalesce(
        location_col,
        cast(st_set_srid(st_makepoint(longitude_col, latitude_col), 4326), Geography),
    )


def st_dwithin(location: Any, point: Any, radius_m: Any) -> Any:
    """``ST_DWithin(location, point, radius_m)`` — meters, geography semantics."""
    return func.ST_DWithin(location, point, radius_m)


def st_distance(location: Any, point: Any) -> Any:
    """``ST_Distance(location, point)`` — meters between two geographies."""
    return func.ST_Distance(location, point)


def latitude_with_fallback(latitude_col: Any, location_col: Any) -> Any:
    """``COALESCE(latitude, ST_Y(location::geometry))``."""
    return func.coalesce(latitude_col, func.ST_Y(cast(location_col, Geometry)))


def longitude_with_fallback(longitude_col: Any, location_col: Any) -> Any:
    """``COALESCE(longitude, ST_X(location::geometry))``."""
    return func.coalesce(longitude_col, func.ST_X(cast(location_col, Geometry)))


def unnest_with_ordinality(values: list[str], *, column: str = "title") -> Any:
    """``unnest(values::text[]) WITH ORDINALITY`` as a table-valued alias.

    The alias exposes the requested ``column`` plus the ``ord`` column, the
    naming the legacy ``AS requested(<column>, ord)`` used, so downstream
    selects keep the same result shape.
    """
    return func.unnest(cast(values, ARRAY(Text))).table_valued(
        column, with_ordinality="ord"
    )


def escaped_ilike_pattern(value: str) -> str:
    """Escape ILIKE metacharacters so ``%``/``_`` in a title match literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
