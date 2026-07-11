from __future__ import annotations

from typing import TypeAlias

from pydantic_evals.evaluators import EvaluationResult, EvaluatorSpec
from pydantic_evals.reporting import (
    EvaluationReport,
    ReportCase,
    ReportCaseFailure,
)

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QAResponseModel
from agent.tests.eval.evaluators import AgentExpected, AgentInput
from agent.tests.eval.exec_tiers import build_results_payload

_Case: TypeAlias = ReportCase[AgentInput, AgentResult, AgentExpected]
_Failure: TypeAlias = ReportCaseFailure[AgentInput, AgentResult, AgentExpected]
_Report: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]


def _score(
    name: str, value: int | float, reason: str | None
) -> EvaluationResult[int | float]:
    source = EvaluatorSpec(name="unit", arguments=None)
    return EvaluationResult(name=name, value=value, reason=reason, source=source)


def _result() -> AgentResult:
    output = QAResponseModel(intent="general_qa", message="Hello there")
    return AgentResult(
        output=output, steps=[StepRecord(tool="answer_question", success=True)]
    )


def _input() -> AgentInput:
    return AgentInput(query="Where?", locale="en")


def _expected() -> AgentExpected:
    return AgentExpected(acceptable_stages=["general_qa"])


def _case() -> _Case:
    return ReportCase(
        name="c1",
        inputs=_input(),
        metadata=_expected(),
        expected_output=None,
        output=_result(),
        metrics={},
        attributes={},
        scores=_scores(),
        labels={},
        assertions={},
        task_duration=0.1,
        total_duration=0.2,
    )


def _scores() -> dict[str, EvaluationResult[int | float]]:
    scores = {"task_completion": _score("task_completion", 1, "judge passed")}
    scores["tool_f1"] = _score("tool_f1", 0.5, None)
    return scores


def _failure() -> _Failure:
    return ReportCaseFailure(
        name="f1",
        inputs=_input(),
        metadata=_expected(),
        expected_output=None,
        error_message="boom",
        error_stacktrace="trace",
    )


def _report() -> _Report:
    return EvaluationReport(name="eval", cases=[_case()], failures=[_failure()])


def test_build_results_payload_persists_failures_and_reasons() -> None:
    payload = build_results_payload(
        _report(),
        model_id="model/id",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=2,
        scores={"task_completion": 1.0, "tool_f1": 0.5},
    )
    assert payload.cases[0].reasons == {"task_completion": "judge passed"}
    assert payload.cases[0].scores == {"task_completion": 1.0, "tool_f1": 0.5}
    assert payload.cases[1].error == "boom"
