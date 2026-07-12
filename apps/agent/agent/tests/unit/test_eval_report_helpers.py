from __future__ import annotations

from collections.abc import Mapping

import pytest
from pydantic_evals.reporting import ReportCaseAggregate

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


def test_collect_scores_raises_on_unknown_metric_name() -> None:
    with pytest.raises(ValueError, match="Missing metric\\(s\\): missing"):
        collect_scores(_aggregate({"known": 1.0}), ["missing"])
