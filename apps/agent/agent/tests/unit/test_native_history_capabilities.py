"""Native tiered history compaction behavior."""

from __future__ import annotations

from typing import cast

import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import UsageLimits
from pydantic_ai_harness.compaction import (
    SlidingWindow,
    SummarizingCompaction,
    TieredCompaction,
)

from agent.agents.animichi_agent import _history_capabilities, _summarize_tool_content
from agent.agents.history_compaction import (
    HISTORY_KEEP_TOKENS,
    HISTORY_MAX_TOKENS,
    SUMMARY_KEEP_TOKENS,
    SUMMARY_PROMPT,
    CompactToolReturns,
    native_history_compaction,
)
from agent.agents.runtime_deps import RuntimeDeps


def _pair(index: int, content: str) -> list[ModelMessage]:
    call_id = f"call_{index}"
    return [
        ModelResponse(parts=[ToolCallPart("lookup", {}, call_id)]),
        ModelRequest(parts=[ToolReturnPart("lookup", content, call_id)]),
    ]


def _user_texts(messages: list[ModelMessage]) -> list[str]:
    return [
        part.content
        for message in messages
        for part in message.parts
        if isinstance(part, UserPromptPart) and isinstance(part.content, str)
    ]


def test_history_uses_one_tiered_capability() -> None:
    capabilities = _history_capabilities()
    assert len(capabilities) == 1
    tiered = cast(TieredCompaction[RuntimeDeps], capabilities[0])
    assert isinstance(tiered, TieredCompaction)
    compact, summary, window = tiered.tiers
    assert isinstance(compact, CompactToolReturns)
    assert isinstance(summary, SummarizingCompaction)
    assert isinstance(window, SlidingWindow)
    assert tiered.target_tokens == HISTORY_MAX_TOKENS == 5_500
    assert window.max_tokens == HISTORY_MAX_TOKENS
    assert window.keep_tokens == HISTORY_KEEP_TOKENS == 1_100
    assert summary.keep_tokens == SUMMARY_KEEP_TOKENS == 900
    assert summary.model is None
    assert summary.summary_prompt == SUMMARY_PROMPT
    assert "ordered candidate lists" in SUMMARY_PROMPT
    assert '"第一个"' in SUMMARY_PROMPT


async def test_tier_one_prevents_unneeded_summary_call() -> None:
    summary_calls = 0

    def summarize(_messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal summary_calls
        summary_calls += 1
        return ModelResponse(parts=[TextPart("unexpected")])

    tiered: TieredCompaction[None] = TieredCompaction(
        tiers=[
            CompactToolReturns[None](
                lambda _name, _content: "[lookup: completed]", keep_recent=0
            ),
            SummarizingCompaction(
                model=FunctionModel(summarize), max_tokens=30, keep_tokens=10
            ),
            SlidingWindow(max_tokens=30, keep_tokens=10),
        ],
        target_tokens=30,
    )
    agent = Agent(
        FunctionModel(lambda _messages, _info: ModelResponse(parts=[TextPart("ok")])),
        capabilities=[tiered],
    )
    result = await agent.run("next", message_history=_pair(1, "x" * 1_000))

    assert result.output == "ok"
    assert summary_calls == 0


async def test_short_history_never_invokes_inherited_summary_model() -> None:
    requests = 0

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal requests
        requests += 1
        assert not any(
            text.startswith("Summarize the older conversation")
            for text in _user_texts(messages)
        )
        return ModelResponse(parts=[TextPart("ok")])

    history: list[ModelMessage] = []
    for index in range(3):
        history.extend(
            [
                ModelRequest(parts=[UserPromptPart(f"q{index}")]),
                ModelResponse(parts=[TextPart("a")]),
            ]
        )
    agent = Agent(
        FunctionModel(respond),
        capabilities=[native_history_compaction(_summarize_tool_content)],
    )
    result = await agent.run("第一个", message_history=history)

    assert result.output == "ok"
    assert requests == 1


async def test_summary_request_counts_against_outer_usage_limit() -> None:
    summary_model = FunctionModel(
        lambda _messages, _info: ModelResponse(parts=[TextPart("summary")])
    )
    tiered: TieredCompaction[None] = TieredCompaction(
        tiers=[SummarizingCompaction(model=summary_model, max_tokens=1, keep_tokens=1)],
        target_tokens=1,
    )
    main_model = FunctionModel(
        lambda _messages, _info: ModelResponse(parts=[TextPart("main")])
    )
    agent = Agent(main_model, capabilities=[tiered])

    with pytest.raises(UsageLimitExceeded, match="request_limit of 1"):
        await agent.run(
            "new",
            message_history=_pair(1, "x" * 100),
            usage_limits=UsageLimits(request_limit=1),
        )
