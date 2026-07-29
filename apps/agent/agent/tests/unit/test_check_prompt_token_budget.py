"""Unit tests for the SD-17 prompt token-budget CI check.

``apps/agent/scripts/check_prompt_token_budget.py`` lives outside the ``agent``
package (a standalone CI/dev script, like the root ``scripts/`` shell tools),
so it is loaded here via its file path rather than a normal package import.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

_SCRIPT_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "check_prompt_token_budget.py"
)
_INSTRUCTIONS_PATH = (
    Path(__file__).resolve().parents[2] / "agents" / "animichi_agent.py"
)


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "check_prompt_token_budget", _SCRIPT_PATH
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_MODULE = _load_script()


def test_count_tokens_grows_with_more_text() -> None:
    short = _MODULE.count_tokens("hello")
    longer = _MODULE.count_tokens("hello " * 50)
    assert 0 < short < longer


def test_check_budget_accepts_at_or_under_the_ceiling() -> None:
    assert _MODULE.check_budget(2000, budget=2000) is True
    assert _MODULE.check_budget(100, budget=2000) is True


def test_check_budget_rejects_over_the_ceiling() -> None:
    assert _MODULE.check_budget(2001, budget=2000) is False


def test_extract_static_instructions_pulls_the_literal_block() -> None:
    # Mirrors animichi_agent.py's own backslash-newline continuation right
    # after the opening triple-quote, which a raw substring slice would
    # miscount (the backslash-newline must be suppressed, not counted).
    source = 'x = 1\n_INSTRUCTIONS = """\\\nhello\nworld"""\ny = 2\n'
    assert _MODULE.extract_static_instructions(source) == "hello\nworld"


def test_current_static_prompt_fits_within_the_sd17_budget() -> None:
    source = _INSTRUCTIONS_PATH.read_text(encoding="utf-8")
    instructions = _MODULE.extract_static_instructions(source)
    token_count = _MODULE.count_tokens(instructions)
    assert _MODULE.check_budget(token_count) is True


def test_main_returns_zero_for_the_checked_in_prompt() -> None:
    assert _MODULE.main() == 0


def test_main_fails_loudly_when_over_budget(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(_MODULE, "check_budget", lambda *_args, **_kwargs: False)

    exit_code = _MODULE.main()

    assert exit_code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "EXCEEDS budget" in captured.err
