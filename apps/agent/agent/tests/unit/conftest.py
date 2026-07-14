"""Unit-test-only environment and settings fixtures."""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import TYPE_CHECKING
from unittest.mock import patch

import pytest
from pydantic_ai import models
from pydantic_ai.models.test import TestModel

if TYPE_CHECKING:
    from agent.config import Settings

os.environ.setdefault("DEEPSEEK_API_KEY", "test-key")
os.environ.setdefault("MIMO_API_KEY", "test-key")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")


@pytest.fixture
def mock_settings(tmp_path_factory: pytest.TempPathFactory) -> Settings:
    """Build deterministic application settings for unit tests."""
    from agent.config import Settings

    output_dir = tmp_path_factory.mktemp("test_outputs")
    template_dir = tmp_path_factory.mktemp("test_templates")
    return Settings(
        anitabi_api_url="https://test.anitabi.com/api",
        app_env="test",
        log_level="DEBUG",
        debug=True,
        max_retries=1,
        timeout_seconds=5,
        cache_ttl_seconds=60,
        use_cache=False,
        # Settings reads .env for omitted fields, so pin the complete model layer.
        default_agent_model="deepseek:deepseek-v4-flash",
        fallback_agent_model=None,
        openai_compat_api_key="test-key",
        openai_compat_base_url="https://api.xiaomimimo.com/v1",
        output_dir=output_dir,
        template_dir=template_dir,
    )


@pytest.fixture(autouse=True)
def setup_test_environment(
    monkeypatch: pytest.MonkeyPatch, mock_settings: Settings
) -> Iterator[None]:
    """Make unit settings and translation model deterministic and offline."""
    from agent.agents.translation import translation_agent

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("MIMO_API_KEY", "test-key")
    test_model = TestModel(call_tools=[], custom_output_text="test translation")
    with (
        patch("agent.config.get_settings", return_value=mock_settings),
        translation_agent.override(model=test_model),
    ):
        yield
