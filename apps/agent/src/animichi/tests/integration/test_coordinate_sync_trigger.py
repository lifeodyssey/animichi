"""PostgreSQL contract for the #1217 coordinate-sync trigger.

``sync_points_coordinates()`` (migrations/neon/20260826000002_functions.sql,
amended by 20260829000000_fix_coordinate_sync_precedence.sql) backs the
BEFORE INSERT/UPDATE triggers on ``locations`` and ``points``. The baseline's
unconditional rewrite fixed the geography-only write but silently REVERTED a
scalar-only update on a row whose ``location`` was already set — the trigger
saw the old non-null ``NEW.location`` and overwrote the just-written scalars
from it. The precedence rule under test, per statement: a NULL location is
rebuilt from the scalars; a geography write rewrites the scalars; a
scalar-only write moves the geography; a write touching neither does nothing.
``locations`` is used over ``points`` because it carries the same trigger
with a narrower NOT NULL surface (system-health-audit 2026-08-26 §3).
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg
import pytest

# Two arbitrary, distinct real-world anchors so a stale-vs-fresh mismatch is
# unambiguous rather than a coincidental float-equality false pass.
TOKYO_LON, TOKYO_LAT = 139.767052, 35.681236
OSAKA_LON, OSAKA_LAT = 135.502165, 34.693738


async def _insert_scalar_only(pool: asyncpg.Pool, location_id: str) -> None:
    await pool.execute(
        """
        INSERT INTO public.locations (id, name, kind, latitude, longitude, source)
        VALUES ($1, 'coordinate-sync-fixture', 'landmark', $2, $3, 'manual')
        """,
        location_id,
        TOKYO_LAT,
        TOKYO_LON,
    )


async def _fetch(pool: asyncpg.Pool, location_id: str) -> asyncpg.Record:
    record = await pool.fetchrow(
        """
        SELECT latitude, longitude,
               ST_Y(location::geometry) AS location_lat,
               ST_X(location::geometry) AS location_lon
        FROM public.locations WHERE id = $1
        """,
        location_id,
    )
    assert record is not None
    return record


@pytest.fixture
async def location_id(db_pool: asyncpg.Pool) -> AsyncIterator[str]:
    value = "test-1217-coordinate-sync"
    yield value
    await db_pool.execute("DELETE FROM public.locations WHERE id = $1", value)


async def test_scalar_only_insert_derives_location(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    await _insert_scalar_only(db_pool, location_id)

    row = await _fetch(db_pool, location_id)

    assert row["location_lat"] == pytest.approx(TOKYO_LAT)
    assert row["location_lon"] == pytest.approx(TOKYO_LON)


async def test_geography_only_update_rewrites_stale_scalars(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    """Red before #1217: a geography-only write left the scalars at their
    pre-existing (now stale) values instead of the new location."""
    await _insert_scalar_only(db_pool, location_id)

    await db_pool.execute(
        """
        UPDATE public.locations
        SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        WHERE id = $1
        """,
        location_id,
        OSAKA_LON,
        OSAKA_LAT,
    )
    row = await _fetch(db_pool, location_id)

    assert row["latitude"] == pytest.approx(OSAKA_LAT)
    assert row["longitude"] == pytest.approx(OSAKA_LON)


async def test_scalar_only_update_moves_location(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    """Red under the baseline function: with ``location`` already set, the
    ELSIF overwrote the freshly written scalars from the OLD geography, so
    the update silently reverted and the row kept both Tokyo representations."""
    await _insert_scalar_only(db_pool, location_id)

    await db_pool.execute(
        """
        UPDATE public.locations
        SET latitude = $2, longitude = $3
        WHERE id = $1
        """,
        location_id,
        OSAKA_LAT,
        OSAKA_LON,
    )
    row = await _fetch(db_pool, location_id)

    assert row["latitude"] == pytest.approx(OSAKA_LAT)
    assert row["longitude"] == pytest.approx(OSAKA_LON)
    assert row["location_lat"] == pytest.approx(OSAKA_LAT)
    assert row["location_lon"] == pytest.approx(OSAKA_LON)


async def test_nulled_location_rebuilds_from_scalars(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    """A NULL location is never terminal: the scalar pair (NOT NULL on both
    tables) is the surviving representation, so the geography is rebuilt."""
    await _insert_scalar_only(db_pool, location_id)

    await db_pool.execute(
        "UPDATE public.locations SET location = NULL WHERE id = $1",
        location_id,
    )
    row = await _fetch(db_pool, location_id)

    assert row["location_lat"] == pytest.approx(TOKYO_LAT)
    assert row["location_lon"] == pytest.approx(TOKYO_LON)


async def test_unrelated_update_preserves_both_representations(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    """An update touching neither representation (name-only, the shape of an
    ``updated_at`` bump) must not mangle either one."""
    await _insert_scalar_only(db_pool, location_id)

    await db_pool.execute(
        "UPDATE public.locations SET name = 'coordinate-sync-renamed' WHERE id = $1",
        location_id,
    )
    row = await _fetch(db_pool, location_id)

    assert row["latitude"] == pytest.approx(TOKYO_LAT)
    assert row["longitude"] == pytest.approx(TOKYO_LON)
    assert row["location_lat"] == pytest.approx(TOKYO_LAT)
    assert row["location_lon"] == pytest.approx(TOKYO_LON)


async def test_combined_update_keeps_scalars_and_location_consistent(
    db_pool: asyncpg.Pool, location_id: str
) -> None:
    await _insert_scalar_only(db_pool, location_id)

    await db_pool.execute(
        """
        UPDATE public.locations
        SET latitude = $2, longitude = $3,
            location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
        WHERE id = $1
        """,
        location_id,
        OSAKA_LAT,
        OSAKA_LON,
    )
    row = await _fetch(db_pool, location_id)

    assert row["latitude"] == pytest.approx(OSAKA_LAT)
    assert row["longitude"] == pytest.approx(OSAKA_LON)
    assert row["location_lat"] == pytest.approx(OSAKA_LAT)
    assert row["location_lon"] == pytest.approx(OSAKA_LON)
