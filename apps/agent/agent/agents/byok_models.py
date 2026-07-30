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

from dataclasses import dataclass, field
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
from agent.infrastructure.egress_transport import (
    TransportWrapper,
    build_guarded_async_client,
)

ByokProvider = Literal["openai-compatible", "anthropic", "gemini"]
BYOK_PROVIDERS: Final[frozenset[str]] = frozenset(
    {"openai-compatible", "anthropic", "gemini"}
)
ByokErrorCode = Literal["invalid_request", "byok_credential_rejected"]


class ByokError(Exception):
    """Typed, no-fallback BYOK rejection.

    `.code` is the machine-readable taxonomy member; `.message` is safe to
    surface to the caller (never embeds the submitted key or `base_url`).
    """

    def __init__(self, code: ByokErrorCode, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class ByokCredential:
    """In-memory-only BYOK credential. Never persisted, never cached.

    `key`/`base_url` are excluded from `repr()` (P1-1 defense-in-depth): this
    object is never placed in a FastAPI dependency-injected parameter (which
    `logfire.instrument_fastapi()` would otherwise capture verbatim into
    `fastapi.arguments.values`), but a masked repr means any other accidental
    `repr()`/log call on this object — a debugger, a future `logger.info`,
    an exception's local-variable dump — still can't leak the plaintext.
    """

    provider: ByokProvider
    key: str = field(repr=False)
    model: str
    base_url: str | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class ByokModel:
    """A constructed per-request model plus the client the caller must close."""

    model: Model
    client: httpx.AsyncClient


def _decode(raw: bytes) -> str:
    return raw.decode("utf-8", errors="strict").strip()


def _decode_header(raw: bytes, name: str) -> str:
    try:
        return _decode(raw)
    except UnicodeDecodeError as exc:
        raise ByokError("invalid_request", f"{name} must be valid UTF-8.") from exc


def _require_known_provider(value: str | None) -> ByokProvider:
    if value not in BYOK_PROVIDERS:
        raise ByokError("invalid_request", "Unknown or missing X-BYOK-Provider.")
    return cast(ByokProvider, value)


def _require_key(raw: bytes | None) -> str:
    if raw is None:
        raise ByokError("invalid_request", "X-BYOK-Key is required.")
    key = _decode_header(raw, "X-BYOK-Key")
    if not key:
        raise ByokError("invalid_request", "X-BYOK-Key must not be blank.")
    return key


def _require_base_url(raw: bytes | None, provider: ByokProvider) -> str | None:
    text = _decode_header(raw, "X-BYOK-Base-Url") if raw is not None else ""
    if provider != "openai-compatible":
        if text:
            raise ByokError(
                "invalid_request",
                "X-BYOK-Base-Url is only valid for the openai-compatible family.",
            )
        return None
    if not text:
        # Dedicated parse-layer message (P1-3, Fable P2-1): without this, a
        # missing base_url reached `validate_base_url(None)` at model-build
        # time and failed with the generic egress-validation message —
        # technically correct but confusing, since the real problem is
        # "missing", not "SSRF-blocked".
        raise ByokError(
            "invalid_request",
            "X-BYOK-Base-Url is required for the openai-compatible family.",
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


def has_byok_signal(*, provider_header: str | None, key_header: bytes | None) -> bool:
    """True if the request carries any BYOK signal at all.

    Shared by `parse_byok_credential` (the `None` early-out) and the route
    layer's login-gate check (P3), which must answer this question *before*
    running full header-shape validation — otherwise a malformed BYOK header
    from an anonymous caller would surface as `invalid_request` (400) instead
    of `byok_requires_login` (403), the wrong rejection for the situation.
    """
    return provider_header is not None or key_header is not None


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
    An orphaned `X-BYOK-Model`/`X-BYOK-Base-Url` with neither provider nor key
    (P3) is rejected rather than silently ignored — it is far more likely a
    caller forgot the other two headers than that it means nothing.
    """
    if not has_byok_signal(provider_header=provider_header, key_header=key_header):
        if model_header is not None or base_url_header is not None:
            raise ByokError(
                "invalid_request",
                "X-BYOK-Model/X-BYOK-Base-Url require X-BYOK-Provider and X-BYOK-Key.",
            )
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


async def _build_openai_compatible(
    credential: ByokCredential, *, transport_wrapper: TransportWrapper | None
) -> ByokModel:
    await _validate_openai_base_url(credential.base_url)
    # No `await` between this construction and the return: the probe route runs
    # this inside `asyncio.timeout`, and cancellation is only delivered at an
    # await point. An await added below would let the deadline fire after the
    # client exists but before the caller can hold it, leaking the connection.
    client = build_guarded_async_client(transport_wrapper=transport_wrapper)
    sdk_client = AsyncOpenAI(
        base_url=credential.base_url,
        api_key=credential.key,
        http_client=client,
        max_retries=0,
    )
    provider = OpenAIProvider(openai_client=sdk_client)
    model: Model = OpenAIChatModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


def _build_anthropic(
    credential: ByokCredential, *, transport_wrapper: TransportWrapper | None
) -> ByokModel:
    client = build_guarded_async_client(transport_wrapper=transport_wrapper)
    sdk_client = AsyncAnthropic(
        api_key=credential.key, http_client=client, max_retries=0
    )
    provider = AnthropicProvider(anthropic_client=sdk_client)
    model: Model = AnthropicModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


def _build_gemini(
    credential: ByokCredential, *, transport_wrapper: TransportWrapper | None
) -> ByokModel:
    # `GoogleProvider.__init__` falls back to `os.getenv("GOOGLE_API_KEY")`
    # only when the `api_key` it receives is falsy (P1-2) — `_require_nonblank_key`
    # below is the structural guarantee that never happens here, so this call
    # always uses `credential.key`, never a server-side env credential.
    # Retry behaviour is left at the `google-genai` SDK default (unlike the
    # openai-compatible family's explicit `max_retries=0`, T3-AC2 names only
    # `AsyncOpenAI`) — pinned here as a deliberate choice, not an oversight.
    client = build_guarded_async_client(transport_wrapper=transport_wrapper)
    provider = GoogleProvider(api_key=credential.key, http_client=client)
    model: Model = GoogleModel(credential.model, provider=provider)
    return ByokModel(model=model, client=client)


def _require_nonblank_key(credential: ByokCredential) -> None:
    """Belt-and-suspenders (P1-2): `parse_byok_credential` already guarantees
    a non-blank key, but `ByokCredential` can in principle be constructed
    directly. A blank key reaching `GoogleProvider`/`AnthropicProvider` would
    silently fall back to a server-side environment credential instead of
    failing loudly — exactly the silent fallback this spec forbids."""
    if not credential.key:
        raise ByokError("invalid_request", "BYOK credential key must not be blank.")


async def build_byok_model(
    credential: ByokCredential,
    *,
    transport_wrapper: TransportWrapper | None = None,
) -> ByokModel:
    """Build the per-request guarded model. Caller MUST `await client.aclose()`.

    Every family routes through `build_guarded_async_client` (Task 1's SSRF
    guard, Task 2's httpx-instrumentation exclusion) — there is no second,
    unguarded way to build a BYOK-bound `httpx.AsyncClient` in this module.

    `transport_wrapper` (review follow-up, #479 P2): threaded straight to
    `build_guarded_async_client` so a caller — the probe route (Task 5) —
    can install an additional transport (its response-size cap) at
    construction time, never via a post-construction `client._transport =`
    reassignment.
    """
    _require_nonblank_key(credential)
    if credential.provider == "openai-compatible":
        return await _build_openai_compatible(
            credential, transport_wrapper=transport_wrapper
        )
    if credential.provider == "anthropic":
        return _build_anthropic(credential, transport_wrapper=transport_wrapper)
    return _build_gemini(credential, transport_wrapper=transport_wrapper)
