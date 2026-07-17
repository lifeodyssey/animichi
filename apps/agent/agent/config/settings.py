"""Application settings and configuration management."""

import warnings
from functools import lru_cache
from pathlib import Path
from typing import TypeGuard
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _mask_secret(value: str | None, visible_chars: int = 4) -> str:
    """Mask a secret value, showing only the first few characters."""
    if not value:
        return "(empty)"
    if len(value) <= visible_chars:
        return "***"
    return f"{value[:visible_chars]}...***"


def _is_gemini_model(model_name: str | None) -> bool:
    """Return True when a model spec uses Google Gemini directly (not via proxy)."""
    if not isinstance(model_name, str):
        return False
    lower = model_name.lower()
    # OpenAI-compat models routed through a proxy (e.g., Zeta) don't need GEMINI_API_KEY
    if lower.startswith("openai:"):
        return False
    return "gemini" in lower


def _is_openai_compat_model(model_name: str | None) -> TypeGuard[str]:
    """Return True when a model spec uses the repo's OpenAI-compatible path."""
    return isinstance(model_name, str) and model_name.lower().startswith("openai:")


def _openai_model_base_url(model_name: str | None, default: str) -> str | None:
    """Resolve an OpenAI-compatible model's explicit or configured base URL."""
    if not _is_openai_compat_model(model_name):
        return None
    raw = model_name.removeprefix("openai:")
    _, separator, inline_base_url = raw.partition("@")
    return inline_base_url if separator else default


def _credential_env_for_model(model_name: str | None, default: str) -> str | None:
    """Resolve the deployment credential required by one trusted model spec."""
    from agent.config.model_aliases import CredentialRef, credential_ref_for_base_url

    if isinstance(model_name, str) and model_name.startswith("deepseek:"):
        return CredentialRef.DEEPSEEK_API_KEY.name
    base_url = _openai_model_base_url(model_name, default)
    return credential_ref_for_base_url(base_url).name if base_url else None


