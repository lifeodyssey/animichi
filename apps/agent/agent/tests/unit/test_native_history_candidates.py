"""Ordinal clarify-candidate preservation through tier-three compaction."""

from __future__ import annotations

import json

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai_harness.compaction import (
    SlidingWindow,
    SummarizingCompaction,
    TieredCompaction,
)

from agent.agents.animichi_agent import _summarize_tool_content
from agent.agents.history_compaction import (
    HISTORY_KEEP_TOKENS,
    HISTORY_MAX_TOKENS,
    SUMMARY_PROMPT,
    CompactToolReturns,
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


def resolve_anime(title: str) -> str:
    assert title == "凉宫"
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


async def test_candidates_survive_tier_three_for_ordinal_follow_up() -> None:
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
            second_turn_summaries.append(_summary_text(messages))
            return ModelResponse(parts=[TextPart("selected 485")])
        returned = any(
            isinstance(part, ToolReturnPart) and part.tool_name == "resolve_anime"
            for message in messages
            for part in message.parts
        )
        if returned:
            return ModelResponse(parts=[TextPart("请选择")])
        return ModelResponse(parts=[ToolCallPart("resolve_anime", {"title": "凉宫"})])

    tiered: TieredCompaction[None] = TieredCompaction(
        tiers=[
            CompactToolReturns[None](_summarize_tool_content, keep_recent=0),
            SlidingWindow(
                max_tokens=HISTORY_MAX_TOKENS,
                keep_tokens=HISTORY_KEEP_TOKENS,
                preserve_first_user_message=False,
            ),
            SummarizingCompaction(
                model=None,
                max_tokens=10,
                keep_tokens=20,
                summary_prompt=SUMMARY_PROMPT,
            ),
        ],
        target_tokens=10,
    )
    agent = Agent(FunctionModel(respond), tools=[resolve_anime], capabilities=[tiered])
    first = await agent.run("凉宫")
    second = await agent.run("第一个", message_history=first.all_messages())

    assert second.output == "selected 485"
    assert summary_calls >= 1
    assert second_turn_summaries
    assert "1. 涼宮ハルヒの憂鬱 (485)" in second_turn_summaries[0]
    assert "2. 涼宮ハルヒちゃんの憂鬱 (1177)" in second_turn_summaries[0]
