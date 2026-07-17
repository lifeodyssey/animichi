"""RuntimeAPI route-history and request-log persistence tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.agents.agent_result import AgentResult, StepRecord
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.tests.db_doubles import build_persistence_supabase_double
from agent.tests.unit.conftest_public_api import install_mock_pipeline
from agent.tests.unit.conftest_public_api import make_result as _make_result


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch: pytest.MonkeyPatch) -> None:
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db() -> MagicMock:
    db = build_persistence_supabase_double()
    db.points.search_points_by_location = AsyncMock(return_value=[])
    return db


def _route_result(*, with_debug_steps: bool) -> AgentResult:
    route = {
        "ordered_points": [
            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
        ],
        "point_count": 2,
    }
    steps = [StepRecord(tool="plan_route", success=True, params={"bangumi": "115908"})]
    if with_debug_steps:
        steps = [
            StepRecord(
                tool="resolve_anime", success=True, params={"bangumi": "115908"}
            ),
            StepRecord(
                tool="search_bangumi", success=True, params={"bangumi": "115908"}
            ),
            *steps,
        ]
    return _make_result(
        intent="plan_route",
        data={"route": route},
        message="ルートを作成しました。",
        steps=steps,
    )


async def test_handle_can_include_debug(mock_db: MagicMock) -> None:
    result = _route_result(with_debug_steps=True)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        response = await RuntimeAPI(mock_db, model_http_client=MagicMock()).handle(
            PublicAPIRequest(text="从京都站出发去吹响的圣地", include_debug=True)
        )

    assert response.debug is not None
    steps = response.debug["steps"]
    assert isinstance(steps, list)
    assert len(steps) == 3
    assert response.route_history[0]["route_id"] == "route-1"
    mock_db.routes.save_route.assert_awaited_once()


async def test_handle_preserves_coordinate_origin_in_route_history(
    mock_db: MagicMock,
) -> None:
    result = _route_result(with_debug_steps=False)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        response = await RuntimeAPI(mock_db, model_http_client=MagicMock()).handle(
            PublicAPIRequest(
                text="从当前位置出发去吹响的圣地",
                origin_lat=34.9,
                origin_lng=135.8,
            )
        )

    assert response.route_history[0]["origin_station"] == "34.9,135.8"
    saved = mock_db.routes.save_route.await_args.kwargs
    assert saved["origin_station"] == "34.9,135.8"
    assert saved["origin_lat"] == 34.9
    assert saved["origin_lon"] == 135.8


async def test_request_log_called_after_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = _make_result(
        data={"results": {"rows": [], "row_count": 0}},
        message="3件の聖地が見つかりました。",
    )

    async def fake_run_agent(**_kwargs: object) -> AgentResult:
        return result

    monkeypatch.setattr(
        "agent.interfaces.public_api.run_animichi_agent", fake_run_agent
    )
    db = MagicMock()
    db.upsert_session = AsyncMock()
    db.insert_request_log = AsyncMock(return_value="log-1")

    await RuntimeAPI(db=db, model_http_client=MagicMock()).handle(
        PublicAPIRequest(text="吹響の聖地", locale="ja", session_id="s1")
    )

    kwargs = db.insert_request_log.call_args.kwargs
    assert db.insert_request_log.await_count == 1
    assert (kwargs["query_text"], kwargs["locale"], kwargs["intent"]) == (
        "吹響の聖地",
        "ja",
        "search_bangumi",
    )
