"""Project structured-output events into visible Generative UI progress."""

from __future__ import annotations

from pydantic_ai.messages import (
    AgentStreamEvent,
    FinalResultEvent,
    PartStartEvent,
    ToolCallPart,
)

from animichi.agents.runtime_deps import RuntimeDeps, StepEvent, new_step_call_id

_DIRECT_INTENTS = {
    "clarify_response": "clarify",
    "greeting_response": "greet_user",
    "qa_response": "general_qa",
}


async def handle_output_event(deps: RuntimeDeps, event: AgentStreamEvent) -> bool:
    """Handle output lifecycle events and identify them for the caller."""
    if isinstance(event, PartStartEvent):
        await _handle_part_start(deps, event)
        return True
    if not isinstance(event, FinalResultEvent):
        return False
    await _emit_progress(deps, event.tool_name, event.tool_call_id)
    return True


async def _handle_part_start(deps: RuntimeDeps, event: PartStartEvent) -> None:
    if not isinstance(event.part, ToolCallPart):
        return
    await _emit_progress(deps, event.part.tool_name, event.part.tool_call_id)


async def _emit_progress(
    deps: RuntimeDeps, output_name: str | None, call_id: str | None
) -> None:
    intent = _output_intent(deps, output_name)
    resolved_id = call_id or new_step_call_id("output")
    if intent is None or resolved_id in deps.output_progress_calls:
        return
    deps.output_progress_calls.add(resolved_id)
    await _send(deps, StepEvent(intent, resolved_id, "running", {}, kind="output"))


async def _send(deps: RuntimeDeps, event: StepEvent) -> None:
    if deps.on_step is None:
        return
    await deps.on_step(event)


def _output_intent(deps: RuntimeDeps, output_name: str | None) -> str | None:
    if output_name == "search_response":
        return _last_successful(deps, {"search_bangumi", "search_nearby"})
    if output_name == "route_response":
        return _last_successful(deps, {"plan_route", "plan_selected"})
    return _DIRECT_INTENTS.get(output_name or "")


def _last_successful(deps: RuntimeDeps, names: set[str]) -> str | None:
    return next(
        (
            step.tool
            for step in reversed(deps.steps)
            if step.is_success and step.tool in names
        ),
        None,
    )
