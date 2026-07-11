from __future__ import annotations

from collections.abc import Mapping

import pytest
from pydantic_evals.evaluators import EvaluatorContext

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QAResponseModel
from agent.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    RouteOrderCorrect,
    StepEfficiency,
    ToolCallRecall,
)


def _steps(*tools: str) -> list[StepRecord]:
    return [StepRecord(tool=t, success=True) for t in tools]


def _result(steps: list[StepRecord], output: object | None = None) -> AgentResult:
    out = output or QAResponseModel(intent="general_qa", message="テスト")
    return AgentResult(output=out, steps=steps)


def _ctx(
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


_JA = AgentInput(query="q", locale="ja")


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (
            _steps("resolve_anime", "search_bangumi"),
            ["search_bangumi"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps("search_bangumi"),
            ["search_bangumi"],
            {
                "tool_recall": 0.5,
                "tool_precision": 1.0,
                "tool_f1": pytest.approx(2 / 3),
            },
        ),
        (
            _steps("resolve_anime", "search_bangumi", "plan_route"),
            ["plan_route"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps("greet_user"),
            ["greet_user"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps("answer_question"),
            ["general_qa"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps(),
            ["general_qa"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps("resolve_anime"),
            ["greet_user"],
            {"tool_recall": 0.0, "tool_precision": 0.0, "tool_f1": 0.0},
        ),
        (
            _steps(),
            ["general_qa", "clarify"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps("clarify"),
            ["general_qa", "clarify"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            _steps(),
            [],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
    ],
)
def test_tool_call_recall_scores_best_acceptable_stage(
    steps: list[StepRecord], stages: list[str], expected: Mapping[str, float]
) -> None:
    ctx = _ctx(_JA, _result(steps), AgentExpected(stages))
    assert dict(ToolCallRecall().evaluate(ctx)) == expected


def test_tool_call_recall_penalizes_search_when_clarify_expected() -> None:
    ctx = _ctx(
        _JA,
        _result(_steps("resolve_anime", "search_bangumi")),
        AgentExpected(["clarify"]),
    )
    scores = dict(ToolCallRecall().evaluate(ctx))
    assert (scores["tool_recall"], scores["tool_f1"]) == (0.0, 0.0)


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (
            _steps("resolve_anime", "search_bangumi", "plan_route"),
            ["plan_route"],
            {"route_order_correct": 1.0},
        ),
        (
            _steps("plan_route", "resolve_anime", "search_bangumi"),
            ["plan_route"],
            {"route_order_correct": 0.0},
        ),
        (
            _steps("resolve_anime", "search_bangumi"),
            ["plan_route"],
            {"route_order_correct": 0.0},
        ),
        (_steps("greet_user"), ["greet_user"], {"route_order_correct": 1.0}),
        (_steps(), ["greet_user"], {"route_order_correct": 1.0}),
    ],
)
def test_route_order_correct_scores_ordered_chains(
    steps: list[StepRecord], stages: list[str], expected: Mapping[str, float]
) -> None:
    ctx = _ctx(_JA, _result(steps), AgentExpected(stages))
    assert dict(RouteOrderCorrect().evaluate(ctx)) == expected


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (_steps("resolve_anime", "search_bangumi"), ["search_bangumi"], 1.0),
        (
            _steps(
                "resolve_anime",
                "search_bangumi",
                "resolve_anime",
                "search_bangumi",
                "plan_route",
            ),
            ["search_bangumi"],
            0.4,
        ),
        (_steps(), ["search_bangumi"], 1.0),
        (
            _steps("clarify", "resolve_anime", "search_bangumi"),
            ["clarify", "search_bangumi"],
            pytest.approx(2 / 3),
        ),
    ],
)
def test_step_efficiency_scores_best_acceptable_minimum(
    steps: list[StepRecord], stages: list[str], expected: float
) -> None:
    ctx = _ctx(_JA, _result(steps), AgentExpected(stages))
    assert dict(StepEfficiency().evaluate(ctx)) == {"step_efficiency": expected}


def test_step_efficiency_scores_recorded_greeting_as_ideal() -> None:
    ctx = _ctx(_JA, _result(_steps("greet_user")), AgentExpected(["greet_user"]))
    assert dict(StepEfficiency().evaluate(ctx)) == {"step_efficiency": 1.0}
