"""Unit tests for persistence helper functions."""

from __future__ import annotations

from unittest.mock import AsyncMock

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import SearchResponseModel
from agent.agents.session_state import SessionState
from agent.interfaces.persistence import (
    _safe_insert_message,
    build_response_session,
    extract_plan_steps,
    persist_messages,
)
from agent.interfaces.schemas import PublicAPIResponse


class _Db:
    def __init__(self) -> None:
        self.insert_message = AsyncMock()


def _response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True, status="ok", intent="plan_selected", message="route"
    )


async def test_persist_messages_skips_empty_user_utterance() -> None:
    """#273 T1: a bypass recompute carries no new utterance (marker ->
    ``text == ""``) and must not persist an empty user row that the
    conversation history would render as an empty bubble."""
    db = _Db()
    await persist_messages(
        db=db, session_id="s1", user_text="", result=None, response=_response()
    )
    roles = [call.args[1] for call in db.insert_message.await_args_list]
    assert roles == ["assistant"]


async def test_persist_messages_inserts_genuine_user_turn() -> None:
    db = _Db()
    await persist_messages(
        db=db, session_id="s1", user_text="ユーフォ", result=None, response=_response()
    )
    roles = [call.args[1] for call in db.insert_message.await_args_list]
    assert roles == ["user", "assistant"]


async def test_persist_messages_empty_utterance_failure_persists_nothing() -> None:
    db = _Db()
    await persist_messages(
        db=db,
        session_id="s1",
        user_text="",
        result=None,
        response=_response(),
        persist_user_only=True,
    )
    assert db.insert_message.await_args_list == []


async def test_safe_insert_message_succeeds() -> None:
    fn = AsyncMock()
    await _safe_insert_message(fn, "sess-1", "user", "hello", label="test")
    fn.assert_awaited_once_with("sess-1", "user", "hello")


async def test_safe_insert_message_handles_os_error() -> None:
    fn = AsyncMock(side_effect=OSError("connection lost"))
    await _safe_insert_message(fn, "sess-1", "user", "hello", label="test")


async def test_safe_insert_message_skips_non_callable() -> None:
    await _safe_insert_message(None, "sess-1", label="test")


def test_build_response_session_with_route_history() -> None:
    state = {
        "interactions": [],
        "route_history": [{"route_id": "r1"}],
        "updated_at": "2026-01-01T00:00:00",
    }
    session, rh = build_response_session(state)
    assert isinstance(session, dict)
    assert len(rh) == 1


def test_build_response_session_with_no_route_history() -> None:
    state = {
        "interactions": [],
        "route_history": None,
        "updated_at": "2026-01-01T00:00:00",
    }
    _, rh = build_response_session(state)
    assert rh == []


def test_extract_plan_steps_with_tools() -> None:
    result = _make_result(
        steps=[
            StepRecord(tool="resolve_anime", success=True),
            StepRecord(tool="search_bangumi", success=True),
        ]
    )
    steps = extract_plan_steps(result)
    assert steps == ["resolve_anime", "search_bangumi"]


def test_extract_plan_steps_returns_none_for_none() -> None:
    assert extract_plan_steps(None) is None


def _make_result(
    intent: str = "search_bangumi",
    steps: list[StepRecord] | None = None,
) -> AgentResult:
    output = SearchResponseModel(message="test")
    return AgentResult(
        output=output,
        intent=intent,
        session_state=SessionState(),
        steps=steps or [],
    )
