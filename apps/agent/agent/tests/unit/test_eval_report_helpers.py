from __future__ import annotations

from collections.abc import Mapping

import pytest
from pydantic_evals.reporting import ReportCaseAggregate

from agent.tests.eval.eval_harness import metric_names
from agent.tests.eval.eval_report import collect_scores


def _aggregate(scores: Mapping[str, int | float]) -> ReportCaseAggregate:
    return ReportCaseAggregate(
        name="avg",
        scores=dict(scores),
        labels={},
        metrics={},
        assertions=None,
        task_duration=0.1,
        total_duration=0.2,
    )


def test_collect_scores_returns_requested_metrics() -> None:
    assert collect_scores(
        _aggregate({"tool_correctness": 0.75}), ["tool_correctness"]
    ) == {"tool_correctness": 0.75}


def test_collect_scores_accepts_official_first_metrics() -> None:
    names = ["tool_correctness", "argument_correctness"]
    scores = {"tool_correctness": 0.75, "argument_correctness": 1.0}
    assert collect_scores(_aggregate(scores), names) == scores


def test_collect_scores_raises_on_unknown_metric_name() -> None:
    with pytest.raises(ValueError, match="Missing metric\\(s\\): missing"):
        collect_scores(_aggregate({"known": 1.0}), ["missing"])


def test_metric_names_conditionally_includes_nonempty_results() -> None:
    tagged = metric_names(has_nonempty_cases=True, l3_on=False)
    untagged = metric_names(has_nonempty_cases=False, l3_on=False)
    assert tagged == [
        "argument_correctness",
        "tool_correctness",
        "trajectory_match",
        "max_tool_calls",
        "data_keys_present",
        "locale_match",
        "nonempty_results",
        "step_efficiency",
    ]
    assert untagged == [name for name in tagged if name != "nonempty_results"]
