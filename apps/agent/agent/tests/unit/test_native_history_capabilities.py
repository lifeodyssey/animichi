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
from pydantic_ai_harness.compaction import ClearToolResults, SlidingWindow

from agent.agents.animichi_agent import (
    _HISTORY_KEEP_TOKENS,
    _HISTORY_MAX_TOKENS,
    _TOOL_RESULT_MIN_CLEAR_TOKENS,
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
    clear, window = capabilities
    assert isinstance(clear, ClearToolResults)
    assert clear.max_tokens == _HISTORY_MAX_TOKENS == 5_500
    assert clear.keep_pairs == 2
    assert clear.min_clear_tokens == _TOOL_RESULT_MIN_CLEAR_TOKENS == 50
    assert isinstance(window, SlidingWindow)
    assert window.max_tokens == _HISTORY_MAX_TOKENS
    assert window.keep_tokens == _HISTORY_KEEP_TOKENS == 1_100
    assert window.preserve_first_user_message is False


def test_legacy_history_keeps_hand_rolled_processors() -> None:
    capabilities = _history_capabilities(modern=False)
    assert len(capabilities) == 2
    assert all(isinstance(item, ProcessHistory) for item in capabilities)


async def test_modern_clear_compacts_only_old_tool_pairs() -> None:
    clear = cast(ClearToolResults[RuntimeDeps], _history_capabilities(modern=True)[0])
    messages = [*_pair(1, "x" * 400), *_pair(2, "y" * 400), *_pair(3, "z" * 400)]
    compacted = await clear.compact(messages, _ctx())
    old_return = cast(ModelRequest, compacted[1]).parts[0]
    recent_return = cast(ModelRequest, compacted[-1]).parts[0]
    assert isinstance(old_return, ToolReturnPart)
    assert old_return.content == "[tool result compacted; rerun if needed]"
    assert isinstance(recent_return, ToolReturnPart)
    assert recent_return.content == "z" * 400


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
