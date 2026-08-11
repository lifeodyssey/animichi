"""Behavioral tests for ModelTurnPort + TurnEventSink (TURN-1 #939)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from animichi.application.model_turn_port import (
    ModelTurnRequest,
    ModelTurnResult,
    ModelTurnUsage,
)
from animichi.application.turn_event_sink import TurnEventSink


@dataclass
class FakeSink:
    """Records neutral events; never holds content fields."""

    stages: list[tuple[str, str | None]] = field(default_factory=list)
    usage: list[tuple[int, int, int]] = field(default_factory=list)

    def on_stage(self, stage: str, outcome: str | None = None) -> None:
        self.stages.append((stage, outcome))

    def on_usage(
        self, completion_tokens: int, prompt_tokens: int, duration_ms: int
    ) -> None:
        self.usage.append((completion_tokens, prompt_tokens, duration_ms))


def test_request_is_neutral() -> None:
    request = ModelTurnRequest(text="hello", message_history=("a", "b"))
    assert request.text == "hello"
    assert tuple(request.message_history) == ("a", "b")


def test_result_carries_output_usage_and_cancel_flag() -> None:
    result = ModelTurnResult(
        output={"ok": True},
        usage=ModelTurnUsage(completion_tokens=12, prompt_tokens=34),
        cancelled=False,
    )
    assert result.output == {"ok": True}
    assert result.usage.completion_tokens == 12
    assert result.cancelled is False


def test_cancelled_result_is_distinct() -> None:
    cancelled = ModelTurnResult(output=None, usage=ModelTurnUsage(), cancelled=True)
    assert cancelled.cancelled is True


def test_sink_never_carries_content_fields() -> None:
    sink = FakeSink()
    sink.on_stage("running")
    sink.on_stage("terminal", outcome="success")
    sink.on_usage(completion_tokens=5, prompt_tokens=9, duration_ms=120)
    assert sink.stages == [("running", None), ("terminal", "success")]
    assert sink.usage == [(5, 9, 120)]
    for stage, outcome in sink.stages:
        assert stage not in ("", None)
        assert outcome in (None, "success")


def test_port_protocol_is_callable_with_sink() -> None:
    class FakePort:
        async def run(
            self, request: ModelTurnRequest, *, events: TurnEventSink
        ) -> ModelTurnResult:
            events.on_stage("terminal", outcome="success")
            events.on_usage(1, 2, 3)
            return ModelTurnResult(
                output=request.text.upper(), usage=ModelTurnUsage(1, 2)
            )

    async def exercise() -> ModelTurnResult:
        sink = FakeSink()
        port = FakePort()
        return await port.run(ModelTurnRequest(text="hi"), events=sink)

    result = asyncio.run(exercise())
    assert result.output == "HI"
    assert result.usage.prompt_tokens == 2
