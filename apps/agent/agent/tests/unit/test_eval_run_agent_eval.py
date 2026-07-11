from __future__ import annotations

import sys

import pytest

from agent.tests.eval.run_agent_eval import _parse_model_arg


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["run_agent_eval.py", "--eval-model"], None),
        (["run_agent_eval.py", "--eval-model", "openai:test"], "openai:test"),
        (["run_agent_eval.py", "--eval-model=openai:test"], "openai:test"),
        (["run_agent_eval.py"], None),
    ],
)
def test_parse_model_arg(
    monkeypatch: pytest.MonkeyPatch, argv: list[str], expected: str | None
) -> None:
    monkeypatch.setattr(sys, "argv", argv)
    assert _parse_model_arg() == expected
