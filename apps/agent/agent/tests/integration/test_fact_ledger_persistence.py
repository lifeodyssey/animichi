"""Round-trip of the fact ledger through a real SessionStore + the envelope."""

from __future__ import annotations

from datetime import UTC, datetime

from agent.agents.agent_result import AgentResult, StepRecord
from agent.agents.runtime_models import RouteResponseModel
from agent.agents.session_state import SessionState
from agent.domain.fact_ledger import record_turn_facts
from agent.infrastructure.session.memory import InMemorySessionStore
from agent.interfaces.schemas import PublicAPIRequest
from agent.interfaces.session_facade import (
    SessionUpdate,
    build_context_block,
    build_updated_session_state,
    extract_context_delta,
    normalize_session_state,
)

_SESSION_ID = "session-1"
_FIRST_TURN = datetime(2026, 7, 28, 9, 30, tzinfo=UTC)
_SECOND_TURN = datetime(2026, 7, 28, 9, 31, tzinfo=UTC)


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


def _restore(stored: dict[str, object] | None) -> SessionState:
    context = build_context_block(normalize_session_state(stored))
    if context is None:
        return SessionState()
    return SessionState.model_validate(context["session_state_v2"])


async def _run_turn(
    store: InMemorySessionStore, *, pacing: str, text: str, now: datetime
) -> None:
    """Mirror `public_api.py`'s real command-then-query-then-persist sequence:
    restore -> run -> record (command) -> extract (query) -> persist."""
    stored = await store.get(_SESSION_ID)
    result = _turn_result(_restore(stored), pacing=pacing)
    record_turn_facts(result.session_state.fact_ledger, result.steps, now=now)
    delta = extract_context_delta(result)
    updated = build_updated_session_state(
        normalize_session_state(stored),
        SessionUpdate(
            request=PublicAPIRequest(text=text),
            response_intent=result.intent,
            response_status="ok",
            response_success=result.success,
            context_delta=delta,
        ),
    )
    await store.set(_SESSION_ID, updated)


async def test_fact_ledger_round_trips_through_a_real_session_store() -> None:
    store = InMemorySessionStore()

    await _run_turn(store, pacing="chill", text="chill please", now=_FIRST_TURN)

    stored = await store.get(_SESSION_ID)
    assert stored is not None
    first = _restore(stored).fact_ledger.active_hard_constraint()
    assert first is not None
    assert first.value == "chill"
    assert first.recorded_at == _FIRST_TURN

    await _run_turn(store, pacing="packed", text="actually packed", now=_SECOND_TURN)

    stored = await store.get(_SESSION_ID)
    assert stored is not None
    constraints = _restore(stored).fact_ledger.hard_constraints
    assert len(constraints) == 2
    superseded, live = constraints[0], constraints[1]
    assert superseded.superseded_by == live.id
    assert superseded.value == "chill"
    assert live.value == "packed"
    assert superseded.recorded_at == _FIRST_TURN
    assert live.recorded_at == _SECOND_TURN
