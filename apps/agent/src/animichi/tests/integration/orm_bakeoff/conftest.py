"""ORM bake-off fixtures: one real migrated PostgreSQL, two ORM candidates.

The SQLModel candidate is the production implementation
(``infrastructure.persistence.repositories.turn_reservation``, #994) — the
bake-off proved the pattern and the production adapter now satisfies the same
contracts. Tortoise remains as the rejected-candidate reference until the
#992 cutover deletes it.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from urllib.parse import urlsplit, urlunsplit

import pytest

from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.persistence.database import create_database_lifecycle
from animichi.infrastructure.persistence.repositories.turn_reservation import (
    SQLModelTurnReservationStore,
)
from animichi.tests.conftest_db import DatabaseTarget
from animichi.tests.integration.orm_bakeoff.protocol import BakeoffTurnStore
from animichi.tests.integration.orm_bakeoff.store_tortoise import TortoiseStore


def bare_dsn(dsn: str) -> str:
    """Strip query parameters the ORM drivers do not need."""
    parts = urlsplit(dsn)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


class AbortProbeStore(SQLModelTurnReservationStore):
    """Test-only adapter: runs the full reserve flow, then aborts the
    transaction, proving a mid-transaction failure rolls everything back."""

    async def reserve_then_fail(self, request: ReserveRequest) -> None:
        async with self._sessionmaker() as session:
            async with session.begin():
                await self._reserve(session, request)
                raise RuntimeError("forced reserve abort")


@pytest.fixture(params=["sqlmodel", "tortoise"])
async def candidate_store(
    request: pytest.FixtureRequest, pg_container: DatabaseTarget
) -> AsyncIterator[BakeoffTurnStore]:
    """Run every contract test once per ORM candidate against the same DB."""
    dsn = bare_dsn(pg_container.dsn)
    if request.param == "sqlmodel":
        lifecycle = create_database_lifecycle(dsn)
        try:
            yield AbortProbeStore(lifecycle.sessionmaker)
        finally:
            await lifecycle.close()
    else:
        await TortoiseStore.connect(dsn)
        try:
            yield TortoiseStore()
        finally:
            await TortoiseStore.close()
