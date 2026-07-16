"""Phase 1c compact-output and server-owned-stage contract pins."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError
from pydantic_ai import ModelRetry

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.animichi_agent import validate_output
from agent.agents.animichi_runner import runtime_stage
from agent.agents.runtime_deps import RuntimeDeps
from agent.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from agent.agents.session_state import (
    OrderedCandidate,
    PendingClarification,
    SessionState,
)
from agent.tests.eval.mock_catalog_client import MockCatalogClient


def _deps(state: SessionState | None = None) -> RuntimeDeps:
    deps = RuntimeDeps(
        db=MagicMock(), locale="en", query="test", catalog=MockCatalogClient()
    )
    deps.tool_state.session = state or SessionState()
    return deps


@pytest.mark.parametrize(
    "output",
    [
        SearchResponseModel(message="Found matching spots."),
        RouteResponseModel(message="Your route is ready."),
        QAResponseModel(message="A complete answer with no schema length cap."),
    ],
)
def test_compact_outputs_only_emit_message(output: object) -> None:
    assert output.model_dump() == {"message": output.message}
    assert not hasattr(output, "intent")
    assert not hasattr(output, "data")
    assert not hasattr(output, "ui")


def test_clarify_output_keeps_only_reason_message_and_candidate_ids() -> None:
    output = ClarifyResponseModel(
        reason="anime_ambiguity",
        message="Which works should I combine?",
        candidate_ids='["1", "2"]',
    )
    assert output.model_dump() == {
        "reason": "anime_ambiguity",
        "message": "Which works should I combine?",
        "candidate_ids": ["1", "2"],
    }


def test_compact_outputs_forbid_historical_fields() -> None:
    with pytest.raises(ValidationError):
        SearchResponseModel.model_validate(
            {"intent": "search_bangumi", "message": "x", "data": {}}
        )


@pytest.mark.parametrize(
    ("output", "steps", "expected"),
    [
        (
            SearchResponseModel(message="x"),
            [StepRecord("search_nearby", True)],
            "search_nearby",
        ),
        (
            RouteResponseModel(message="x"),
            [StepRecord("plan_route", True)],
            "plan_route",
        ),
        (QAResponseModel(message="x"), [], "general_qa"),
    ],
)
def test_runtime_stage_uses_output_type_and_steps(
    output: object, steps: list[StepRecord], expected: str
) -> None:
    assert runtime_stage(output, steps) == expected


async def test_clarify_validator_accepts_exact_pending_contract() -> None:
    state = SessionState(
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=["1", "2"],
            ordered_candidates=[
                OrderedCandidate(id="1", title="One"),
                OrderedCandidate(id="2", title="Two"),
            ],
            revision=1,
        ),
        clarification_revision=1,
    )
    deps = _deps(state)
    output = ClarifyResponseModel(
        reason="anime_ambiguity", message="Choose.", candidate_ids=["1", "2"]
    )
    assert await validate_output(MagicMock(deps=deps), output) is output


@pytest.mark.parametrize(
    ("reason", "candidate_ids"),
    [
        ("place_ambiguity", ["1", "2"]),
        ("anime_ambiguity", ["2", "1"]),
        ("anime_ambiguity", ["1"]),
    ],
)
async def test_clarify_validator_rejects_pending_mismatch(
    reason: str, candidate_ids: list[str]
) -> None:
    state = SessionState(
        pending_clarification=PendingClarification(
            reason="anime_ambiguity",
            candidate_ids=["1", "2"],
            ordered_candidates=[],
            revision=1,
        ),
        clarification_revision=1,
    )
    deps = _deps(state)
    output = ClarifyResponseModel.model_validate(
        {"reason": reason, "message": "Choose.", "candidate_ids": candidate_ids}
    )
    with pytest.raises(ModelRetry):
        await validate_output(MagicMock(deps=deps), output)


async def test_clarify_validator_rejects_when_no_pending() -> None:
    output = ClarifyResponseModel(
        reason="anime_not_found", message="Try another title.", candidate_ids=[]
    )
    with pytest.raises(ModelRetry):
        await validate_output(MagicMock(deps=_deps()), output)


def test_agent_result_requires_server_owned_intent() -> None:
    result = AgentResult(
        output=QAResponseModel(message="Answer."),
        intent="general_qa",
        session_state=SessionState(),
    )
    assert result.intent == "general_qa"
