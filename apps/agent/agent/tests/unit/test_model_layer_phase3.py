"""Phase 3 model-layer ownership and policy tests."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel

from agent.agents.base import (
    build_model_http_client,
    get_default_model,
    resolve_model,
    resolve_model_alias,
)
from agent.agents.route_area_splitter import split_into_areas
from agent.agents.translation import _translation_run_scope, translation_agent
from agent.config.model_aliases import (
    CredentialRef,
    ModelAlias,
    ModelAliasRegistryError,
    ProviderKind,
    validate_model_alias_registry,
)
from agent.config.settings import Settings
from agent.interfaces.fastapi_service import create_fastapi_app
from agent.interfaces.session_facade import _generate_title


def _model_settings(*, fallback: str | None = None) -> Settings:
    return Settings(
        deepseek_api_key="settings-deepseek",
        mimo_api_key="settings-mimo",
        openai_compat_api_key="settings-compat",
        openai_compat_base_url="https://api.xiaomimimo.com/v1",
        default_agent_model="deepseek:deepseek-v4-flash",
        fallback_agent_model=fallback,
        agent_deadline=100.0,
        model_attempt_timeout=45.0,
    )


def test_deploy_credential_env_names_are_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "env-deepseek")
    monkeypatch.setenv("MIMO_API_KEY", "env-mimo")
    monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "env-compat")
    settings = Settings()
    assert settings.deepseek_api_key == "env-deepseek"
    assert settings.mimo_api_key == "env-mimo"
    assert settings.openai_compat_api_key == "env-compat"


async def test_credentials_and_base_urls_come_from_settings() -> None:
    settings = _model_settings()
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        deepseek = resolve_model("deepseek:deepseek-v4-flash", http_client=client)
        mimo = resolve_model(
            "openai:mimo-v2.5@https://api.xiaomimimo.com/v1",
            http_client=client,
        )
        compat = resolve_model(
            "openai:other@https://compat.example/v1", http_client=client
        )
    try:
        assert isinstance(deepseek, OpenAIChatModel)
        assert deepseek.client.api_key == "settings-deepseek"
        assert str(deepseek.client.base_url).rstrip("/") == "https://api.deepseek.com"
        assert isinstance(mimo, OpenAIChatModel)
        assert mimo.client.api_key == "settings-mimo"
        assert str(mimo.client.base_url).rstrip("/") == (
            "https://api.xiaomimimo.com/v1"
        )
        assert isinstance(compat, OpenAIChatModel)
        assert compat.client.api_key == "settings-compat"
    finally:
        await client.aclose()


def test_model_http_client_uses_attempt_timeout_and_environment() -> None:
    expected = cast(httpx.AsyncClient, object())
    with patch("agent.agents.base.httpx.AsyncClient", return_value=expected) as build:
        client = build_model_http_client(_model_settings())
    assert client is expected
    build.assert_called_once_with(trust_env=True, timeout=45.0)


async def test_fallback_chain_disables_sdk_retries() -> None:
    settings = _model_settings(
        fallback="openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
    )
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert isinstance(model, FallbackModel)
        assert [item.client.max_retries for item in model.models] == [0, 0]
    finally:
        await client.aclose()


async def test_identical_primary_and_fallback_build_one_model() -> None:
    settings = _model_settings(fallback="deepseek:deepseek-v4-flash")
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert not isinstance(model, FallbackModel)
    finally:
        await client.aclose()


async def test_only_deepseek_sends_thinking_disabled_profile() -> None:
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=_model_settings()):
        deepseek = resolve_model_alias("deepseek", http_client=client)
        mimo = resolve_model_alias("mimo", http_client=client)
    try:
        assert isinstance(deepseek, OpenAIChatModel)
        assert isinstance(mimo, OpenAIChatModel)
        assert deepseek.settings == {"extra_body": {"thinking": {"type": "disabled"}}}
        assert mimo.settings is None
        assert deepseek.client.max_retries == 0
        assert mimo.client.max_retries == 0
    finally:
        await client.aclose()


def test_duplicate_effective_models_are_rejected() -> None:
    first = ModelAlias(
        name="same-model",
        provider_kind=ProviderKind.OPENAI,
        fixed_base_url="https://compat.example/v1",
        credential_ref=CredentialRef.OPENAI_COMPAT_API_KEY,
        disable_thinking=False,
    )
    second = ModelAlias(
        name="same-model",
        provider_kind=ProviderKind.OPENAI,
        fixed_base_url="https://compat.example/v1",
        credential_ref=CredentialRef.OPENAI_COMPAT_API_KEY,
        disable_thinking=True,
    )
    with pytest.raises(ModelAliasRegistryError, match="duplicate effective model"):
        validate_model_alias_registry({"first": first, "second": second})


async def test_override_helpers_forward_the_shared_client() -> None:
    client = httpx.AsyncClient()
    model = cast(Model, object())
    result = SimpleNamespace(output="title")
    with (
        patch(
            "agent.interfaces.session_facade.get_default_model", return_value=model
        ) as default,
        patch("agent.interfaces.session_facade.create_agent") as create,
    ):
        create.return_value.run = AsyncMock(return_value=result)
        await _generate_title("session", "query", "response", http_client=client)
    default.assert_called_once_with(http_client=client)
    with patch("agent.agents.translation.resolve_model", return_value=model) as resolve:
        selected, _ = _translation_run_scope(None)
    assert selected is model
    resolve.assert_called_once_with(translation_agent.model)
    with patch(
        "agent.agents.route_area_splitter.route_planner_agent.run", new=AsyncMock()
    ) as run:
        run.return_value.output = SimpleNamespace(areas=[])
        await split_into_areas([{} for _ in range(11)], model=model)
    assert run.await_args.kwargs["model"] is model
    await client.aclose()


def test_fastapi_lifespan_owns_and_closes_model_client() -> None:
    model_client = MagicMock(spec=httpx.AsyncClient)
    model_client.aclose = AsyncMock()
    runtime_api = MagicMock()
    with patch(
        "agent.interfaces.fastapi_service.build_model_http_client",
        return_value=model_client,
    ):
        app = create_fastapi_app(runtime_api=runtime_api, settings=_model_settings())
        with TestClient(app):
            assert app.state.model_http_client is model_client
            runtime_api.bind_model_http_client.assert_called_once_with(model_client)
    model_client.aclose.assert_awaited_once()
