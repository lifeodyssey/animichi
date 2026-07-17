from __future__ import annotations

import pytest
from pydantic_evals.evaluators import EvaluatorContext

from agent.agents.agent_result import AgentResult, StepRecord
from agent.tests.eval.evaluators import AgentExpected, AgentInput
from agent.tests.eval.official_evaluators import (
    OfficialArgumentCorrectness,
    OfficialMaxToolCalls,
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)
from agent.tests.unit.eval_evaluator_fixtures import (
    JA,
    ctx,
    result,
    span_tree,
    tool_span,
)


def _context(
    tools: list[str], stages: list[str], params: list[dict[str, object]] | None = None
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    arguments = params or [{} for _ in tools]
    records = [
        StepRecord(tool=tool, success=True, params=arguments[index])
        for index, tool in enumerate(tools)
    ]
    spans = [
        tool_span(tool, arguments[index], index) for index, tool in enumerate(tools)
    ]
    return ctx(JA, result(records), AgentExpected(stages), span_tree(*spans))


@pytest.mark.parametrize(
    ("tools", "expected"),
    [
        (["resolve_anime", "search_bangumi"], 1.0),
        (["resolve_anime", "search_bangumi", "clarify"], 0.0),
    ],
)
def test_official_tool_correctness_scores_exact_multiset(
    tools: list[str], expected: float
) -> None:
    scores = OfficialToolCorrectness().evaluate(_context(tools, ["search_bangumi"]))
    assert scores == {"tool_correctness": expected}


def test_official_tool_correctness_preserves_stage_disjunction() -> None:
    scores = OfficialToolCorrectness().evaluate(
        _context(["resolve_anime"], ["general_qa", "clarify"])
    )
    assert scores == {"tool_correctness": 1.0}


@pytest.mark.parametrize("tools", [[], ["resolve_anime"]])
def test_official_clarify_uses_model_call_span_vocabulary(tools: list[str]) -> None:
    evaluator_ctx = _context(tools, ["clarify"])

    assert OfficialToolCorrectness().evaluate(evaluator_ctx) == {
        "tool_correctness": 1.0
    }
    assert OfficialTrajectoryMatch().evaluate(evaluator_ctx) == {
        "trajectory_match": 1.0
    }


@pytest.mark.parametrize(
    ("tools", "expected"),
    [
        (["resolve_anime", "search_bangumi", "plan_route"], 1.0),
        (["plan_route", "search_bangumi", "resolve_anime"], pytest.approx(1 / 3)),
    ],
)
def test_official_trajectory_match_scores_in_order_f1(
    tools: list[str], expected: float
) -> None:
    scores = OfficialTrajectoryMatch().evaluate(_context(tools, ["plan_route"]))
    assert scores == {"trajectory_match": expected}


@pytest.mark.parametrize(("work_id", "expected"), [("160209", 1.0), (160209, 0.0)])
def test_official_argument_correctness_uses_normalized_tool_arguments(
    work_id: object, expected: float
) -> None:
    normalized: dict[str, object] = {"bangumi_id": "160209"}
    emitted = {"bangumi_id": work_id}
    record = StepRecord(tool="search_bangumi", success=True, params=normalized)
    evaluator_ctx = ctx(
        JA,
        result([record]),
        AgentExpected(["clarify"]),
        span_tree(tool_span("search_bangumi", emitted, 0)),
    )
    scores = OfficialArgumentCorrectness().evaluate(evaluator_ctx)
    assert scores == {"argument_correctness": expected}


def test_argument_correctness_ignores_server_geocode_step() -> None:
    emitted = {"location": "西宮", "radius_m": 5000}
    records = [
        StepRecord(
            tool="geocode",
            success=True,
            params={"location": "西宮"},
            model_initiated=False,
        ),
        StepRecord(tool="search_nearby", success=True, params=emitted),
    ]
    evaluator_ctx = ctx(
        JA,
        result(records),
        AgentExpected(["search_nearby"]),
        span_tree(tool_span("search_nearby", emitted, 0)),
    )

    assert OfficialArgumentCorrectness().evaluate(evaluator_ctx) == {
        "argument_correctness": 1.0
    }


@pytest.mark.parametrize(
    "records",
    [[], [StepRecord(tool="clarify", success=True, model_initiated=False)]],
)
def test_official_argument_correctness_is_not_applicable_without_model_calls(
    records: list[StepRecord],
) -> None:
    evaluator_ctx = ctx(
        JA,
        result(records),
        AgentExpected(["clarify"]),
        span_tree(),
    )

    assert OfficialArgumentCorrectness().evaluate(evaluator_ctx) == {}


@pytest.mark.parametrize("tools", [[], ["web_search"], ["translate_anime_title"]])
def test_general_qa_accepts_optional_web_tool_spans(tools: list[str]) -> None:
    evaluator_ctx = _context(tools, ["general_qa"])

    assert OfficialToolCorrectness().evaluate(evaluator_ctx) == {
        "tool_correctness": 1.0
    }
    assert OfficialTrajectoryMatch().evaluate(evaluator_ctx) == {
        "trajectory_match": 1.0
    }


@pytest.mark.parametrize(
    ("tools", "expected"),
    [
        (["resolve_anime", "search_bangumi", "plan_route"], 1.0),
        (["resolve_anime", "search_bangumi", "plan_route", "clarify"], 0.0),
    ],
)
def test_official_max_tool_calls_scores_stage_budget(
    tools: list[str], expected: float
) -> None:
    scores = OfficialMaxToolCalls().evaluate(_context(tools, ["plan_route"]))
    assert scores == {"max_tool_calls": expected}
