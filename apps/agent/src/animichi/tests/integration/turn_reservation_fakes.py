"""Shared helpers for the real-Postgres turn-reservation store tests (TURN-2 #949).

Both reservation-store test files run against the real Postgres container and
share the ``repos`` fixture, request-builder (``_reserve``), id helpers, and
cleanup. Not a test module (no ``test_`` prefix), so pytest does not collect it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from animichi.application.identity import UsageScope
from animichi.application.turn_admission_port import ReserveRequest
from animichi.infrastructure.persistence.models import reservation_table
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)

ANON_ID = "anon_0123456789abcdef0123456789abcdef"


def _turn_key(prefix: str = "turn") -> str:
    return f"{prefix}-{uuid4().hex}"


async def _cleanup(db: PersistenceRepos, session_ids: list[str]) -> None:
    from sqlalchemy import delete

    from animichi.infrastructure.persistence.models import session_table

    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(reservation_table).where(
                    reservation_table.c.session_id.in_(session_ids)
                )
            )
            await session.execute(
                delete(session_table).where(session_table.c.id.in_(session_ids))
            )


async def _reservation_count(db: PersistenceRepos, session_id: str) -> int:
    from sqlalchemy import func, select

    async with db.sessionmaker() as session:
        result = await session.execute(
            select(func.count())
            .select_from(reservation_table)
            .where(reservation_table.c.session_id == session_id)
        )
    return int(result.scalar_one())


def _ids(prefix: str = "sess") -> tuple[str, str]:
    return f"{prefix}-{uuid4().hex}", _turn_key(prefix)


def _reserve(
    *,
    session_id: str | None,
    turn_key: str,
    identity_id: str | None = ANON_ID,
    expected_revision: int | None = None,
    session_digest: str | None = None,
    request_digest: str | None = None,
    owner: str | None = "integration-test",
    lease_expires_at: datetime | None = None,
    payer: UsageScope = "anon",
) -> ReserveRequest:
    expires_at = lease_expires_at or datetime.now(UTC) + timedelta(minutes=1)
    return ReserveRequest(
        session_id=session_id,
        turn_key=turn_key,
        identity_id=identity_id,
        payer=payer,
        expected_revision=expected_revision,
        session_digest=session_digest,
        request_digest=request_digest,
        owner=owner,
        lease_expires_at=expires_at,
    )
