"""Unit tests for the SQLModel bangumi read repository (#995).

Behavior-level assertions on the typed statements the repository builds — no
SQL strings are compared and nothing is executed (raw-SQL policy, #999).
"""

from __future__ import annotations

import pytest
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.models import bangumi_table
from animichi.infrastructure.persistence.repositories.bangumi import (
    SQLModelBangumiRepository,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory


def _only_statement(factory: RecordingSessionFactory) -> Select:
    assert len(factory.session.executed) == 1
    statement = factory.session.executed[0]
    assert isinstance(statement, Select)
    return statement


async def test_get_bangumi_returns_row_when_exists() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for({"id": "115908", "title": "Liz and the Blue Bird"})
    repo = SQLModelBangumiRepository(factory)

    result = await repo.get_bangumi("115908")

    assert result is not None
    assert result["id"] == "115908"
    assert _only_statement(factory).get_final_froms()[0] is bangumi_table


async def test_get_bangumi_returns_none_when_not_found() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(None)
    repo = SQLModelBangumiRepository(factory)

    assert await repo.get_bangumi("nonexistent") is None


async def test_get_bangumi_raises_on_statement_error() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(error=RuntimeError)
    repo = SQLModelBangumiRepository(factory)

    with pytest.raises(RuntimeError):
        await repo.get_bangumi("115908")


async def test_filter_existing_ids_preserves_input_order() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(["p2", "p1"])
    repo = SQLModelBangumiRepository(factory)

    assert await repo.filter_existing_ids(["p1", "p2"]) == ["p2", "p1"]


async def test_filter_existing_ids_empty_input() -> None:
    factory = RecordingSessionFactory()
    repo = SQLModelBangumiRepository(factory)

    assert await repo.filter_existing_ids([]) == []
    assert factory.session.executed == []


async def test_list_bangumi_returns_rows() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([{"id": "115908", "title": "Liz"}])
    repo = SQLModelBangumiRepository(factory)

    result = await repo.list_bangumi(limit=50)

    assert len(result) == 1
    assert result[0]["id"] == "115908"