def _is_local_base_url(base_url: str | None) -> bool:
    """Return True when a compat base URL targets a local/dev endpoint."""
    if not base_url:
        return False
    parsed = urlparse(base_url)
    return parsed.hostname in {"localhost", "127.0.0.1"}


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    # API Keys
    deepseek_api_key: str = Field(
        default="", description="DeepSeek API key (required when fallback is enabled)"
    )
    mimo_api_key: str = Field(default="", description="MiMo API key (required)")
    gemini_api_key: str = Field(default="", description="Gemini API key for LLM agents")
    openai_compat_api_key: str = Field(
        default="",
        description="API key for the OpenAI-compatible fallback provider",
    )

    # API Endpoints
    anitabi_api_url: str = Field(
        default="https://api.anitabi.cn/bangumi", description="Anitabi API base URL"
    )
    catalog_api_url: str = Field(
        default="http://localhost:8787",
        description="Catalog service base URL (read path for resolved spot data)",
    )

    # Optional Google Cloud configuration used by Google-backed integrations.
    google_cloud_project: str | None = Field(
        default=None,
        description="Google Cloud project ID",
    )
    google_application_credentials: str | None = Field(
        default=None,
        description="Path to service account key",
    )

    # Application Settings
    app_env: str = Field(default="development", description="Application environment")
    log_level: str = Field(default="INFO", description="Logging level")
    debug: bool = Field(default=False, description="Debug mode")
    max_retries: int = Field(default=3, description="Maximum API retry attempts")
    timeout_seconds: int = Field(
        default=120, description="API request timeout (reasoning models need longer)"
    )
    agent_deadline: float = Field(
        default=100.0, gt=0, description="Whole-run agent deadline in seconds"
    )
    model_attempt_timeout: float = Field(
        default=45.0, gt=0, description="Per-provider model attempt timeout in seconds"
    )
    service_host: str = Field(default="0.0.0.0", description="HTTP service bind host")
    service_port: int = Field(default=8080, description="HTTP service bind port")
    observability_service_name: str = Field(
        default="animichi-runtime",
        description="Service name reported to observability backends",
    )
    observability_service_version: str = Field(
        default="0.1.0",
        description="Service version reported to observability backends",
    )
    # Cache Settings
    cache_ttl_seconds: int = Field(default=3600, description="Cache TTL in seconds")
    use_cache: bool = Field(default=True, description="Enable caching")

    # Output Paths
    output_dir: Path = Field(default=Path("outputs"), description="Output directory")
    template_dir: Path = Field(
        default=Path("templates"), description="Template directory"
    )

    # Rate Limiting
    rate_limit_calls: int = Field(default=100, description="Rate limit calls")
    rate_limit_period_seconds: int = Field(default=60, description="Rate limit period")

    # Supabase
    supabase_url: str = Field(default="", description="Supabase project URL")
    supabase_anon_key: str = Field(default="", description="Supabase anon key")
    supabase_service_role_key: str = Field(
        default="", description="Supabase service role key"
    )
    supabase_db_url: str = Field(
        default="", description="Direct Postgres DSN for asyncpg"
    )

    # Session storage (in-memory only)

    # Agent model
    default_agent_model: str = Field(
        default="openai:mimo-v2.5@https://api.xiaomimimo.com/v1",
        description="Default primary LLM model (MiMo V2.5)",
    )
    # Temporarily MiMo-only: the DeepSeek fallback is disabled pending a DeepSeek
    # account recharge (402 Insufficient Balance). Re-enable by setting this back to
    # `deepseek:deepseek-v4-flash` (the key + worker wiring are already provisioned).
    fallback_agent_model: str | None = Field(
        default="",
        description="Optional fallback model; empty keeps the runtime MiMo-only",
    )
    openai_compat_base_url: str = Field(
        default="https://api.xiaomimimo.com/v1",
        description="Base URL for the OpenAI-compatible provider",
    )

    # Migrations are managed by Supabase CLI (supabase db push).
    # No application-level migration runner needed.

    # CORS
    cors_allowed_origin: str = Field(
        default="*",
        description="Allowed CORS origin. Set to actual domain in production.",
    )

    @field_validator("cors_allowed_origin")
    @classmethod
    def validate_cors_origin(cls, v: str, info: object) -> str:
        """Reject wildcard CORS in production."""
        # info.data is available during model validation with all prior fields
        data = getattr(info, "data", {})
        app_env = (
            data.get("app_env", "development")
            if isinstance(data, dict)
            else "development"
        )
        if v == "*" and str(app_env).lower() == "production":
            raise ValueError(
                "cors_allowed_origin must not be '*' in production. "
                "Set CORS_ALLOWED_ORIGIN to your actual domain."
            )
        return v

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level is valid."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v = v.upper()
        if v not in valid_levels:
            raise ValueError(f"Invalid log level: {v}. Must be one of {valid_levels}")
        return v

    @model_validator(mode="after")
    def validate_model_timeout_budget(self) -> "Settings":
        """Reserve wall-clock margin after two sequential provider attempts."""
        if 2 * self.model_attempt_timeout >= self.agent_deadline * 0.95:
            raise ValueError(
                "two model_attempt_timeout budgets plus 5% margin must fit "
                "inside agent_deadline"
            )
        return self

    @model_validator(mode="after")
    def validate_required_env(self) -> "Settings":
        """Fail fast with clear errors if critical env vars are missing."""
        missing: list[str] = []
        if not self.supabase_db_url:
            missing.append("SUPABASE_DB_URL")
        missing.extend(
            credential
            for credential in self._required_model_credentials()
            if not self._has_api_key(credential)
        )
        if missing:
            raise ValueError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Check your .env file or run from the project root."
            )
        return self

    def _required_model_credentials(self) -> list[str]:
        required: list[str] = []
        for model_name in (self.default_agent_model, self.fallback_agent_model):
            credential = _credential_env_for_model(
                model_name, self.openai_compat_base_url
            )
            if credential is not None and credential not in required:
                required.append(credential)
        return required

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.app_env.lower() == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.app_env.lower() == "development"

    def get_runtime_config(self) -> dict[str, str | int | float | bool]:
        """Get non-secret runtime configuration (safe to log).

        Returns:
            Dictionary of runtime config values that can be safely logged.
        """
        return {
            "app_env": self.app_env,
            "log_level": self.log_level,
            "debug": self.debug,
            "service_host": self.service_host,
            "service_port": self.service_port,
            "max_retries": self.max_retries,
            "timeout_seconds": self.timeout_seconds,
            "agent_deadline": self.agent_deadline,
            "model_attempt_timeout": self.model_attempt_timeout,
            "cache_ttl_seconds": self.cache_ttl_seconds,
            "use_cache": self.use_cache,
            "google_cloud_project": self.google_cloud_project or "(not set)",
            "gcp_auth_mode": "service_account" if self.uses_service_account else "adc",
            "default_agent_model": self.default_agent_model,
            "fallback_agent_model": self.fallback_agent_model or "(not set)",
            "openai_compat_base_url": self.openai_compat_base_url,
        }

    def get_feature_flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature flag names to their boolean values.
        """
        return {
            "use_cache": self.use_cache,
            "debug": self.debug,
        }

    def get_secrets(self) -> dict[str, str]:
        """Get masked secret information (safe to log for debugging).

        Returns:
            Dictionary of secret names to their masked values.
        """
        return {
            "deepseek_api_key": _mask_secret(self.deepseek_api_key),
            "mimo_api_key": _mask_secret(self.mimo_api_key),
            "gemini_api_key": _mask_secret(self.gemini_api_key),
            "openai_compat_api_key": _mask_secret(self.openai_compat_api_key),
            "google_application_credentials": _mask_secret(
                self.google_application_credentials
            ),
        }

    def validate_api_keys(self) -> list[str]:
        """Validate required API keys are present."""
        missing: list[str] = []
        all_models = [
            self.default_agent_model,
            self.fallback_agent_model,
        ]
        uses_gemini = any(_is_gemini_model(m) for m in all_models)
        if uses_gemini and not self.gemini_api_key:
            missing.append("GEMINI_API_KEY")
        for model_name in all_models:
            issue = self._model_api_key_issue(model_name)
            if issue is not None and issue not in missing:
                missing.append(issue)
        return missing

    def _model_api_key_issue(self, model_name: str | None) -> str | None:
        base_url = _openai_model_base_url(model_name, self.openai_compat_base_url)
        if _is_openai_compat_model(model_name) and not base_url:
            return "OPENAI_COMPAT_BASE_URL"
        credential_env = _credential_env_for_model(
            model_name, self.openai_compat_base_url
        )
        if credential_env == "OPENAI_COMPAT_API_KEY" and _is_local_base_url(base_url):
            return None
        return (
            credential_env
            if credential_env and not self._has_api_key(credential_env)
            else None
        )

    def _has_api_key(self, credential_env: str) -> bool:
        values = {
            "DEEPSEEK_API_KEY": self.deepseek_api_key,
            "MIMO_API_KEY": self.mimo_api_key,
            "OPENAI_COMPAT_API_KEY": self.openai_compat_api_key,
        }
        return bool(values.get(credential_env))

    def validate_gcp_config(self) -> list[str]:
        """Validate GCP configuration.

        Returns:
            List of missing/invalid configuration items.

        This check only validates whether project-level Google integrations have
        enough configuration to run.
        """
        issues = []
        if not self.google_cloud_project:
            issues.append("GOOGLE_CLOUD_PROJECT is required")
        return issues

    @property
    def uses_service_account(self) -> bool:
        """Check if using service account authentication (production mode)."""
        return bool(self.google_application_credentials)

    @property
    def uses_adc(self) -> bool:
        """Check if using Application Default Credentials (local dev mode)."""
        return not self.google_application_credentials

    @model_validator(mode="after")
    def _warn_missing_api_keys(self) -> "Settings":
        """Warn about missing API keys at startup (non-blocking)."""
        missing = self.validate_api_keys()
        if missing:
            warnings.warn(
                f"Missing API keys: {', '.join(missing)}. Some features may not work.",
                UserWarning,
                stacklevel=2,
            )
        return self

    def __repr__(self) -> str:
        """Return string representation with masked secrets."""
        return (
            f"Settings("
            f"app_env={self.app_env!r}, "
            f"debug={self.debug}, "
            f"log_level={self.log_level!r}, "
            f"deepseek_api_key={_mask_secret(self.deepseek_api_key)}, "
            f"mimo_api_key={_mask_secret(self.mimo_api_key)}, "
            f"gemini_api_key={_mask_secret(self.gemini_api_key)}, "
            f"openai_compat_api_key={_mask_secret(self.openai_compat_api_key)}"
            f")"
        )

    def __str__(self) -> str:
        """Return string representation with masked secrets."""
        return self.__repr__()


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
