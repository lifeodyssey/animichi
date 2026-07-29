"""BYOK per-request model construction (#284 Task 3).

Parses the `X-BYOK-*` headers into a `ByokCredential`, then builds a
per-request model for exactly one of three families — openai-compatible,
anthropic, gemini — each wired to `egress_transport.build_guarded_async_client`
(the SSRF guard, Task 1) so the request layer never has an unguarded path to
an arbitrary caller-supplied endpoint.

Construction is in-memory only: nothing here is cached, stored on `app.state`,
persisted to a session, or written to the database (T3-AC9). The caller owns
the returned `httpx.AsyncClient` and MUST `await client.aclose()` once the
turn is over, success or failure (T3-AC8) — this module never closes it
itself, since the client must stay open for the whole agent run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, cast

import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.providers.openai import OpenAIProvider

from agent.config.byok_defaults import (
    BYOK_ANTHROPIC_DEFAULT_MODEL,
    BYOK_GEMINI_DEFAULT_MODEL,
)
from agent.infrastructure.egress_errors import EgressBlocked
from agent.infrastructure.egress_guard import validate_base_url
from agent.infrastructure.egress_transport import build_guarded_async_client

ByokProvider = Literal["openai-compatible", "anthropic", "gemini"]
BYOK_PROVIDERS: Final[frozenset[str]] = frozenset(
    {"openai-compatible", "anthropic", "gemini"}
)


class ByokError(Exception):
    """Typed, no-fallback BYOK rejection.

    `.code` is the machine-readable taxonomy member; `.message` is safe to
    surface to the caller (never embeds the submitted key or `base_url`).
    """

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class ByokCredential:
    """In-memory-only BYOK credential. Never persisted, never cached."""

    provider: ByokProvider
    key: str
    model: str
    base_url: str | None = None


@dataclass(frozen=True, slots=True)
class ByokModel:
    """A constructed per-request model plus the client the caller must close."""

    model: Model
    client: httpx.AsyncClient


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="strict").strip()


def _require_known_provider(value: str | None) -> ByokProvider:
    if value not in BYOK_PROVIDERS:
        raise ByokError("invalid_request", "Unknown or missing X-BYOK-Provider.")
    return cast(ByokProvider, value)


def _require_key(raw: bytes | None) -> str:
    if raw is None:
        raise ByokError("invalid_request", "X-BYOK-Key is required.")
    key = _decode(raw)
    if not key:
        raise ByokError("invalid_request", "X-BYOK-Key must not be blank.")
    return key


def _require_base_url(raw: bytes | None, provider: ByokProvider) -> str | None:
    if raw is None:
        return None
    text = _decode(raw)
    if not text:
        return None
    if provider != "openai-compatible":
        raise ByokError(
            "invalid_request",
            "X-BYOK-Base-Url is only valid for the openai-compatible family.",
        )
    if not text.lower().startswith("https://"):
        raise ByokError("invalid_request", "X-BYOK-Base-Url must be https.")
    return text


def _default_model_for(provider: ByokProvider) -> str:
    if provider == "anthropic":
        return BYOK_ANTHROPIC_DEFAULT_MODEL
    return BYOK_GEMINI_DEFAULT_MODEL


def _require_model(value: str | None, provider: ByokProvider) -> str:
    model = (value or "").strip()
    if provider == "openai-compatible":
        if not model:
            raise ByokError(
                "invalid_request",
                "X-BYOK-Model is required for the openai-compatible family.",
            )
        return model
    return model or _default_model_for(provider)


def parse_byok_credential(
    *,
    provider_header: str | None,
    key_header: bytes | None,
    model_header: str | None,
    base_url_header: bytes | None,
) -> ByokCredential | None:
    """Parse raw BYOK headers into a credential, or `None` if none were sent.

    `None` (no BYOK headers at all) is a distinct outcome from every rejection
    below: a plain request must resolve to `get_default_model()` unchanged.
    """
    if provider_header is None and key_header is None:
        return None
    provider = _require_known_provider(provider_header)
    key = _require_key(key_header)
    base_url = _require_base_url(base_url_header, provider)
    model = _require_model(model_header, provider)
    return ByokCredential(provider=provider, key=key, model=model, base_url=base_url)


async def _validate_openai_base_url(base_url: str | None) -> None:
    try:
        await validate_base_url(base_url)
    except EgressBlocked as exc:
        raise ByokError(
            "invalid_request", "base_url failed egress validation."
        ) from exc


async def _build_openai_compatible(credential: ByokCredential) -> ByokModel:
    await _validate_openai_base_url(credential.base_url)
    client = build_guarded_async_client()
    sdk_client = AsyncOpenAI(
        base_url=credential.base_url,
        api_key=credential.key,
        http_client=client,
        max_retries=0,
    )
    provider = OpenAIProvider(openai_client=sdk_client)
    model: Model = OpenAIChatModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


def _build_anthropic(credential: ByokCredential) -> ByokModel:
    client = build_guarded_async_client()
    sdk_client = AsyncAnthropic(
        api_key=credential.key, http_client=client, max_retries=0
    )
    provider = AnthropicProvider(anthropic_client=sdk_client)
    model: Model = AnthropicModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


def _build_gemini(credential: ByokCredential) -> ByokModel:
    client = build_guarded_async_client()
    provider = GoogleProvider(api_key=credential.key, http_client=client)
    model: Model = GoogleModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


async def build_byok_model(credential: ByokCredential) -> ByokModel:
    """Build the per-request guarded model. Caller MUST `await client.aclose()`.

    Every family routes through `build_guarded_async_client` (Task 1's SSRF
    guard, Task 2's httpx-instrumentation exclusion) — there is no second,
    unguarded way to build a BYOK-bound `httpx.AsyncClient` in this module.
    """
    if credential.provider == "openai-compatible":
        return await _build_openai_compatible(credential)
    if credential.provider == "anthropic":
        return _build_anthropic(credential)
    return _build_gemini(credential)
