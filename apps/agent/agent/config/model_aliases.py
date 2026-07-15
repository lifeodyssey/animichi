"""Server-owned model aliases accepted at the public request boundary."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from urllib.parse import urlparse

_MIMO_MODEL_SPEC = "openai:mimo-v2.5"


@dataclass(frozen=True)
class ModelAlias:
    """Fixed model transport and credential configuration."""

    model_spec: str
    base_url: str | None
    credential_env_ref: str


class ModelAliasError(ValueError):
    """Raised when a caller requests an invalid model alias."""

    def __init__(self, alias: str) -> None:
        self.alias = alias
        super().__init__("Invalid model alias.")


def _host_matches(base_url: str, domain: str) -> bool:
    host = urlparse(base_url).hostname or ""
    return host == domain or host.endswith(f".{domain}")


def _credential_ref(base_url: str) -> str:
    if _host_matches(base_url, "xiaomimimo.com"):
        return "MIMO_API_KEY"
    if _host_matches(base_url, "deepseek.com"):
        return "DEEPSEEK_API_KEY"
    return "OPENAI_COMPAT_API_KEY"


def _openai_base_url(spec: str) -> str:
    from agent.config import get_settings

    _, separator, base_url = spec.partition("@")
    return base_url if separator else get_settings().openai_compat_base_url


def _default_alias() -> ModelAlias:
    from agent.config import get_settings

    spec = get_settings().default_agent_model
    if spec.startswith("deepseek:"):
        return ModelAlias(spec, "https://api.deepseek.com", "DEEPSEEK_API_KEY")
    if not spec.startswith("openai:"):
        return ModelAlias(spec, None, "provider-owned")
    base_url = _openai_base_url(spec.removeprefix("openai:"))
    return ModelAlias(spec, base_url, _credential_ref(base_url))


def _deepseek_alias() -> ModelAlias:
    return ModelAlias(
        "deepseek:deepseek-v4-flash",
        "https://api.deepseek.com",
        "DEEPSEEK_API_KEY",
    )


def _configured_mimo_spec(default: str, fallback: str | None) -> str:
    for spec in (default, fallback):
        if spec and spec.startswith("openai:") and "mimo" in spec.lower():
            name, _, _ = spec.removeprefix("openai:").partition("@")
            return f"openai:{name}"
    return _MIMO_MODEL_SPEC


def _mimo_alias() -> ModelAlias:
    from agent.config import get_settings

    settings = get_settings()
    spec = _configured_mimo_spec(
        settings.default_agent_model, settings.fallback_agent_model
    )
    return ModelAlias(spec, settings.openai_compat_base_url, "MIMO_API_KEY")


_BUILDERS: dict[str, Callable[[], ModelAlias]] = {
    "default": _default_alias,
    "deepseek": _deepseek_alias,
    "mimo": _mimo_alias,
}


class _ModelAliasMap(Mapping[str, ModelAlias]):
    def __getitem__(self, key: str) -> ModelAlias:
        return _BUILDERS[key]()

    def __iter__(self) -> Iterator[str]:
        return iter(_BUILDERS)

    def __len__(self) -> int:
        return len(_BUILDERS)


MODEL_ALIASES: Mapping[str, ModelAlias] = _ModelAliasMap()
