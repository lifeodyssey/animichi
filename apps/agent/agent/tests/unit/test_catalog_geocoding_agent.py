"""PR-A catalog geocoding acceptance tests (§3.5 / A5-A8')."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic_ai import UnexpectedModelBehavior
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents import catalog_tools
from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.clients.catalog_client import PilgrimagePoint
from agent.domain.ports import DatabasePort
from agent.tests.eval.mock_catalog_client import MockCatalogClient

SEARCH_OUTPUT = {
    "intent": "search_nearby",
    "message": "Nearby results",
    "data": {"results": {"rows": [], "row_count": 0, "status": "empty"}},
    "ui": {},
}
CLARIFY_OUTPUT = {
    "intent": "clarify",
    "message": "Which place?",
    "data": {
        "status": "needs_clarification",
        "question": "Which place?",
        "options": ["府中市(東京都)", "府中市(広島県)"],
        "candidates": [],
    },
    "ui": {},
}
ROUTE_OUTPUT = {
    "intent": "plan_route",
    "message": "Route ready",
    "data": {
        "route": {
            "ordered_points": [],
            "point_count": 0,
            "status": "ok",
            "timed_itinerary": {},
        }
    },
    "ui": {},
}


class EmptyNearbyCatalog(MockCatalogClient):
    """Catalog fixture whose geo query executes successfully with zero rows."""

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[PilgrimagePoint]:
        self.calls.append(("nearby", (lat, lng, radius_m)))
        return []


def _db() -> DatabasePort:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(return_value=[])
    return cast(DatabasePort, db)


def _parts(messages: list[ModelMessage]) -> list[object]:
    return [part for message in messages for part in getattr(message, "parts", [])]


def _tool_returned(messages: list[ModelMessage], name: str) -> bool:
    return any(getattr(part, "tool_name", None) == name for part in _parts(messages))


def _retry_count(messages: list[ModelMessage]) -> int:
    return sum(isinstance(part, RetryPromptPart) for part in _parts(messages))


def _nearby_model(
    location: str, *, force_invalid_search: bool = False
) -> FunctionModel:
    options = ["府中市(東京都)", "府中市(広島県)"] if location == "府中" else []
    clarify_output = {
        **CLARIFY_OUTPUT,
        "data": {**CLARIFY_OUTPUT["data"], "options": options},
    }

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if _tool_returned(messages, "clarify"):
            return ModelResponse(
                parts=[ToolCallPart("clarify_response", clarify_output)]
            )
        retries = _retry_count(messages)
        if retries and force_invalid_search:
            return ModelResponse(parts=[ToolCallPart("search_response", SEARCH_OUTPUT)])
        if retries:
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "clarify", {"question": "Which place?", "options": options}
                    )
                ]
            )
        if _tool_returned(messages, "search_nearby"):
            return ModelResponse(parts=[ToolCallPart("search_response", SEARCH_OUTPUT)])
        return ModelResponse(
            parts=[ToolCallPart("search_nearby", {"location": location})]
        )

    return FunctionModel(respond)


def _route_model() -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        if _tool_returned(messages, "plan_route"):
            return ModelResponse(parts=[ToolCallPart("route_response", ROUTE_OUTPUT)])
        return ModelResponse(parts=[ToolCallPart("plan_route", {})])

    return FunctionModel(respond)


async def _run(
    location: str,
    catalog: MockCatalogClient,
    *,
    context: dict[str, object] | None = None,
    force_invalid_search: bool = False,
) -> AgentResult:
    return await run_animichi_agent(
        text="nearby",
        db=_db(),
        locale="en",
        catalog=catalog,
        model=_nearby_model(location, force_invalid_search=force_invalid_search),
        context=context,
    )


async def test_a5_nishinomiya_geocode_then_nearby_returns_rows() -> None:
    catalog = MockCatalogClient()
    result = await _run("西宮", catalog)
    assert result.intent == "search_nearby"
    assert result.tool_state["search_nearby"]["row_count"] > 0
    assert [step.tool for step in result.steps] == ["search_nearby"]


async def test_stale_nearby_state_cannot_validate_ambiguous_search_output() -> None:
    context = {"last_search_data": {"search_nearby": {"stale": 1}}}
    with pytest.raises(UnexpectedModelBehavior, match="maximum output retries"):
        await _run(
            "府中",
            MockCatalogClient(),
            context=context,
            force_invalid_search=True,
        )


async def test_missing_location_cannot_validate_fabricated_search_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded_steps: list[StepRecord] = []
    original = catalog_tools._record_step

    def capture_step(
        deps: RuntimeDeps,
        *,
        tool: str,
        success: bool,
        params: dict[str, object],
        data: dict[str, object] | None,
        error: str | None,
    ) -> None:
        original(
            deps, tool=tool, success=success, params=params, data=data, error=error
        )
        recorded_steps[:] = deps.steps

    monkeypatch.setattr(catalog_tools, "_record_step", capture_step)
    with pytest.raises(UnexpectedModelBehavior, match="maximum output retries"):
        await _run("", MockCatalogClient(), force_invalid_search=True)

    assert recorded_steps
    assert recorded_steps[0].tool == "geocode"
    assert recorded_steps[0].success is True


async def test_successful_nearby_replaces_preseeded_state_with_new_payload() -> None:
    context = {"last_search_data": {"search_nearby": {"stale": 1}}}
    result = await _run("西宮", MockCatalogClient(), context=context)
    payload = result.tool_state["search_nearby"]
    assert "stale" not in payload
    assert payload["rows"][0]["id"] == "p_haruhi_1"


async def test_plan_route_uses_preseeded_nearby_without_new_search() -> None:
    catalog = MockCatalogClient()
    context = {
        "last_search_data": {
            "search_nearby": {"rows": [{"id": "p_haruhi_1"}], "row_count": 1}
        }
    }
    result = await run_animichi_agent(
        text="plan route",
        db=_db(),
        locale="en",
        catalog=catalog,
        model=_route_model(),
        context=context,
    )
    assert result.intent == "plan_route"
    assert [name for name, _ in catalog.calls] == ["route"]
    assert result.tool_state["plan_route"]["point_count"] == 1
