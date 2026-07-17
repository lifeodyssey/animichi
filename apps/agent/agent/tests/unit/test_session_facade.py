"""Typed SessionState storage-envelope tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from agent.agents.agent_result import AgentResult
from agent.agents.runtime_models import QAResponseModel
from agent.agents.session_state import (
    CurrentAnime,
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.session_facade import (
    build_context_block,
    build_message_history,
    compact_session_interactions,
    extract_context_delta,
    normalize_session_state,
)


def _pending_state() -> SessionState:
    return SessionState(
        current_anime=CurrentAnime(bangumi_id="485", title="Haruhi"),
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=["485", "3375"],
            ordered_candidates=[
                OrderedCandidate(id="485", title="Haruhi"),
                OrderedCandidate(id="3375", title="Disappearance"),
            ],
            revision=3,
        ),
        clarification_revision=3,
    )


def _interaction(state: SessionState) -> dict[str, object]:
    return {"context_delta": {"session_state_v2": state.model_dump(mode="json")}}


def test_normalize_session_state_repairs_storage_lists() -> None:
    state = normalize_session_state({"interactions": "bad", "route_history": None})
    assert state["interactions"] == []
    assert state["route_history"] == []


def test_latest_typed_state_is_the_only_context_carrier() -> None:
    runtime = _pending_state()
    block = build_context_block(
        {"interactions": [_interaction(runtime)], "last_intent": "clarify"}
    )
    assert block is not None
    assert set(block) == {"summary", "last_intent", "session_state_v2"}
    assert SessionState.model_validate(block["session_state_v2"]) == runtime


def test_explicit_empty_state_clears_older_pending_without_fallback() -> None:
    block = build_context_block(
        {
            "interactions": [
                _interaction(_pending_state()),
                _interaction(SessionState()),
            ],
            "last_intent": "general_qa",
        }
    )
    assert block is not None
    restored = SessionState.model_validate(block["session_state_v2"])
    assert restored.pending_clarification is None


def test_legacy_candidate_deltas_are_not_reconstructed() -> None:
    block = build_context_block(
        {
            "interactions": [
                {
                    "context_delta": {
                        "pending_clarify": True,
                        "resolve_candidates": [{"bangumi_id": "485"}],
                    }
                }
            ]
        }
    )
    assert block is None


def test_extract_delta_always_serializes_empty_state_clear() -> None:
    result = AgentResult(
        output=QAResponseModel(message="Answer"),
        intent="general_qa",
        session_state=SessionState(),
    )
    assert extract_context_delta(result) == {
        "session_state_v2": SessionState().model_dump(mode="json")
    }


def test_message_history_preserves_interaction_order() -> None:
    state = {
        "interactions": [
            {"new_messages": [{"id": 1}]},
            {"new_messages": [{"id": 2}, {"id": 3}]},
        ]
    }
    assert build_message_history(state) == [{"id": 1}, {"id": 2}, {"id": 3}]


async def test_compaction_keeps_recent_typed_deltas() -> None:
    store = InMemorySessionStore()
    interactions = [
        {"text": str(index), "intent": "search", "context_delta": {"index": index}}
        for index in range(8)
    ]
    state = normalize_session_state({"interactions": interactions})
    agent = MagicMock()
    agent.run = AsyncMock(return_value=MagicMock(output="summary"))
    with patch("agent.interfaces.session_facade.create_agent", return_value=agent):
        await compact_session_interactions(
            "session",
            state,
            store,
            http_client=MagicMock(spec=httpx.AsyncClient),
        )
    saved = await store.get("session")
    assert saved is not None
    assert saved["interactions"] == interactions[-2:]
    assert saved["summary"] == "summary"
