"""TurnAdmission through the live repositories (TURN-2 #949).

Runs the application use case against the real Postgres store, usage meter,
and anon-quota counter: initial/continued admission, quota and budget
rejection (with the reservation released), and the BYOK pass.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, func, select

from animichi.application.admission_limits import utc_today
from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    AdmissionRequest,
    TurnAdmission,
)
from animichi.infrastructure.persistence.models import (
    anon_quota_table,
    daily_usage_table,
    reservation_table,
)
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)

pytestmark = pytest.mark.integration


def _anon_id() -> str:
    """A unique anonymous identity per test run — the admission suite must
    not collide with other suites' settled anon-quota rows for today."""
    return f"anon_{uuid.uuid4().hex}"


ANON = AdmissionIdentity(user_id=_anon_id(), user_type="anonymous")
HUMAN = AdmissionIdentity(user_id="user-1", user_type="human")


async def _cleanup(
    db: PersistenceRepos, session_ids: list[str], anon_ids: list[str]
) -> None:
    async with db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                delete(reservation_table).where(
                    reservation_table.c.session_id.in_(session_ids)
                )
            )
            await session.execute(
                delete(anon_quota_table).where(anon_quota_table.c.anon_id.in_(anon_ids))
            )
            await session.execute(
                delete(daily_usage_table).where(
                    daily_usage_table.c.usage_date == utc_today(),
                    daily_usage_table.c.scope == "anon",
                )
            )


def _request(
    *,
    identity: AdmissionIdentity = ANON,
    session_id: str | None = None,
    turn_key: str | None = None,
    expected_revision: int | None = None,
    is_byok: bool = False,
) -> AdmissionRequest:
    return AdmissionRequest(
        identity=identity,
        session_id=session_id,
        turn_key=turn_key or f"turn-{uuid.uuid4().hex}",
        expected_revision=expected_revision,
        is_byok=is_byok,
    )


async def _reservation_count(db: PersistenceRepos, session_id: str) -> int:
    async with db.sessionmaker() as session:
        result = await session.execute(
            select(func.count())
            .select_from(reservation_table)
            .where(reservation_table.c.session_id == session_id)
        )
    return int(result.scalar_one())


async def _anon_quota_count(db: PersistenceRepos, anon_id: str) -> int:
    async with db.sessionmaker() as session:
        result = await session.execute(
            select(func.count())
            .select_from(anon_quota_table)
            .where(anon_quota_table.c.anon_id == anon_id)
        )
    return int(result.scalar_one())


def _admission(db: PersistenceRepos, *, policy: AdmissionPolicy) -> TurnAdmission:
    return TurnAdmission(
        store=db.turn_reservation,
        policy=policy,
        usage_repo=db.usage,
        anon_quota_repo=db.anon_quota,
    )


async def test_initial_and_continued_admission_through_the_live_store(
    real_db: PersistenceRepos,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy())
    try:
        first = await admission(_request(session_id=session_id, expected_revision=0))
        assert first.admitted is True
        assert first.revision == 1
        second = await admission(
            _request(
                session_id=session_id,
                expected_revision=first.revision,
            )
        )
        assert second.admitted is True
        assert second.revision == 2
    finally:
        await _cleanup(real_db, [session_id], [])


async def test_quota_exhaustion_rejects_and_releases_the_reservation(
    real_db: PersistenceRepos,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(quota=1, budget_usd=0))
    try:
        first = await admission(_request(session_id=session_id))
        assert first.admitted is True
        await real_db.anon_quota.increment_and_count(
            usage_date=utc_today(), anon_id=str(ANON.user_id)
        )
        exhausted = await admission(
            _request(
                session_id=session_id,
                expected_revision=first.revision,
            )
        )
        assert exhausted.admitted is False
        assert exhausted.rejection is not None
        assert exhausted.rejection.reason == "quota_exhausted"
        count = await _reservation_count(real_db, session_id)
        # Only the exhausted attempt's reservation was released; the first
        # admitted turn's reservation persists as the session's revision 1.
        assert count == 1
    finally:
        await _cleanup(real_db, [session_id], [str(ANON.user_id)])


async def test_budget_exhaustion_rejects_before_any_reservation(
    real_db: PersistenceRepos,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(budget_usd=5.0))
    try:
        await real_db.usage.accumulate_usage(
            usage_date=utc_today(),
            scope="anon",
            requests=1,
            input_tokens=0,
            output_tokens=0,
            cost_usd=5.0,
        )
        verdict = await admission(_request(session_id=session_id))
        assert verdict.admitted is False
        assert verdict.rejection is not None
        assert verdict.rejection.reason == "budget_exhausted"
        count = await _reservation_count(real_db, session_id)
        assert count == 0
    finally:
        await _cleanup(real_db, [session_id], [])


async def test_byok_passes_without_consuming_anon_quota(
    real_db: PersistenceRepos,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(quota=1))
    try:
        verdict = await admission(
            _request(identity=HUMAN, session_id=session_id, is_byok=True)
        )
        assert verdict.admitted is True
        assert verdict.payer == "byok"
        count = await _anon_quota_count(real_db, str(ANON.user_id))
        assert count == 0
    finally:
        await _cleanup(real_db, [session_id], [])
