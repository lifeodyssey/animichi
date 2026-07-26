"""Ordering and diagnostics at the tool-event trust boundary."""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from structlog import testing
from structlog.typing import EventDict

from agent.agents.agent_result import AgentResult, RejectedSearch
from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import SearchResponseModel
from agent.agents.tool_event_bridge import register_tool_provenance
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.streaming_function_model import streaming_function_model


def test_missing_string_call_id_logs_provenance_diagnostic() -> None:
    assert _capture_missing_id_log() == [
        {
            "event": "tool_provenance_missing_call_id",
            "tool": "search_bangumi",
            "call_id_type": "int",
            "log_level": "warning",
        }
    ]


def _capture_missing_id_log() -> list[EventDict]:
    deps = RuntimeDeps(MagicMock(), "en", "query", MockCatalogClient())
    ctx = MagicMock(deps=deps, tool_call_id=7, tool_name="search_bangumi")
    provenance = RejectedSearch(outcome="upstream_unavailable")
    with testing.capture_logs() as captured:
        register_tool_provenance(ctx, provenance)
    return captured


async def test_function_and_output_tool_same_response_has_provenance() -> None:
    requests: list[list[ModelMessage]] = []
    result = await _run_batched(requests)
    assert isinstance(result.output, SearchResponseModel)
    assert len(requests) == 1
    assert [step.tool for step in result.steps] == ["search_bangumi"]


async def _run_batched(requests: list[list[ModelMessage]]) -> AgentResult:
    model = _batched_model(requests)
    return await run_animichi_agent(
        text="Find Your Name pilgrimage spots",
        db=MagicMock(),
        locale="en",
        catalog=MockCatalogClient(),
        model=model,
    )


def _batched_model(requests: list[list[ModelMessage]]) -> FunctionModel:
    responses = iter([_batched_search_response(), _unexpected_retry_response()])

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        requests.append(messages)
        return next(responses)

    return streaming_function_model(respond)


def _batched_search_response() -> ModelResponse:
    search = ToolCallPart(
        "search_bangumi", {"bangumi_id": "160209"}, tool_call_id="search-id"
    )
    output = ToolCallPart(
        "search_response", {"message": "Found."}, tool_call_id="output-id"
    )
    return ModelResponse(parts=[search, output])


def _unexpected_retry_response() -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart("qa_response", {"message": "retry"})])
