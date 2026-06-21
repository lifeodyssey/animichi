"""Unit tests for backend.agents.handlers (answer_question, clarify, route helpers)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from backend.agents.handlers._helpers import optimize_route
from backend.agents.handlers.answer_question import execute, execute_clarify
from backend.agents.handlers.greet_user import execute as execute_greet
from backend.agents.handlers.plan_selected import execute as execute_plan_selected
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep, ToolName
from backend.infrastructure.supabase.client import SupabaseClient


def _step(tool: ToolName, params: dict[str, object] | None = None) -> PlanStep:
    return PlanStep(tool=tool, params=params or {})


# ---------------------------------------------------------------------------
# answer_question
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# greet_user
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# clarify
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# optimize_route
# ---------------------------------------------------------------------------


class TestOptimizeRoute:
    def test_optimize_route_includes_cover_url(self) -> None:
        result = optimize_route(
            [
                {
                    "id": "p1",
                    "name": "Spot A",
                    "latitude": 34.88,
                    "longitude": 135.80,
                    "cover_url": "https://example.com/cover.jpg",
                },
                {
                    "id": "p2",
                    "name": "Spot B",
                    "latitude": 34.89,
                    "longitude": 135.81,
                },
            ],
            {},
            None,
        )

        assert result.success is True
        assert result.data["cover_url"] == "https://example.com/cover.jpg"


# ---------------------------------------------------------------------------
# plan_selected
# ---------------------------------------------------------------------------


class TestPlanSelected:
    async def test_missing_point_ids_fails(self) -> None:
        step = _step(ToolName.PLAN_SELECTED, {})
        result = await execute_plan_selected(step, {}, MagicMock(), MagicMock())

        assert result.success is False
        assert result.error == "point_ids is required"

    async def test_non_supabase_db_fails(self) -> None:
        step = _step(ToolName.PLAN_SELECTED, {"point_ids": ["p1"]})
        result = await execute_plan_selected(step, {}, object(), MagicMock())

        assert result.success is False
        assert result.error == "get_points_by_ids not available"

    async def test_routes_selected_points(self) -> None:
        db = MagicMock(spec=SupabaseClient)
        db.points = MagicMock()
        db.points.get_points_by_ids = AsyncMock(
            return_value=[
                {"id": "p1", "name": "A", "latitude": 34.88, "longitude": 135.80},
                {"id": "p2", "name": "B", "latitude": 34.89, "longitude": 135.81},
            ]
        )
        step = _step(ToolName.PLAN_SELECTED, {"point_ids": ["p1", "p2"]})

        result = await execute_plan_selected(step, {}, db, MagicMock())

        assert result.tool == "plan_selected"
        assert result.success is True
        db.points.get_points_by_ids.assert_awaited_once_with(["p1", "p2"])


# ---------------------------------------------------------------------------
# _run_ephemeral — SSE error detail
# ---------------------------------------------------------------------------


class TestRunEphemeralEmitsErrorDetail:
    """When an ephemeral handler fails, the SSE step event must carry detail."""

    async def test_emits_error_in_step_data_on_failure(self) -> None:
        from backend.agents.tool_runtime import _run_ephemeral

        emitted: list[tuple[str, str, dict[str, object], str, str]] = []

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
        deps.tool_state = {}
        deps.steps = []
        deps.db = MagicMock()

        ctx = MagicMock()
        ctx.deps = deps

        error_msg = "Validation failed: missing bangumi_id"

        async def failing_handler(
            step: object, state: object, db: object, retriever: object
        ) -> HandlerResult:
            return HandlerResult.fail("plan_route", error_msg)

        await _run_ephemeral(
            ctx,
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
        from backend.agents.tool_runtime import _run_ephemeral

        emitted: list[tuple[str, str, dict[str, object], str, str]] = []

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
        deps.tool_state = {}
        deps.steps = []
        deps.db = MagicMock()

        ctx = MagicMock()
        ctx.deps = deps

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
            ctx,
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
