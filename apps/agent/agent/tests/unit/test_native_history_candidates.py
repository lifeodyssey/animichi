"""Ordinal clarify-candidate preservation through production compaction."""

from __future__ import annotations

import json
from typing import cast

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai_harness.compaction import TieredCompaction, estimate_token_count

from agent.agents.animichi_agent import _summarize_tool_content
from agent.agents.history_compaction import (
    HISTORY_MAX_TOKENS,
    CompactToolReturns,
    _candidate_summary,
    native_history_compaction,
)


def _user_texts(messages: list[ModelMessage]) -> list[str]:
    return [
        part.content
        for message in messages
        for part in message.parts
        if isinstance(part, UserPromptPart) and isinstance(part.content, str)
    ]


def _summary_text(messages: list[ModelMessage]) -> str:
    return "\n".join(
        part.content
        for message in messages
        for part in message.parts
        if isinstance(part, SystemPromptPart)
        and part.content.startswith("Summary of previous conversation:")
    )


def _candidate_return() -> str:
    return json.dumps(
        {
            "ambiguous": True,
            "candidates": [
                {"bangumi_id": "485", "title": "涼宮ハルヒの憂鬱"},
                {"bangumi_id": "1177", "title": "涼宮ハルヒちゃんの憂鬱"},
            ],
            "padding": "x" * 400,
        },
        ensure_ascii=False,
    )


def test_candidate_summary_preserves_ordered_candidates_verbatim() -> None:
    candidates = [
        {"bangumi_id": "485", "title": "涼宮ハルヒの憂鬱"},
        {"bangumi_id": "1177", "title": "涼宮ハルヒちゃんの憂鬱"},
    ]
    payload = {"ambiguous": True, "candidates": candidates}

    assert _candidate_summary(payload) == (
        "[resolve_anime: ambiguous, ordered_candidates="
        f"{json.dumps(candidates, ensure_ascii=False, separators=(',', ':'))}]"
    )


def _long_history() -> list[ModelMessage]:
    call_id = "resolve_haruhi"
    history: list[ModelMessage] = [
        ModelRequest(parts=[UserPromptPart("凉宫有哪些作品？")]),
        ModelResponse(
            parts=[ToolCallPart("resolve_anime", {"title": "凉宫"}, call_id)]
        ),
        ModelRequest(
            parts=[ToolReturnPart("resolve_anime", _candidate_return(), call_id)]
        ),
        ModelResponse(parts=[TextPart("候选有两部，请选择第一部或第二部。")]),
    ]
    filler = "这轮只讨论交通、预算和开放时间，不改变之前候选作品的顺序。" * 36
    for index in range(12):
        history.extend(
            [
                ModelRequest(parts=[UserPromptPart(f"行程背景 {index}: {filler}")]),
                ModelResponse(parts=[TextPart(f"已记录第 {index} 轮背景。{filler}")]),
            ]
        )
    return history


async def test_candidates_survive_production_summary_for_ordinal_follow_up() -> None:
    summary_calls = 0
    second_turn_summaries: list[str] = []

    def respond(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal summary_calls
        if any(
            text.startswith("Summarize the older conversation")
            for text in _user_texts(messages)
        ):
            summary_calls += 1
            summary = "1. 涼宮ハルヒの憂鬱 (485); 2. 涼宮ハルヒちゃんの憂鬱 (1177)"
            return ModelResponse(parts=[TextPart(summary)])
        if _user_texts(messages)[-1] == "第一个":
            summary = _summary_text(messages)
            second_turn_summaries.append(summary)
            selected = "485" if "涼宮ハルヒの憂鬱 (485)" in summary else "missing"
            return ModelResponse(parts=[TextPart(f"selected {selected}")])
        return ModelResponse(parts=[TextPart("unexpected")])

    history = _long_history()
    assert estimate_token_count(history) > HISTORY_MAX_TOKENS
    tiered = cast(
        TieredCompaction[None],
        native_history_compaction(_summarize_tool_content),
    )
    compact = cast(CompactToolReturns[None], tiered.tiers[0])
    compacted = await compact.compact(history, cast(RunContext[None], None))
    assert estimate_token_count(compacted) > tiered.target_tokens
    agent = Agent(FunctionModel(respond), capabilities=[tiered])
    second = await agent.run("第一个", message_history=history)

    assert second.output == "selected 485"
    assert summary_calls == 1
    assert second_turn_summaries
    assert "1. 涼宮ハルヒの憂鬱 (485)" in second_turn_summaries[0]
    assert "2. 涼宮ハルヒちゃんの憂鬱 (1177)" in second_turn_summaries[0]
