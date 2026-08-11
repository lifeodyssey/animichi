"""TurnAdmission through the live repositories (TURN-2 #949).

Runs the application use case against the real Postgres store, usage meter,
and anon-quota counter: initial/continued admission, quota and budget
rejection (with the reservation released), and the BYOK pass.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from animichi.application.admission_limits import utc_today
from animichi.application.turn_admission import (
    AdmissionIdentity,
    AdmissionPolicy,
    AdmissionRequest,
    TurnAdmission,
)
from animichi.infrastructure.supabase.client import SupabaseClient

pytestmark = pytest.mark.integration

ANON_ID = "anon_0123456789abcdef0123456789abcdef"
ANON = AdmissionIdentity(user_id=ANON_ID, user_type="anonymous")
HUMAN = AdmissionIdentity(user_id="user-1", user_type="human")


async def _cleanup(
    pool: asyncpg.Pool, session_ids: list[str], anon_ids: list[str]
) -> None:
    await pool.execute(
        "DELETE FROM turn_reservations WHERE session_id = ANY($1::text[])",
        session_ids,
    )
    await pool.execute(
        "DELETE FROM anon_daily_message_count WHERE anon_id = ANY($1::text[])",
        anon_ids,
    )
    await pool.execute(
        "DELETE FROM daily_usage WHERE usage_date = $1 AND scope = 'anon'",
        utc_today(),
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


def _admission(db: SupabaseClient, *, policy: AdmissionPolicy) -> TurnAdmission:
    return TurnAdmission(
        store=db.turn_reservation,
        policy=policy,
        usage_repo=db.usage,
        anon_quota_repo=db.anon_quota,
    )


async def test_initial_and_continued_admission_through_the_live_store(
    real_db: SupabaseClient,
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
        await _cleanup(real_db.pool, [session_id], [])


async def test_quota_exhaustion_rejects_and_releases_the_reservation(
    real_db: SupabaseClient,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(quota=1, budget_usd=0))
    try:
        first = await admission(_request(session_id=session_id))
        assert first.admitted is True
        exhausted = await admission(
            _request(
                session_id=session_id,
                expected_revision=first.revision,
            )
        )
        assert exhausted.admitted is False
        assert exhausted.rejection is not None
        assert exhausted.rejection.reason == "quota_exhausted"
        async with real_db.pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM turn_reservations WHERE session_id = $1",
                session_id,
            )
        # Only the exhausted attempt's reservation was released; the first
        # admitted turn's reservation persists as the session's revision 1.
        assert count == 1
    finally:
        await _cleanup(real_db.pool, [session_id], [ANON_ID])


async def test_budget_exhaustion_rejects_before_any_reservation(
    real_db: SupabaseClient,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(budget_usd=5.0))
    try:
        async with real_db.pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO daily_usage (usage_date, scope, cost_usd) "
                "VALUES ($1, 'anon', 5.0) "
                "ON CONFLICT (usage_date, scope) DO UPDATE SET cost_usd = 5.0",
                utc_today(),
            )
        verdict = await admission(_request(session_id=session_id))
        assert verdict.admitted is False
        assert verdict.rejection is not None
        assert verdict.rejection.reason == "budget_exhausted"
        async with real_db.pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM turn_reservations WHERE session_id = $1",
                session_id,
            )
        assert count == 0
    finally:
        await _cleanup(real_db.pool, [session_id], [])


async def test_byok_passes_without_consuming_anon_quota(
    real_db: SupabaseClient,
) -> None:
    session_id = f"sess-{uuid.uuid4().hex}"
    admission = _admission(real_db, policy=AdmissionPolicy(quota=1))
    try:
        verdict = await admission(
            _request(identity=HUMAN, session_id=session_id, is_byok=True)
        )
        assert verdict.admitted is True
        assert verdict.payer == "byok"
        async with real_db.pool.acquire() as conn:
            count = await conn.fetchval(
                "SELECT count(*) FROM anon_daily_message_count WHERE anon_id = $1",
                ANON_ID,
            )
        assert count == 0
    finally:
        await _cleanup(real_db.pool, [session_id], [])
