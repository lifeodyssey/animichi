"""PR-A catalog geocoding acceptance tests (§3.5 / A5-A8')."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from agent.agents.agent_result import AgentResult
from agent.agents.pilgrimage_runner import run_pilgrimage_agent
from agent.clients.catalog_client import PilgrimagePoint
from agent.domain.ports import DatabasePort
from agent.interfaces.response_builder import agent_result_to_response
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
        if retries and force_invalid_search and retries == 1:
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


async def _run(
    location: str,
    catalog: MockCatalogClient,
    *,
    context: dict[str, object] | None = None,
    force_invalid_search: bool = False,
) -> AgentResult:
    return await run_pilgrimage_agent(
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


async def test_a5_prime_honest_empty_is_successful_search_response() -> None:
    result = await _run("西宮", EmptyNearbyCatalog())
    response = agent_result_to_response(result, include_debug=True)
    assert result.tool_state["search_nearby"]["row_count"] == 0
    assert result.steps[0].success is True
    assert response.success is True
    assert response.errors == []


async def test_a6_ambiguous_place_clarifies_without_pipeline_error() -> None:
    result = await _run("府中", MockCatalogClient())
    response = agent_result_to_response(result, include_debug=True)
    assert [step.tool for step in result.steps] == ["geocode", "clarify"]
    assert all(step.success for step in result.steps)
    assert result.output.data.options
    assert response.success is True
    assert response.errors == []


async def test_a6_prime_search_response_after_ambiguity_is_rejected() -> None:
    result = await _run("府中", MockCatalogClient(), force_invalid_search=True)
    assert result.intent == "clarify"
    assert "search_nearby" not in result.tool_state


async def test_a7_unknown_place_clarifies_without_gps_fallback() -> None:
    catalog = MockCatalogClient()
    result = await _run(
        "unknown place", catalog, context={"origin_lat": 34.7, "origin_lng": 135.3}
    )
    assert result.intent == "clarify"
    assert [name for name, _ in catalog.calls] == ["geocode"]
    assert result.steps[0].tool == "geocode"


async def test_a8_explicit_place_wins_over_gps() -> None:
    catalog = MockCatalogClient()
    await _run("西宮", catalog, context={"origin_lat": 0.0, "origin_lng": 0.0})
    assert catalog.calls[0] == ("geocode", ("西宮", 5))
    assert catalog.calls[1][0] == "nearby"
    assert catalog.calls[1][1][:2] == (34.7386, 135.3485)


async def test_a8_empty_location_uses_gps_without_geocoding() -> None:
    catalog = EmptyNearbyCatalog()
    await _run("", catalog, context={"origin_lat": 35.0, "origin_lng": 139.0})
    assert catalog.calls == [("nearby", (35.0, 139.0, 5000))]


async def test_a8_empty_location_without_gps_clarifies() -> None:
    result = await _run("", MockCatalogClient())
    assert result.intent == "clarify"
    assert [step.tool for step in result.steps] == ["clarify"]


async def test_a8_prime_prefecture_clarifies_without_nearby() -> None:
    catalog = MockCatalogClient()
    result = await _run("山梨県", catalog)
    assert [name for name, _ in catalog.calls if name in {"geocode", "nearby"}] == [
        "geocode"
    ]
    assert result.success is True
    assert result.steps[0].tool == "geocode"
