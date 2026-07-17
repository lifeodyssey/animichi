"""Deterministic direct thrash red-line gate tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QAResponseModel
from agent.agents.session_state import SessionState
from agent.tests.eval.direct_gates import (
    RecordedToolCall,
    TrajectoryCase,
    direct_thrash_gate,
)
from agent.tests.eval.eval_gate_flow import GateInput, _run_gate
from agent.tests.eval.gate import baseline_path


def _calls(count: int) -> tuple[RecordedToolCall, ...]:
    return tuple(
        RecordedToolCall(tool="resolve_anime", arguments=f'{{"title":"title-{index}"}}')
        for index in range(count)
    )


def test_direct_gates_accept_initial_thresholds() -> None:
    cases = [
        TrajectoryCase(case_id=f"case-{index}", requests=6, tool_calls=_calls(6))
        for index in range(20)
    ]
    cases[-1] = TrajectoryCase("case-19", requests=12, tool_calls=_calls(6))
    assert direct_thrash_gate(cases) == []


def test_direct_gates_reject_over_limit_and_repeated_trajectory() -> None:
    calls = (*_calls(6), _calls(1)[0])
    failures = direct_thrash_gate(
        [TrajectoryCase("thrash", requests=13, tool_calls=calls)]
    )
    assert any("requests=13" in failure for failure in failures)
    assert any("tool_calls=7" in failure for failure in failures)
    assert any("repeated identical" in failure for failure in failures)


def test_direct_gates_reject_request_p95_above_six() -> None:
    failures = direct_thrash_gate(
        [TrajectoryCase(f"case-{index}", requests=7) for index in range(20)]
    )
    assert failures == ["request_p95=7 exceeds limit=6"]


def test_zero_request_cases_do_not_dilute_model_request_p95() -> None:
    model_cases = [TrajectoryCase(f"model-{index}", requests=7) for index in range(2)]
    deterministic_cases = [
        TrajectoryCase(f"selection-{index}", requests=0) for index in range(39)
    ]
    failures = direct_thrash_gate([*model_cases, *deterministic_cases])
    assert failures == ["request_p95=7 exceeds limit=6"]


def test_trajectory_accounting_excludes_runner_synthesized_steps() -> None:
    params = {"title": "Haruhi"}
    result = AgentResult(
        output=QAResponseModel(message="answer"),
        intent="general_qa",
        session_state=SessionState(),
        steps=[
            StepRecord("resolve_anime", True, params=params),
            StepRecord("resolve_anime", True, params=params, model_initiated=False),
        ],
        usage=RunUsage(requests=2),
    )
    trajectory = TrajectoryCase.from_result("case", result)
    assert trajectory.requests == 2
    assert len(trajectory.tool_calls) == 1
    assert direct_thrash_gate([trajectory]) == []


def _failing_gate_input() -> GateInput:
    return GateInput(
        model="fixture",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=1,
        evaluated_count=1,
        errored_count=0,
        scores={},
        cases={},
        trajectories=(TrajectoryCase("thrash", requests=13),),
    )


def test_eval_gate_flow_bootstraps_direct_failure_when_enforcement_is_off(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("DIRECT_GATE_ENFORCE", raising=False)
    failures = _run_gate(_failing_gate_input(), "agent", tmp_path, capped=False)
    assert failures is None
    assert baseline_path("agent", "fixture", tmp_path).exists()
    report = capsys.readouterr().out
    assert "Direct thrash metrics (report-only)" in report
    assert "thrash: requests=13 tool_calls=0 repeats=0" in report
    assert "request_p95=13" in report


def test_eval_gate_flow_blocks_direct_failure_without_baseline(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DIRECT_GATE_ENFORCE", "1")
    failures = _run_gate(_failing_gate_input(), "agent", tmp_path, capped=False)
    assert failures is not None and any("requests=13" in item for item in failures)
    assert not baseline_path("agent", "fixture", tmp_path).exists()


def test_capped_gate_prints_case_metrics_without_p95_or_blocking(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("DIRECT_GATE_ENFORCE", "1")
    failures = _run_gate(_failing_gate_input(), "agent", tmp_path, capped=True)
    assert failures == []
    assert not baseline_path("agent", "fixture", tmp_path).exists()
    report = capsys.readouterr().out
    assert "Direct thrash metrics (report-only)" in report
    assert "thrash: requests=13 tool_calls=0 repeats=0" in report
    assert "request_p95" not in report
