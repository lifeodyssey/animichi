"""Unit tests for core pipeline execution via RuntimeAPI."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agent.agents.agent_result import AgentResult, StepRecord
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
)
from agent.tests.db_doubles import build_persistence_supabase_double
from agent.tests.unit.conftest_public_api import (
    install_mock_pipeline,
)
from agent.tests.unit.conftest_public_api import (
    make_result as _make_result,
)


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db():
    db = build_persistence_supabase_double()
    db.points.search_points_by_location = AsyncMock(return_value=[])
    return db


class TestRuntimeAPIExecution:
    async def test_handle_maps_pipeline_result(self, mock_db):
        api = RuntimeAPI(mock_db)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is True
        assert response.intent == "search_bangumi"
        assert response.status == "ok"
        assert "results" in response.data
        assert response.errors == []

    async def test_handle_can_include_debug(self, mock_db):
        result = _make_result(
            intent="plan_route",
            data={
                "route": {
                    "ordered_points": [
                        {
                            "id": "1",
                            "name": "A",
                            "latitude": 34.88,
                            "longitude": 135.80,
                        },
                        {
                            "id": "2",
                            "name": "B",
                            "latitude": 34.89,
                            "longitude": 135.81,
                        },
                    ],
                    "point_count": 2,
                },
            },
            message="ルートを作成しました。",
            steps=[
                StepRecord(
                    tool="resolve_anime",
                    success=True,
                    params={"bangumi": "115908", "title": "吹响"},
                ),
                StepRecord(
                    tool="search_bangumi",
                    success=True,
                    params={"bangumi": "115908"},
                ),
                StepRecord(
                    tool="plan_route",
                    success=True,
                    params={"origin": "京都駅"},
                ),
            ],
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ):
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        with patch(
            "agent.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db)
            response = await api.handle(
                PublicAPIRequest(text="从京都站出发去吹响的圣地", include_debug=True)
            )

        assert response.debug is not None
        assert len(response.debug["steps"]) == 3
        assert response.route_history[0]["route_id"] == "route-1"
        mock_db.routes.save_route.assert_awaited_once()

    async def test_handle_preserves_coordinate_origin_in_route_history(self, mock_db):
        result = _make_result(
            intent="plan_route",
            data={
                "route": {
                    "ordered_points": [
                        {
                            "id": "1",
                            "name": "A",
                            "latitude": 34.88,
                            "longitude": 135.80,
                        },
                        {
                            "id": "2",
                            "name": "B",
                            "latitude": 34.89,
                            "longitude": 135.81,
                        },
                    ],
                    "point_count": 2,
                },
            },
            message="ルートを作成しました。",
            steps=[
                StepRecord(
                    tool="plan_route",
                    success=True,
                    params={"bangumi": "115908"},
                ),
            ],
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ):
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        with patch(
            "agent.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db)
            response = await api.handle(
                PublicAPIRequest(
                    text="从当前位置出发去吹响的圣地",
                    origin_lat=34.9,
                    origin_lng=135.8,
                )
            )

        assert response.route_history[0]["origin_station"] == "34.9,135.8"
        save_route_kwargs = mock_db.routes.save_route.await_args.kwargs
        assert save_route_kwargs["origin_station"] == "34.9,135.8"
        assert save_route_kwargs["origin_lat"] == 34.9
        assert save_route_kwargs["origin_lon"] == 135.8

    async def test_request_log_called_after_response(self, monkeypatch):
        """insert_request_log is called once after a successful pipeline run."""
        result = _make_result(
            data={
                "results": {"rows": [], "row_count": 0},
            },
            message="3件の聖地が見つかりました。",
        )

        async def fake_run_agent(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        monkeypatch.setattr(
            "agent.interfaces.public_api.run_pilgrimage_agent", fake_run_agent
        )

        db = MagicMock()
        db.upsert_session = AsyncMock()
        db.insert_request_log = AsyncMock(return_value="log-1")
        api = RuntimeAPI(db=db)

        await api.handle(
            PublicAPIRequest(text="吹響の聖地", locale="ja", session_id="s1")
        )

        db.insert_request_log.assert_awaited_once()
        kwargs = db.insert_request_log.call_args.kwargs
        assert kwargs["query_text"] == "吹響の聖地"
        assert kwargs["locale"] == "ja"
        assert kwargs["intent"] == "search_bangumi"


class TestSelectedPointIdsBypass:
    async def test_selected_point_ids_bypass_planner(self, mock_db) -> None:
        from agent.agents.agent_result import AgentResult, StepRecord
        from agent.agents.runtime_models import (
            RouteDataModel,
            RouteModel,
            RouteResponseModel,
        )

        captured: dict[str, object] = {}

        async def _fake_selected_route(
            *, point_ids, origin, locale, catalog, on_step=None
        ):
            captured["point_ids"] = point_ids
            captured["origin"] = origin
            captured["catalog"] = catalog
            route_data = {
                "ordered_points": [
                    {"id": "p1", "name": "A", "latitude": 34.88, "longitude": 135.80},
                    {"id": "p2", "name": "B", "latitude": 34.89, "longitude": 135.81},
                ],
                "point_count": 2,
            }
            output = RouteResponseModel(
                intent="plan_selected",
                message="已为2处选定取景地规划路线。",
                data=RouteDataModel(
                    route=RouteModel.model_validate(route_data),
                ),
            )
            return AgentResult(
                output=output,
                steps=[StepRecord(tool="plan_selected", success=True, data=route_data)],
                tool_state={"plan_selected": route_data},
            )

        with (
            patch(
                "agent.interfaces.public_api.run_pilgrimage_agent",
                new=AsyncMock(side_effect=AssertionError("planner should be bypassed")),
            ),
            patch(
                "agent.interfaces.public_api.execute_selected_route",
                new=AsyncMock(side_effect=_fake_selected_route),
            ),
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            response = await api.handle(
                PublicAPIRequest(
                    text="",
                    selected_point_ids=["p1", "p2"],
                    origin="宇治駅",
                    locale="zh",
                )
            )

        assert captured["point_ids"] == ["p1", "p2"]
        assert captured["origin"] == "宇治駅"
        assert captured["catalog"] is api._catalog
        assert response.intent == "plan_selected"
        assert response.ui == {"component": "RoutePlannerWizard"}


class TestTranslationGate:
    async def test_translation_gate_emits_sse_on_locale_mismatch(self, mock_db) -> None:
        """When response message language != locale, SSE translate events fire."""
        result = _make_result(
            intent="search_bangumi",
            locale="zh",
            data={
                "results": {
                    "rows": [
                        {
                            "id": "1",
                            "name": "spot",
                            "latitude": 34.88,
                            "longitude": 135.80,
                        }
                    ],
                    "row_count": 1,
                },
            },
            message="3件の聖地が見つかりました。",
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            return result

        emitted: list[tuple[str, str]] = []

        async def _capture_step(
            tool: str,
            status: str,
            data: dict[str, object],
            thought: str,
            observation: str,
        ) -> None:
            if tool == "translate":
                emitted.append((tool, status))

        with (
            patch(
                "agent.interfaces.public_api.run_pilgrimage_agent",
                side_effect=_fake,
            ),
            patch(
                "agent.interfaces.public_api.translate_text",
                new_callable=AsyncMock,
                return_value="找到了3处圣地。",
            ),
        ):
            api = RuntimeAPI(mock_db)
            response = await api.handle(
                PublicAPIRequest(text="查找圣地", locale="zh"),
                on_step=_capture_step,
            )

        assert ("translate", "running") in emitted
        assert ("translate", "done") in emitted
        assert response.message == "找到了3处圣地。"

    async def test_translation_gate_skips_when_locale_matches(self, mock_db) -> None:
        """No SSE translate events when response language matches locale."""
        result = _make_result(
            intent="search_bangumi",
            locale="ja",
            data={
                "results": {
                    "rows": [
                        {
                            "id": "1",
                            "name": "spot",
                            "latitude": 34.88,
                            "longitude": 135.80,
                        }
                    ],
                    "row_count": 1,
                },
            },
            message="3件の聖地が見つかりました。",
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
            catalog: object | None = None,
        ) -> AgentResult:
            return result

        emitted: list[tuple[str, str]] = []

        async def _capture_step(
            tool: str,
            status: str,
            data: dict[str, object],
            thought: str,
            observation: str,
        ) -> None:
            if tool == "translate":
                emitted.append((tool, status))

        with patch(
            "agent.interfaces.public_api.run_pilgrimage_agent",
            side_effect=_fake,
        ):
            api = RuntimeAPI(mock_db)
            await api.handle(
                PublicAPIRequest(text="聖地を検索", locale="ja"),
                on_step=_capture_step,
            )

        assert emitted == []
