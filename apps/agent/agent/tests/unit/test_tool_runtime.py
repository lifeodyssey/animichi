"""Unit tests for tool_runtime: summarization, ephemeral tools, clarify."""

from __future__ import annotations

from unittest.mock import MagicMock

from agent.agents.handlers import execute_answer_question, execute_greet_user
from agent.agents.models import ToolName
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import PilgrimagePointModel, ResultsMetadataModel
from agent.agents.tool_results import (
    ClarifyToolResult,
    MessageToolResult,
    ResolveAnimeResult,
    SearchToolPreview,
    SearchToolResult,
)
from agent.agents.tool_runtime import _run_ephemeral, _summarize_for_llm, run_clarify
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps() -> RuntimeDeps:
    return RuntimeDeps(db=object(), locale="ja", query="q", catalog=MockCatalogClient())


def _ctx(deps: RuntimeDeps) -> object:
    """Stand-in for RunContext[RuntimeDeps] — only .deps is read."""
    ctx = MagicMock()
    ctx.deps = deps
    return ctx


def _row(name: str, episode: int = 1) -> PilgrimagePointModel:
    return PilgrimagePointModel(
        id=name, name=name, latitude=1.0, longitude=1.0, episode=episode
    )


def test_summarize_for_llm_passes_through_resolve_anime() -> None:
    payload = ResolveAnimeResult(bangumi_id="1", title="t")
    assert _summarize_for_llm(ToolName.RESOLVE_ANIME, payload) is payload


def test_summarize_for_llm_passes_through_small_search_result() -> None:
    payload = SearchToolResult(rows=[_row("a")], row_count=1)
    assert _summarize_for_llm(ToolName.SEARCH_BANGUMI, payload) is payload


def test_summarize_for_llm_previews_large_search_result() -> None:
    rows = [_row(f"p{i}", i) for i in range(7)]
    payload = SearchToolResult(rows=rows, row_count=7, status="ok")
    summary = _summarize_for_llm(ToolName.SEARCH_BANGUMI, payload)
    assert isinstance(summary, SearchToolPreview)
    assert summary.row_count == 7
    assert len(summary.preview) == 5


def test_summarize_for_llm_preview_note_mentions_anime_title() -> None:
    rows = [_row(f"p{i}", i) for i in range(6)]
    metadata = ResultsMetadataModel(anime_title="響け")
    payload = SearchToolResult(rows=rows, row_count=6, metadata=metadata)
    summary = _summarize_for_llm(ToolName.SEARCH_NEARBY, payload)
    assert isinstance(summary, SearchToolPreview)
    assert "響け" in summary.note


async def test_run_ephemeral_greet_user_returns_message_tool_result() -> None:
    deps = _deps()
    result = await _run_ephemeral(
        _ctx(deps),
        tool=ToolName.GREET_USER,
        params={"message": "hi"},
        handler=execute_greet_user,
    )
    assert result == MessageToolResult(message="hi", status="info")


async def test_run_ephemeral_stores_dict_shape_in_tool_state() -> None:
    deps = _deps()
    await _run_ephemeral(
        _ctx(deps),
        tool=ToolName.GREET_USER,
        params={"message": "hi"},
        handler=execute_greet_user,
    )
    assert deps.tool_state["greet_user"] == {"message": "hi", "status": "info"}


async def test_run_ephemeral_answer_question_returns_message_tool_result() -> None:
    deps = _deps()
    result = await _run_ephemeral(
        _ctx(deps),
        tool=ToolName.ANSWER_QUESTION,
        params={"answer": "42"},
        handler=execute_answer_question,
    )
    assert result == MessageToolResult(message="42", status="info")


async def test_run_clarify_returns_clarify_tool_result() -> None:
    deps = _deps()
    result = await run_clarify(deps, question="which?", options=["A", "B"])
    assert isinstance(result, ClarifyToolResult)
    assert result.question == "which?"
    assert [c.title for c in result.candidates] == ["A", "B"]


async def test_run_clarify_sets_pending_clarify_flag() -> None:
    deps = _deps()
    await run_clarify(deps, question="q", options=None)
    assert deps.tool_state["pending_clarify"] is True


async def test_run_clarify_stores_dict_with_action_required() -> None:
    deps = _deps()
    await run_clarify(deps, question="q", options=["A"])
    stored = deps.tool_state["clarify"]
    assert isinstance(stored, dict)
    assert stored["action_required"] == "return clarify_response"
