"""Shape and typing tests for the runtime tool state."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent.agents.models import ToolName
from agent.agents.session_state import CurrentAnime, SessionState
from agent.agents.tool_state import SearchState, ToolState


def test_typed_state_serializes_to_recorded_legacy_shape() -> None:
    fixture_path = Path(__file__).parents[1] / "fixtures/tool_state_legacy_shape.json"
    legacy_shape = json.loads(fixture_path.read_text(encoding="utf-8"))

    state = ToolState.model_validate(legacy_shape)

    assert isinstance(state.search_nearby, SearchState)
    assert state.search_bangumi is not None
    assert state.search_bangumi.row_count == 1
    assert state.to_legacy_dict() == legacy_shape


def test_runtime_payload_rejects_unknown_typo_key() -> None:
    state = ToolState()

    with pytest.raises(ValidationError, match="row_cout"):
        state.set_payload(
            ToolName.RESOLVE_ANIME,
            {"title": "響け！ユーフォニアム", "row_cout": 1},
        )


def test_session_state_never_leaks_into_legacy_tool_state_shape() -> None:
    state = ToolState(
        session=SessionState(
            current_anime=CurrentAnime(
                bangumi_id="115908",
                title="響け！ユーフォニアム",
            )
        )
    )

    assert state.to_legacy_dict() == {}
