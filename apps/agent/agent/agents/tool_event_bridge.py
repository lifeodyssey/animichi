"""Translate official PydanticAI tool events into runtime lifecycle contracts."""

from __future__ import annotations

import json
from collections.abc import AsyncIterable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

import structlog
from pydantic import BaseModel, JsonValue, TypeAdapter, ValidationError
from pydantic_ai import RunContext
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    RetryPromptPart,
    ToolReturnPart,
)

from agent.agents.agent_result import StepData, StepProvenance, StepRecord
from agent.agents.runtime_deps import StepEvent, StepStatus
from agent.agents.web_trust import detect_prompt_injection, sanitize_untrusted

if TYPE_CHECKING:
    from agent.agents.runtime_deps import RuntimeDeps

_OBJECT = TypeAdapter(dict[str, JsonValue])
_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_MAX_STRING = 1_024
_MAX_ITEMS = 20
_MAX_DEPTH = 3
_FAILED_ERROR = "Tool execution failed"
logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class ActiveToolCall:
    """Official call metadata retained until its matching result arrives."""

    tool: str
    params: dict[str, JsonValue]


@dataclass
class ToolLifecycleRegistry:
    """Per-run call and provenance registry keyed only by official call ID."""

    active: dict[str, ActiveToolCall] = field(default_factory=dict)
    provenance: dict[str, StepProvenance] = field(default_factory=dict)
    recovered_exceptions: set[str] = field(default_factory=set)

    def start(self, call_id: str, tool: str, params: dict[str, JsonValue]) -> None:
        self.active[call_id] = ActiveToolCall(tool, params)

    def finish(self, call_id: str, tool: str) -> ActiveToolCall:
        return self.active.pop(call_id, ActiveToolCall(tool, {}))

    def register_provenance(self, call_id: str, provenance: StepProvenance) -> None:
        self.provenance[call_id] = provenance

    def take_provenance(self, call_id: str) -> StepProvenance | None:
        return self.provenance.pop(call_id, None)

    def mark_recovered_exception(self, call_id: str) -> None:
        self.recovered_exceptions.add(call_id)

    def take_recovered_exception(self, call_id: str) -> bool:
        present = call_id in self.recovered_exceptions
        self.recovered_exceptions.discard(call_id)
        return present

    def abandon(self, call_id: str) -> None:
        self.active.pop(call_id, None)
        self.provenance.pop(call_id, None)
        self.recovered_exceptions.discard(call_id)


async def tool_event_bridge(
    ctx: RunContext[RuntimeDeps], events: AsyncIterable[AgentStreamEvent]
) -> None:
    """Drain one graph node's official event stream into request-local state."""
    async for event in events:
        if isinstance(event, FunctionToolCallEvent):
            await _handle_call(ctx.deps, event)
        elif isinstance(event, FunctionToolResultEvent):
            await _handle_result(ctx.deps, event)


def register_tool_provenance(
    ctx: RunContext[RuntimeDeps], provenance: StepProvenance
) -> None:
    """Bind exact application provenance to the current official call ID."""
    call_id = getattr(ctx, "tool_call_id", None)
    if isinstance(call_id, str):
        ctx.deps.tool_lifecycle.register_provenance(call_id, provenance)
        return
    logger.warning(
        "tool_provenance_missing_call_id",
        tool=getattr(ctx, "tool_name", None),
        call_id_type=type(call_id).__name__,
    )


def register_recovered_tool_exception(
    ctx: RunContext[RuntimeDeps], call_id: str
) -> None:
    """Remember a recovered attempt until its official return event."""
    ctx.deps.tool_lifecycle.mark_recovered_exception(call_id)


def _call_params(event: FunctionToolCallEvent) -> dict[str, JsonValue]:
    """Never let an odd argument shape kill the run — the siblings all guard too.

    Malformed JSON already arrives as {"INVALID_JSON": raw} from pydantic-ai, so
    the model keeps its own retry path; the residual raiser is dict-typed args
    holding non-JSON values. Recording empty params is strictly better than
    turning a retryable tool call into a terminal run error.
    """
    try:
        return _OBJECT.validate_python(event.part.args_as_dict())
    except ValidationError:
        return {}


async def _handle_call(deps: RuntimeDeps, event: FunctionToolCallEvent) -> None:
    params = _call_params(event)
    deps.tool_lifecycle.start(event.tool_call_id, event.part.tool_name, params)
    data = cast(StepData, params)
    await _emit(
        deps, StepEvent(event.part.tool_name, event.tool_call_id, "running", data)
    )


