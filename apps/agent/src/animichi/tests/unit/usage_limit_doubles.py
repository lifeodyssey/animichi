"""Doubles and wire-shape envelopes for the usage-limit projection suite.

Named for what they build (naming-ownership rule): FunctionModels that drive
one real tool call, the request-limit shrinker, and lax pydantic envelopes
that validate the partial response's wire payload without dict casts.
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ConfigDict
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import UsageLimits

import animichi.agents.animichi_runner as runner
from animichi.agents.session_state import PointState, SearchPayloadState
from animichi.tests.streaming_function_model import streaming_function_model

_LAX = ConfigDict(extra="allow")


def search_payload(point_id: str = "p1") -> SearchPayloadState:
    return SearchPayloadState(
        kind="bangumi",
        rows=[PointState(id=point_id, name="Bridge", bangumi_id="1")],
        row_count=1,
        anime_id="1",
    )


class Row(BaseModel):
    model_config = _LAX
    id: str
    bangumi_id: str


class Results(BaseModel):
    model_config = _LAX
    rows: list[Row]


class ResultsEnvelope(BaseModel):
    model_config = _LAX
    results: Results


class Point(BaseModel):
    model_config = _LAX
    id: str


class Route(BaseModel):
    model_config = _LAX
    ordered_points: list[Point]
    status: str
    point_count: int
    source_ref: str


class RouteEnvelope(BaseModel):
    model_config = _LAX
    route: Route


def search_bangumi_model(bangumi_id: str) -> FunctionModel:
    """One real search_bangumi tool call, then stop. Paired with a
    request_limit=1 usage cap: pydantic_ai's own before-request check raises
    UsageLimitExceeded ahead of the run's SECOND request — after the tool
    already ran for real (real catalog fixture data, real ref generation)."""

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "search_bangumi", {"bangumi_id": bangumi_id}, tool_call_id="c1"
                )
            ]
        )

    return streaming_function_model(respond)


def plan_route_model(search_result_ref: str) -> FunctionModel:
    """One real plan_route tool call against an already-stored search ref,
    then stop. Paired with request_limit=1 the same way as above."""

    def respond(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "plan_route",
                    {"search_result_ref": search_result_ref, "pacing": "normal"},
                    tool_call_id="c1",
                )
            ]
        )

    return streaming_function_model(respond)


def with_request_limit(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    """Shrink the production usage cap so ONE real tool call exhausts it —
    the real UsageLimitExceeded pydantic_ai raises before the next request,
    not a synthetic one raised by a replaced Agent.run."""
    monkeypatch.setattr(runner, "RUN_USAGE_LIMITS", UsageLimits(request_limit=limit))
