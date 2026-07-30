"""Regression test for issue #508.

The anonymous-session and anon-quota-count purge crons construct settings via
`get_purge_cron_settings()` and must reach the database call even when no
model credential (MIMO_API_KEY/DEEPSEEK_API_KEY/OPENAI_COMPAT_API_KEY) is
present in the environment — exactly the environment
`.github/workflows/purge-anonymous-sessions.yml` and
`purge-anon-quota-counts.yml` actually run in. Before the fix, `_main()`
raised constructing `Settings` (missing MIMO_API_KEY) before ever reaching
`SupabaseClient`; this pins that it now gets past construction and attempts
the database call instead.

Each assertion below is killed by a distinct condition, not by incidental
state: `_ReachedDatabase` carries the DSN read from *this test's own*
monkeypatched env (not a value some earlier test happened to leave cached),
so a regression that made `_main` read a stale or wrong DSN would fail the
`match=` on the exception message, not just "raised vs. didn't."
"""

from __future__ import annotations

import pytest

from agent.config.settings import get_settings
from agent.scripts import purge_anon_quota_counts, purge_anonymous_sessions


class _ReachedDatabase(Exception):
    """Raised the moment `_main` opens `SupabaseClient` — proof it got past
    settings construction, not a real database error."""


class _ExplodingSupabaseClient:
    """Stand-in for `SupabaseClient` that fails the instant it is entered."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    async def __aenter__(self) -> _ExplodingSupabaseClient:
        raise _ReachedDatabase(self._dsn)

    async def __aexit__(self, *exc: object) -> None:
        return None


@pytest.fixture(autouse=True)
def _no_model_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """The exact failure mode from issue #508: a DB-only cron running with
    no model credential anywhere in its environment.

    `get_settings.cache_clear()` runs last, after the env is set: another
    autouse fixture (`agent/tests/unit/conftest.py`'s `setup_test_environment`)
    incidentally calls the real (uncached-by-us) `get_settings()` during its
    own setup, with a transient env that predates this fixture's overrides —
    caching that stale instance would otherwise survive into the test body
    and mask a real regression (a script that goes back to calling
    `get_settings()`) behind a confusing stale-DSN mismatch instead of a
    clean settings-construction failure.
    """
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://local/test")
    monkeypatch.setenv("MIMO_API_KEY", "")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.setenv("OPENAI_COMPAT_API_KEY", "")
    get_settings.cache_clear()


async def test_purge_anonymous_sessions_reaches_the_database_without_a_model_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        purge_anonymous_sessions, "SupabaseClient", _ExplodingSupabaseClient
    )
    with pytest.raises(_ReachedDatabase, match="postgresql://local/test"):
        await purge_anonymous_sessions._main(dry_run=True)


async def test_purge_anon_quota_counts_reaches_the_database_without_a_model_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        purge_anon_quota_counts, "SupabaseClient", _ExplodingSupabaseClient
    )
    with pytest.raises(_ReachedDatabase, match="postgresql://local/test"):
        await purge_anon_quota_counts._main(dry_run=True)
