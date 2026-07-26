"""Behavioral coverage for model failover ordering and configuration."""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic_ai import Agent, models
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.settings import ModelSettings

from agent.agents.agent_result import AgentResult
from agent.agents.base import get_default_model, resolve_model, resolve_model_alias
from agent.clients.catalog_client import CatalogClientProtocol
from agent.config.settings import Settings
from agent.interfaces.public_api import PublicAPIRequest, RuntimeAPI


class _FailModel(TestModel):
    def __init__(self, attempts: list[str]) -> None:
        super().__init__(model_name="primary")
        self._attempts = attempts

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self._attempts.append(self.model_name)
        raise ModelHTTPError(504, self.model_name)


class _RecordingModel(TestModel):
    def __init__(self, attempts: list[str]) -> None:
        super().__init__(custom_output_text="fallback-ok", model_name="fallback")
        self._attempts = attempts

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self._attempts.append(self.model_name)
        return await super().request(messages, model_settings, model_request_parameters)


_CHAT_COMPLETION = b"""{
  "id": "chatcmpl-fallback",
  "choices": [{
    "finish_reason": "stop",
    "index": 0,
    "message": {"content": "fallback-ok", "role": "assistant"}
  }],
  "created": 0,
  "model": "provider-model",
  "object": "chat.completion"
}"""


class _CompletionTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            200,
            content=_CHAT_COMPLETION,
            headers={"Content-Type": "application/json"},
            request=request,
        )


class _TimeoutTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        raise httpx.ReadTimeout("model attempt timed out", request=request)


def _failover_settings() -> Settings:
    return Settings(
        default_agent_model="deepseek:primary",
        fallback_agent_model="openai:fast-fallback@https://compat.example/v1",
        openai_compat_api_key="test-key",
    )


async def test_primary_failure_uses_fallback_in_order() -> None:
    settings = _failover_settings()
    attempts: list[str] = []
    primary = _FailModel(attempts)
    fallback = _RecordingModel(attempts)

    def parse(spec: str, **_kwargs: object) -> TestModel:
        return primary if spec == settings.default_agent_model else fallback

    with (
        patch("agent.config.get_settings", return_value=settings),
        patch("agent.agents.base._parse_model", side_effect=parse),
    ):
        model = get_default_model()

    assert isinstance(model, FallbackModel)
    assert model.models[0] is primary
    assert model.models[1] is fallback
    result = await Agent(model).run("ping")
    assert result.output == "fallback-ok"
    assert attempts == ["primary", "fallback"]


async def test_httpx_timeout_error_drives_fallback_model() -> None:
    settings = Settings(
        fallback_agent_model="deepseek:deepseek-v4-flash",
    )
    primary_transport = _TimeoutTransport()
    fallback_transport = _CompletionTransport()
    client = httpx.AsyncClient(
        timeout=settings.model_attempt_timeout,
        mounts={
            "https://api.xiaomimimo.com": primary_transport,
            "https://api.deepseek.com": fallback_transport,
        },
    )
    with (
        patch("agent.config.get_settings", return_value=settings),
        models.override_allow_model_requests(True),
    ):
        model = get_default_model(http_client=client)
        result = await Agent(model).run("ping")
    try:
        assert result.output == "fallback-ok"
        assert client.timeout.read == settings.model_attempt_timeout
        assert len(primary_transport.requests) == 1
        assert len(fallback_transport.requests) == 1
    finally:
        await client.aclose()


@pytest.mark.parametrize(
    ("app_env", "expected"),
    [
        ("development", "animichi Dev"),
        ("staging", "animichi Staging"),
        ("production", "animichi Prod"),
    ],
)
@pytest.mark.parametrize(
    "model_spec",
    [
        "openai:mimo-v2.5@https://api.xiaomimimo.com/v1",
        "deepseek:deepseek-v4-flash",
    ],
)
async def test_app_identification_header_reaches_provider(
    app_env: str,
    expected: str,
    model_spec: str,
) -> None:
    settings = Settings(
        app_env=app_env,
        cors_allowed_origin="https://animichi.com",
        fallback_agent_model=None,
    )
    transport = _CompletionTransport()
    client = httpx.AsyncClient(transport=transport)
    with (
        patch("agent.config.get_settings", return_value=settings),
        models.override_allow_model_requests(True),
    ):
        model = resolve_model(model_spec, http_client=client)
        await Agent(model).run("ping")
    try:
        assert transport.requests[0].headers["X-App-Client"] == expected
    finally:
        await client.aclose()


