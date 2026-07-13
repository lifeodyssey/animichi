"""Unit tests for eval .env precedence: real process env wins over stale .env."""

from __future__ import annotations

from agent.tests.eval.eval_common import real_env_updates


def test_keeps_real_process_value_over_env_file() -> None:
    updates = real_env_updates(
        {"DEEPSEEK_API_KEY": "stale-from-file"},
        {"DEEPSEEK_API_KEY": "real-rotated-key"},
    )

    assert "DEEPSEEK_API_KEY" not in updates


def test_keeps_existing_value_even_when_it_looks_fake() -> None:
    updates = real_env_updates(
        {"DEEPSEEK_API_KEY": "real-key"},
        {"DEEPSEEK_API_KEY": "test-key"},
    )

    assert updates == {}


def test_fills_unset_key_from_env_file() -> None:
    updates = real_env_updates({"MIMO_API_KEY": "real-key"}, {})

    assert updates == {"MIMO_API_KEY": "real-key"}


def test_skips_none_values() -> None:
    updates = real_env_updates({"EMPTY": None}, {})

    assert updates == {}


def test_does_not_override_real_default_agent_model() -> None:
    updates = real_env_updates(
        {"DEFAULT_AGENT_MODEL": "deepseek:stale"},
        {"DEFAULT_AGENT_MODEL": "deepseek:deepseek-v4-pro"},
    )

    assert "DEFAULT_AGENT_MODEL" not in updates
