"""Unit tests for animichi.application.adopt_sessions (SESSION-2 #960).

AdoptSessions is the Agent-owned idempotent ownership command. It consumes
only the trusted anonymous identity (``X-Anon-Id``) and the Neon user, accepts
no client Session id, and bumps each adopted session's revision so
pre-adoption anonymous capabilities (reservations, digests) go stale.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from animichi.application.adopt_sessions import (
    AdoptionResult,
    NoOpClass,
    adopt_sessions,
)

VALID_ANON_ID = "anon_" + "a" * 32


def _db(*, result: AdoptionResult | None = None) -> MagicMock:
    db = MagicMock()
    if result is not None:
        db.session.adopt_ownership = AsyncMock(return_value=result)
    return db


async def test_missing_anon_id_is_a_cross_device_no_op_without_a_db_call() -> None:
    db = _db(result=AdoptionResult(adopted_count=3, revisions_bumped=3))
    outcome = await adopt_sessions(db, from_anon_id=None, to_user_id="user-1")
    assert outcome.adopted_count == 0
    assert outcome.noop_class is NoOpClass.NO_ANONYMOUS_IDENTITY
    assert outcome.revisions_bumped == 0
    db.session.adopt_ownership.assert_not_called()


async def test_forwards_to_repository_and_reports_adopted_sessions() -> None:
    db = _db(result=AdoptionResult(adopted_count=2, revisions_bumped=2))
    outcome = await adopt_sessions(db, from_anon_id=VALID_ANON_ID, to_user_id="user-1")
    assert outcome.adopted_count == 2
    assert outcome.noop_class is NoOpClass.ADOPTED
    assert outcome.revisions_bumped == 2
    db.session.adopt_ownership.assert_awaited_once_with(VALID_ANON_ID, "user-1")


async def test_zero_matched_rows_is_a_typed_replay_no_op_not_an_exception() -> None:
    db = _db(result=AdoptionResult(adopted_count=0, revisions_bumped=0))
    outcome = await adopt_sessions(
        db, from_anon_id="anon_" + "b" * 32, to_user_id="user-1"
    )
    assert outcome.adopted_count == 0
    assert outcome.noop_class is NoOpClass.NO_ROWS
    assert outcome.revisions_bumped == 0


async def test_identity_dimensional_signature_has_no_session_id_parameter() -> None:
    """The command accepts exactly the two trusted identities — never a client
    Session id (mutation probe: adding a session_id parameter fails mypy and
    every call site)."""
    import inspect

    signature = inspect.signature(adopt_sessions)
    params = list(signature.parameters)
    assert "session_id" not in params
    assert "from_anon_id" in params
    assert "to_user_id" in params
