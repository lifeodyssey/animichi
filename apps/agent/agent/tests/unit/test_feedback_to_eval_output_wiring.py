"""Wiring tests for feedback_to_eval.main_async()'s --output path guard.

These exercise the real entry point (`main_async()`), not
`resolve_output_path()` directly — that function already has its own unit
tests (test_safe_output_path.py). The point here is the call site: does
`main_async()` actually reject a traversal attempt and actually write a
legal path to the expected location.
"""

import argparse
from datetime import UTC, datetime
from pathlib import Path

import pytest

from agent.scripts import feedback_to_eval
from agent.scripts.feedback_to_eval import main_async

_FAKE_ROW = {
    "query_text": "sample query",
    "intent": "search",
    "comment": None,
    "created_at": datetime(2026, 1, 1, tzinfo=UTC),
}


@pytest.fixture(autouse=True)
def _stub_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch(dsn: str, since: str) -> list[dict]:
        return [_FAKE_ROW]

    monkeypatch.setattr(feedback_to_eval, "fetch_bad_feedback", _fake_fetch)
    monkeypatch.setenv("SUPABASE_DB_URL", "postgresql://test:test@localhost/test")


async def test_main_async_rejects_output_path_that_escapes_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    args = argparse.Namespace(since="2026-01-01", output="../../etc/passwd")
    with pytest.raises(ValueError, match="escapes the working directory"):
        await main_async(args)


async def test_main_async_rejects_absolute_output_path_outside_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    args = argparse.Namespace(since="2026-01-01", output="/etc/passwd")
    with pytest.raises(ValueError, match="escapes the working directory"):
        await main_async(args)


async def test_main_async_writes_legal_output_path_to_expected_location(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    args = argparse.Namespace(
        since="2026-01-01", output="cases/feedback_regression.json"
    )
    await main_async(args)

    written = tmp_path / "cases" / "feedback_regression.json"
    assert written.exists()
    assert "sample query" in written.read_text()
