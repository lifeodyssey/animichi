"""Regression tests for best-effort purge job summaries (issue #535)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import NoReturn, Protocol
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.scripts import purge_anon_quota_counts, purge_anonymous_sessions

_DB = MagicMock()
_PRIVATE_ERROR = "private-summary-path"
_PROGRAMMING_ERROR = "summary-programming-error"
_PURGE_ERROR = "purge-database-error"


class _SummaryModule(Protocol):
    _write_step_summary: Callable[..., None]


class _Client:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn

    async def __aenter__(self) -> MagicMock:
        return _DB

    async def __aexit__(self, *exc: object) -> None:
        return None


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        supabase_db_url="postgresql://local/test",
        anon_daily_message_count_retention_days=30,
        anonymous_session_retention_days=30,
    )


def _raise_summary_error(*args: object, **kwargs: object) -> NoReturn:
    raise OSError(_PRIVATE_ERROR)


def _raise_programming_error(*args: object, **kwargs: object) -> NoReturn:
    raise RuntimeError(_PROGRAMMING_ERROR)


def _fail_summary_open(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", "/private/summary")
    monkeypatch.setattr(Path, "open", _raise_summary_error)


def _fail_summary_with_programming_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", "/private/summary")
    monkeypatch.setattr(Path, "open", _raise_programming_error)


def _configure_quota_main(monkeypatch: pytest.MonkeyPatch, purge: AsyncMock) -> None:
    monkeypatch.setattr(purge_anon_quota_counts, "purge_anon_quota_counts", purge)
    monkeypatch.setattr(purge_anon_quota_counts, "SupabaseClient", _Client)
    monkeypatch.setattr(purge_anon_quota_counts, "get_purge_cron_settings", _settings)


def _configure_session_main(monkeypatch: pytest.MonkeyPatch, purge: AsyncMock) -> None:
    monkeypatch.setattr(purge_anonymous_sessions, "purge_anonymous_sessions", purge)
    monkeypatch.setattr(purge_anonymous_sessions, "SupabaseClient", _Client)
    monkeypatch.setattr(purge_anonymous_sessions, "get_purge_cron_settings", _settings)


def _spy_summary(monkeypatch: pytest.MonkeyPatch, module: _SummaryModule) -> MagicMock:
    summary = MagicMock(wraps=module._write_step_summary)
    monkeypatch.setattr(module, "_write_step_summary", summary)
    return summary


def test_quota_summary_error_is_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    _fail_summary_open(monkeypatch)
    log = MagicMock()
    monkeypatch.setattr(purge_anon_quota_counts, "logger", log)
    purge_anon_quota_counts._write_step_summary(count=4, dry_run=False)
    assert _PRIVATE_ERROR not in str(log.mock_calls)
    log.warning.assert_called_once_with(
        "anon_quota_step_summary_write_failed", error_type="OSError"
    )


def test_session_summary_error_is_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    _fail_summary_open(monkeypatch)
    log = MagicMock()
    monkeypatch.setattr(purge_anonymous_sessions, "logger", log)
    report = purge_anonymous_sessions.PurgeReport(purged=4, raced=1, failed=0)
    purge_anonymous_sessions._write_step_summary(report)
    assert _PRIVATE_ERROR not in str(log.mock_calls)
    log.warning.assert_called_once_with(
        "anonymous_session_step_summary_write_failed", error_type="OSError"
    )


def test_quota_summary_propagates_non_os_error(monkeypatch: pytest.MonkeyPatch) -> None:
    _fail_summary_with_programming_error(monkeypatch)
    with pytest.raises(RuntimeError, match=_PROGRAMMING_ERROR):
        purge_anon_quota_counts._write_step_summary(count=4, dry_run=False)


def test_session_summary_propagates_non_os_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _fail_summary_with_programming_error(monkeypatch)
    report = purge_anonymous_sessions.PurgeReport(purged=4, raced=1, failed=0)
    with pytest.raises(RuntimeError, match=_PROGRAMMING_ERROR):
        purge_anonymous_sessions._write_step_summary(report)


async def test_quota_main_survives_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    purge = AsyncMock(return_value=4)
    _configure_quota_main(monkeypatch, purge)
    summary = _spy_summary(monkeypatch, purge_anon_quota_counts)
    _fail_summary_open(monkeypatch)
    await purge_anon_quota_counts._main(dry_run=False)
    summary.assert_called_once_with(count=4, dry_run=False)


async def test_session_main_survives_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    report = purge_anonymous_sessions.PurgeReport(purged=4, raced=1, failed=0)
    purge = AsyncMock(return_value=report)
    _configure_session_main(monkeypatch, purge)
    summary = _spy_summary(monkeypatch, purge_anonymous_sessions)
    _fail_summary_open(monkeypatch)
    await purge_anonymous_sessions._main(dry_run=False)
    summary.assert_called_once_with(report)


async def test_quota_main_propagates_purge_os_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    purge = AsyncMock(side_effect=OSError(_PURGE_ERROR))
    _configure_quota_main(monkeypatch, purge)
    with pytest.raises(OSError, match=_PURGE_ERROR):
        await purge_anon_quota_counts._main(dry_run=False)


async def test_session_main_propagates_purge_os_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    purge = AsyncMock(side_effect=OSError(_PURGE_ERROR))
    _configure_session_main(monkeypatch, purge)
    with pytest.raises(OSError, match=_PURGE_ERROR):
        await purge_anonymous_sessions._main(dry_run=False)
