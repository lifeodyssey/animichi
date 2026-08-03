"""Cross-layer timeout budget invariants."""

from __future__ import annotations

import pytest

from agent.config.settings import Settings


def test_model_attempt_timeout_precedes_agent_deadline() -> None:
    settings = Settings()
    preamble_margin = settings.agent_deadline * 0.05
    assert (
        2 * settings.model_attempt_timeout + preamble_margin < settings.agent_deadline
    )


def test_invalid_model_timeout_ordering_is_rejected() -> None:
    with pytest.raises(ValueError, match="model_attempt_timeout"):
        Settings(agent_deadline=90.0, model_attempt_timeout=45.0)
