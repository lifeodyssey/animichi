"""Unit tests for the SQLModel points read repository (#995).

Behavior-level assertions on the typed statements the repository builds — no
SQL strings are compared and nothing is executed (raw-SQL policy, #999).
"""

from __future__ import annotations

import pytest
from sqlalchemy.sql.selectable import Select

from animichi.infrastructure.persistence.models import points_table
from animichi.infrastructure.persistence.repositories.points import (
    SQLModelPointsRepository,
)
from animichi.tests.unit.repositories._session_fake import RecordingSessionFactory


def _only_statement(factory: RecordingSessionFactory) -> Select:
    assert len(factory.session.executed) == 1
    statement = factory.session.executed[0]
    assert isinstance(statement, Select)
    return statement


async def test_get_points_by_bangumi_returns_list() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(
        [{"id": "p1", "bangumi_id": "115908", "name": "Uji Bridge"}]
    )
    repo = SQLModelPointsRepository(factory)

    result = await repo.get_points_by_bangumi("115908")

    assert len(result) == 1
    assert result[0]["id"] == "p1"
    assert _only_statement(factory).get_final_froms()[0] is points_table


async def test_get_points_by_bangumi_returns_empty_list() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([])
    repo = SQLModelPointsRepository(factory)

    assert await repo.get_points_by_bangumi("nonexistent") == []


async def test_get_points_by_bangumi_propagates_a_database_error() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for(error=RuntimeError)
    repo = SQLModelPointsRepository(factory)

    with pytest.raises(RuntimeError):
        await repo.get_points_by_bangumi("115908")


async def test_get_points_by_ids_returns_ordered_dicts() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([{"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}])
    repo = SQLModelPointsRepository(factory)

    result = await repo.get_points_by_ids(["p1", "p2"])

    assert len(result) == 2
    assert result[0]["id"] == "p1"
    statement = _only_statement(factory)
    assert statement.get_final_froms()[0].right is points_table


async def test_get_points_by_ids_empty_input() -> None:
    factory = RecordingSessionFactory()
    repo = SQLModelPointsRepository(factory)

    assert await repo.get_points_by_ids([]) == []
    assert factory.session.executed == []


async def test_search_points_by_location_returns_rows() -> None:
    factory = RecordingSessionFactory()
    factory.session.result_for([{"id": "p1", "distance_m": 100.0}])
    repo = SQLModelPointsRepository(factory)

    result = await repo.search_points_by_location(34.88, 135.80, 5000)

    assert len(result) == 1
    statement = _only_statement(factory)
    assert isinstance(statement, Select)
    assert statement.get_final_froms()[0].left is points_table
