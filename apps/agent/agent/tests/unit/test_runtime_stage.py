"""Runtime-stage mapping and AgentResult compatibility guards."""

from __future__ import annotations

import pytest

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.animichi_runner import _STAGE_BY_OUTPUT, runtime_stage
from agent.agents.runtime_models import (
    ClarifyDataModel,
    ClarifyResponseModel,
    GreetingResponseModel,
    QADataModel,
    QAResponseModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    RuntimeStageOutput,
    SearchDataModel,
    SearchResponseModel,
)
from agent.agents.session_state import SessionState


def _outputs() -> list[RuntimeStageOutput]:
    return [
        ClarifyResponseModel(
            intent="clarify",
            message="Which one?",
            data=ClarifyDataModel(
                status="needs_clarification",
                question="Which one?",
            ),
        ),
        SearchResponseModel(
            intent="search_bangumi",
            message="Found it.",
            data=SearchDataModel(results=ResultsMetaModel()),
        ),
        SearchResponseModel(
            intent="search_nearby",
            message="Found nearby.",
            data=SearchDataModel(results=ResultsMetaModel()),
        ),
        RouteResponseModel(
            intent="plan_route",
            message="Route ready.",
            data=RouteDataModel(route=RouteModel()),
        ),
        RouteResponseModel(
            intent="plan_selected",
            message="Selected route ready.",
            data=RouteDataModel(route=RouteModel()),
        ),
        QAResponseModel(
            intent="general_qa",
            message="Answer.",
            data=QADataModel(message="Answer."),
        ),
        GreetingResponseModel(
            intent="greet_user",
            message="Hello.",
            data=QADataModel(message="Hello."),
        ),
    ]


def test_stage_by_output_is_the_exact_server_owned_map() -> None:
    assert _STAGE_BY_OUTPUT == {
        SearchResponseModel: "search",
        RouteResponseModel: "route",
        ClarifyResponseModel: "clarify",
        QAResponseModel: "general_qa",
        GreetingResponseModel: "greet_user",
    }


@pytest.mark.parametrize("output", _outputs())
def test_runtime_stage_equals_legacy_intent(output: RuntimeStageOutput) -> None:
    assert runtime_stage(output) == str(output.intent)


def test_agent_result_new_fields_default_without_changing_success() -> None:
    output = _outputs()[-2]
    success = AgentResult(output=output)
    failure = AgentResult(
        output=output,
        steps=[StepRecord(tool="answer_question", success=False)],
    )

    assert success.intent == "general_qa"
    assert success.session_state == SessionState()
    assert success.status is None
    assert success.success_override is None
    assert success.success is True
    assert failure.success is False


def test_agent_result_success_override_only_changes_explicit_path() -> None:
    result = AgentResult(
        output=_outputs()[-2],
        steps=[StepRecord(tool="answer_question", success=True)],
        success_override=False,
    )

    assert result.success is False