async def _handle_result(deps: RuntimeDeps, event: FunctionToolResultEvent) -> None:
    if isinstance(event.part, RetryPromptPart):
        await _handle_retry(deps, event)
        return
    await _handle_return(deps, event.part)


async def _handle_retry(deps: RuntimeDeps, event: FunctionToolResultEvent) -> None:
    call = deps.tool_lifecycle.finish(
        event.tool_call_id, event.part.tool_name or "tool"
    )
    # Clear provenance and any recovered mark too: `finish` only pops `active`,
    # so a retried call would otherwise leave entries behind for a call id that
    # will never return. Bounded today (ids never repeat, the registry is
    # request-scoped), but "mostly reached" is not a lifecycle.
    deps.tool_lifecycle.abandon(event.tool_call_id)
    await _emit(deps, StepEvent(call.tool, event.tool_call_id, "error", {}))


async def _handle_return(deps: RuntimeDeps, part: ToolReturnPart) -> None:
    call = deps.tool_lifecycle.finish(part.tool_call_id, part.tool_name)
    if part.outcome in {"denied", "interrupted"}:
        await _handle_unexecuted(deps, call, part.tool_call_id)
        return
    if deps.tool_lifecycle.take_recovered_exception(part.tool_call_id):
        await _handle_recovered_exception(deps, call, part)
        return
    success = part.outcome == "success"
    data = _project_content(part.content) if success else None
    await _complete(deps, call, part, data, success)


async def _handle_recovered_exception(
    deps: RuntimeDeps, call: ActiveToolCall, part: ToolReturnPart
) -> None:
    deps.tool_lifecycle.take_provenance(part.tool_call_id)
    _scan_result(call.tool, part.content)
    await _emit(deps, StepEvent(call.tool, part.tool_call_id, "error", {}))


async def _handle_unexecuted(
    deps: RuntimeDeps, call: ActiveToolCall, call_id: str
) -> None:
    deps.tool_lifecycle.abandon(call_id)
    await _emit(deps, StepEvent(call.tool, call_id, "error", {}))


async def _complete(
    deps: RuntimeDeps,
    call: ActiveToolCall,
    part: ToolReturnPart,
    data: dict[str, JsonValue] | None,
    success: bool,
) -> None:
    _record_terminal_return(deps, call, part, data, success)
    _scan_result(call.tool, part.content)
    status: StepStatus = "done" if success else "error"
    payload = cast(StepData, data or {})
    await _emit(deps, StepEvent(call.tool, part.tool_call_id, status, payload))


def _record_terminal_return(
    deps: RuntimeDeps,
    call: ActiveToolCall,
    part: ToolReturnPart,
    data: dict[str, JsonValue] | None,
    success: bool,
) -> None:
    """Persist only an official terminal return, never a recovered attempt."""
    provenance = deps.tool_lifecycle.take_provenance(part.tool_call_id)
    error = None if success else _FAILED_ERROR
    params = cast(StepData, call.params)
    payload = cast(StepData | None, data)
    deps.steps.append(
        StepRecord(call.tool, success, params, payload, provenance, error)
    )


async def _emit(deps: RuntimeDeps, event: StepEvent) -> None:
    if deps.on_step is not None:
        await deps.on_step(event)


def _project_content(content: object) -> dict[str, JsonValue]:
    raw = content.model_dump(mode="json") if isinstance(content, BaseModel) else content
    try:
        value = _project_value(_VALUE.validate_python(raw))
    except ValidationError:
        return {"content_type": type(content).__name__}
    if isinstance(value, dict):
        return value
    return {"content": value}


def _project_value(value: JsonValue, depth: int = 0) -> JsonValue:
    if isinstance(value, str):
        return sanitize_untrusted(value, max_len=_MAX_STRING)
    if depth >= _MAX_DEPTH:
        return "[truncated]"
    if isinstance(value, list):
        return [_project_value(item, depth + 1) for item in value[:_MAX_ITEMS]]
    if isinstance(value, dict):
        return _project_mapping(value, depth)
    return value


def _project_mapping(value: dict[str, JsonValue], depth: int) -> dict[str, JsonValue]:
    items = list(value.items())[:_MAX_ITEMS]
    return {
        sanitize_untrusted(key, max_len=_MAX_STRING): _project_value(item, depth + 1)
        for key, item in items
    }


def _scan_result(tool: str, content: object) -> None:
    if isinstance(content, str):
        detect_prompt_injection(content, source=tool)
        return
    raw = content.model_dump(mode="json") if isinstance(content, BaseModel) else content
    try:
        value = _VALUE.validate_python(raw)
    except ValidationError:
        return
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    detect_prompt_injection(text, source=tool)
