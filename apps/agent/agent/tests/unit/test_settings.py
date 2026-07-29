"""Unit tests for application settings and configuration."""

import pytest

from agent.config.settings import Settings


class TestGCPConfiguration:
    """Test GCP configuration validation."""

    def test_validate_gcp_config_missing_project(self):
        """Test that missing GOOGLE_CLOUD_PROJECT is reported."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project=None,
        )
        issues = settings.validate_gcp_config()
        assert "GOOGLE_CLOUD_PROJECT is required" in issues

    def test_validate_gcp_config_with_project(self):
        """Test that valid GCP config passes validation."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project-id",
        )
        issues = settings.validate_gcp_config()
        assert len(issues) == 0

    def test_uses_service_account_when_credentials_set(self):
        """Test service account detection when credentials path is set."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
            google_application_credentials="/path/to/key.json",
        )
        assert settings.uses_service_account is True
        assert settings.uses_adc is False

    def test_uses_adc_when_no_credentials(self):
        """Test ADC detection when no credentials path is set."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
            google_application_credentials=None,
        )
        assert settings.uses_adc is True
        assert settings.uses_service_account is False

    def test_runtime_config_includes_gcp_info(self):
        """Test that runtime config includes GCP configuration."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project="my-project",
        )
        config = settings.get_runtime_config()
        assert "google_cloud_project" in config
        assert config["google_cloud_project"] == "my-project"
        assert "gcp_auth_mode" in config
        # gcp_auth_mode depends on environment (adc or service_account)
        assert config["gcp_auth_mode"] in ("adc", "service_account")

    def test_runtime_config_shows_not_set_for_missing_project(self):
        """Test that runtime config shows '(not set)' for missing project."""
        settings = Settings(
            google_maps_api_key="test_key",
            google_cloud_project=None,
        )
        config = settings.get_runtime_config()
        assert config["google_cloud_project"] == "(not set)"

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
            gemini_api_key="test-key",
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

        settings = Settings(_env_file=None, gemini_api_key="test-key")

        assert settings.fallback_agent_model == ""
        assert settings.validate_api_keys() == []
        missing_mimo = settings.model_copy(update={"mimo_api_key": ""})
        assert "MIMO_API_KEY" in missing_mimo.validate_api_keys()

    @pytest.mark.filterwarnings("ignore::UserWarning")
    def test_validate_api_keys_gemini_required_regardless_of_chat_model(self):
        """#502: GEMINI_API_KEY backs the always-mounted photo-search vision
        provider, not the chat model — it must be flagged missing even when
        no configured model mentions Gemini at all."""
        settings = Settings(
            default_agent_model="deepseek:deepseek-v4-flash",
            fallback_agent_model=None,
            gemini_api_key="",
        )
        assert "GEMINI_API_KEY" in settings.validate_api_keys()

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

    @pytest.mark.filterwarnings("ignore::UserWarning")
    def test_validate_api_keys_missing_openai_compat_when_fallback_enabled(self):
        """Fallback provider requires compat config when using openai fallback."""
        settings = Settings(
            gemini_api_key="test_key",
            fallback_agent_model="openai:gpt-5.4",
            openai_compat_base_url="",
            openai_compat_api_key="",
        )
        missing = settings.validate_api_keys()
        assert "OPENAI_COMPAT_BASE_URL" in missing

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

    def test_get_secrets_masks_openai_compat_key(self):
        """Secret debug info should mask the compat key too."""
        settings = Settings(
            gemini_api_key="test_key",
            openai_compat_api_key="sk-test-openai-compat",
        )
        secrets = settings.get_secrets()
        assert secrets["openai_compat_api_key"].endswith("***")
