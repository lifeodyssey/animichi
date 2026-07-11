from __future__ import annotations

from pydantic_evals.evaluators import EvaluatorContext

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QAResponseModel
from agent.tests.eval.evaluators import AgentExpected, AgentInput


def steps(*tools: str) -> list[StepRecord]:
    return [StepRecord(tool=tool, success=True) for tool in tools]


def result(records: list[StepRecord], output: object | None = None) -> AgentResult:
    out = output or QAResponseModel(intent="general_qa", message="テスト")
    return AgentResult(output=out, steps=records)


def ctx(
    inputs: AgentInput, output: AgentResult, meta: AgentExpected
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    return EvaluatorContext(
        name="t",
        inputs=inputs,
        metadata=meta,
        expected_output=None,
        output=output,
        duration=0.0,
        _span_tree=None,
        attributes={},
        metrics={},
    )


JA = AgentInput(query="q", locale="ja")
