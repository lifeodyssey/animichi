"""Unit-test-only environment and settings fixtures."""

import os
from unittest.mock import patch

import pytest

os.environ.setdefault("DEEPSEEK_API_KEY", "test-key")
os.environ.setdefault("MIMO_API_KEY", "test-key")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test:test@localhost:5432/test")


@pytest.fixture
def mock_settings(tmp_path_factory: pytest.TempPathFactory):
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
        default_agent_model="deepseek:deepseek-v4-flash",
        openai_compat_base_url="https://api.xiaomimimo.com/v1",
        output_dir=output_dir,
        template_dir=template_dir,
    )


@pytest.fixture(autouse=True)
def setup_test_environment(monkeypatch, mock_settings):
    """Apply fake credentials and mock settings only to unit tests."""
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("MIMO_API_KEY", "test-key")
    with patch("agent.config.get_settings", return_value=mock_settings):
        yield
