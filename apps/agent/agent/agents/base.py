"""Base agent configuration for Pydantic AI agents.

Model resolution: deepseek: → DeepSeekProvider (native),
openai: → OpenAI-compat with per-domain API key routing.
"""

from __future__ import annotations

import os
from typing import TypeVar, overload
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.deepseek import DeepSeekProvider
from pydantic_ai.providers.openai import OpenAIProvider

T = TypeVar("T", bound=BaseModel)

_FALLBACK_MODEL = "deepseek:deepseek-v4-flash"


def _build_http_client() -> httpx.AsyncClient:
    """HTTP client that ignores shell proxy env vars."""
    from agent.config import get_settings

    timeout = float(get_settings().timeout_seconds)
    return httpx.AsyncClient(trust_env=False, timeout=timeout)


def _resolve_api_key(base_url: str) -> str | None:
    """Match a base URL to the right API key env var by domain."""
    host = urlparse(base_url).hostname or ""
    domain_keys = [
        ("xiaomimimo.com", "MIMO_API_KEY"),
        ("deepseek.com", "DEEPSEEK_API_KEY"),
    ]
    for domain, env_var in domain_keys:
        if host == domain or host.endswith(f".{domain}"):
            return os.environ.get(env_var)
    from agent.config import get_settings

    return get_settings().openai_compat_api_key or None


def _parse_model(spec: str) -> Model:
    """Parse a model spec string into a concrete Model."""
    if spec.startswith("deepseek:"):
        name = spec.removeprefix("deepseek:")
        provider = DeepSeekProvider(
            api_key=os.environ.get("DEEPSEEK_API_KEY"),
            http_client=_build_http_client(),
        )
        return OpenAIChatModel(name, provider=provider)

    if spec.startswith("openai:"):
        raw = spec.removeprefix("openai:")
        if "@" in raw:
            name, base_url = raw.split("@", 1)
        else:
            from agent.config import get_settings

            name, base_url = raw, get_settings().openai_compat_base_url
        oai_provider = OpenAIProvider(
            base_url=base_url,
            api_key=_resolve_api_key(base_url),
            http_client=_build_http_client(),
        )
        return OpenAIChatModel(name, provider=oai_provider)

    raise ValueError(f"Unsupported model spec: {spec}")


def parse_model_spec(
    model: Model | str, *, use_settings_fallbacks: bool = False
) -> Model:
    """Public API for resolving a model spec string."""
    if not isinstance(model, str):
        return model
    primary = _parse_model(model)
    if not use_settings_fallbacks:
        return primary
    from agent.config import get_settings

    fb = get_settings().fallback_agent_model
    if fb and fb != model:
        return FallbackModel(primary, _parse_model(fb))
    return primary


def get_default_model() -> Model:
    """Build the default model with optional fallback chain."""
    from agent.config import get_settings

    settings = get_settings()
    primary = _parse_model(settings.default_agent_model or _FALLBACK_MODEL)

    fallbacks: list[Model] = []
    if settings.fallback_agent_model:
        fallbacks.append(_parse_model(settings.fallback_agent_model))

    if not fallbacks:
        return primary
    return FallbackModel(primary, *fallbacks)


def resolve_model(model: Model | str | None) -> Model:
    """Resolve an explicit or default model."""
    if model is None:
        return get_default_model()
    if isinstance(model, str):
        return _parse_model(model)
    return model


def describe_model(model: object) -> str:
    """Human-readable model description for logs."""
    if isinstance(model, FallbackModel):
        return f"fallback({', '.join(m.model_name for m in model.models)})"
    label = getattr(model, "model_name", None)
    return label if isinstance(label, str) and label else type(model).__name__


@overload
def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: type[T],
    tool_retries: int = 2,
) -> Agent[None, T]: ...


@overload
def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: None = None,
    tool_retries: int = 2,
) -> Agent[None, str]: ...


def create_agent(
    model: Model | str | None = None,
    *,
    system_prompt: str = "",
    output_type: type[T] | None = None,
    tool_retries: int = 2,
) -> Agent[None, T] | Agent[None, str]:
    """Create a Pydantic AI agent with the given configuration."""
    selected = resolve_model(model)
    if output_type is None:
        return Agent(selected, system_prompt=system_prompt, retries=tool_retries)
    return Agent(
        selected,
        system_prompt=system_prompt,
        output_type=output_type,
        retries=tool_retries,
    )
