"""#443: the repeat tripwire may only fire on genuinely identical arguments.

The runtime repeat-guard (`before_tool_execute`) deflects identical re-calls
before execution, so an executed repeat means the guard broke. That inference is
only sound while recorded params are lossless: when a step's arguments were not
recorded, "same recorded params" no longer implies "same call", and the tripwire
must abstain instead of inventing a repeat.
"""

from __future__ import annotations

import pytest
from pydantic_ai.usage import RunUsage

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import QAResponseModel
from agent.agents.session_state import SessionState
from agent.tests.eval.direct_gates import (
    TrajectoryCase,
    direct_thrash_gate,
    print_direct_thrash_metrics,
)


def _trajectory(*steps: StepRecord) -> TrajectoryCase:
    result = AgentResult(
        output=QAResponseModel(message="answer"),
        intent="general_qa",
        session_state=SessionState(),
        steps=list(steps),
        usage=RunUsage(requests=2),
    )
    return TrajectoryCase.from_result("C1_en_005", result)


def _nearby(location: str) -> StepRecord:
    return StepRecord("search_nearby", True, params={"location": location})


def _unrecorded_nearby() -> StepRecord:
    return StepRecord("search_nearby", True, params={}, params_recorded=False)


def test_distinct_locations_never_read_as_a_repeated_call() -> None:
    trajectory = _trajectory(_nearby("Nishinomiya, Japan"), _nearby("西宮市"))

    assert direct_thrash_gate([trajectory]) == []


def test_unrecorded_params_do_not_manufacture_a_repeat() -> None:
    trajectory = _trajectory(_unrecorded_nearby(), _unrecorded_nearby())

    assert direct_thrash_gate([trajectory]) == []


def test_identical_recorded_params_still_trip_the_guard_regression_wire() -> None:
    trajectory = _trajectory(_nearby("Uji"), _nearby("Uji"))

    assert direct_thrash_gate([trajectory]) == [
        "C1_en_005: repeated identical tool call: search_nearby"
    ]


def test_genuinely_empty_arguments_still_trip_the_wire() -> None:
    """A near-me search takes no arguments; repeating it is real thrash."""
    empty = StepRecord("search_nearby", True, params={})
    trajectory = _trajectory(empty, empty)

    assert direct_thrash_gate([trajectory]) == [
        "C1_en_005: repeated identical tool call: search_nearby"
    ]


def test_metrics_report_unrecorded_params_instead_of_hiding_them(
    capsys: pytest.CaptureFixture[str],
) -> None:
    trajectory = _trajectory(_unrecorded_nearby(), _nearby("Uji"))

    print_direct_thrash_metrics([trajectory], include_p95=False, enforced=True)

    report = capsys.readouterr().out
    assert "C1_en_005: requests=2 tool_calls=2 repeats=0 unrecorded_params=1" in report
