"""Phase 1d graceful-partial runner and projection contracts."""

from __future__ import annotations

from typing import cast, get_args
from unittest.mock import MagicMock

import pytest
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import UsageLimits

import animichi.agents.animichi_runner as runner
from animichi.agents.agent_result import StepRecord
from animichi.agents.animichi_agent import RuntimeOutput
from animichi.agents.runtime_models import PartialResponseModel, SearchResponseModel
from animichi.agents.session_state import (
    ItineraryPayloadState,
    ItineraryRef,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.interfaces.response_builder import _UI_MAP, agent_result_to_response
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.streaming_function_model import streaming_function_model


def _search_payload(point_id: str = "p1") -> SearchPayloadState:
    return SearchPayloadState(
        kind="bangumi",
        rows=[PointState(id=point_id, name="Bridge", bangumi_id="1")],
        row_count=1,
        anime_id="1",
    )


def _search_bangumi_model(bangumi_id: str) -> FunctionModel:
    """One real search_bangumi tool call, then stop. Paired with a
    request_limit=1 usage cap: pydantic_ai's own before-request check raises
    UsageLimitExceeded ahead of the run's SECOND request — after the tool
    already ran for real (real catalog fixture data, real ref generation)."""

    def _respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "search_bangumi", {"bangumi_id": bangumi_id}, tool_call_id="c1"
                )
            ]
        )

    return streaming_function_model(_respond)


def _plan_route_model(search_result_ref: str) -> FunctionModel:
    """One real plan_route tool call against an already-stored search ref,
    then stop. Paired with request_limit=1 the same way as above."""

    def _respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "plan_route",
                    {"search_result_ref": search_result_ref, "pacing": "normal"},
                    tool_call_id="c1",
                )
            ]
        )

    return streaming_function_model(_respond)


def _with_request_limit(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    """Shrink the production usage cap so ONE real tool call exhausts it —
    the real UsageLimitExceeded pydantic_ai raises before the next request,
    not a synthetic one raised by a replaced Agent.run."""
    monkeypatch.setattr(runner, "RUN_USAGE_LIMITS", UsageLimits(request_limit=limit))


def test_partial_model_round_trips_without_joining_model_output_union() -> None:
    partial = PartialResponseModel(message="Partial results are shown.")
    restored = PartialResponseModel.model_validate_json(partial.model_dump_json())
    assert restored == partial
    assert PartialResponseModel not in get_args(RuntimeOutput)


def test_partial_model_maps_to_stable_stage_and_ui() -> None:
    output = PartialResponseModel(message="Partial results are shown.")
    assert runner.runtime_stage(output, []) == "partial"
    assert _UI_MAP["partial"] == "GeneralAnswer"


@pytest.mark.parametrize(
    "step",
    [
        StepRecord(tool="search_bangumi", is_success=False),
        StepRecord(tool="plan_route", is_success=True),
    ],
)
def test_runtime_stage_search_requires_successful_matching_tool_step(
    step: StepRecord,
) -> None:
    output = SearchResponseModel(message="Search complete.")
    with pytest.raises(ValueError, match="No successful step"):
        runner.runtime_stage(output, [step])


async def test_usage_limit_returns_partial_with_current_turn_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _with_request_limit(monkeypatch, 1)
    result = await runner.run_animichi_agent(
        text="find it",
        db=MagicMock(),
        locale="zh",
        catalog=MockCatalogClient(),
        model=_search_bangumi_model("160209"),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )
    # The real request/tool-call count from the one tool call that actually
    # ran (was 12: an arbitrary fixture value the old Agent.run replacement
    # invented — real usage now comes from pydantic_ai's own accounting).
    assert result.usage is not None and result.usage.requests == 1
    assert (response.success, response.status) == (False, "partial")
    results = cast(dict[str, object], response.data["results"])
    rows = cast(list[dict[str, object]], results["rows"])
    assert rows[0]["id"] == "p001"
    assert rows[0]["bangumi_id"] == "160209"
    assert response.ui == {"component": "GeneralAnswer"}
    assert "部分" in response.message


async def test_usage_limit_never_projects_stale_registry_ref(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    state.store_search_result(ResultRef("search:old"), _search_payload("old"))
    _with_request_limit(monkeypatch, 1)
    result = await runner.run_animichi_agent(
        text="new turn",
        db=MagicMock(),
        locale="en",
        context={"session_state_v2": state.model_dump(mode="json")},
        catalog=MockCatalogClient(),
        model=_search_bangumi_model("160209"),
    )
    response = agent_result_to_response(result, include_debug=False)
    assert result.provenance.search is not None
    # The fresh, real, current-turn ref (not the pre-seeded stale literal)
    # is what session_state now points at.
    fresh_ref = result.provenance.search.result_ref
    assert fresh_ref != ResultRef("search:old")
    assert result.session_state.last_result_ref == fresh_ref
    results = cast(dict[str, object], response.data["results"])
    rows = cast(list[dict[str, object]], results["rows"])
    assert [row["id"] for row in rows] == ["p001", "p002", "p003"]


async def test_usage_limit_projects_current_route_over_stale_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = SessionState()
    # A search from an EARLIER turn, real fixture points — plan_route (like
    # production) only accepts point ids the catalog actually knows.
    state.store_search_result(
        ResultRef("search:seed"),
        SearchPayloadState(
            kind="bangumi",
            rows=[
                PointState(id="p001", bangumi_id="160209"),
                PointState(id="p002", bangumi_id="160209"),
            ],
            row_count=2,
            anime_id="160209",
        ),
    )
    state.store_itinerary(
        ItineraryRef("route:old"),
        ItineraryPayloadState(ordered_points=[PointState(id="old", bangumi_id="1")]),
    )
    _with_request_limit(monkeypatch, 1)
    result = await runner.run_animichi_agent(
        text="new turn",
        db=MagicMock(),
        locale="en",
        context={"session_state_v2": state.model_dump(mode="json")},
        catalog=MockCatalogClient(),
        model=_plan_route_model("search:seed"),
    )
    response = agent_result_to_response(result, include_debug=False)
    route = cast(dict[str, object], response.data["route"])
    points = cast(list[dict[str, object]], route["ordered_points"])
    assert [point["id"] for point in points] == ["p001", "p002"]
    assert route["status"] == "ok"
    assert route["point_count"] == 2
    # The route was built from THIS turn's plan_route call over the real
    # search ref, not the pre-seeded stale itinerary ("route:old"/"old").
    assert route["source_ref"] == "search:seed"
    wire = response.model_dump(mode="json")
    assert (wire["session_id"], wire["generated_title"], wire["debug"]) == (
        None,
        None,
        None,
    )


def test_partial_message_unknown_locale_defaults_to_japanese() -> None:
    assert runner._partial_message("fr") == runner._partial_message("ja")
