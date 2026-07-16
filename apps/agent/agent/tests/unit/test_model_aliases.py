"""Security tests for caller-selected model aliases."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.animichi_runner import run_animichi_agent
from agent.agents.base import MODEL_ALIASES, ModelAliasError, resolve_model_alias
from agent.agents.runtime_models import QAResponseModel
from agent.clients.catalog_client import CatalogClientProtocol
from agent.config.settings import Settings
from agent.domain.ports import DatabasePort


def _db() -> DatabasePort:
    return cast(DatabasePort, object())


def _catalog() -> CatalogClientProtocol:
    return cast(CatalogClientProtocol, object())


async def _run(model: Model | str | None) -> object:
    return await run_animichi_agent(
        text="hello", db=_db(), locale="en", catalog=_catalog(), model=model
    )


async def test_unknown_model_alias_never_runs_agent() -> None:
    with patch(
        "agent.agents.animichi_runner.animichi_agent.run", new_callable=AsyncMock
    ) as run:
        with pytest.raises(ModelAliasError):
            await _run("__nope__")
    run.assert_not_awaited()


async def test_url_bearing_model_alias_never_runs_agent() -> None:
    with patch(
        "agent.agents.animichi_runner.animichi_agent.run", new_callable=AsyncMock
    ) as run:
        with pytest.raises(ModelAliasError):
            await _run("openai:mimo@https://evil.example")
    run.assert_not_awaited()


@pytest.mark.parametrize(
    "model_alias",
    ["DEFAULT", "default ", "", " ", "de fault", "defаult"],
)
def test_malformed_model_alias_is_rejected(model_alias: str) -> None:
    with pytest.raises(ModelAliasError):
        resolve_model_alias(model_alias)


def test_default_alias_uses_existing_default_model() -> None:
    expected = cast(Model, object())
    with patch("agent.agents.base.get_default_model", return_value=expected):
        resolved = resolve_model_alias("default")

    assert resolved is expected


def test_model_aliases_are_the_exact_server_owned_set(
    mock_settings: Settings,
) -> None:
    with patch("agent.config.get_settings", return_value=mock_settings):
        aliases = dict(MODEL_ALIASES)

    assert set(aliases) == {"default", "deepseek", "mimo"}
    assert aliases["default"].model_spec == mock_settings.default_agent_model
    assert aliases["deepseek"].credential_env_ref == "DEEPSEEK_API_KEY"
    assert aliases["mimo"].base_url == mock_settings.openai_compat_base_url
    assert aliases["mimo"].credential_env_ref == "MIMO_API_KEY"


def test_deepseek_alias_uses_server_owned_provider() -> None:
    resolved = resolve_model_alias("deepseek")

    assert isinstance(resolved, OpenAIChatModel)
    assert resolved.model_name == "deepseek-v4-flash"
    assert str(resolved.client.base_url).rstrip("/") == "https://api.deepseek.com"
    assert resolved.client.api_key == "test-key"


def test_mimo_alias_uses_server_owned_provider(mock_settings: Settings) -> None:
    with patch("agent.config.get_settings", return_value=mock_settings):
        resolved = resolve_model_alias("mimo")

    assert isinstance(resolved, OpenAIChatModel)
    assert resolved.model_name == "mimo-v2.5"
    assert str(resolved.client.base_url).rstrip("/") == (
        "https://api.xiaomimimo.com/v1"
    )
    assert resolved.client.api_key == "test-key"


def test_none_model_override_remains_unchanged() -> None:
    assert resolve_model_alias(None) is None


async def test_none_model_override_is_forwarded_unchanged() -> None:
    output = QAResponseModel(message="hello")
    run_result = MagicMock(output=output, usage=None)
    run_result.new_messages.return_value = []
    with patch(
        "agent.agents.animichi_runner.animichi_agent.run",
        new=AsyncMock(return_value=run_result),
    ) as run:
        await _run(None)
    assert run.await_args.kwargs["model"] is None
