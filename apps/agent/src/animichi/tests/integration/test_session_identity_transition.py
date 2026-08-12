"""Real-Postgres coverage for session identity adoption (SESSION-2 #960).
Uses testcontainer Postgres via `real_db`.
"""

from __future__ import annotations

import uuid

import pytest

from animichi.infrastructure.supabase.client import SupabaseClient

# `animichi.tests.conftest_db` is already registered by the directory-level
# `tests/integration/conftest.py` (`pytest_plugins`) — redeclaring it here
# would be a no-op duplicate (review round 2 Sonar smell).


def _anon_id() -> str:
    return "anon_" + uuid.uuid4().hex


async def _seed_session(
    db: SupabaseClient, session_id: str, user_id: str, query: str = "hello"
) -> None:
    await db.session.create(session_id, user_id, query, {"k": "v"})


@pytest.mark.integration
async def test_adoption_moves_ownership_and_preserves_content(real_db) -> None:
    """Reading state AND message history after the adoption must match the
    pre-login read exactly — the adoption re-points ownership only."""
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "君の名はの聖地は？")
    await real_db.session.insert_message(session_id, "user", "君の名はの聖地は？")
    await real_db.session.insert_message(session_id, "assistant", "3件見つかりました。")
    messages_before = await real_db.session.get_messages(session_id)

    result = await real_db.session.adopt_ownership(anon, "real-user-1")
    assert result.adopted_count == 1
    assert result.revisions_bumped == 1

    record = await real_db.session.load(session_id)
    assert record is not None
    assert record.user_id == "real-user-1"
    state = await real_db.session.get_session_state(session_id)
    assert state == {"k": "v"}
    messages_after = await real_db.session.get_messages(session_id)
    assert messages_after == messages_before
    assert len(messages_after) == 2


@pytest.mark.integration
async def test_adoption_moves_every_session_for_the_same_anon_identity(
    real_db,
) -> None:
    anon = _anon_id()
    session_a = f"sess-{uuid.uuid4().hex}"
    session_b = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_a, anon, "query a")
    await _seed_session(real_db, session_b, anon, "query b")

    result = await real_db.session.adopt_ownership(anon, "real-user-2")
    assert result.adopted_count == 2
    assert result.revisions_bumped == 2

    sess_a = await real_db.session.load(session_a)
    sess_b = await real_db.session.load(session_b)
    assert sess_a is not None
    assert sess_a.user_id == "real-user-2"
    assert sess_b is not None
    assert sess_b.user_id == "real-user-2"


@pytest.mark.integration
async def test_original_anon_identity_loses_ownership_after_adoption(
    real_db,
) -> None:
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "query")

    await real_db.session.adopt_ownership(anon, "real-user-3")

    assert await real_db.session.check_session_owner(session_id, anon) is False
    assert await real_db.session.check_session_owner(session_id, "real-user-3") is True


@pytest.mark.integration
async def test_replay_adoption_is_a_no_op_and_bumps_nothing(real_db) -> None:
    """Replaying the adoption (a repeated magic-link tap) matches zero rows and
    bumps no revision — the second run is a typed no-op, never an error."""
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "query")

    first = await real_db.session.adopt_ownership(anon, "real-user-4")
    second = await real_db.session.adopt_ownership(anon, "real-user-4")

    assert first.adopted_count == 1
    assert first.revisions_bumped == 1
    assert second.adopted_count == 0
    assert second.revisions_bumped == 0
    record = await real_db.session.load(session_id)
    assert record is not None
    assert record.user_id == "real-user-4"


@pytest.mark.integration
async def test_adoption_bumps_revision_so_pre_adoption_capabilities_go_stale(
    real_db,
) -> None:
    """Capability invalidation: adoption bumps the adopted session's revision,
    so a pre-adoption capability (the reservation at the old revision) is
    invalidated — the session's current revision is strictly higher."""
    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "query")

    revision_before = await real_db.turn_reservation.current_revision(session_id)

    await real_db.session.adopt_ownership(anon, "real-user-5")

    revision_after = await real_db.turn_reservation.current_revision(session_id)
    assert revision_after == revision_before + 1


@pytest.mark.integration
async def test_pre_adoption_anonymous_capability_is_stale_after_adoption(
    real_db,
) -> None:
    """A pre-adoption anonymous capability (a reservation at the old revision)
    is invalidated by the adoption's revision bump: the newly adopted user
    resuming with the stale expected revision answers stale_revision (the 409
    capability CAS), even though they now own the session."""
    from animichi.application.turn_admission import (
        AdmissionIdentity,
        AdmissionPolicy,
        AdmissionRequest,
        TurnAdmission,
    )

    anon = _anon_id()
    session_id = f"sess-{uuid.uuid4().hex}"
    await _seed_session(real_db, session_id, anon, "query")

    admission = TurnAdmission(
        store=real_db.turn_reservation,
        policy=AdmissionPolicy(),
        usage_repo=real_db.usage,
        anon_quota_repo=real_db.anon_quota,
    )
    anon_identity = AdmissionIdentity(user_id=anon, user_type="anonymous")

    pre_adoption = await admission(
        AdmissionRequest(
            identity=anon_identity,
            session_id=session_id,
            turn_key=f"pre-adoption-{uuid.uuid4().hex}",
            expected_revision=0,
            is_byok=False,
        )
    )
    assert pre_adoption.admitted is True
    assert pre_adoption.revision == 1

    await real_db.session.adopt_ownership(anon, "real-user-6")

    adopted_user = AdmissionIdentity(user_id="real-user-6", user_type="human")
    resumed = await admission(
        AdmissionRequest(
            identity=adopted_user,
            session_id=session_id,
            turn_key=f"resumed-{uuid.uuid4().hex}",
            expected_revision=pre_adoption.revision,
            is_byok=False,
        )
    )
    assert resumed.admitted is False
    assert resumed.rejection is not None
    assert resumed.rejection.reason == "stale_revision"

    await real_db.pool.execute(
        "DELETE FROM turn_reservations WHERE session_id = $1", session_id
    )