async def test_effectively_identical_specs_do_not_build_fallback() -> None:
    settings = Settings(
        default_agent_model="deepseek:same-model",
        fallback_agent_model="openai:same-model@https://api.deepseek.com",
    )
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert not isinstance(model, FallbackModel)
        assert model.model_name == "same-model"
    finally:
        await client.aclose()


async def test_lone_primary_disables_sdk_retries() -> None:
    settings = Settings(fallback_agent_model=None)
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert model.client.max_retries == 0
    finally:
        await client.aclose()


async def test_production_default_is_mimo_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("DEFAULT_AGENT_MODEL")
    monkeypatch.delenv("FALLBACK_AGENT_MODEL")
    monkeypatch.delenv("DEEPSEEK_API_KEY")
    monkeypatch.setenv("MIMO_API_KEY", "prod-mimo-key")
    settings = Settings(_env_file=None)
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert settings.default_agent_model == (
            "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
        )
        assert settings.fallback_agent_model == ""
        assert not isinstance(model, FallbackModel)
        assert model.model_name == "mimo-v2.5"
        assert str(model.client.base_url).rstrip("/") == (
            "https://api.xiaomimimo.com/v1"
        )
        assert model.client.api_key == "prod-mimo-key"
        assert model.client.max_retries == 0
    finally:
        await client.aclose()


async def test_explicit_deepseek_fallback_still_works() -> None:
    settings = Settings(
        fallback_agent_model="deepseek:deepseek-v4-flash",
        mimo_api_key="prod-mimo-key",
        deepseek_api_key="prod-deepseek-key",
    )
    client = httpx.AsyncClient()
    with patch("agent.config.get_settings", return_value=settings):
        model = get_default_model(http_client=client)
    try:
        assert isinstance(model, FallbackModel)
        primary, fallback = model.models
        assert primary.model_name == "mimo-v2.5"
        assert str(primary.client.base_url).rstrip("/") == (
            "https://api.xiaomimimo.com/v1"
        )
        assert primary.client.api_key == "prod-mimo-key"
        assert fallback.model_name == "deepseek-v4-flash"
        assert str(fallback.client.base_url).rstrip("/") == ("https://api.deepseek.com")
        assert fallback.client.api_key == "prod-deepseek-key"
        assert [item.client.max_retries for item in model.models] == [0, 0]
    finally:
        await client.aclose()


def test_runtime_api_requires_model_http_client() -> None:
    with pytest.raises(TypeError, match="model_http_client"):
        RuntimeAPI(object())


async def test_alias_override_reuses_injected_model_client() -> None:
    client = httpx.AsyncClient()
    result = cast(AgentResult, object())
    api = RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=client,
    )
    with (
        patch(
            "agent.interfaces.public_api.resolve_model_alias",
            wraps=resolve_model_alias,
        ) as resolve,
        patch.object(api, "_model_request", new=AsyncMock(return_value=result)),
        patch(
            "agent.agents.base.build_model_http_client",
            side_effect=AssertionError("fresh model client built"),
        ),
    ):
        dispatched = await api._dispatch_request(
            PublicAPIRequest(text="hello"), None, [], "mimo", None
        )
    try:
        resolve.assert_called_once_with("mimo", http_client=client)
        assert dispatched[0] is result
    finally:
        await client.aclose()


async def test_default_model_reuses_injected_model_client() -> None:
    client = httpx.AsyncClient()
    result = cast(AgentResult, object())
    settings = Settings(fallback_agent_model="deepseek:deepseek-v4-flash")
    api = RuntimeAPI(
        object(),
        catalog=cast(CatalogClientProtocol, object()),
        model_http_client=client,
    )
    with (
        patch("agent.config.get_settings", return_value=settings),
        patch("agent.interfaces.public_api.get_default_model", wraps=get_default_model),
        patch.object(api, "_model_request", new=AsyncMock(return_value=result)),
        patch(
            "agent.agents.base.build_model_http_client",
            side_effect=AssertionError("fresh model client built"),
        ),
    ):
        dispatched = await api._dispatch_request(
            PublicAPIRequest(text="hello"), None, [], None, None
        )
    try:
        selected = dispatched[1]
        assert isinstance(selected, FallbackModel)
        assert all(model.client._client is client for model in selected.models)
    finally:
        await client.aclose()
