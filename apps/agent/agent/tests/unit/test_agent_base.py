"""Unit tests for agent model resolution and fallback chain."""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.base import (
    describe_model,
    parse_model_spec,
    resolve_model,
)
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


def _deepseek_extra_body() -> object:
    return {"thinking": {"type": "disabled"}}


def _agent_calls(path: Path) -> list[ast.Call]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "Agent"
    ]


def _has_non_none_name(call: ast.Call) -> bool:
    names = {keyword.arg: keyword.value for keyword in call.keywords}
    value = names.get("name")
    return value is not None and not (
        isinstance(value, ast.Constant) and value.value is None
    )


def _unnamed_agent_calls() -> list[str]:
    source_root = Path(__file__).parents[2]
    files = (path for path in source_root.rglob("*.py") if "tests" not in path.parts)
    return [
        f"{path.relative_to(source_root)}:{call.lineno}"
        for path in files
        for call in _agent_calls(path)
        if not _has_non_none_name(call)
    ]


def test_every_agent_construction_has_explicit_name() -> None:
    assert _unnamed_agent_calls() == []


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

    def test_deepseek_model_disables_thinking(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = parse_model_spec("deepseek:deepseek-v4-flash")
        assert isinstance(model, OpenAIChatModel)
        assert model.settings is not None
        assert model.settings.get("extra_body") == _deepseek_extra_body()

    def test_deepseek_openai_compat_disables_thinking(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = parse_model_spec("openai:deepseek-v4-pro@https://api.deepseek.com")
        assert isinstance(model, OpenAIChatModel)
        assert model.settings is not None
        assert model.settings.get("extra_body") == _deepseek_extra_body()

    def test_mimo_openai_compat_keeps_settings_empty(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = parse_model_spec(
                "openai:mimo-v2.5-pro@https://api.xiaomimimo.com/v1"
            )
        assert isinstance(model, OpenAIChatModel)
        assert model.settings is None or "extra_body" not in model.settings

    def test_unprofiled_openai_compat_keeps_settings_empty(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = parse_model_spec("openai:other@https://compat.example/v1")
        assert isinstance(model, OpenAIChatModel)
        assert model.settings is None or "extra_body" not in model.settings


class TestDescribeModel:
    def test_single_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model("deepseek:deepseek-v4-flash")
        assert describe_model(model) == "deepseek-v4-flash"

    def test_fallback_model(self) -> None:
        with patch("agent.config.get_settings", return_value=_test_settings()):
            model = resolve_model(None)
        assert describe_model(model) == "fallback(deepseek-v4-flash, mimo-v2.5)"
