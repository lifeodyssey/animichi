"""Warning contracts for application settings (#535)."""

import pytest

from animichi.config.settings import Settings


def test_fallback_validation_warns_and_reports_missing_compat_url() -> None:
    with pytest.warns(UserWarning, match="OPENAI_COMPAT_BASE_URL"):
        settings = Settings(
            fallback_agent_model="openai:gpt-5.4",
            openai_compat_base_url="",
            openai_compat_api_key="",
        )
    assert "OPENAI_COMPAT_BASE_URL" in settings.validate_api_keys()
