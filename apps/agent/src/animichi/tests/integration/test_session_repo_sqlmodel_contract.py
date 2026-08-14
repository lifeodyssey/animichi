"""SQLModel session-aggregate repository contract against real PostgreSQL 18.

Exercises the migrated persistence seam (#994) through the repository's
public methods: create/load, state upsert semantics, ownership, the ordered
transcript with database-generated UUIDv7 identities, the revision CAS, and
the cross-table adoption unit of work. All fixtures and assertions go through
ORM operations — no raw SQL execution (raw-SQL policy, #999).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

import pytest
from sqlalchemy import select

from animichi.application.adopt_sessions import ADOPT_TURN_KEY_PREFIX
from animichi.infrastructure.persistence.database import (
    DatabaseLifecycle,
    create_database_lifecycle,
)
from animichi.infrastructure.persistence.models import (
    message_table,
    reservation_table,
    session_table,
)
from animichi.infrastructure.persistence.repositories.session import (
    SQLModelSessionRepository,
)
from animichi.tests.conftest_db import DatabaseTarget

_ANON_ID = "anon_" + "a" * 32
_OWNED_ID = "user-neon-1"


@pytest.fixture
async def session_repo(
    pg_container: DatabaseTarget,
) -> AsyncIterator[SQLModelSessionRepository]:
    lifecycle: DatabaseLifecycle = create_database_lifecycle(pg_container.dsn)
    try:
        yield SQLModelSessionRepository(lifecycle.sessionmaker)
    finally:
        await lifecycle.close()


async def _clear(repo: SQLModelSessionRepository) -> None:
    async with repo._sessionmaker() as session:
        async with session.begin():
            await session.execute(reservation_table.delete())
            await session.execute(session_table.delete())


async def _session_ids(repo: SQLModelSessionRepository) -> set[str]:
    async with repo._sessionmaker() as session:
        result = await session.execute(select(session_table.c.id))
        return {str(row) for row in result.scalars()}


async def test_create_and_load_roundtrip(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        state = {"interactions": [], "last_intent": "general_qa"}
        await session_repo.create(_OWNED_ID, "user-1", "你好", state)
        record = await session_repo.load(_OWNED_ID)
        assert record is not None
        assert record.session_id == _OWNED_ID
        assert record.user_id == "user-1"
        assert record.first_query == "你好"
        assert record.state == state
    finally:
        await _clear(session_repo)


async def test_upsert_session_state_then_read(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {"n": 1})
        await session_repo.upsert_session_state(_OWNED_ID, {"n": 2})
        assert await session_repo.get_session_state(_OWNED_ID) == {"n": 2}
    finally:
        await _clear(session_repo)


async def test_upsert_session_keeps_existing_owner_and_metadata(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {"n": 1})
        await session_repo.upsert_session(
            _OWNED_ID, {"n": 2}, metadata={"title": "t"}, user_id=None
        )
        record = await session_repo.load(_OWNED_ID)
        assert record is not None
        assert record.state == {"n": 2}
        assert record.user_id == "user-1"
        assert record.metadata == {"title": "t"}
    finally:
        await _clear(session_repo)


async def test_check_session_owner(session_repo: SQLModelSessionRepository) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {})
        assert await session_repo.check_session_owner(_OWNED_ID, "user-1") is True
        assert await session_repo.check_session_owner(_OWNED_ID, "intruder") is False
    finally:
        await _clear(session_repo)


async def test_messages_are_ordered_with_database_generated_uuidv7(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {})
        await session_repo.insert_message(_OWNED_ID, "user", "hello")
        await session_repo.insert_message(
            _OWNED_ID, "assistant", "hi there", response_data={"intent": "qa"}
        )
        rows = await session_repo.get_messages(_OWNED_ID)
        assert [row.role for row in rows] == ["user", "assistant"]
        assert rows[1].response_data == {"intent": "qa"}
        async with session_repo._sessionmaker() as session:
            ids = (
                (
                    await session.execute(
                        select(message_table.c.id).where(
                            message_table.c.session_id == _OWNED_ID
                        )
                    )
                )
                .scalars()
                .all()
            )
        for raw_id in ids:
            parsed = UUID(str(raw_id))
            assert parsed.version == 7
            assert str(raw_id) == str(parsed)
    finally:
        await _clear(session_repo)


async def test_history_gates_ownership_and_reports_revision(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {})
        await session_repo.insert_message(_OWNED_ID, "user", "hello")
        hidden = await session_repo.history(_OWNED_ID, "intruder", limit=10, offset=0)
        assert hidden is None
        page = await session_repo.history(_OWNED_ID, "user-1", limit=10, offset=0)
        assert page is not None
        assert page.user_id == "user-1"
        assert len(page.messages) == 1
        assert page.revision == 0
    finally:
        await _clear(session_repo)


async def test_adoption_moves_ownership_and_bumps_revision(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_ANON_ID, _ANON_ID, "q", {})
        outcome = await session_repo.adopt_ownership(_ANON_ID, _OWNED_ID)
        assert outcome.adopted_count == 1
        assert outcome.revisions_bumped == 1
        assert await session_repo.check_session_owner(_ANON_ID, _OWNED_ID) is True
        assert await session_repo.current_revision(_ANON_ID) == 1
        again = await session_repo.adopt_ownership(_ANON_ID, _OWNED_ID)
        assert again.adopted_count == 0
        assert again.revisions_bumped == 0
    finally:
        await _clear(session_repo)


async def test_list_sessions_and_update_title(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_OWNED_ID, "user-1", "q", {})
        listed = await session_repo.list_sessions("user-1")
        assert [item["session_id"] for item in listed] == [_OWNED_ID]
        assert (
            await session_repo.update_title(_OWNED_ID, "新标题", user_id="user-1")
            is True
        )
        assert (
            await session_repo.update_title(_OWNED_ID, "no", user_id="intruder")
            is False
        )
        record = await session_repo.load(_OWNED_ID)
        assert record is not None
        assert record.title == "新标题"
    finally:
        await _clear(session_repo)


async def test_turn_marker_rows_never_use_the_client_turn_key_namespace(
    session_repo: SQLModelSessionRepository,
) -> None:
    await _clear(session_repo)
    try:
        await session_repo.create(_ANON_ID, _ANON_ID, "q", {})
        await session_repo.adopt_ownership(_ANON_ID, _OWNED_ID)
        async with session_repo._sessionmaker() as session:
            keys = (
                (
                    await session.execute(
                        select(reservation_table.c.turn_key).where(
                            reservation_table.c.session_id == _ANON_ID
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert keys == [f"{ADOPT_TURN_KEY_PREFIX}{_ANON_ID}"]
    finally:
        await _clear(session_repo)
