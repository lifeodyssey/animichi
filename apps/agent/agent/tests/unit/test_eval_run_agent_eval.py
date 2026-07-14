from __future__ import annotations

import sys

import pytest
from pydantic_evals import Case
from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from agent.tests.eval import eval_gate_flow
from agent.tests.eval.eval_gate_flow import finish_cli_report, gate_exit_code
from agent.tests.eval.evaluators import AgentInput
from agent.tests.eval.exec_tiers import EvalTierTarget
from agent.tests.eval.run_agent_eval import (
    StreamingProgress,
    _parse_model_arg,
)


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


def test_streaming_progress_reports_completed_cases(
    capsys: pytest.CaptureFixture[str],
) -> None:
    progress = StreamingProgress(total=2)
    ok_input = AgentInput(query="ok", locale="en")
    error_input = AgentInput(query="error", locale="en")
    first = progress(Case(name="case-ok", inputs=ok_input))
    second = progress(Case(name="case-error", inputs=error_input))

    first_result = ReportCase(
        name="case-ok",
        inputs=ok_input,
        metadata=None,
        expected_output=None,
        output="done",
        metrics={},
        attributes={},
        scores={},
        labels={},
        assertions={},
        task_duration=0.1,
        total_duration=0.2,
    )
    failure = ReportCaseFailure(
        name="case-error",
        inputs=error_input,
        metadata=None,
        expected_output=None,
        error_message="boom\ncontinued",
        error_stacktrace="trace",
    )

    import asyncio

    asyncio.run(first.teardown(first_result))
    asyncio.run(second.teardown(failure))

    assert capsys.readouterr().err.splitlines() == [
        "[eval] id=case-ok result=pass completed=1/2 passed=1 failed=0",
        "[eval] id=case-error result=fail error=boom continued "
        "completed=2/2 passed=1 failed=1",
    ]


@pytest.mark.parametrize(
    ("failures", "expected"), [(None, 0), ([], 0), (["regression"], 1)]
)
def test_exit_code_matches_gate_verdict(
    failures: list[str] | None, expected: int
) -> None:
    assert gate_exit_code(failures) == expected


def test_capped_all_error_report_is_report_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = ReportCaseFailure(
        name="only-case",
        inputs=AgentInput(query="fail", locale="en"),
        metadata=None,
        expected_output=None,
        error_message="boom",
        error_stacktrace="trace",
    )
    report = EvaluationReport(name="capped", cases=[], failures=[failure])
    target = EvalTierTarget(object(), object, "fixture", "trajectory", "fixture")
    persisted: list[dict[str, float]] = []
    monkeypatch.setattr(eval_gate_flow, "CAPPED", True)
    monkeypatch.setattr(
        eval_gate_flow,
        "persist_report",
        lambda report, target, model_id, scores: persisted.append(scores),
    )

    failures = finish_cli_report(report, target, "fixture:model")

    assert failures == []
    assert persisted == [{}]
