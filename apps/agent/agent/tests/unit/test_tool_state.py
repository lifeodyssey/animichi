"""ToolState owns inputs; SessionState owns every result payload."""

import pytest
from pydantic import ValidationError

from agent.agents.session_state import SessionState
from agent.agents.tool_state import ToolState


def test_tool_state_has_no_historical_result_slots() -> None:
    state = ToolState(locale="zh", session=SessionState(clarification_revision=2))
    assert state.to_legacy_dict() == {"locale": "zh"}
    for field in ("search_bangumi", "plan_route", "clarify", "resolve_candidates"):
        assert not hasattr(state, field)


def test_tool_state_rejects_historical_payloads() -> None:
    with pytest.raises(ValidationError):
        ToolState.model_validate({"search_nearby": {"rows": []}})
