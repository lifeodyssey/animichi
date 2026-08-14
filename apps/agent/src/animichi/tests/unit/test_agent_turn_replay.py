"""AgentTurn exactly-once replay recovery (TURN-4 #955, AC3).

On commit-before-response-loss a replay recovers the committed output without
re-invoking the model. The model-backed path needs provider credentials and is
verified by the CI eval lanes `agent-eval-smoke` (PR L0) and `agent-eval-nightly`;
these hermetic staged-replay tests run offline.
"""

from __future__ import annotations

from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_types import ExecutionResult, TurnExecution
from animichi.interfaces.schemas import PublicAPIResponse
from animichi.tests.unit.agent_turn_fakes import Harness, _input
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


async def test_replay_runs_direct_without_dispatch_or_quota_settlement() -> None:
    harness = Harness(FakeTurnReservationStore())
    await harness.agent(_input())
    harness.store.dispatch_calls.clear()
    harness.store.settle_calls.clear()
    harness.settlement.calls.clear()

    result = await harness.agent(_input())

    assert result.outcome == "replayed"
    assert result.revision == 1
    assert harness.store.dispatch_calls == []
    assert harness.store.settle_calls == []
    assert harness.settlement.calls[0].settle_quota is False


async def test_replay_recovers_the_committed_output_payload() -> None:
    harness = Harness(FakeTurnReservationStore())

    first = await harness.agent(_input())
    assert first.outcome == "completed"

    second = await harness.agent(_input())

    assert second.outcome == "replayed"
    assert second.output == "out"
    assert second.revision == first.revision


class _CommittedResponseExecution:
    # TurnExecution port that commits a typed wire payload (the dict the DB
    # JSONB column would store) and counts real executions (model work).

    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.executions = 0

    async def execute(
        self,
        kind: object,
        *,
        context: dict[str, object] | None,
        history: object,
        model: object | None,
        on_step: object | None,
    ) -> ExecutionResult:
        del kind, context, history, model, on_step
        self.executions += 1
        return ExecutionResult(
            output=self.payload,
            context_delta={},
            intent="search_bangumi",
            status="ok",
        )


def _agent_with(harness: Harness, execution: TurnExecution) -> AgentTurn:
    return AgentTurn(
        outcome=harness.outcome,
        session=harness.session,
        settlement=harness.settlement,
        execution=execution,
        detect_injection=lambda text: "ignore all" in text,
        guard_enabled=lambda: True,
        blocked_outcome=lambda _snapshot, _locale: "blocked-out",
        extract_delta=lambda _output: {"session_state_v2": {}},
        timeout=30.0,
    )


async def test_replay_reconstructs_the_committed_typed_response_without_reexecuting() -> (
    None
):
    """AC3: the committed wire response (dict payload) is recovered on a
    commit-before-response-loss replay and rebuilds the typed PublicAPIResponse
    — the model execution runs exactly once across the whole exchange."""
    harness = Harness(FakeTurnReservationStore())
    committed = PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        message="見つかりました。",
        data={"results": {"rows": [], "row_count": 0, "status": "ok"}},
    ).model_dump(mode="json")
    execution = _CommittedResponseExecution(committed)
    agent = _agent_with(harness, execution)

    first = await agent(_input(session_id="s-ac3"))
    assert first.outcome == "completed"
    assert execution.executions == 1

    # Commit-before-response-loss: the same key arrives again; the committed
    # payload is recovered and rebuilds the wire response, never re-executing.
    second = await agent(_input(session_id="s-ac3"))
    assert second.outcome == "replayed"
    assert execution.executions == 1, "replay must not re-run the execution"
    assert second.output == committed
    assert PublicAPIResponse.model_validate(
        second.output
    ) == PublicAPIResponse.model_validate(committed)
