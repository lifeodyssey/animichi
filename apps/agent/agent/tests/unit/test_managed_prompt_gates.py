"""ManagedPrompt construction-gate tests."""

from unittest.mock import MagicMock

import pytest
from logfire.variables import Variable

from agent.agents.animichi_agent import _INSTRUCTIONS, build_animichi_agent


def test_default_and_kill_switch_keep_construction_equal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANIMICHI_MANAGED_PROMPT", raising=False)
    default_agent = build_animichi_agent(modern_composition=True)
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "0")
    monkeypatch.setenv("LOGFIRE_TOKEN", "token")
    monkeypatch.setenv("LOGFIRE_API_KEY", "api-key")
    killed_agent = build_animichi_agent(modern_composition=True)

    assert default_agent._instructions == killed_agent._instructions == [_INSTRUCTIONS]
    assert repr(default_agent._root_capability) == repr(killed_agent._root_capability)


def test_legacy_composition_never_resolves_managed_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANIMICHI_MANAGED_PROMPT", "1")
    monkeypatch.setenv("LOGFIRE_TOKEN", "token")
    monkeypatch.setenv("LOGFIRE_API_KEY", "api-key")
    remote = MagicMock()
    monkeypatch.setattr(Variable, "get", remote)

    agent = build_animichi_agent(modern_composition=False)
    assert agent._instructions[0] == _INSTRUCTIONS
    assert "_AnimichiManagedPrompt" not in repr(agent._root_capability)
    remote.assert_not_called()
