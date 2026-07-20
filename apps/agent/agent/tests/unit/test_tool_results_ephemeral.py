"""Unit tests for the named result models of the ephemeral/text tools.

Covers greet_user / general_qa / clarify / translate_anime_title — tools that
never touch ``tool_state``'s search/route contract but still need a named
return type instead of ``dict[str, object]``.
"""

from __future__ import annotations

from agent.agents.tool_results import (
    ClarifyCandidate,
    ClarifyToolResult,
    MessageToolResult,
    TranslateTitleResult,
)


def test_message_tool_result_defaults_status_info() -> None:
    result = MessageToolResult(message="hi")
    assert result.model_dump(mode="json") == {"message": "hi", "status": "info"}


def test_clarify_candidate_allows_none_cover_url() -> None:
    candidate = ClarifyCandidate(title="test")
    assert candidate.cover_url is None


def test_clarify_candidate_serializes_null_cover_url() -> None:
    candidate = ClarifyCandidate(title="test", cover_url=None)
    assert candidate.model_dump(mode="json")["cover_url"] is None


def test_clarify_tool_result_default_shape() -> None:
    result = ClarifyToolResult(question="which one?", options=["a", "b"])
    dumped = result.model_dump(mode="json")
    assert dumped["question"] == "which one?"
    assert dumped["options"] == ["a", "b"]
    assert dumped["status"] == "needs_clarification"
    assert dumped["action_required"] == "return clarify_response"


def test_clarify_tool_result_carries_candidates() -> None:
    result = ClarifyToolResult(
        question="q",
        candidates=[ClarifyCandidate(title="A"), ClarifyCandidate(title="B")],
    )
    assert [c.title for c in result.candidates] == ["A", "B"]


def test_translate_title_result_shape() -> None:
    result = TranslateTitleResult(
        original="君の名は。", translated="Your Name", source="db", confidence=0.9
    )
    dumped = result.model_dump(mode="json")
    assert dumped == {
        "original": "君の名は。",
        "translated": "Your Name",
        "source": "db",
        "confidence": 0.9,
    }
