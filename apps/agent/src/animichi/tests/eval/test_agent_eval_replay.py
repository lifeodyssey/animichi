"""Eval: AC3 commit-before-response-loss recovery without re-invoking the model.

Drives the real ``AgentTurn`` use case with ``run_animichi_agent`` routed through a
deterministic ``FunctionModel`` and the offline ``MockCatalogClient``. The first turn
invokes the model exactly once and commits a wire output; a commit-before-response-
loss retry of the SAME turn key replays the committed output and must NOT re-invoke
the model. No live model calls — runs as part of the offline eval suite
(``pytest tests/eval``).
"""

from __future__ import annotations

from typing import cast
from unittest.mock import MagicMock

from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from animichi.agents.animichi_runner import run_animichi_agent
from animichi.application.agent_turn import AgentTurn
from animichi.application.turn_types import ExecutionResult, TextTurn, TurnKind
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.streaming_function_model import streaming_function_model
from animichi.tests.unit.agent_turn_fakes import Harness, _input
from animichi.tests.unit.turn_admission_fakes import FakeTurnReservationStore


def _returned(messages: list[ModelMessage], tool_name: str) -> bool:
    return any(
        getattr(p, "tool_name", None) == tool_name
        for m in messages
        for p in getattr(m, "parts", [])
    )


class _CountingDriver:
    """Deterministic resolve->qa responder that counts model invocations."""

    def __init__(self) -> None:
        self.calls = 0

    def respond(self, messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        del info
        self.calls += 1
        if not _returned(messages, "resolve_anime"):
            return ModelResponse(
                parts=[ToolCallPart("resolve_anime", {"title": "該当なし"})]
            )
        return ModelResponse(
            parts=[
                ToolCallPart(
                    "qa_response",
                    {
                        "intent": "general_qa",
                        "message": "永続化された回答。",
                        "data": {"status": "info", "message": "committed"},
                        "ui": {},
                    },
                )
            ]
        )

    def model(self) -> FunctionModel:
        return streaming_function_model(self.respond)


class _RunnerExecution:
    """TurnExecution port: invoke run_animichi_agent once per executed TextTurn."""

    def __init__(self, driver: _CountingDriver) -> None:
        self.driver = driver
        self.runs = 0
        self.results: list[object] = []

    async def execute(
        self,
        kind: TurnKind,
        *,
        context: dict[str, object] | None,
        history: object,
        model: object | None,
        on_step: object | None,
    ) -> ExecutionResult:
        del context, history, model, on_step
        if not isinstance(kind, TextTurn):
            raise AssertionError("AC3 eval drives text turns only")
        self.runs += 1
        catalog = MockCatalogClient()
        result = await run_animichi_agent(
            text=kind.text,
            db=MagicMock(),
            locale=kind.locale,
            model=self.driver.model(),
            catalog=cast(CatalogClientProtocol, catalog),
        )
        self.results.append(result)
        return ExecutionResult(
            output=result,
            context_delta={},
            intent=result.intent,
            status=result.status or "ok",
        )


async def test_replay_recovers_committed_output_without_reinvoking_the_model() -> None:
    """AC3 eval: model runs once; the replay returns the persisted output, no second run."""
    harness = Harness(FakeTurnReservationStore())
    driver = _CountingDriver()
    execution = _RunnerExecution(driver)
    harness.agent = AgentTurn(
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

    first = await harness.agent(_input())
    assert first.outcome == "completed"
    after_first = driver.calls
    assert after_first >= 1
    assert execution.runs == 1

    # Commit-before-response-loss: the same turn key arrives again; the
    # committed output is replayed and the model is not re-invoked.
    second = await harness.agent(_input())
    assert second.outcome == "replayed"
    assert execution.runs == 1
    assert driver.calls == after_first
    # The model was NOT re-invoked on replay: the committed output is persisted.
    assert second.output is not None
