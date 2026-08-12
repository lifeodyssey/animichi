"""Unit tests for application settings and configuration."""

import pytest

from animichi.config.settings import Settings


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

    def test_prod_default_hard_requires_zen_go_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DEFAULT_AGENT_MODEL")
        monkeypatch.delenv("FALLBACK_AGENT_MODEL")
        monkeypatch.delenv("DEEPSEEK_API_KEY")
        monkeypatch.delenv("ZEN_GO_API_KEY")
        with pytest.raises(ValueError, match="ZEN_GO_API_KEY"):
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

    def test_prod_default_requires_zen_go_not_deepseek(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("DEFAULT_AGENT_MODEL")
        monkeypatch.delenv("FALLBACK_AGENT_MODEL")
        monkeypatch.delenv("DEEPSEEK_API_KEY")
        monkeypatch.delenv("MIMO_API_KEY", raising=False)
        monkeypatch.setenv("ZEN_GO_API_KEY", "prod-zen-go-key")

        settings = Settings(_env_file=None)

        assert settings.fallback_agent_model == ""
        assert settings.default_agent_model == (
            "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"
        )
        assert settings.validate_api_keys() == []
        missing_zen = settings.model_copy(update={"zen_go_api_key": ""})
        assert "ZEN_GO_API_KEY" in missing_zen.validate_api_keys()

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
            openai_compat_api_key="compat_key",
            openai_compat_base_url="https://api.univibe.cc/openai",
            zen_go_api_key="zen-go-key",
        )
        missing = settings.validate_api_keys()
        assert missing == []

    def test_get_runtime_config_includes_provider_fields(self):
        """Runtime config should expose non-secret provider settings."""
        settings = Settings(
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


class TestAgentDatabaseUrl:
    """Container DSN resolution (#912 follow-up): AGENT_SVC_DATABASE_URL wins
    over the legacy SUPABASE_DB_URL when both are set, and either one
    satisfies the required-env check."""

    def test_agent_svc_dsn_wins_over_supabase(self) -> None:
        settings = Settings(
            _env_file=None,
            mimo_api_key="k",
            supabase_db_url="postgresql://legacy/db",
            agent_svc_database_url="postgresql://agent_svc@neon/db",
        )
        assert settings.database_url == "postgresql://agent_svc@neon/db"

    def test_supabase_dsn_is_fallback_when_no_agent_dsn(self) -> None:
        settings = Settings(
            _env_file=None, mimo_api_key="k", supabase_db_url="postgresql://legacy/db"
        )
        assert settings.database_url == "postgresql://legacy/db"

    def test_agent_dsn_alone_satisfies_required_env(self) -> None:
        settings = Settings(
            _env_file=None,
            mimo_api_key="k",
            agent_svc_database_url="postgresql://agent_svc@neon/db",
        )
        assert settings.database_url == "postgresql://agent_svc@neon/db"

    def test_missing_both_dsns_raises(self) -> None:
        with pytest.raises(ValueError, match="AGENT_SVC_DATABASE_URL"):
            Settings(
                _env_file=None,
                mimo_api_key="k",
                supabase_db_url="",
                agent_svc_database_url="",
            )
