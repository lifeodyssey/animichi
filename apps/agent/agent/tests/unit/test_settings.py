"""Unit tests for application settings and configuration."""

import pytest

from agent.config.settings import Settings


class TestGCPConfiguration:
    """Test GCP configuration validation."""

    def test_runtime_config_includes_service_fields(self):
        """Test that runtime config includes service deployment fields."""
        settings = Settings(
            google_maps_api_key="test_key",
            service_host="127.0.0.1",
            service_port=9000,
        )
        config = settings.get_runtime_config()
        assert config["service_host"] == "127.0.0.1"
        assert config["service_port"] == 9000


class TestAPIKeyValidation:
    """Test API key validation."""

    def test_prod_default_hard_requires_mimo_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DEFAULT_AGENT_MODEL")
        monkeypatch.delenv("FALLBACK_AGENT_MODEL")
        monkeypatch.delenv("DEEPSEEK_API_KEY")
        with pytest.raises(ValueError, match="MIMO_API_KEY"):
            Settings(_env_file=None, mimo_api_key="")

    def test_explicit_fallback_hard_requires_deepseek_key(self):
        with pytest.raises(ValueError, match="DEEPSEEK_API_KEY"):
            Settings(
                fallback_agent_model="deepseek:deepseek-v4-flash",
                mimo_api_key="mimo-key",
                deepseek_api_key="",
            )

    def test_unresolved_deepseek_key_is_not_required(self):
        settings = Settings(
            default_agent_model=("openai:mimo-v2.5@https://api.xiaomimimo.com/v1"),
            fallback_agent_model=None,
            mimo_api_key="mimo-key",
            deepseek_api_key="",
        )

        assert settings.deepseek_api_key == ""

    def test_localhost_compat_model_does_not_require_api_key(self) -> None:
        settings = Settings(
            _env_file=None,
            default_agent_model="openai:local@http://localhost:1234/v1",
            fallback_agent_model=None,
            openai_compat_api_key="",
            supabase_db_url="postgresql://local/test",
        )

        assert settings.validate_api_keys() == []

    def test_remote_compat_model_hard_requires_api_key(self) -> None:
        with pytest.raises(ValueError, match="OPENAI_COMPAT_API_KEY"):
            Settings(
                _env_file=None,
                default_agent_model="openai:remote@https://models.example/v1",
                fallback_agent_model=None,
                openai_compat_api_key="",
                supabase_db_url="postgresql://local/test",
            )

    def test_prod_default_requires_mimo_not_deepseek(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DEFAULT_AGENT_MODEL")
        monkeypatch.delenv("FALLBACK_AGENT_MODEL")
        monkeypatch.delenv("DEEPSEEK_API_KEY")
        monkeypatch.setenv("MIMO_API_KEY", "prod-mimo-key")

        settings = Settings(_env_file=None)

        assert settings.fallback_agent_model == ""
        assert settings.validate_api_keys() == []
        missing_mimo = settings.model_copy(update={"mimo_api_key": ""})
        assert "MIMO_API_KEY" in missing_mimo.validate_api_keys()

    def test_validate_api_keys_deepseek_inline_url(self):
        """DeepSeek with inline @url uses its provider setting, not compat config."""
        settings = Settings(
            default_agent_model="openai:deepseek-v4-pro@https://api.deepseek.com",
        )
        missing = settings.validate_api_keys()
        # Inline @url models resolve through deepseek_api_key, not the generic
        # openai_compat_* settings, so no compat-key item is missing here.
        assert "OPENAI_COMPAT_BASE_URL" not in missing
        assert "OPENAI_COMPAT_API_KEY" not in missing

    def test_validate_api_keys_all_present(self):
        """Test that no keys are reported missing when all are set."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="compat_key",
            openai_compat_base_url="https://api.univibe.cc/openai",
        )
        missing = settings.validate_api_keys()
        assert missing == []

    def test_get_runtime_config_includes_provider_fields(self):
        """Runtime config should expose non-secret provider settings."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="compat_key",
            default_agent_model="openai:deepseek-v4-pro@https://api.deepseek.com",
            fallback_agent_model="openai:gpt-5.4",
            openai_compat_base_url="https://api.univibe.cc/openai",
        )
        config = settings.get_runtime_config()
        assert (
            config["default_agent_model"]
            == "openai:deepseek-v4-pro@https://api.deepseek.com"
        )
        assert config["fallback_agent_model"] == "openai:gpt-5.4"
        assert config["openai_compat_base_url"] == "https://api.univibe.cc/openai"
