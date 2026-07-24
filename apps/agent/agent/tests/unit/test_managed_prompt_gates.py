"""ManagedPrompt construction-gate tests."""

import pytest

from agent.agents.animichi_agent import (
    _INSTRUCTIONS,
    _current_datetime_context,
    _current_turn_language,
    build_animichi_agent,
)


def test_default_and_kill_switch_keep_construction_equal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANIMICHI_MANAGED_PROMPT", raising=False)
    default_agent = build_animichi_agent()
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "0")
    monkeypatch.setenv("LOGFIRE_TOKEN", "token")
    monkeypatch.setenv("LOGFIRE_API_KEY", "api-key")
    killed_agent = build_animichi_agent()

    expected = [_INSTRUCTIONS, _current_turn_language, _current_datetime_context]
    assert default_agent._instructions == killed_agent._instructions == expected
    assert repr(default_agent._root_capability) == repr(killed_agent._root_capability)
