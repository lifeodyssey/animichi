"""Regression tests for Pydantic-native nativization batch N1a."""

from __future__ import annotations

import asyncio
import sys
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai import Agent, Tool
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
)
from pydantic_ai.models.function import AgentInfo

from agent.agents.animichi_runner import (
    REQUEST_LIMIT,
    TOOL_CALLS_LIMIT,
    run_animichi_agent,
)
from agent.agents.animichi_tools import CATALOG_TOOL_TIMEOUT_SECONDS, TOOLS
from agent.agents.runtime_models import PartialResponseModel
from agent.config.settings import Settings
from agent.domain.ports import DatabasePort
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI
from agent.interfaces.routes._deps import _SCRUB_PATTERNS, setup_logfire
from agent.tests.eval.mock_catalog_client import MockCatalogClient
from agent.tests.streaming_function_model import streaming_function_model
from agent.tests.unit.conftest_public_api import install_mock_pipeline


def _db() -> DatabasePort:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(return_value=[])
    return cast(DatabasePort, db)


async def test_runner_stops_identical_looping_early_via_repeat_guard() -> None:
    requests = 0

    def loop(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal requests
        requests += 1
        return ModelResponse(parts=[ToolCallPart("resolve_anime", {"title": "x"})])

    result = await run_animichi_agent(
        text="hello",
        db=_db(),
        locale="en",
        catalog=MockCatalogClient(),
        model=streaming_function_model(loop),
    )

    # One execution plus three deflected repeats exhausts the retry budget —
    # four model requests, far below the request cap, ending as honest partial.
    assert requests == 4
    assert requests < REQUEST_LIMIT
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )


async def test_runner_stops_varied_looping_at_usage_limit() -> None:
    requests = 0

    def loop(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal requests
        requests += 1
        # search_bangumi is not an identity tool, so the disambiguation backstop
        # never fires; varied args dodge the identical guard — this exercises
        # the raw usage cap on a genuine breadth loop.
        return ModelResponse(
            parts=[ToolCallPart("search_bangumi", {"bangumi_id": str(requests)})]
        )

    result = await run_animichi_agent(
        text="hello",
        db=_db(),
        locale="en",
        catalog=MockCatalogClient(),
        model=streaming_function_model(loop),
    )

    assert requests == REQUEST_LIMIT
    assert requests < TOOL_CALLS_LIMIT
    assert isinstance(result.output, PartialResponseModel)
    assert (result.intent, result.success, result.status) == (
        "partial",
        False,
        "partial",
    )


async def test_native_run_failures_map_to_existing_error_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_mock_pipeline(monkeypatch)
    with patch(
        "agent.interfaces.public_api.run_animichi_agent",
        new=AsyncMock(side_effect=RuntimeError("native run failure")),
    ):
        response = await RuntimeAPI(MagicMock(), model_http_client=MagicMock()).handle(
            PublicAPIRequest(text="秒速5厘米的取景地在哪")
        )

    assert (response.success, response.status, response.intent) == (
        False,
        "error",
        "unknown",
    )
    assert response.errors[0].code == "internal_error"


async def test_tool_timeout_returns_typed_retry_prompt() -> None:
    async def slow_tool() -> str:
        await asyncio.sleep(1)
        return "late"

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if any(
            isinstance(part, RetryPromptPart)
            for message in messages
            for part in message.parts
        ):
            return ModelResponse(parts=[TextPart("timed out")])
        return ModelResponse(parts=[ToolCallPart("slow_tool", {})])

    agent = Agent(
        streaming_function_model(respond),
        tools=[Tool(slow_tool, timeout=0.01)],
        output_type=str,
    )
    result = await agent.run("run the slow tool")
    retry = next(
        part
        for message in result.all_messages()
        for part in message.parts
        if isinstance(part, RetryPromptPart)
    )

    assert retry.content == "Timed out after 0.01 seconds."
    assert result.output == "timed out"


def test_catalog_tools_have_outer_timeout() -> None:
    catalog_tools = [tool for tool in TOOLS if isinstance(tool, Tool)]

    assert [tool.name for tool in catalog_tools] == [
        "resolve_anime",
        "search_bangumi",
        "search_nearby",
        "plan_route",
    ]
    assert {tool.timeout for tool in catalog_tools} == {CATALOG_TOOL_TIMEOUT_SECONDS}


def test_setup_logfire_configures_pii_scrubbing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    logfire_mock = MagicMock()
    monkeypatch.setitem(sys.modules, "logfire", logfire_mock)

    setup_logfire(Settings())

    options = logfire_mock.ScrubbingOptions.call_args.kwargs
    assert options["extra_patterns"] == _SCRUB_PATTERNS
    assert callable(options["callback"])
    assert logfire_mock.configure.call_args.kwargs["scrubbing"] is (
        logfire_mock.ScrubbingOptions.return_value
    )
