"""Regression tests for issue #508.

Round 1 of this fix added a `ContextVar`-scoped bypass of the model-credential
check directly on `agent.config.settings.Settings`. Independent review (twice)
proved that bypass leaked into `get_settings()`'s `lru_cache`d singleton: a
reentrant import chain (`Settings.__init__` -> `_warn_missing_api_keys` ->
`validate_api_keys()` -> `_model_api_key_issue()` -> `_credential_env_for_model()`
-> first import of `agent.config.model_aliases`, whose module-level
`MODEL_ALIASES = _build_aliases()` itself calls `get_settings()`) cached the
bypassed, model-credential-missing instance as the process-wide singleton —
so the *next* caller of `get_settings()` anywhere in the process (including
the main service) silently got an unvalidated `Settings` back.

`PurgeCronSettings` (agent/config/cron_settings.py) replaces that bypass with
a wholly separate class that never imports `agent.config.model_aliases`, so
this reentrant path cannot exist. These tests pin both properties: the new
class works standalone, and it provably cannot touch `get_settings()`.

Uses `agent.config.settings.get_settings` directly (not `agent.config.get_settings`,
which `agent/tests/unit/conftest.py`'s autouse fixture mocks for the duration of
every unit test) so these assertions exercise the real singleton, not the mock.
"""

from __future__ import annotations

import inspect

import pytest

from agent.config import cron_settings
from agent.config.cron_settings import get_purge_cron_settings
from agent.config.settings import get_settings


class TestPurgeCronSettings:
    def test_succeeds_with_only_supabase_db_url_and_no_model_credential(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://local/test")
        monkeypatch.setenv("MIMO_API_KEY", "")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "")
        monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "")

        settings = get_purge_cron_settings()

        assert settings.supabase_db_url == "postgresql://local/test"

    def test_still_hard_requires_supabase_db_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_DB_URL", "")

        with pytest.raises(ValueError, match="SUPABASE_DB_URL"):
            get_purge_cron_settings()

    def test_never_imports_model_aliases(self) -> None:
        """Structural guard against reintroducing the leak this file exists
        to prevent: `cron_settings.py` must never gain a dependency on
        `agent.config.model_aliases` — that import is the entire reentrant
        chain that poisoned `get_settings()` in round 1 of this fix."""
        source = inspect.getsource(cron_settings)
        assert "model_aliases" not in source


class TestGetSettingsSingletonIsUnaffected:
    """The core regression (issue #508, review round 2): constructing
    `PurgeCronSettings` with no model credential in the environment must
    leave `get_settings()`'s cached singleton completely untouched.

    `get_settings.cache_clear()` runs immediately after the env is set, in
    every test here — not just at import time — because a *different*
    autouse fixture (`agent/tests/unit/conftest.py`'s `setup_test_environment`)
    incidentally triggers the real `get_settings()` on the first call in the
    process (importing `agent.agents.translation`, which imports
    `agent.config.model_aliases`, whose module-level alias build calls it).
    That happens at most once per process, but exactly when depends on test
    order; clearing right before each assertion makes these tests order-
    independent instead of accidentally relying on that one-time timing.
    """

    def test_get_settings_cache_stays_empty_after_a_purge_cron_settings_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://local/test")
        monkeypatch.setenv("MIMO_API_KEY", "")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "")
        monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "")
        get_settings.cache_clear()
        assert get_settings.cache_info().currsize == 0

        get_purge_cron_settings()

        assert get_settings.cache_info().currsize == 0

    @pytest.mark.filterwarnings("ignore::UserWarning")
    def test_get_settings_still_raises_after_a_purge_cron_settings_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://local/test")
        monkeypatch.delenv("DEFAULT_AGENT_MODEL", raising=False)
        monkeypatch.delenv("FALLBACK_AGENT_MODEL", raising=False)
        monkeypatch.setenv("MIMO_API_KEY", "")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "")
        get_settings.cache_clear()

        get_purge_cron_settings()

        with pytest.raises(ValueError, match="MIMO_API_KEY"):
            get_settings()
