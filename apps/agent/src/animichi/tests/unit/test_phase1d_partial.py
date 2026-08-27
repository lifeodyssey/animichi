"""Phase 1d graceful-partial runner and projection contracts."""

from __future__ import annotations

from typing import get_args

import pytest

import animichi.agents.animichi_runner as runner
from animichi.agents.agent_result import StepRecord
from animichi.agents.animichi_agent import RuntimeOutput
from animichi.agents.runtime_models import PartialResponseModel, SearchResponseModel
from animichi.agents.session_state import (
    PointState,
    SearchPayloadState,
)
from animichi.interfaces.response_builder import _UI_MAP


def _search_payload(point_id: str = "p1") -> SearchPayloadState:
    return SearchPayloadState(
        kind="bangumi",
        rows=[PointState(id=point_id, name="Bridge", bangumi_id="1")],
        row_count=1,
        anime_id="1",
    )


def test_partial_model_round_trips_without_joining_model_output_union() -> None:
    partial = PartialResponseModel(message="Partial results are shown.")
    restored = PartialResponseModel.model_validate_json(partial.model_dump_json())
    assert restored == partial
    assert PartialResponseModel not in get_args(RuntimeOutput)


def test_partial_model_maps_to_stable_stage_and_ui() -> None:
    output = PartialResponseModel(message="Partial results are shown.")
    assert runner.runtime_stage(output, []) == "partial"
    assert _UI_MAP["partial"] == "GeneralAnswer"


@pytest.mark.parametrize(
    "step",
    [
        StepRecord(tool="search_bangumi", is_success=False),
        StepRecord(tool="plan_route", is_success=True),
    ],
)
def test_runtime_stage_search_requires_successful_matching_tool_step(
    step: StepRecord,
) -> None:
    output = SearchResponseModel(message="Search complete.")
    with pytest.raises(ValueError, match="No successful step"):
        runner.runtime_stage(output, [step])


def test_partial_message_unknown_locale_defaults_to_japanese() -> None:
    assert runner._partial_message("fr") == runner._partial_message("ja")
