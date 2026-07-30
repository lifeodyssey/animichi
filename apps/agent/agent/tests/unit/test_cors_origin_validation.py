"""cors_allowed_origin validator coverage (issue #498 follow-up).

Before #498, `APP_ENV` was hardcoded to "production" for every deployed
Cloudflare environment, so this validator's `== "production"` check happened
to also cover staging by accident. Once APP_ENV correctly reports "staging"
for the staging environment, an `== "production"` check would stop firing
there — staging would silently accept a wildcard CORS origin. The fix widens
the check to `!= "development"`, so every non-development environment
(production, staging, and any future one) is held to the same strictness.
"""

from __future__ import annotations

import pytest

from agent.config.settings import Settings


def _build_settings(app_env: str, cors_allowed_origin: str) -> Settings:
    return Settings(
        app_env=app_env,
        cors_allowed_origin=cors_allowed_origin,
        fallback_agent_model=None,
    )


@pytest.mark.parametrize("app_env", ["production", "staging"])
def test_wildcard_cors_is_rejected_outside_development(app_env: str) -> None:
    with pytest.raises(ValueError, match="must not be '\\*' outside development"):
        _build_settings(app_env=app_env, cors_allowed_origin="*")


def test_wildcard_cors_is_allowed_in_development() -> None:
    settings = _build_settings(app_env="development", cors_allowed_origin="*")
    assert settings.cors_allowed_origin == "*"


@pytest.mark.parametrize("app_env", ["production", "staging", "development"])
def test_a_real_origin_is_always_accepted(app_env: str) -> None:
    settings = _build_settings(
        app_env=app_env, cors_allowed_origin="https://animichi.com"
    )
    assert settings.cors_allowed_origin == "https://animichi.com"


def test_the_check_is_case_insensitive_on_app_env() -> None:
    with pytest.raises(ValueError, match="must not be '\\*' outside development"):
        _build_settings(app_env="STAGING", cors_allowed_origin="*")
