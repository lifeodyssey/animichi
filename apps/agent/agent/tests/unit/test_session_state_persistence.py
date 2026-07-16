"""Versioned session-state persistence compatibility tests."""

from __future__ import annotations

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QADataModel, QAResponseModel
from agent.agents.session_state import CurrentAnime, SessionState
from agent.interfaces.session_facade import build_context_block, extract_context_delta


def _result(session_state: SessionState | None = None) -> AgentResult:
    output = QAResponseModel(
        intent="general_qa",
        message="Answer.",
        data=QADataModel(message="Answer."),
    )
    return AgentResult(
        output=output,
        intent="general_qa",
        session_state=session_state or SessionState(),
        steps=[
            StepRecord(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": "115908", "title": "Eupho"},
            )
        ],
    )


def _persisted_state(delta: dict[str, object]) -> dict[str, object]:
    return {
        "interactions": [{"context_delta": delta}],
        "last_intent": "general_qa",
    }


def test_versioned_session_state_round_trips_through_context_block() -> None:
    session = SessionState(
        current_anime=CurrentAnime(bangumi_id="115908", title="Eupho")
    )

    delta = extract_context_delta(_result(session))
    block = build_context_block(_persisted_state(delta))

    assert block is not None
    assert SessionState.model_validate(block["session_state_v2"]) == session
    assert block["current_bangumi_id"] == "115908"
    assert block["current_anime_title"] == "Eupho"


def test_empty_session_delta_leaves_legacy_context_block_identical() -> None:
    delta = extract_context_delta(_result())
    legacy_delta = {
        key: value for key, value in delta.items() if key != "session_state_v2"
    }

    with_v2 = build_context_block(_persisted_state(delta))
    legacy_only = build_context_block(_persisted_state(legacy_delta))

    assert delta["session_state_v2"] == SessionState().model_dump(mode="json")
    assert with_v2 == legacy_only


def test_old_session_without_v2_uses_legacy_context() -> None:
    state = _persisted_state(
        {
            "bangumi_id": "253",
            "anime_title": "Legacy Anime",
            "location": "Uji",
        }
    )

    block = build_context_block(state)

    assert block is not None
    assert "session_state_v2" not in block
    assert block["current_bangumi_id"] == "253"
    assert block["current_anime_title"] == "Legacy Anime"
    assert block["last_location"] == "Uji"


def test_malformed_v2_falls_back_to_legacy_context() -> None:
    state = _persisted_state(
        {
            "bangumi_id": "253",
            "anime_title": "Legacy Anime",
            "session_state_v2": {"unknown": True},
        }
    )

    block = build_context_block(state)

    assert block is not None
    assert "session_state_v2" not in block
    assert block["current_bangumi_id"] == "253"
