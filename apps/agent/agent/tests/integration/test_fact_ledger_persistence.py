"""Round-trip of the fact ledger through the `sessions.state` JSONB envelope."""

from __future__ import annotations

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import RouteResponseModel
from agent.agents.session_state import SessionState
from agent.interfaces.schemas import PublicAPIRequest
from agent.interfaces.session_facade import (
    SessionUpdate,
    build_context_block,
    build_updated_session_state,
    extract_context_delta,
    normalize_session_state,
)


def _turn_result(session: SessionState, *, pacing: str) -> AgentResult:
    return AgentResult(
        output=RouteResponseModel(message="Routed."),
        intent="plan_route",
        session_state=session,
        steps=[
            StepRecord(
                tool="plan_route",
                success=True,
                params={"search_result_ref": "ref-1", "pacing": pacing},
            )
        ],
    )


def _persist(
    envelope: dict[str, object], result: AgentResult, *, text: str
) -> dict[str, object]:
    delta = extract_context_delta(result)
    return build_updated_session_state(
        envelope,
        SessionUpdate(
            request=PublicAPIRequest(text=text),
            response_intent=result.intent,
            response_status="ok",
            response_success=result.success,
            context_delta=delta,
        ),
    )


def test_fact_ledger_round_trips_timestamps_and_supersession_chain() -> None:
    session = SessionState()
    envelope = _persist(
        normalize_session_state(None),
        _turn_result(session, pacing="chill"),
        text="chill please",
    )

    context = build_context_block(envelope)
    assert context is not None
    restored = SessionState.model_validate(context["session_state_v2"])
    first = restored.fact_ledger.active_hard_constraint()
    assert first is not None
    assert first.value == "chill"

    envelope = _persist(
        envelope, _turn_result(restored, pacing="packed"), text="actually packed"
    )

    context = build_context_block(envelope)
    assert context is not None
    final = SessionState.model_validate(context["session_state_v2"])
    constraints = final.fact_ledger.hard_constraints
    assert len(constraints) == 2
    superseded, live = constraints[0], constraints[1]
    assert superseded.superseded_by == live.id
    assert superseded.value == "chill"
    assert live.value == "packed"
    assert superseded.recorded_at.tzinfo is not None
    assert live.recorded_at.tzinfo is not None
