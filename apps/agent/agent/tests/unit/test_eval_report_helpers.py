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
    assert collect_scores(_aggregate({"tool_f1": 0.75}), ["tool_f1"]) == {
        "tool_f1": 0.75
    }


def test_collect_scores_accepts_additive_official_metrics() -> None:
    names = ["tool_f1", "argument_correctness_official"]
    scores = {"tool_f1": 0.75, "argument_correctness_official": 1.0}
    assert collect_scores(_aggregate(scores), names) == scores


def test_collect_scores_raises_on_unknown_metric_name() -> None:
    with pytest.raises(ValueError, match="Missing metric\\(s\\): missing"):
        collect_scores(_aggregate({"known": 1.0}), ["missing"])


def test_metric_names_conditionally_includes_nonempty_results() -> None:
    tagged = metric_names(has_nonempty_cases=True, l3_on=False)
    untagged = metric_names(has_nonempty_cases=False, l3_on=False)
    assert "nonempty_results" in tagged
    assert "nonempty_results" not in untagged
    assert "argument_correctness_official" in untagged
    assert "tool_correctness_official" in untagged
    assert "trajectory_match_official" in untagged
    assert "max_tool_calls_official" in untagged
