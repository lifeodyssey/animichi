"""Wiring tests for eval_feedback_miner.run()'s --output path guard.

These exercise the real entry point (`run()`), not `resolve_output_path()`
directly — that function already has its own unit tests
(test_safe_output_path.py). The point here is the call site: does `run()`
actually reject a traversal attempt and actually write a legal path to the
expected location.
"""

from pathlib import Path

import pytest

from agent.tools import eval_feedback_miner
from agent.tools.eval_feedback_miner import _PromptSuggestion, run

_FAKE_SUGGESTION = _PromptSuggestion(
    issue_summary="test issue",
    affected_queries=["q1"],
    suggested_prompt_change="change X",
    confidence=0.5,
)


@pytest.fixture(autouse=True)
def _stub_mine(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_mine(
        limit: int = 100, model_id: str | None = None
    ) -> list[_PromptSuggestion]:
        return [_FAKE_SUGGESTION]

    monkeypatch.setattr(eval_feedback_miner, "mine", _fake_mine)


async def test_run_rejects_output_path_that_escapes_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match="escapes the working directory"):
        await run(output="../../etc/passwd")


async def test_run_rejects_absolute_output_path_outside_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match="escapes the working directory"):
        await run(output="/etc/passwd")


async def test_run_writes_legal_output_path_to_expected_location(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    await run(output="suggestions.md")

    written = tmp_path / "suggestions.md"
    assert written.exists()
    assert "test issue" in written.read_text()
