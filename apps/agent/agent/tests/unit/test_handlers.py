"""Unit tests for agent.agents.handlers (answer_question, clarify, route helpers)."""

from __future__ import annotations

from unittest.mock import MagicMock

from agent.agents.handlers.answer_question import execute, execute_clarify
from agent.agents.handlers.greet_user import execute as execute_greet
from agent.agents.handlers.result import HandlerResult
from agent.agents.models import PlanStep, ToolName
from agent.agents.tool_state import ToolState

_Emitted = list[tuple[str, str, dict[str, object], str, str]]


def _step(tool: ToolName, params: dict[str, object] | None = None) -> PlanStep:
    return PlanStep(tool=tool, params=params or {})


def _ctx_with_emitter(emitted: _Emitted) -> MagicMock:
    async def fake_on_step(
        tool: str,
        status: str,
        data: dict[str, object],
        thought: str = "",
        observation: str = "",
    ) -> None:
        emitted.append((tool, status, data, thought, observation))

    deps = MagicMock()
    deps.on_step = fake_on_step
    deps.tool_state = ToolState()
    deps.steps = []
    deps.db = MagicMock()
    ctx = MagicMock()
    ctx.deps = deps
    return ctx


class TestAnswerQuestion:
    async def test_returns_correct_shape(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {"answer": "42 is the answer"})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.tool == "answer_question"
        assert result.success is True
        assert result.data["message"] == "42 is the answer"
        assert result.data["status"] == "info"

    async def test_empty_answer(self) -> None:
        step = _step(ToolName.ANSWER_QUESTION, {})
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.success is True
        assert result.data["message"] == ""

    async def test_no_params(self) -> None:
        step = PlanStep(tool=ToolName.ANSWER_QUESTION)
        result = await execute(step, {}, MagicMock(), MagicMock())

        assert result.success is True


class TestGreetUser:
    async def test_returns_greeting_message(self) -> None:
        step = _step(ToolName.GREET_USER, {"message": "こんにちは"})
        result = await execute_greet(step, {}, MagicMock(), MagicMock())

        assert result.tool == "greet_user"
        assert result.success is True
        assert result.data["message"] == "こんにちは"
        assert result.data["status"] == "info"

    async def test_defaults_to_empty_message(self) -> None:
        step = PlanStep(tool=ToolName.GREET_USER)
        result = await execute_greet(step, {}, MagicMock(), MagicMock())

        assert result.success is True
        assert result.data["message"] == ""


class TestClarify:
    async def test_returns_clarification(self) -> None:
        step = _step(
            ToolName.CLARIFY,
            {"question": "Which one?", "options": ["A", "B"]},
        )
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.tool == "clarify"
        assert result.success is True
        assert result.data["question"] == "Which one?"
        assert result.data["options"] == ["A", "B"]
        assert result.data["status"] == "needs_clarification"
        assert result.data["candidates"][0]["title"] == "A"
        assert result.data["candidates"][1]["title"] == "B"

    async def test_empty_clarify(self) -> None:
        step = _step(ToolName.CLARIFY, {})
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.success is True
        assert result.data["question"] == ""
        assert result.data["options"] == []
        assert result.data["candidates"] == []

    async def test_explicit_candidates_are_preserved(self) -> None:
        step = _step(
            ToolName.CLARIFY,
            {
                "question": "Which one?",
                "options": ["A"],
                "candidates": [
                    {
                        "title": "Custom A",
                        "cover_url": "https://example.com/a.jpg",
                        "spot_count": 3,
                        "city": "Uji",
                    }
                ],
            },
        )
        result = await execute_clarify(step, {}, MagicMock(), MagicMock())

        assert result.data["candidates"][0]["title"] == "Custom A"
        assert result.data["candidates"][0]["spot_count"] == 3


class TestRunEphemeralEmitsErrorDetail:
    async def test_emits_error_in_step_data_on_failure(self) -> None:
        from agent.agents.tool_runtime import _run_ephemeral

        emitted: _Emitted = []
        error_msg = "Validation failed: missing bangumi_id"

        async def failing_handler(
            step: object, state: object, db: object, retriever: object
        ) -> HandlerResult:
            return HandlerResult.fail("plan_route", error_msg)

        await _run_ephemeral(
            _ctx_with_emitter(emitted),
            tool=ToolName.PLAN_ROUTE,
            params={},
            handler=failing_handler,
        )

        failed_events = [
            (t, s, d, th, obs) for t, s, d, th, obs in emitted if s == "failed"
        ]
        assert len(failed_events) == 1

        _, _, data, _, observation = failed_events[0]
        assert data["error"] == error_msg
        assert observation == error_msg

    async def test_emits_error_preserves_partial_data(self) -> None:
        from agent.agents.tool_runtime import _run_ephemeral

        emitted: _Emitted = []

        async def failing_handler_with_data(
            step: object, state: object, db: object, retriever: object
        ) -> HandlerResult:
            return HandlerResult(
                tool="resolve_anime",
                success=False,
                data={"partial": "data"},
                error="Could not resolve",
            )

        await _run_ephemeral(
            _ctx_with_emitter(emitted),
            tool=ToolName.RESOLVE_ANIME,
            params={"title": "unknown"},
            handler=failing_handler_with_data,
        )

        failed_events = [
            (t, s, d, th, obs) for t, s, d, th, obs in emitted if s == "failed"
        ]
        assert len(failed_events) == 1

        _, _, data, _, observation = failed_events[0]
        assert data["error"] == "Could not resolve"
        assert data["partial"] == "data"
        assert observation == "Could not resolve"
