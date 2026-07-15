"""Modern official compaction behavior and legacy rollback selection."""

from __future__ import annotations

from typing import cast

from pydantic_ai import RunContext
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai_harness.compaction import SlidingWindow

from agent.agents.animichi_agent import (
    _HISTORY_KEEP_TOKENS,
    _HISTORY_MAX_TOKENS,
    COMPACT_THRESHOLD,
    _compact_tool_results,
    _history_capabilities,
)
from agent.agents.runtime_deps import RuntimeDeps


def _ctx() -> RunContext[RuntimeDeps]:
    return cast(RunContext[RuntimeDeps], object())


def _pair(index: int, content: str) -> list[ModelMessage]:
    call_id = f"call_{index}"
    return [
        ModelResponse(parts=[ToolCallPart("search_bangumi", {}, call_id)]),
        ModelRequest(parts=[ToolReturnPart("search_bangumi", content, call_id)]),
    ]


def test_modern_history_uses_derived_official_configuration() -> None:
    capabilities = _history_capabilities(modern=True)
    summarize, window = capabilities
    assert isinstance(summarize, ProcessHistory)
    assert summarize.processor is _compact_tool_results
    assert isinstance(window, SlidingWindow)
    assert window.max_tokens == _HISTORY_MAX_TOKENS == 5_500
    assert window.keep_tokens == _HISTORY_KEEP_TOKENS == 1_100
    assert window.preserve_first_user_message is False


def test_legacy_history_keeps_hand_rolled_processors() -> None:
    capabilities = _history_capabilities(modern=False)
    assert len(capabilities) == 2
    assert all(isinstance(item, ProcessHistory) for item in capabilities)


def test_modern_summarizes_old_tool_results_without_clearing_content() -> None:
    summarize = cast(ProcessHistory[RuntimeDeps], _history_capabilities(modern=True)[0])
    messages = [*_pair(1, "candidate details " * 30)]
    messages.extend(
        ModelRequest(parts=[UserPromptPart(f"follow-up {index}")])
        for index in range(COMPACT_THRESHOLD)
    )
    compacted = summarize.processor(messages)
    old_return = cast(ModelRequest, compacted[1]).parts[0]
    assert isinstance(old_return, ToolReturnPart)
    assert old_return.content == "[search_bangumi: completed]"


async def test_modern_window_uses_token_tail_without_orphaning_pairs() -> None:
    window = cast(SlidingWindow[RuntimeDeps], _history_capabilities(modern=True)[1])
    messages: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart("old")]),
        ModelResponse(parts=[TextPart("x" * 4_800)]),
        *_pair(1, "y" * 2_000),
        ModelRequest(parts=[UserPromptPart("recent")]),
        *_pair(2, "z" * 2_000),
    ]
    compacted = await window.compact(messages, _ctx())
    assert messages[0] not in compacted
    returned_ids = {
        part.tool_call_id
        for message in compacted
        for part in message.parts
        if isinstance(part, ToolReturnPart)
    }
    called_ids = {
        part.tool_call_id
        for message in compacted
        for part in message.parts
        if isinstance(part, ToolCallPart)
    }
    assert returned_ids <= called_ids
