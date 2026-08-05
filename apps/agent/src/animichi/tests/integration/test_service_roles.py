"""Role-level grant contracts for the DB-per-service split (testcontainer).

The 20260620233000_service_roles migration creates two NOLOGIN roles and splits
the schema: ``catalog_svc`` owns catalog/ingest tables; ``agent_svc`` may write
operational tables but only SELECT the catalog tables it reads (bangumi, points).

The testcontainer runs as superuser, so we exercise the grants two ways:

  1. ``SET ROLE agent_svc`` then attempt a real INSERT on ``points``. Privilege
     checks run BEFORE row-level security, so a missing INSERT grant surfaces as
     InsufficientPrivilegeError regardless of RLS — proving the denial.

  2. ``has_table_privilege(role, table, priv)`` for the ALLOWED assertions. The
     operational tables have RLS enabled with no permissive policy for these
     custom roles, so a real INSERT would be blocked by RLS even when the GRANT
     is present — which would conflate the two layers. has_table_privilege probes
     the GRANT layer directly, which is exactly the contract under test here.
"""

import asyncpg
import pytest

pytestmark = pytest.mark.integration


async def test_agent_svc_denied_insert_on_points(db_pool: asyncpg.Pool) -> None:
    """agent_svc has no INSERT on the catalog table ``points`` (SELECT-only)."""
    async with db_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SET LOCAL ROLE agent_svc")
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                await conn.execute(
                    "INSERT INTO points (id, name, latitude, longitude) "
                    "VALUES ('role_test', 'x', 0, 0)"
                )


async def test_agent_svc_can_select_points(db_pool: asyncpg.Pool) -> None:
    """agent_svc keeps SELECT on points (the catalog table it reads directly)."""
    async with db_pool.acquire() as conn:
        granted = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.points', 'SELECT')"
        )
    assert granted is True


async def test_agent_svc_allowed_insert_on_operational_table(
    db_pool: asyncpg.Pool,
) -> None:
    """agent_svc holds INSERT on operational tables, including conversations."""
    async with db_pool.acquire() as conn:
        sessions_grant = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.sessions', 'INSERT')"
        )
        conversations_grant = await conn.fetchval(
            "SELECT has_table_privilege('agent_svc', 'public.conversations', 'INSERT')"
        )
    assert sessions_grant is True
    assert conversations_grant is True


async def test_catalog_svc_allowed_insert_on_points(db_pool: asyncpg.Pool) -> None:
    """catalog_svc owns the catalog tables — it may INSERT into points."""
    async with db_pool.acquire() as conn:
        granted = await conn.fetchval(
            "SELECT has_table_privilege('catalog_svc', 'public.points', 'INSERT')"
        )
    assert granted is True
