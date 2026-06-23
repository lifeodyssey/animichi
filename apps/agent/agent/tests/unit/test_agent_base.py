"""Unit tests for agent model resolution and fallback chain."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.base import describe_model, resolve_model
from agent.config.settings import Settings


@pytest.fixture(autouse=True)
def _mock_api_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-deepseek-key")
    monkeypatch.setenv("MIMO_API_KEY", "test-mimo-key")


def _test_settings() -> Settings:
    return Settings(
        openai_compat_api_key="test-key",
        openai_compat_base_url="https://api.xiaomimimo.com/v1",
        default_agent_model="deepseek:deepseek-v4-flash",
        fallback_agent_model="openai:mimo-v2.5@https://api.xiaomimimo.com/v1",
    )


class TestResolveModel:
    def test_deepseek_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model("deepseek:deepseek-v4-flash")
        assert isinstance(model, OpenAIChatModel)
        assert model.model_name == "deepseek-v4-flash"

    def test_openai_compat_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model("openai:mimo-v2.5@https://api.xiaomimimo.com/v1")
        assert isinstance(model, OpenAIChatModel)
        assert model.model_name == "mimo-v2.5"

    def test_default_uses_fallback_chain(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model(None)
        assert isinstance(model, FallbackModel)
        assert len(model.models) == 2
        assert model.models[0].model_name == "deepseek-v4-flash"
        assert model.models[1].model_name == "mimo-v2.5"

    def test_explicit_model_skips_fallback(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model("deepseek:deepseek-v4-flash")
        assert isinstance(model, OpenAIChatModel)

    def test_unsupported_spec_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported model spec"):
            with patch("agent.config.get_settings", return_value=_test_settings()):
                resolve_model("unknown:model")


class TestDescribeModel:
    def test_single_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model("deepseek:deepseek-v4-flash")
        assert describe_model(model) == "deepseek-v4-flash"

    def test_fallback_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model(None)
        assert describe_model(model) == "fallback(deepseek-v4-flash, mimo-v2.5)"
