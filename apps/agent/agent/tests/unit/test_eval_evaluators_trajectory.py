from __future__ import annotations

from collections.abc import Mapping

import pytest

from agent.agents.agent_result import StepRecord
from agent.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    RouteOrderCorrect,
    StepEfficiency,
    ToolCallRecall,
)
from agent.tests.unit.eval_evaluator_fixtures import JA, ctx, result, steps


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (
            steps("resolve_anime", "search_bangumi"),
            ["search_bangumi"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps("search_bangumi"),
            ["search_bangumi"],
            {
                "tool_recall": 0.5,
                "tool_precision": 1.0,
                "tool_f1": pytest.approx(2 / 3),
            },
        ),
        (
            steps("resolve_anime", "search_bangumi", "plan_route"),
            ["plan_route"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps(),
            ["general_qa"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps(),
            ["general_qa"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps("resolve_anime"),
            ["general_qa"],
            {"tool_recall": 1.0, "tool_precision": 0.0, "tool_f1": 0.0},
        ),
        (
            steps(),
            ["general_qa", "clarify"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps("resolve_anime", "clarify"),
            ["general_qa", "clarify"],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
        (
            steps(),
            [],
            {"tool_recall": 1.0, "tool_precision": 1.0, "tool_f1": 1.0},
        ),
    ],
)
def test_tool_call_recall_scores_best_acceptable_stage(
    steps: list[StepRecord], stages: list[str], expected: Mapping[str, float]
) -> None:
    evaluator_ctx = ctx(JA, result(steps), AgentExpected(stages))
    assert dict(ToolCallRecall().evaluate(evaluator_ctx)) == expected


def test_tool_call_recall_penalizes_incomplete_clarify_trajectory() -> None:
    evaluator_ctx = ctx(
        JA,
        result(steps("resolve_anime", "search_bangumi")),
        AgentExpected(["clarify"]),
    )
    scores = dict(ToolCallRecall().evaluate(evaluator_ctx))
    assert (scores["tool_recall"], scores["tool_f1"]) == (0.5, 0.5)


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (
            steps("resolve_anime", "search_bangumi", "plan_route"),
            ["plan_route"],
            {"route_order_correct": 1.0},
        ),
        (
            steps("plan_route", "resolve_anime", "search_bangumi"),
            ["plan_route"],
            {"route_order_correct": 0.0},
        ),
        (
            steps("resolve_anime", "search_bangumi"),
            ["plan_route"],
            {"route_order_correct": 0.0},
        ),
        (
            steps("resolve_anime", "clarify"),
            ["general_qa", "clarify"],
            {"route_order_correct": 1.0},
        ),
        (
            steps("search_bangumi"),
            ["general_qa", "clarify"],
            {"route_order_correct": 0.0},
        ),
        (
            steps("search_nearby"),
            ["plan_route", "general_qa"],
            {"route_order_correct": 0.0},
        ),
        (steps("resolve_anime"), ["general_qa"], {"route_order_correct": 0.0}),
        (
            steps("geocode", "clarify"),
            ["clarify_after_nearby"],
            {"route_order_correct": 1.0},
        ),
        (steps(), ["general_qa"], {"route_order_correct": 1.0}),
    ],
)
def test_route_order_correct_scores_ordered_chains(
    steps: list[StepRecord], stages: list[str], expected: Mapping[str, float]
) -> None:
    evaluator_ctx = ctx(JA, result(steps), AgentExpected(stages))
    assert dict(RouteOrderCorrect().evaluate(evaluator_ctx)) == expected


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (steps("resolve_anime", "search_bangumi"), ["search_bangumi"], 1.0),
        (
            steps(
                "resolve_anime",
                "search_bangumi",
                "resolve_anime",
                "search_bangumi",
                "plan_route",
            ),
            ["search_bangumi"],
            0.4,
        ),
        (steps(), ["search_bangumi"], 1.0),
        (steps("geocode", "clarify"), ["clarify_after_nearby"], 1.0),
        (
            steps("clarify", "resolve_anime", "search_bangumi"),
            ["clarify", "search_bangumi"],
            pytest.approx(2 / 3),
        ),
    ],
)
def test_step_efficiency_scores_best_acceptable_minimum(
    steps: list[StepRecord], stages: list[str], expected: float
) -> None:
    evaluator_ctx = ctx(JA, result(steps), AgentExpected(stages))
    assert dict(StepEfficiency().evaluate(evaluator_ctx)) == {
        "step_efficiency": expected
    }


def test_step_efficiency_scores_direct_general_qa_as_ideal() -> None:
    evaluator_ctx = ctx(JA, result(steps()), AgentExpected(["general_qa"]))
    assert dict(StepEfficiency().evaluate(evaluator_ctx)) == {"step_efficiency": 1.0}


def test_plan_multi_trajectory_scales_with_unique_candidates() -> None:
    inputs = AgentInput(
        query="pick both", locale="en", selected_candidate_ids=["1", "1", "2"]
    )
    complete = result(steps("search_bangumi", "search_bangumi", "plan_multi"))
    incomplete = result(steps("search_bangumi", "plan_multi"))
    expected = AgentExpected(["plan_multi"])

    assert RouteOrderCorrect().evaluate(ctx(inputs, complete, expected)) == {
        "route_order_correct": 1.0
    }
    assert RouteOrderCorrect().evaluate(ctx(inputs, incomplete, expected)) == {
        "route_order_correct": 0.0
    }
    assert StepEfficiency().evaluate(ctx(inputs, complete, expected)) == {
        "step_efficiency": 1.0
    }
