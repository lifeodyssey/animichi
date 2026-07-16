"""RuntimeAPI response-translation gate tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_deps import StepEvent
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


def _search_result(*, locale: str, message: str) -> AgentResult:
    return _make_result(
        intent="search_bangumi",
        locale=locale,
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
            }
        },
        message=message,
    )


async def test_translation_gate_emits_sse_on_locale_mismatch(
    mock_db: MagicMock,
) -> None:
    result = _search_result(locale="zh", message="3件の聖地が見つかりました。")
    emitted: list[tuple[str, str]] = []

    async def capture_step(event: StepEvent) -> None:
        if event.tool == "translate":
            emitted.append((event.tool, event.status))

    with (
        patch(
            "agent.interfaces.public_api.run_animichi_agent",
            new=AsyncMock(return_value=result),
        ),
        patch(
            "agent.interfaces.public_api.translate_text",
            new=AsyncMock(return_value="找到了3处圣地。"),
        ),
    ):
        response = await RuntimeAPI(mock_db, model_http_client=MagicMock()).handle(
            PublicAPIRequest(text="查找圣地", locale="zh"), on_step=capture_step
        )

    assert emitted == [("translate", "running"), ("translate", "done")]
    assert response.message == "找到了3处圣地。"


async def test_translation_gate_skips_when_locale_matches(
    mock_db: MagicMock,
) -> None:
    result = _search_result(locale="ja", message="3件の聖地が見つかりました。")
    emitted: list[tuple[str, str]] = []

    async def capture_step(event: StepEvent) -> None:
        if event.tool == "translate":
            emitted.append((event.tool, event.status))

    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(return_value=result),
    ):
        await RuntimeAPI(mock_db, model_http_client=MagicMock()).handle(
            PublicAPIRequest(text="聖地を検索", locale="ja"), on_step=capture_step
        )

    assert emitted == []


async def test_translation_gate_shares_parent_model_and_usage(
    mock_db: MagicMock,
) -> None:
    result = _search_result(locale="zh", message="3件の聖地が見つかりました。")
    model = TestModel()
    result.usage = RunUsage(requests=1)
    translate = AsyncMock(return_value="找到了3处圣地。")

    with (
        patch(
            "agent.interfaces.public_api.run_animichi_agent",
            new=AsyncMock(return_value=result),
        ),
        patch("agent.interfaces.public_api.translate_text", new=translate),
    ):
        await RuntimeAPI(mock_db, model_http_client=MagicMock()).handle(
            PublicAPIRequest(text="查找圣地", locale="zh"), model=model
        )

    ctx = translate.await_args.kwargs["ctx"]
    assert ctx.model is model
    assert ctx.usage is result.usage
