"""Unit tests for agent.agents.session_ownership (issue #273 Task 3)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from agent.agents.session_ownership import migrate_session_ownership


def _db(*, migrate_return: bool = True) -> MagicMock:
    db = MagicMock()
    db.session.migrate_ownership = AsyncMock(return_value=migrate_return)
    return db


async def test_missing_from_anon_id_is_a_no_op_without_a_db_call() -> None:
    db = _db()
    outcome = await migrate_session_ownership(
        db, from_anon_id=None, to_user_id="user-1"
    )
    assert outcome.migrated is False
    db.session.migrate_ownership.assert_not_called()


async def test_forwards_to_repository_and_returns_true_on_match() -> None:
    db = _db(migrate_return=True)
    outcome = await migrate_session_ownership(
        db, from_anon_id="anon_" + "a" * 32, to_user_id="user-1"
    )
    assert outcome.migrated is True
    db.session.migrate_ownership.assert_awaited_once_with("anon_" + "a" * 32, "user-1")


async def test_zero_matched_rows_is_a_typed_no_op_not_an_exception() -> None:
    db = _db(migrate_return=False)
    outcome = await migrate_session_ownership(
        db, from_anon_id="anon_" + "b" * 32, to_user_id="user-1"
    )
    assert outcome.migrated is False
